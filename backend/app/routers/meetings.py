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
from ..security import get_current_user, get_current_user_for_audio
import logging
from ..services.llm import get_llm_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/meetings", tags=["Meetings"])
# 新規追加: プロジェクト特定なしのグローバルな会議管理用ルーター
root_router = APIRouter(prefix="/meetings", tags=["Meetings (All)"])

# プライベートな音声データの保存先 (data/audio)
BASE_DIR = Path(__file__).resolve().parent.parent.parent
AUDIO_DIR = BASE_DIR / "data" / "audio"

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
    meeting_uuid = str(uuid.uuid4())
    file_ext = os.path.splitext(file.filename)[1] or ".m4a"
    unique_filename = f"{meeting_uuid}{file_ext}"
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
        db_meeting.uuid = meeting_uuid
        
        # 保存先URLを更新 (クライアントからのアクセス用)
        db_meeting.audio_url = f"/api/projects/{project_id}/meetings/{db_meeting.id}/audio"
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
        file_path = None
        if db_meeting.uuid:
            for ext in [".webm", ".m4a", ".mp3", ".mp4"]:
                candidate = AUDIO_DIR / f"{db_meeting.uuid}{ext}"
                if candidate.exists():
                    file_path = candidate
                    break
        if not file_path:
            filename = os.path.basename(db_meeting.audio_url)
            if "." in filename:
                candidate = AUDIO_DIR / filename
                if candidate.exists():
                    file_path = candidate
        
        if file_path and file_path.exists():
            try:
                file_path.unlink()
                logger.info(f"Deleted audio file: {file_path}")
            except Exception as e:
                logger.warning(f"Failed to delete file {file_path}: {e}")

    crud.delete_meeting(db, db_meeting)
    return None

@router.get("/{meeting_id}/audio")
async def get_meeting_audio_stream(
    project_id: int,
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user_for_audio)
):
    """音声ファイルを直接ストリーミング配信する (認証必須)"""
    db_meeting = crud.get_meeting(db, meeting_id=meeting_id)
    if not db_meeting:
        raise HTTPException(status_code=404, detail="音声データが見つかりません")
    if db_meeting.project_id != project_id:
        raise HTTPException(status_code=400, detail="プロジェクトIDが一致しません")
    
    # 物理ファイルの特定
    file_path = None
    if db_meeting.uuid:
        for ext in [".webm", ".m4a", ".mp3", ".mp4"]:
            candidate = AUDIO_DIR / f"{db_meeting.uuid}{ext}"
            if candidate.exists():
                file_path = candidate
                break

    if not file_path and db_meeting.audio_url:
        filename = os.path.basename(db_meeting.audio_url)
        if "." in filename:
            candidate = AUDIO_DIR / filename
            if candidate.exists():
                file_path = candidate
    
    if not file_path or not file_path.exists():
        logger.error(f"Audio file not found on disk for meeting {meeting_id}")
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


# --- 録音・自動作成機能用 API エンドポイント ---

@router.post("/record/start")
async def start_recording(
    project_id: int,
    title: str = Form("新規録音会議"),
    date: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """録音セッションの開始（会議レコードの作成）"""
    # 同一プロジェクトで現在録音中の会議がないか重複チェック
    existing_recording = db.query(models.Meeting).filter(
        models.Meeting.project_id == project_id,
        models.Meeting.status == "recording"
    ).first()
    if existing_recording:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="このプロジェクトではすでに録音中の会議が存在します。"
        )

    from ..timezone import now_jst_naive
    meeting_date = None
    if date:
        try:
            from datetime import datetime
            meeting_date = datetime.fromisoformat(date.replace('Z', '+00:00')).replace(tzinfo=None)
        except:
            pass

    meeting_uuid = str(uuid.uuid4())

    db_meeting = models.Meeting(
        project_id=project_id,
        title=title,
        date=meeting_date or now_jst_naive(),
        status="recording",
        uuid=meeting_uuid
    )
    db.add(db_meeting)
    db.commit()
    db.refresh(db_meeting)

    return {
        "meeting_id": db_meeting.id,
        "meeting_uuid": db_meeting.uuid
    }


@root_router.post("/{meeting_id}/record/chunk")
async def upload_audio_chunk(
    meeting_id: int,
    chunk_index: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """分割された音声チャンクを受信し、一時ディレクトリに保存する"""
    db_meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not db_meeting:
        raise HTTPException(status_code=404, detail="会議が見つかりません")
    if db_meeting.status != "recording":
        raise HTTPException(status_code=400, detail="この会議は録音中ではありません")

    # 一時保存先ディレクトリ: temp_audio/temp_{uuid}/chunk_{chunk_index}
    temp_dir = BASE_DIR / "temp_audio" / f"temp_{db_meeting.uuid}"
    temp_dir.mkdir(parents=True, exist_ok=True)

    chunk_file_path = temp_dir / f"chunk_{chunk_index}"
    try:
        with open(chunk_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.error(f"Failed to save chunk {chunk_index} for meeting {meeting_id}: {e}")
        raise HTTPException(status_code=500, detail="チャンクの保存に失敗しました")

    return {"status": "ok", "chunk_index": chunk_index}


@root_router.post("/{meeting_id}/record/complete")
async def complete_recording(
    meeting_id: int,
    background_tasks: BackgroundTasks,
    total_chunks: int = Form(...),
    force: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """録音完了通知を受け取り、非同期で結合・解析タスクを開始する"""
    db_meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not db_meeting:
        raise HTTPException(status_code=404, detail="会議が見つかりません")
    if db_meeting.status != "recording":
        raise HTTPException(status_code=400, detail="この会議は録音完了処理を行えません")

    temp_dir = BASE_DIR / "temp_audio" / f"temp_{db_meeting.uuid}"
    
    # チャンクの存在確認
    existing_indices = set()
    if temp_dir.exists():
        for p in temp_dir.glob("chunk_*"):
            try:
                existing_indices.add(int(p.stem.split("_")[1]))
            except (ValueError, IndexError):
                pass

    missing_chunks = [i for i in range(total_chunks) if i not in existing_indices]

    if missing_chunks and not force:
        return {
            "status": "missing_chunks",
            "missing_indexes": missing_chunks,
            "message": "一部のチャンクがサーバー上に存在しません。再送信するか、欠損したまま結合（force=true）してください。"
        }

    # ステータスを processing に更新
    db_meeting.status = "processing"
    db.commit()

    # 非同期タスクの起動
    background_tasks.add_task(
        process_concat_and_analyze,
        meeting_id=meeting_id,
        temp_dir_path=str(temp_dir),
        total_chunks=total_chunks,
        force=force
    )

    return {
        "status": "processing",
        "message": "結合および解析処理を開始しました。"
    }


async def process_concat_and_analyze(
    meeting_id: int, 
    temp_dir_path: str, 
    total_chunks: int, 
    force: bool
):
    # ----------------------------------------------------
    # PHASE 1: 会議情報の取得 (DBセッション1)
    # ----------------------------------------------------
    with SessionLocal() as db:
        db_meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
        if not db_meeting:
            logger.error(f"Meeting {meeting_id} not found in background task.")
            return
        uuid_str = db_meeting.uuid
        project_id = db_meeting.project_id
    
    temp_dir = Path(temp_dir_path)
    warning_header = ""
    output_audio_path = AUDIO_DIR / f"{uuid_str}.webm"
    
    try:
        # ----------------------------------------------------
        # PHASE 2: ffmpegによる音声結合処理 (DBセッションなし)
        # ----------------------------------------------------
        chunk_files = sorted(
            temp_dir.glob("chunk_*"),
            key=lambda p: int(p.stem.split("_")[1])
        )
        if not chunk_files:
            raise Exception("結合可能な音声チャンクファイルがサーバー上に存在しません。")
            
        missing_chunk_indexes = []
        existing_indices = {int(p.stem.split("_")[1]) for p in chunk_files}
        for idx in range(total_chunks):
            if idx not in existing_indices:
                missing_chunk_indexes.append(idx)
                
        if missing_chunk_indexes:
            lost_segments = ", ".join(f"第{idx+1}セグメント" for idx in missing_chunk_indexes)
            warning_header = (
                f"【⚠️システム警告: 一部の録音データが通信不良により消失した状態で議事録が作成されました】\n"
                f"消失区間: {lost_segments}\n"
                f"上記セグメントの発言は音声結合時にスキップされており、文字起こしや決定事項の抽出に含まれません。\n"
                f"--------------------------------------------------\n\n"
            )
        
        concat_list_path = temp_dir / "concat_list.txt"
        with open(concat_list_path, "w", encoding="utf-8") as f:
            for chunk_file in chunk_files:
                escaped_path = chunk_file.resolve().as_posix().replace("'", "'\\''")
                f.write(f"file '{escaped_path}'\n")
                
        ensure_audio_dir()
        
        # ffmpeg の実行パスチェック
        ffmpeg_exe = shutil.which("ffmpeg") or "ffmpeg"
        
        cmd = [
            ffmpeg_exe, "-y", "-f", "concat", "-safe", "0", 
            "-i", str(concat_list_path),
            "-c:a", "libopus", "-b:a", "64k", "-ar", "48000",
            str(output_audio_path)
        ]
        
        process = await asyncio.create_subprocess_exec(
            *cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        stdout, stderr = await process.communicate()
        if process.returncode != 0:
            raise Exception(f"ffmpeg concat failed: {stderr.decode()}")

        # ----------------------------------------------------
        # PHASE 3: 音声パスの更新 (DBセッション2)
        # ----------------------------------------------------
        with SessionLocal() as db:
            db_meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
            if db_meeting:
                db_meeting.audio_url = f"/api/projects/{project_id}/meetings/{meeting_id}/audio"
                db.commit()

        # ----------------------------------------------------
        # PHASE 4: AI解析パイプラインの実行 (DBセッションなし)
        # ----------------------------------------------------
        from ..services.meeting_analyzer import MeetingAnalyzer
        client = get_llm_client()
        analyzer = MeetingAnalyzer(api_key=client.api_key)
        await analyzer.analyze_meeting(meeting_id, str(output_audio_path))

        # ----------------------------------------------------
        # PHASE 5: 警告ヘッダーの追記 (DBセッション3)
        # ----------------------------------------------------
        if warning_header:
            with SessionLocal() as db:
                db_meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
                if db_meeting and db_meeting.status == "completed" and db_meeting.transcript:
                    db_meeting.transcript = warning_header + db_meeting.transcript
                    db.commit()

    except Exception as e:
        logger.exception(f"Failed to process and analyze meeting {meeting_id}")
        # ----------------------------------------------------
        # PHASE 6: エラー時のステータス更新 (DBセッション4)
        # ----------------------------------------------------
        with SessionLocal() as db:
            try:
                db_meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
                if db_meeting and db_meeting.status != "failed":
                    db_meeting.status = "failed"
                    db.commit()
            except Exception as db_err:
                logger.error(f"Failed to update meeting status to failed: {db_err}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
        
    return db_meeting

