import logging
from typing import List, Optional
from sqlalchemy.orm import Session
from .. import models, schemas
from ..timezone import now_jst_naive

logger = logging.getLogger(__name__)

def create_chat_message(db: Session, conversation_id: str, role: str, content: str, user_id: Optional[int] = None) -> models.ChatMessage:
    """会話メッセージを保存"""
    db_msg = models.ChatMessage(
        conversation_id=conversation_id,
        role=role,
        content=content,
        user_id=user_id,
        created_at=now_jst_naive()
    )
    db.add(db_msg)
    db.commit()
    db.refresh(db_msg)
    return db_msg

def get_chat_messages(db: Session, conversation_id: str, limit: int = 50) -> List[models.ChatMessage]:
    """会話履歴を取得"""
    messages = db.query(models.ChatMessage).filter(
        models.ChatMessage.conversation_id == conversation_id
    ).order_by(models.ChatMessage.created_at.desc()).limit(limit).all()
    return list(reversed(messages))

def delete_conversation_messages(db: Session, conversation_id: str) -> None:
    """特定の会話の全メッセージを削除"""
    db.query(models.ChatMessage).filter(
        models.ChatMessage.conversation_id == conversation_id
    ).delete()
    db.commit()
