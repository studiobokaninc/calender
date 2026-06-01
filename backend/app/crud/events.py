import logging
from typing import List, Optional
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from .. import models, schemas
from ..timezone import now_jst_naive
from .base import _parse_datetime

logger = logging.getLogger(__name__)

def _apply_date_time_fields(update_dict: dict, start_time: Optional[datetime], end_time: Optional[datetime], all_day_flag: bool):
    """
    date, time, duration_minutes の指定に基づいて start_time, end_time, allDay を調整して更新ディクショナリを返す。
    """
    # date, time, duration_minutes のいずれも含まれていない場合は何もしない
    if 'date' not in update_dict and 'time' not in update_dict and 'duration_minutes' not in update_dict:
        # 仮想フィールド自体は DB モデルに反映しないよう削除
        for virtual_key in ['date', 'time', 'duration_minutes']:
            if virtual_key in update_dict:
                del update_dict[virtual_key]
        return

    target_date = update_dict.get('date')
    target_time = update_dict.get('time')
    duration = update_dict.get('duration_minutes')
    
    # 既存の値からフォールバック
    if not target_date and start_time:
        target_date = start_time.date().isoformat()
        
    if target_date:
        # time が明示的に指定されている、または time フィールドが存在して値がある場合
        if 'time' in update_dict:
            time_val = update_dict['time']
        elif start_time and not all_day_flag:
            time_val = start_time.time().strftime("%H:%M")
        else:
            time_val = None
            
        if time_val:
            time_clean = str(time_val).strip()
            start_dt = _parse_datetime(f"{target_date}T{time_clean}:00")
            update_dict['allDay'] = False
        else:
            start_dt = _parse_datetime(f"{target_date}T00:00:00")
            update_dict['allDay'] = True
            
        update_dict['start_time'] = start_dt
        
        # 期間の計算
        if duration is not None:
            dur_mins = int(duration)
        elif start_time and end_time:
            dur_mins = int((end_time - start_time).total_seconds() / 60)
        else:
            dur_mins = 60 # デフォルト1時間
            
        if start_dt:
            update_dict['end_time'] = start_dt + timedelta(minutes=dur_mins)
            
    # 仮想フィールド自体は DB モデルに反映しないよう削除
    for virtual_key in ['date', 'time', 'duration_minutes']:
        if virtual_key in update_dict:
            del update_dict[virtual_key]

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
    event_dict = event.dict(exclude_unset=True)
    
    start_time = _parse_datetime(event.start_time)
    end_time = _parse_datetime(event.end_time)
    all_day_flag = event.allDay or False
    
    _apply_date_time_fields(event_dict, start_time, end_time, all_day_flag)
    
    final_start = event_dict.get('start_time') or start_time
    final_end = event_dict.get('end_time') or end_time
    final_allday = event_dict.get('allDay') if 'allDay' in event_dict else all_day_flag
    
    db_event = models.Event(
        title=event.title,
        description=event.description,
        type=event.type,
        location=event.location,
        allDay=final_allday,
        start_time=final_start,
        end_time=final_end,
        status=event.status or 'offline',
        project_id=event.project_id,
        participants=event.participants or [],
        user_ids=event.user_ids or []
    )
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    return db_event

def update_event(db: Session, db_event: models.Event, event_in: schemas.EventUpdate) -> models.Event:
    """イベント情報を更新"""
    update_data = event_in.dict(exclude_unset=True)
    
    _apply_date_time_fields(
        update_data, 
        db_event.start_time, 
        db_event.end_time, 
        db_event.allDay or False
    )
    
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
