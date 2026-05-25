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
        
        # A. 送信された date パラメータがある場合
        if date:
             try:
                 from datetime import datetime
                 meeting_date = datetime.fromisoformat(date.replace('Z', '+00:00')).replace(tzinfo=None)
             except:
                 pass
        
        # B. date がない、またはパース失敗した場合、ファイル名（file.filename）から日付 (YYYYMMDD や YYYY-MM-DD 等) を抽出
        if not meeting_date and file.filename:
             import re
             from datetime import datetime
             # 8桁の数字（YYYYMMDD）や区切り文字付き日付を検索
             match = re.search(r'(\d{4})[-/_]?(\d{2})[-/_]?(\d{2})', file.filename)
             if match:
                 try:
                     year, month, day = match.groups()
                     # 月日の妥当性チェックも兼ねて datetime オブジェクトを作成
                     meeting_date = datetime(int(year), int(month), int(day))
                 except ValueError:
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


# --- §2 新規 API エンドポイントの実装 (API v3) ---

api_router = APIRouter(prefix="/api", tags=["Meetings (API v3)"])

@api_router.get("/events/{event_id}/meetings")
async def get_event_meetings(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    §2.3 指定されたイベントに紐づく議事録一覧を取得します。
    """
    meetings = db.query(models.Meeting).filter(models.Meeting.event_id == event_id).all()
    result = []
    for m in meetings:
        result.append({
            "id": m.id,
            "event_id": m.event_id,
            "project_id": m.project_id,
            "title": m.title,
            "date": m.date.isoformat() if m.date else None,
            "transcript": m.transcript,
            "decisions": m.decisions or [],
            "tasks": m.tasks or [],
            "deadlines": m.deadlines or [],
            "attendees": m.attendees or []
        })
    return {"meetings": result}


@api_router.get("/meetings/{meeting_id}", response_model=schemas.MeetingResponse)
async def get_meeting_details(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    §2.4 指定された議事録の単体詳細を取得します。
    """
    db_meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not db_meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会議が見つかりません")
    return db_meeting


@api_router.post("/projects/{project_id}/meetings", response_model=schemas.MeetingResponse, status_code=status.HTTP_201_CREATED)
async def create_manual_meeting(
    project_id: int,
    meeting_data: schemas.MeetingCreateManual,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    §2.5 手動で議事録を作成・登録します。
    """
    from ..timezone import now_jst_naive
    
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="プロジェクトが見つかりません")

    db_meeting = models.Meeting(
        project_id=project_id,
        title=meeting_data.title,
        date=meeting_data.date or now_jst_naive(),
        event_id=meeting_data.event_id,
        status="completed",
        transcript=meeting_data.transcript,
        decisions=meeting_data.decisions,
        tasks=meeting_data.tasks,
        discussion_points=meeting_data.discussion_points,
        deadlines=meeting_data.deadlines,
        attendees=meeting_data.attendees,
        version_group=meeting_data.version_group
    )
    
    db.add(db_meeting)
    db.commit()
    db.refresh(db_meeting)
    
    # もし event_id が指定されているなら、対応するイベントの minutes_id にも紐づける
    if meeting_data.event_id:
        db_event = db.query(models.Event).filter(models.Event.id == meeting_data.event_id).first()
        if db_event:
            db_event.minutes_id = db_meeting.id
            db.commit()
            
    return db_meeting


@api_router.patch("/meetings/{meeting_id}", response_model=schemas.MeetingResponse)
async def update_meeting_manual(
    meeting_id: int,
    meeting_data: schemas.MeetingUpdateManual,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    §2.6 議事録を手動編集・部分更新します。
    """
    db_meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not db_meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会議が見つかりません")

    update_dict = meeting_data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(db_meeting, key, value)
        
    db.commit()
    db.refresh(db_meeting)
    
    # event_id が変更された場合、対応するイベントの minutes_id を更新
    if "event_id" in update_dict and update_dict["event_id"]:
        db_event = db.query(models.Event).filter(models.Event.id == update_dict["event_id"]).first()
        if db_event:
            db_event.minutes_id = db_meeting.id
            db.commit()
            
    return db_meeting

