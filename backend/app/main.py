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
    meeting_tasks as meeting_tasks_router,
    admin as admin_router,
    ask as ask_router
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

@app.on_event("startup")
async def startup_event():
    try:
        print("Main: RAGサービスの初期化(インデックス読み込み)を開始します。これには数分かかる場合があります...")
        from .services.rag import rag_service
        await rag_service._ensure_initialized()
        print("Main: RAGサービスの初期化が完了しました。")
        
        # Start auto backup background task
        from .services.auto_backup import auto_backup_loop
        asyncio.create_task(auto_backup_loop())
    except Exception as e:
        print(f"Main: サービスの初期化に失敗しました: {e}")

# CORSミドルウェア
_cors_allow_all = os.getenv("CORS_ALLOW_ALL", "false").lower() == "true"
_default_origins = "http://localhost:5175,http://192.168.44.253:5175,http://localhost:5173"
_cors_origins_str = os.getenv("CORS_ORIGINS", _default_origins)

if _cors_allow_all:
    # 資格情報(Credentials)を使用する場合、allow_origins=["*"] は使えないため
    # 全てのオリジンに一致する正規表現を使用するか、リクエストのOriginを動的に許可する設定にする
    CORS_ORIGINS = []
    CORS_ORIGIN_REGEX = ".*" # 全オリジンを許可
else:
    CORS_ORIGINS = [o.strip() for o in _cors_origins_str.split(",") if o.strip()]
    CORS_ORIGIN_REGEX = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length", "Content-Type", "Content-Disposition"]
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
app.include_router(admin_router.router)

app.include_router(chat_router.router, tags=["Chat"])
app.include_router(meetings_router.router, tags=["Meetings"])
app.include_router(meetings_router.root_router, tags=["Meetings (All)"])
app.include_router(knowledge_router.router, tags=["Knowledge Base"])
app.include_router(meeting_tasks_router.router, tags=["Meeting Tasks"])
app.include_router(tts_router.router, prefix="/tts", tags=["TTS"])
app.include_router(ask_router.router, tags=["Ask"])

@app.get("/tts_debug")
async def tts_debug():
    return {"status": "ok", "message": "TTS route should be active"}

@app.get("/")
async def root():
    return {"message": "Welcome to the Project Management API"}