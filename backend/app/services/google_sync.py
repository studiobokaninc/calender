import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from app import models, crud, google_calendar
from pytz import timezone
import threading

logger = logging.getLogger(__name__)

def to_datetime(val: Any) -> Optional[datetime]:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val.replace('Z', '+00:00'))
        except ValueError:
            logger.warning(f"Failed to parse datetime string: {val}")
            return None
    return None

def ensure_jst(dt: datetime | str | None) -> datetime | None:
    dt_obj = to_datetime(dt)
    if not dt_obj:
        return None
            
    from pytz import timezone
    jst = timezone("Asia/Tokyo")
    if dt_obj.tzinfo is None:
        return jst.localize(dt_obj)
    return dt_obj.astimezone(jst)

from app.database import SessionLocal
_task_sync_locks = {}
_task_sync_locks_lock = threading.Lock()

def auto_sync_task_bg(task_id: int, db: Session = None):
    """タスク作成/更新時に呼ばれるバックグラウンド処理。全連携ユーザーに対して同期を試みる。"""
    with _task_sync_locks_lock:
        if task_id not in _task_sync_locks:
            _task_sync_locks[task_id] = threading.Lock()
        lock = _task_sync_locks[task_id]
    
    with lock:
        should_close = False
        if db is None:
            db = SessionLocal()
            should_close = True
        try:
            task = crud.get_task(db, task_id)
            if not task:
                return
            # Google連携している全ユーザーを取得
            token_rows = db.query(models.UserGoogleToken).all()
            for token_row in token_rows:
                sync_task_to_google(db, task, token_row, token_row.user_id)
        except Exception as e:
            logger.exception("auto_sync_task_bg failed: %s", e)
        finally:
            if should_close:
                db.close()

def auto_sync_project_bg(project_id: int, db: Session = None):
    """プロジェクト更新時に紐づく全タスク・全イベントを再同期する。"""
    should_close = False
    if db is None:
        db = SessionLocal()
        should_close = True
    try:
        project = crud.get_project(db, project_id)
        if not project:
            return
        db_tasks = db.query(models.Task).filter(models.Task.project_id == project_id).all()
        for t in db_tasks:
            auto_sync_task_bg(t.id, db=db)
        db_events = db.query(models.Event).filter(models.Event.project_id == project_id).all()
        for e in db_events:
            auto_sync_event_bg(e.id, db=db)
    except Exception as e:
        logger.exception("auto_sync_project_bg failed: %s", e)
    finally:
        if should_close:
            db.close()

def auto_sync_event_bg(event_id: int, db: Session = None):
    """イベント作成/更新時。全連携ユーザーに対して同期を試みる。"""
    should_close = False
    if db is None:
        db = SessionLocal()
        should_close = True
    try:
        event = crud.get_event(db, event_id)
        if not event:
            return
        token_rows = db.query(models.UserGoogleToken).all()
        for token_row in token_rows:
            sync_event_to_google(db, event, token_row, token_row.user_id)
    except Exception as e:
        logger.exception("auto_sync_event_bg failed: %s", e)
    finally:
        if should_close:
            db.close()

def _ensure_token_updated(db: Session, token_row: models.UserGoogleToken) -> Optional[str]:
    if not token_row:
        return None
    if token_row.expires_at and datetime.utcnow() < token_row.expires_at - timedelta(minutes=5):
        return token_row.access_token
    if not token_row.refresh_token:
        return token_row.access_token
    tokens = google_calendar.refresh_access_token(token_row.refresh_token)
    if tokens and tokens.get("access_token"):
        token_row.access_token = tokens["access_token"]
        expires_in = tokens.get("expires_in")
        if expires_in:
            token_row.expires_at = datetime.utcnow() + timedelta(seconds=int(expires_in))
        token_row.updated_at = datetime.now()
        db.commit()
        db.refresh(token_row)
        return token_row.access_token
    return token_row.access_token

def _ensure_calendar_id(db: Session, token_row: models.UserGoogleToken) -> str | None:
    access_token = _ensure_token_updated(db, token_row)
    if not access_token:
        return None
    if token_row.calendar_id:
        return token_row.calendar_id
    calendar_id = google_calendar.get_or_create_app_calendar(
        access_token=access_token,
        refresh_token=token_row.refresh_token,
        expires_at=token_row.expires_at,
    )
    if calendar_id:
        token_row.calendar_id = calendar_id
        db.commit()
    return calendar_id

def sync_task_to_google(db: Session, task: models.Task, token_row: models.UserGoogleToken, user_id: int):
    """単一のタスクを同期。権限とプロジェクトステータスをチェックする。"""
    access_token = _ensure_token_updated(db, token_row)
    if not access_token:
        return

    sync_row = crud.get_task_google_sync(db, user_id, task.id)
    project = crud.get_project(db, task.project_id) if task.project_id else None
    user = crud.get_user(db, user_id=user_id)
    is_admin = user and user.role == 'admin'

    # 同期・削除判定
    is_project_offline = (project and project.display_status == 'offline')
    # 完了タスク、オフラインプロジェクト、または自分に関係ないタスクは削除対象
    is_completed = (task.status == 'completed')
    is_unrelated = (not is_admin and task.assigned_to != user_id)

    if task.status == 'offline' or is_project_offline or is_unrelated or is_completed:
        if sync_row and sync_row.google_event_id:
            google_calendar.delete_calendar_event(
                access_token=access_token,
                refresh_token=token_row.refresh_token,
                expires_at=token_row.expires_at,
                event_id=sync_row.google_event_id,
                calendar_id=_ensure_calendar_id(db, token_row)
            )
            crud.set_task_google_sync(db, user_id, task.id, "")
        return

    # 同期用情報生成
    start_jst = ensure_jst(task.start_date or task.due_date or datetime.utcnow())
    end_dt = (to_datetime(task.due_date) or to_datetime(start_jst)) + timedelta(days=1)
    end_jst = ensure_jst(end_dt)
    
    project_name = project.name if project else "なし"
    status_map = {"todo": "未着手", "in-progress": "進行中", "review": "レビュー中", "completed": "完了", "delayed": "遅延長"}
    task_status_ja = status_map.get(task.status, task.status or "未着手")
    task_title = f"[{task_status_ja}][{project_name}] {task.name}"

    # 担当者名取得
    assignee_name = "未設定"
    if task.assigned_to:
        assignee_user = crud.get_user(db, task.assigned_to)
        if assignee_user:
            assignee_name = assignee_user.full_name or assignee_user.username

    # 確認事項整形
    checks_str = "なし"
    if task.check_items and isinstance(task.check_items, list):
        items = []
        for item in task.check_items:
            label = item.get("label", "項目")
            checked = " [v] " if item.get("checked") else " [ ] "
            items.append(f"{checked}{label}")
        if items:
            checks_str = "\n" + "\n".join(items)

    desc = f"""【プロジェクト】: {project_name}
【ステータス】: {task_status_ja}
【担当者】: {assignee_name}

【説明】:
{task.description or "（なし）"}

【メモ/提出物】:
{task.deliverables or "（なし）"}

【確認事項】:
{checks_str}
"""

    cal_id = _ensure_calendar_id(db, token_row)
    sync_id = f"task_{task.id}"
    
    try:
        if sync_row and sync_row.google_event_id:
            google_calendar.update_calendar_event(
                access_token=access_token,
                refresh_token=token_row.refresh_token,
                expires_at=token_row.expires_at,
                event_id=sync_row.google_event_id,
                task_name=task_title,
                start_date=start_jst,
                end_date=end_jst,
                description=desc,
                calendar_id=cal_id,
                is_all_day=True,
                sync_id=sync_id
            )
        else:
            event_id = google_calendar.create_calendar_event(
                access_token=access_token,
                refresh_token=token_row.refresh_token,
                expires_at=token_row.expires_at,
                task_name=task_title,
                start_date=start_jst,
                end_date=end_jst,
                description=desc,
                calendar_id=cal_id,
                is_all_day=True,
                sync_id=sync_id
            )
            if event_id:
                crud.set_task_google_sync(db, user_id, task.id, event_id)
    except Exception as e:
        logger.error(f"Failed to sync task {task.id} for user {user_id}: {e}")

def sync_event_to_google(db: Session, event: models.Event, token_row: models.UserGoogleToken, user_id: int):
    """単一のイベント（会議）を同期。"""
    access_token = _ensure_token_updated(db, token_row)
    if not access_token:
        return

    sync_row = crud.get_event_google_sync(db, user_id, event.id)
    project = crud.get_project(db, event.project_id) if event.project_id else None
    user = crud.get_user(db, user_id=user_id)
    is_admin = user and user.role == 'admin'

    participants = event.participants or []
    participant_ids = [p.get('id') for p in participants if isinstance(p, dict)]
    is_project_offline = (project and project.display_status == 'offline')
    # 一般ユーザーの場合、自分が参加者でないなら同期対象外
    is_unrelated = (not is_admin and user_id not in participant_ids)

    if event.status == 'offline' or is_project_offline or is_unrelated:
        if sync_row and sync_row.google_event_id:
            google_calendar.delete_calendar_event(
                access_token=access_token,
                refresh_token=token_row.refresh_token,
                expires_at=token_row.expires_at,
                event_id=sync_row.google_event_id,
                calendar_id=_ensure_calendar_id(db, token_row)
            )
            crud.set_event_google_sync(db, user_id, event.id, "")
        return

    start_jst = ensure_jst(event.start_time)
    end_jst = ensure_jst(event.end_time)
    project_name = project.name if project else "なし"
    event_title = f"[{project_name}] {event.title}"
    event_desc = f"【プロジェクト】: {project_name}\n【場所】: {event.location or 'なし'}\n【概要】:\n{event.description or 'なし'}"

    cal_id = _ensure_calendar_id(db, token_row)
    sync_id = f"event_{event.id}"
    
    try:
        if sync_row and sync_row.google_event_id:
            google_calendar.update_calendar_event(
                access_token=access_token,
                refresh_token=token_row.refresh_token,
                expires_at=token_row.expires_at,
                event_id=sync_row.google_event_id,
                task_name=event_title,
                start_date=start_jst,
                end_date=end_jst,
                description=event_desc,
                calendar_id=cal_id,
                is_all_day=bool(event.allDay),
                sync_id=sync_id
            )
        else:
            g_id = google_calendar.create_calendar_event(
                access_token=access_token,
                refresh_token=token_row.refresh_token,
                expires_at=token_row.expires_at,
                task_name=event_title,
                start_date=start_jst,
                end_date=end_jst,
                description=event_desc,
                calendar_id=cal_id,
                is_all_day=bool(event.allDay),
                sync_id=sync_id
            )
            if g_id:
                crud.set_event_google_sync(db, user_id, event.id, g_id)
    except Exception as e:
        logger.error(f"Failed to sync event {event.id} for user {user_id}: {e}")

def initial_sync_for_user(db: Session, user_id: int):
    """初期同期。全オンラインプロジェクトを対象に回すが、内部関数でユーザー権限によるフィルタが掛かる。"""
    token_row = crud.get_user_google_token(db, user_id)
    if not token_row:
        return
    online_projects = db.query(models.Project).filter(models.Project.display_status == 'online').all()
    for p in online_projects:
        tasks = db.query(models.Task).filter(models.Task.project_id == p.id).all()
        for t in tasks:
            sync_task_to_google(db, t, token_row, user_id)
        events = db.query(models.Event).filter(models.Event.project_id == p.id).all()
        for e in events:
            sync_event_to_google(db, e, token_row, user_id)

def initial_sync_for_user_bg(user_id: int, db: Session = None):
    """ユーザー連携時の初期同期をバックグラウンドで実行するラッパー。"""
    should_close = False
    if db is None:
        db = SessionLocal()
        should_close = True
    try:
        initial_sync_for_user(db, user_id)
    except Exception as e:
        logger.exception("initial_sync_for_user_bg failed: %s", e)
    finally:
        if should_close:
            db.close()

def cleanup_all_google_events(db: Session, user_id: int):
    """連携解除時の全件削除。"""
    token_row = crud.get_user_google_token(db, user_id)
    if not token_row:
        return
    access_token = _ensure_token_updated(db, token_row)
    cal_id = _ensure_calendar_id(db, token_row)
    if not cal_id or not access_token:
        return
    
    # 登録済みの全同期レコードを取得
    task_syncs = db.query(models.TaskGoogleSync).filter(models.TaskGoogleSync.user_id == user_id).all()
    for s in task_syncs:
        if s.google_event_id:
            try:
                google_calendar.delete_calendar_event(
                    access_token=access_token,
                    refresh_token=token_row.refresh_token,
                    expires_at=token_row.expires_at,
                    event_id=s.google_event_id,
                    calendar_id=cal_id
                )
            except Exception as e:
                logger.error(f"Cleanup: Failed to delete task event {s.google_event_id}: {e}")
            s.google_event_id = ""
            
    event_syncs = db.query(models.EventGoogleSync).filter(models.EventGoogleSync.user_id == user_id).all()
    for s in event_syncs:
        if s.google_event_id:
            try:
                google_calendar.delete_calendar_event(
                    access_token=access_token,
                    refresh_token=token_row.refresh_token,
                    expires_at=token_row.expires_at,
                    event_id=s.google_event_id,
                    calendar_id=cal_id
                )
            except Exception as e:
                logger.error(f"Cleanup: Failed to delete meeting event {s.google_event_id}: {e}")
            s.google_event_id = ""
    db.commit()

# --- Placeholder to match previous imports in main.py ---
def delete_task_syncs(db: Session, task_id: int):
    syncs = db.query(models.TaskGoogleSync).filter(models.TaskGoogleSync.task_id == task_id).all()
    for s in syncs:
        token_row = crud.get_user_google_token(db, s.user_id)
        if token_row and s.google_event_id:
            access_token = _ensure_token_updated(db, token_row)
            cal_id = _ensure_calendar_id(db, token_row)
            if access_token and cal_id:
                try:
                    google_calendar.delete_calendar_event(
                        access_token=access_token,
                        refresh_token=token_row.refresh_token,
                        expires_at=token_row.expires_at,
                        event_id=s.google_event_id,
                        calendar_id=cal_id
                    )
                except Exception as e:
                    logger.error(f"Failed to delete task sync {s.google_event_id}: {e}")
        db.delete(s)
    db.commit()

def delete_event_syncs(db: Session, event_id: int):
    syncs = db.query(models.EventGoogleSync).filter(models.EventGoogleSync.event_id == event_id).all()
    for s in syncs:
        token_row = crud.get_user_google_token(db, s.user_id)
        if token_row and s.google_event_id:
            access_token = _ensure_token_updated(db, token_row)
            cal_id = _ensure_calendar_id(db, token_row)
            if access_token and cal_id:
                try:
                    google_calendar.delete_calendar_event(
                        access_token=access_token,
                        refresh_token=token_row.refresh_token,
                        expires_at=token_row.expires_at,
                        event_id=s.google_event_id,
                        calendar_id=cal_id
                    )
                except Exception as e:
                    logger.error(f"Failed to delete event sync {s.google_event_id}: {e}")
        db.delete(s)
    db.commit()

def delete_project_syncs(db: Session, project_id: int):
    # プロジェクトに関連するタスク・イベントの同期をすべて消す
    tasks = db.query(models.Task).filter(models.Task.project_id == project_id).all()
    for t in tasks:
        delete_task_syncs(db, t.id)
    events = db.query(models.Event).filter(models.Event.project_id == project_id).all()
    for e in events:
        delete_event_syncs(db, e.id)
    # プロジェクト自体の同期レコード（もしあれば）も消す
    proj_syncs = db.query(models.ProjectGoogleSync).filter(models.ProjectGoogleSync.project_id == project_id).all()
    for s in proj_syncs:
        db.delete(s)
    db.commit()

def cleanup_all_google_events_bg(user_id: int):
    """バックグラウンドで全件削除と連携解除（DB削除）を完遂するルーチン。"""
    db = SessionLocal()
    try:
        # 1. Googleカレンダー上の予定を削除 (この中でトークンを取得してAPIを叩く)
        logger.info(f"Background cleanup started for user {user_id}")
        cleanup_all_google_events(db, user_id)
        
        # 2. 同期レコードをDBから物理削除
        logger.info(f"Deleting sync records from DB for user {user_id}")
        db.query(models.TaskGoogleSync).filter(models.TaskGoogleSync.user_id == user_id).delete()
        db.query(models.ProjectGoogleSync).filter(models.ProjectGoogleSync.user_id == user_id).delete()
        db.query(models.EventGoogleSync).filter(models.EventGoogleSync.user_id == user_id).delete()
        
        # 3. Google連携トークンを削除 (これが最後)
        crud.delete_user_google_token(db, user_id)
        
        db.commit()
        logger.info(f"Background cleanup completed for user {user_id}")
    except Exception as e:
        logger.error(f"cleanup_all_google_events_bg failed for user {user_id}: {e}")
        db.rollback()
    finally:
        db.close()
