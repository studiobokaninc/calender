import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks
from sqlalchemy.orm import Session

from .. import crud, models, schemas, security, google_calendar as google_cal
from ..database import get_db
from ..crud import events_bulk

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/calendar/events", tags=["Events"])

@router.get("", response_model=List[schemas.EventResponse])
async def get_events_endpoint(
    project_id: Optional[str] = Query(None, description="プロジェクトIDでフィルタリング"),
    start_date: Optional[str] = Query(None, description="取得開始日時 ISO8601 (例: 2026-06-01T00:00:00)"),
    end_date: Optional[str] = Query(None, description="取得終了日時 ISO8601 (例: 2026-07-31T23:59:59)"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
    skip: int = 0,
    limit: int = 1000
):
    """イベントのリストを取得"""
    from datetime import datetime as dt
    project_id_int: Optional[int] = None
    if project_id is not None:
        project_id_int = crud._parse_int_safe(project_id)
        if project_id_int is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="無効なプロジェクトID形式です。")

    start_dt = dt.fromisoformat(start_date) if start_date else None
    end_dt = dt.fromisoformat(end_date) if end_date else None

    from ..recurrence import RecurrenceError
    try:
        events = crud.get_events(db=db, skip=skip, limit=limit, project_id=project_id_int, start_date=start_dt, end_date=end_dt)
    except RecurrenceError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return events


@router.get("/{event_id}", response_model=schemas.EventResponse)
async def get_event_endpoint(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """1件のイベントを取得"""
    db_event = crud.get_event(db=db, event_id=event_id)
    if db_event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="イベントが見つかりません")
    return db_event


@router.post("", response_model=schemas.EventResponse, status_code=status.HTTP_201_CREATED)
async def create_event_endpoint(
    event_data: schemas.EventCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    """新規イベントを作成"""
    from ..recurrence import RecurrenceError
    try:
        created_event = crud.create_event(db=db, event=event_data)
    except RecurrenceError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))

    from app.services.google_sync import auto_sync_event_bg
    background_tasks.add_task(auto_sync_event_bg, created_event.id)

    from app.utils.webhook_sender import send_webhook
    background_tasks.add_task(send_webhook, "event.created", {
        "event_id": created_event.id,
        "title": created_event.title,
        "start_at": created_event.start_time.isoformat() if created_event.start_time else None,
        "end_at": created_event.end_time.isoformat() if created_event.end_time else None,
        "attendees": created_event.user_ids or [],
        "description": created_event.description,
        "location": created_event.location,
        "zoom_url": created_event.meeting_url,
    })

    return created_event


@router.put("/{event_id}", response_model=schemas.EventResponse)
async def update_event_endpoint(
    event_id: int,
    event_data: schemas.EventUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    """イベント情報を更新"""
    db_event = crud.get_event(db=db, event_id=event_id)
    if db_event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    # 管理者以外はステータス変更不可
    if event_data.status is not None and db_event.status != event_data.status:
        if current_user.role != 'admin':
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="イベントステータスを変更する権限がありません")

    from ..recurrence import RecurrenceError
    try:
        updated_event = crud.update_event(db=db, db_event=db_event, event_in=event_data)
    except RecurrenceError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))

    from app.services.google_sync import auto_sync_event_bg
    background_tasks.add_task(auto_sync_event_bg, updated_event.id)

    from app.utils.webhook_sender import send_webhook
    background_tasks.add_task(send_webhook, "event.updated", {
        "event_id": updated_event.id,
        "title": updated_event.title,
        "start_at": updated_event.start_time.isoformat() if updated_event.start_time else None,
        "end_at": updated_event.end_time.isoformat() if updated_event.end_time else None,
        "attendees": updated_event.user_ids or [],
        "description": updated_event.description,
        "location": updated_event.location,
        "zoom_url": updated_event.meeting_url,
        "updated_by": current_user.id,
    })

    return updated_event


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event_endpoint(
    event_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    """イベントを削除（管理者のみ）"""
    db_event = crud.get_event(db=db, event_id=event_id)
    if db_event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    if current_user.role != 'admin':
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="イベントを削除する権限がありません")

    webhook_payload = {
        "event_id": db_event.id,
        "title": db_event.title,
        "start_at": db_event.start_time.isoformat() if db_event.start_time else None,
        "end_at": db_event.end_time.isoformat() if db_event.end_time else None,
        "attendees": db_event.user_ids or [],
        "deleted_by": current_user.id,
    }

    if google_cal.is_google_configured():
        from app.services.google_sync import delete_event_syncs
        delete_event_syncs(db, event_id)

    crud.delete_event(db=db, db_event=db_event)

    from app.utils.webhook_sender import send_webhook
    background_tasks.add_task(send_webhook, "event.deleted", webhook_payload)

    return None


# --- 一括操作 (cmd_731 四) -------------------------------------------------
# 雛形: routers/tasks.py の POST /bulk-update。all-or-nothing。権限は単体操作に揃える
# (status 変更・削除は admin のみ)。本ルーターは /calendar/events と /api/calendar/events の
# 二重マウントゆえ、下記の口も両系統に生える。
def _bulk_http_error(exc: "events_bulk.EventBulkError") -> HTTPException:
    return HTTPException(status_code=exc.http_status, detail=exc.detail)


@router.post("/bulk-update")
async def bulk_update_events_endpoint(
    payload: events_bulk.EventBulkUpdateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """複数予定を一括更新(1件でも違反があれば1件も変更しない)"""
    if not payload.event_ids:
        return {"updated": 0, "message": "対象予定が指定されていません"}

    updates = events_bulk.collect_updates(payload)
    if not updates:
        return {"updated": 0, "message": "更新項目が指定されていません"}

    try:
        events = events_bulk.bulk_update_events(
            db=db, event_ids=payload.event_ids, updates=updates, is_admin=(current_user.role == 'admin'),
        )
    except events_bulk.EventBulkError as exc:
        raise _bulk_http_error(exc)

    # Google同期は予定の件数ぶん積まず、1本の処理が予定のループを内側に持つ
    from app.services.google_sync import auto_sync_events_bg
    background_tasks.add_task(auto_sync_events_bg, [e.id for e in events])

    # webhook: 単体 PUT と同じ event.updated・同じ payload を予定ごとに、1本の処理で直列に送る
    background_tasks.add_task(
        events_bulk.send_webhooks_serial,
        [("event.updated", events_bulk.event_webhook_payload(e, current_user.id)) for e in events],
    )

    return {"updated": len(events), "message": f"{len(events)}件の予定を更新しました"}


@router.post("/bulk-delete")
async def bulk_delete_events_endpoint(
    payload: events_bulk.EventBulkDeleteRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """複数予定を一括削除(管理者のみ。1件でも存在しなければ1件も消さない)"""
    if not payload.event_ids:
        return {"deleted": 0, "message": "対象予定が指定されていません"}

    ids = list(dict.fromkeys(payload.event_ids))
    is_admin = current_user.role == 'admin'
    try:
        # 検証だけ先に通す(消す前に Google側の解除をしてしまわぬため)
        events_bulk.validate_bulk_delete(db, ids, is_admin)
    except events_bulk.EventBulkError as exc:
        raise _bulk_http_error(exc)

    if google_cal.is_google_configured():
        from app.services.google_sync import delete_events_syncs
        delete_events_syncs(db, ids)

    try:
        payloads = events_bulk.bulk_delete_events(db=db, event_ids=ids, is_admin=True)
    except events_bulk.EventBulkError as exc:
        raise _bulk_http_error(exc)

    background_tasks.add_task(
        events_bulk.send_webhooks_serial,
        [("event.deleted", {**p, "deleted_by": current_user.id}) for p in payloads],
    )

    return {"deleted": len(payloads), "message": f"{len(payloads)}件の予定を削除しました"}
