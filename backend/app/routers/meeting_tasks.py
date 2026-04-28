from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from .. import crud, models, schemas
from ..database import get_db
from ..security import get_current_user
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/meeting-tasks", tags=["Meeting Tasks"])

@router.get("", response_model=List[schemas.MeetingTaskResponse])
async def list_meeting_tasks(
    meeting_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """検出されたタスク一覧を取得"""
    return crud.get_meeting_tasks(db, meeting_id=meeting_id, status=status)

@router.patch("/{task_id}", response_model=schemas.MeetingTaskResponse)
async def update_meeting_task(
    task_id: int,
    updates: schemas.MeetingTaskUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """検出されたタスクのステータスや内容を更新"""
    db_task = db.query(models.MeetingTask).filter(models.MeetingTask.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Meeting task not found")
    
    return crud.update_meeting_task(db, db_task, updates.dict(exclude_unset=True))

@router.post("/{task_id}/adopt", response_model=schemas.TaskResponse)
async def adopt_meeting_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """検出されたタスクを本採用（正式なタスクとして登録）する"""
    db_mtg_task = db.query(models.MeetingTask).filter(models.MeetingTask.id == task_id).first()
    if not db_mtg_task:
        raise HTTPException(status_code=404, detail="Meeting task not found")
    
    if db_mtg_task.status == "adopted":
        raise HTTPException(status_code=400, detail="Task already adopted")

    # 1. 会議情報を取得してプロジェクトIDを特定
    meeting = db.query(models.Meeting).filter(models.Meeting.id == db_mtg_task.meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # 2. 正式なタスクを作成
    new_task = schemas.TaskCreate(
        name=db_mtg_task.content,
        project_id=meeting.project_id,
        description=f"Meeting: {meeting.title} より採用\n原文: {db_mtg_task.content}",
        status=models.TaskStatus.TODO,
        priority=models.TaskPriority.MEDIUM,
        type=db_mtg_task.type or "meeting"
    )
    
    db_task = crud.create_task(db, new_task)
    
    # 3. MeetingTask のステータスを更新し、作成したタスクIDを紐付け
    crud.update_meeting_task(db, db_mtg_task, {
        "status": "adopted",
        "task_id": db_task.id
    })
    
    return db_task
