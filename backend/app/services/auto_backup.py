import asyncio
import logging
import zipfile
import os
from datetime import datetime, timedelta
from pathlib import Path
from sqlalchemy import text
from ..database import engine, DATABASE_FILE_PATH

logger = logging.getLogger(__name__)

BACKUP_DIR = Path(__file__).resolve().parent.parent.parent / "backups"
DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"

def write_backup_data_to_zip(zip_file: zipfile.ZipFile):
    """DBファイルおよびRAGインデックスのデータを指定されたZipFileオブジェクトに書き込むヘルパー"""
    # 1. DBファイルの追加
    db_dir = DATABASE_FILE_PATH.parent
    base_name = DATABASE_FILE_PATH.name
    for suffix in ["", "-wal", "-shm"]:
        file_path = db_dir / (base_name + suffix)
        if file_path.exists():
            zip_file.write(file_path, f"database/{file_path.name}")
    
    # 2. RAGインデックスの追加
    if DATA_DIR.exists():
        for folder_name in ["rag_index", "rag_index_openai"]:
            folder_path = DATA_DIR / folder_name
            if folder_path.exists():
                for root, _, files in os.walk(folder_path):
                    for file in files:
                        abs_path = Path(root) / file
                        rel_path = abs_path.relative_to(DATA_DIR)
                        zip_file.write(abs_path, f"knowledge/{rel_path}")

async def create_local_backup():
    try:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        
        # 過去7世代分のバックアップを残す
        existing_backups = sorted(BACKUP_DIR.glob("backup_*.zip"))
        while len(existing_backups) >= 7:
            oldest = existing_backups.pop(0)
            try:
                os.remove(oldest)
            except Exception as e:
                logger.warning(f"Could not remove old backup {oldest}: {e}")
                
        # DBのチェックポイントを走らせてWALを反映させる
        with engine.connect() as conn:
            conn.execute(text("PRAGMA wal_checkpoint(FULL)"))

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_file = BACKUP_DIR / f"backup_{timestamp}.zip"
        
        with zipfile.ZipFile(backup_file, 'w', zipfile.ZIP_DEFLATED) as zf:
            write_backup_data_to_zip(zf)
            
        logger.info(f"Auto backup created successfully at {backup_file}")
        print(f"Main: Auto backup created successfully at {backup_file}")
    except Exception as e:
        logger.error(f"Auto backup failed: {e}")
        print(f"Main: Auto backup failed: {e}")

async def auto_backup_loop():
    print("Main: Auto backup background task started")
    while True:
        try:
            now = datetime.now()
            # 毎日午前3時にバックアップを実行する
            next_run = now.replace(hour=3, minute=0, second=0, microsecond=0)
            if next_run <= now:
                next_run += timedelta(days=1)
                
            sleep_seconds = (next_run - now).total_seconds()
            print(f"Main: Next auto backup scheduled in {sleep_seconds/3600:.2f} hours (at {next_run})")
            
            await asyncio.sleep(sleep_seconds)
            await create_local_backup()
        except asyncio.CancelledError:
            print("Main: Auto backup task cancelled")
            break
        except Exception as e:
            logger.error(f"Error in auto_backup_loop: {e}")
            await asyncio.sleep(60) # エラーが発生した場合は1分後にリトライ
