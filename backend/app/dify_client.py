"""
Dify API クライアント
ストリーミングとブロッキングの両方に対応（backend 用）
"""
import json
import uuid
from typing import AsyncGenerator, Optional, Dict, Any

import httpx
from fastapi import HTTPException


class DifyClient:
    """Dify API クライアントクラス"""

    def __init__(self, api_key: str, api_url: str, user: str):
        self.api_key = api_key
        self.api_url = api_url.rstrip('/')
        self.user = user
        self.base_url = f"{self.api_url}/chat-messages"
        # タイムアウトをやや長めに設定
        self.timeout = httpx.Timeout(
            connect=600.0,
            read=600.0,
            write=600.0,
            pool=600.0,
        )

    async def _make_request(
        self,
        query: str,
        conversation_id: Optional[str] = None,
        response_mode: str = "streaming",
    ) -> httpx.Response:
        """Dify APIへのリクエストを作成"""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "query": query,
            "response_mode": response_mode,
            "user": self.user,
            "inputs": {},
            # 受け取った conversation_id をそのまま渡す（None 可）
            "conversation_id": conversation_id,
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(self.base_url, json=payload, headers=headers)
                if response.status_code >= 400:
                    # エラー時は本文を読み出しログ出力の上で返却（呼び出し側で処理）
                    _ = await response.aread() if hasattr(response, 'aread') else response.content
                return response
        except Exception as exc:
            raise HTTPException(status_code=500, detail={"message": f"Dify request error: {exc}"})

    async def stream_chat(
        self,
        query: str,
        conversation_id: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """ストリーミングチャット (SSE)"""
        try:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "query": query,
                "response_mode": "streaming",
                "user": self.user,
                "inputs": {},
                # 受け取った conversation_id をそのまま渡す（None 可）
                "conversation_id": conversation_id,
            }
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", self.base_url, headers=headers, json=payload) as response:
                    if response.status_code != 200:
                        try:
                            err_text = await response.aread()
                            err_text = err_text.decode("utf-8", errors="ignore")
                        except Exception:
                            err_text = response.text
                        err_detail = {"message": "Dify streaming API error", "status": response.status_code}
                        try:
                            err_json = json.loads(err_text)
                            if isinstance(err_json, dict):
                                err_detail.update({
                                    "api_message": err_json.get("message"),
                                    "api_code": err_json.get("code"),
                                })
                        except Exception:
                            pass
                        raise HTTPException(status_code=response.status_code, detail={**err_detail, "body": err_text[:1024]})

                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        if line.startswith("data: "):
                            data = line[6:]
                            if data.strip() == "[DONE]":
                                break
                            try:
                                json_data = json.loads(data)
                                yield json_data
                            except json.JSONDecodeError:
                                continue
        except httpx.TimeoutException:
            raise HTTPException(status_code=408, detail={"message": "Request timeout (streaming)", "where": "DifyClient.stream_chat"})
        except Exception as e:
            raise HTTPException(status_code=500, detail={"message": "Streaming error", "error": str(e)})

    async def block_chat(
        self,
        query: str,
        conversation_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """ブロッキングチャット"""
        try:
            response = await self._make_request(
                query=query,
                conversation_id=conversation_id,
                response_mode="blocking",
            )

            if response.status_code != 200:
                try:
                    err_text = await response.aread()
                    err_text = err_text.decode("utf-8", errors="ignore")
                except Exception:
                    err_text = response.text
                mapped_message = None
                api_code = None
                try:
                    err_json = json.loads(err_text)
                    if isinstance(err_json, dict):
                        api_message = (err_json.get("message") or "").lower()
                        api_code = err_json.get("code") or "unknown"
                        if "access token" in api_message or "unauthorized" in api_message:
                            mapped_message = "認証エラーが発生しました。APIキー設定をご確認ください。"
                        elif "ollama" in api_message:
                            mapped_message = "Ollamaサーバーに接続できません。サーバー状態を確認してください。"
                        elif "model" in api_message and "disabled" in api_message:
                            mapped_message = "指定されたモデルが無効化されています。Difyのモデル設定を確認してください。"
                        elif "timeout" in api_message:
                            mapped_message = "リクエストがタイムアウトしました。サーバーの負荷やタイムアウト設定をご確認ください。"
                except Exception:
                    pass
                raise HTTPException(
                    status_code=response.status_code,
                    detail={
                        "message": mapped_message or "Dify blocking API error",
                        "status": response.status_code,
                        "code": api_code,
                        "body": err_text[:2048],
                    },
                )

            return response.json()
        except httpx.TimeoutException:
            raise HTTPException(status_code=408, detail={"message": "Request timeout (blocking)", "where": "DifyClient.block_chat"})
        except Exception as e:
            raise HTTPException(status_code=500, detail={"message": "Blocking error", "error": str(e)})

    def generate_conversation_id(self) -> str:
        """新しい会話IDを生成"""
        return str(uuid.uuid4())


