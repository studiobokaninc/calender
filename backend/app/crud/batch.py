import logging
from typing import List, Optional
from sqlalchemy.orm import Session
from .. import models, schemas
from ..timezone import now_jst_naive
from .tasks import update_task

logger = logging.getLogger(__name__)

def update_task_statuses(db: Session, task_ids: List[int], status: str, changed_by: Optional[int] = None) -> List[models.Task]:
    """複数のタスクのステータスを一括更新"""
    tasks = db.query(models.Task).filter(models.Task.id.in_(task_ids)).all()
    updated_tasks = []
    
    for task in tasks:
        task_update = schemas.TaskUpdate(status=models.TaskStatus(status))
        updated_task = update_task(db, task, task_update)
        updated_tasks.append(updated_task)
            
    return updated_tasks

def _perform_task_auto_update(db: Session, task: models.Task) -> bool:
    """単一タスクの自動ステータス更新ロジック (JST基準)"""
    now = now_jst_naive()
    today = now.date()
    updated = False

    # 1. 開始日が過ぎていて TODO なら自動で進行中に
    if task.status == models.TaskStatus.TODO and task.start_date:
        start_date = task.start_date.date() if hasattr(task.start_date, 'date') else task.start_date
        if start_date <= today and not task.auto_started:
            task.status = models.TaskStatus.IN_PROGRESS
            task.auto_started = True
            updated = True

    # 2. 締切が過ぎていて完了していなければ自動で遅延に
    if task.status not in [models.TaskStatus.COMPLETED, models.TaskStatus.DELAYED] and task.due_date:
        due_date = task.due_date.date() if hasattr(task.due_date, 'date') else task.due_date
        if due_date < today and not task.auto_delayed:
            task.status = models.TaskStatus.DELAYED
            task.auto_delayed = True
            updated = True

    if updated:
        task.updated_at = now
        db.add(models.TaskStatusHistory(
            task_id=task.id,
            status=task.status,
            changed_at=now,
            changed_by=task.assigned_to
        ))
    
    return updated

def auto_update_task_statuses(db: Session, project_id: Optional[int] = None) -> int:
    """全タスク（または特定プロジェクト）のステータスを自動更新"""
    query = db.query(models.Task).filter(
        models.Task.status.notin_([models.TaskStatus.COMPLETED])
    )
    if project_id:
        query = query.filter(models.Task.project_id == project_id)
        
    tasks = query.all()
    update_count = 0
    for task in tasks:
        if _perform_task_auto_update(db, task):
            update_count += 1
            
    if update_count > 0:
        db.commit()
        
    return update_count

# その他：Google Token CRUD
def get_user_google_token(db: Session, user_id: int):
    return db.query(models.UserGoogleToken).filter(models.UserGoogleToken.user_id == user_id).first()
