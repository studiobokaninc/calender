import logging
from typing import List, Optional
from sqlalchemy.orm import Session
from .. import models, schemas
from ..timezone import now_jst_naive
from .base import _parse_datetime

logger = logging.getLogger(__name__)

def get_event(db: Session, event_id: int) -> Optional[models.Event]:
    """ID でイベントを取得"""
    return db.query(models.Event).filter(models.Event.id == event_id).first()

def get_events(db: Session, skip: int = 0, limit: int = 100, project_id: Optional[int] = None) -> List[models.Event]:
    """イベントを取得"""
    query = db.query(models.Event)
    if project_id:
        query = query.filter(models.Event.project_id == project_id)
    return query.offset(skip).limit(limit).all()

def create_event(db: Session, event: schemas.EventCreate) -> models.Event:
    """新規イベントを作成"""
    db_event = models.Event(
        title=event.title,
        description=event.description,
        type=event.type,
        location=event.location,
        allDay=event.allDay,
        start_time=_parse_datetime(event.start_time),
        end_time=_parse_datetime(event.end_time),
        status=event.status or 'offline',
        project_id=event.project_id,
        participants=event.participants or []
    )
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    return db_event

def update_event(db: Session, db_event: models.Event, event_in: schemas.EventUpdate) -> models.Event:
    """イベント情報を更新"""
    update_data = event_in.dict(exclude_unset=True)
    for key, value in update_data.items():
        if key in ["start_time", "end_time"]:
            value = _parse_datetime(value)
        if hasattr(db_event, key):
            setattr(db_event, key, value)
    
    db_event.updated_at = now_jst_naive()
    db.commit()
    db.refresh(db_event)
    return db_event

def delete_event(db: Session, db_event: models.Event) -> None:
    """イベントを削除"""
    db.delete(db_event)
    db.commit()
