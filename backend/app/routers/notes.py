import logging
import os
import uuid
import shutil
from typing import List, Optional
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status, Query, Request, UploadFile, File
from sqlalchemy.orm import Session

from .. import crud, models, schemas, security
from ..database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/notes", tags=["Notes"])

@router.post("/upload-image")
async def upload_note_image(
    file: UploadFile = File(...),
    current_user: models.User = Depends(security.get_current_user),
):
    """メモ用画像をアップロード"""
    return await _save_file(file)

@router.post("/upload-pdf")
async def upload_note_pdf(
    file: UploadFile = File(...),
    current_user: models.User = Depends(security.get_current_user),
):
    """メモ用PDFをアップロード"""
    return await _save_file(file)

@router.post("/upload-audio")
async def upload_note_audio(
    file: UploadFile = File(...),
    current_user: models.User = Depends(security.get_current_user),
):
    """メモ用音声をアップロード"""
    return await _save_file(file)

async def _save_file(file: UploadFile):
    """汎用ファイル保存関数"""
    upload_dir = Path("static") / "uploads"
    if not upload_dir.exists():
        upload_dir.mkdir(parents=True, exist_ok=True)
    
    file_ext = os.path.splitext(file.filename)[1]
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    dest_path = upload_dir / unique_filename
    
    try:
        with open(dest_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return {"url": f"/static/uploads/{unique_filename}"}
    except Exception as e:
        logger.error(f"Failed to save upload: {e}")
        raise HTTPException(status_code=500, detail="ファイルの保存に失敗しました")

@router.get("", response_model=List[schemas.NoteResponse])
def get_notes_endpoint(
    skip: int = 0,
    limit: int = 100,
    project_id_is_null: Optional[bool] = Query(None),
    project_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """メモリストを取得"""
    if project_id_is_null:
        query = db.query(models.Note).filter(models.Note.project_id == None)
        if current_user.role != 'admin':
            query = query.filter(models.Note.created_by == current_user.id)
        return query.order_by(models.Note.created_at.desc()).offset(skip).limit(limit).all()
    
    created_by = None if current_user.role == 'admin' else current_user.id
    return crud.get_notes(db, skip=skip, limit=limit, created_by=created_by, project_id=project_id)

@router.get("/{note_id}", response_model=schemas.NoteResponse)
def get_note_endpoint(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """1件のメモを取得"""
    db_note = crud.get_note(db, note_id=note_id)
    if db_note is None:
        raise HTTPException(status_code=404, detail="メモが見つかりません")
    return db_note

@router.post("", response_model=schemas.NoteResponse, status_code=status.HTTP_201_CREATED)
def create_note_endpoint(
    note: schemas.NoteCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """メモを作成"""
    return crud.create_note(db, note=note, created_by=current_user.id)

@router.put("/{note_id}", response_model=schemas.NoteResponse)
def update_note_endpoint(
    note_id: int,
    note: schemas.NoteUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """メモを更新"""
    db_note = crud.get_note(db, note_id=note_id)
    if db_note is None:
        raise HTTPException(status_code=404, detail="メモが見つかりません")
    
    if db_note.created_by != current_user.id and current_user.role != 'admin':
        raise HTTPException(status_code=403, detail="編集権限がありません")
        
    upload_dir = os.path.join("static", "uploads")
    return crud.update_note(db, db_note=db_note, note_in=note, upload_dir=upload_dir)

@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note_endpoint(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """メモを削除"""
    db_note = crud.get_note(db, note_id=note_id)
    if db_note is None:
        raise HTTPException(status_code=404, detail="メモが見つかりません")
        
    if db_note.created_by != current_user.id and current_user.role != 'admin':
        raise HTTPException(status_code=403, detail="削除権限がありません")
        
    upload_dir = os.path.join("static", "uploads")
    crud.delete_note(db, db_note=db_note, upload_dir=upload_dir)
    return None
