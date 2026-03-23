from fastapi import FastAPI, Depends, HTTPException, status, Body, BackgroundTasks, Response, Request, Query, Path, UploadFile, File
import asyncio
import sys

# WindowsではProactorEventLoopを使用することでサブプロセス実行を安定させる
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi.responses import RedirectResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, date, timezone
from typing import Optional, List, Dict, Any, Union, Annotated
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field
from . import models, database, crud, schemas
from .task_utils import normalize_task_type
from . import mock_data
from .database import engine, get_db, DATABASE_FILE_PATH
import uuid
import os
import tempfile
import shutil
from pathlib import Path as PathLibPath
from . import security
from . import google_calendar as google_cal
from .routers import chat as chat_router
from .routers import meetings as meetings_router
from .routers import knowledge as knowledge_router
from .timezone import now_jst_naive, now_jst_aware, JST
from dotenv import load_dotenv
import json
import logging
import math
import mimetypes
import base64
import hmac
import hashlib

# .m4a などのオーディオファイルのMIMEタイプを追加
mimetypes.add_type('audio/mp4', '.m4a')
mimetypes.add_type('audio/mp4', '.mp4')
mimetypes.add_type('audio/mpeg', '.mp3')
mimetypes.add_type('video/mp4', '.mp4')

# ログの設定
logging.basicConfig(
    level=logging.WARNING,  # INFOからWARNINGに変更（ログを軽量化）
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),  # コンソール出力
        logging.FileHandler('app.log')  # ファイル出力
    ]
)
# 特定のライブラリのログを抑制
logging.getLogger("google_genai").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

# DBマイグレーション（カラム追加など）
from . import db_auto_migrate
db_auto_migrate.check_and_migrate_db()

# データベーステーブルの作成
models.Base.metadata.create_all(bind=engine)

# .env を読み込む（backend/.env など）
load_dotenv()
google_api_key = os.getenv('GOOGLE_API_KEY')
logger.debug("After load_dotenv - GOOGLE_API_KEY: %s", (google_api_key[:10] + '...') if google_api_key else 'NOT_SET')

# FastAPIアプリケーションインスタンスの作成
app = FastAPI(
    title="プロジェクト管理API",
    description="プロジェクト、タスク、イベント、ユーザーを管理するためのAPI",
    version="0.1.0",
)

# CORSミドルウェアの設定
# 外部アクセスを許可する場合は、環境変数 CORS_ALLOW_ALL=true を設定
# または CORS_ORIGINS に許可するオリジンをカンマ区切りで指定
_cors_allow_all = os.getenv("CORS_ALLOW_ALL", "false").lower() == "true"
_cors_origins_str = os.getenv("CORS_ORIGINS", "http://localhost:5175,http://192.168.44.253:5175")

if _cors_allow_all:
    # 開発環境での外部アクセス許可（本番環境では非推奨）
    logger.warning("CORS_ALLOW_ALL=true が設定されています。すべてのオリジンからのアクセスを許可します。")
    CORS_ORIGINS = ["*"]
else:
    # 指定されたオリジンのみ許可
    CORS_ORIGINS = [o.strip() for o in _cors_origins_str.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True if not _cors_allow_all else False,  # allow_origins=["*"]の場合はFalseにする必要がある
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length", "Content-Type"]
)

# --- Routers ---
# Vite の proxy が "/api" を剥がしてバックエンドに転送するため、
# バックエンド側はルートに直接マウントしておく
app.include_router(chat_router.router, tags=["Chat"])
app.include_router(meetings_router.router, tags=["Meetings"])
app.include_router(knowledge_router.router, tags=["Knowledge Base"])

# ユーザー認証関連のモデルとユーティリティ
_DEFAULT_SECRET = "your_very_secret_key_that_is_long_and_secure"
SECRET_KEY = os.getenv("SECRET_KEY", _DEFAULT_SECRET)
if SECRET_KEY == _DEFAULT_SECRET:
    logger.warning(
        "SECRET_KEY が環境変数で設定されていません。本番環境では必ず SECRET_KEY を設定してください。"
    )
ALGORITHM = "HS256"
# トークンの有効期限を24時間に設定（5:00でのみログアウトするため）
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 1440))  # 24時間 = 1440分

# pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto") # security.py に移動

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/token")

# ★★★ Create fake_users_db from mock_data ★★★
fake_users_db = {user["username"]: user for user in mock_data.users}

def get_user(db, username: str):
    logger.debug("get_user called with username: %s", username)
    if username in db:
        user_dict = db[username]
        logger.debug("User found in fake_db: %s", user_dict)
        return user_dict
    logger.debug("User NOT found in fake_db")
    return None

def authenticate_user(db: Session, username: str, password: str) -> Union[models.User, bool]:
    """ユーザー名とパスワードで認証し、成功すれば User オブジェクトを返す"""
    db_user = crud.get_user_by_email(db, email=username)
    if not db_user:
        return False
    # verify_password を security から呼び出す
    if not security.verify_password(password, db_user.hashed_password):
        return False
    return db_user

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """
    JWTアクセストークンを作成。
    期限は「次の午前5時 (JST)」に設定。
    """
    to_encode = data.copy()
    
    # 日本時間 (JST) での現在時刻を取得
    now_jst = now_jst_aware()
    
    # 「次の午前5時」を計算
    # 5時前なら今日の5時、5時過ぎなら明日の5時
    if now_jst.hour < 5:
        target_5am_jst = now_jst.replace(hour=5, minute=0, second=0, microsecond=0)
    else:
        target_5am_jst = (now_jst + timedelta(days=1)).replace(hour=5, minute=0, second=0, microsecond=0)
    
    # JWT の exp クレーム用には UTC 形式の datetime を渡す (python-jose が処理)
    expire = target_5am_jst.astimezone(timezone.utc).replace(tzinfo=None)
    
    # 開発用などの明示的な期限指定がある場合はそちらを優先
    if expires_delta:
        expire = datetime.utcnow() + expires_delta

    to_encode.update({"exp": expire})
    # チャットルーター等が security.get_current_user を使うため、同じ SECRET_KEY で発行する
    encoded_jwt = jwt.encode(to_encode, security.SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: Session = Depends(get_db)) -> models.User:
    """JWT トークンを検証し、対応するユーザーを DB から取得"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, security.SECRET_KEY, algorithms=[ALGORITHM])
        username: str | None = payload.get("sub")  # トークンには username (email) が入っている想定
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = crud.get_user_by_email(db, email=username)
    if user is None:
        raise credentials_exception
    return user

# ★★★ Moved get_current_active_admin definition here ★★★
async def get_current_active_admin(current_user: Annotated[models.User, Depends(get_current_user)]) -> models.User:
    """現在のユーザーが管理者ロールを持っているか確認"""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="管理者権限が必要です",
        )
    return current_user

@app.post("/api/auth/token", tags=["Auth"])
def login_for_access_token(form_data: Annotated[OAuth2PasswordRequestForm, Depends()], db: Session = Depends(get_db)):
    """ユーザー名とパスワードで認証し、アクセストークンを返す"""
    user = authenticate_user(db, username=form_data.username, password=form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires  # トークンには email を格納
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/users/me", response_model=schemas.UserResponse, tags=["Users"])
async def read_users_me(current_user: Annotated[models.User, Depends(get_current_user)]):
    """現在認証されているユーザーの情報を返す"""
    # SQLAlchemy モデルを Pydantic モデルに変換して返す (orm_mode=True)
    return current_user

@app.get("/")
async def root():
    return {"message": "Welcome to the Project Management API"}

# メトリクスエンドポイント
@app.get("/metrics/dashboard")
def get_dashboard_metrics(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    # 統計取得前にタスクステータスを自動更新する（遅延判定など）
    try:
        crud.auto_update_task_statuses(db)
    except Exception as e:
        logger.error(f"Error auto-updating task statuses: {e}")

    num_tasks = 0
    try:
        # get_tasks に渡すパラメータを調整する必要があるかもしれません。
        # 例えば、管理者ユーザーの場合は全てのタスクをカウントし、
        # 一般ユーザーの場合はそのユーザーに関連するタスクのみをカウントするなど。
        # ここでは一旦、全タスクを取得してカウントする想定です。
        # crud.get_tasks が display_status や user_id などのフィルタを考慮する場合、
        # メトリクス用のカウントではそれらを解除するか、専用のカウント関数が必要です。
        # ここでは limit のみ指定して試みます。
        tasks_from_db = crud.get_tasks(db=db, limit=100000) # 十分大きなlimit
        if tasks_from_db: # Noneでないことを確認
            num_tasks = len(tasks_from_db)
    except Exception as e:
        print(f"Error counting tasks for metrics: {e}")
        # エラーが発生した場合でも、他のメトリクスは表示できるようフォールバック
        num_tasks = -1 # エラーを示す値など

    # すべてのメトリクスをデータベースから取得
    num_projects = 0
    num_events = 0
    num_users = 0
    
    try:
        # プロジェクト数を取得（管理者は全件、一般ユーザーはonlineのみ）
        if current_user.role == 'admin':
            projects_from_db = crud.get_projects(db=db, skip=0, limit=100000, display_status_in=None)
        else:
            projects_from_db = crud.get_projects(db=db, skip=0, limit=100000, display_status_in=['online'])
        if projects_from_db:
            num_projects = len(projects_from_db)
    except Exception as e:
        print(f"Error counting projects for metrics: {e}")
        num_projects = -1
    
    try:
        # イベント数を取得
        events_from_db = crud.get_events(db=db, skip=0, limit=100000)
        if events_from_db:
            num_events = len(events_from_db)
    except Exception as e:
        print(f"Error counting events for metrics: {e}")
        num_events = -1
    
    try:
        # ユーザー数を取得
        users_from_db = crud.get_users(db=db, skip=0, limit=100000)
        if users_from_db:
            num_users = len(users_from_db)
    except Exception as e:
        print(f"Error counting users for metrics: {e}")
        num_users = -1

    return {
        "users": num_users,
        "tasks": num_tasks,
        "projects": num_projects,
        "events": num_events
    }


@app.get("/metrics/labor-report", tags=["Metrics"])
def get_labor_report_endpoint(
    group_by: str = Query("user", description="集計単位: user または project"),
    from_date: Optional[str] = Query(None, description="集計開始日 YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="集計終了日 YYYY-MM-DD"),
    include_offline: bool = Query(False, description="オフラインのプロジェクトを含めるかどうか"),
    include_completed: bool = Query(False, description="完了タスクを含めるかどうか"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """工数集計レポート（タスクの cost を担当者別またはプロジェクト別に集計）"""
    if group_by not in ("user", "project"):
        raise HTTPException(status_code=400, detail="group_by は user または project を指定してください")
    from_dt = None
    to_dt = None
    if from_date:
        try:
            from_dt = datetime.strptime(from_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="from_date は YYYY-MM-DD 形式で指定してください")
    if to_date:
        try:
            to_dt = datetime.strptime(to_date + " 23:59:59", "%Y-%m-%d %H:%M:%S")
        except ValueError:
            raise HTTPException(status_code=400, detail="to_date は YYYY-MM-DD 形式で指定してください")
    return crud.get_labor_report(db=db, group_by=group_by, from_date=from_dt, to_date=to_dt, include_offline=include_offline, include_completed=include_completed)


@app.get("/metrics/weekly-availability", tags=["Metrics"])
def get_weekly_availability_endpoint(
    week_start: Optional[str] = Query(None, description="週の開始日（月曜）YYYY-MM-DD。未指定時は今週の月曜"),
    only_free: bool = Query(False, description="True の場合、その週に余裕があるユーザーのみ返す"),
    include_offline: bool = Query(False, description="オフラインのプロジェクトのタスクを含めるか"),
    include_completed: bool = Query(True, description="完了タスクの工数を含めるか"),
    consider_dependencies: bool = Query(True, description="依存タスクを考慮する（依存先が未完の日は工数に含めない）"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    指定週のユーザー別「割り当て工数」と「余裕時間」を返す。
    タスクの開始日・期日とコスト（所要時間＝時間、cost/8で日数）からその週に重なる工数を按分。
    依存関係を考慮する場合、依存先が「完了」または「その日までに期日」の日のみ工数にカウントする。
    週の稼働可能時間は40時間。余裕時間 = 40 - 割り当て工数。
    """
    if week_start:
        try:
            week_start_date = datetime.strptime(week_start, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="week_start は YYYY-MM-DD 形式で指定してください")
    else:
        today = date.today()
        week_start_date = today - timedelta(days=today.weekday())  # 月曜
    # 今日を基準に経過・残りを計算。完了タスクも含める（その週の期間内に作業していた分を計上）
    reference_date = date.today()
    items = crud.get_weekly_workload(
        db=db,
        week_start=week_start_date,
        reference_date=reference_date,
        include_offline=include_offline,
        include_completed=include_completed,
        consider_dependencies=consider_dependencies,
    )
    if only_free:
        items = [x for x in items if x["free_hours"] > 0]
    return {
        "week_start": week_start_date.isoformat(),
        "hours_per_day": 8,
        "max_hours_per_week": 40,
        "consider_dependencies": consider_dependencies,
        "users": items,
    }


@app.get("/metrics/daily-availability", tags=["Metrics"])
def get_daily_availability_endpoint(
    target_date: Optional[str] = Query(None, description="対象日 YYYY-MM-DD。未指定時は今日"),
    only_free: bool = Query(False, description="True の場合、その日に余裕があるユーザーのみ返す"),
    include_offline: bool = Query(False, description="オフラインのプロジェクトのタスクを含めるか"),
    include_completed: bool = Query(True, description="完了タスクの工数を含めるか"),
    consider_dependencies: bool = Query(True, description="依存タスクを考慮する（依存先が未完ならそのタスクの工数は含めない）"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    指定日のユーザー別「割り当て工数」と「余裕時間」を返す。
    コスト/8で日数、開始日・期日でその日に重なる工数を按分。1日8時間を上限に余裕 = 8 - 割り当て。
    依存関係を考慮する場合、依存先が完了または期日がその日以前のときのみ工数にカウントする。
    """
    if target_date:
        try:
            target_date_parsed = datetime.strptime(target_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="target_date は YYYY-MM-DD 形式で指定してください")
    else:
        target_date_parsed = date.today()
    # 計算対象は未完了タスクのみ。基準日は target_date（今日から見た情報）
    items = crud.get_daily_workload(
        db=db,
        target_date=target_date_parsed,
        include_offline=include_offline,
        include_completed=False,
        consider_dependencies=consider_dependencies,
    )
    if only_free:
        items = [x for x in items if x["free_hours"] > 0]
    return {
        "date": target_date_parsed.isoformat(),
        "hours_per_day": 8,
        "consider_dependencies": consider_dependencies,
        "users": items,
    }


def _do_global_search(db: Session, q_trimmed: str, limit: int):
    """検索実行（/search と /api/search の両方から利用）"""
    if len(q_trimmed) < 1:
        return {"projects": [], "tasks": [], "events": []}
    projects = crud.search_projects(db=db, q=q_trimmed, limit=limit)
    tasks = crud.search_tasks(db=db, q=q_trimmed, limit=limit)
    events = crud.search_events(db=db, q=q_trimmed, limit=limit)
    project_id_to_name: Dict[int, str] = {}
    for t in tasks:
        if t.project_id and t.project_id not in project_id_to_name:
            proj = crud.get_project(db, t.project_id)
            project_id_to_name[t.project_id] = proj.name if proj else ""

    def _event_to_dict(e):
        return {
            "id": e.id,
            "title": e.title,
            "start_time": e.start_time.isoformat() if e.start_time else None,
            "end_time": e.end_time.isoformat() if e.end_time else None,
        }

    return {
        "projects": [{"id": p.id, "name": p.name, "description": (p.description or "")[:200]} for p in projects],
        "tasks": [
            {"id": t.id, "name": t.name, "project_id": t.project_id, "project_name": project_id_to_name.get(t.project_id) if t.project_id else None, "due_date": t.due_date.isoformat() if t.due_date else None}
            for t in tasks
        ],
        "events": [_event_to_dict(e) for e in events],
    }


@app.get("/search", tags=["Search"])
@app.get("/api/search", tags=["Search"])
def global_search(
    q: str = Query("", min_length=0, description="検索キーワード"),
    limit: int = Query(10000, ge=1, le=10000, description="各カテゴリ（プロジェクト・タスク・イベント）の最大取得件数。ヒットしたものは全て返すため大きめの値"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """プロジェクト・タスク・イベントを横断検索。プロジェクト名/説明、タスク名/説明、イベントタイトル/説明を対象にする。"""
    q_trimmed = (q or "").strip()
    return _do_global_search(db, q_trimmed, limit)


# --- Google Calendar 連携（ユーザー個人のカレンダーにタスクを1件ずつ表示ON/OFF）---

def _google_state_sign(user_id: int) -> str:
    """state パラメータ用: user_id を署名付きでエンコード"""
    raw = str(user_id).encode("utf-8")
    sig = hmac.new(SECRET_KEY.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(raw).decode("utf-8") + "." + sig


def _google_state_verify(state: str) -> Optional[int]:
    """state を検証して user_id を返す。無効なら None"""
    try:
        part = state.split(".")
        if len(part) != 2:
            return None
        raw = base64.urlsafe_b64decode(part[0].encode("utf-8")).decode("utf-8")
        user_id = int(raw)
        expected = hmac.new(SECRET_KEY.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(part[1], expected):
            return None
        return user_id
    except Exception:
        return None


@app.get("/api/google/status", tags=["Google Calendar"])
def google_calendar_status(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Google カレンダー連携の設定状況と、連携済みタスク/イベントIDリストを返す"""
    configured = google_cal.is_google_configured()
    token = crud.get_user_google_token(db, current_user.id) if configured else None
    connected = token is not None
    synced_task_ids = crud.get_synced_task_ids_for_user(db, current_user.id) if connected else []
    synced_event_ids = crud.get_synced_event_ids_for_user(db, current_user.id) if connected else []
    return {
        "configured": configured,
        "connected": connected,
        "synced_task_ids": synced_task_ids,
        "synced_event_ids": synced_event_ids,
    }


@app.get("/api/google/authorize", tags=["Google Calendar"])
def google_calendar_authorize(
    current_user: models.User = Depends(get_current_user),
):
    """Google 認証ページの URL を返す。フロントはこの URL に window.location で遷移させる（JWT は送れないためリダイレクトは API 側で行わない）"""
    if not google_cal.is_google_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google 連携が設定されていません。バックエンドの環境変数 GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を設定してください。"
        )
    state = _google_state_sign(current_user.id)
    url = google_cal.get_authorize_url(state=state)
    if not url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="認証URLを生成できません。GOOGLE_CLIENT_ID または GOOGLE_REDIRECT_URI が正しく設定されているか確認してください。"
        )
    return {"url": url}


@app.get("/api/google/callback", tags=["Google Calendar"])
def google_calendar_callback(
    background_tasks: BackgroundTasks,
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """OAuth コールバック。コードをトークンに交換し、ユーザーに紐付けて保存。その後フロントへリダイレクト。"""

    frontend_base = os.getenv("FRONTEND_URL", "http://localhost:5175")
    
    # Google OAuth エラーがある場合
    if error:
        logger.error(f"Google OAuth error: {error}")
        return RedirectResponse(url=f"{frontend_base}/calendar?google=error&reason={error}")
    
    # code と state がない場合
    if not code or not state:
        logger.error("Google callback missing code or state")
        return RedirectResponse(url=f"{frontend_base}/calendar?google=error&reason=missing_params")
    
    # state の検証
    user_id = _google_state_verify(state)
    if user_id is None:
        logger.error("Google callback invalid state")
        return RedirectResponse(url=f"{frontend_base}/calendar?google=error&reason=invalid_state")
    
    # トークン交換
    try:
        tokens = google_cal.exchange_code_for_tokens(code)
        if not tokens:
            logger.error("Google token exchange failed")
            return RedirectResponse(url=f"{frontend_base}/calendar?google=error&reason=token_exchange_failed")
    except Exception as e:
        logger.exception(f"Google token exchange exception: {e}")
        return RedirectResponse(url=f"{frontend_base}/calendar?google=error&reason=token_exchange_exception")
    
    # トークンの保存
    try:
        access_token = tokens.get("access_token")
        refresh_token = tokens.get("refresh_token")
        expires_in = tokens.get("expires_in")
        expires_at = None
        if expires_in is not None:
            expires_at = datetime.utcnow() + timedelta(seconds=int(expires_in))
        crud.upsert_user_google_token(
            db, user_id=user_id, access_token=access_token, refresh_token=refresh_token, expires_at=expires_at
        )
        logger.info(f"Google token saved for user {user_id}")
        
        # トークンの保存完了後、一般ユーザーのみ自動同期を実行
        user_record = crud.get_user(db, user_id=user_id)
        if user_record and user_record.role != "admin":
            from app.services.google_sync import initial_sync_for_user_bg
            background_tasks.add_task(initial_sync_for_user_bg, user_id)
        else:
            logger.info(f"Skipping auto-sync for admin user {user_id}")
        
    except Exception as e:
        logger.exception(f"Failed to save Google token: {e}")
        return RedirectResponse(url=f"{frontend_base}/calendar?google=error&reason=save_failed")
    
    # フロントのカレンダーページへ（クエリで成功を伝える）
    return RedirectResponse(url=f"{frontend_base}/calendar?google=connected")


@app.delete("/api/google/disconnect", tags=["Google Calendar"])
def google_calendar_disconnect(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Google連携を解除する"""
    if not crud.delete_user_google_token(db, current_user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Google 連携が見つかりません")
    
    # 既存の同期レコードをすべて削除（必要に応じてGoogleカレンダー上の予定も削除できますが、ここでは単純に連携解除のみとします）
    db.query(models.TaskGoogleSync).filter(models.TaskGoogleSync.user_id == current_user.id).delete()
    db.query(models.ProjectGoogleSync).filter(models.ProjectGoogleSync.user_id == current_user.id).delete()
    db.query(models.EventGoogleSync).filter(models.EventGoogleSync.user_id == current_user.id).delete()
    db.commit()
    
    return {"message": "Google 連携を解除しました"}

class TaskGoogleSyncRequest(BaseModel):
    sync: bool  # True=表示する, False=表示しない

class BulkTaskGoogleSyncRequest(BaseModel):
    task_ids: List[int]
    sync: bool



@app.post("/api/google/sync/task/{task_id}", tags=["Google Calendar"])
def google_calendar_sync_task(
    task_id: int,
    body: TaskGoogleSyncRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """タスクを「自分の Google カレンダーに表示する」を ON/OFF する。ON の場合はイベント作成、OFF の場合は削除。"""
    if not google_cal.is_google_configured():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google 連携が設定されていません")
    token_row = crud.get_user_google_token(db, current_user.id)
    if not token_row:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="先に Google カレンダーと連携してください")
    db_task = crud.get_task(db, task_id=task_id)
    if not db_task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="タスクが見つかりません")

    if body.sync:
        # 手動同期がリクエストされた場合は、タスクを強制的にオンライン状態にする
        if db_task.display_status == 'offline':
            db_task.display_status = 'online'
            db.commit()
            logger.info(f"Forced task {task_id} to online for synchronization")
            
        from app.services.google_sync import sync_task_to_google
        try:
            success = sync_task_to_google(db, db_task, token_row, current_user.id)
            if success:
                return {"synced": True, "message": "タスクを Google カレンダーに追加しました"}
            else:
                return {"synced": False, "message": "タスクはオフライン設定のため同期されませんでした"}
        except Exception as e:
            logger.exception(f"Manual sync failed: {e}")
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Google カレンダーへの同期に失敗しました: {str(e)}")
    else:
        # 同期解除・イベント削除
        sync_row = crud.get_task_google_sync(db, current_user.id, task_id)
        if sync_row:
            google_cal.delete_calendar_event(
                token_row.access_token, token_row.refresh_token, token_row.expires_at, sync_row.google_event_id, calendar_id=token_row.calendar_id
            )
            crud.delete_task_google_sync(db, current_user.id, task_id)
        return {"synced": False, "message": "Google カレンダーからの表示を解除しました"}

@app.post("/api/google/sync/tasks/bulk", tags=["Google Calendar"])
def google_calendar_sync_tasks_bulk(
    body: BulkTaskGoogleSyncRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """複数タスクを一括で同期ON/OFFする"""
    if not google_cal.is_google_configured():
        raise HTTPException(status_code=503, detail="Google 連携が設定されていません")
    token_row = crud.get_user_google_token(db, current_user.id)
    if not token_row:
        raise HTTPException(status_code=400, detail="先に Google カレンダーと連携してください")
    
    from app.services.google_sync import sync_task_to_google
    count = 0
    skipped = 0
    errors = 0
    
    logger.info(f"[Bulk Sync] Processing {len(body.task_ids)} tasks for user {current_user.id}")
    
    print(f"[Bulk Sync] Starting bulk sync for {len(body.task_ids)} tasks: {body.task_ids}")
    for tid in body.task_ids:
        db_task = crud.get_task(db, task_id=tid)
        if not db_task:
            msg = f"[Bulk Sync] Task not found in DB: {tid}"
            logger.warning(msg)
            print(msg)
            skipped += 1
            continue
        
        if body.sync:
            try:
                # 一括同期時も、オフラインのタスクがあればオンラインにする
                if db_task.display_status == 'offline':
                    db_task.display_status = 'online'
                    db.commit()
                    logger.info(f"Forced task {tid} to online for bulk synchronization")
                    
                success = sync_task_to_google(db, db_task, token_row, current_user.id)
                if success:
                    count += 1
                else:
                    skipped += 1
            except Exception as e:
                logger.error(f"Bulk sync failed for task {tid}: {e}")
                errors += 1
        else:
            try:
                sync_row = crud.get_task_google_sync(db, current_user.id, tid)
                if sync_row:
                    google_cal.delete_calendar_event(
                        token_row.access_token, token_row.refresh_token, token_row.expires_at, sync_row.google_event_id, calendar_id=token_row.calendar_id
                    )
                    crud.delete_task_google_sync(db, current_user.id, tid)
                    count += 1
                else:
                    skipped += 1
            except Exception as e:
                logger.error(f"Bulk disconnect failed for task {tid}: {e}")
                errors += 1
    
    msg = f"{count} 件のタスクを更新しました"
    if skipped > 0: msg += f" ({skipped} 件スキップ)"
    if errors > 0: msg += f" ({errors} 件エラー)"
    
    return {"message": msg, "count": count, "skipped": skipped, "errors": errors}

@app.post("/api/google/sync/event/{event_id}", tags=["Google Calendar"])
def google_calendar_sync_event(
    event_id: int,
    body: TaskGoogleSyncRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """会議やワークショップなどのイベントを「自分の Google カレンダーに表示する」を ON/OFF する"""
    if not google_cal.is_google_configured():
         raise HTTPException(status_code=503, detail="Google 連携が設定されていません")
    token_row = crud.get_user_google_token(db, current_user.id)
    if not token_row:
        raise HTTPException(status_code=400, detail="先に Google カレンダーと連携してください")
    db_event = crud.get_event(db, event_id=event_id)
    if not db_event:
        raise HTTPException(status_code=404, detail="イベントが見つかりません")

    from app.services.google_sync import sync_event_to_google
    if body.sync:
        try:
            sync_event_to_google(db, db_event, token_row, current_user.id)
            return {"synced": True, "message": "イベントを Google カレンダーに追加しました"}
        except Exception as e:
            logger.exception(f"Manual event sync failed: {e}")
            raise HTTPException(status_code=502, detail="Google カレンダーへの同期に失敗しました")
    else:
        sync_row = crud.get_event_google_sync(db, current_user.id, event_id)
        if sync_row:
            google_cal.delete_calendar_event(
                token_row.access_token, token_row.refresh_token, token_row.expires_at, sync_row.google_event_id, calendar_id=token_row.calendar_id
            )
            crud.delete_event_google_sync(db, current_user.id, event_id)
        return {"synced": False, "message": "Google カレンダーからの表示を解除しました"}


@app.get("/api/google/sync/tasks", tags=["Google Calendar"])
def google_calendar_synced_tasks(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """現在のユーザーが「Google に表示」を ON にしているタスク ID のリスト"""
    ids = crud.get_synced_task_ids_for_user(db, current_user.id)
    return {"task_ids": ids}


@app.get("/projects", response_model=List[schemas.ProjectResponse], tags=["Projects"])
def get_projects_endpoint(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    skip: int = 0,
    limit: int = 10000,
    display_status: Optional[str] = Query(None, description="表示ステータスでフィルタ (カンマ区切りで複数指定可: online,offline,archived)")
):
    """プロジェクトのリストを取得"""
    display_status_list = None
    if display_status:
        display_status_list = [s.strip() for s in display_status.split(',') if s.strip() in ['online', 'offline', 'archived']]
        if not display_status_list: # 有効なステータスがない場合はNone扱い(全件またはデフォルトへ)
            display_status_list = None 
    
    if current_user.role == 'admin':
        if display_status_list is None: # 管理者で指定がない場合は全件
            display_status_list = ['online', 'offline', 'archived']
    else: # 一般ユーザーの場合
        if display_status_list is None: # 指定がなければ online のみ
            display_status_list = ['online']
        else: # 指定があっても online のみ許可 (セキュリティのため上書き)
            display_status_list = ['online']
            
    projects = crud.get_projects(db=db, skip=skip, limit=limit, display_status_in=display_status_list)
    return projects

@app.get("/projects/{project_id}", response_model=schemas.ProjectResponse, tags=["Projects"])
def get_project_endpoint(
    project_id: int, # パスパラメータから project_id を受け取る
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user) # 認証
):
    """指定された ID のプロジェクト詳細を取得"""
    db_project = crud.get_project(db=db, project_id=project_id)
    if db_project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="プロジェクトが見つかりません"
        )
    # FastAPI が自動的に schemas.ProjectResponse に変換して返す
    return db_project

@app.post("/projects", response_model=schemas.ProjectResponse, status_code=status.HTTP_201_CREATED, tags=["Projects"])
def create_project_endpoint(
    project_data: schemas.ProjectCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin),
):
    """新規プロジェクトを作成（管理者のみ）"""
    created_project = crud.create_project(db=db, project=project_data)
    from app.services.google_sync import auto_sync_project_bg
    background_tasks.add_task(auto_sync_project_bg, created_project.id)
    return created_project

@app.put("/projects/{project_id}", response_model=schemas.ProjectResponse, tags=["Projects"])
def update_project_endpoint(
    project_id: int,
    project_data: schemas.ProjectUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin),
):
    """プロジェクト情報を更新（管理者のみ）"""
    db_project = crud.get_project(db=db, project_id=project_id)
    if db_project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="プロジェクトが見つかりません"
        )
    updated_project = crud.update_project(db=db, db_project=db_project, project_in=project_data)
    # プロジェクトが完了またはキャンセルになった場合、そのプロジェクトに属する未完了タスクをすべて完了にする
    if updated_project.status == models.ProjectStatus.COMPLETED or updated_project.status == models.ProjectStatus.CANCELLED:
        crud.complete_tasks_for_project(db=db, project_id=project_id)
        
    from app.services.google_sync import auto_sync_project_bg
    background_tasks.add_task(auto_sync_project_bg, updated_project.id)
    
    return updated_project

@app.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Projects"])
def delete_project_endpoint(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin),
):
    """プロジェクトを削除（管理者のみ）"""
    from sqlalchemy import text
    
    try:
        # プロジェクトの存在確認（SQLで直接確認）
        project_check = db.execute(
            text("SELECT id, name FROM projects WHERE id = :project_id"),
            {"project_id": project_id}
        ).fetchone()
        
        if not project_check:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="プロジェクトが見つかりません"
            )
        
        # 1. 関連するタスクのIDを取得（生SQLで無効なデータを回避）
        task_ids_result = db.execute(
            text("SELECT id FROM tasks WHERE project_id = :project_id"),
            {"project_id": project_id}
        ).fetchall()
        task_ids = [row.id for row in task_ids_result]

        # 1b. 関連するイベントのIDを取得
        event_ids_result = db.execute(
            text("SELECT id FROM events WHERE project_id = :project_id"),
            {"project_id": project_id}
        ).fetchall()
        event_ids = [row.id for row in event_ids_result]
        
        # 2. タスクのステータス履歴を削除
        if task_ids:
            placeholders = ','.join([f":tid{i}" for i in range(len(task_ids))])
            params = {f"tid{i}": tid for i, tid in enumerate(task_ids)}
            db.execute(
                text(f"DELETE FROM task_status_history WHERE task_id IN ({placeholders})"),
                params
            )
        
        # 3. タスクを削除
        db.execute(
            text("DELETE FROM tasks WHERE project_id = :project_id"),
            {"project_id": project_id}
        )
        
        # 4. 関連するイベントを削除
        db.execute(
            text("DELETE FROM events WHERE project_id = :project_id"),
            {"project_id": project_id}
        )
        
        # 5. プロジェクトを削除
        db.execute(
            text("DELETE FROM projects WHERE id = :project_id"),
            {"project_id": project_id}
        )
        
        # --- Google Calendar 同期削除 ---
        if google_cal.is_google_configured():
            # プロジェクト自体の同期削除
            p_syncs = db.query(models.ProjectGoogleSync).filter(models.ProjectGoogleSync.project_id == project_id).all()
            for ps in p_syncs:
                t_row = crud.get_user_google_token(db, ps.user_id)
                if t_row:
                    google_cal.delete_calendar_event(t_row.access_token, t_row.refresh_token, t_row.expires_at, ps.google_event_id, t_row.calendar_id)
                db.delete(ps)
            
            # タスクの同期削除 (収集した task_ids を利用)
            for tid in task_ids:
                t_syncs = db.query(models.TaskGoogleSync).filter(models.TaskGoogleSync.task_id == tid).all()
                for ts in t_syncs:
                    t_row = crud.get_user_google_token(db, ts.user_id)
                    if t_row:
                        google_cal.delete_calendar_event(t_row.access_token, t_row.refresh_token, t_row.expires_at, ts.google_event_id, t_row.calendar_id)
                    db.delete(ts)
            
            # イベントの同期削除 (収集した event_ids を利用)
            from app.services.google_sync import delete_event_syncs, delete_project_syncs
            for eid in event_ids:
                delete_event_syncs(db, eid)
            
            # プロジェクトの同期削除
            delete_project_syncs(db, project_id)
        
        db.commit()
        
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    except HTTPException as he:
        db.rollback()
        raise he
    except Exception:
        db.rollback()
        logger.exception("プロジェクト削除中にエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="プロジェクトの削除中にエラーが発生しました。"
        )

@app.get("/tasks/{task_id}", response_model=schemas.TaskResponse, tags=["Tasks"])
def get_task_endpoint(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """1件のタスクを取得（グローバル検索からのその場編集用）"""
    db_task = crud.get_task(db=db, task_id=task_id)
    if db_task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="タスクが見つかりません")
    return db_task


@app.get("/tasks", response_model=List[schemas.TaskResponse])
def get_tasks_endpoint(
    project_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 10000,
    display_status_in: Optional[List[str]] = None,
    db: Session = Depends(get_db)
):
    """タスクリストを取得するエンドポイント"""
    try:
        tasks = crud.get_tasks(
            db=db,
            project_id=project_id,
            skip=skip,
            limit=limit,
            display_status_in=display_status_in
        )
        
        # タスクの依存関係を処理（N+1クエリ問題を解決するため、バッチ処理に変更）
        # まず、すべての依存タスクIDを収集
        all_depends_on_ids = set()
        for task in tasks:
            task['dependsOnTasks'] = []  # デフォルト値を設定
            try:
                depends_on = task.get('dependsOn')
                if depends_on and isinstance(depends_on, list):
                    for depends_on_id in depends_on:
                        try:
                            if isinstance(depends_on_id, str):
                                task_id = int(depends_on_id)
                            elif isinstance(depends_on_id, int):
                                task_id = depends_on_id
                            else:
                                continue
                            all_depends_on_ids.add(task_id)
                        except (ValueError, TypeError):
                            continue
            except Exception:
                pass
        
        # すべての依存タスクを一度に取得
        depends_on_tasks_map = {}
        if all_depends_on_ids:
            try:
                depends_on_tasks_list = db.query(models.Task).filter(
                    models.Task.id.in_(list(all_depends_on_ids))
                ).all()
                for dep_task in depends_on_tasks_list:
                    depends_on_tasks_map[dep_task.id] = {
                        'id': dep_task.id,
                        'name': dep_task.name,
                        'status': dep_task.status
                    }
            except Exception as e:
                logger.error(f"依存タスクの一括取得に失敗: {str(e)}")
        
        # 各タスクの依存関係を設定
        for task in tasks:
            try:
                depends_on = task.get('dependsOn')
                if not depends_on or not isinstance(depends_on, list):
                    continue
                
                depends_on_tasks = []
                for depends_on_id in depends_on:
                    try:
                        if isinstance(depends_on_id, str):
                            task_id = int(depends_on_id)
                        elif isinstance(depends_on_id, int):
                            task_id = depends_on_id
                        else:
                            continue
                        
                        if task_id in depends_on_tasks_map:
                            depends_on_tasks.append(depends_on_tasks_map[task_id])
                    except (ValueError, TypeError):
                        continue
                
                task['dependsOnTasks'] = depends_on_tasks
            except Exception as e:
                logger.error(f"タスク {task.get('id')} の依存関係処理に失敗: {str(e)}")
                task['dependsOnTasks'] = []
        
        return tasks

    except Exception:
        logger.exception("タスクの取得に失敗しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="タスクの取得に失敗しました。"
        )

@app.get("/calendar/events", response_model=List[schemas.EventResponse], tags=["Events"])
async def get_events_endpoint(
    project_id: Optional[str] = Query(None, description="プロジェクトIDでフィルタリング"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    skip: int = 0,
    limit: int = 10000  # ← ここを1000に変更
):
    """
    イベントのリストを取得 (プロジェクトIDでフィルタ可能)
    """
    project_id_int: Optional[int] = None
    if project_id is not None:
        project_id_int = crud._parse_int_safe(project_id)
        if project_id_int is None: # この行のインデントを修正
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無効なプロジェクトID形式です。"
            )

    events = crud.get_events(db=db, skip=skip, limit=limit, project_id=project_id_int)
    return events


@app.get("/calendar/events/{event_id}", response_model=schemas.EventResponse, tags=["Events"])
async def get_event_endpoint(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """1件のイベントを取得（グローバル検索からのその場編集用）"""
    db_event = crud.get_event(db=db, event_id=event_id)
    if db_event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="イベントが見つかりません")
    return db_event


@app.post("/calendar/events", response_model=schemas.EventResponse, status_code=status.HTTP_201_CREATED, tags=["Events"])
async def create_event_endpoint(
    event_data: schemas.EventCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """新規イベントを作成 (認証済みユーザーのみ、デフォルトステータスは 'offline')"""
    created_event = crud.create_event(db=db, event=event_data)
    from app.services.google_sync import auto_sync_event_bg
    background_tasks.add_task(auto_sync_event_bg, created_event.id)
    return created_event

@app.put("/calendar/events/{event_id}", response_model=schemas.EventResponse, tags=["Events"])
async def update_event_endpoint(
    event_id: int,
    event_data: schemas.EventUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """イベント情報を更新 (ステータス変更は管理者のみ)"""
    db_event = crud.get_event(db=db, event_id=event_id)
    if db_event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    # 権限チェック: ステータス変更は管理者のみ（その他の更新は認証済みユーザーで許可）
    if event_data.status is not None and db_event.status != event_data.status:
        if current_user.role != 'admin':
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="イベントステータスを変更する権限がありません"
            )
    updated_event = crud.update_event(db=db, db_event=db_event, event_in=event_data)
    
    from app.services.google_sync import auto_sync_event_bg
    background_tasks.add_task(auto_sync_event_bg, updated_event.id)
    
    return updated_event

@app.delete("/calendar/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Events"])
async def delete_event_endpoint(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """イベントを削除 (管理者のみ)"""
    db_event = crud.get_event(db=db, event_id=event_id)
    if db_event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    # 権限チェック: 管理者のみ
    if current_user.role != 'admin':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="イベントを削除する権限がありません"
        )
    # Google カレンダー同期削除
    if google_cal.is_google_configured():
        from app.services.google_sync import delete_event_syncs
        delete_event_syncs(db, event_id)

    crud.delete_event(db=db, db_event=db_event)
    return None # 204 No Content

@app.get("/api/users", response_model=List[schemas.UserResponse], tags=["Users"])
async def get_users_endpoint(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    skip: int = 0,
    limit: int = 10000
):
    """ユーザーのリストを取得"""
    try:
        print(f"[DEBUG] ユーザー取得開始: skip={skip}, limit={limit}")
        users = crud.get_users(db=db, skip=skip, limit=limit)
        
        # メールアドレスのバリデーション
        valid_users = []
        for user in users:
            if not user.email or '@' not in user.email:
                print(f"[WARNING] 無効なメールアドレスを持つユーザーをスキップ: {user.email}")
                continue
            valid_users.append(user)
            
        print(f"[DEBUG] 取得したユーザー数: {len(valid_users)}")
        return valid_users
    except Exception:
        logger.exception("ユーザー情報の取得に失敗しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ユーザー情報の取得に失敗しました。"
        )


@app.get("/api/groups", response_model=List[schemas.GroupResponse], tags=["Groups"])
async def get_groups_endpoint(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    skip: int = 0,
    limit: int = 10000
):
    """グループのリストを取得"""
    groups = crud.get_groups(db=db, skip=skip, limit=limit)
    return groups

@app.post("/api/groups", response_model=schemas.GroupResponse, status_code=status.HTTP_201_CREATED, tags=["Groups"])
async def create_group_endpoint(
    group_data: schemas.GroupCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """新規グループを作成"""
    # TODO: Add authorization check?
    created_group = crud.create_group(db=db, group=group_data)
    return created_group


@app.put("/api/groups/{group_id}", response_model=schemas.GroupResponse, tags=["Groups"])
async def update_group_endpoint(
    group_id: int,
    group_data: schemas.GroupUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """グループ情報を更新"""
    db_group = crud.get_group(db=db, group_id=group_id)
    if db_group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="グループが見つかりません")
    updated_group = crud.update_group(db=db, db_group=db_group, group_in=group_data)
    return updated_group


@app.get("/api/user_groups", response_model=List[schemas.UserGroupResponse], tags=["Groups"])
async def get_user_groups_endpoint(
    user_id: Optional[int] = None,
    group_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    skip: int = 0,
    limit: int = 10000
):
    """ユーザーとグループの関連リストを取得 (user_id または group_id でフィルタ)"""
    if user_id is not None:
        user_groups = crud.get_user_groups_by_user(db=db, user_id=user_id, skip=skip, limit=limit)
    elif group_id is not None:
        user_groups = crud.get_user_groups_by_group(db=db, group_id=group_id, skip=skip, limit=limit)
    else:
        # TODO: Decide behavior without filter - return all? Or require filter?
        # Returning all might be too much data.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Either user_id or group_id filter is required")
        # Or return empty list: user_groups = []
    return user_groups

@app.post("/api/user_groups", response_model=schemas.UserGroupResponse, status_code=status.HTTP_201_CREATED, tags=["Groups"])
async def add_user_to_group_endpoint(
    user_group_data: schemas.UserGroupCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin)
):
    """ユーザーをグループに追加（管理者のみ）"""
    
    # 存在チェック (CRUD 内ではなく API レイヤーで行う場合)
    user_id_int = crud._parse_int_safe(user_group_data.user_id)
    group_id_int = crud._parse_int_safe(user_group_data.group_id)
    if user_id_int is None or group_id_int is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user_id or group_id")
    
    db_user = crud.get_user(db, user_id=user_id_int)
    if not db_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"User with id {user_id_int} not found")
    db_group = crud.get_group(db, group_id=group_id_int)
    if not db_group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Group with id {group_id_int} not found")
        
    existing_relation = crud.get_user_group(db, user_id=user_id_int, group_id=group_id_int)
    if existing_relation:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already in this group")

    added_relation = crud.add_user_to_group(db=db, user_group=user_group_data)
    if added_relation is None: # Should not happen if IDs are valid, but check anyway
         raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to add user to group")
    return added_relation

@app.delete("/api/user_groups/{user_id}/{group_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Groups"])
async def remove_user_from_group_endpoint(
    user_id: int,
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin)
):
    """ユーザーをグループから削除（管理者のみ）"""
    deleted_relation = crud.remove_user_from_group(db=db, user_id=user_id, group_id=group_id)
    if deleted_relation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User-group relationship not found")
    return None # 204 No Content

# --- ユーザー管理エンドポイント (DB参照版) ---

@app.post("/api/users", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED, tags=["Users"])
async def create_user_endpoint(
    user_data: schemas.UserCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin) # Now defined before usage
):
    """新規ユーザーを作成 (管理者のみ)"""
    # Email の重複チェック (DB で一意制約があるはずだが、事前チェック)
    existing_user = crud.get_user_by_email(db, email=user_data.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="このメールアドレスは既に使用されています"
        )
    
    # crud を使ってユーザーを作成 (パスワードハッシュ化は crud 内で行われる)
    created_user = crud.create_user(db=db, user=user_data)
    return created_user

@app.put("/api/users/{user_id}", response_model=schemas.UserResponse)
async def update_user_endpoint(
    user_id: int,
    user_data: schemas.UserUpdate,
    current_user: Annotated[models.User, Depends(get_current_user)], # current_user の型を修正
    db: Session = Depends(get_db) 
):
    # データベースからユーザーを取得
    db_user = crud.get_user(db=db, user_id=user_id)
    if db_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="ユーザーが見つかりません"
        )

    # 権限チェック (管理者 or 自分自身)
    if not (current_user.role == 'admin' or current_user.id == user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="このユーザーを編集する権限がありません"
        )

    # crud を使ってユーザーを更新
    updated_user = crud.update_user(db=db, db_user=db_user, user_in=user_data)

    # Pydantic モデルに変換して返す (orm_mode=True で自動変換)
    return updated_user

@app.delete("/api/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Users"])
async def delete_user_endpoint(
    user_id: int, # ID を int に変更
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin) # 管理者のみ許可
):
    """ユーザーを削除 (管理者のみ)"""
    # 自分自身は削除できない
    if current_user.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="自分自身を削除することはできません"
        )
    
    # 削除対象ユーザーの存在チェック
    db_user = crud.get_user(db=db, user_id=user_id)
    if db_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="ユーザーが見つかりません"
        )
    
    # crud を使ってユーザーを削除
    crud.delete_user(db=db, db_user=db_user)
    
    return None # 204 No Content

# --- Project 管理エンドポイント (DB参照版) ---

@app.post("/tasks", response_model=schemas.TaskResponse, status_code=status.HTTP_201_CREATED, tags=["Tasks"])
async def create_task_endpoint(
    task_data: schemas.TaskCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """新規タスクを作成（認証済みユーザー、プロジェクト存在時のみ）"""
    if task_data.project_id is not None:
        project = crud.get_project(db, project_id=task_data.project_id)
        if project is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="指定されたプロジェクトが見つかりません"
            )
    created_task = crud.create_task(db=db, task=task_data)
    from app.services.google_sync import auto_sync_task_bg
    background_tasks.add_task(auto_sync_task_bg, created_task.id)
    return created_task
    
@app.put("/tasks/{task_id}", response_model=schemas.TaskResponse, tags=["Tasks"])
async def update_task_endpoint(
    task_id: int,
    task_data: schemas.TaskUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """タスク情報を更新"""
    db_task = crud.get_task(db=db, task_id=task_id)
    if db_task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="タスクが見つかりません"
        )
    # タスクは認証済みユーザー全員で管理可能（display_status 変更のみ管理者に制限）
    if task_data.display_status is not None and db_task.display_status != task_data.display_status:
        if current_user.role != 'admin':
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="タスクの表示ステータスを変更する権限がありません"
            )

    updated_task = crud.update_task(db=db, db_task=db_task, task_in=task_data)

    # Google カレンダーへの同期は auto_sync_task_bg（バックグラウンド処理）にて行われます
    from app.services.google_sync import auto_sync_task_bg
    background_tasks.add_task(auto_sync_task_bg, updated_task.id)

    return updated_task


@app.post("/tasks/bulk-update", tags=["Tasks"])
async def bulk_update_tasks_endpoint(
    payload: schemas.TaskBulkUpdateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """複数タスクを一括更新（担当者・期日・ステータス・優先度）"""
    if not payload.task_ids:
        return {"updated": 0, "message": "対象タスクが指定されていません"}
    updates = {}
    if payload.status is not None:
        updates["status"] = payload.status
    if payload.assigned_to is not None:
        updates["assigned_to"] = payload.assigned_to
    if payload.due_date is not None:
        updates["due_date"] = payload.due_date
    if payload.priority is not None:
        updates["priority"] = payload.priority
    if not updates:
        return {"updated": 0, "message": "更新項目が指定されていません"}
    updated = crud.bulk_update_tasks(db=db, task_ids=payload.task_ids, updates=updates)
    
    from app.services.google_sync import auto_sync_task_bg
    for tid in payload.task_ids:
        background_tasks.add_task(auto_sync_task_bg, tid)
        
    return {"updated": updated, "message": f"{updated}件のタスクを更新しました"}


@app.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Tasks"])
async def delete_task_endpoint(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """タスクを削除"""
    db_task = crud.get_task(db=db, task_id=task_id)
    if db_task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="タスクが見つかりません"
        )
    # Google カレンダー同期済みのイベントを削除し、同期レコードを削除
    if google_cal.is_google_configured():
        from app.services.google_sync import delete_task_syncs
        delete_task_syncs(db, task_id)

    # タスクは認証済みユーザー全員で管理可能
    crud.delete_task(db=db, db_task=db_task)
    return None  # 204 No Content

# ★★★ Mock Data Import/Export Model ★★★
class MockDataImport(BaseModel):
    users: List[Dict[str, Any]]
    projects: List[Dict[str, Any]]
    tasks: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    events: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    groups: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    user_groups: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    append_mode: Optional[bool] = False

# ★★★ データ永続化のためのファイルパス ★★★
# DATA_BACKUP_FILE = "backend/data/backup_data.json"
# os.makedirs(os.path.dirname(DATA_BACKUP_FILE), exist_ok=True)

# ★★★ データを保存するヘルパー関数 ★★★
# def save_data_to_file():
#     """現在のモックデータをファイルに保存する"""
#     try:
#         data = {
#             "users": mock_data.users,
#             "projects": mock_data.projects,
#             "tasks": mock_data.tasks,
#             "events": mock_data.events,
#             "groups": mock_data.groups if hasattr(mock_data, 'groups') else [],
#             "user_groups": mock_data.user_groups if hasattr(mock_data, 'user_groups') else []
#         }
#         
#         with open(DATA_BACKUP_FILE, 'w', encoding='utf-8') as f:
#             json.dump(data, f, ensure_ascii=False, indent=2)
#         
#         print(f"Data saved to {DATA_BACKUP_FILE}")
#         return True
#     except Exception as e:
#         print(f"Error saving data: {e}")
#         return False

# ★★★ データをファイルから読み込むヘルパー関数 ★★★
# def load_data_from_file():
#     """保存されたデータをファイルから読み込む"""
#     try:
#         if not os.path.exists(DATA_BACKUP_FILE):
#             print(f"No backup file found at {DATA_BACKUP_FILE}")
#             return False
#         
#         with open(DATA_BACKUP_FILE, 'r', encoding='utf-8') as f:
#             data = json.load(f)
#         
#         # モックデータを更新 (注意: DB移行後はこの部分も不要になるはず)
#         mock_data.users = data["users"]
#         mock_data.projects = data["projects"]
#         # ... (tasks, events, groups, user_groups のロード)
#         
#         # ユーザーデータベースの更新 (fake_users_db)
#         global fake_users_db
#         try:
#             # ★★★ キーを 'email' に変更 ★★★
#             fake_users_db = {user["email"]: user for user in mock_data.users if "email" in user}
#         except KeyError as e:
#             print(f"Error creating fake_users_db from loaded data: Missing key {e}")
#             return False # エラー時はロード失敗とする
#         
#         print(f"Data loaded from {DATA_BACKUP_FILE}")
#         return True
#     except Exception as e:
#         print(f"Error loading data: {e}")
#         return False

# ★★★ アプリケーション起動時にデータをロード ★★★
# @app.on_event("startup")
# async def startup_event():
#     print("サーバー起動: データファイルをチェックします...")
#     if load_data_from_file():
#         print(f"{DATA_BACKUP_FILE} からデータをロードしました。")
#     else:
#         print(f"{DATA_BACKUP_FILE} が見つからないか、ロードに失敗しました。mock_data.py の初期データを使用します。")
#         # fake_users_db の整合性を保つために再構築
#         global fake_users_db
#         try:
#             # ★★★ キーを 'email' に変更 ★★★
#             fake_users_db = {user["email"]: user for user in mock_data.users if "email" in user}
#         except KeyError as e:
#              print(f"Error creating fake_users_db from mock_data.py: Missing key {e}")
#              # 起動時にエラーが発生したら、空の辞書などで初期化する？
#              fake_users_db = {} 
#         print("mock_data.py の初期データをメモリで使用します。")
# ★★★ ここまで削除 ★★★

# 管理者用：モックデータをエクスポート
@app.post("/admin/mock-data/export", response_model=Dict[str, Any])
async def export_mock_data(current_user: models.User = Depends(get_current_active_admin), db: Session = Depends(get_db)):
    """
    現在のデータベース内容をモックデータ形式でエクスポートします。
    """
    try:
        # --- DB からデータを取得 --- 
        db_users = crud.get_users(db=db, limit=1000) # limit を大きくして全件取得
        db_projects = crud.get_projects(db=db, limit=1000)
        db_tasks = crud.get_tasks(db=db, limit=1000)
        db_events = crud.get_events(db=db, limit=1000) # ステータスフィルタなしで全件
        db_groups = crud.get_groups(db=db, limit=1000)
        
        # --- Pydantic モデル経由で辞書リストに変換 --- 
        # SQLAlchemy オブジェクト -> Pydantic オブジェクト -> 辞書
        users_list = [schemas.UserResponse.from_orm(u).dict() for u in db_users]
        projects_list = [schemas.ProjectResponse.from_orm(p).dict() for p in db_projects]
        tasks_list = [schemas.TaskResponse.from_orm(t).dict() for t in db_tasks]
        events_list = [schemas.EventResponse.from_orm(e).dict() for e in db_events]
        groups_list = [schemas.GroupResponse.from_orm(g).dict() for g in db_groups]

        # user_groups は少し複雑。全ユーザーをループして関連を取得
        user_groups_list = []
        for db_user in db_users:
            user_groups = crud.get_user_groups_by_user(db=db, user_id=db_user.id, limit=1000)
            user_groups_list.extend([schemas.UserGroupResponse.from_orm(ug).dict() for ug in user_groups])
        # 重複排除 (念のため)
        user_groups_list = [dict(t) for t in {tuple(d.items()) for d in user_groups_list}]

        # パスワードハッシュはエクスポートしない方が安全
        for user_dict in users_list:
            if 'hashed_password' in user_dict:
                del user_dict['hashed_password']

        return {
            "users": users_list,
            "projects": projects_list,
            "tasks": tasks_list,
            "events": events_list,
            "groups": groups_list,
            "user_groups": user_groups_list
        }
    
    except Exception:
        logger.exception("データエクスポート中にエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="データエクスポート中にエラーが発生しました。"
        )

def parse_date(date_str: str, project_start_date: Optional[datetime] = None, project_end_date: Optional[datetime] = None) -> Optional[datetime]:
    """
    日付文字列をパースする関数
    
    Args:
        date_str: 日付文字列（例: "2025/11/14", "11月14日"）
        project_start_date: プロジェクト開始日（年なし日付の推測に使用）
        project_end_date: プロジェクト終了日（年なし日付の推測に使用）
    """
    if not date_str:
        return None
    
    date_str = date_str.strip()
    
    try:
        # 1. 「n月n日」形式の日付（日本語）
        import re
        japanese_date_pattern = r'(\d+)月(\d+)日'
        match = re.match(japanese_date_pattern, date_str)
        if match:
            month = int(match.group(1))
            day = int(match.group(2))
            
            # プロジェクト開始日から年を推測
            if project_start_date:
                # まずプロジェクト開始年で試す
                candidate_year = project_start_date.year
                try:
                    candidate_date = datetime(candidate_year, month, day)
                    
                    # プロジェクト期間内または近辺かチェック
                    if project_end_date:
                        # プロジェクト開始の6ヶ月前から終了の6ヶ月後までを許容範囲とする
                        from datetime import timedelta
                        start_buffer = project_start_date - timedelta(days=180)
                        end_buffer = project_end_date + timedelta(days=180)
                        
                        # 候補日付が範囲外の場合、翌年を試す
                        if candidate_date < start_buffer:
                            candidate_date = datetime(candidate_year + 1, month, day)
                        elif candidate_date > end_buffer:
                            candidate_date = datetime(candidate_year - 1, month, day)
                    
                    return candidate_date
                except ValueError:
                    # 無効な日付（例：2月30日）
                    logger.warning(f"無効な日付: {date_str}")
                    return None
            else:
                # プロジェクト日付がない場合は現在年を使用
                current_year = datetime.now().year
                try:
                    result = datetime(current_year, month, day)
                    return result
                except ValueError:
                    logger.warning(f"無効な日付: {date_str}")
                    return None
        
        # 2. スラッシュ区切りの日付形式
        if '/' in date_str:
            parts = date_str.split('/')
            if len(parts) == 3:
                year, month, day = map(int, parts)
                return datetime(year, month, day)
            elif len(parts) == 2 and project_start_date:
                # 年なしの "11/14" 形式
                month, day = map(int, parts)
                year = project_start_date.year
                candidate_date = datetime(year, month, day)
                
                if project_end_date and candidate_date < project_start_date:
                    candidate_date = datetime(year + 1, month, day)
                
                return candidate_date
        
        # 3. ハイフン区切りの日付形式
        if '-' in date_str:
            parts = date_str.split('-')
            if len(parts) == 3:
                year, month, day = map(int, parts)
                return datetime(year, month, day)
        
        # 4. ISO形式の日付
        return datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        
    except (ValueError, TypeError) as e:
        logger.error(f"日付形式が無効です: {date_str}, エラー: {str(e)}")
        return None

def generate_unique_name(base_name: str, existing_names: set) -> str:
    """重複時に通し番号を付与して一意の名前を生成"""
    new_name = base_name
    counter = 1
    while new_name in existing_names:
        new_name = f"{base_name}_{counter}"
        counter += 1
    return new_name

def parse_float(value: str) -> float:
    """文字列を浮動小数点数に変換する関数"""
    try:
        return float(value.strip()) if value.strip() else 0.0
    except (ValueError, TypeError):
        return 0.0

def get_user_id_by_name(db: Session, username: str) -> Optional[int]:
    """ユーザー名からユーザーIDを取得する関数（省略形対応）"""
    if not username:
        return None

    # デバッグ情報は削除（本番環境では不要）

    # 1. 完全一致でユーザー名検索
    user = db.query(models.User).filter(models.User.username == username).first()
    if user:
        return user.id
    
    # 2. 完全一致でメールアドレス検索
    user = crud.get_user_by_email(db, email=username)
    if user:
        return user.id
    
    # 3. 完全一致でフルネーム検索
    user = db.query(models.User).filter(models.User.name == username).first()
    if user:
        return user.id
    
    # 4. 部分一致でフルネーム検索（省略形対応）
    if len(username) >= 2:  # 2文字以上の場合のみ部分一致検索
        users = db.query(models.User).filter(models.User.name.like(f"%{username}%")).all()
        if len(users) == 1:  # 1件のみ見つかった場合
            return users[0].id
        elif len(users) > 1:
            logger.warning(f"複数のユーザーが見つかりました: {username} -> {[u.name for u in users]}")
            # 最初のユーザーを返す（曖昧な場合は最初の結果）
            return users[0].id
    
    # 5. 部分一致でユーザー名検索
    if len(username) >= 2:
        users = db.query(models.User).filter(models.User.username.like(f"%{username}%")).all()
        if len(users) == 1:
            return users[0].id
        elif len(users) > 1:
            logger.warning(f"複数のユーザー名が見つかりました: {username} -> {[u.username for u in users]}")
            return users[0].id
    
    logger.warning(f"ユーザーが見つかりません: {username}")
    return None

def parse_csv_value(value: str) -> str:
    """CSVの値を適切に解析する関数"""
    value = value.strip()
    # 引用符で囲まれている場合は除去
    if value.startswith('"') and value.endswith('"'):
        value = value[1:-1]
    return value

def parse_dependencies(depends_str: str) -> List[str]:
    """依存タスクの文字列を解析する関数"""
    if not depends_str:
        return []
    
    # 引用符で囲まれている場合は除去
    depends_str = depends_str.strip()
    if depends_str.startswith('"') and depends_str.endswith('"'):
        depends_str = depends_str[1:-1]
    
    # カンマで分割して各要素の空白を除去
    return [dep.strip() for dep in depends_str.split(',') if dep.strip()]

def parse_phases(phases_str: str) -> List[Dict[str, Any]]:
    """段階的タスク（フェーズ）の文字列を解析する関数"""
    if not phases_str:
        return []
    phases = []
    # 引用符除去
    phases_str = phases_str.strip()
    if phases_str.startswith('"') and phases_str.endswith('"'):
        phases_str = phases_str[1:-1]
    
    items = phases_str.split(',')
    for item in items:
        if ':' in item:
            parts = item.split(':')
            if len(parts) >= 2:
                name = parts[0].strip()
                date_str = parts[1].strip()
                try:
                    # parse_date を再利用 (コンテキストなし)。フロントは phase.date / phase.is_completed を参照する
                    dt = parse_date(date_str)
                    if dt:
                        phases.append({"name": name, "date": dt.strftime("%Y-%m-%d"), "is_completed": False})
                except Exception:
                    pass
    return phases

def parse_datetime(date_str: str) -> Optional[datetime]:
    """日時文字列を解析する関数"""
    if not date_str:
        return None
    try:
        return datetime.fromisoformat(date_str.replace('/', '-').replace(' ', 'T'))
    except ValueError:
        try:
            # YYYY/MM/DD HH:MM
            return datetime.strptime(date_str, "%Y/%m/%d %H:%M")
        except ValueError:
             # YYYY/MM/DD
            d = parse_date(date_str)
            return d
    return None

def parse_time_to_datetime(date_val: Optional[datetime], time_str: str) -> Optional[datetime]:
    """日付と時刻文字列（HH:MM または HH:MM:SS）を結合して datetime を返す"""
    if not date_val or not time_str or not time_str.strip():
        return None
    parts = time_str.strip().split(":")
    if len(parts) < 2:
        return None
    try:
        h, m = int(parts[0]), int(parts[1])
        s = int(parts[2]) if len(parts) > 2 else 0
        return date_val.replace(hour=h, minute=m, second=s, microsecond=0)
    except (ValueError, IndexError):
        return None

def parse_task_data(task_data: List[str], project_id: int, db: Session, project_start_date: Optional[datetime] = None, project_end_date: Optional[datetime] = None) -> dict:
    """
    タスクデータをパースする関数
    
    Args:
        task_data: CSVの1行分のタスクデータ
        project_id: プロジェクトID
        db: データベースセッション
        project_start_date: プロジェクト開始日（年なし日付の推測に使用）
        project_end_date: プロジェクト終了日（年なし日付の推測に使用）
    
    Returns:
        dict: パースされたタスクデータ（"warnings"キーに警告メッセージのリストを含む）
    """
    try:
        name = task_data[0].strip()
        if not name or name == "タスク名":  # ヘッダー行のチェック
            raise ValueError("タスク名が不正です")

        # プロジェクトの日付情報を使って期日をパース
        due_date = parse_date(task_data[1], project_start_date, project_end_date) if task_data[1].strip() else None
        description = task_data[2].strip() if len(task_data) > 2 else ""
        assigned_to_username = task_data[3].strip() if len(task_data) > 3 else None
        cost = float(task_data[4]) if len(task_data) > 4 and task_data[4].strip() else 0
        
        # タスクタイプは任意の文字列を許容（そのまま保存）
        task_type = task_data[5].strip() if len(task_data) > 5 and task_data[5].strip() else None
        
        seq_id = task_data[6].strip() if len(task_data) > 6 and task_data[6].strip() else None
        shot_id = task_data[7].strip() if len(task_data) > 7 and task_data[7].strip() else None
        depends_on = parse_dependencies(task_data[8]) if len(task_data) > 8 and task_data[8].strip() else []
        phases = parse_phases(task_data[9]) if len(task_data) > 9 and task_data[9].strip() else []

        # 警告メッセージを収集
        warnings = []
        
        # タスクタイプの正規化（表記ゆれ吸収と安全な保存）
        task_type = normalize_task_type(task_type)

        # 担当者IDを取得（改良された検索機能を使用）
        assigned_to_id = None
        if assigned_to_username:
            assigned_to_id = get_user_id_by_name(db, assigned_to_username)
            if assigned_to_id is None:
                logger.warning(f"担当者 {assigned_to_username} が見つかりません")
                warnings.append(f"担当者 '{assigned_to_username}' が見つかりません")

        # --- 開始日を自動計算 ---
        from math import ceil
        from datetime import timedelta
        start_date = None
        if due_date and cost:
            days = ceil(cost / 8)
            start_date = due_date - timedelta(days=days)
        # ----------------------

        return {
            "name": name,
            "description": description,
            "project_id": project_id,
            "status": models.TaskStatus.TODO,
            "due_date": due_date,
            "assigned_to": assigned_to_id,
            "cost": cost,
            "type": task_type,
            "seqID": seq_id,
            "shotID": shot_id,
            "dependsOn": depends_on,
            "display_status": "offline",
            "priority": models.TaskPriority.MEDIUM,
            "start_date": start_date,
            "phases": phases,
            "warnings": warnings  # 警告メッセージを追加
        }
    except Exception as e:
        logger.error(f"タスクデータのパースに失敗: {str(e)}")
        raise ValueError(f"タスクデータのパースに失敗: {str(e)}")

def update_task_dependencies(task_name: str, depends_on: List[str], db: Session) -> None:
    """タスクの依存関係を更新する"""
    task = db.query(models.Task).filter(models.Task.name == task_name).first()
    if not task:
        logger.warning(f"タスクが見つかりません: {task_name}")
        return

    # 依存タスクのIDを取得
    dependency_ids = []
    for dep_name in depends_on:
        dep_task = db.query(models.Task).filter(models.Task.name == dep_name).first()
        if dep_task:
            dependency_ids.append(str(dep_task.id))
        else:
            logger.warning(f"依存タスクが見つかりません: {dep_name}")

    # 依存関係を更新
    if dependency_ids:
        task.dependsOn = dependency_ids
        db.commit()

@app.post("/admin/mock-data/import-csv")
async def import_csv_data(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin),
):
    """CSVファイルからデータをインポートする（管理者のみ）"""
    import_results = {
        "projects": {"imported": 0, "skipped": 0, "results": []},
        "tasks": {"imported": 0, "skipped": 0, "results": []},
        "events": {"imported": 0, "skipped": 0, "results": []},
        "warnings": []  # 警告メッセージを収集
    }

    try:
        # CSVファイルを読み込む
        contents = await file.read()
        csv_data = contents.decode('utf-8-sig').splitlines()  # BOMを考慮
        csv_reader = csv.reader(csv_data)

        # プロジェクトセクションを探す（「プロジェクト」または「プロジェクト情報」）
        project_data = None
        while True:
            row = next(csv_reader, None)
            if row is None:
                raise HTTPException(status_code=400, detail="プロジェクト情報が見つかりません")
            first = row[0].strip() if row else ""
            if first == "プロジェクト" or first == "プロジェクト情報":
                break

        # ヘッダー行をスキップ
        next(csv_reader, None)  # "プロジェクト名,開始日,終了日,説明" の行をスキップ

        # プロジェクト情報を読み込む
        project_data = next(csv_reader, None)
        if not project_data or len(project_data) < 4:
            raise HTTPException(status_code=400, detail="プロジェクト情報が不正です")

        project_name = project_data[0].strip()
        if not project_name or project_name == "プロジェクト名" or len(project_name) > 100:  # ヘッダー行のチェックと長さ制限
            raise HTTPException(status_code=400, detail="プロジェクト名が不正です（空、ヘッダー行、または100文字を超えています）")

        # プロジェクトの開始日・終了日をパース（年なし日付の推測には使えないが、まず取得）
        start_date = parse_date(project_data[1])
        if not start_date:
            raise HTTPException(status_code=400, detail="開始日の形式が不正です。")

        end_date = parse_date(project_data[2])
        if not end_date:
            raise HTTPException(status_code=400, detail="終了日の形式が不正です。")

        description = project_data[3].strip() if len(project_data) > 3 else ""

        # プロジェクトの作成
        project = models.Project(
            name=project_name,
            description=description,
            start_date=start_date,
            end_date=end_date,
            status=models.ProjectStatus.PLANNING
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        import_results["projects"]["imported"] += 1
        import_results["projects"]["results"].append(f"作成: {project_name}")

        # タスク情報セクションを探す
        while True:
            row = next(csv_reader, None)
            if row is None:
                break
            if len(row) > 0 and row[0].strip() == "タスク情報":
                break

        # ヘッダー行をスキップ
        next(csv_reader, None)

        # 1. 全タスクを一度DBに追加（次のセクション見出しまで読み込む）
        event_section_headers = ("会議情報", "ワークショップ情報", "イベント情報", "締切情報", "マイルストーン情報")
        all_task_data = []
        first_event_section = None  # タスクの次に現れたセクション見出し
        for task_data in csv_reader:
            if not task_data or not task_data[0].strip():  # 空行をスキップ
                continue
            if task_data[0].strip() == "タスク名":
                continue
            if task_data[0].strip() in event_section_headers:
                first_event_section = task_data[0].strip()
                break
            all_task_data.append(task_data)

        # タスク名だけでなく、seqID/shotIDも含めた複合キーで管理
        task_name_to_obj = {}  # 後方互換性のため残す
        task_key_to_obj = {}  # 複合キー: (name, seqID, shotID) -> task
        all_tasks = []  # 全タスクのリスト
        
        for task_data in all_task_data:
            try:
                # プロジェクトの日付情報を渡して、年なし日付を推測できるようにする
                task_dict = parse_task_data(task_data, project.id, db, start_date, end_date)
                
                # 警告メッセージがあれば収集
                if task_dict.get("warnings"):
                    for warning in task_dict["warnings"]:
                        warning_msg = f"タスク '{task_dict['name']}': {warning}"
                        import_results["warnings"].append(warning_msg)
                        logger.warning(warning_msg)
                
                # dependsOnはタスク名リストのまま
                task = models.Task(
                    name=task_dict["name"],
                    description=task_dict["description"],
                    project_id=task_dict["project_id"],
                    status=task_dict["status"],
                    due_date=task_dict["due_date"],
                    assigned_to=task_dict["assigned_to"],
                    cost=task_dict["cost"],
                    type=task_dict["type"],
                    seqID=task_dict["seqID"],
                    shotID=task_dict["shotID"],
                    dependsOn=task_dict["dependsOn"],
                    display_status=task_dict["display_status"],
                    priority=models.TaskPriority.MEDIUM,
                    start_date=task_dict.get("start_date"),
                    phases=task_dict.get("phases")
                )
                db.add(task)
                db.flush()  # IDを発番
                db.refresh(task)
                
                # 複合キーで登録
                task_key = (task.name, task.seqID or "", task.shotID or "")
                task_key_to_obj[task_key] = task
                
                # 後方互換性のため、名前だけのマップも更新（最後のものが残る）
                task_name_to_obj[task.name] = task
                
                all_tasks.append(task)
                import_results["tasks"]["imported"] += 1
                import_results["tasks"]["results"].append(f"作成: {task.name}")
                
                # ステータス履歴の作成
                status_history = models.TaskStatusHistory(
                    task_id=task.id,
                    status=models.TaskStatus.TODO,
                    changed_by=current_user.id,
                    changed_at=datetime.now()
                )
                db.add(status_history)
            except Exception as e:
                logger.error(f"タスクの作成に失敗: {str(e)}")
                import_results["tasks"]["skipped"] += 1
                import_results["tasks"]["results"].append(f"エラー: {task_data[0]} - {str(e)}")
                continue
        db.commit()

        # 2. 依存関係をIDに変換して再保存
        for task in all_tasks:
            dependsOn_names = task.dependsOn if task.dependsOn else []
            dependsOn_ids = []
            
            for dep_name in dependsOn_names:
                dep_task = None
                
                # ステップ1: タスク名で候補を検索
                candidates = [t for t in all_tasks if t.name == dep_name]
                
                if len(candidates) == 0:
                    # タスク名が見つからない
                    logger.warning(f"依存タスクが見つかりません（タスク名不一致）: {dep_name} (タスク: {task.name})")
                
                elif len(candidates) == 1:
                    # タスク名が1つだけ → それを使用
                    dep_task = candidates[0]
                    dependsOn_ids.append(str(dep_task.id))
                
                else:
                    # タスク名が複数 → seqID + shotIDで絞り込む
                    dep_key_same_shot = (dep_name, task.seqID or "", task.shotID or "")
                    if dep_key_same_shot in task_key_to_obj:
                        dep_task = task_key_to_obj[dep_key_same_shot]
                        dependsOn_ids.append(str(dep_task.id))
                    else:
                        # 同一seq+shotで見つからない場合は空欄
                        logger.warning(f"依存タスクが見つかりません（複数候補あり、seq/shot不一致）: {dep_name} 候補数={len(candidates)} (タスク: {task.name}, seq={task.seqID}, shot={task.shotID})")
            
            # 依存関係を更新（空の場合は空リストが設定される）
            task.dependsOn = dependsOn_ids if dependsOn_ids else []
        db.commit()

        # イベント系セクション（会議・ワークショップ・イベント・締切・マイルストーン）の処理
        def parse_participants_str(participants_str: str) -> list:
            participants = []
            if not participants_str:
                return participants
            s = participants_str.strip()
            if s.startswith('"') and s.endswith('"'):
                s = s[1:-1]
            for p_name in [p.strip() for p in s.split(',') if p.strip()]:
                uid = get_user_id_by_name(db, p_name)
                if uid:
                    participants.append({"type": "user", "id": uid})
            return participants

        current_section = first_event_section
        while current_section:
            header_row = next(csv_reader, None)  # ヘッダー行をスキップ
            if header_row is None:
                break
            while True:
                row = next(csv_reader, None)
                if row is None:
                    break
                if not row or not row[0].strip():
                    continue
                if row[0].strip() in event_section_headers:
                    current_section = row[0].strip()
                    break
                try:
                    title = ""
                    description = ""
                    start_time = None
                    end_time = None
                    participants = []
                    all_day = False
                    event_type = models.EventType.GENERIC

                    if current_section == "会議情報":
                        # 会議名,説明,実施日,開始時間,終了時間,参加者
                        title = row[0].strip() if len(row) > 0 else ""
                        description = row[1].strip() if len(row) > 1 else ""
                        date_str = row[2].strip() if len(row) > 2 else ""
                        start_time_str = row[3].strip() if len(row) > 3 else ""
                        end_time_str = row[4].strip() if len(row) > 4 else ""
                        participants_str = row[5].strip() if len(row) > 5 else ""
                        date_val = parse_date(date_str)
                        start_time = parse_time_to_datetime(date_val, start_time_str) if start_time_str else date_val
                        end_time = parse_time_to_datetime(date_val, end_time_str) if end_time_str else (start_time + timedelta(hours=1) if start_time else None)
                        participants = parse_participants_str(participants_str)
                        event_type = models.EventType.MEETING
                        if not start_time:
                            import_results["events"]["skipped"] += 1
                            import_results["events"]["results"].append(f"スキップ: {title} (実施日/開始時間不正)")
                            continue
                        if not end_time:
                            end_time = start_time + timedelta(hours=1)

                    elif current_section == "ワークショップ情報":
                        # ワークショップ名,説明,実施日,開始時間,終了時間,参加者
                        title = row[0].strip() if len(row) > 0 else ""
                        description = row[1].strip() if len(row) > 1 else ""
                        date_str = row[2].strip() if len(row) > 2 else ""
                        start_time_str = row[3].strip() if len(row) > 3 else ""
                        end_time_str = row[4].strip() if len(row) > 4 else ""
                        participants_str = row[5].strip() if len(row) > 5 else ""
                        date_val = parse_date(date_str)
                        start_time = parse_time_to_datetime(date_val, start_time_str) if start_time_str else date_val
                        end_time = parse_time_to_datetime(date_val, end_time_str) if end_time_str else (start_time + timedelta(hours=1) if start_time else None)
                        participants = parse_participants_str(participants_str)
                        event_type = models.EventType.WORKSHOP
                        if not start_time:
                            import_results["events"]["skipped"] += 1
                            import_results["events"]["results"].append(f"スキップ: {title} (実施日/開始時間不正)")
                            continue
                        if not end_time:
                            end_time = start_time + timedelta(hours=1)

                    elif current_section == "イベント情報":
                        # イベント名,説明,実施日,参加者（終日）
                        title = row[0].strip() if len(row) > 0 else ""
                        description = row[1].strip() if len(row) > 1 else ""
                        date_str = row[2].strip() if len(row) > 2 else ""
                        participants_str = row[3].strip() if len(row) > 3 else ""
                        date_val = parse_date(date_str)
                        start_time = date_val
                        end_time = (date_val + timedelta(days=1)) if date_val else None
                        participants = parse_participants_str(participants_str)
                        all_day = True
                        event_type = models.EventType.GENERIC
                        if not start_time:
                            import_results["events"]["skipped"] += 1
                            import_results["events"]["results"].append(f"スキップ: {title} (実施日不正)")
                            continue

                    elif current_section == "締切情報":
                        # 締切名,説明,期日（終日）
                        title = row[0].strip() if len(row) > 0 else ""
                        description = row[1].strip() if len(row) > 1 else ""
                        date_str = row[2].strip() if len(row) > 2 else ""
                        start_time = parse_date(date_str)
                        end_time = start_time
                        all_day = True
                        event_type = models.EventType.DEADLINE
                        if not start_time:
                            import_results["events"]["skipped"] += 1
                            import_results["events"]["results"].append(f"スキップ: {title} (期日不正)")
                            continue

                    elif current_section == "マイルストーン情報":
                        # マイルストーン名,説明,期日（終日）
                        title = row[0].strip() if len(row) > 0 else ""
                        description = row[1].strip() if len(row) > 1 else ""
                        date_str = row[2].strip() if len(row) > 2 else ""
                        start_time = parse_date(date_str)
                        end_time = start_time
                        all_day = True
                        event_type = models.EventType.MILESTONE
                        if not start_time:
                            import_results["events"]["skipped"] += 1
                            import_results["events"]["results"].append(f"スキップ: {title} (期日不正)")
                            continue

                    if not title:
                        continue
                    event = models.Event(
                        title=title,
                        description=description,
                        start_time=start_time,
                        end_time=end_time,
                        location="",
                        type=event_type,
                        allDay=all_day,
                        participants=participants,
                        project_id=project.id,
                        status='online'
                    )
                    db.add(event)
                    import_results["events"]["imported"] += 1
                    import_results["events"]["results"].append(f"作成: {title}")
                except Exception as e:
                    import_results["events"]["skipped"] += 1
                    title_preview = row[0].strip() if row and len(row) > 0 else "?"
                    import_results["events"]["results"].append(f"エラー: {title_preview} - {str(e)}")
            if row is None:
                break

        db.commit()

        return import_results

    except HTTPException:
        # HTTPExceptionはそのまま再スロー
        raise
    except Exception as e:
        error_detail = str(e)
        logger.exception(f"CSVインポートに失敗しました: {error_detail}")
        # エラーの詳細を返す（セキュリティ上問題ない範囲で）
        raise HTTPException(status_code=500, detail=f"CSVインポートに失敗しました: {error_detail}")

@app.delete("/api/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Groups"])
async def delete_group_endpoint(
    group_id: int = Path(..., title="削除するグループのID", ge=1), # Path を使ってバリデーションを追加
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user) # 認証
):
    """
    指定された ID のグループを削除します。

    - 関連するユーザーグループの割り当ても削除されます。
    """
    db_group = crud.get_group(db=db, group_id=group_id)
    if db_group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"グループ ID {group_id} が見つかりません"
        )

    # --- 関連する UserGroup の削除 ---
    try:
        # グループに紐づくユーザー割り当てをすべて取得
        # crud.py の get_user_groups_by_group を使う (limit=-1 で全件取得を意図、要確認)
        user_groups_to_delete = crud.get_user_groups_by_group(db=db, group_id=group_id, limit=1000) # limit を大きく設定するか、全件取得ロジックを確認

        # 関連オブジェクトをループで削除
        for ug in user_groups_to_delete:
            db.delete(ug)
        # db.flush() # 必要に応じて flush

        # グループ本体の削除 (crud.delete_group 内で commit される想定)
        crud.delete_group(db=db, db_group=db_group)

    except Exception as e:
        db.rollback() # エラー発生時はロールバック
        print(f"Error deleting group or related user_groups: {e}")
        # エラーの詳細をログに出力することを検討
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="グループの削除中に内部エラーが発生しました"
        )

    # HTTP 204 No Content を返す (レスポンスボディなし)
    return Response(status_code=status.HTTP_204_NO_CONTENT) 

@app.post("/admin/mock-data/import", response_model=Dict[str, Any], tags=["Admin"])
async def import_mock_data(
    data: MockDataImport,
    current_user: models.User = Depends(get_current_active_admin),
    db: Session = Depends(get_db)
):
    """
    モックデータをインポートします。
    管理者のみが実行可能です。
    """
    try:
        print("\n=== インポート開始 ===")
        print("\n【入力データ】")
        print(f"ユーザー数: {len(data.users)}")
        print(f"プロジェクト数: {len(data.projects)}")
        print(f"タスク数: {len(data.tasks)}")
        print(f"イベント数: {len(data.events)}")
        print(f"グループ数: {len(data.groups or [])}")
        print(f"ユーザーグループ関連数: {len(data.user_groups or [])}")

        # インポート結果を記録
        import_results = {
            "users": {"total": len(data.users), "imported": 0, "skipped": 0, "results": []},
            "projects": {"total": len(data.projects), "imported": 0, "skipped": 0, "results": []},
            "tasks": {"total": len(data.tasks), "imported": 0, "skipped": 0, "results": []},
            "events": {"total": len(data.events), "imported": 0, "skipped": 0, "results": []},
            "groups": {"total": len(data.groups or []), "imported": 0, "skipped": 0, "results": []},
            "user_groups": {"total": len(data.user_groups or []), "imported": 0, "skipped": 0, "results": []}
        }

        # 既存プロジェクト名集合と {プロジェクト名: ID} マップを準備
        existing_project_names = set()
        project_name_to_id = {}

        # ユーザーをインポート
        for user_data in data.users:
            username = "<不明>"  # 初期化しておく
            try:
                # dict 形式と配列形式の両方に対応（パスワード未指定の場合はスキップ）
                if isinstance(user_data, dict):
                    username = user_data.get("username") or user_data.get("full_name") or user_data.get("name") or (user_data.get("email", "").split("@")[0] if user_data.get("email") else "<不明>")
                    email = user_data.get("email", "")
                    password = user_data.get("password")
                    if not password or not str(password).strip():
                        import_results["users"]["skipped"] += 1
                        import_results["users"]["results"].append(f"スキップ: {username} (パスワード未指定)")
                        continue
                    role = user_data.get("role", "user")
                else:
                    username = user_data[0]
                    email = user_data[1]
                    password = user_data[2] if len(user_data) > 2 and user_data[2] else None
                    if not password or not str(password).strip():
                        import_results["users"]["skipped"] += 1
                        import_results["users"]["results"].append(f"スキップ: {username} (パスワード未指定)")
                        continue
                    role = user_data[3] if len(user_data) > 3 else 'user'

                # 既存のユーザーをチェック
                existing_user = db.query(models.User).filter(models.User.username == username).first()
                if existing_user:
                    import_results["users"]["skipped"] += 1
                    import_results["users"]["imported"] += 1
                    import_results["users"]["results"].append(f"スキップ: {username} (既存)")
                    continue

                # 新規ユーザーを作成
                user = models.User(
                    username=username,
                    email=email,
                    role=role
                )
                user.set_password(password)
                db.add(user)
                db.flush()  # IDを取得するためにflush
                import_results["users"]["imported"] += 1
                import_results["users"]["results"].append(f"追加: {username} (ID: {user.id})")
            except Exception:
                import_results["users"]["skipped"] += 1
                import_results["users"]["results"].append(f"エラー: {username}")

        # プロジェクトをインポート
        for project_data in data.projects:
            name = "<不明>"
            try:
                # dict 形式と配列形式の両方に対応
                if isinstance(project_data, dict):
                    name = project_data.get("name") or "<不明>"
                    start_raw = project_data.get("start_date") or project_data.get("startDate") or ""
                    end_raw = project_data.get("end_date") or project_data.get("endDate") or ""
                    description = project_data.get("description")
                    start_date = parse_date(start_raw) if start_raw else None
                    end_date = parse_date(end_raw) if end_raw else None
                else:
                    name = project_data[0]
                    start_date = parse_date(project_data[1])
                    end_date = parse_date(project_data[2])
                    description = project_data[3] if len(project_data) > 3 else None

                # 重複を避けるために一意の名前を生成
                unique_name = generate_unique_name(name, existing_project_names)
                if unique_name != name:
                    import_results["projects"]["skipped"] += 1
                    import_results["projects"]["imported"] += 1
                    import_results["projects"]["results"].append(f"プロジェクト名を変更: {name} → {unique_name}")
                    name = unique_name

                # 新規プロジェクトを作成
                project = models.Project(
                    name=name,
                    start_date=start_date,
                    end_date=end_date,
                    description=description,
                    status=models.ProjectStatus.PLANNING
                )
                db.add(project)
                db.flush()
                import_results["projects"]["imported"] += 1
                import_results["projects"]["results"].append(f"追加: {name} (ID: {project.id})")
                existing_project_names.add(name)
                project_name_to_id[name] = project.id
            except Exception as e:
                import_results["projects"]["results"].append(f"エラー: {name} - {str(e)}")

        # タスクをインポート
        for task_data in data.tasks:
            try:
                # dict 形式と配列形式の両方に対応
                if isinstance(task_data, dict):
                    name = task_data.get("name") or task_data.get("title") or "<不明>"
                    due_raw = task_data.get("due_date") or task_data.get("taskDueDate") or task_data.get("dueDate") or ""
                    due_date = parse_date(due_raw) if due_raw else None
                    description = task_data.get("description", "")
                    # 担当者は名前またはIDのどちらかを受け付ける
                    assigned_to_name = task_data.get("assigneeName") or task_data.get("assigned_to_name")
                    assigned_to_id = task_data.get("assigned_to")
                    cost = float(task_data.get("cost", 0) or 0)
                    # タスクタイプを正規化（表記ゆれ吸収）
                    task_type = normalize_task_type(task_data.get("type"))
                    seq_id = task_data.get("seqID") or task_data.get("seqId") or ""
                    shot_id = task_data.get("shotID") or task_data.get("shotId") or ""
                    depends_field = task_data.get("dependsOn") or task_data.get("dependent_tasks") or []
                    if isinstance(depends_field, list):
                        depends_on = [str(x) for x in depends_field if x]
                    else:
                        depends_on = [s for s in str(depends_field).split(',') if s]
                else:
                    name = task_data[0]
                    due_date = parse_date(task_data[1])
                    description = task_data[2]
                    assigned_to_name = task_data[3]
                    cost = float(task_data[4])
                    # タスクタイプを正規化
                    task_type = normalize_task_type(task_data[5] if len(task_data) > 5 and task_data[5] else None)
                    seq_id = task_data[6]
                    shot_id = task_data[7]
                    depends_on = task_data[8].split(',') if len(task_data) > 8 and task_data[8] else []

                # プロジェクトIDを取得（最初のプロジェクト or マッピングから）
                project_id = next(iter(project_name_to_id.values())) if project_name_to_id else None
                if not project_id:
                    import_results["tasks"]["skipped"] += 1
                    import_results["tasks"]["imported"] += 1
                    import_results["tasks"]["results"].append(f"スキップ: {name} (プロジェクトが見つかりません)")
                    continue

                # 担当者IDを取得（IDが明示されていれば優先、なければ名前で検索）
                assigned_to = None
                if 'assigned_to_id' in locals() and assigned_to_id:
                    try:
                        assigned_to = int(assigned_to_id)
                    except Exception:
                        assigned_to = None
                if not assigned_to:
                    # assigned_to_name変数が存在するかチェック
                    assigned_to_name_for_search = assigned_to_name if 'assigned_to_name' in locals() else None
                    if assigned_to_name_for_search:
                        assigned_to = get_user_id_by_name(db, assigned_to_name_for_search)
                if not assigned_to and 'assigned_to_name' in locals() and assigned_to_name:
                    import_results["tasks"]["skipped"] += 1
                    import_results["tasks"]["imported"] += 1
                    import_results["tasks"]["results"].append(f"スキップ: {name} (担当者 {assigned_to_name} が見つかりません)")
                    continue

                # 新規タスクを作成
                task = models.Task(
                    name=name,
                    description=description,
                    project_id=project_id,
                    status=models.TaskStatus.TODO,
                    due_date=due_date,
                    assigned_to=assigned_to,
                    cost=cost,
                    type=task_type,
                    seqID=seq_id,
                    shotID=shot_id,
                    dependsOn=depends_on,
                    display_status='offline',
                    priority=models.TaskPriority.MEDIUM,  # デフォルトの優先度を設定
                    start_date=None
                )
                db.add(task)
                db.flush()  # IDを取得するためにflush
                import_results["tasks"]["imported"] += 1
                import_results["tasks"]["results"].append(f"追加: {name} (ID: {task.id})")

                # 依存関係を更新
                if depends_on:
                    # 依存タスクのIDを取得
                    depends_on_ids = []
                    for dep_name in depends_on:
                        dep_task = db.query(models.Task).filter(
                            models.Task.name == dep_name,
                            models.Task.project_id == project_id
                        ).first()
                        if dep_task:
                            depends_on_ids.append(str(dep_task.id))
                        else:
                            import_results["tasks"]["results"].append(f"警告: 依存タスク '{dep_name}' が見つかりません")
                    
                    if depends_on_ids:
                        task.dependsOn = depends_on_ids
                        import_results["tasks"]["results"].append(f"タスク {name} の依存関係を更新: {depends_on_ids}")

            except Exception as e:
                import_results["tasks"]["skipped"] += 1
                import_results["tasks"]["imported"] += 1
                import_results["tasks"]["results"].append(f"エラー: {name} - {str(e)}")

        db.commit()  # すべての変更をコミット


        summary = {
            "users": import_results["users"]["imported"],
            "projects": import_results["projects"]["imported"],
            "tasks": import_results["tasks"]["imported"],
            "events": import_results["events"]["imported"],
            "groups": import_results["groups"]["imported"],
            "user_groups": import_results["user_groups"]["imported"]
        }

        errors = []
        for section, result in import_results.items():
            if "results" in result:
                section_errors = [msg for msg in result["results"] if msg.startswith("エラー")]
                errors.extend(section_errors)

        return {
            "summary": summary,
            "errors": errors
        }

    except Exception:
        db.rollback()
        logger.exception("モックデータのインポート中にエラーが発生しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="モックデータのインポート中にエラーが発生しました。"
        )

@app.get("/admin/backup", tags=["Admin"])
async def create_backup(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin),
):
    """バックアップデータをJSONで取得（管理者のみ）。フロントでファイルとして保存する。"""
    def _serialize(obj):
        if obj is None:
            return None
        if isinstance(obj, dict):
            return {k: _serialize(v) for k, v in obj.items()}
        if isinstance(obj, (datetime, date)):
            return obj.isoformat() if hasattr(obj, "isoformat") else str(obj)
        if isinstance(obj, list):
            return [_serialize(x) for x in obj]
        if hasattr(obj, "__dict__"):
            d = {}
            for k, v in obj.__dict__.items():
                if k.startswith("_"):
                    continue
                d[k] = _serialize(v)
            return d
        return obj

    projects = crud.get_projects(db=db, skip=0, limit=100000)
    tasks_raw = crud.get_tasks(db=db, skip=0, limit=100000)
    events = crud.get_events(db=db, skip=0, limit=100000)
    users = crud.get_users(db=db, skip=0, limit=100000)
    groups = crud.get_groups(db=db, skip=0, limit=100000)
    user_groups = db.query(models.UserGroup).limit(100000).all() if hasattr(models, "UserGroup") else []

    tasks = [t if isinstance(t, dict) else _serialize(t) for t in tasks_raw]
    return {
        "exported_at": datetime.now().isoformat(),
        "projects": [_serialize(p) for p in projects],
        "tasks": tasks,
        "events": [_serialize(e) for e in events],
        "users": [{"id": u.id, "username": u.username, "email": u.email, "full_name": u.full_name, "name": u.name} for u in users],
        "groups": [_serialize(g) for g in groups],
        "user_groups": [_serialize(ug) for ug in user_groups],
    }


@app.get("/admin/backup-db", tags=["Admin"])
async def backup_database_file(
    current_user: models.User = Depends(get_current_active_admin),
    db: Session = Depends(get_db)
):
    """データベースファイル（.db）をバックアップしてダウンロード（管理者のみ）"""
    import sqlite3
    temp_backup_path = None
    try:
        logger.info("データベースバックアップの作成を開始します")
        
        # SQLiteのバックアップコマンドを使用して一時ファイルにバックアップを作成
        temp_backup = tempfile.NamedTemporaryFile(delete=False, suffix='.db')
        temp_backup_path = temp_backup.name
        temp_backup.close()
        
        logger.info(f"一時バックアップファイルを作成しました: {temp_backup_path}")
        
        # SQLiteのバックアップコマンドを実行
        # SQLAlchemyのエンジンから直接SQLiteのバックアップを実行
        logger.info("データベースのバックアップを実行中...")
        source_conn = sqlite3.connect(str(DATABASE_FILE_PATH), timeout=30.0)
        backup_conn = sqlite3.connect(temp_backup_path, timeout=30.0)
        source_conn.backup(backup_conn, pages=100, progress=None)  # pagesパラメータで進捗を制御
        source_conn.close()
        backup_conn.close()
        
        logger.info("データベースのバックアップが完了しました")
        
        # タイムスタンプ付きファイル名を生成
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"project_management_backup_{timestamp}.db"
        
        logger.info(f"バックアップファイルを返します: {filename}")
        
        # ファイルを返す
        return FileResponse(
            temp_backup_path,
            media_type='application/octet-stream',
            filename=filename,
            background=BackgroundTasks([lambda p=temp_backup_path: os.unlink(p) if p and os.path.exists(p) else None])  # ダウンロード後に削除
        )
    except Exception as e:
        logger.exception("データベースバックアップの作成に失敗しました")
        # エラー時も一時ファイルを削除
        if temp_backup_path and os.path.exists(temp_backup_path):
            try:
                os.unlink(temp_backup_path)
            except:
                pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"データベースバックアップの作成に失敗しました: {str(e)}"
        )


@app.get("/admin/csv-template", tags=["Admin"])
async def download_csv_template(
    current_user: models.User = Depends(get_current_active_admin)
):
    """CSVテンプレートをダウンロード（Viteプロキシで /api が剥がされるためパスは /admin/csv-template）"""
    template = """プロジェクト
プロジェクト名,開始日,終了日,説明
プロジェクトX,2024/03/01,2024/03/31,プロジェクトXの説明

タスク情報
タスク名,期日,説明,担当者,コスト,タイプ,seqID,shotID,依存タスク,段階
T1,2024/03/15,T1の説明,user1,16,fx,SEQ001,SHOT001,
T2,2024/03/20,T2の説明,user2,24,animation,SEQ001,SHOT002,T1
T3,2024/03/25,T3の説明,user3,32,comp,SEQ002,SHOT001,"T1,T2","v1:2024/03/23"

会議情報
会議名,説明,実施日,開始時間,終了時間,参加者
キックオフ会議,プロジェクトキックオフ,2024/03/10,10:00,11:00,user1
週次レビュー,進捗確認,2024/03/15,14:00,15:00,"user1,user2"

ワークショップ情報
ワークショップ名,説明,実施日,開始時間,終了時間,参加者
デザインワークショップ,UIデザイン検討,2024/03/18,13:00,16:00,"user1,user2,user3"

イベント情報
イベント名,説明,実施日,参加者
全体ミーティング,月次全体会議,2024/03/25,"user1,user2"

締切情報
締切名,説明,期日
提出締切,成果物提出期限,2024/03/20
レビュー締切,コードレビュー期限,2024/03/28

マイルストーン情報
マイルストーン名,説明,期日
Alpha版,Alphaリリース,2024/03/25
Beta版,Betaリリース,2024/04/10
"""
    return Response(
        content=template.encode('utf-8-sig'),  # BOMを追加してUTF-8でエンコード
        media_type="text/csv; charset=utf-8-sig",
        headers={
            "Content-Disposition": "attachment; filename=project_task_template.csv",
            "Content-Type": "text/csv; charset=utf-8-sig"
        }
    ) 

@app.post("/tasks/{task_id}/status-history", response_model=List[schemas.StatusHistoryEntry])
async def create_status_history(
    task_id: int,
    history: schemas.StatusHistoryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    return crud.create_status_history(db=db, task_id=task_id, status=history.status, changed_by=current_user.id)

@app.get("/tasks/{task_id}/status-history", response_model=List[schemas.StatusHistoryEntry])
async def get_task_status_history(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """タスクのステータス履歴を取得"""
    try:
        return crud.get_task_status_history(db=db, task_id=task_id)
    except Exception:
        logger.exception("ステータス履歴の取得に失敗しました")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ステータス履歴の取得に失敗しました。"
        )

@app.get("/metrics/status-changes", response_model=List[schemas.StatusChangeMetric])
async def get_status_change_metrics(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    project_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    return crud.get_status_change_metrics(
        db=db,
        start_date=start_date,
        end_date=end_date,
        project_id=project_id
    ) 

@app.post("/tasks/update-priorities")
async def update_task_priorities(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin),
):
    """全タスクの優先度を正規化（管理者のみ）"""
    try:
        tasks = db.query(models.Task).all()
        for task in tasks:
            # 空文字やNoneはNoneにする
            if task.priority == '' or task.priority is None:
                task.priority = None
            elif isinstance(task.priority, str):
                # 文字列の場合（古いデータ用）
                if task.priority.lower() == "high":
                    task.priority = models.TaskPriority.HIGH
                elif task.priority.lower() == "medium":
                    task.priority = models.TaskPriority.MEDIUM
                elif task.priority.lower() == "low":
                    task.priority = models.TaskPriority.LOW
                else:
                    task.priority = None
            elif hasattr(task.priority, "value"):
                # Enum型の場合（既に正しい場合は何もしない）
                pass
        db.commit()
        return {"message": "タスクの優先度を大文字に更新しました。"}
    except Exception:
        db.rollback()
        logger.exception("タスクの優先度の更新に失敗しました")
        raise HTTPException(
            status_code=500,
            detail="タスクの優先度の更新に失敗しました。"
        )

# --- Note API Endpoints ---

# 画像アップロード用の静的ファイルディレクトリ
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
# アップロードファイルのサイズ制限（バイト）
MAX_IMAGE_UPLOAD_BYTES = int(os.getenv("MAX_IMAGE_UPLOAD_MB", "10")) * 1024 * 1024
MAX_PDF_UPLOAD_BYTES = int(os.getenv("MAX_PDF_UPLOAD_MB", "20")) * 1024 * 1024

# 静的ファイル配信の設定
from fastapi.staticfiles import StaticFiles
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")), name="static")

@app.post("/notes", response_model=schemas.NoteResponse, tags=["Notes"])
async def create_note(
    note: schemas.NoteCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """新規メモを作成"""
    return crud.create_note(db=db, note=note, created_by=current_user.id)

@app.get("/notes", response_model=List[schemas.NoteResponse], tags=["Notes"])
def get_notes(
    skip: int = 0,
    limit: int = 100,
    project_id: Optional[int] = Query(None, description="プロジェクトIDでフィルタ"),
    project_id_is_null: Optional[bool] = Query(None, description="project_idがnullのメモのみを取得する場合にtrue"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """メモリストを取得（作成者のみ）"""
    try:
        # project_id_is_nullがTrueの場合、project_idがnullのメモのみを取得
        if project_id_is_null:
            query = db.query(models.Note).filter(
                models.Note.created_by == current_user.id
            ).filter(
                models.Note.project_id.is_(None)
            )
            notes = query.order_by(models.Note.created_at.desc()).offset(skip).limit(limit).all()
            return notes
        
        # 作成者のみ取得
        return crud.get_notes(db=db, skip=skip, limit=limit, created_by=current_user.id, project_id=project_id)
    except Exception:
        logger.exception("メモの取得に失敗しました")
        raise HTTPException(status_code=500, detail="メモの取得に失敗しました。")

@app.get("/notes/{note_id}", response_model=schemas.NoteResponse, tags=["Notes"])
def get_note(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """IDでメモを取得（作成者のみ）"""
    db_note = crud.get_note(db=db, note_id=note_id)
    if db_note is None:
        raise HTTPException(status_code=404, detail="メモが見つかりません")
    # 作成者のみアクセス可能
    if db_note.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="このメモにアクセスする権限がありません")
    return db_note

@app.put("/notes/{note_id}", response_model=schemas.NoteResponse, tags=["Notes"])
def update_note(
    note_id: int,
    note: schemas.NoteUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """メモを更新（作成者のみ）"""
    db_note = crud.get_note(db=db, note_id=note_id)
    if db_note is None:
        raise HTTPException(status_code=404, detail="メモが見つかりません")
    # 作成者のみ更新可能
    if db_note.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="このメモを編集する権限がありません")
    return crud.update_note(db=db, db_note=db_note, note_in=note, upload_dir=UPLOAD_DIR)

@app.delete("/notes/{note_id}", tags=["Notes"])
async def delete_note(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """メモを削除（画像ファイルも削除、作成者のみ）"""
    db_note = crud.get_note(db=db, note_id=note_id)
    if db_note is None:
        raise HTTPException(status_code=404, detail="メモが見つかりません")
    # 作成者のみ削除可能
    if db_note.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="このメモを削除する権限がありません")
    # メモと関連する画像ファイルを削除
    crud.delete_note(db=db, db_note=db_note, upload_dir=UPLOAD_DIR)
    return {"message": "メモを削除しました"}

@app.post("/notes/upload-image", tags=["Notes"])
async def upload_note_image(
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user)
):
    """メモ用の画像をアップロード（サイズ制限: デフォルト10MB）"""
    if not file.content_type or not file.content_type.startswith('image/'):
        logger.warning("画像以外のファイルがアップロードされました: %s", file.content_type)
        raise HTTPException(status_code=400, detail="画像ファイルのみアップロード可能です")
    content = await file.read()
    if len(content) > MAX_IMAGE_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"画像サイズは {MAX_IMAGE_UPLOAD_BYTES // (1024*1024)}MB 以内にしてください"
        )
    file_ext = os.path.splitext(file.filename or "")[1] or '.jpg'
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_filename)
    try:
        with open(file_path, "wb") as buffer:
            buffer.write(content)
        return {"url": f"/static/uploads/{unique_filename}"}
    except Exception:
        logger.exception("画像のアップロードに失敗しました")
        raise HTTPException(status_code=500, detail="画像のアップロードに失敗しました。")

@app.post("/notes/upload-pdf", tags=["Notes"])
async def upload_note_pdf(
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user)
):
    """メモ用のPDFをアップロード（サイズ制限: デフォルト20MB）"""
    if not file.content_type or file.content_type != 'application/pdf':
        logger.warning("PDF以外のファイルがアップロードされました: %s", file.content_type)
        raise HTTPException(status_code=400, detail="PDFファイルのみアップロード可能です")
    content = await file.read()
    if len(content) > MAX_PDF_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"PDFサイズは {MAX_PDF_UPLOAD_BYTES // (1024*1024)}MB 以内にしてください"
        )
    file_ext = os.path.splitext(file.filename or "")[1] or '.pdf'
    if file_ext.lower() != '.pdf':
        file_ext = '.pdf'
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_filename)
    try:
        with open(file_path, "wb") as buffer:
            buffer.write(content)
        pdf_url = f"/static/uploads/{unique_filename}"
        
        # Add to RAG Knowledge Base
        rag_service.add_document(
            file_path, 
            metadata={
                "user_id": current_user.id, 
                "uploader_name": current_user.name or current_user.username,
                "file_name": file.filename
            }
        )
        
        return {"url": pdf_url}
    except Exception:
        logger.exception("PDFのアップロードに失敗しました")
        raise HTTPException(status_code=500, detail="PDFのアップロードに失敗しました。")

MAX_AUDIO_UPLOAD_BYTES = int(os.getenv("MAX_AUDIO_UPLOAD_MB", "50")) * 1024 * 1024

@app.post("/notes/upload-audio", tags=["Notes"])
async def upload_note_audio(
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user)
):
    """メモ用の音声をアップロード（サイズ制限: デフォルト50MB）"""
    if not file.content_type or not (file.content_type.startswith('audio/') or file.content_type.startswith('video/')):
        logger.warning("音声以外のファイルがアップロードされました: %s", file.content_type)
        raise HTTPException(status_code=400, detail="音声ファイルのみアップロード可能です")
    content = await file.read()
    if len(content) > MAX_AUDIO_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"音声サイズは {MAX_AUDIO_UPLOAD_BYTES // (1024*1024)}MB 以内にしてください"
        )
    file_ext = os.path.splitext(file.filename or "")[1] or '.mp3'
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_filename)
    try:
        with open(file_path, "wb") as buffer:
            buffer.write(content)
        audio_url = f"/static/uploads/{unique_filename}"
        return {"url": audio_url}
    except Exception:
        logger.exception("音声のアップロードに失敗しました")
        raise HTTPException(status_code=500, detail="音声のアップロードに失敗しました。")

# --- UserActivity Endpoints ---

@app.post("/api/user-activities", response_model=schemas.UserActivityResponse, status_code=status.HTTP_201_CREATED, tags=["UserActivities"])
def create_user_activity(
    activity_data: schemas.UserActivityCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """ユーザーのアクティビティを記録（一般ユーザーは自分のみ記録可能、管理者は全ユーザー記録可能）"""
    user_id = activity_data.user_id if activity_data.user_id else current_user.id
    
    # 一般ユーザーは自分のアクティビティのみ記録可能
    if current_user.role != 'admin' and user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="自分のアクティビティのみ記録可能です"
        )
    
    # ユーザーが存在するか確認
    db_user = crud.get_user(db, user_id=user_id)
    if not db_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="ユーザーが見つかりません"
        )
    
    # 一般・管理者を問わずアクティビティを記録する
    return crud.create_user_activity(db=db, user_id=user_id)

@app.get("/api/user-activities", response_model=List[schemas.UserActivityResponse], tags=["UserActivities"])
def get_user_activities_endpoint(
    user_id: Optional[int] = Query(None, description="ユーザーIDでフィルタリング"),
    cycle_date: Optional[str] = Query(None, description="周期日（YYYY-MM-DD形式）"),
    skip: int = 0,
    limit: int = 10000,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_admin)  # 管理者のみ閲覧可能
):
    """ユーザーアクティビティを取得（管理者のみ）"""
    cycle_date_dt = None
    if cycle_date:
        try:
            # YYYY-MM-DD形式の文字列を日付として解析
            # 時刻部分がない場合は、その日の5:00を周期開始時刻として設定
            if 'T' in cycle_date or ' ' in cycle_date:
                cycle_date_dt = datetime.fromisoformat(cycle_date.replace('Z', '+00:00')).replace(tzinfo=None)
            else:
                # YYYY-MM-DD形式の場合、その日の5:00を周期開始時刻として設定
                parsed_date = datetime.strptime(cycle_date, '%Y-%m-%d')
                cycle_date_dt = parsed_date.replace(hour=5, minute=0, second=0, microsecond=0)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="周期日の形式が不正です（YYYY-MM-DD形式で指定してください）"
            )
    
    activities = crud.get_user_activities(
        db=db,
        user_id=user_id,
        cycle_date=cycle_date_dt,
        skip=skip,
        limit=limit
    )
    return activities 