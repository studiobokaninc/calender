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
    """[DEPRECATED] タスクの自動ステータス更新は task_status_redesign_plan.md §3.1 で廃止。
    mk→wip の自動開始遷移と、締切超過による自動遅延遷移は現場の意図しないステータス変更の
    原因となるため恒久的に無効化する。呼び出し互換のため関数は残すが常に False を返す。
    「遅延」はステータスではなく UI 派生フラグ (isOverdue) として扱う。
    """
    return False


def auto_update_task_statuses(db: Session, project_id: Optional[int] = None) -> int:
    """[DEPRECATED] 自動ステータス更新は廃止。既存呼び出し互換のため 0 を返すだけとする。"""
    return 0

# その他：Google Token CRUD
def get_user_google_token(db: Session, user_id: int):
    return db.query(models.UserGoogleToken).filter(models.UserGoogleToken.user_id == user_id).first()
