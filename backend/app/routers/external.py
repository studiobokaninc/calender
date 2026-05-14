import os
import json
import sqlite3
import tempfile
import shutil
import logging
import enum
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException, status, Header, Query, BackgroundTasks
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session
from sqlalchemy import text, or_

from pydantic import BaseModel, Field
from .. import models, schemas
from ..database import get_db, DATABASE_FILE_PATH
from ..security import verify_password
from .admin import TABLE_MODEL_MAP, serialize_model

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/external", tags=["External API"])

def verify_external_token(
    token: Optional[str] = Query(None, description="External access token in query string"),
    x_api_token: Optional[str] = Header(None, alias="X-API-Token", description="External access token in header"),
    authorization: Optional[str] = Header(None, description="Bearer token in Authorization header")
) -> str:
    """
    外部のAIやCLIツール向けに、簡略化されたトークンベースの認証を提供する。
    .env の CLI_BYPASS_TOKEN と一致すれば、通常のログインやセッションCookieの検証をスキップする。
    """
    bypass_token = os.getenv("CLI_BYPASS_TOKEN")
    if not bypass_token:
        logger.error("CLI_BYPASS_TOKEN is not configured in environment variables.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="サーバー側で外部アクセストークンが設定されていません。"
        )
    
    # Authorization: Bearer <token> からの抽出
    bearer_token = None
    if authorization and authorization.startswith("Bearer "):
        bearer_token = authorization.split("Bearer ")[1].strip()
        
    actual_token = token or x_api_token or bearer_token
    
    if not actual_token or actual_token != bypass_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="有効なアクセストークン（CLI_BYPASS_TOKEN）が指定されていません。ログインはスキップされますが、正しいトークンは必須です。"
        )
    return actual_token

def _find_user(db: Session, identifier: str) -> Optional[models.User]:
    """
    文字列の識別子（ID、Email、Username、Full Name）から User を検索する。
    """
    # 1. 数値ならIDで検索
    try:
        user_id = int(identifier)
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if user:
            return user
    except ValueError:
        pass
        
    # 2. Email、Username、Full Name で検索
    user = db.query(models.User).filter(
        or_(
            models.User.email == identifier,
            models.User.username == identifier,
            models.User.full_name == identifier
        )
    ).first()
    return user

def _get_user_specific_data(db: Session, user: models.User) -> Dict[str, Any]:
    """
    指定されたユーザーに関連するすべてのデータベースレコード（全19テーブル）を再帰的・関連的に抽出し、
    JSONシリアライズ可能な辞書形式で返却する。
    """
    user_id = user.id
    user_email = user.email or ""
    
    # 関連プロジェクトIDの抽出 (タスク、ノート、ナレッジアイテム)
    task_project_ids = [r[0] for r in db.query(models.Task.project_id).filter(models.Task.assigned_to == user_id, models.Task.project_id != None).distinct().all()]
    note_project_ids = [r[0] for r in db.query(models.Note.project_id).filter(models.Note.created_by == user_id, models.Note.project_id != None).distinct().all()]
    ki_project_ids = [r[0] for r in db.query(models.KnowledgeItem.project_id).filter(models.KnowledgeItem.created_by == user_id, models.KnowledgeItem.project_id != None).distinct().all()]
    
    related_project_ids = list(set(task_project_ids + note_project_ids + ki_project_ids))
    
    data = {}
    
    # 1. users (対象ユーザーのみ)
    data["users"] = [serialize_model(user)]
    
    # 2. projects (関連するプロジェクトのみ)
    projects = db.query(models.Project).filter(models.Project.id.in_(related_project_ids)).all() if related_project_ids else []
    data["projects"] = [serialize_model(p) for p in projects]
    
    # 3. tasks (アサインされているタスク)
    tasks = db.query(models.Task).filter(models.Task.assigned_to == user_id).all()
    data["tasks"] = [serialize_model(t) for t in tasks]
    task_ids = [t.id for t in tasks]
    
    # 4. task_status_history (自分が変更した履歴、またはアサインされたタスクの履歴)
    history_query = db.query(models.TaskStatusHistory)
    if task_ids:
        history = history_query.filter(
            or_(
                models.TaskStatusHistory.changed_by == user_id,
                models.TaskStatusHistory.task_id.in_(task_ids)
            )
        ).all()
    else:
        history = history_query.filter(models.TaskStatusHistory.changed_by == user_id).all()
    data["task_status_history"] = [serialize_model(h) for h in history]
    
    # 5. user_groups (所属するグループの紐付け)
    user_groups = db.query(models.UserGroup).filter(models.UserGroup.user_id == user_id).all()
    data["user_groups"] = [serialize_model(ug) for ug in user_groups]
    group_ids = [ug.group_id for ug in user_groups]
    
    # 6. groups (所属グループ情報)
    groups = db.query(models.Group).filter(models.Group.id.in_(group_ids)).all() if group_ids else []
    data["groups"] = [serialize_model(g) for g in groups]
    
    # 7. notes (自分が作成したメモ)
    notes = db.query(models.Note).filter(models.Note.created_by == user_id).all()
    data["notes"] = [serialize_model(n) for n in notes]
    
    # 8. chat_messages (自分のチャット履歴)
    chat_msgs = db.query(models.ChatMessage).filter(models.ChatMessage.user_id == user_id).all()
    data["chat_messages"] = [serialize_model(cm) for cm in chat_msgs]
    
    # 9. user_activities (自分のアクティビティログ)
    activities = db.query(models.UserActivity).filter(models.UserActivity.user_id == user_id).all()
    data["user_activities"] = [serialize_model(ua) for ua in activities]
    
    # 10. user_google_tokens (Google連携)
    google_tokens = db.query(models.UserGoogleToken).filter(models.UserGoogleToken.user_id == user_id).all()
    data["user_google_tokens"] = [serialize_model(ugt) for ugt in google_tokens]
    
    # 11. task_google_sync (タスクGoogle同期)
    task_sync = db.query(models.TaskGoogleSync).filter(models.TaskGoogleSync.user_id == user_id).all()
    data["task_google_sync"] = [serialize_model(tgs) for tgs in task_sync]
    
    # 12. project_google_sync (プロジェクトGoogle同期)
    project_sync = db.query(models.ProjectGoogleSync).filter(models.ProjectGoogleSync.user_id == user_id).all()
    data["project_google_sync"] = [serialize_model(pgs) for pgs in project_sync]
    
    # 13. event_google_sync (イベントGoogle同期)
    event_sync = db.query(models.EventGoogleSync).filter(models.EventGoogleSync.user_id == user_id).all()
    data["event_google_sync"] = [serialize_model(egs) for egs in event_sync]
    
    # 14. knowledge_items (自分が作成したナレッジアイテム)
    ki_items = db.query(models.KnowledgeItem).filter(models.KnowledgeItem.created_by == user_id).all()
    data["knowledge_items"] = [serialize_model(ki) for ki in ki_items]
    ki_ids = [ki.id for ki in ki_items]
    
    # 15. knowledge_tags (ナレッジタグ)
    tags = db.query(models.KnowledgeTag).filter(models.KnowledgeTag.knowledge_item_id.in_(ki_ids)).all() if ki_ids else []
    data["knowledge_tags"] = [serialize_model(kt) for kt in tags]
    
    # 16. meetings (関連するプロジェクトの会議)
    meetings = db.query(models.Meeting).filter(models.Meeting.project_id.in_(related_project_ids)).all() if related_project_ids else []
    data["meetings"] = [serialize_model(m) for m in meetings]
    meeting_ids = [m.id for m in meetings]
    
    # 17. decisions (関連するプロジェクトまたは会議の意思決定)
    decisions = db.query(models.Decision).filter(
        or_(
            models.Decision.project_id.in_(related_project_ids),
            models.Decision.meeting_id.in_(meeting_ids)
        )
    ).all() if related_project_ids or meeting_ids else []
    data["decisions"] = [serialize_model(d) for d in decisions]
    
    # 18. meeting_tasks (関連する会議の議事録タスク、またはアサインタスク)
    mt_query = db.query(models.MeetingTask)
    if meeting_ids and task_ids:
        mt_tasks = mt_query.filter(
            or_(
                models.MeetingTask.meeting_id.in_(meeting_ids),
                models.MeetingTask.task_id.in_(task_ids)
            )
        ).all()
    elif meeting_ids:
        mt_tasks = mt_query.filter(models.MeetingTask.meeting_id.in_(meeting_ids)).all()
    elif task_ids:
        mt_tasks = mt_query.filter(models.MeetingTask.task_id.in_(task_ids)).all()
    else:
        mt_tasks = []
    data["meeting_tasks"] = [serialize_model(mt) for mt in mt_tasks]
    
    # 19. events (関連プロジェクトのイベント、または参加者リストに自身が含まれているイベント)
    events_query = db.query(models.Event)
    conditions = []
    if related_project_ids:
        conditions.append(models.Event.project_id.in_(related_project_ids))
    if user_email:
        conditions.append(models.Event.participants.like(f'%{user_email}%'))
    if user.full_name:
        conditions.append(models.Event.participants.like(f'%{user.full_name}%'))
        
    if conditions:
        events = events_query.filter(or_(*conditions)).all()
    else:
        events = []
    data["events"] = [serialize_model(e) for e in events]
    
    return data

def _get_all_database_data(db: Session) -> Dict[str, Any]:
    """
    全19テーブルの情報を丸ごと JSON シリアライズ可能な辞書形式でダンプする。
    """
    export_data = {}
    for table_key, model in TABLE_MODEL_MAP.items():
        rows = db.query(model).all()
        export_data[table_key] = [serialize_model(row) for row in rows]
    return export_data

def _create_sqlite_clone(data: Dict[str, Any]) -> str:
    """
    抽出された辞書データ (19テーブル) を格納した、スキーマ定義が同一の
    一時 SQLite データベースファイル (.db) を作成し、その絶対パスを返す。
    """
    temp_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    temp_db_path = temp_file.name
    temp_file.close()
    
    try:
        # 新しい一時DBに接続
        conn = sqlite3.connect(temp_db_path)
        cursor = conn.cursor()
        
        # 元のデータベースファイルを一時的に ATTACH する
        cursor.execute(f"ATTACH DATABASE '{DATABASE_FILE_PATH.resolve()}' AS source")
        
        # スキーマ構造 (CREATE TABLE 文) をコピーして同一のテーブル群を作成
        cursor.execute("SELECT name, sql FROM source.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        tables = cursor.fetchall()
        
        for table_name, create_sql in tables:
            if create_sql:
                cursor.execute(create_sql)
                
        # ATTACH を解除
        cursor.execute("DETACH DATABASE source")
        conn.commit()
        
        # データのインサート
        for key, records in data.items():
            if key not in TABLE_MODEL_MAP:
                continue
            model = TABLE_MODEL_MAP[key]
            table_name = model.__tablename__
            
            if not records:
                continue
                
            # カラム名の一覧を構築
            columns = list(records[0].keys())
            columns_str = ", ".join([f'"{col}"' for col in columns])
            placeholders = ", ".join([f":" + col for col in columns])
            
            insert_sql = f'INSERT INTO "{table_name}" ({columns_str}) VALUES ({placeholders})'
            
            # JSON 項目などのオブジェクト・リストを SQLite 用に文字列化 (JSON string) して格納
            processed_records = []
            for record in records:
                processed_record = {}
                for col, val in record.items():
                    if isinstance(val, (list, dict)):
                        processed_record[col] = json.dumps(val, ensure_ascii=False)
                    else:
                        processed_record[col] = val
                processed_records.append(processed_record)
                
            cursor.executemany(insert_sql, processed_records)
            
        conn.commit()
        conn.close()
        return temp_db_path
    except Exception as e:
        logger.error(f"Error during cloning SQLite database: {e}")
        if os.path.exists(temp_db_path):
            try:
                os.unlink(temp_db_path)
            except:
                pass
        raise e

def _remove_temp_file(filepath: str):
    """一時ファイルをクリーンアップするためのバックグラウンドタスク"""
    if os.path.exists(filepath):
        try:
            os.unlink(filepath)
            logger.info(f"Successfully removed temporary DB file: {filepath}")
        except Exception as e:
            logger.error(f"Failed to remove temporary DB file {filepath}: {e}")

@router.get("/db/download")
def download_database_api(
    user: Optional[str] = Query(None, description="ユーザーの識別子 (ID, email, username, または full_name)。指定すると、そのユーザーに関連するデータのみをフィルタリングしてエクスポートします。指定しない場合、DB全体のデータをエクスポートします。"),
    format: Optional[str] = Query("json", description="エクスポート形式。'json' または 'sqlite'。デフォルトは 'json'。"),
    token_verified: str = Depends(verify_external_token),
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    【外部AI/CLIツール専用】ログインスキップ・データダウンロードAPI

    - **認証スキップ**: ログインセッションやCookieを不要とし、ヘッダー `X-API-Token`, `Authorization: Bearer <token>`, またはクエリパラメータ `token` に環境変数の `CLI_BYPASS_TOKEN` を渡すことで直接認証します。
    - **ユーザーフィルタリング**: ユーザーを指定すると、そのユーザーに関連するデータ (タスク、プロジェクト、メモ、所属グループ、チャット、アクティビティ、会議、意思決定、同期キーなど) のみを自動で芋づる式にフィルタリングします。
    - **エクスポート形式**:
      - `json`: 全て構造化された JSON 形式でダンプします (AIの読み込みに最適)。
      - `sqlite`: フィルタリングされたデータのみが含まれる、完全に互換性のある SQLite データベースファイル (.db) を自動生成してバイナリダウンロードさせます。
    """
    logger.info(f"External API download requested. Format: {format}, User filtering: {user}")
    
    # 1. ユーザーフィルタリングの処理
    target_user = None
    if user:
        target_user = _find_user(db, user)
        if not target_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"指定されたユーザー '{user}' が見つかりません。正しいID, email, username, または full_name を指定してください。"
            )
            
    # 2. データの抽出
    if target_user:
        data = _get_user_specific_data(db, target_user)
        filename_prefix = f"db_user_{target_user.username or target_user.id}"
    else:
        data = _get_all_database_data(db)
        filename_prefix = "db_full_export"
        
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # 3. フォーマットに応じたレスポンスの返却
    if format.lower() == "sqlite":
        # SQLite ファイルのクローンを作成
        if not target_user:
            # ユーザー指定がない場合は、DB全体のコピーを安全に作成して返す
            temp_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
            temp_db_path = temp_file.name
            temp_file.close()
            try:
                # WAL をディスクに安全にコミット
                db.execute(text("PRAGMA wal_checkpoint(FULL)"))
            except Exception as checkpoint_error:
                logger.warning(f"Failed to checkpoint WAL: {checkpoint_error}")
                
            shutil.copy2(DATABASE_FILE_PATH, temp_db_path)
        else:
            # ユーザー固有データを SQLite にクローン
            try:
                temp_db_path = _create_sqlite_clone(data)
            except Exception as clone_error:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"SQLite データベースのクローン生成中にエラーが発生しました: {str(clone_error)}"
                )
                
        filename = f"{filename_prefix}_{timestamp}.db"
        
        # 送信完了後に一時ファイルを削除するバックグラウンドタスクを設定
        background_tasks.add_task(_remove_temp_file, temp_db_path)
        
        return FileResponse(
            path=temp_db_path,
            media_type="application/octet-stream",
            filename=filename,
            headers={
                "Cache-Control": "no-cache"
            }
        )
        
    elif format.lower() == "json":
        # JSON で返却
        filename = f"{filename_prefix}_{timestamp}.json"
        content = json.dumps(data, ensure_ascii=False, indent=2)
        return Response(
            content=content,
            media_type="application/json",
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Cache-Control": "no-cache"
            }
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"無効なエクスポート形式 '{format}' です。'json' または 'sqlite' を指定してください。"
        )

class ExternalLoginRequest(BaseModel):
    username: str = Field(..., description="ユーザー名（ユーザーIDまたはメールアドレス）")
    password: str = Field(..., description="パスワード")

@router.post("/user/data")
def get_user_data_by_login(
    request: ExternalLoginRequest,
    db: Session = Depends(get_db)
):
    """
    【外部連携専用】ユーザー名（またはメールアドレス）とパスワードを受け取り、
    認証に成功した場合、そのユーザーの基本プロファイル情報および、
    関連するすべてのデータベースレコード（全19テーブルのフィルタデータ）を返却します。
    """
    logger.info(f"External login-based data query requested for user: {request.username}")
    
    # 1. ユーザー名、またはメールアドレスで検索
    db_user = db.query(models.User).filter(
        or_(
            models.User.email == request.username,
            models.User.username == request.username
        )
    ).first()
    
    # 2. パスワードの検証
    if not db_user or not verify_password(request.password, db_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ユーザー名（メールアドレス）またはパスワードが正しくありません。"
        )
        
    # 3. 基本的なユーザープロファイルのシリアライズ（hashed_passwordを確実に除外）
    user_profile = serialize_model(db_user)
    if "hashed_password" in user_profile:
        del user_profile["hashed_password"]
        
    # 4. ユーザーに紐づく芋づる式データの抽出
    user_specific_data = _get_user_specific_data(db, db_user)
    
    # 芋づる式データ側でも、ユーザーテーブルの中の hashed_password を除外
    if "users" in user_specific_data:
        for u in user_specific_data["users"]:
            if "hashed_password" in u:
                del u["hashed_password"]
                
    return {
        "status": "success",
        "user": user_profile,
        "user_data": user_specific_data
    }

@router.get("/users")
def get_external_users_list(
    token_verified: str = Depends(verify_external_token),
    db: Session = Depends(get_db)
):
    """
    【外部連携専用】システムに登録されているすべてのユーザー情報一覧を取得します。
    パスワードハッシュは自動的に除外されます。
    """
    logger.info("External users list requested.")
    users = db.query(models.User).all()
    
    users_list = []
    for u in users:
        u_dict = serialize_model(u)
        if "hashed_password" in u_dict:
            del u_dict["hashed_password"]
        users_list.append(u_dict)
        
    return users_list

