import os
import datetime
from typing import Annotated, Optional
from pydantic import Field
import contextvars

_auth_scope: contextvars.ContextVar[str] = contextvars.ContextVar('auth_scope', default='')

from fastmcp import FastMCP
from sqlalchemy import func

from .database import SessionLocal
from . import models, schemas, crud
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
def get_projects(limit: int = 100, offset: int = 0, actor_id: Optional[int] = None) -> dict:
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
def get_users(limit: int = 100, offset: int = 0, actor_id: Optional[int] = None) -> dict:
    """Get users list for roster. Returns uid, username, display_name only."""
    db = SessionLocal()
    try:
        q = db.query(models.User).filter(models.User.is_active == True)
        total = q.count()
        rows = q.offset(offset).limit(min(limit, 500)).all()
        items = [
            {
                "uid": u.id,
                "username": u.username,
                "display_name": u.full_name or u.name or None,
            }
            for u in rows
        ]
        return {"total": total, "limit": limit, "offset": offset, "items": items}
    finally:
        db.close()


@mcp.tool()
def get_today_tasks(
    project_id: Optional[int] = None,
    shot_id: Optional[int] = None,
    actor_id: Optional[int] = None,
) -> dict:
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
def mark_read(
    actor_id: Annotated[int, Field(description="既読化する主体のユーザーID (必須)。スレッド参加者のみ可 (サーバ側強制)。")],
    thread_id: Annotated[int, Field(description="既読化するスレッドID (必須)。")],
) -> dict:
    """actor_id ユーザーとして thread_id のスレッドを既読化する。
    参加者以外のスレッドは既読化不可 (サーバ側 403 で強制)。"""
    err = _require_write_scope()
    if err:
        return err
    try:
        resp = httpx.post(
            f"{_INTERNAL_BASE}/api/dm/threads/{thread_id}/read",
            headers=_actor_headers(actor_id),
            timeout=15.0,
        )
    except httpx.RequestError as exc:
        return {"error": f"request failed: {exc}"}
    if not resp.is_success:
        return {"error": resp.text, "status_code": resp.status_code}
    return {"ok": True}


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


_VALID_TASK_TYPES = {
    "animation", "layout", "comp", "fx", "lighting", "asset",
    "programming", "design", "testing", "shoot", "gs", "report", "other",
}


@mcp.tool()
async def create_project(
    actor_id: int,
    name: str,
    description: str = "",
    start_date: str = "",
    end_date: str = "",
    client_ref: str = "",
) -> dict:
    """新規プロジェクトを作成する。
    client_ref が指定されかつ同一 client_ref の既存PJがあれば新規作成せず既存を返す(冪等)。
    client_ref 未指定かつ同名PJが既存の場合も既存を返す(重複抑止)。
    管理者権限が必要。"""
    err = _require_write_scope()
    if err:
        return err

    # --- dedup guard ---
    # 1. client_ref指定あり → REST GET で全件取得し client_ref 照合
    if client_ref:
        try:
            chk = httpx.get(
                f"{_INTERNAL_BASE}/api/projects",
                headers=_actor_headers(actor_id),
                timeout=15.0,
            )
            if chk.is_success:
                for p in chk.json():
                    if p.get("client_ref") == client_ref:
                        return {"ok": True, "project": {
                            "id": p["id"], "name": p["name"],
                            "code": p.get("code"), "client_ref": p.get("client_ref"),
                        }, "reused": True}
        except httpx.RequestError:
            pass  # dedup失敗でも作成を試みる

    # 2. client_ref未指定 → 同名PJ照合
    else:
        try:
            chk = httpx.get(
                f"{_INTERNAL_BASE}/api/projects",
                headers=_actor_headers(actor_id),
                timeout=15.0,
            )
            if chk.is_success:
                for p in chk.json():
                    if p.get("name") == name:
                        return {"ok": True, "project": {
                            "id": p["id"], "name": p["name"],
                            "code": p.get("code"), "client_ref": p.get("client_ref"),
                        }, "reused": True}
        except httpx.RequestError:
            pass  # dedup失敗でも作成を試みる
    # --- end dedup guard ---

    payload = {
        "name": name,
        "description": description,
        "start_date": start_date or None,
        "end_date": end_date or None,
        "client_ref": client_ref or None,
    }
    try:
        resp = httpx.post(
            f"{_INTERNAL_BASE}/api/projects",
            json=payload,
            headers=_actor_headers(actor_id),
            timeout=15.0,
        )
    except httpx.RequestError as exc:
        return {"error": str(exc)}
    if not resp.is_success:
        return {"error": f"REST {resp.status_code}: {resp.text}"}
    data = resp.json()
    return {"ok": True, "project": {
        "id": data.get("id"), "name": data.get("name"),
        "code": data.get("code"), "client_ref": data.get("client_ref"),
    }}


@mcp.tool()
async def delete_project(
    actor_id: int,
    project_id: int,
) -> dict:
    """プロジェクトを削除する(関連タスク・ショット・イベント等も物理削除)。
    管理者権限が必要(非admin actor_idでは403を返す)。
    ★ 物理削除: shots/tasks/events/履歴も全てカスケード削除される。元に戻せない。"""
    err = _require_write_scope()
    if err:
        return err
    try:
        resp = httpx.delete(
            f"{_INTERNAL_BASE}/api/projects/{project_id}",
            headers=_actor_headers(actor_id),
            timeout=15.0,
        )
    except httpx.RequestError as exc:
        return {"error": str(exc)}
    if resp.status_code == 204:
        return {"ok": True, "deleted_project_id": project_id}
    if not resp.is_success:
        return {"error": f"REST {resp.status_code}: {resp.text}"}
    return {"ok": True, "deleted_project_id": project_id}


@mcp.tool()
async def update_project(
    actor_id: int,
    project_id: int,
    name: str = "",
    description: str = "",
    start_date: str = "",
    end_date: str = "",
    display_status: str = "",
) -> dict:
    """プロジェクト情報を部分更新する。指定したフィールドのみ更新(未指定フィールドは不変)。
    管理者権限が必要。display_status は online/offline/archived のみ有効。"""
    err = _require_write_scope()
    if err:
        return err
    payload: dict = {}
    if name:
        payload["name"] = name
    if description:
        payload["description"] = description
    if start_date:
        payload["start_date"] = start_date
    if end_date:
        payload["end_date"] = end_date
    if display_status:
        if display_status not in ("online", "offline", "archived"):
            return {"error": f"display_status は online/offline/archived のみ有効。指定値: {display_status}"}
        payload["display_status"] = display_status
    if not payload:
        return {"error": "更新するフィールドが指定されていません。name/description/start_date/end_date/display_status のいずれかを指定してください。"}
    try:
        resp = httpx.put(
            f"{_INTERNAL_BASE}/api/projects/{project_id}",
            json=payload,
            headers=_actor_headers(actor_id),
            timeout=15.0,
        )
    except httpx.RequestError as exc:
        return {"error": str(exc)}
    if not resp.is_success:
        return {"error": f"REST {resp.status_code}: {resp.text}"}
    data = resp.json()
    return {"ok": True, "project": {
        "id": data.get("id"), "name": data.get("name"),
        "display_status": data.get("display_status"),
        "client_ref": data.get("client_ref"),
    }}


@mcp.tool()
async def import_shots(
    actor_id: int,
    project_id: int,
    shots: list,
) -> dict:
    """複数ショットを project_id に一括登録する。
    shots は [{code: str, name: str, note: str}] 形式。
    部分失敗ポリシー: 成功分はコミット、失敗分は failed リストに記録する (ロールバックしない)。"""
    err = _require_write_scope()
    if err:
        return err
    created = []
    failed = []
    for i, shot in enumerate(shots):
        payload = {
            "project_id": project_id,
            "seq_code": shot.get("code", ""),
            "shot_code": shot.get("name", shot.get("code", "")),
            "description": shot.get("note", ""),
        }
        try:
            resp = httpx.post(
                f"{_INTERNAL_BASE}/api/shots",
                json=payload,
                headers=_actor_headers(actor_id),
                timeout=15.0,
            )
        except httpx.RequestError as exc:
            failed.append({"index": i, "code": shot.get("code", ""), "error": str(exc)})
            continue
        if not resp.is_success:
            failed.append({"index": i, "code": shot.get("code", ""), "error": f"REST {resp.status_code}: {resp.text}"})
        else:
            data = resp.json()
            created.append({"index": i, "code": shot.get("code", ""), "id": data.get("id")})
    return {"created": created, "failed": failed}


@mcp.tool()
async def bulk_create_tasks(
    actor_id: int,
    tasks: list,
) -> dict:
    """複数タスクを一括作成する。
    tasks は [{shot: str, type: str, assignee: str, due: str, estimate: str, note: str}] 形式。
    assignee は username で指定 (内部で user_id に自動解決)。shot は shot_code で指定 (内部で shot_id に自動解決)。
    type は animation/layout/comp/fx/lighting/asset/programming/design/testing/shoot/gs/report/other のいずれか。
    部分失敗ポリシー: 成功分はコミット、失敗分は failed リストに記録する (ロールバックしない)。"""
    err = _require_write_scope()
    if err:
        return err

    # users 一覧取得 → username→id マップ構築
    username_to_id: dict = {}
    users_warning = None
    try:
        users_resp = httpx.get(
            f"{_INTERNAL_BASE}/api/users",
            headers=_actor_headers(actor_id),
            timeout=15.0,
        )
        if users_resp.is_success:
            for u in users_resp.json():
                uname = u.get("username") or u.get("name")
                if uname and u.get("id"):
                    username_to_id[uname] = u["id"]
        else:
            users_warning = f"users fetch failed: REST {users_resp.status_code}"
    except httpx.RequestError as exc:
        users_warning = f"users fetch error: {exc}"

    # shots 一覧取得 → shot_code→id マップ構築
    shot_code_to_id: dict = {}
    try:
        shots_resp = httpx.get(
            f"{_INTERNAL_BASE}/api/shots",
            headers=_actor_headers(actor_id),
            timeout=15.0,
        )
        if shots_resp.is_success:
            for s in shots_resp.json():
                code = s.get("shot_code")
                if code and s.get("id"):
                    shot_code_to_id[code] = s["id"]
    except httpx.RequestError:
        pass

    created = []
    failed = []
    for i, task in enumerate(tasks):
        task_type = task.get("type", "")
        if task_type not in _VALID_TASK_TYPES:
            failed.append({"index": i, "reason": f"invalid type: {task_type!r}"})
            continue

        # assignee 解決
        resolved_user_id = None
        assignee = task.get("assignee", "")
        if assignee:
            resolved_user_id = username_to_id.get(assignee)
            if resolved_user_id is None:
                reason = "assignee not found" if not users_warning else f"assignee not found (warning: {users_warning})"
                failed.append({"index": i, "reason": reason})
                continue

        # shot 解決
        resolved_shot_id = None
        shot_code = task.get("shot", "")
        if shot_code:
            resolved_shot_id = shot_code_to_id.get(shot_code)
            if resolved_shot_id is None:
                failed.append({"index": i, "reason": f"shot not found: {shot_code!r}"})
                continue

        payload = {
            "name": task.get("note") or f"{task_type} task",
            "type": task_type,
            "assigned_to": resolved_user_id,
            "due_date": task.get("due") or None,
            "shot_id": resolved_shot_id,
        }
        try:
            resp = httpx.post(
                f"{_INTERNAL_BASE}/api/tasks",
                json=payload,
                headers=_actor_headers(actor_id),
                timeout=15.0,
            )
        except httpx.RequestError as exc:
            failed.append({"index": i, "reason": str(exc)})
            continue
        if not resp.is_success:
            failed.append({"index": i, "reason": f"REST {resp.status_code}: {resp.text}"})
        else:
            data = resp.json()
            created.append({"index": i, "task_id": data.get("id"), "name": data.get("name")})
    return {"created": created, "failed": failed}


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


@mcp.tool()
def get_events(
    actor_id: Annotated[int, Field(description="呼出主体のユーザーID (必須)。CASPER_WRITE_TOKEN で認証。")],
    since: Annotated[int, Field(description="このseq以降のイベントを返す (カーソル。初回は0)。")] = 0,
    limit: Annotated[int, Field(description="取得件数上限 (デフォルト100・最大500)。")] = 100,
) -> dict:
    """構造化イベントログの増分取得。since=直前の最大seq、limit件を返す。
    各eventに seq/event_id/system/ts/actor_uid/action/target_type/target_id/detail/level を含む。
    認可: CASPER_WRITE_TOKEN を持つ write スコープ呼出のみ (DB直読み)。"""
    err = _require_write_scope()
    if err:
        return err
    db = SessionLocal()
    try:
        return crud.get_audit_events(db, since=since, limit=min(limit, 500))
    finally:
        db.close()


@mcp.tool()
async def update_task(
    actor_id: int,
    task_id: int,
    assignee: str = "",
    due: str = "",
    status: str = "",
    type: str = "",
) -> dict:
    """タスクを部分更新する (担当付け替え/due/status/type)。
    actor_id 本人が当該 task の担当者か admin でなければ 403 エラー。
    assignee は username で指定 (内部で uid に解決)。
    type は animation/layout/comp/fx/lighting/asset/programming/design/testing/shoot/gs/report/other のいずれか。
    status は todo/in-progress/review/approved/completed/delayed/retake のいずれか。
    指定した項目のみ更新 (未指定は変更しない)。
    """
    err = _require_write_scope()
    if err:
        return err

    # ---- 権限チェック (DBで直接照会) ----
    db = SessionLocal()
    try:
        actor = db.query(models.User).filter(
            models.User.id == actor_id, models.User.is_active == True
        ).first()
        if not actor:
            return {"error": "403", "detail": f"actor_id={actor_id} が見つかりません"}

        db_task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if not db_task:
            return {"error": "404", "detail": f"task_id={task_id} が見つかりません"}

        is_admin = (actor.role == "admin")
        is_assignee = (db_task.assigned_to == actor_id)
        if not is_admin and not is_assignee:
            return {
                "error": "403",
                "detail": "このタスクを更新する権限がありません (担当者または管理者のみ可)",
            }
    finally:
        db.close()

    # ---- type enum 検証 ----
    if type and type not in _VALID_TASK_TYPES:
        return {
            "error": "invalid_type",
            "detail": f"type='{type}' は無効。有効値: {sorted(_VALID_TASK_TYPES)}",
        }

    # ---- status enum 検証 ----
    _VALID_STATUSES = {"todo", "in-progress", "review", "approved", "completed", "delayed", "retake"}
    if status and status not in _VALID_STATUSES:
        return {
            "error": "invalid_status",
            "detail": f"status='{status}' は無効。有効値: {sorted(_VALID_STATUSES)}",
        }

    # ---- assignee 解決 (username → uid) ----
    resolved_assignee_id = None
    if assignee:
        try:
            uresp = httpx.get(f"{_INTERNAL_BASE}/api/users", headers=_actor_headers(actor_id), timeout=10.0)
        except httpx.RequestError as exc:
            return {"error": f"users fetch failed: {exc}"}
        if not uresp.is_success:
            return {"error": "users fetch failed", "status_code": uresp.status_code}
        username_to_id = {}
        for u in (uresp.json() or []):
            uname = u.get("username") or ""
            if uname:
                username_to_id[uname] = u.get("id") or u.get("uid")
        resolved_assignee_id = username_to_id.get(assignee)
        if resolved_assignee_id is None:
            return {"error": "assignee not found", "detail": f"username '{assignee}' が見つかりません"}

    # ---- 部分更新ペイロード (指定項目のみ) ----
    payload: dict = {}
    if resolved_assignee_id is not None:
        payload["assigned_to"] = resolved_assignee_id
    if due:
        payload["due_date"] = due
    if status:
        payload["status"] = status
    if type:
        payload["type"] = type
    if not payload:
        return {"error": "no_fields", "detail": "更新する項目を1つ以上指定してください"}

    # ---- REST呼び出し ----
    try:
        resp = httpx.put(
            f"{_INTERNAL_BASE}/api/tasks/{task_id}",
            json=payload,
            headers=_actor_headers(actor_id),
            timeout=15.0,
        )
    except httpx.RequestError as exc:
        return {"error": f"request failed: {exc}"}
    if not resp.is_success:
        return {"error": resp.text, "status_code": resp.status_code}

    data = resp.json()
    return {
        "ok": True,
        "task_id": task_id,
        "updated_fields": list(payload.keys()),
        "assigned_to": data.get("assigned_to"),
        "status": data.get("status"),
        "type": data.get("type"),
        "due_date": str(data.get("due_date") or ""),
    }


mcp_http = mcp.http_app(path="/")
