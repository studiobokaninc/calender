import logging
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_, cast, String

from .. import models

logger = logging.getLogger(__name__)

def search_projects(db: Session, q: str, limit: int = 10) -> List[models.Project]:
    """検索文字列でプロジェクトを検索"""
    search_filter = or_(
        models.Project.name.ilike(f"%{q}%"),
        models.Project.description.ilike(f"%{q}%")
    )
    return db.query(models.Project).filter(search_filter).limit(limit).all()

def search_tasks(db: Session, q: str, limit: int = 10) -> List[models.Task]:
    """検索文字列でタスクを検索"""
    search_filter = or_(
        models.Task.name.ilike(f"%{q}%"),
        models.Task.description.ilike(f"%{q}%")
    )
    return db.query(models.Task).filter(search_filter).limit(limit).all()

def search_events(db: Session, q: str, limit: int = 10) -> List[models.Event]:
    """検索文字列でイベントを検索"""
    search_filter = or_(
        models.Event.title.ilike(f"%{q}%"),
        models.Event.description.ilike(f"%{q}%"),
        models.Event.location.ilike(f"%{q}%")
    )
    return db.query(models.Event).filter(search_filter).limit(limit).all()
