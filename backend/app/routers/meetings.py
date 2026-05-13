from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, BackgroundTasks, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List, Optional
import os
import asyncio
import uuid
import shutil
import subprocess
from pathlib import Path
from .. import crud, models, schemas
from ..database import get_db, SessionLocal
from ..security import get_current_user
import logging
from ..services.llm import get_llm_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/meetings", tags=["Meetings"])
# 新規追加: プロジェクト特定なしのグローバルな会議管理用ルーター
root_router = APIRouter(prefix="/meetings", tags=["Meetings (All)"])

# 静的ファイルの保存先 (backend/static/audio)
# backend/app/routers/meetings.py からの相対パス
STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"
AUDIO_DIR = STATIC_DIR / "audio"

def ensure_audio_dir():
    if not AUDIO_DIR.exists():
        AUDIO_DIR.mkdir(parents=True, exist_ok=True)

@router.post("/upload", response_model=schemas.MeetingResponse)
async def upload_meeting_audio(
    project_id: int,
    background_tasks: BackgroundTasks,
    title: str = Form("新規会議"),
    date: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """会議音声をアップロードし、AI解析をバックグラウンドで開始する"""
    ensure_audio_dir()
    
    # 1. 保存先の決定
    file_ext = os.path.splitext(file.filename)[1] or ".m4a"
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = AUDIO_DIR / unique_filename
    
    # 2. ファイルを保存
    logger.info(f"Uploading meeting audio: {file.filename} -> {unique_filename}")
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.error(f"Failed to save file: {e}")
        raise HTTPException(status_code=500, detail="ファイルの保存に失敗しました")
    
    # 3. DBレコード作成
    try:
        from ..timezone import now_jst_naive
        meeting_date = None
        if date:
             try:
                 from datetime import datetime
                 meeting_date = datetime.fromisoformat(date.replace('Z', '+00:00')).replace(tzinfo=None)
             except:
                 pass
        
        meeting_in = schemas.MeetingCreate(
            title=title, 
            project_id=project_id, 
            date=meeting_date or now_jst_naive()
        )
        db_meeting = crud.create_meeting(db, meeting=meeting_in)
        
        # 保存先URLを更新 (クライアントからのアクセス用)
        db_meeting.audio_url = f"/static/audio/{unique_filename}"
        db.commit()
        db.refresh(db_meeting)
        
        # 4. バックグラウンドでAI解析を開始
        try:
            client = get_llm_client()
            import asyncio
            asyncio.create_task(analyze_meeting_background(db_meeting.id, str(file_path), client.api_key))
        except Exception as e:
            logger.error(f"LLM API Key is not set. Background analysis will not start: {e}")
        
        return db_meeting
    except Exception as e:
        logger.exception("Error in upload_meeting_audio")
        # 失敗した場合はファイルを削除
        if 'file_path' in locals() and file_path.exists():
            file_path.unlink()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("", response_model=List[schemas.MeetingResponse])
async def list_meetings(
    project_id: int,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """プロジェクトの会議一覧を取得（最新順）"""
    return crud.get_meetings_by_project(db, project_id=project_id, skip=skip, limit=limit)

@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meeting(
    project_id: int,
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """会議データを削除する（音声ファイルも削除）"""
    db_meeting = crud.get_meeting(db, meeting_id=meeting_id)
    if not db_meeting:
        raise HTTPException(status_code=404, detail="会議が見つかりません")
    
    if db_meeting.project_id != project_id:
        raise HTTPException(status_code=400, detail="プロジェクトIDが一致しません")

    # 音声ファイルの削除
    if db_meeting.audio_url:
        # /static/audio/xxx -> static/audio/xxx
        rel_path = db_meeting.audio_url.lstrip("/")
        abs_path = STATIC_DIR / rel_path.replace("static/", "") if rel_path.startswith("static/") else STATIC_DIR.parent / rel_path
        # 実際には STATIC_DIR は .../backend/static なので
        # audio_url="/static/audio/xxx" -> file_path = STATIC_DIR / "audio" / "xxx"
        filename = os.path.basename(db_meeting.audio_url)
        full_path = AUDIO_DIR / filename
        
        if full_path.exists():
            try:
                full_path.unlink()
                logger.info(f"Deleted audio file: {full_path}")
            except Exception as e:
                logger.warning(f"Failed to delete file {full_path}: {e}")

    crud.delete_meeting(db, db_meeting)
    return None

@router.get("/{meeting_id}/audio")
async def get_meeting_audio_stream(
    project_id: int,
    meeting_id: int,
    db: Session = Depends(get_db)
):
    """音声ファイルを直接ストリーミング配信する (外部プレイヤー対応のため認証なし)"""
    db_meeting = crud.get_meeting(db, meeting_id=meeting_id)
    if not db_meeting or not db_meeting.audio_url:
        raise HTTPException(status_code=404, detail="音声データが見つかりません")
    
    filename = os.path.basename(db_meeting.audio_url)
    file_path = AUDIO_DIR / filename
    
    if not file_path.exists():
        logger.error(f"Audio file not found on disk: {file_path}")
        raise HTTPException(status_code=404, detail="ファイルが物理的に見つかりません")
        
    # 大きなファイルの場合、ブラウザのRangeリクエストを確実に処理するためのヘッダー調整
    file_size = os.path.getsize(file_path)
    
    # 完全に手動でのRange処理は複雑なので、一旦標準のFileResponseに任せつつ、
    # 巨大なファイル向けにブラウザが要求しやすいようヘッダーを補助する
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(file_size),
        "Cache-Control": "max-age=3600",
        "Content-Type": "audio/mpeg"  # m4aであっても一度mpeg(mp3互換)として試す
    }

    return FileResponse(
        path=str(file_path),
        media_type="audio/mpeg",
        headers=headers
    )

@root_router.post("/scan")
async def scan_network_drive(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Xレポジトリをスキャンして未処理の会議音声を一括登録・解析開始する"""
    try:
        client = get_llm_client()
        api_key = client.api_key
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM API Key is not configured: {e}")
        
    from ..services.meeting_scanner import run_batch_scan
    # バックグラウンドではなく、まずはスキャン自体を走らせる（解析は各々内部で非同期タスクとして起動）
    await run_batch_scan(api_key)
    return {"message": "Scanning started, new meetings will appear as they are processed."}

async def analyze_meeting_background(meeting_id: int, audio_path: str, api_key: str):
    """バックグラウンド解析タスク"""
    try:
        from ..services.meeting_analyzer import MeetingAnalyzer
        analyzer = MeetingAnalyzer(api_key=api_key)
        await analyzer.analyze_meeting(meeting_id, audio_path)
    except Exception as e:
        logger.error(f"Background analysis for meeting {meeting_id} failed: {e}")
