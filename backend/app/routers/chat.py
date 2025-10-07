"""
チャット関連のAPIエンドポイント (backend/app 用)
別のアプリの実装を参考に統合
"""
import os
from typing import Optional

from fastapi import APIRouter, Query, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from pathlib import Path
from dotenv import load_dotenv
import json

from ..dify_client import DifyClient
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

# DifyClientの初期化（main.pyでload_dotenv()後に初期化）
"""Dify クライアントのシングルトン管理。環境変数が変わったら差し替える。"""
dify_client = None
_cached_env: dict[str, str] = {"DIFY_API_KEY": "", "DIFY_API_URL": "", "DIFY_USER": ""}

def get_dify_client():
    """常に backend/.env を再読込し、変更があればクライアントを作り直す。"""
    global dify_client, _cached_env

    # backend/.env を明示して再読込（既存環境より .env を優先）
    env_path = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(dotenv_path=str(env_path), override=True)

    current_api_key = os.getenv("DIFY_API_KEY", "")
    current_api_url = os.getenv("DIFY_API_URL", "")
    current_user = os.getenv("DIFY_USER", "default_user")

    # 環境が変わっていたら作り直し
    if (
        dify_client is None
        or _cached_env["DIFY_API_KEY"] != current_api_key
        or _cached_env["DIFY_API_URL"] != current_api_url
        or _cached_env["DIFY_USER"] != current_user
    ):
        _cached_env = {
            "DIFY_API_KEY": current_api_key,
            "DIFY_API_URL": current_api_url,
            "DIFY_USER": current_user,
        }
        dify_client = DifyClient(
            api_key=current_api_key,
            api_url=current_api_url,
            user=current_user,
        )

    return dify_client


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
    payload = {
        "query": query,
        "response_mode": "streaming",
        "user": user,
        # クエリで受け取った conversation_id をそのまま渡す（None 可）
        "conversation_id": conversation_id,
        "inputs": {},
    }

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
                            try:
                                data = json.loads(line[6:])
                                logger.debug(f"[SSE] Dify response data: {data}")
                                if 'message_id' in data:
                                    logger.debug(f"[SSE] Found message_id: {data['message_id']}")
                            except json.JSONDecodeError:
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


@router.post("/chat", response_model=ChatResponse)
async def block_chat(request: ChatRequest):
    """
    ブロッキングチャットエンドポイント
    一度に完全な回答を返す
    """
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="queryが必要です")
    
    try:
        # Dify APIからブロッキングレスポンスを取得
        client = get_dify_client()
        response = await client.block_chat(request.query, request.conversation_id)
        
        return ChatResponse(
            answer=response.get("answer", ""),
            conversation_id=response.get("conversation_id", request.conversation_id),
            message_id=response.get("message_id", "")
        )
        
    except HTTPException as he:
        # DifyClient からの詳細エラーをそのまま返却
        raise HTTPException(status_code=he.status_code, detail=he.detail)
    except Exception as e:
        raise HTTPException(status_code=500, detail={"message": "チャットエラー", "error": str(e)})


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


