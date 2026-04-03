import logging
from typing import List, Optional
from sqlalchemy.orm import Session
from .. import models, schemas
from ..timezone import now_jst_naive

logger = logging.getLogger(__name__)

def get_meeting(db: Session, meeting_id: int) -> Optional[models.Meeting]:
    """ID で議事録を取得"""
    return db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()

def get_meetings_by_project(db: Session, project_id: int, skip: int = 0, limit: int = 100) -> List[models.Meeting]:
    """プロジェクト別の議事録リストを取得"""
    return db.query(models.Meeting).filter(models.Meeting.project_id == project_id).order_by(models.Meeting.date.desc()).offset(skip).limit(limit).all()

def create_meeting(db: Session, meeting: schemas.MeetingCreate) -> models.Meeting:
    """新規議事録を作成"""
    db_meeting = models.Meeting(
        title=meeting.title,
        project_id=meeting.project_id,
        date=meeting.date or now_jst_naive(),
        version_group=meeting.version_group,
        created_at=now_jst_naive(),
        updated_at=now_jst_naive()
    )
    db.add(db_meeting)
    db.commit()
    db.refresh(db_meeting)
    return db_meeting

def update_meeting(db: Session, db_meeting: models.Meeting, updates: dict) -> models.Meeting:
    """議事録情報を更新"""
    for key, value in updates.items():
        if hasattr(db_meeting, key):
            setattr(db_meeting, key, value)
    db_meeting.updated_at = now_jst_naive()
    db.commit()
    db.refresh(db_meeting)
    return db_meeting

def delete_meeting(db: Session, db_meeting: models.Meeting) -> models.Meeting:
    """議事録を削除"""
    db.delete(db_meeting)
    db.commit()
    return db_meeting

# Decision CRUD
def create_decision(db: Session, decision: schemas.DecisionCreate) -> models.Decision:
    """決定事項を作成"""
    db_decision = models.Decision(
        meeting_id=decision.meeting_id,
        content=decision.content,
        date=decision.date or now_jst_naive(),
        superseded=decision.superseded,
        project_id=decision.project_id
    )
    db.add(db_decision)
    db.commit()
    db.refresh(db_decision)
    return db_decision

def get_decisions(db: Session, project_id: Optional[int] = None, meeting_id: Optional[int] = None, superseded: Optional[bool] = None) -> List[models.Decision]:
    """決定事項を取得"""
    query = db.query(models.Decision)
    if project_id is not None:
        query = query.filter(models.Decision.project_id == project_id)
    if meeting_id is not None:
        query = query.filter(models.Decision.meeting_id == meeting_id)
    if superseded is not None:
        query = query.filter(models.Decision.superseded == superseded)
    return query.order_by(models.Decision.date.desc()).all()

def get_latest_meeting(db: Session, project_id: Optional[int] = None) -> Optional[models.Meeting]:
    """最新の完了済み議事録を1件取得"""
    query = db.query(models.Meeting).filter(models.Meeting.status == "completed")
    if project_id:
        query = query.filter(models.Meeting.project_id == project_id)
    return query.order_by(models.Meeting.date.desc()).first()

def update_decision(db: Session, db_decision: models.Decision, updates: dict) -> models.Decision:
    """決定事項を更新"""
    for key, value in updates.items():
        if hasattr(db_decision, key):
            setattr(db_decision, key, value)
    db.commit()
    db.refresh(db_decision)
    return db_decision

def get_all_meeting_summaries(db: Session, project_id: Optional[int] = None) -> str:
    """全議事録の要約を返す（AI用）"""
    query = db.query(models.Meeting).filter(models.Meeting.status == "completed")
    if project_id:
        query = query.filter(models.Meeting.project_id == project_id)
    items = query.order_by(models.Meeting.date.desc()).all()
    
    if not items:
        return "利用可能な議事録はありません。"
        
    context = ""
    for item in items:
        date_str = item.date.strftime("%Y-%m-%d") if item.date else "不明"
        context += f"- 【会議：{item.title}】 (ID: {item.id}, 日付: {date_str}, グループ: {item.version_group or 'なし'})\n"
        if item.decisions:
            context += f"  決定事項: {', '.join(item.decisions[:10])}\n"
        if item.tasks:
            context += f"  タスク: {', '.join(item.tasks[:5])}...\n"
    return context
