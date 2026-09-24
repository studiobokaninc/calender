import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from app import models, crud, google_calendar
from app.timezone import now_jst_naive
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
    """タスク作成/更新時に呼ばれるバックグラウンド処理。個人カレンダー作成済みの全ユーザーに対して同期を試みる。"""
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
            calendar_rows = crud.get_all_user_personal_calendars(db)
            if not calendar_rows:
                return
            account = crud.get_google_shared_account(db)
            access_token = _ensure_shared_token_updated(db)
            if not access_token or not account:
                return
            for row in calendar_rows:
                sync_task_to_google(db, task, row, access_token, account)
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
    """イベント作成/更新時。個人カレンダー作成済みの全ユーザーに対して同期を試みる。"""
    should_close = False
    if db is None:
        db = SessionLocal()
        should_close = True
    try:
        event = crud.get_event(db, event_id)
        if not event:
            return
        calendar_rows = crud.get_all_user_personal_calendars(db)
        if not calendar_rows:
            return
        account = crud.get_google_shared_account(db)
        access_token = _ensure_shared_token_updated(db)
        if not access_token or not account:
            return
        for row in calendar_rows:
            sync_event_to_google(db, event, row, access_token, account)
    except Exception as e:
        logger.exception("auto_sync_event_bg failed: %s", e)
    finally:
        if should_close:
            db.close()

def _ensure_shared_token_updated(db: Session) -> Optional[str]:
    """共有アカウントのアクセストークンを必要に応じてリフレッシュして返す。
    リフレッシュに失敗しても行は削除せず、status="error" としてマークするだけに留める
    （削除すると1回の失敗で全社員の同期が止まってしまうため）。"""
    account = crud.get_google_shared_account(db)
    if not account:
        return None
    if account.expires_at and datetime.utcnow() < account.expires_at - timedelta(minutes=5):
        return account.access_token
    if not account.refresh_token:
        return account.access_token
    tokens = google_calendar.refresh_access_token(account.refresh_token)
    if tokens and tokens.get("access_token"):
        account.access_token = tokens["access_token"]
        expires_in = tokens.get("expires_in")
        if expires_in:
            account.expires_at = datetime.utcnow() + timedelta(seconds=int(expires_in))
        account.status = "active"
        account.last_refresh_error = None
        account.updated_at = now_jst_naive()
        db.commit()
        db.refresh(account)
        return account.access_token

    err_msg = "共有アカウントのGoogleトークンのリフレッシュに失敗しました。管理者による再連携が必要です。"
    logger.error(err_msg)
    crud.mark_google_shared_account_error(db, err_msg)
    return None

def _ensure_user_calendar(db: Session, access_token: str, account: models.GoogleSharedAccount, user: models.User) -> Optional[str]:
    """対象ユーザーの個人カレンダーを取得、無ければ作成してACL共有する（遅延作成）。"""
    row = crud.get_user_personal_calendar(db, user.id)
    if row and row.calendar_id:
        if row.shared_email != user.email:
            new_rule = google_calendar.share_calendar_with_user(
                access_token, account.refresh_token, account.expires_at, row.calendar_id, user.email
            )
            if row.acl_rule_id and new_rule and row.acl_rule_id != new_rule:
                google_calendar.revoke_calendar_share(
                    access_token, account.refresh_token, account.expires_at, row.calendar_id, row.acl_rule_id
                )
            crud.upsert_user_personal_calendar(db, user.id, row.calendar_id, user.email, new_rule)
        return row.calendar_id

    display_name = user.full_name or user.username or user.email
    calendar_name = f"{display_name}さんのタスク"
    calendar_id = google_calendar.get_or_create_calendar(
        access_token, account.refresh_token, account.expires_at, calendar_name
    )
    if not calendar_id:
        return None
    acl_rule_id = google_calendar.share_calendar_with_user(
        access_token, account.refresh_token, account.expires_at, calendar_id, user.email
    )
    crud.upsert_user_personal_calendar(db, user.id, calendar_id, user.email, acl_rule_id)
    return calendar_id

def sync_task_to_google(
    db: Session,
    task: models.Task,
    calendar_row: models.UserPersonalCalendar,
    access_token: str,
    account: models.GoogleSharedAccount,
):
    """単一のタスクを同期。権限とプロジェクトステータスをチェックする。"""
    user_id = calendar_row.user_id
    sync_row = crud.get_task_google_sync(db, user_id, task.id)
    project = crud.get_project(db, task.project_id) if task.project_id else None

    # 同期・削除判定
    is_project_offline = (project and project.display_status == 'offline')
    # 完了タスク、オフラインプロジェクト、または自分に関係ないタスク（担当者が自分ではない）は削除/非同期対象
    is_completed = (task.status == 'completed')
    is_unrelated = (task.assigned_to != user_id)

    if task.status == 'offline' or is_project_offline or is_unrelated or is_completed:
        if sync_row and sync_row.google_event_id:
            google_calendar.delete_calendar_event(
                access_token=access_token,
                refresh_token=account.refresh_token,
                expires_at=account.expires_at,
                event_id=sync_row.google_event_id,
                calendar_id=calendar_row.calendar_id
            )
            crud.set_task_google_sync(db, user_id, task.id, "")
        return

    # 同期用情報生成
    start_dt_obj = to_datetime(task.start_date or task.due_date or datetime.utcnow())
    start_jst = ensure_jst(start_dt_obj)

    # 期限日が開始日より前になっている場合の整合性チェック
    end_base_dt = to_datetime(task.due_date) or start_dt_obj
    if end_base_dt < start_dt_obj:
        end_base_dt = start_dt_obj

    end_dt = end_base_dt + timedelta(days=1)
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

    cal_id = calendar_row.calendar_id
    sync_id = f"task_{task.id}"

    try:
        if sync_row and sync_row.google_event_id:
            google_calendar.update_calendar_event(
                access_token=access_token,
                refresh_token=account.refresh_token,
                expires_at=account.expires_at,
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
                refresh_token=account.refresh_token,
                expires_at=account.expires_at,
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

def sync_event_to_google(
    db: Session,
    event: models.Event,
    calendar_row: models.UserPersonalCalendar,
    access_token: str,
    account: models.GoogleSharedAccount,
):
    """単一のイベント（会議）を同期。"""
    user_id = calendar_row.user_id
    sync_row = crud.get_event_google_sync(db, user_id, event.id)
    project = crud.get_project(db, event.project_id) if event.project_id else None

    is_project_offline = (project and project.display_status == 'offline')
    user_ids = event.user_ids or []
    # 自分が参加者リストに含まれていない場合は非同期対象
    is_unrelated = (user_id not in user_ids)

    if event.status == 'offline' or is_project_offline or is_unrelated:
        if sync_row and sync_row.google_event_id:
            google_calendar.delete_calendar_event(
                access_token=access_token,
                refresh_token=account.refresh_token,
                expires_at=account.expires_at,
                event_id=sync_row.google_event_id,
                calendar_id=calendar_row.calendar_id
            )
            crud.set_event_google_sync(db, user_id, event.id, "")
        return

    start_jst = ensure_jst(event.start_time)
    end_jst = ensure_jst(event.end_time)
    project_name = project.name if project else "なし"
    event_title = f"[{project_name}] {event.title}"
    event_desc = f"【プロジェクト】: {project_name}\n【場所】: {event.location or 'なし'}\n【概要】:\n{event.description or 'なし'}"

    cal_id = calendar_row.calendar_id
    sync_id = f"event_{event.id}"

    try:
        if sync_row and sync_row.google_event_id:
            google_calendar.update_calendar_event(
                access_token=access_token,
                refresh_token=account.refresh_token,
                expires_at=account.expires_at,
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
                refresh_token=account.refresh_token,
                expires_at=account.expires_at,
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
    calendar_row = crud.get_user_personal_calendar(db, user_id)
    if not calendar_row:
        return
    account = crud.get_google_shared_account(db)
    access_token = _ensure_shared_token_updated(db)
    if not access_token or not account:
        return
    online_projects = db.query(models.Project).filter(models.Project.display_status == 'online').all()
    for p in online_projects:
        tasks = db.query(models.Task).filter(models.Task.project_id == p.id).all()
        for t in tasks:
            sync_task_to_google(db, t, calendar_row, access_token, account)
        events = db.query(models.Event).filter(models.Event.project_id == p.id).all()
        for e in events:
            sync_event_to_google(db, e, calendar_row, access_token, account)

def initial_sync_for_user_bg(user_id: int, db: Session = None):
    """個人カレンダー接続時の初期同期をバックグラウンドで実行するラッパー。"""
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

def disconnect_user_calendar_bg(user_id: int):
    """個人の連携解除: 本人の個人カレンダーをGoogle側から丸ごと削除し、DBの同期レコードを掃除する。
    カレンダーごと削除すれば中のイベント・ACL共有もまとめて消えるため、イベント単位の削除は不要。"""
    db = SessionLocal()
    try:
        row = crud.get_user_personal_calendar(db, user_id)
        if row:
            account = crud.get_google_shared_account(db)
            access_token = _ensure_shared_token_updated(db) if account else None
            if access_token and account:
                try:
                    google_calendar.delete_calendar(access_token, account.refresh_token, account.expires_at, row.calendar_id)
                except Exception as e:
                    logger.error(f"Failed to delete personal calendar for user {user_id}: {e}")
            # API呼び出しが失敗してもDB側の整理は進める（不整合防止）

        db.query(models.TaskGoogleSync).filter(models.TaskGoogleSync.user_id == user_id).delete()
        db.query(models.ProjectGoogleSync).filter(models.ProjectGoogleSync.user_id == user_id).delete()
        db.query(models.EventGoogleSync).filter(models.EventGoogleSync.user_id == user_id).delete()
        crud.delete_user_personal_calendar(db, user_id)
        db.commit()
        logger.info(f"Personal calendar disconnect completed for user {user_id}")
    except Exception as e:
        logger.error(f"disconnect_user_calendar_bg failed for user {user_id}: {e}")
        db.rollback()
    finally:
        db.close()

def disconnect_shared_account_bg():
    """管理者操作: 共有アカウントと全社員分の個人カレンダー・同期レコードを一括削除する。"""
    db = SessionLocal()
    try:
        account = crud.get_google_shared_account(db)
        access_token = _ensure_shared_token_updated(db) if account else None
        rows = crud.get_all_user_personal_calendars(db)
        for row in rows:
            if access_token and account:
                try:
                    google_calendar.delete_calendar(access_token, account.refresh_token, account.expires_at, row.calendar_id)
                except Exception as e:
                    logger.error(f"Failed to delete personal calendar for user {row.user_id}: {e}")
        db.query(models.TaskGoogleSync).delete()
        db.query(models.EventGoogleSync).delete()
        db.query(models.ProjectGoogleSync).delete()
        db.query(models.UserPersonalCalendar).delete()
        crud.delete_google_shared_account(db)
        db.commit()
        logger.info("Shared Google account fully disconnected.")
    except Exception as e:
        logger.error(f"disconnect_shared_account_bg failed: {e}")
        db.rollback()
    finally:
        db.close()

def delete_task_syncs(db: Session, task_id: int):
    syncs = db.query(models.TaskGoogleSync).filter(models.TaskGoogleSync.task_id == task_id).all()
    if not syncs:
        return
    account = crud.get_google_shared_account(db)
    access_token = _ensure_shared_token_updated(db) if account else None
    for s in syncs:
        calendar_row = crud.get_user_personal_calendar(db, s.user_id)
        if calendar_row and s.google_event_id and access_token and account:
            try:
                google_calendar.delete_calendar_event(
                    access_token=access_token,
                    refresh_token=account.refresh_token,
                    expires_at=account.expires_at,
                    event_id=s.google_event_id,
                    calendar_id=calendar_row.calendar_id
                )
            except Exception as e:
                logger.error(f"Failed to delete task sync {s.google_event_id}: {e}")
        db.delete(s)
    db.commit()

def delete_event_syncs(db: Session, event_id: int):
    syncs = db.query(models.EventGoogleSync).filter(models.EventGoogleSync.event_id == event_id).all()
    if not syncs:
        return
    account = crud.get_google_shared_account(db)
    access_token = _ensure_shared_token_updated(db) if account else None
    for s in syncs:
        calendar_row = crud.get_user_personal_calendar(db, s.user_id)
        if calendar_row and s.google_event_id and access_token and account:
            try:
                google_calendar.delete_calendar_event(
                    access_token=access_token,
                    refresh_token=account.refresh_token,
                    expires_at=account.expires_at,
                    event_id=s.google_event_id,
                    calendar_id=calendar_row.calendar_id
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
