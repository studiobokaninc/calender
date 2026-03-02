import logging
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app import models, crud, google_calendar
from pytz import timezone

logger = logging.getLogger(__name__)

def ensure_jst(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    from pytz import timezone
    jst = timezone("Asia/Tokyo")
    if dt.tzinfo is None:
        # DBに保存されている naive な datetime は JST と想定するため、JSTとしてlocalizeする
        return jst.localize(dt)
    return dt.astimezone(jst)

from app.database import SessionLocal
import threading

_task_sync_locks = {}
_task_sync_locks_lock = threading.Lock()

def auto_sync_task_bg(task_id: int):
    """タスク作成/更新時に呼ばれるバックグラウンド処理。"""
    # 同一タスクの並列同期を防ぐロック
    with _task_sync_locks_lock:
        if task_id not in _task_sync_locks:
            _task_sync_locks[task_id] = threading.Lock()
        lock = _task_sync_locks[task_id]
    
    with lock:
        db = SessionLocal()
        try:
            task = crud.get_task(db, task_id)
            if not task:
                return
                
            # 1. 既に手動・自動で同期済みの全ユーザー(admin含む)の予定を更新
            syncs = crud.get_task_google_syncs_for_task(db, task_id=task_id)
            synced_uids = {s.user_id for s in syncs}
            for uid in synced_uids:
                token_row = crud.get_user_google_token(db, uid)
                if token_row:
                    sync_task_to_google(db, task, token_row, uid)
                    
            # 2. まだ同期していないが、条件(担当者、かつ一般ユーザー)を満たす場合は新規同期
            if task.assigned_to and task.assigned_to not in synced_uids:
                user = crud.get_user(db, user_id=task.assigned_to)
                if user and user.role != 'admin':
                    token_row = crud.get_user_google_token(db, task.assigned_to)
                    if token_row:
                        sync_task_to_google(db, task, token_row, task.assigned_to)
        except Exception as e:
            logger.exception("auto_sync_task_bg failed: %s", e)
        finally:
            db.close()

def auto_sync_project_bg(project_id: int):
    """プロジェクト作成/更新時に呼ばれるバックグラウンド処理。"""
    db = SessionLocal()
    try:
        project = crud.get_project(db, project_id)
        if not project:
            return
            
        # 1. 既に同期済みの全ユーザー
        sync_rows = db.query(models.ProjectGoogleSync).filter(models.ProjectGoogleSync.project_id == project_id).all()
        synced_uids = {s.user_id for s in sync_rows}
        for uid in synced_uids:
            token_row = crud.get_user_google_token(db, uid)
            if token_row:
                sync_project_to_google(db, project, token_row, uid)
        
        # 2. 新規自動同期 (このプロジェクトにタスクを持つ一般ユーザー)
        tasks = db.query(models.Task).filter(models.Task.project_id == project_id).all()
        user_ids = set([t.assigned_to for t in tasks if t.assigned_to])
        for uid in user_ids:
            if uid in synced_uids:
                continue
            user = crud.get_user(db, user_id=uid)
            if user and user.role != 'admin':
                token_row = crud.get_user_google_token(db, uid)
                if token_row:
                    sync_project_to_google(db, project, token_row, uid)
                    
        # 3. プロジェクトの状態（オンライン/オフライン）が変わった可能性があるため
        # 紐づく全タスクの同期状態を更新
        db_tasks = db.query(models.Task).filter(models.Task.project_id == project_id).all()
        for t in db_tasks:
            # 各タスクの背後同期を走らせる（同一スレッドではなくTask IDごとのロックがかかる）
            auto_sync_task_bg(t.id)
            
    except Exception as e:
        logger.exception("auto_sync_project_bg failed: %s", e)
    finally:
        db.close()

def auto_sync_event_bg(event_id: int):
    """イベント作成/更新時に呼ばれるバックグラウンド処理。"""
    db = SessionLocal()
    try:
        event = crud.get_event(db, event_id)
        if not event:
            return
            
        # 1. 既に同期済みのユーザー
        sync_rows = db.query(models.EventGoogleSync).filter(models.EventGoogleSync.event_id == event_id).all()
        synced_uids = {s.user_id for s in sync_rows}
        for uid in synced_uids:
            token_row = crud.get_user_google_token(db, uid)
            if token_row:
                sync_event_to_google(db, event, token_row, uid)
                
        # 2. 新規自動同期 (参加者に入っている一般ユーザー)
        participants = event.participants or []
        for p in participants:
            if p.get('type') == 'user':
                uid = p.get('id')
            else:
                uid = p.get('user_id')
            
            if not uid or uid in synced_uids:
                continue
            user = crud.get_user(db, user_id=uid)
            if user and user.role != 'admin':
                token_row = crud.get_user_google_token(db, uid)
                if token_row:
                    sync_event_to_google(db, event, token_row, uid)
    except Exception as e:
        logger.exception("auto_sync_event_bg failed: %s", e)
    finally:
        db.close()

def _ensure_calendar_id(db: Session, token_row: models.UserGoogleToken) -> str | None:
    if token_row.calendar_id:
        return token_row.calendar_id
    
    calendar_id = google_calendar.get_or_create_app_calendar(
        access_token=token_row.access_token,
        refresh_token=token_row.refresh_token,
        expires_at=token_row.expires_at,
    )
    if calendar_id:
        token_row.calendar_id = calendar_id
        db.commit()
    return calendar_id

def sync_task_to_google(db: Session, task: models.Task, token_row: models.UserGoogleToken, user_id: int):
    # プロジェクトの状態を確認
    project = crud.get_project(db, task.project_id) if task.project_id else None
    
    # オフライン設定時はGoogleカレンダーから削除
    # ユーザー要望: プロジェクトがオンラインの内は完了タスクも表示、オフラインなら消す
    is_offline = (task.display_status == 'offline') or (project and project.display_status == 'offline')
    
    sync_id = f"task_{task.id}"
    sync_row = crud.get_task_google_sync(db, user_id, task.id)
    
    if is_offline:
        if sync_row and sync_row.google_event_id:
            # We DONT delete the sync row, just the event in Google.
            # This way we remember the user's intent to sync when it goes back online.
            google_calendar.delete_calendar_event(
                token_row.access_token, token_row.refresh_token, token_row.expires_at,
                sync_row.google_event_id, _ensure_calendar_id(db, token_row)
            )
            # Clear the event ID in our DB to indicate it's not active in Google
            crud.set_task_google_sync(db, user_id, task.id, "")
        return

    start_dt = task.start_date if task.start_date else (task.due_date or datetime.utcnow())
    # In this app, due_date is inclusive. Google Calendar all-day end date is exclusive.
    # So we add 1 day to the due_date.
    end_dt = (task.due_date or start_dt) + timedelta(days=1)
    
    start_jst = ensure_jst(start_dt)
    end_jst = ensure_jst(end_dt)
    
    is_all_day = True
    
    logger.info(f"[Task Sync] task_id={task.id}, user_id={user_id}, start={start_jst}, end={end_jst} (was due={task.due_date}), is_offline={is_offline}")
    
    # 既存の同期行チェック (削除判定より後に行う)
    if not sync_row:
        # DBに記録がない場合でも、Google側に既存イベントがないかチェック (二重作成防止)
        found_event_id = google_calendar.find_event_by_sync_id(
            token_row.access_token, token_row.refresh_token, token_row.expires_at,
            sync_id=sync_id, calendar_id=_ensure_calendar_id(db, token_row)
        )
        if found_event_id:
            logger.info(f"Found orphaned Google event {found_event_id} for task {task.id}, recovering.")
            sync_row = crud.set_task_google_sync(db, user_id, task.id, found_event_id)

    if sync_row and sync_row.google_event_id:
        # Update
        success = google_calendar.update_calendar_event(
            access_token=token_row.access_token,
            refresh_token=token_row.refresh_token,
            expires_at=token_row.expires_at,
            event_id=sync_row.google_event_id,
            task_name=f"[タスク] {task.name}",
            start_date=start_jst,
            end_date=end_jst,
            description=task.description,
            calendar_id=_ensure_calendar_id(db, token_row),
            is_all_day=is_all_day,
            sync_id=sync_id
        )
        if not success:
            logger.warning(f"Failed to update task {task.id}, attempting to re-create.")
            # If update failed (maybe manually deleted or 404), try re-creating
            event_id = google_calendar.create_calendar_event(
                token_row.access_token, token_row.refresh_token, token_row.expires_at,
                task_name=f"[タスク] {task.name}",
                start_date=start_jst,
                end_date=end_jst,
                description=task.description,
                calendar_id=_ensure_calendar_id(db, token_row),
                is_all_day=is_all_day,
                sync_id=sync_id
            )
            if event_id:
                crud.set_task_google_sync(db, user_id, task.id, event_id)
    elif sync_row:
        # Sync record exists but no active Google event ID (e.g. was offline)
        event_id = google_calendar.create_calendar_event(
            access_token=token_row.access_token,
            refresh_token=token_row.refresh_token,
            expires_at=token_row.expires_at,
            task_name=f"[タスク] {task.name}",
            start_date=start_jst,
            end_date=end_jst,
            description=task.description,
            calendar_id=_ensure_calendar_id(db, token_row),
            is_all_day=is_all_day,
            sync_id=sync_id
        )
        if event_id:
            crud.set_task_google_sync(db, user_id, task.id, event_id)
    else:
        # Create
        event_id = google_calendar.create_calendar_event(
            access_token=token_row.access_token,
            refresh_token=token_row.refresh_token,
            expires_at=token_row.expires_at,
            task_name=f"[タスク] {task.name}",
            start_date=start_jst,
            end_date=end_jst,
            description=task.description,
            calendar_id=_ensure_calendar_id(db, token_row),
            is_all_day=is_all_day,
            sync_id=sync_id
        )
        if event_id:
            crud.set_task_google_sync(db, user_id, task.id, event_id)
        else:
            logger.error(f"Failed to create task {task.id} in Google Calendar")

def sync_project_to_google(db: Session, project: models.Project, token_row: models.UserGoogleToken, user_id: int):
    sync_id = f"project_{project.id}"
    sync_row = crud.get_project_google_sync(db, user_id, project.id)
    
    # オフライン時は削除（紐付けレコードは残してIDだけ消す）
    if project.display_status == 'offline':
        if sync_row and sync_row.google_event_id:
            google_calendar.delete_calendar_event(
                token_row.access_token, token_row.refresh_token, token_row.expires_at,
                sync_row.google_event_id, _ensure_calendar_id(db, token_row)
            )
            crud.set_project_google_sync(db, user_id, project.id, "")
        return

    start_dt = project.start_date or datetime.utcnow()
    # Project end_date from DB is inclusive (YYYY-MM-DD), so we add 1 day for Google's exclusive end.
    end_dt = (project.end_date or start_dt) + timedelta(days=1)
    
    start_jst = ensure_jst(start_dt)
    end_jst = ensure_jst(end_dt)
    is_all_day = True # Projects are shown as all-day events
    
    if not sync_row:
        # Deduplication
        found_event_id = google_calendar.find_event_by_sync_id(
            token_row.access_token, token_row.refresh_token, token_row.expires_at,
            sync_id=sync_id, calendar_id=_ensure_calendar_id(db, token_row)
        )
        if found_event_id:
            logger.info(f"Found orphaned Google event {found_event_id} for project {project.id}, recovering.")
            sync_row = crud.set_project_google_sync(db, user_id, project.id, found_event_id)

    if sync_row and sync_row.google_event_id:
        success = google_calendar.update_calendar_event(
            access_token=token_row.access_token,
            refresh_token=token_row.refresh_token,
            expires_at=token_row.expires_at,
            event_id=sync_row.google_event_id,
            task_name=f"[プロジェクト] {project.name}",
            start_date=start_jst,
            end_date=end_jst,
            description=project.description,
            calendar_id=_ensure_calendar_id(db, token_row),
            is_all_day=is_all_day,
            sync_id=sync_id
        )
        if not success:
            logger.warning(f"Failed to update project {project.id}, attempting to re-create.")
            event_id = google_calendar.create_calendar_event(
                token_row.access_token, token_row.refresh_token, token_row.expires_at,
                task_name=f"[プロジェクト] {project.name}",
                start_date=start_jst,
                end_date=end_jst,
                description=project.description,
                calendar_id=_ensure_calendar_id(db, token_row),
                is_all_day=is_all_day,
                sync_id=sync_id
            )
            if event_id:
                crud.set_project_google_sync(db, user_id, project.id, event_id)
    elif sync_row:
        # 紐付けはあるがGoogle側にイベントがない場合
        event_id = google_calendar.create_calendar_event(
            access_token=token_row.access_token,
            refresh_token=token_row.refresh_token,
            expires_at=token_row.expires_at,
            task_name=f"[プロジェクト] {project.name}",
            start_date=start_jst,
            end_date=end_jst,
            description=project.description,
            calendar_id=_ensure_calendar_id(db, token_row),
            is_all_day=is_all_day,
            sync_id=sync_id
        )
        if event_id:
            crud.set_project_google_sync(db, user_id, project.id, event_id)
    else:
        event_id = google_calendar.create_calendar_event(
            access_token=token_row.access_token,
            refresh_token=token_row.refresh_token,
            expires_at=token_row.expires_at,
            task_name=f"[プロジェクト] {project.name}",
            start_date=start_jst,
            end_date=end_jst,
            description=project.description,
            calendar_id=_ensure_calendar_id(db, token_row),
            is_all_day=is_all_day,
            sync_id=sync_id
        )
        if event_id:
            crud.set_project_google_sync(db, user_id, project.id, event_id)
        else:
            logger.error(f"Failed to create project {project.id} in Google Calendar")

def sync_event_to_google(db: Session, event: models.Event, token_row: models.UserGoogleToken, user_id: int):
    sync_id = f"event_{event.id}"
    sync_row = crud.get_event_google_sync(db, user_id, event.id)
    
    # オフライン設定時はGoogleカレンダーから削除（ただし同期記録は保持）
    if event.status == 'offline': 
        if sync_row and sync_row.google_event_id:
            google_calendar.delete_calendar_event(
                token_row.access_token, token_row.refresh_token, token_row.expires_at,
                sync_row.google_event_id, _ensure_calendar_id(db, token_row)
            )
            crud.set_event_google_sync(db, user_id, event.id, "")
        return

    start_dt = event.start_time
    end_dt = event.end_time
    
    start_jst = ensure_jst(start_dt)
    end_jst = ensure_jst(end_dt)
    is_all_day = bool(event.allDay)
    
    # If it's an all-day event, the end_time in our DB is already the exclusive end (next day 00:00).
    # Google Calendar also expects the exclusive end date for all-day events.
    #google_calendar logic already adds +1 day to the date part, so we need to be careful.
    # However, if we change google_calendar.py to NOT add +1, it's cleaner.
    # Let's keep the sync logic here passing what Google expects, 
    # but we'll modify google_calendar.py to be a simple pass-through for the date part.
    
    if not sync_row:
        # Deduplication
        found_event_id = google_calendar.find_event_by_sync_id(
            token_row.access_token, token_row.refresh_token, token_row.expires_at,
            sync_id=sync_id, calendar_id=_ensure_calendar_id(db, token_row)
        )
        if found_event_id:
            logger.info(f"Found orphaned Google event {found_event_id} for event {event.id}, recovering.")
            sync_row = crud.set_event_google_sync(db, user_id, event.id, found_event_id)

    if sync_row and sync_row.google_event_id:
        success = google_calendar.update_calendar_event(
            access_token=token_row.access_token,
            refresh_token=token_row.refresh_token,
            expires_at=token_row.expires_at,
            event_id=sync_row.google_event_id,
            task_name=f"[{event.type}] {event.title}",
            start_date=start_jst,
            end_date=end_jst,
            description=event.description,
            calendar_id=_ensure_calendar_id(db, token_row),
            is_all_day=is_all_day,
            sync_id=sync_id
        )
        if not success:
            logger.warning(f"Failed to update event {event.id}, attempting to re-create.")
            event_id = google_calendar.create_calendar_event(
                token_row.access_token, token_row.refresh_token, token_row.expires_at,
                task_name=f"[{event.type}] {event.title}",
                start_date=start_jst,
                end_date=end_jst,
                description=event.description,
                calendar_id=_ensure_calendar_id(db, token_row),
                is_all_day=is_all_day,
                sync_id=sync_id
            )
            if event_id:
                crud.set_event_google_sync(db, user_id, event.id, event_id)
    elif sync_row:
        # Sync enabled but missing Google event
        event_id = google_calendar.create_calendar_event(
            access_token=token_row.access_token,
            refresh_token=token_row.refresh_token,
            expires_at=token_row.expires_at,
            task_name=f"[{event.type}] {event.title}",
            start_date=start_jst,
            end_date=end_jst,
            description=event.description,
            calendar_id=_ensure_calendar_id(db, token_row),
            is_all_day=is_all_day,
            sync_id=sync_id
        )
        if event_id:
            crud.set_event_google_sync(db, user_id, event.id, event_id)
    else:
        event_id = google_calendar.create_calendar_event(
            access_token=token_row.access_token,
            refresh_token=token_row.refresh_token,
            expires_at=token_row.expires_at,
            task_name=f"[{event.type}] {event.title}",
            start_date=start_jst,
            end_date=end_jst,
            description=event.description,
            calendar_id=_ensure_calendar_id(db, token_row),
            is_all_day=is_all_day,
            sync_id=sync_id
        )
        if event_id:
            crud.set_event_google_sync(db, user_id, event.id, event_id)
        else:
            logger.error(f"Failed to create event {event.id} in Google Calendar")

def initial_sync_for_user(db: Session, user_id: int):
    token_row = crud.get_user_google_token(db, user_id)
    if not token_row:
        return

    # 1. Sync tasks assigned to the user
    # 一般ユーザーの場合は自分が担当のものを同期
    tasks = db.query(models.Task).filter(models.Task.assigned_to == user_id).all()
    for task in tasks:
        sync_task_to_google(db, task, token_row, user_id)
        
    # 2. Sync projects the user is involved in (via tasks)
    project_ids = set([t.project_id for t in tasks if t.project_id])
    if project_ids:
        projects = db.query(models.Project).filter(models.Project.id.in_(project_ids)).all()
        for project in projects:
            sync_project_to_google(db, project, token_row, user_id)
            
    # 3. Sync events the user is participating in
    all_events = db.query(models.Event).all()
    for evt in all_events:
        participants = evt.participants or []
        is_participant = False
        for p in participants:
            uid = p.get('id') if p.get('type') == 'user' else p.get('user_id')
            if str(uid) == str(user_id):
                is_participant = True
                break
        if is_participant:
            sync_event_to_google(db, evt, token_row, user_id)

def initial_sync_for_user_bg(user_id: int):
    db = SessionLocal()
    try:
        initial_sync_for_user(db, user_id)
    except Exception as e:
        logger.exception("initial_sync_for_user_bg failed: %s", e)
    finally:
        db.close()
