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


