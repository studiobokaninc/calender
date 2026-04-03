import logging
from typing import List, Optional
from sqlalchemy.orm import Session
from .. import models, schemas
from ..timezone import now_jst_naive

logger = logging.getLogger(__name__)

def get_group(db: Session, group_id: int) -> Optional[models.Group]:
    """ID でグループを取得"""
    return db.query(models.Group).filter(models.Group.id == group_id).first()

def get_groups(db: Session, skip: int = 0, limit: int = 100) -> List[models.Group]:
    """グループリストを取得"""
    return db.query(models.Group).offset(skip).limit(limit).all()

def create_group(db: Session, group: schemas.GroupCreate) -> models.Group:
    """新規グループを作成"""
    db_group = models.Group(
        name=group.name,
        description=group.description,
        start_date=group.start_date,
        end_date=group.end_date
    )
    db.add(db_group)
    db.commit()
    db.refresh(db_group)
    return db_group

def update_group(db: Session, db_group: models.Group, group_in: schemas.GroupUpdate) -> models.Group:
    """グループ情報を更新"""
    update_data = group_in.dict(exclude_unset=True)
    for key, value in update_data.items():
        if hasattr(db_group, key):
            setattr(db_group, key, value)
    db_group.updated_at = now_jst_naive()
    db.commit()
    db.refresh(db_group)
    return db_group

def delete_group(db: Session, db_group: models.Group) -> None:
    """グループを削除"""
    db.delete(db_group)
    db.commit()

# UserGroup CRUD
def get_user_group(db: Session, user_id: int, group_id: int) -> Optional[models.UserGroup]:
    """ユーザーIDとグループIDで関連を取得"""
    return db.query(models.UserGroup).filter(
        models.UserGroup.user_id == user_id, 
        models.UserGroup.group_id == group_id
    ).first()

def get_user_groups_by_user(db: Session, user_id: int, skip: int = 0, limit: int = 100) -> List[models.UserGroup]:
    """特定のユーザーが所属するグループの関連リストを取得"""
    return db.query(models.UserGroup).filter(models.UserGroup.user_id == user_id).offset(skip).limit(limit).all()

def get_user_groups_by_group(db: Session, group_id: int, skip: int = 0, limit: int = 100) -> List[models.UserGroup]:
    """特定のグループに所属するユーザーの関連リストを取得"""
    return db.query(models.UserGroup).filter(models.UserGroup.group_id == group_id).offset(skip).limit(limit).all()

def add_user_to_group(db: Session, user_group: schemas.UserGroupCreate) -> models.UserGroup:
    """ユーザーをグループに追加"""
    db_user_group = models.UserGroup(
        user_id=user_group.user_id,
        group_id=user_group.group_id,
        role=user_group.role or 'member'
    )
    db.add(db_user_group)
    db.commit()
    db.refresh(db_user_group)
    return db_user_group

def remove_user_from_group(db: Session, user_id: int, group_id: int) -> bool:
    """ユーザーをグループから削除"""
    db_user_group = get_user_group(db, user_id, group_id)
    if not db_user_group:
        return False
    db.delete(db_user_group)
    db.commit()
    return True
