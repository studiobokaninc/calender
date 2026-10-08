import logging
from typing import List, Optional
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from .. import models, schemas
from ..timezone import now_jst_naive
from .base import _parse_datetime
from .. import recurrence

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

def collect_with_recurrence(base_query, plain_criteria, window_start, window_end, keep=None):
    """定例の展開を三経路で共有する入口(展開そのものは recurrence.expand_events)。

    base_query: 経路ごとの期間以外の絞り込みを済ませた Event のクエリ。
    plain_criteria: 規則を持たぬ予定に当てる期間条件(経路ごとの従来の当て方)のリスト。
    keep(start, end): 展開した各回に当てる、同じ当て方の述語。
    戻り値: 展開が要る時だけ「規則なし(従来どおり絞込み済)+展開した回」のリスト。
            展開不要(期間が両端でない・期間に掛かる定例が無い)なら None → 呼び側は従来の経路を通る。
    """
    if plain_criteria is None or window_start is None or window_end is None:
        return None
    # DBの start_time は naive。tz 付きの期間は換算せず tzinfo だけ落とす(SQL側の比較・規則なし予定の当たり方と揃える)
    # keep は呼び側の(tz付きのままの)期間を閉包で持つ為、回の時刻へ同じ tzinfo を付け直して渡す(数値は不変)
    if keep is not None and (window_start.tzinfo is not None or window_end.tzinfo is not None):
        _keep, _tz_s, _tz_e = keep, window_start.tzinfo, window_end.tzinfo
        keep = lambda s, e: _keep(s.replace(tzinfo=_tz_s), e.replace(tzinfo=_tz_e))
    if window_start.tzinfo is not None:
        window_start = window_start.replace(tzinfo=None)
    if window_end.tzinfo is not None:
        window_end = window_end.replace(tzinfo=None)
    rec_rows = base_query.filter(
        models.Event.recurrence_rule.isnot(None),
        models.Event.start_time <= window_end,
    ).all()
    if not rec_rows:
        return None
    plain = base_query.filter(models.Event.recurrence_rule.is_(None), *plain_criteria).all()
    return recurrence.expand_events(plain + rec_rows, window_start, window_end, keep=keep)

def get_events(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    project_id: Optional[int] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
) -> List[models.Event]:
    """イベントを取得

    start_date・end_date が両方指定され、かつ期間に掛かる定例(recurrence_rule 持ち)が在る時のみ、
    規則を読み出し時に展開して返す(recurrence.expand_events)。それ以外は従来どおり。
    展開の上限を超える問いは recurrence.RecurrenceError。
    """
    query = db.query(models.Event)
    if project_id:
        query = query.filter(models.Event.project_id == project_id)
    expanded = collect_with_recurrence(
        query,
        [models.Event.end_time >= start_date, models.Event.start_time <= end_date]
        if (start_date is not None and end_date is not None) else None,
        start_date, end_date,
        keep=lambda s, e: e >= start_date and s <= end_date,
    )
    if expanded is not None:
        expanded.sort(key=recurrence.sort_key_desc, reverse=True)
        return expanded[skip:skip + limit]
    if start_date is not None:
        query = query.filter(models.Event.end_time >= start_date)
    if end_date is not None:
        query = query.filter(models.Event.start_time <= end_date)
    return query.order_by(models.Event.start_time.desc(), models.Event.id.desc()).offset(skip).limit(limit).all()

def _derive_user_ids_from_participants(participants: Optional[List[dict]]) -> List[int]:
    """participants リストから user_ids を自動補完する"""
    if not participants or not isinstance(participants, list):
        return []
    derived = []
    for item in participants:
        if isinstance(item, dict):
            val_id = item.get("id")
            if val_id is not None:
                try:
                    user_id_int = int(val_id)
                    if user_id_int not in derived:
                        derived.append(user_id_int)
                except (ValueError, TypeError):
                    pass
    return derived

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
    
    final_user_ids = event.user_ids or []
    if not final_user_ids and event.participants:
        final_user_ids = _derive_user_ids_from_participants(event.participants)

    recurrence.validate_rule_for_start(event.recurrence_rule, final_start)

    db_event = models.Event(
        title=event.title,
        description=event.description,
        type=event.type,
        location=event.location,
        meeting_url=event.meeting_url,
        allDay=final_allday,
        start_time=final_start,
        end_time=final_end,
        status=event.status or 'offline',
        project_id=event.project_id,
        participants=event.participants or [],
        user_ids=final_user_ids,
        recurrence_rule=event.recurrence_rule or None,
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
    
    if "recurrence_rule" in update_data or "start_time" in update_data:
        new_start = update_data.get("start_time", db_event.start_time)
        if "start_time" in update_data:
            new_start = _parse_datetime(new_start)
        new_rule = update_data["recurrence_rule"] if "recurrence_rule" in update_data else db_event.recurrence_rule
        recurrence.validate_rule_for_start(new_rule, new_start)

    for key, value in update_data.items():
        if key in ["start_time", "end_time"]:
            value = _parse_datetime(value)
        if key == "recurrence_rule":
            value = value or None
        if hasattr(db_event, key):
            setattr(db_event, key, value)
    
    if (not db_event.user_ids or len(db_event.user_ids) == 0) and db_event.participants:
        derived = _derive_user_ids_from_participants(db_event.participants)
        if derived:
            db_event.user_ids = derived

    db_event.updated_at = now_jst_naive()
    db.commit()
    db.refresh(db_event)
    return db_event


def delete_event(db: Session, db_event: models.Event) -> None:
    """イベントを削除"""
    db.delete(db_event)
    db.commit()
