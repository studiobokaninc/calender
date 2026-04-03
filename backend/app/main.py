from fastapi import FastAPI, Depends, HTTPException, status, Request
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import sys
import os
import logging
import mimetypes
from datetime import datetime
from dotenv import load_dotenv
load_dotenv()

# WindowsではProactorEventLoopを使用することでサブプロセス実行を安定させる
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from . import models, database, security
from .database import engine
from .timezone import now_jst_aware

print("Main: 初期化モジュールをインポート中...")
from . import mock_data
print(f"Main: mock_data インポート完了")

print("Main: ルーターをインポート中...")
from .routers import (
    chat as chat_router,
    meetings as meetings_router,
    knowledge as knowledge_router,
    tts as tts_router,
    auth as auth_router,
    metrics as metrics_router,
    search as search_router,
    google as google_router,
    projects as projects_router,
    tasks as tasks_router,
    events as events_router,
    users as users_router,
    groups as groups_router,
    notes as notes_router,
    activities as activities_router,
    admin as admin_router
)
print("Main: ルーター読み込み完了")

# .m4a などのオーディオファイルのMIMEタイプを追加
mimetypes.add_type('audio/mp4', '.m4a')
mimetypes.add_type('audio/mp4', '.mp4')
mimetypes.add_type('audio/mpeg', '.mp3')
mimetypes.add_type('video/mp4', '.mp4')

# ログの設定
logging.basicConfig(
    level=logging.WARNING,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('app.log')
    ]
)
logging.getLogger("google_genai").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

# DBマイグレーション
print("Main: DBマイグレーションを開始...")
from . import db_auto_migrate
db_auto_migrate.check_and_migrate_db()
print("Main: DBマイグレーション完了")

# データベーステーブルの作成
print("Main: テーブル作成(metadata.create_all)を開始...")
models.Base.metadata.create_all(bind=engine)
print("Main: テーブル作成完了")

# FastAPIアプリケーションインスタンス
app = FastAPI(
    title="プロジェクト管理API",
    description="プロジェクト、タスク、イベント、ユーザーを管理するためのAPI",
    version="0.1.0",
)

# CORSミドルウェア
_cors_allow_all = os.getenv("CORS_ALLOW_ALL", "false").lower() == "true"
_cors_origins_str = os.getenv("CORS_ORIGINS", "http://localhost:5175,http://192.168.44.253:5175")

if _cors_allow_all:
    CORS_ORIGINS = ["*"]
else:
    CORS_ORIGINS = [o.strip() for o in _cors_origins_str.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True if not _cors_allow_all else False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length", "Content-Type"]
)

# --- Router Registration ---
app.include_router(auth_router.router)
app.include_router(metrics_router.router)
app.include_router(search_router.router)
app.include_router(google_router.router)
app.include_router(projects_router.router)
app.include_router(tasks_router.router)
app.include_router(events_router.router)
app.include_router(users_router.router)
app.include_router(groups_router.router)
app.include_router(notes_router.router)
app.include_router(activities_router.router)
app.include_router(admin_router.router, prefix="/api")

app.include_router(chat_router.router, tags=["Chat"])
app.include_router(meetings_router.router, tags=["Meetings"])
app.include_router(meetings_router.root_router, tags=["Meetings (All)"])
app.include_router(knowledge_router.router, tags=["Knowledge Base"])
app.include_router(tts_router.router, prefix="/tts", tags=["TTS"])

@app.get("/tts_debug")
async def tts_debug():
    return {"status": "ok", "message": "TTS route should be active"}

@app.get("/")
async def root():
    return {"message": "Welcome to the Project Management API"}