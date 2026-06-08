import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks
from sqlalchemy.orm import Session

from .. import crud, models, schemas, security, google_calendar as google_cal
from ..database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/calendar/events", tags=["Events"])

@router.get("", response_model=List[schemas.EventResponse])
async def get_events_endpoint(
    project_id: Optional[str] = Query(None, description="プロジェクトIDでフィルタリング"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
    skip: int = 0,
    limit: int = 1000
):
    """イベントのリストを取得"""
    project_id_int: Optional[int] = None
    if project_id is not None:
        project_id_int = crud._parse_int_safe(project_id)
        if project_id_int is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="無効なプロジェクトID形式です。")

    events = crud.get_events(db=db, skip=skip, limit=limit, project_id=project_id_int)
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
    created_event = crud.create_event(db=db, event=event_data)

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

    updated_event = crud.update_event(db=db, db_event=db_event, event_in=event_data)

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
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    """イベントを削除（管理者のみ）"""
    db_event = crud.get_event(db=db, event_id=event_id)
    if db_event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    if current_user.role != 'admin':
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="イベントを削除する権限がありません")

    if google_cal.is_google_configured():
        from app.services.google_sync import delete_event_syncs
        delete_event_syncs(db, event_id)

    crud.delete_event(db=db, db_event=db_event)
    return None
