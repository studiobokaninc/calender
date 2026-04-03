import logging
from typing import List, Optional
from sqlalchemy.orm import Session
from .. import models, schemas
from ..security import pwd_context
from ..timezone import now_jst_naive

logger = logging.getLogger(__name__)

def get_user(db: Session, user_id: int) -> Optional[models.User]:
    """ID でユーザーを取得"""
    return db.query(models.User).filter(models.User.id == user_id).first()

def get_user_by_email(db: Session, email: str) -> Optional[models.User]:
    """email でユーザーを取得"""
    return db.query(models.User).filter(models.User.email == email).first()

def get_user_by_username(db: Session, username: str) -> Optional[models.User]:
    """username でユーザーを取得"""
    return db.query(models.User).filter(models.User.username == username).first()

def get_users(db: Session, skip: int = 0, limit: int = 100) -> List[models.User]:
    """ユーザーリストを取得"""
    return db.query(models.User).offset(skip).limit(limit).all()

def create_user(db: Session, user: schemas.UserCreate) -> models.User:
    """新規ユーザーを作成"""
    hashed_password = pwd_context.hash(user.password)
    db_user = models.User(
        email=user.email,
        username=user.username,
        full_name=user.full_name,
        hashed_password=hashed_password,
        role=user.role or "user"
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

def update_user(db: Session, db_user: models.User, user_in: schemas.UserUpdate) -> models.User:
    """ユーザー情報を更新"""
    update_data = user_in.dict(exclude_unset=True)
    if "password" in update_data:
        db_user.hashed_password = pwd_context.hash(update_data.pop("password"))
        
    for key, value in update_data.items():
        if hasattr(db_user, key):
            setattr(db_user, key, value)
            
    db_user.updated_at = now_jst_naive()
    db.commit()
    db.refresh(db_user)
    return db_user
