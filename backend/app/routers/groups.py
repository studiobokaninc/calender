import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import crud, models, schemas, security
from ..database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Groups & Memberships"])

@router.get("/groups", response_model=List[schemas.GroupResponse])
async def get_groups_endpoint(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
    skip: int = 0,
    limit: int = 10000
):
    """グループのリストを取得"""
    return crud.get_groups(db=db, skip=skip, limit=limit)


@router.post("/groups", response_model=schemas.GroupResponse, status_code=status.HTTP_201_CREATED)
async def create_group_endpoint(
    group_data: schemas.GroupCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    """新規グループを作成"""
    return crud.create_group(db=db, group=group_data)


@router.put("/groups/{group_id}", response_model=schemas.GroupResponse)
async def update_group_endpoint(
    group_id: int,
    group_data: schemas.GroupUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    """グループ情報を更新"""
    db_group = crud.get_group(db=db, group_id=group_id)
    if db_group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="グループが見つかりません")
    return crud.update_group(db=db, db_group=db_group, group_in=group_data)


@router.get("/user_groups", response_model=List[schemas.UserGroupResponse])
async def get_user_groups_endpoint(
    user_id: Optional[int] = None,
    group_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
    skip: int = 0,
    limit: int = 10000
):
    """ユーザーとグループの関連リストを取得"""
    if user_id is not None:
        return crud.get_user_groups_by_user(db=db, user_id=user_id, skip=skip, limit=limit)
    elif group_id is not None:
        return crud.get_user_groups_by_group(db=db, group_id=group_id, skip=skip, limit=limit)
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Either user_id or group_id filter is required")


@router.post("/user_groups", response_model=schemas.UserGroupResponse, status_code=status.HTTP_201_CREATED)
async def add_user_to_group_endpoint(
    user_group_data: schemas.UserGroupCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin)
):
    """ユーザーをグループに追加（管理者のみ）"""
    user_id_int = crud._parse_int_safe(user_group_data.user_id)
    group_id_int = crud._parse_int_safe(user_group_data.group_id)
    
    if user_id_int is None or group_id_int is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user_id or group_id")
    
    if not crud.get_user(db, user_id=user_id_int):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"User with id {user_id_int} not found")
    if not crud.get_group(db, group_id=group_id_int):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Group with id {group_id_int} not found")
        
    if crud.get_user_group(db, user_id=user_id_int, group_id=group_id_int):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already in this group")

    return crud.add_user_to_group(db=db, user_group=user_group_data)


@router.delete("/user_groups/{user_id}/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_user_from_group_endpoint(
    user_id: int,
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin)
):
    """ユーザーをグループから削除（管理者のみ）"""
    if crud.remove_user_from_group(db=db, user_id=user_id, group_id=group_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User-group relationship not found")
    return None
