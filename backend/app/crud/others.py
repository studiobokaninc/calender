import logging
from datetime import datetime, timedelta
from typing import List, Optional, Any, Dict
from sqlalchemy.orm import Session
from sqlalchemy import text, or_, and_, func

from .. import models, schemas
from ..timezone import now_jst_naive

logger = logging.getLogger(__name__)

# --- Status History ---
def create_status_history(db: Session, task_id: int, status_history: schemas.StatusHistoryCreate) -> models.TaskStatusHistory:
    db_history = models.TaskStatusHistory(
        task_id=task_id,
        status=status_history.status,
        changed_by=status_history.changed_by,
        changed_at=status_history.changed_at or now_jst_naive()
    )
    db.add(db_history)
    db.commit()
    db.refresh(db_history)
    return db_history

def get_task_status_history(db: Session, task_id: int) -> List[models.TaskStatusHistory]:
    return db.query(models.TaskStatusHistory).filter(models.TaskStatusHistory.task_id == task_id).order_by(models.TaskStatusHistory.changed_at).all()

def get_status_change_metrics(db: Session, start_date: Optional[datetime] = None, end_date: Optional[datetime] = None, project_id: Optional[int] = None) -> List[Dict[str, Any]]:
    query = db.query(
        func.date(models.TaskStatusHistory.changed_at).label("date"),
        models.TaskStatusHistory.status,
        func.count(models.TaskStatusHistory.id).label("count")
    )
    if start_date: query = query.filter(models.TaskStatusHistory.changed_at >= start_date)
    if end_date: query = query.filter(models.TaskStatusHistory.changed_at <= end_date)
    if project_id:
        query = query.join(models.Task).filter(models.Task.project_id == project_id)
    
    query = query.group_by("date", models.TaskStatusHistory.status)
    results = query.all()
    return [{"date": r.date, "status": r.status, "count": r.count} for r in results]

# --- User Activity ---
def get_cycle_date(dt: datetime) -> datetime:
    if dt.hour < 5:
        return (dt - timedelta(days=1)).replace(hour=5, minute=0, second=0, microsecond=0)
    return dt.replace(hour=5, minute=0, second=0, microsecond=0)

def create_user_activity(db: Session, user_id: int, active_at: Optional[datetime] = None) -> models.UserActivity:
    active_at = active_at or now_jst_naive()
    cycle_date = get_cycle_date(active_at)
    db_activity = models.UserActivity(user_id=user_id, active_at=active_at, cycle_date=cycle_date)
    db.add(db_activity)
    db.commit()
    db.refresh(db_activity)
    return db_activity

def get_user_activities(db: Session, user_id: Optional[int] = None, cycle_date: Optional[datetime] = None, skip: int = 0, limit: int = 10000) -> List[models.UserActivity]:
    query = db.query(models.UserActivity)
    if user_id is not None:
        query = query.filter(models.UserActivity.user_id == user_id)
    if cycle_date is not None:
        cycle_date_only = cycle_date.date()
        query = query.filter(func.date(models.UserActivity.cycle_date) == cycle_date_only)
    return query.order_by(models.UserActivity.active_at.desc()).offset(skip).limit(limit).all()

def get_user_activities_by_cycle(db: Session, cycle_date: Optional[datetime] = None, skip: int = 0, limit: int = 10000) -> List[models.UserActivity]:
    if cycle_date is None:
        cycle_date = get_cycle_date(now_jst_naive())
    return get_user_activities(db, user_id=None, cycle_date=cycle_date, skip=skip, limit=limit)

# --- Google Calendar Upsert ---
def upsert_user_google_token(db: Session, user_id: int, access_token: str, refresh_token: Optional[str] = None, expires_at: Optional[datetime] = None, calendar_id: Optional[str] = None):
    token = db.query(models.UserGoogleToken).filter(models.UserGoogleToken.user_id == user_id).first()
    if token:
        token.access_token = access_token
        if refresh_token: token.refresh_token = refresh_token
        if expires_at: token.expires_at = expires_at
        if calendar_id: token.calendar_id = calendar_id
        token.updated_at = now_jst_naive()
    else:
        token = models.UserGoogleToken(user_id=user_id, access_token=access_token, refresh_token=refresh_token, expires_at=expires_at, calendar_id=calendar_id)
        db.add(token)
    db.commit()
    db.refresh(token)
    return token

def delete_user_google_token(db: Session, user_id: int):
    db.query(models.UserGoogleToken).filter(models.UserGoogleToken.user_id == user_id).delete()
    db.commit()
