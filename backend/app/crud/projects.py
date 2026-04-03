import logging
from typing import List, Optional, Any
from sqlalchemy.orm import Session
from sqlalchemy import text, or_, and_

from .. import models, schemas
from ..timezone import now_jst_naive
from .base import _parse_datetime, _parse_int_safe, _safe_json_load

logger = logging.getLogger(__name__)

def get_project(db: Session, project_id: int) -> Optional[models.Project]:
    """ID でプロジェクトを取得"""
    return db.query(models.Project).filter(models.Project.id == project_id).first()

def get_project_by_name(db: Session, name: str) -> Optional[models.Project]:
    """プロジェクト名からプロジェクトを取得"""
    return db.query(models.Project).filter(models.Project.name == name).first()

def get_projects(db: Session, skip: int = 0, limit: int = 100, display_status_in: Optional[List[str]] = None) -> List[models.Project]:
    """プロジェクトを取得（フィルタ・ページネーション対応）"""
    query = db.query(models.Project)
    if display_status_in:
        query = query.filter(models.Project.display_status.in_(display_status_in))
    return query.offset(skip).limit(limit).all()

def create_project(db: Session, project: schemas.ProjectCreate) -> models.Project:
    """新規プロジェクトを作成"""
    db_project = models.Project(
        name=project.name,
        description=project.description,
        status=project.status or models.ProjectStatus.PLANNING,
        display_status=project.display_status or 'online',
        start_date=_parse_datetime(project.start_date),
        end_date=_parse_datetime(project.end_date),
        color=project.color
    )
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project

def update_project(db: Session, db_project: models.Project, project_in: schemas.ProjectUpdate) -> models.Project:
    """プロジェクトを更新"""
    update_data = project_in.dict(exclude_unset=True)
    
    # フィールド名のマッピング定義
    field_map = {
        "startDate": ("start_date", _parse_datetime),
        "endDate": ("end_date", _parse_datetime),
        "start_date": ("start_date", _parse_datetime),
        "end_date": ("end_date", _parse_datetime)
    }

    for key, value in update_data.items():
        if key == "display_status" and value not in ['online', 'offline', 'archived']:
            continue
            
        db_key, converter = field_map.get(key, (key, None))
        parsed_value = converter(value) if converter else value

        if hasattr(db_project, db_key):
            setattr(db_project, db_key, parsed_value)

    db_project.updated_at = now_jst_naive()
    db.commit()
    db.refresh(db_project)
    return db_project

def delete_project_with_cascade(db: Session, project_id: int) -> bool:
    """
    プロジェクトを関連データ（タスク・履歴等）を含めて安全に削除する。
    Routerに分散していた複雑なロジックをここに集約。
    """
    try:
        # 1. 存在確認
        project = db.query(models.Project).filter(models.Project.id == project_id).first()
        if not project:
            return False
            
        # 2. 関連するタスクID・イベントIDを取得（同期削除のため）
        task_ids = [r.id for r in db.query(models.Task.id).filter(models.Task.project_id == project_id).all()]
        event_ids = [r.id for r in db.query(models.Event.id).filter(models.Event.project_id == project_id).all()]

        # 3. カスケード削除
        if task_ids:
            # 履歴を削除
            db.execute(text("DELETE FROM task_status_history WHERE task_id IN :tids"), {"tids": tuple(task_ids)})
            # タスク同期を削除
            db.execute(text("DELETE FROM task_google_syncs WHERE task_id IN :tids"), {"tids": tuple(task_ids)})
        
        if event_ids:
            # イベント同期を削除
            db.execute(text("DELETE FROM event_google_syncs WHERE event_id IN :eids"), {"eids": tuple(event_ids)})

        # プロジェクト同期を削除
        db.execute(text("DELETE FROM project_google_syncs WHERE project_id = :pid"), {"pid": project_id})
        
        # 4. メインテーブルの削除
        db.execute(text("DELETE FROM tasks WHERE project_id = :pid"), {"pid": project_id})
        db.execute(text("DELETE FROM events WHERE project_id = :pid"), {"pid": project_id})
        db.execute(text("DELETE FROM projects WHERE id = :pid"), {"pid": project_id})
        
        db.commit()
        return True
    except Exception:
        db.rollback()
        logger.exception("Error deleting project %d", project_id)
        raise

def complete_tasks_for_project(db: Session, project_id: int) -> int:
    """プロジェクトに属する未完了タスクをすべて完了にする。完了にしたタスク数を返す。"""
    tasks = db.query(models.Task).filter(
        models.Task.project_id == project_id,
        models.Task.status != models.TaskStatus.COMPLETED
    ).all()
    
    count = 0
    now = now_jst_naive()
    for task in tasks:
        task.status = models.TaskStatus.COMPLETED
        task.updated_at = now
        db.add(models.TaskStatusHistory(
            task_id=task.id,
            status=models.TaskStatus.COMPLETED,
            changed_at=now,
            changed_by=task.assigned_to
        ))
        count += 1
        
    db.commit()
    return count
