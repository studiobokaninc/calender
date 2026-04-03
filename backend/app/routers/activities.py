import logging
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from .. import crud, models, schemas, security
from ..database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/user-activities", tags=["User Activities"])

@router.post("", response_model=schemas.UserActivityResponse)
def log_user_activity(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """ユーザーのアクティビティを記録"""
    return crud.create_user_activity(db, user_id=current_user.id)

@router.get("", response_model=List[schemas.UserActivityResponse])
def get_user_activities(
    user_id: Optional[int] = None,
    cycle_date: Optional[datetime] = None,
    skip: int = 0,
    limit: int = 10000,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """アクティビティ履歴を取得（管理者のみ他人のデータ可）"""
    target_user_id = user_id
    if current_user.role != 'admin':
        target_user_id = current_user.id
        
    return crud.get_user_activities(
        db=db, user_id=target_user_id, cycle_date=cycle_date, skip=skip, limit=limit
    )
