import os
import datetime
from typing import Annotated, Optional
from pydantic import Field
import contextvars

_auth_scope: contextvars.ContextVar[str] = contextvars.ContextVar('auth_scope', default='')

from fastmcp import FastMCP
from sqlalchemy import func

from .database import SessionLocal
from . import models, schemas
import httpx
import pathlib

_INTERNAL_BASE = "http://localhost:8001"


def _write_headers(actor_id: int) -> dict:
    """CASPER_WRITE_TOKEN + actor_id relay ヘッダを返す。"""
    token = os.getenv("CASPER_WRITE_TOKEN", "")
    return {
        "Authorization": f"Bearer {token}",
        "X-Actor-User-Id": str(actor_id),
    }


def _actor_headers(actor_id: int) -> dict:
    """CLI_BYPASS_TOKEN + actor_id relay ヘッダ (DM エンドポイント用)。"""
    bypass = os.getenv("CLI_BYPASS_TOKEN", "")
    return {
        "Authorization": f"Bearer {bypass}",
        "X-Actor-User-Id": str(actor_id),
    }


mcp = FastMCP("calendar-tools")


def _require_write_scope() -> dict | None:
    """write/DM ツール用: write スコープ以外は明示エラーを返す。"""
    if _auth_scope.get("") != "write":
        return {
            "isError": True,
            "error": "このツールの実行には CASPER_WRITE_TOKEN が必要です (SCORE_READONLY_TOKEN のみでは使用不可)",
        }
    return None


@mcp.tool()
def get_projects(limit: int = 100, offset: int = 0) -> dict:
    """Get all projects from the calendar."""
    db = SessionLocal()
    try:
        q = db.query(models.Project)
        total = q.count()
        rows = q.offset(offset).limit(min(limit, 500)).all()
        items = [schemas.ReadonlyProject.from_orm(r).model_dump(mode="json") for r in rows]
        return {"total": total, "limit": limit, "offset": offset, "items": items}
    finally:
        db.close()


@mcp.tool()
def get_today_tasks(project_id: Optional[int] = None, shot_id: Optional[int] = None) -> dict:
    """Get tasks due today. Applies due_date filter at the tool layer (readonly EP has no due_date query)."""
    db = SessionLocal()
    try:
        q = db.query(models.Task)
        if project_id is not None:
            q = q.filter(models.Task.project_id == project_id)
        if shot_id is not None:
            q = q.filter(models.Task.shot_id == shot_id)
        today_str = datetime.date.today().isoformat()
        q = q.filter(func.date(models.Task.due_date) == today_str)
        rows = q.limit(500).all()
        items = [schemas.ReadonlyTask.from_orm(r).model_dump(mode="json") for r in rows]
        return {"total": len(items), "items": items}
    finally:
        db.close()


@mcp.tool()
def upload_asset(
    file_path: Annotated[str, Field(description="サーバローカルの絶対パス (例: /data/render/shot001.png)。呼出前に Casper 確認ゲートで承認済であること。")],
    actor_id: Annotated[int, Field(description="操作主体のユーザーID (必須)。CASPER_WRITE_TOKEN で認証中継される。")],
    shot_id: Annotated[Optional[int], Field(description="紐付けるショットID (任意)")] = None,
    task_id: Annotated[Optional[int], Field(description="紐付けるタスクID (任意)")] = None,
    version: Annotated[Optional[str], Field(description="バージョン文字列 (任意) 例: v1.0")] = None,
) -> dict:
    """アセット(画像・動画等)をサーバにアップロード。
    呼出は Casper 確認ゲート通過後のみ。file_path はサーバローカル絶対パス。"""
    err = _require_write_scope()
    if err:
        return err
    p = pathlib.Path(file_path)
    if not p.exists():
        return {"error": f"file not found: {file_path}"}
    form: dict = {}
    if shot_id is not None:
        form["shot_id"] = str(shot_id)
    if task_id is not None:
        form["task_id"] = str(task_id)
    if version is not None:
        form["version"] = version
    with open(p, "rb") as fh:
        files = {"file": (p.name, fh, "application/octet-stream")}
        try:
            resp = httpx.post(
                f"{_INTERNAL_BASE}/api/assets",
                files=files,
                data=form,
                headers=_write_headers(actor_id),
                timeout=30.0,
            )
        except httpx.RequestError as exc:
            return {"error": f"request failed: {exc}"}
    if not resp.is_success:
        return {"error": resp.text, "status_code": resp.status_code}
    return resp.json()


@mcp.tool()
def add_reference_material(
    shot_id: Annotated[int, Field(description="紐付けるショットID (必須)")],
    title: Annotated[str, Field(description="参考資料のタイトル (必須) 例: 'キャラクター参考_v2'")],
    media_type: Annotated[str, Field(description="メディア種別 (必須) 例: image, video, document, url")],
    file_path: Annotated[str, Field(description="ファイルパスまたはURL (必須)")],
    actor_id: Annotated[int, Field(description="操作主体のユーザーID (必須)。CASPER_WRITE_TOKEN で認証中継される。")],
    task_id: Annotated[Optional[int], Field(description="追加で紐付けるタスクID (任意)")] = None,
    created_by: Annotated[Optional[int], Field(description="作成者ユーザーID。省略時は actor_id と同値として扱われる (任意)")] = None,
) -> dict:
    """参考資料(リファレンス)をショット/タスクに紐付けて登録。
    呼出は Casper 確認ゲート通過後のみ。"""
    err = _require_write_scope()
    if err:
        return err
    payload: dict = {
        "shot_id": shot_id,
        "title": title,
        "media_type": media_type,
        "file_path": file_path,
    }
    if task_id is not None:
        payload["task_id"] = task_id
    if created_by is not None:
        payload["created_by"] = created_by
    try:
        resp = httpx.post(
            f"{_INTERNAL_BASE}/api/reference_materials",
            json=payload,
            headers=_write_headers(actor_id),
            timeout=15.0,
        )
    except httpx.RequestError as exc:
        return {"error": f"request failed: {exc}"}
    if not resp.is_success:
        return {"error": resp.text, "status_code": resp.status_code}
    return resp.json()


@mcp.tool()
def get_messages(
    actor_id: Annotated[int, Field(description="読み取り主体のユーザーID (必須)。参加スレッドのみ閲覧可 (サーバ側強制)。")],
    thread_id: Annotated[Optional[int], Field(description="スレッドID (任意)。指定時: そのスレッドのメッセージ一覧を返す。")] = None,
    peer_user_id: Annotated[Optional[int], Field(description="相手のユーザーID (任意)。指定時: actor_id との 1対1 スレッドのメッセージを返す。")] = None,
    limit: Annotated[int, Field(description="取得件数上限 (任意・デフォルト50)")] = 50,
) -> dict:
    """actor_id ユーザーの DM スレッド一覧、またはスレッドのメッセージ一覧を取得。
    thread_id 指定 → スレッドのメッセージ / peer_user_id 指定 → 1対1メッセージ /
    両方未指定 → スレッド一覧。"""
    err = _require_write_scope()
    if err:
        return err
    headers = _actor_headers(actor_id)
    try:
        if thread_id is not None:
            resp = httpx.get(
                f"{_INTERNAL_BASE}/api/dm/threads/{thread_id}/messages",
                headers=headers,
                timeout=15.0,
            )
        elif peer_user_id is not None:
            tid = min(actor_id, peer_user_id) * 10000 + max(actor_id, peer_user_id)
            resp = httpx.get(
                f"{_INTERNAL_BASE}/api/dm/threads/{tid}/messages",
                headers=headers,
                timeout=15.0,
            )
        else:
            resp = httpx.get(
                f"{_INTERNAL_BASE}/api/me/dm/threads",
                headers=headers,
                timeout=15.0,
            )
    except httpx.RequestError as exc:
        return {"error": f"request failed: {exc}"}
    if not resp.is_success:
        return {"error": resp.text, "status_code": resp.status_code}
    return {"messages": resp.json()} if (thread_id is not None or peer_user_id is not None) else {"threads": resp.json()}


@mcp.tool()
def send_message(
    actor_id: Annotated[int, Field(description="送信主体のユーザーID (必須)。CLI_BYPASS_TOKEN で actor として中継送信される。")],
    to_user_id: Annotated[int, Field(description="送信先のユーザーID (必須)")],
    body: Annotated[str, Field(description="DM 本文 (必須)。DM 本文をログ・レポートに残すな (プライバシー保護)。")],
    context_json: Annotated[Optional[dict], Field(description="追加コンテキスト情報 (任意) 例: {\"task_id\": 42, \"shot_code\": \"CUT_001\"}")] = None,
) -> dict:
    """actor_id ユーザーとして to_user_id へ DM を送信する。
    必ずユーザー承認後に呼び出すこと (確認ゲートは Casper 側で担保)。
    DM 本文・個人情報をログ・レポートに残すな。"""
    err = _require_write_scope()
    if err:
        return err
    payload: dict = {
        "recipient_id": to_user_id,
        "body": body,
    }
    if context_json is not None:
        payload["context_json"] = context_json
    try:
        resp = httpx.post(
            f"{_INTERNAL_BASE}/api/dm",
            json=payload,
            headers=_actor_headers(actor_id),
            timeout=15.0,
        )
    except httpx.RequestError as exc:
        return {"error": f"request failed: {exc}"}
    if not resp.is_success:
        return {"error": resp.text, "status_code": resp.status_code}
    result = resp.json()
    return {
        "id": result.get("id"),
        "thread_id": result.get("thread_id"),
        "sender_id": result.get("sender_id"),
        "recipient_id": result.get("recipient_id"),
        "created_at": result.get("created_at"),
    }


class _MCPAuthMiddleware:
    """Pure ASGI middleware: validates Bearer token against SCORE_READONLY_TOKEN."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = {k.lower(): v for k, v in scope.get("headers", [])}
            auth = headers.get(b"authorization", b"").decode("utf-8", errors="ignore")
            bearer = auth[7:].strip() if auth.startswith("Bearer ") else ""

            read_token = (os.getenv("SCORE_READONLY_TOKEN") or "").strip()
            write_token = (os.getenv("CASPER_WRITE_TOKEN") or "").strip()

            if not read_token:
                body = b'{"error":"SCORE_READONLY_TOKEN not configured"}'
                await send({
                    "type": "http.response.start",
                    "status": 500,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                })
                await send({"type": "http.response.body", "body": body, "more_body": False})
                return

            if bearer == read_token:
                _auth_scope.set("read")
            elif write_token and bearer == write_token:
                _auth_scope.set("write")
            else:
                body = b'{"error":"Unauthorized"}'
                await send({
                    "type": "http.response.start",
                    "status": 401,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                })
                await send({"type": "http.response.body", "body": body, "more_body": False})
                return

        await self.app(scope, receive, send)


mcp_http = mcp.http_app(path="/")
