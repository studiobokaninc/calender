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
from .timezone import now_jst_naive
from .services.audit_service import record_event
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
        if actor_id is not None:
            q = q.filter(models.Task.assigned_to == actor_id)
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
    
    db = SessionLocal()
    try:
        actor = db.query(models.User).filter(models.User.id == actor_id, models.User.is_active == True).first()
        if not actor:
            return {"error": f"actor_id={actor_id} not found or inactive"}

        if version is None:
            version = "1"

        if shot_id is None and task_id is not None:
            db_task = db.query(models.Task).filter(models.Task.id == task_id).first()
            if db_task:
                shot_id = db_task.shot_id

        base_dir = pathlib.Path(__file__).resolve().parent.parent
        assets_dir = base_dir / "static" / "assets"
        assets_dir.mkdir(parents=True, exist_ok=True)

        shot_id_str = str(shot_id) if shot_id is not None else "none"
        dest_file_path = assets_dir / f"shot_{shot_id_str}_task_{task_id}_{version}_{p.name}"

        import shutil
        try:
            shutil.copy(p, dest_file_path)
        except OSError as e:
            return {"error": f"ファイルの保存に失敗しました: {e}"}

        db_asset = models.Asset(
            shot_id=shot_id,
            task_id=task_id,
            version=version,
            file_path=str(dest_file_path.as_posix()),
            created_by=actor_id,
            created_at=now_jst_naive()
        )
        try:
            db.add(db_asset)
            db.commit()
            db.refresh(db_asset)
        except Exception as e:
            db.rollback()
            try:
                dest_file_path.unlink(missing_ok=True)
            except Exception:
                pass
            return {"error": f"アセットの DB 保存に失敗しました: {e}"}

        return {
            "id": db_asset.id,
            "shot_id": db_asset.shot_id,
            "task_id": db_asset.task_id,
            "version": db_asset.version,
            "file_path": db_asset.file_path,
            "created_by": db_asset.created_by,
            "created_at": db_asset.created_at.isoformat() if db_asset.created_at else None
        }
    finally:
        db.close()


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
    
    db = SessionLocal()
    try:
        creator = actor_id if created_by is None else created_by
        new_material = models.ReferenceMaterial(
            shot_id=shot_id,
            task_id=task_id,
            title=title,
            media_type=media_type,
            file_path=file_path,
            created_by=creator,
            created_at=now_jst_naive()
        )
        try:
            db.add(new_material)
            db.commit()
            db.refresh(new_material)
        except Exception as e:
            db.rollback()
            return {"error": f"参考資料の DB 保存に失敗しました: {e}"}

        return {
            "id": new_material.id,
            "shot_id": new_material.shot_id,
            "task_id": new_material.task_id,
            "title": new_material.title,
            "media_type": new_material.media_type,
            "file_path": new_material.file_path,
            "created_by": new_material.created_by,
            "created_at": new_material.created_at.isoformat() if new_material.created_at else None
        }
    finally:
        db.close()


@mcp.tool()
def get_messages(
    actor_id: Annotated[int, Field(description="読み取り主体のユーザーID (必須)。参加スレッドのみ閲覧可 (サーバ側強制)。")],
    thread_id: Annotated[Optional[int], Field(description="スレッドID (任意)。指定時: そのスレッドのメッセージ一覧を返す。")] = None,
    peer_user_id: Annotated[Optional[int], Field(description="相手のユーザーID (任意)。指定時: actor_id との 1対1 スレッドのメッセージを返す。")] = None,
    limit: Annotated[int, Field(description="取得件数上限 (任意・デフォルト50)")] = 50,
) -> dict:
    """actor_id ユーザーの DM スレッド一覧、またはスレッドのメッセージ一覧を取得。
    thread_id 指定 → スレッド of メッセージ / peer_user_id 指定 → 1対1メッセージ /
    両方未指定 → スレッド一覧。"""
    err = _require_write_scope()
    if err:
        return err
    
    db = SessionLocal()
    try:
        if thread_id is not None or peer_user_id is not None:
            tid = thread_id
            if tid is None:
                tid = min(actor_id, peer_user_id) * 10000 + max(actor_id, peer_user_id)
            
            if tid >= 10000000:
                member = db.query(models.DmThreadParticipant).filter(
                    models.DmThreadParticipant.thread_id == tid,
                    models.DmThreadParticipant.user_id == actor_id
                ).first()
                if not member:
                    return {"error": "このスレッドの参加者ではありません", "status_code": 403}
            else:
                p1 = tid // 10000
                p2 = tid % 10000
                if actor_id not in (p1, p2):
                    return {"error": "このスレッドの参加者ではありません", "status_code": 403}
            
            messages = db.query(models.DirectMessage).filter(
                models.DirectMessage.thread_id == tid
            ).order_by(models.DirectMessage.created_at.desc()).limit(limit).all()
            
            messages = list(reversed(messages))
            
            items = []
            for m in messages:
                items.append({
                    "id": m.id,
                    "thread_id": m.thread_id,
                    "sender_id": m.sender_id,
                    "recipient_id": m.recipient_id,
                    "body": m.body,
                    "context_json": m.context_json,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                    "is_read": (m.read_at is not None),
                    "read_at": m.read_at.isoformat() if m.read_at else None
                })
            return {"messages": items}
        
        else:
            dm_threads = db.query(models.DirectMessage.thread_id).filter(
                (models.DirectMessage.sender_id == actor_id) | (models.DirectMessage.recipient_id == actor_id)
            ).distinct().all()
            dm_tids = [row[0] for row in dm_threads]
            
            g_tids_rows = db.query(models.DmThreadParticipant.thread_id).filter(
                models.DmThreadParticipant.user_id == actor_id
            ).distinct().all()
            g_tids = [row[0] for row in g_tids_rows]

            all_tids = list(set(dm_tids + g_tids))
            if not all_tids:
                return {"threads": []}

            threads_list = []
            for tid in all_tids:
                last_dm = db.query(models.DirectMessage).filter(
                    models.DirectMessage.thread_id == tid
                ).order_by(models.DirectMessage.created_at.desc()).first()
                if not last_dm:
                    continue
                
                if tid >= 10000000:
                    members = db.query(models.DmThreadParticipant.user_id).filter(
                        models.DmThreadParticipant.thread_id == tid
                    ).all()
                    p_ids = [uid for (uid,) in members]
                else:
                    p1 = tid // 10000
                    p2 = tid % 10000
                    p_ids = [p1, p2]
                
                participants_info = []
                for pid in sorted(list(set(p_ids))):
                    if pid == actor_id:
                        participants_info.append({"user_id": actor_id, "name": "Me"})
                    else:
                        user = db.query(models.User).filter(models.User.id == pid).first()
                        name = user.full_name or user.username if user else f"User {pid}"
                        participants_info.append({"user_id": pid, "name": name})
                
                threads_list.append({
                    "thread_id": tid,
                    "participants": participants_info,
                    "last_message": last_dm.body,
                    "updated_at": last_dm.created_at.isoformat() if last_dm.created_at else None
                })
            
            threads_list.sort(key=lambda x: x["updated_at"] or "", reverse=True)
            return {"threads": threads_list}
    finally:
        db.close()


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
    
    db = SessionLocal()
    try:
        if thread_id >= 10000000:
            member = db.query(models.DmThreadParticipant).filter(
                models.DmThreadParticipant.thread_id == thread_id,
                models.DmThreadParticipant.user_id == actor_id
            ).first()
            if not member:
                return {"error": "このスレッドの参加者ではありません", "status_code": 403}
        else:
            p1 = thread_id // 10000
            p2 = thread_id % 10000
            if actor_id not in (p1, p2):
                return {"error": "このスレッドの参加者ではありません", "status_code": 403}

        unread = db.query(models.DirectMessage).filter(
            models.DirectMessage.thread_id == thread_id,
            models.DirectMessage.sender_id != actor_id,
            models.DirectMessage.read_at == None
        ).all()
        now = now_jst_naive()
        for msg in unread:
            msg.read_at = now
        db.commit()
        return {"ok": True, "thread_id": thread_id, "read_count": len(unread)}
    finally:
        db.close()


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
    
    db = SessionLocal()
    try:
        recipient_id = to_user_id
        participants = [actor_id, recipient_id]
        thread_id = min(actor_id, recipient_id) * 10000 + max(actor_id, recipient_id)

        other_participants = [p for p in set(participants) if p != actor_id]
        if not other_participants:
            return {"error": "有効な受信者が存在しません", "status_code": 400}
            
        representative_id = other_participants[0]

        db_dm = models.DirectMessage(
            thread_id=thread_id,
            sender_id=actor_id,
            recipient_id=representative_id,
            body=body,
            context_json=context_json,
            created_at=now_jst_naive()
        )
        db.add(db_dm)
        db.commit()
        db.refresh(db_dm)

        from app.utils.webhook_sender import send_webhook_in_thread
        try:
            send_webhook_in_thread("dm_thread.new_message", {
                "thread_id": db_dm.thread_id,
                "message_id": db_dm.id,
                "sender_id": db_dm.sender_id,
                "participants": participants,
                "body": db_dm.body,
                "created_at": db_dm.created_at.isoformat() if db_dm.created_at else None,
            })
        except Exception:
            pass

        return {
            "id": db_dm.id,
            "thread_id": db_dm.thread_id,
            "sender_id": db_dm.sender_id,
            "recipient_id": db_dm.recipient_id,
            "created_at": db_dm.created_at.isoformat() if db_dm.created_at else None,
        }
    finally:
        db.close()


_VALID_TASK_TYPES = {
    "animation", "layout", "comp", "fx", "lighting", "asset",
    "programming", "design", "testing", "shoot", "gs", "report", "other",
}


@mcp.tool()
def create_project(
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

    db = SessionLocal()
    try:
        actor = db.query(models.User).filter(models.User.id == actor_id, models.User.is_active == True).first()
        if not actor:
            return {"error": f"actor_id={actor_id} not found or inactive"}
        if actor.role != "admin":
            return {"error": "管理者権限が必要です"}

        if client_ref:
            p = db.query(models.Project).filter(models.Project.client_ref == client_ref).first()
            if p:
                return {"ok": True, "project": {
                    "id": p.id, "name": p.name,
                    "code": getattr(p, "code", None), "client_ref": p.client_ref,
                }, "reused": True}
        else:
            p = db.query(models.Project).filter(models.Project.name == name).first()
            if p:
                return {"ok": True, "project": {
                    "id": p.id, "name": p.name,
                    "code": getattr(p, "code", None), "client_ref": p.client_ref,
                }, "reused": True}

        project_data = schemas.ProjectCreate(
            name=name,
            description=description,
            start_date=datetime.date.fromisoformat(start_date) if start_date else None,
            end_date=datetime.date.fromisoformat(end_date) if end_date else None,
            client_ref=client_ref or None
        )
        created_project = crud.create_project(db=db, project=project_data)

        from app.services.meeting_scanner import create_project_folder
        try:
            create_project_folder(created_project.name)
        except Exception:
            pass

        from app.services.google_sync import auto_sync_project_bg
        import threading
        threading.Thread(target=auto_sync_project_bg, args=(created_project.id,)).start()

        return {"ok": True, "project": {
            "id": created_project.id, "name": created_project.name,
            "code": getattr(created_project, "code", None), "client_ref": created_project.client_ref,
        }}
    finally:
        db.close()


@mcp.tool()
def delete_project(
    actor_id: int,
    project_id: int,
) -> dict:
    """プロジェクトを削除する(関連タスク・ショット・イベント等も物理削除)。
    管理者権限が必要(非admin actor_idでは403を返す)。
    ★ 物理削除: shots/tasks/events/履歴も全てカスケード削除される。元に戻せない。"""
    err = _require_write_scope()
    if err:
        return err
    
    db = SessionLocal()
    try:
        actor = db.query(models.User).filter(models.User.id == actor_id, models.User.is_active == True).first()
        if not actor:
            return {"error": f"actor_id={actor_id} not found or inactive"}
        if actor.role != "admin":
            return {"error": "管理者権限が必要です"}

        project = db.query(models.Project).filter(models.Project.id == project_id).first()
        if not project:
            return {"error": f"project_id={project_id} not found"}
        project_name = project.name

        success = crud.delete_project_with_cascade(db, project_id)
        if not success:
            return {"error": "プロジェクトの削除に失敗しました"}
        
        if project_name:
            from app.services.meeting_scanner import delete_project_folder
            try:
                delete_project_folder(project_name)
            except Exception:
                pass

        return {"ok": True, "deleted_project_id": project_id}
    finally:
        db.close()


@mcp.tool()
def update_project(
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
    
    db = SessionLocal()
    try:
        actor = db.query(models.User).filter(models.User.id == actor_id, models.User.is_active == True).first()
        if not actor:
            return {"error": f"actor_id={actor_id} not found or inactive"}
        if actor.role != "admin":
            return {"error": "管理者権限が必要です"}

        db_project = crud.get_project(db=db, project_id=project_id)
        if db_project is None:
            return {"error": f"project_id={project_id} not found"}

        payload = {}
        if name:
            payload["name"] = name
        if description:
            payload["description"] = description
        if start_date:
            payload["start_date"] = datetime.date.fromisoformat(start_date)
        if end_date:
            payload["end_date"] = datetime.date.fromisoformat(end_date)
        if display_status:
            if display_status not in ("online", "offline", "archived"):
                return {"error": f"display_status は online/offline/archived のみ有効。指定値: {display_status}"}
            payload["display_status"] = display_status
        
        if not payload:
            return {"error": "更新するフィールドが指定されていません。name/description/start_date/end_date/display_status のいずれかを指定してください。"}

        project_data = schemas.ProjectUpdate(**payload)

        old_name = db_project.name
        updated_project = crud.update_project(db=db, db_project=db_project, project_in=project_data)

        if old_name != updated_project.name:
            from app.services.meeting_scanner import rename_project_folder
            try:
                rename_project_folder(old_name, updated_project.name)
            except Exception:
                pass

        if updated_project.status in [models.ProjectStatus.COMPLETED, models.ProjectStatus.CANCELLED]:
            crud.complete_tasks_for_project(db=db, project_id=project_id)

        from app.services.google_sync import auto_sync_project_bg
        import threading
        threading.Thread(target=auto_sync_project_bg, args=(updated_project.id,)).start()

        return {"ok": True, "project": {
            "id": updated_project.id,
            "name": updated_project.name,
            "display_status": updated_project.display_status,
            "client_ref": updated_project.client_ref,
        }}
    finally:
        db.close()


@mcp.tool()
def import_shots(
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
    
    db = SessionLocal()
    try:
        actor = db.query(models.User).filter(models.User.id == actor_id, models.User.is_active == True).first()
        if not actor:
            return {"error": f"actor_id={actor_id} not found or inactive"}

        from app.routers.shots import SEQ_CODE_REGEX, SHOT_CODE_REGEX
        
        created = []
        failed = []
        for i, shot in enumerate(shots):
            seq_code = shot.get("code", "")
            shot_code = shot.get("name", shot.get("code", ""))
            note = shot.get("note", "")

            if not SEQ_CODE_REGEX.match(seq_code):
                failed.append({"index": i, "code": seq_code, "error": "Invalid seq_code format"})
                continue
            if not SHOT_CODE_REGEX.match(shot_code):
                failed.append({"index": i, "code": seq_code, "error": "Invalid shot_code format"})
                continue

            existing = db.query(models.Shot).filter(
                models.Shot.project_id == project_id,
                models.Shot.seq_code == seq_code,
                models.Shot.shot_code == shot_code
            ).first()
            if existing:
                failed.append({"index": i, "code": seq_code, "error": "Shot already exists"})
                continue

            new_shot = models.Shot(
                project_id=project_id,
                seq_code=seq_code,
                shot_code=shot_code,
                display_order=0,
                status="planning",
                description=note
            )
            try:
                db.add(new_shot)
                db.commit()
                db.refresh(new_shot)
                created.append({"index": i, "code": seq_code, "id": new_shot.id})
            except Exception as e:
                db.rollback()
                failed.append({"index": i, "code": seq_code, "error": f"DB Save failed: {e}"})

        return {"created": created, "failed": failed}
    finally:
        db.close()


@mcp.tool()
def bulk_create_tasks(
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

    db = SessionLocal()
    try:
        actor = db.query(models.User).filter(models.User.id == actor_id, models.User.is_active == True).first()
        if not actor:
            return {"error": f"actor_id={actor_id} not found or inactive"}

        users = db.query(models.User).filter(models.User.is_active == True).all()
        username_to_id = {}
        for u in users:
            uname = u.username or u.name
            if uname:
                username_to_id[uname] = u.id

        shots_rows = db.query(models.Shot).filter(models.Shot.is_deleted == False).all()
        shot_code_to_id = {}
        for s in shots_rows:
            if s.shot_code:
                shot_code_to_id[s.shot_code] = s.id

        from app.services.google_sync import auto_sync_task_bg
        import threading

        created = []
        failed = []
        for i, task in enumerate(tasks):
            task_type = task.get("type", "")
            if task_type not in _VALID_TASK_TYPES:
                failed.append({"index": i, "reason": f"invalid type: {task_type!r}"})
                continue

            resolved_user_id = None
            assignee = task.get("assignee", "")
            if assignee:
                resolved_user_id = username_to_id.get(assignee)
                if resolved_user_id is None:
                    failed.append({"index": i, "reason": f"assignee not found: {assignee!r}"})
                    continue

            resolved_shot_id = None
            shot_code = task.get("shot", "")
            if shot_code:
                resolved_shot_id = shot_code_to_id.get(shot_code)
                if resolved_shot_id is None:
                    failed.append({"index": i, "reason": f"shot not found: {shot_code!r}"})
                    continue

            shot_project_id = None
            if resolved_shot_id:
                shot_obj = db.query(models.Shot).filter(models.Shot.id == resolved_shot_id).first()
                if shot_obj:
                    shot_project_id = shot_obj.project_id

            task_payload = {
                "name": task.get("note") or f"{task_type} task",
                "type": task_type,
                "assigned_to": resolved_user_id,
                "due_date": task.get("due") or None,
                "shot_id": resolved_shot_id,
                "project_id": shot_project_id
            }
            try:
                task_schema = schemas.TaskCreate(**task_payload)
            except Exception as e:
                failed.append({"index": i, "reason": f"validation error: {e}"})
                continue

            try:
                created_task = crud.create_task(db=db, task=task_schema)
                record_event(db, "task.create", actor_uid=actor_id,
                             target_type="task", target_id=created_task.id,
                             detail={"project_id": created_task.project_id})
                
                threading.Thread(target=auto_sync_task_bg, args=(created_task.id,)).start()

                created.append({"index": i, "task_id": created_task.id, "name": created_task.name})
            except Exception as e:
                db.rollback()
                failed.append({"index": i, "reason": f"DB Save failed: {e}"})

        return {"created": created, "failed": failed}
    finally:
        db.close()


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
def update_task(
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
        db = SessionLocal()
        try:
            target_user = db.query(models.User).filter(
                (models.User.username == assignee) | (models.User.name == assignee),
                models.User.is_active == True
            ).first()
            if not target_user:
                return {"error": "assignee not found", "detail": f"username '{assignee}' が見つかりません"}
            resolved_assignee_id = target_user.id
        finally:
            db.close()

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

        task_in = schemas.TaskUpdate(**payload)
        updated_task = crud.update_task(db=db, db_task=db_task, task_in=task_in)

        record_event(db, "task.update", actor_uid=actor_id,
                     target_type="task", target_id=task_id)

        from app.services.google_sync import auto_sync_task_bg
        import threading
        threading.Thread(target=auto_sync_task_bg, args=(updated_task.id,)).start()

        return {
            "ok": True,
            "task_id": task_id,
            "updated_fields": list(payload.keys()),
            "assigned_to": updated_task.assigned_to,
            "status": updated_task.status.value if hasattr(updated_task.status, 'value') else updated_task.status,
            "type": updated_task.type,
            "due_date": str(updated_task.due_date or ""),
        }
    finally:
        db.close()


mcp_http = mcp.http_app(path="/")
