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

from ..dify_client import DifyClient
from ..database import get_db
from .. import crud, schemas, models, task_list as task_list_module
from ..security import get_current_user
from sqlalchemy.orm import Session
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

# DifyClientの初期化（main.pyでload_dotenv()後に初期化）
"""Dify クライアントのシングルトン管理。環境変数が変わったら差し替える。"""
dify_client = None
_cached_env: dict[str, str] = {"DIFY_API_KEY": "", "DIFY_API_URL": "", "DIFY_USER": ""}#キャッシュ用の環境変数

def get_dify_client():#DifyClient変数を取得する関数
    """常に backend/.env を再読込し、変更があればクライアントを作り直す。"""
    global dify_client, _cached_env#グローバル変数を使用

    # backend/.env を明示して再読込（既存環境より .env を優先）#backend/.env を読み込む
    env_path = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(dotenv_path=str(env_path), override=True)

    current_api_key = os.getenv("DIFY_API_KEY", "")#この関数内のみ有効な環境変数を取得
    current_api_url = os.getenv("DIFY_API_URL", "")#この関数内のみ有効な環境変数を取得
    current_user = os.getenv("DIFY_USER", "default_user")#この関数内のみ有効な環境変数を取得

    # 環境が変わっていたら作り直し
    if (
        dify_client is None#dify_clientがNoneの場合
        or _cached_env["DIFY_API_KEY"] != current_api_key#キャッシュ用の環境変数と現在の環境変数が異なる場合は
        or _cached_env["DIFY_API_URL"] != current_api_url
        or _cached_env["DIFY_USER"] != current_user
    ):
        _cached_env = {#キャッシュ用の環境変数を更新することで、環境変数が変わったらクライアントを作り直す
            "DIFY_API_KEY": current_api_key,
            "DIFY_API_URL": current_api_url,
            "DIFY_USER": current_user,
        }
        dify_client = DifyClient(#DifyClient変数を更新することで、環境変数が変わったらクライアントを作り直す
            api_key=current_api_key,
            api_url=current_api_url,
            user=current_user,
        )

    return dify_client#DifyClient変数を返す


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


@router.get("/chat/stream")
async def stream_chat(
    query: str = Query(..., description="ユーザーの質問"),
    conversation_id: Optional[str] = Query(None, description="会話ID"),
    request: Request = None,
    db: Session = Depends(get_db),
):
    """
    ストリーミングチャットエンドポイント
    Dify の SSE を行単位でそのまま中継（バッファ回避）
    """
    if not query.strip():
        raise HTTPException(status_code=400, detail="queryパラメータが必要です")

    import httpx

    client = get_dify_client()
    base_url = client.base_url
    api_key = client.api_key
    user = client.user

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    # Dify の inputs にタスクリストCSVを含める（toDatatable形式）
    inputs: dict = {}
    try:
        csv_text = task_list_module.build_task_list_for_chat(db)
        if csv_text:
            inputs["csv"] = csv_text
    except Exception as e:
        logger.warning("[chat/stream] task_list for inputs failed: %s", e)
    payload = {
        "query": query,
        "response_mode": "streaming",
        "user": user,
        # クエリで受け取った conversation_id をそのまま渡す（None 可）
        "conversation_id": conversation_id,
        "inputs": inputs,
    }

    # ストリーミング中のメッセージ本文を蓄積するバッファ
    message_buffer = {"text": ""}

    async def eventgen():
        try:
            logger.debug("[SSE] start proxy to Dify /chat-messages")
            logger.debug("DIFY_API_URL: %s", base_url)
            logger.debug("DIFY_API_KEY: %s", (api_key[:10] + '...') if api_key else 'NOT_SET')
            logger.debug("DIFY_USER: %s", user)
            logger.debug("[SSE] payload conversation_id: %s", payload.get("conversation_id"))
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream("POST", base_url, headers=headers, json=payload) as r:
                    # ブラウザの自動再接続を抑止
                    yield b"retry: 0\n\n"
                    # チャット開始時にタスクリスト（toDatatable形式CSV）を送信
                    try:
                        csv_text = task_list_module.build_task_list_for_chat(db)
                        if csv_text:
                            task_list_payload = json.dumps(
                                {"type": "task_list", "csv": csv_text},
                                ensure_ascii=False,
                            )
                            yield (
                                "event: task_list\n"
                                f"data: {task_list_payload}\n\n"
                            ).encode("utf-8")
                    except Exception as e:
                        logger.warning("[SSE] task_list generation failed: %s", e)
                    if r.status_code != 200:
                        # HTTPエラーでもSSEでエラー内容を返してクライアントに表示させる（接続自体は200で成立）
                        body = await r.aread()
                        err_payload = json.dumps({
                            "type": "error",
                            "status": r.status_code,
                            "detail": body.decode("utf-8", errors="ignore")[:1024]
                        }, ensure_ascii=False)
                        yield f"data: {err_payload}\n\n".encode("utf-8")
                        yield b"\n"
                        return
                    async for line in r.aiter_lines():
                        if line is None:
                            continue
                        # Dify APIからのレスポンスをログ出力
                        if line.startswith("data: "):
                            raw_json = line[6:]
                            # デバッグ用に生データをWARNINGレベルで一部ログ出力（本番でうるさければ削除/レベル変更）
                            logger.warning(f"[SSE-RAW] {raw_json[:300]}...")
                            try:
                                data = json.loads(raw_json)
                                logger.debug(f"[SSE] Dify response data: {data}")
                                if 'message_id' in data:
                                    logger.debug(f"[SSE] Found message_id: {data['message_id']}")

                                event_type = data.get("event")

                                # answer がトークン単位でストリームされてくるので、バッファに蓄積する
                                answer_chunk = data.get("answer")
                                if isinstance(answer_chunk, str):
                                    message_buffer["text"] += answer_chunk

                                # メッセージ終了時に、全文からタスクアクション用JSONを抽出し、
                                # 直接DB更新せずにクライアントへ通知する（フロント側で確認ポップアップ → /chat/actions/task 実行を想定）
                                if event_type == "message_end":
                                    full_answer = message_buffer["text"]
                                    # 次のメッセージに備えてバッファをクリア
                                    message_buffer["text"] = ""

                                    action_list = None

                                    def _parse_action_candidates(raw: str):
                                        """JSON文字列をパースし、単一オブジェクトまたは配列をアクション候補のリストに正規化する。"""
                                        try:
                                            parsed = json.loads(raw)
                                        except json.JSONDecodeError:
                                            return None
                                        if isinstance(parsed, list):
                                            if not parsed:
                                                return None
                                            if all(
                                                isinstance(x, dict) and x.get("action_type") in ("update_task", "create_task", "delete_task")
                                                for x in parsed
                                            ):
                                                return parsed
                                            return None
                                        if isinstance(parsed, dict) and parsed.get("action_type") in ("update_task", "create_task", "delete_task"):
                                            return [parsed]
                                        return None

                                    def _collect_all_code_blocks(text: str):
                                        """テキスト内のすべての ```json ... ``` / ``` ... ``` ブロックの中身をリストで返す。"""
                                        return re.findall(r"```(?:json)?\s*([\s\S]*?)```", text)

                                    # メッセージ内の「すべての」JSONコードブロックを抽出し、各ブロックをパースしてアクションを集約する
                                    all_blocks = _collect_all_code_blocks(full_answer)
                                    if all_blocks:
                                        action_list = []
                                        for block_content in all_blocks:
                                            block_content = block_content.strip()
                                            if not block_content:
                                                continue
                                            candidates = _parse_action_candidates(block_content)
                                            if candidates:
                                                action_list.extend(candidates)
                                        if not action_list:
                                            action_list = None

                                    # フォールバック: コードブロックが1つも見つからなかった場合、メッセージ全体を単一JSONとして扱う
                                    if action_list is None:
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

                                    # アクション候補が1件以上ある場合、通知を送信
                                    if action_list:
                                        # 単一の場合は従来どおり action で、複数の場合は actions で送る（フロントは両方対応）
                                        if len(action_list) == 1:
                                            notification = {
                                                "type": "task_action_candidate",
                                                "action": action_list[0],
                                            }
                                        else:
                                            notification = {
                                                "type": "task_action_candidate",
                                                "actions": action_list,
                                            }
                                        logger.info("[SSE] Detected task action candidate(s): count=%s", len(action_list))
                                        yield (
                                            "event: task_action\n"
                                            f"data: {json.dumps(notification, ensure_ascii=False)}\n\n"
                                        ).encode("utf-8")

                            except json.JSONDecodeError:
                                # SSEの制御メッセージなど、JSONでない行は無視
                                pass
                        # そのまま 1 行 + 改行を転送（SSE の確定は空行）
                        yield (line + "\n").encode("utf-8")
                    # クローズ
                    yield b"\n"
        except HTTPException as he:
            logger.warning("[SSE] HTTPException: %s %s", he.status_code, he.detail)
            err = json.dumps({"type": "error", "status": he.status_code, "detail": he.detail}, ensure_ascii=False)
            yield f"data: {err}\n\n".encode("utf-8")
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





@router.post("/conversation/reset")
async def reset_conversation():
    client = get_dify_client()
    new_conversation_id = client.generate_conversation_id()
    return {"message": "会話がリセットされました", "conversation_id": new_conversation_id}


@router.get("/conversation/new")
async def new_conversation():
    client = get_dify_client()
    new_conversation_id = client.generate_conversation_id()
    return {"conversation_id": new_conversation_id}


@router.get("/conversations")
async def list_conversations(user: str = Query(..., description="ユーザー識別子")):
    """
    会話一覧を取得するエンドポイント（デバッグ用）
    """
    if not user.strip():
        raise HTTPException(status_code=400, detail="userが必要です")
    
    try:
        import httpx
        
        client = get_dify_client()
        base_url = client.base_url
        api_key = client.api_key
        
        # base_urlの構造を確認して適切なURLを構築
        if base_url.endswith('/chat-messages'):
            api_base_url = base_url.replace('/chat-messages', '')
        else:
            api_base_url = base_url
        
        conversations_url = f"{api_base_url}/conversations"
        logger.debug(f"[CONVERSATIONS] URL: {conversations_url}")
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        
        params = {
            "user": user
        }
        
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(conversations_url, headers=headers, params=params)
            
            if response.status_code == 200:
                data = response.json()
                logger.debug(f"[CONVERSATIONS] Successfully fetched {len(data.get('data', []))} conversations")
                return data
            else:
                logger.warning(f"[CONVERSATIONS] Failed to fetch conversations: {response.status_code} - {response.text}")
                raise HTTPException(
                    status_code=response.status_code, 
                    detail=f"Dify API エラー: {response.text}"
                )
                
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[CONVERSATIONS] Exception occurred: {e}")
        raise HTTPException(status_code=500, detail={"message": "会話一覧取得エラー", "error": str(e)})


@router.get("/messages")
async def list_messages(conversation_id: str = Query(..., description="会話ID"), user: str = Query(..., description="ユーザー識別子")):
    """
    メッセージ一覧を取得するエンドポイント（デバッグ用）
    """
    if not conversation_id.strip():
        raise HTTPException(status_code=400, detail="conversation_idが必要です")
    
    if not user.strip():
        raise HTTPException(status_code=400, detail="userが必要です")
    
    try:
        import httpx
        
        client = get_dify_client()
        base_url = client.base_url
        api_key = client.api_key
        
        # base_urlの構造を確認して適切なURLを構築
        if base_url.endswith('/chat-messages'):
            api_base_url = base_url.replace('/chat-messages', '')
        else:
            api_base_url = base_url
        
        messages_url = f"{api_base_url}/messages"
        logger.debug(f"[MESSAGES] URL: {messages_url}")
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        
        params = {
            "conversation_id": conversation_id,
            "user": user
        }
        
        async with httpx.AsyncClient() as http_client:
            response = await http_client.get(messages_url, headers=headers, params=params)
            
            if response.status_code == 200:
                data = response.json()
                logger.debug(f"[MESSAGES] Successfully fetched {len(data.get('data', []))} messages")
                return data
            else:
                logger.warning(f"[MESSAGES] Failed to fetch messages: {response.status_code} - {response.text}")
                raise HTTPException(
                    status_code=response.status_code, 
                    detail=f"Dify API エラー: {response.text}"
                )
                
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[MESSAGES] Exception occurred: {e}")
        raise HTTPException(status_code=500, detail={"message": "メッセージ一覧取得エラー", "error": str(e)})


@router.post("/chat/stop/{task_id}")
async def stop_generation(task_id: str, request: StopRequest):
    """
    ストリーミング生成を停止するエンドポイント
    """
    if not task_id.strip():
        raise HTTPException(status_code=400, detail="task_idが必要です")
    
    if not request.user.strip():
        raise HTTPException(status_code=400, detail="userが必要です")
    
    try:
        import httpx
        
        client = get_dify_client()
        base_url = client.base_url
        api_key = client.api_key
        
        # Dify APIの停止エンドポイントにリクエストを送信
        stop_url = f"{base_url}/chat-messages/{task_id}/stop"
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        
        payload = {
            "user": request.user
        }
        
        logger.debug(f"[STOP] Sending stop request to Dify: {stop_url}")
        logger.debug(f"[STOP] Payload: {payload}")
        
        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(stop_url, headers=headers, json=payload)
            
            if response.status_code == 200:
                logger.debug(f"[STOP] Successfully stopped generation for task_id: {task_id}")
                return {"result": "success", "message": "生成が停止されました"}
            else:
                logger.warning(f"[STOP] Failed to stop generation: {response.status_code} - {response.text}")
                raise HTTPException(
                    status_code=response.status_code, 
                    detail=f"Dify API エラー: {response.text}"
                )
                
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[STOP] Exception occurred: {e}")
        raise HTTPException(status_code=500, detail={"message": "停止エラー", "error": str(e)})


@router.get("/suggestions/{message_id}")
async def get_suggested_questions(message_id: str, user: str = Query(..., description="ユーザー識別子")):
    """
    推奨質問を取得するエンドポイント（リトライ機能付き）
    """
    if not message_id.strip():
        raise HTTPException(status_code=400, detail="message_idが必要です")
    
    if not user.strip():
        raise HTTPException(status_code=400, detail="userが必要です")
    
    import asyncio
    import httpx
    
    client = get_dify_client()
    base_url = client.base_url
    api_key = client.api_key
    
    # base_urlの構造を確認して適切なURLを構築
    logger.debug(f"[SUGGESTIONS] Original base_url: {base_url}")
    
    # base_urlが /chat-messages で終わっている場合は削除
    if base_url.endswith('/chat-messages'):
        api_base_url = base_url.replace('/chat-messages', '')
    else:
        api_base_url = base_url
    
    suggestions_url = f"{api_base_url}/messages/{message_id}/suggested"
    logger.debug(f"[SUGGESTIONS] Constructed suggestions_url: {suggestions_url}")
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    
    params = {
        "user": user
    }
    
    # リトライ設定（404のみ）
    max_retries = 3
    retry_delays = [0.4, 0.8, 1.6]  # 指数バックオフ
    
    for attempt in range(max_retries):
        try:
            
            async with httpx.AsyncClient() as http_client:
                response = await http_client.get(suggestions_url, headers=headers, params=params)
                
                if response.status_code == 200:
                    data = response.json()
                    # レスポンス構造のゆらぎに対応（Dify APIの実際の形に合わせる）
                    suggestions = []
                    if isinstance(data.get("data"), list):
                        # Dify APIの標準形: {result: "success", data: [...]}
                        suggestions = data.get("data", [])
                    elif isinstance(data.get("suggested_questions"), list):
                        suggestions = data.get("suggested_questions", [])
                    elif isinstance(data.get("suggestions"), list):
                        suggestions = data.get("suggestions", [])
                    elif isinstance(data.get("suggestions", {}).get("items"), list):
                        suggestions = data.get("suggestions", {}).get("items", [])
                    
                    # 常に同じ形で返す
                    return {"suggestions": suggestions}
                elif response.status_code == 404:
                    if attempt < max_retries - 1:
                        delay = retry_delays[attempt]
                        await asyncio.sleep(delay)
                        continue
                    else:
                        # デモ用の推奨質問を返す
                        demo_suggestions = [
                            "今週のタスクの進捗状況を教えて",
                            "来週の予定を確認したい",
                            "期限が近いタスクはありますか？",
                            "プロジェクトの状況をまとめて",
                            "今月の完了タスクを教えて"
                        ]
                        return {"suggestions": demo_suggestions}
                else:
                    logger.warning(f"[SUGGESTIONS] Failed to fetch suggestions: {response.status_code} - {response.text}")
                    logger.warning(f"[SUGGESTIONS] Request URL: {suggestions_url}")
                    logger.warning(f"[SUGGESTIONS] Request headers: {headers}")
                    logger.warning(f"[SUGGESTIONS] Request params: {params}")
                    raise HTTPException(
                        status_code=response.status_code, 
                        detail=f"Dify API エラー: {response.text}"
                    )
                    
        except HTTPException:
            raise
        except Exception as e:
            if attempt < max_retries - 1:
                delay = retry_delays[attempt]
                await asyncio.sleep(delay)
                continue
            else:
                raise HTTPException(status_code=500, detail={"message": "推奨質問取得エラー", "error": str(e)})
    
    # ここには到達しないはずだが、念のため
    raise HTTPException(status_code=500, detail={"message": "予期しないエラー"})


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


