import logging
from typing import List, Optional
from sqlalchemy.orm import Session
from .. import models, schemas
from ..timezone import now_jst_naive

logger = logging.getLogger(__name__)

def get_knowledge_item(db: Session, item_id: int) -> Optional[models.KnowledgeItem]:
    """ID で知識項目を取得"""
    return db.query(models.KnowledgeItem).filter(models.KnowledgeItem.id == item_id).first()

def get_knowledge_items(db: Session, project_id: Optional[int] = None, skip: int = 0, limit: int = 100) -> List[models.KnowledgeItem]:
    """知識項目リストを取得"""
    query = db.query(models.KnowledgeItem)
    if project_id is not None:
        query = query.filter(models.KnowledgeItem.project_id == project_id)
    return query.order_by(models.KnowledgeItem.created_at.desc()).offset(skip).limit(limit).all()

def create_knowledge_item(db: Session, item: schemas.KnowledgeItemCreate) -> models.KnowledgeItem:
    """新規知識項目を登録"""
    db_item = models.KnowledgeItem(
        title=item.title,
        project_id=item.project_id,
        file_name=item.file_name,
        file_path=item.file_path,
        file_type=item.file_type,
        created_by=item.created_by,
        status="pending",
        created_at=now_jst_naive(),
        updated_at=now_jst_naive()
    )
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

def update_knowledge_item(db: Session, db_item: models.KnowledgeItem, updates: dict) -> models.KnowledgeItem:
    """知識項目情報を更新"""
    for key, value in updates.items():
        if hasattr(db_item, key):
            setattr(db_item, key, value)
    db_item.updated_at = now_jst_naive()
    db.commit()
    db.refresh(db_item)
    return db_item

def delete_knowledge_item(db: Session, db_item: models.KnowledgeItem) -> None:
    """知識項目を削除"""
    db.delete(db_item)
    db.commit()

def add_knowledge_tag(db: Session, item_id: int, tag_name: str) -> models.KnowledgeTag:
    """知識項目にタグを追加"""
    db_tag = models.KnowledgeTag(knowledge_item_id=item_id, name=tag_name)
    db.add(db_tag)
    db.commit()
    db.refresh(db_tag)
    return db_tag

def get_all_knowledge_summaries(db: Session, project_id: Optional[int] = None) -> str:
    """全資料の要約を返す（AI用）"""
    query = db.query(models.KnowledgeItem).filter(models.KnowledgeItem.status == "completed")
    if project_id:
        query = query.filter(models.KnowledgeItem.project_id == project_id)
    items = query.all()
    
    if not items:
        return "利用可能な知識ベースの資料はありません。"
        
    context = ""
    for item in items:
        tags = ", ".join([t.name for t in item.tags])
        project_name = item.project.name if item.project else "全般"
        context += f"- 【資料：{item.title}】 (ID: {item.id}, プロジェクト: {project_name}, タグ: [{tags}])\n"
        if item.summary:
            context += f"  内容要約: {item.summary}\n"
        else:
            snippet = (item.content_text or "")[:200].replace("\n", " ")
            context += f"  プレビュー: {snippet}...\n"
    return context
