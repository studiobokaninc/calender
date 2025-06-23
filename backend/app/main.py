from fastapi import FastAPI, Depends, HTTPException, status, Body, BackgroundTasks, Response, Request, Query, Path, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, date
from typing import Optional, List, Dict, Any, Union, Annotated
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field
from . import models, database, crud, schemas
from . import mock_data
from .database import engine, get_db
import uuid
import os
from . import security
import json
import logging
import math
import csv

# ログの設定
logging.basicConfig(
    level=logging.INFO,  # DEBUGからINFOに変更
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),  # コンソール出力
        logging.FileHandler('app.log')  # ファイル出力
    ]
)
logger = logging.getLogger(__name__)

# データベーステーブルの作成
models.Base.metadata.create_all(bind=engine)

# FastAPIアプリケーションインスタンスの作成
app = FastAPI(
    title="プロジェクト管理API",
    description="プロジェクト、タスク、イベント、ユーザーを管理するためのAPI",
    version="0.1.0",
)

# CORSミドルウェアの設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5175", "http://192.168.44.253:5175"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# ユーザー認証関連のモデルとユーティリティ
SECRET_KEY = os.getenv("SECRET_KEY", "your_very_secret_key_that_is_long_and_secure")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 120))

# pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto") # security.py に移動

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/token")

# ★★★ Create fake_users_db from mock_data ★★★
fake_users_db = {user["username"]: user for user in mock_data.users}

def get_user(db, username: str):
    print(f"[DEBUG] get_user called with username: {username}") # Keep debug print for now
    if username in db:
        user_dict = db[username]
        print(f"[DEBUG] User found in fake_db: {user_dict}") # Keep debug print for now
        return user_dict
    print("[DEBUG] User NOT found in fake_db") # Keep debug print for now
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
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: Session = Depends(get_db)) -> models.User:
    """JWT トークンを検証し、対応するユーザーを DB から取得"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
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
async def login_for_access_token(form_data: Annotated[OAuth2PasswordRequestForm, Depends()], db: Session = Depends(get_db)):
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
async def get_dashboard_metrics(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
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

    # 他のメトリクスも同様にDBから取得することを推奨します
    # num_projects = len(crud.get_projects(db=db, limit=100000))
    # num_events = len(crud.get_events(db=db, limit=100000))
    # num_users = len(crud.get_users(db=db, limit=100000)) # crud.get_users があれば

    return {
        "users": len(mock_data.users), # 現状維持 (DBからの取得を推奨)
        "tasks": num_tasks,
        "projects": len(mock_data.projects), # 現状維持 (DBからの取得を推奨)
        "events": len(mock_data.events)    # 現状維持 (DBからの取得を推奨)
    }
    
@app.get("/projects", response_model=List[schemas.ProjectResponse], tags=["Projects"])
async def get_projects_endpoint(
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
async def get_project_endpoint(
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
async def create_project_endpoint(
    project_data: schemas.ProjectCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """新規プロジェクトを作成"""
    created_project = crud.create_project(db=db, project=project_data)
    return created_project

@app.put("/projects/{project_id}", response_model=schemas.ProjectResponse, tags=["Projects"])
async def update_project_endpoint(
    project_id: int,
    project_data: schemas.ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """プロジェクト情報を更新"""
    db_project = crud.get_project(db=db, project_id=project_id)
    if db_project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="プロジェクトが見つかりません"
        )
    
    # display_status 変更権限チェック (管理者のみ)
    if project_data.display_status is not None and db_project.display_status != project_data.display_status:
        if current_user.role != 'admin':
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="プロジェクトの表示ステータスを変更する権限がありません"
            )

    updated_project = crud.update_project(db=db, db_project=db_project, project_in=project_data)
    return updated_project

@app.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Projects"])
async def delete_project_endpoint(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """プロジェクトを削除"""
    try:
        # プロジェクトの存在確認
        project = crud.get_project(db=db, project_id=project_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="プロジェクトが見つかりません"
            )
        
        # 関連するタスクを削除
        tasks = db.query(models.Task).filter(models.Task.project_id == project_id).all()
        for task in tasks:
            # タスクのステータス履歴を削除
            db.query(models.TaskStatusHistory).filter(models.TaskStatusHistory.task_id == task.id).delete()
            db.delete(task)
        
        # 関連するイベントを削除
        events = crud.get_events(db=db, project_id=project_id)
        for event in events:
            db.delete(event)
        
        # プロジェクトを削除
        db.delete(project)
        db.commit()
        
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    except HTTPException as he:
        db.rollback()
        raise he
    except Exception as e:
        db.rollback()
        logger.error(f"プロジェクト削除エラー: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"プロジェクトの削除中にエラーが発生しました: {str(e)}"
        )

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
        
        # タスクの依存関係を処理
        for task in tasks:
            if task.get('dependsOn'):
                try:
                    # 依存タスクの情報を取得
                    depends_on_tasks = []
                    for depends_on_id in task['dependsOn']:
                        depends_on_task = crud.get_task(db, depends_on_id)
                        if depends_on_task:
                            depends_on_tasks.append({
                                'id': depends_on_task.id,
                                'name': depends_on_task.name,
                                'status': depends_on_task.status
                            })
                    task['dependsOnTasks'] = depends_on_tasks
                except Exception as e:
                    logger.error(f"依存タスクの取得に失敗: {str(e)}")
                    task['dependsOnTasks'] = []
        
        return tasks

    except Exception as e:
        logger.error(f"タスクの取得に失敗: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"タスクの取得に失敗しました: {str(e)}"
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
                detail=f"無効なプロジェクトID形式です: {project_id}"
            )

    events = crud.get_events(db=db, skip=skip, limit=limit, project_id=project_id_int)
    return events

@app.post("/calendar/events", response_model=schemas.EventResponse, status_code=status.HTTP_201_CREATED, tags=["Events"])
async def create_event_endpoint(
    event_data: schemas.EventCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """新規イベントを作成 (デフォルトステータスは 'offline')"""
    # TODO: Add authorization checks if needed
    created_event = crud.create_event(db=db, event=event_data)
    return created_event

@app.put("/calendar/events/{event_id}", response_model=schemas.EventResponse, tags=["Events"])
async def update_event_endpoint(
    event_id: int,
    event_data: schemas.EventUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """イベント情報を更新 (ステータス変更は管理者のみ)"""
    db_event = crud.get_event(db=db, event_id=event_id)
    if db_event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    # 権限チェック: ステータス変更は管理者のみ
    if event_data.status is not None and db_event.status != event_data.status:
        if current_user.role != 'admin':
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, 
                detail="イベントステータスを変更する権限がありません"
            )
    # TODO: Add more granular permission checks (e.g., event creator)

    updated_event = crud.update_event(db=db, db_event=db_event, event_in=event_data)
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
    # TODO: Add more granular permission checks (e.g., event creator)

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
    except Exception as e:
        print(f"[ERROR] ユーザー取得中にエラーが発生: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ユーザー情報の取得に失敗しました: {str(e)}"
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
    current_user: models.User = Depends(get_current_user)
):
    """ユーザーをグループに追加"""
    # TODO: Add authorization check (e.g., admin or group leader?)
    
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
    current_user: models.User = Depends(get_current_user)
):
    """ユーザーをグループから削除"""
    # TODO: Add authorization check (e.g., admin or group leader?)
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
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """新規タスクを作成"""
    # TODO: Check if project_id exists and user has permission
    created_task = crud.create_task(db=db, task=task_data)
    return created_task
    
@app.put("/tasks/{task_id}", response_model=schemas.TaskResponse, tags=["Tasks"])
async def update_task_endpoint(
    task_id: int,
    task_data: schemas.TaskUpdate,
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
    # TODO: Add authorization check (e.g., user is assignee or project member)

    # display_status 変更権限チェック (管理者のみ)
    if task_data.display_status is not None and db_task.display_status != task_data.display_status:
        if current_user.role != 'admin':
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="タスクの表示ステータスを変更する権限がありません"
            )

    updated_task = crud.update_task(db=db, db_task=db_task, task_in=task_data)
    return updated_task

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
    # TODO: Add authorization check
    crud.delete_task(db=db, db_task=db_task)
    return None # 204 No Content

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
    
    except Exception as e:
        import traceback
        traceback.print_exc() # エラー詳細を出力
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"データエクスポート中にエラーが発生しました: {str(e)}"
        )

def parse_date(date_str: str) -> Optional[datetime]:
    """日付文字列をパースする関数"""
    if not date_str:
        return None
    try:
        # スラッシュ区切りの日付形式に対応
        if '/' in date_str:
            year, month, day = map(int, date_str.split('/'))
            return datetime(year, month, day)
        # ハイフン区切りの日付形式に対応
        elif '-' in date_str:
            year, month, day = map(int, date_str.split('-'))
            return datetime(year, month, day)
        # ISO形式の日付にも対応
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
    """ユーザー名からユーザーIDを取得する関数"""
    if not username:
        return None

    # ユーザー名で検索
    user = db.query(models.User).filter(models.User.username == username).first()
    if user:
        return user.id
    
    # メールアドレスで検索
    user = crud.get_user_by_email(db, email=username)
    if user:
        return user.id
    
    # フルネームで検索
    user = db.query(models.User).filter(models.User.name == username).first()
    if user:
        return user.id
    
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

def parse_task_data(task_data: List[str], project_id: int, db: Session) -> dict:
    """タスクデータをパースする関数"""
    try:
        name = task_data[0].strip()
        if not name or name == "タスク名":  # ヘッダー行のチェック
            raise ValueError("タスク名が不正です")

        due_date = parse_date(task_data[1]) if task_data[1].strip() else None
        description = task_data[2].strip() if len(task_data) > 2 else ""
        assigned_to_username = task_data[3].strip() if len(task_data) > 3 else None
        cost = float(task_data[4]) if len(task_data) > 4 and task_data[4].strip() else 0
        task_type = task_data[5].strip().upper() if len(task_data) > 5 and task_data[5].strip() else None
        seq_id = task_data[6].strip() if len(task_data) > 6 and task_data[6].strip() else None
        shot_id = task_data[7].strip() if len(task_data) > 7 and task_data[7].strip() else None
        depends_on = parse_dependencies(task_data[8]) if len(task_data) > 8 and task_data[8].strip() else []

        # 担当者IDを取得
        assigned_to_id = None
        if assigned_to_username:
            user = db.query(models.User).filter(models.User.username == assigned_to_username).first()
            if user:
                assigned_to_id = user.id
            else:
                logger.warning(f"担当者 {assigned_to_username} が見つかりません")

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
            "priority": models.TaskPriority.MEDIUM
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
        logger.info(f"タスク {task_name} の依存関係を更新: {dependency_ids}")

@app.post("/admin/mock-data/import-csv")
async def import_csv_data(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)  # 現在のユーザーを取得
):
    """CSVファイルからデータをインポートする"""
    import_results = {
        "projects": {"imported": 0, "skipped": 0, "results": []},
        "tasks": {"imported": 0, "skipped": 0, "results": []}
    }

    try:
        # CSVファイルを読み込む
        contents = await file.read()
        csv_data = contents.decode('utf-8-sig').splitlines()  # BOMを考慮
        csv_reader = csv.reader(csv_data)

        # プロジェクト情報セクションを探す
        project_data = None
        while True:
            row = next(csv_reader, None)
            if row is None:
                raise HTTPException(status_code=400, detail="プロジェクト情報が見つかりません")
            if row[0].strip() == "プロジェクト情報":
                break

        # ヘッダー行をスキップ
        next(csv_reader, None)  # "プロジェクト名,開始日,終了日,説明" の行をスキップ

        # プロジェクト情報を読み込む
        project_data = next(csv_reader, None)
        if not project_data or len(project_data) < 4:
            raise HTTPException(status_code=400, detail="プロジェクト情報が不正です")

        logger.info(f"プロジェクト情報（生データ）: {project_data}")
        
        project_name = project_data[0].strip()
        if not project_name or project_name == "プロジェクト名" or len(project_name) > 100:  # ヘッダー行のチェックと長さ制限
            raise HTTPException(status_code=400, detail="プロジェクト名が不正です（空、ヘッダー行、または100文字を超えています）")

        start_date = parse_date(project_data[1])
        if not start_date:
            raise HTTPException(status_code=400, detail=f"開始日の形式が不正です: {project_data[1]}")

        end_date = parse_date(project_data[2])
        if not end_date:
            raise HTTPException(status_code=400, detail=f"終了日の形式が不正です: {project_data[2]}")

        description = project_data[3].strip()

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
        logger.info(f"新規プロジェクトを作成: {project_name} (ID: {project.id})")
        import_results["projects"]["imported"] += 1
        import_results["projects"]["results"].append(f"作成: {project_name}")

        # タスク情報セクションを探す
        while True:
            row = next(csv_reader, None)
            if row is None:
                break
            if row[0].strip() == "タスク情報":
                break

        # ヘッダー行をスキップ
        next(csv_reader, None)  # "タスク名,期日,説明,担当者,コスト,タイプ,seqID,shotID,依存タスク" の行をスキップ

        # タスク情報を読み込む
        for task_data in csv_reader:
            if not task_data or not task_data[0].strip():  # 空行をスキップ
                continue

            # ヘッダー行のチェック
            if task_data[0].strip() == "タスク名":
                continue

            logger.info(f"タスク情報（生データ）: {task_data}")
            
            try:
                # タスクデータのパース
                task_dict = parse_task_data(task_data, project.id, db)
                
                # タスクの作成
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
                    priority=models.TaskPriority.MEDIUM  # デフォルトの優先度を設定
                )
                db.add(task)
                db.commit()
                db.refresh(task)
                logger.info(f"新規タスクを作成: {task.name} (ID: {task.id})")
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
                db.commit()
                logger.info(f"タスク {task.name} のステータス履歴を作成: TODO")

                # 依存関係の更新
                if task_dict["dependsOn"]:
                    update_task_dependencies(task.name, task_dict["dependsOn"], db)
            except Exception as e:
                logger.error(f"タスクの作成に失敗: {str(e)}")
                import_results["tasks"]["skipped"] += 1
                import_results["tasks"]["results"].append(f"エラー: {task_data[0]} - {str(e)}")
                continue

        return import_results

    except Exception as e:
        logger.error(f"CSVインポートエラー: {str(e)}")
        raise HTTPException(status_code=500, detail=f"CSVインポートに失敗しました: {str(e)}")

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

        # ユーザーをインポート
        for user_data in data.users:
            username = "<不明>"  # 初期化しておく
            try:
                username = user_data[0]
                email = user_data[1]
                password = user_data[2]
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
            except Exception as e:
                import_results["users"]["skipped"] += 1
                import_results["users"]["results"].append(f"エラー: {username} - {str(e)}")

        # プロジェクトをインポート
        for project_data in data.projects:
            name = "<不明>"
            try:
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
            except Exception as e:
                import_results["projects"]["results"].append(f"エラー: {name} - {str(e)}")

        # タスクをインポート
        for task_data in data.tasks:
            try:
                name = task_data[0]
                due_date = parse_date(task_data[1])
                description = task_data[2]
                assigned_to_name = task_data[3]
                cost = float(task_data[4])
                task_type = task_data[5].upper() if task_data[5] else None
                seq_id = task_data[6]
                shot_id = task_data[7]
                depends_on = task_data[8].split(',') if len(task_data) > 8 and task_data[8] else []

                # プロジェクトIDを取得（最初のプロジェクトを使用）
                project_id = next(iter(project_name_to_id.values())) if project_name_to_id else None
                if not project_id:
                    import_results["tasks"]["skipped"] += 1
                    import_results["tasks"]["imported"] += 1
                    import_results["tasks"]["results"].append(f"スキップ: {name} (プロジェクトが見つかりません)")
                    continue

                # 担当者IDを取得
                assigned_to = get_user_id_by_name(db, assigned_to_name)
                if not assigned_to:
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
                    priority=models.TaskPriority.MEDIUM  # デフォルトの優先度を設定
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
                            results.append(f"警告: 依存タスク '{dep_name}' が見つかりません")
                    
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

    except Exception as e:
        db.rollback()
        print(f"\n=== エラー発生 ===")
        print(f"エラー内容: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"モックデータのインポート中にエラーが発生しました: {str(e)}"
        )

@app.get("/api/admin/csv-template", tags=["Admin"])
async def download_csv_template(
    current_user: models.User = Depends(get_current_active_admin)
):
    """CSVテンプレートをダウンロード"""
    template = """プロジェクト情報
プロジェクト名,開始日,終了日,説明
プロジェクトX,2024/03/01,2024/03/31,プロジェクトXの説明

タスク情報
タスク名,期日,説明,担当者,コスト,タイプ,seqID,shotID,依存タスク
T1,2024/03/15,T1の説明,user1,16,fx,SEQ001,SHOT001,
T2,2024/03/20,T2の説明,user2,24,animation,SEQ001,SHOT002,T1
T3,2024/03/25,T3の説明,user3,32,comp,SEQ002,SHOT001,"T1,T2"
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
    except Exception as e:
        logger.error(f"ステータス履歴の取得に失敗: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ステータス履歴の取得に失敗しました: {str(e)}"
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
def update_task_priorities(db: Session = Depends(get_db)):
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
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"タスクの優先度の更新に失敗しました: {str(e)}"
        ) 