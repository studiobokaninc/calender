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

    # inputs にタスクリストCSV、プロジェクトリスト、ユーザーリストを含める
    inputs: dict = {}
    try:
        csv_text = task_list_module.build_task_list_for_chat(db)
        if csv_text:
            inputs["csv"] = csv_text
    except Exception as e:
        logger.warning("[chat/stream] task_list for inputs failed: %s", e)
    try:
        proj_text = task_list_module.build_projects_list_for_chat(db)
        if proj_text:
            inputs["proj"] = proj_text
    except Exception as e:
        logger.warning("[chat/stream] projects_list for inputs failed: %s", e)
    try:
        user_list_text = task_list_module.build_users_list_for_chat(db)
        if user_list_text:
            inputs["user_list"] = user_list_text
    except Exception as e:
        logger.warning("[chat/stream] users_list for inputs failed: %s", e)
        
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
            async for event_data in client.stream_chat(query, conversation_id, inputs, user):
                # event_data は {"event": "...", "answer": "...", ...}
                
                # SSE形式にエンコードして送信
                json_str = json.dumps(event_data, ensure_ascii=False)
                yield f"data: {json_str}\n\n".encode("utf-8")
                
                if event_data.get("event") == "message":
                    message_buffer += event_data.get("answer", "")
                
                if event_data.get("event") == "message_end":
                    # アクション検出ロジック (既存のコードを再利用)
                    full_answer = message_buffer
                    action_list = None

                    def _parse_action_candidates(raw: str):
                        try:
                            parsed = json.loads(raw)
                        except json.JSONDecodeError:
                            return None
                        if isinstance(parsed, list):
                            if not parsed: return None
                            if all(isinstance(x, dict) and x.get("action_type") in ("update_task", "create_task", "delete_task") for x in parsed):
                                return parsed
                            return None
                        if isinstance(parsed, dict) and parsed.get("action_type") in ("update_task", "create_task", "delete_task"):
                            return [parsed]
                        return None

                    def _collect_all_code_blocks(text: str):
                        return re.findall(r"```(?:json)?\s*([\s\S]*?)```", text)

                    all_blocks = _collect_all_code_blocks(full_answer)
                    if all_blocks:
                        action_list = []
                        for block_content in all_blocks:
                            block_content = block_content.strip()
                            if not block_content: continue
                            candidates = _parse_action_candidates(block_content)
                            if candidates:
                                action_list.extend(candidates)
                        if not action_list: action_list = None

                    if action_list is None:
                        # フォールバック
                        cleaned = full_answer.strip()
                        if "---" in cleaned:
                            cleaned = cleaned.split("---", 1)[1].strip() if len(cleaned.split("---", 1)) > 1 else cleaned
                        if cleaned.startswith("```"):
                            cleaned = cleaned[3:].lstrip()
                            if cleaned.lower().startswith("json"):
                                cleaned = cleaned[4:].lstrip()
                            if cleaned.endswith("```"):
                                cleaned = cleaned[:-3].strip()
                        if cleaned.startswith("{") and cleaned.endswith("}"):
                            action_list = _parse_action_candidates(cleaned)
                        elif cleaned.startswith("[") and cleaned.endswith("]"):
                            action_list = _parse_action_candidates(cleaned)

                    if action_list:
                        notification = {
                            "type": "task_action_candidate",
                            "actions": action_list,
                        }
                        logger.info("[SSE] Detected task action candidate(s): count=%s", len(action_list))
                        yield (
                            "event: task_action\n"
                            f"data: {json.dumps(notification, ensure_ascii=False)}\n\n"
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
    user = current_user.email

    inputs: dict = {}
    try:
        csv_text = task_list_module.build_task_list_for_chat(db)
        if csv_text:
            inputs["csv"] = csv_text
    except Exception as e:
        logger.warning("[chat/user/stream] task_list for inputs failed: %s", e)
    try:
        proj_text = task_list_module.build_projects_list_for_chat(db)
        if proj_text:
            inputs["proj"] = proj_text
    except Exception as e:
        logger.warning("[chat/user/stream] projects_list for inputs failed: %s", e)
    try:
        user_list_text = task_list_module.build_users_list_for_chat(db)
        if user_list_text:
            inputs["user_list"] = user_list_text
    except Exception as e:
        logger.warning("[chat/user/stream] users_list for inputs failed: %s", e)
    
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

            async for event_data in client.stream_chat(query, conversation_id, inputs, user):
                json_str = json.dumps(event_data, ensure_ascii=False)
                yield f"data: {json_str}\n\n".encode("utf-8")
                
                if event_data.get("event") == "message":
                    message_buffer += event_data.get("answer", "")
                
                if event_data.get("event") == "message_end":
                    full_answer = message_buffer
                    action_list = None
                    
                    # Logic is same as stream_chat, compacted here
                    def _parse(raw):
                        try:
                            parsed = json.loads(raw)
                            if isinstance(parsed, list): return parsed if parsed and all(isinstance(x, dict) and x.get("action_type") in ("update_task", "create_task", "delete_task") for x in parsed) else None
                            if isinstance(parsed, dict) and parsed.get("action_type") in ("update_task", "create_task", "delete_task"): return [parsed]
                            return None
                        except: return None
                    
                    def _blocks(text): return re.findall(r"```(?:json)?\s*([\s\S]*?)```", text)
                    
                    all_blocks = _blocks(full_answer)
                    if all_blocks:
                        action_list = []
                        for b in all_blocks:
                            c = _parse(b.strip())
                            if c: action_list.extend(c)
                        if not action_list: action_list = None
                    
                    if not action_list:
                        cleaned = full_answer.strip()
                        if "---" in cleaned: cleaned = cleaned.split("---", 1)[1].strip()
                        if cleaned.startswith("```"):
                            cleaned = cleaned[3:].lstrip()
                            if cleaned.lower().startswith("json"): cleaned = cleaned[4:].lstrip()
                            if cleaned.endswith("```"): cleaned = cleaned[:-3].strip()
                        if (cleaned.startswith("{") and cleaned.endswith("}")) or (cleaned.startswith("[") and cleaned.endswith("]")):
                            action_list = _parse(cleaned)
                            
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
                update_data["status"] = task_data_dict["status"]
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
            task_data = schemas.TaskCreate(
                name=task_data_dict.get("name"),
                description=task_data_dict.get("description", ""),
                status=task_data_dict.get("status", "todo"),
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


