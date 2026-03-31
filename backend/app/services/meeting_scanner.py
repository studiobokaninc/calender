import os
import logging
import asyncio
from datetime import datetime
from typing import List, Optional
from sqlalchemy.orm import Session
from .. import crud, models
from .meeting_analyzer import MeetingAnalyzer
from ..database import SessionLocal

logger = logging.getLogger(__name__)

# Config
BASE_DIR = r"X:\cg\proj\kikaku\MTG_audio"
ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".mp4", ".aac"}

# Global semaphore to limit parallel processing (CPU/API protection)
# リソース消費とAPI制限を考慮し、同時実行数を最大2件に制限
processing_semaphore = asyncio.Semaphore(2)
active_tasks = set()

class MeetingScanner:
    def __init__(self, api_key: str):
        self.analyzer = MeetingAnalyzer(api_key=api_key)
        self.api_key = api_key

    async def scan_and_process(self):
        """Scan the folder structure and process new audio files."""
        if not os.path.exists(BASE_DIR):
            logger.error(f"Base MTG directory not found: {BASE_DIR}")
            return

        db = SessionLocal()
        try:
            # 1. Fetch available projects to map folder names
            projects = db.query(models.Project).all()
            project_map = {p.name.strip().lower(): p.id for p in projects}
            
            # 2. Iterate through project folders
            for proj_folder in os.listdir(BASE_DIR):
                proj_path = os.path.join(BASE_DIR, proj_folder)
                if not os.path.isdir(proj_path):
                    continue
                
                project_id = project_map.get(proj_folder.lower())
                if not project_id:
                    continue
                
                # 3. Iterate through project children (direct files or date folders)
                for entry_name in os.listdir(proj_path):
                    entry_path = os.path.join(proj_path, entry_name)
                    
                    if os.path.isdir(entry_path):
                        # Case A: Date Folder (YYYYMMDD) or arbitrary folder
                        mtg_date = None
                        try:
                            # Attempt to parse YYYYMMDD from folder name
                            mtg_date = datetime.strptime(entry_name, "%Y%m%d")
                        except ValueError:
                            # If folder name is not YYYYMMDD, we will use file time inside
                            pass
                        
                        # Scan files inside this folder
                        for audio_file in os.listdir(entry_path):
                            file_path = os.path.join(entry_path, audio_file)
                            await self._check_and_register_meeting(
                                db, file_path, project_id, mtg_date, proj_folder, 
                                entry_name if mtg_date else None
                            )
                            
                    elif os.path.isfile(entry_path):
                        # Case B: Date-prefixed File or arbitrary File
                        ext = os.path.splitext(entry_name)[1].lower()
                        if ext not in ALLOWED_EXTENSIONS:
                            continue
                        
                        # Extract date from filename (look for first 8 digits)
                        import re
                        date_match = re.search(r'(\d{8})', entry_name)
                        mtg_date = None
                        date_str = None
                        
                        if date_match:
                            try:
                                mtg_date = datetime.strptime(date_match.group(1), "%Y%m%d")
                                date_str = date_match.group(1)
                            except ValueError:
                                pass
                        
                        # Use helper with fallback logic
                        await self._check_and_register_meeting(
                            db, entry_path, project_id, mtg_date, proj_folder, date_str
                        )
        finally:
            db.close()

    async def _check_and_register_meeting(self, db: Session, file_path: str, project_id: int, mtg_date: Optional[datetime], proj_name: str, date_str: Optional[str]):
        """Helper to create DB record and task if not already exists. Falls back to file mtime if mtg_date is None."""
        ext = os.path.splitext(file_path)[1].lower()
        if ext not in ALLOWED_EXTENSIONS or not os.path.isfile(file_path):
            return

        # 日付が取得できていない場合のフォールバック (ファイルの更新日時を使用)
        if not mtg_date:
            mtime = os.path.getmtime(file_path)
            mtg_date = datetime.fromtimestamp(mtime)
            # YYYY/MM/DD 形式で表示用に整形
            date_str = mtg_date.strftime("%Y%m%d")

        # Check if already processed (Path is the unique key)
        existing = db.query(models.Meeting).filter(models.Meeting.audio_url == file_path).first()
        
        if existing:
            # 既にメモリ上でタスクが実行中ならスキップ
            if existing.id in active_tasks:
                return
            # 完了済みの場合はスキップ
            if existing.status == "completed":
                return
            
            # 解析中なのにタスクがない、または失敗した場合は再度解析を試みる（レジューム）
            logger.info(f"Restarting/Retrying incomplete meeting: {file_path}")
            asyncio.create_task(self._safe_analyze(existing.id, file_path))
            return

        # 新規レコード作成
        logger.info(f"Found new meeting: {file_path} (Project: {proj_name}, Date: {date_str})")
        new_mtg = models.Meeting(
            project_id=project_id,
            title=f"{proj_name} 会議 ({date_str})",
            date=mtg_date,
            audio_url=file_path,
            status="pending"
        )
        db.add(new_mtg)
        db.commit()
        db.refresh(new_mtg)
        
        # 解析開始
        asyncio.create_task(self._safe_analyze(new_mtg.id, file_path))

    async def _safe_analyze(self, meeting_id: int, file_path: str):
        """Semaphore で同時実行数を制限しながら解析を実行。"""
        if meeting_id in active_tasks:
            return
            
        active_tasks.add(meeting_id)
        try:
            # 2件まで並列。それ以上はここで待機。
            async with processing_semaphore:
                logger.info(f"[Task] Starting analysis for meeting {meeting_id} ({file_path})...")
                await self.analyzer.analyze_meeting(meeting_id, file_path)
        except Exception as e:
            logger.error(f"Safe analysis failed for {meeting_id}: {e}")
        finally:
            active_tasks.remove(meeting_id)

# Export a simple trigger function
async def run_batch_scan(api_key: str):
    scanner = MeetingScanner(api_key)
    await scanner.scan_and_process()

def create_project_folder(project_name: str):
    """Create a folder for the project in the network drive."""
    if not os.path.exists(BASE_DIR):
        logger.warning(f"Base MTG directory not found: {BASE_DIR}. Could not create project folder.")
        return
    
    # 禁止文字をサニタイズ（念のため）
    import re
    safe_name = re.sub(r'[\\/:*?"<>|]', '_', project_name)
    
    proj_path = os.path.join(BASE_DIR, safe_name)
    if not os.path.exists(proj_path):
        try:
            os.makedirs(proj_path, exist_ok=True)
            logger.info(f"Created project folder: {proj_path}")
        except Exception as e:
            logger.error(f"Failed to create project folder {proj_path}: {e}")
def rename_project_folder(old_name: str, new_name: str):
    """Rename the project folder in the network drive."""
    if not os.path.exists(BASE_DIR):
        return
    
    import re
    old_safe = re.sub(r'[\\/:*?"<>|]', '_', old_name)
    new_safe = re.sub(r'[\\/:*?"<>|]', '_', new_name)
    
    if old_safe == new_safe:
        return
        
    old_path = os.path.join(BASE_DIR, old_safe)
    new_path = os.path.join(BASE_DIR, new_safe)
    
    if os.path.exists(old_path) and not os.path.exists(new_path):
        try:
            os.rename(old_path, new_path)
            logger.info(f"Renamed project folder: {old_path} -> {new_path}")
        except Exception as e:
            logger.error(f"Failed to rename project folder: {e}")
    elif not os.path.exists(old_path):
        # 元のフォルダがない場合は作成を試みる
        create_project_folder(new_name)
