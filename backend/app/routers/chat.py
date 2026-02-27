"""
チャット関連のAPIエンドポイント (backend/app 用)
別のアプリの実装を参考に統合
"""
import os
import re
from typing import Optional

from fastapi import APIRouter, Query, HTTPException, Request, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from pathlib import Path
from dotenv import load_dotenv
import json
import time

from ..services.llm import LLMClient
from ..database import get_db
from .. import crud, schemas, models, task_list as task_list_module
from jose import JWTError, jwt
from ..security import get_current_user, SECRET_KEY, ALGORITHM
from sqlalchemy.orm import Session
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

# LLMClientの初期化
llm_client = None
_cached_api_key: str = ""

def get_llm_client():
    """backend/.env を読み込み、API Keyが変更されていればクライアントを再生成"""
    global llm_client, _cached_api_key

    env_path = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(dotenv_path=str(env_path), override=True)

    current_api_key = os.getenv("GOOGLE_API_KEY", "")

    if llm_client is None or _cached_api_key != current_api_key:
        _cached_api_key = current_api_key
        llm_client = LLMClient(api_key=current_api_key)

    return llm_client


class ChatRequest(BaseModel):
    """チャットリクエストのモデル"""
    query: str
    user: Optional[str] = None
    conversation_id: Optional[str] = None


class ChatResponse(BaseModel):
    """チャットレスポンスのモデル"""
    answer: str
    conversation_id: Optional[str] = None
    message_id: Optional[str] = None


class StopRequest(BaseModel):
    """停止リクエストのモデル"""
    user: str


async def get_current_user_for_sse(
    access_token: Optional[str] = Query(None, description="SSE用トークン（EventSourceはヘッダ送信不可のため）"),
    db: Session = Depends(get_db),
) -> models.User:
    """クエリパラメータ access_token から現在ユーザーを取得（一般ユーザー用チャットSSE用）"""
    if not access_token or not access_token.strip():
        raise HTTPException(status_code=401, detail="access_tokenが必要です")
    try:
        payload = jwt.decode(access_token.strip(), SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="無効なトークンです")
        user = crud.get_user_by_email(db, email=username)
        if user is None:
            raise HTTPException(status_code=401, detail="ユーザーが見つかりません")
        return user
    except JWTError:
        raise HTTPException(status_code=401, detail="無効なトークンです")


@router.post("/chat/stream")
async def stream_chat(
    request: ChatRequest,
    fastapi_request: Request = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    ストリーミングチャットエンドポイント (POST版)
    Google Gemini (LLMClient) を使用
    """
    query = request.query
    conversation_id = request.conversation_id
    
    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="queryパラメータが必要です")

    client = get_llm_client()
    
    # ユーザー名は管理者/デフォルトとして扱う
    user = request.user if request.user else "admin_user"

    t0 = time.time()
    # inputs にタスクリストCSV、プロジェクトリスト、ユーザーリストを含める
    inputs: dict = {}
    try:
        inputs = task_list_module.get_dashboard_context(db, current_user.id)
        inputs["mode"] = "admin"
        inputs["user_name"] = current_user.name or current_user.username or "Admin"
    except Exception as e:
        logger.warning("[chat/stream] get_dashboard_context failed: %s", e)
        # Fallback to empty context
        inputs = {"csv": "", "proj": "", "user_list": "", "mode": "admin", "notes": ""}
        
    logger.info(f"[PROFILER] get_dashboard_context took {time.time() - t0:.2f}s")
        
    # RAG Context Retrieval (Temporarily Disabled)
    # try:
    #     rag_context = rag_service.query_context(query)
    #     if rag_context:
    #         inputs["notes"] = inputs.get("notes", "") + "\n\n--- RAG Knowledge Base Context ---\n" + rag_context
    # except Exception as e:
    #     logger.warning("[chat/stream] RAG query failed: %s", e)
        
    if conversation_id is None:
        import uuid
        conversation_id = str(uuid.uuid4())

    async def eventgen():
        try:
            # ブラウザの自動再接続を抑止
            yield b"retry: 0\n\n"
            
            # チャット開始時にタスクリスト（toDatatable形式CSV）を送信 (FrontendのDify対応ロジックに合わせる)
            try:
                if "csv" in inputs:
                    task_list_payload = json.dumps(
                        {"type": "task_list", "csv": inputs["csv"]},
                        ensure_ascii=False,
                    )
                    yield (
                        "event: task_list\n"
                        f"data: {task_list_payload}\n\n"
                    ).encode("utf-8")
            except Exception as e:
                logger.warning("[SSE] task_list generation failed: %s", e)

            message_buffer = ""

            # LLMストリーミング
            logger.info(f"[PROFILER] Calling client.stream_chat now... (Elapsed from start: {time.time() - t0:.2f}s)")
            
            t_first_chunk = None
            async for event_data in client.stream_chat(query, conversation_id, inputs, user):
                if t_first_chunk is None:
                    t_first_chunk = time.time()
                    logger.info(f"[PROFILER] First yield from stream_chat arrived. TTFT: {t_first_chunk - t0:.2f}s")
                    
                # event_data は {"event": "...", "answer": "...", ...}
                
                # SSE形式にエンコードして送信
                json_str = json.dumps(event_data, ensure_ascii=False)
                yield f"data: {json_str}\n\n".encode("utf-8")
                
                if event_data.get("event") == "message":
                    message_buffer += event_data.get("answer", "")
                
                if event_data.get("event") == "message_end":
                    
                    # --- Admin Auto-Execution Logic ---
                    full_answer = message_buffer
                    action_list = _extract_actions(full_answer)

                    if action_list:
                        logger.info("[SSE Admin] Auto-executing actions: %s", action_list)
                        
                        executed_results = []
                        for action in action_list:
                            try:
                                # 管理者権限とみなして実行
                                result = _execute_task_action_internal(action=action, db=db, current_user=None)
                                result["action_type"] = action.get("action_type")
                                executed_results.append(result)
                            except Exception as ex:
                                logger.error(f"Auto-execution failed for action {action}: {ex}")
                                executed_results.append({"success": False, "error": str(ex), "action_type": action.get("action_type")})

                        # Notify frontend of execution results
                        notification = {
                            "type": "action_executed",
                            "results": executed_results
                        }
                        yield (
                            "event: action_executed\n"
                            f"data: {json.dumps(notification, ensure_ascii=False)}\n\n"
                        ).encode("utf-8")
                        
                        # Add a system message to the chat stream explaining what happened
                        success_count = sum(1 for r in executed_results if r.get("success"))
                        if success_count > 0:
                            system_msg = f"\n\n[システム通知] {success_count}件のアクションを自動実行しました。"
                            yield (
                                "event: message\n"
                                f"data: {json.dumps({'event': 'message', 'answer': system_msg, 'conversation_id': conversation_id}, ensure_ascii=False)}\n\n"
                            ).encode("utf-8")

            # 終了（LLMClientがmessage_endを送ってくれるはずだが、念のため改行）
            yield b"\n"

        except Exception as e:
            logger.error("[SSE] Exception: %s", e)
            err = json.dumps({"type": "error", "status": 500, "detail": {"message": str(e)}}, ensure_ascii=False)
            yield f"data: {err}\n\n".encode("utf-8")

    return StreamingResponse(
        eventgen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/chat/user/stream")
async def stream_chat_user(
    request: ChatRequest,
    fastapi_request: Request = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user), # Use standard auth for POST
):
    """
    ユーザー向けチャットエンドポイント (POST版)
    Google Gemini (LLMClient) を使用
    """
    query = request.query
    conversation_id = request.conversation_id
    
    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="queryパラメータが必要です")

    client = get_llm_client()
    user_email = current_user.email

    inputs: dict = {}
    try:
        inputs = task_list_module.get_personal_context(db, current_user.id)
        inputs["mode"] = "personal"
        inputs["user_name"] = current_user.name or current_user.username or "User"
    except Exception as e:
        logger.warning("[chat/user/stream] get_personal_context failed: %s", e)
        inputs = {"csv": "", "proj": "", "events": "", "mode": "personal", "notes": ""}

    # RAG Context Retrieval (Temporarily Disabled)
    # try:
    #     rag_context = rag_service.query_context(query)
    #     if rag_context:
    #         inputs["notes"] = inputs.get("notes", "") + "\n\n--- RAG Knowledge Base Context ---\n" + rag_context
    # except Exception as e:
    #     logger.warning("[chat/user/stream] RAG query failed: %s", e)

    if conversation_id is None:
        import uuid
        conversation_id = str(uuid.uuid4())

    async def eventgen():
        try:
            # ブラウザの自動再接続を抑止
            yield b"retry: 0\n\n"
            
            try:
                if "csv" in inputs:
                    task_list_payload = json.dumps(
                        {"type": "task_list", "csv": inputs["csv"]},
                        ensure_ascii=False,
                    )
                    yield (
                        "event: task_list\n"
                        f"data: {task_list_payload}\n\n"
                    ).encode("utf-8")
            except Exception as e:
                logger.warning("[SSE user] task_list generation failed: %s", e)

            message_buffer = ""

            async for event_data in client.stream_chat(query, conversation_id, inputs, user_email):
                json_str = json.dumps(event_data, ensure_ascii=False)
                yield f"data: {json_str}\n\n".encode("utf-8")
                
                if event_data.get("event") == "message":
                    message_buffer += event_data.get("answer", "")
                
                if event_data.get("event") == "message_end":
                    full_answer = message_buffer
                    
                    # Logic is same as stream_chat, compacted here
                    action_list = _extract_actions(full_answer)
                            
                    if action_list:
                        notification = {"type": "task_action_candidate", "actions": action_list}
                        yield (
                            "event: task_action\n"
                            f"data: {json.dumps(notification, ensure_ascii=False)}\n\n"
                        ).encode("utf-8")

            yield b"\n"
        except Exception as e:
            logger.error("[SSE user] Exception: %s", e)
            err = json.dumps({"type": "error", "status": 500, "detail": {"message": str(e)}}, ensure_ascii=False)
            yield f"data: {err}\n\n".encode("utf-8")

    return StreamingResponse(
        eventgen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/conversation/reset")
async def reset_conversation():
    import uuid
    new_conversation_id = str(uuid.uuid4())
    return {"message": "会話がリセットされました", "conversation_id": new_conversation_id}


@router.get("/conversation/new")
async def new_conversation():
    import uuid
    new_conversation_id = str(uuid.uuid4())
    return {"conversation_id": new_conversation_id}


@router.get("/conversations")
async def list_conversations(user: str = Query(..., description="ユーザー識別子")):
    """
    会話一覧を取得するエンドポイント（デバッグ用）
    """
    # 簡易実装：空リストを返す
    return {"data": [], "has_more": False, "limit": 20, "total": 0}


@router.get("/messages")
async def list_messages(conversation_id: str = Query(..., description="会話ID"), user: str = Query(..., description="ユーザー識別子")):
    """
    メッセージ一覧を取得するエンドポイント（デバッグ用）
    """
    # 簡易実装：空リストを返す
    return {"data": [], "has_more": False, "limit": 20}


@router.post("/chat/stop/{task_id}")
async def stop_generation(task_id: str, request: StopRequest):
    """
    ストリーミング生成を停止するエンドポイント
    """
    # LLMClient側でストリームが中断されるため、ここでは何もしなくてよい
    return {"result": "success", "message": "生成が停止されました"}


@router.post("/chat/user/stop/{task_id}")
async def stop_generation_user(
    task_id: str,
    request: StopRequest,
    current_user: models.User = Depends(get_current_user),
):
    """
    一般ユーザー専用チャットのストリーミング生成を停止するエンドポイント。
    """
    return {"result": "success", "message": "生成が停止されました"}


@router.get("/suggestions/{message_id}")
async def get_suggested_questions(message_id: str, user: str = Query(..., description="ユーザー識別子")):
    """
    推奨質問を取得するエンドポイント
    """
    # Gemini 1.5 Flash はデフォルトでは推奨質問を返さないため空リスト
    return {"suggestions": []}


@router.post("/chat/actions/task")
async def execute_task_action(
    action: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Difyワークフローから呼び出されるタスク管理アクションエンドポイント
    3つのアクションのみ対応: update_task, create_task, delete_task
    """
    return _execute_task_action_internal(action=action, db=db, current_user=current_user)


def _normalize_priority(value):  # noqa: ANN201
    """チャット/AI から渡る小文字の priority を TaskPriority の 'HIGH'/'MEDIUM'/'LOW' に正規化する。"""
    if value is None:
        return None
    if isinstance(value, str):
        u = value.upper()
        if u in ("HIGH", "MEDIUM", "LOW"):
            return u
    return None


def _normalize_status(status_str: str) -> Optional[str]:
    """ステータス文字列を正規化"""
    if not status_str or not isinstance(status_str, str):
        return None
    s = status_str.strip().lower()
    # 一般的な表現を内部Enum値にマッピング
    mapping = {
        "done": "completed",
        "finished": "completed",
        "complete": "completed",
        "completed": "completed",
        "todo": "todo",
        "new": "todo",
        "open": "todo",
        "in-progress": "in-progress",
        "inprogress": "in-progress",
        "doing": "in-progress",
        "working": "in-progress",
        "review": "review",
        "reviewing": "review",
        "delayed": "delayed",
        "delay": "delayed",
    }
    return mapping.get(s, s)


def _execute_task_action_internal(
    action: dict,
    db: Session,
    current_user: Optional[models.User] = None,
):
    """
    タスク管理アクションの共通実装。
    - /chat/actions/task エンドポイント
    - /chat/stream 内での自動実行
    から呼び出される。
    """
    action_type = action.get("action_type")

    try:
        if action_type == "update_task":
            task_id = action.get("task_id")
            task_data_dict = action.get("task_data", {})

            if not task_id:
                return {"success": False, "error": "task_idが必要です"}

            db_task = crud.get_task(db=db, task_id=task_id)
            if not db_task:
                return {"success": False, "error": f"タスクID {task_id} が見つかりません"}

            # 更新可能なフィールドのみを抽出
            update_data = {}
            if "name" in task_data_dict:
                update_data["name"] = task_data_dict["name"]
            if "description" in task_data_dict:
                update_data["description"] = task_data_dict["description"]
            if "status" in task_data_dict:
                normalized_status = _normalize_status(task_data_dict["status"])
                if normalized_status:
                    update_data["status"] = normalized_status
            if "priority" in task_data_dict:
                normalized = _normalize_priority(task_data_dict["priority"])
                if normalized is not None:
                    update_data["priority"] = normalized
            if "due_date" in task_data_dict:
                update_data["due_date"] = task_data_dict["due_date"]
            if "start_date" in task_data_dict:
                update_data["start_date"] = task_data_dict["start_date"]
            if "assigned_to" in task_data_dict:
                update_data["assigned_to"] = task_data_dict["assigned_to"]
            if "project_id" in task_data_dict:
                update_data["project_id"] = task_data_dict["project_id"]
            if "cost" in task_data_dict:
                update_data["cost"] = task_data_dict["cost"]

            task_data = schemas.TaskUpdate(**update_data)
            updated_task = crud.update_task(db=db, db_task=db_task, task_in=task_data)

            return {
                "success": True,
                "message": f"タスク '{updated_task.name}' を更新しました",
                "task_id": updated_task.id,
                "task_name": updated_task.name,
            }

        elif action_type == "create_task":
            task_data_dict = action.get("task_data", {})

            if not task_data_dict.get("name"):
                return {"success": False, "error": "タスク名が必要です"}

            # 必須フィールドの設定
            priority_val = _normalize_priority(task_data_dict.get("priority")) or "MEDIUM"
            status_val = _normalize_status(task_data_dict.get("status")) or "todo"
            task_data = schemas.TaskCreate(
                name=task_data_dict.get("name"),
                description=task_data_dict.get("description", ""),
                status=status_val,
                priority=priority_val,
                project_id=task_data_dict.get("project_id"),
                assigned_to=task_data_dict.get("assigned_to"),
                due_date=task_data_dict.get("due_date"),
                start_date=task_data_dict.get("start_date"),
                cost=task_data_dict.get("cost", 0),
                type=task_data_dict.get("type", ""),
                seqID=task_data_dict.get("seqID", ""),
                shotID=task_data_dict.get("shotID", ""),
                dependsOn=task_data_dict.get("dependsOn", []),
                display_status="online",
            )

            created_task = crud.create_task(db=db, task=task_data)

            return {
                "success": True,
                "message": f"タスク '{created_task.name}' を作成しました",
                "task_id": created_task.id,
                "task_name": created_task.name,
            }

        elif action_type == "delete_task":
            task_id = action.get("task_id")

            if not task_id:
                return {"success": False, "error": "task_idが必要です"}

            db_task = crud.get_task(db=db, task_id=task_id)
            if not db_task:
                return {"success": False, "error": f"タスクID {task_id} が見つかりません"}

            task_name = db_task.name
            crud.delete_task(db=db, db_task=db_task)

            return {
                "success": True,
                "message": f"タスク '{task_name}' を削除しました",
                "task_id": task_id,
            }

        else:
            return {
                "success": False,
                "error": f"不明なアクションタイプ: {action_type}。対応しているのは update_task, create_task, delete_task のみです。",
            }

    except Exception as e:
        logger.error(f"アクション実行エラー: {str(e)}", exc_info=True)
        return {"success": False, "error": f"エラーが発生しました: {str(e)}"}



def _extract_actions(text: str) -> Optional[list]:
    """
    LLMの回答テキストからアクションJSONブロックを抽出するヘルパー関数
    """
    action_list = None
    
    def _parse(raw):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return parsed if parsed and all(isinstance(x, dict) and x.get("action_type") in ("update_task", "create_task", "delete_task") for x in parsed) else None
            if isinstance(parsed, dict) and parsed.get("action_type") in ("update_task", "create_task", "delete_task"):
                return [parsed]
            return None
        except: return None
    
    def _blocks(t): return re.findall(r"```(?:json)?\s*([\s\S]*?)```", t)
    
    all_blocks = _blocks(text)
    if all_blocks:
        action_list = []
        for b in all_blocks:
            c = _parse(b.strip())
            if c: action_list.extend(c)
        if not action_list: action_list = None
    
    # フォールバック（コードブロック無しの場合）
    if not action_list:
        cleaned = text.strip()
        if "---" in cleaned: cleaned = cleaned.split("---", 1)[1].strip()
        if cleaned.startswith("```"):
            cleaned = cleaned[3:].lstrip()
            if cleaned.lower().startswith("json"): cleaned = cleaned[4:].lstrip()
            if cleaned.endswith("```"): cleaned = cleaned[:-3].strip()
        
        # 配列またはオブジェクトとしてトライ
        if (cleaned.startswith("{") and cleaned.endswith("}")) or (cleaned.startswith("[") and cleaned.endswith("]")):
            action_list = _parse(cleaned)
            
    return action_list
