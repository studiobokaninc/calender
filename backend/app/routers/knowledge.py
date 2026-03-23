from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
import os
import uuid
import shutil
from pathlib import Path
from .. import crud, models, schemas
from ..database import get_db
from ..security import get_current_user
from ..services.knowledge_processor import KnowledgeProcessor
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge", tags=["Knowledge Base"])

STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"
KNOWLEDGE_DIR = STATIC_DIR / "knowledge"

def ensure_knowledge_dir():
    if not KNOWLEDGE_DIR.exists():
        KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)

@router.post("/upload", response_model=schemas.KnowledgeItemResponse)
async def upload_knowledge_item(
    background_tasks: BackgroundTasks,
    title: str = Form(...),
    project_id: Optional[int] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    ensure_knowledge_dir()
    
    file_ext = os.path.splitext(file.filename)[1].lower()
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = KNOWLEDGE_DIR / unique_filename
    
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.error(f"Failed to save file: {e}")
        raise HTTPException(status_code=500, detail="ファイルの保存に失敗しました")
    
    # Determine type
    file_type = "doc"
    if file_ext == ".pdf": file_type = "pdf"
    elif file_ext in [".xlsx", ".xls", ".csv"]: file_type = "excel"
    elif file_ext in [".pptx", ".ppt"]: file_type = "ppt"
    elif file_ext in [".png", ".jpg", ".jpeg", ".webp"]: file_type = "image"
    elif file_ext in [".mp3", ".m4a", ".wav"]: file_type = "audio"

    item_in = schemas.KnowledgeItemCreate(
        title=title,
        project_id=project_id,
        file_name=file.filename,
        file_path=f"/static/knowledge/{unique_filename}",
        file_type=file_type,
        created_by=current_user.id
    )
    
    db_item = crud.create_knowledge_item(db, item=item_in)
    
    # Start processing in background
    api_key = os.getenv("GOOGLE_API_KEY")
    processor = KnowledgeProcessor(api_key=api_key)
    
    # BackgroundTasks is better for short-lived tasks, but parsing might be long.
    # However, for consistency with meetings, we use background_tasks or create_task.
    import asyncio
    asyncio.create_task(processor.process_knowledge_item(db_item.id))
    
    return db_item

@router.get("", response_model=List[schemas.KnowledgeItemResponse])
async def list_knowledge_items(
    project_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    return crud.get_knowledge_items(db, project_id=project_id, skip=skip, limit=limit)

@router.get("/{item_id}", response_model=schemas.KnowledgeItemResponse)
async def get_knowledge_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_item = crud.get_knowledge_item(db, item_id=item_id)
    if not db_item:
        raise HTTPException(status_code=404, detail="Item not found")
    return db_item

@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_item = crud.get_knowledge_item(db, item_id=item_id)
    if not db_item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    # Delete file
    filename = os.path.basename(db_item.file_path)
    full_path = KNOWLEDGE_DIR / filename
    if full_path.exists():
        try:
            full_path.unlink()
        except:
            pass
    
    # 知識ベース (RAG) からも削除
    from ..services.rag import rag_service
    try:
        rag_service.delete_item(db_item.id)
    except Exception as e:
        logger.error(f"Failed to delete {db_item.id} from RAG: {e}")

    crud.delete_knowledge_item(db, db_item)
    return None
