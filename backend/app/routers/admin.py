import logging
import os
import json
import csv
import io
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import text, insert, DateTime, Enum, or_
import enum

from .. import crud, models, schemas, security
from ..database import get_db, DATABASE_FILE_PATH
from ..services.auto_backup import write_backup_data_to_zip
from fastapi.responses import FileResponse, Response, StreamingResponse
import tempfile
import zipfile
import shutil

import uuid
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["Admin"])

# 一時的なダウンロードトークンを保存するためのメモリ内ストア
# 極めてシンプルな実装ですが、サーバー再起動でクリアされます
download_tokens: Dict[str, datetime] = {}

@router.get("/projects/mapping")
def get_project_mapping(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """プロジェクト名からIDへのマッピングを返す"""
    projects = db.query(models.Project).all()
    return {p.name: p.id for p in projects}

@router.post("/mock-data/export")
def export_mock_data(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """全データをエクスポート (MockDataImport形式)"""
    users = db.query(models.User).all()
    projects = db.query(models.Project).all()
    tasks = db.query(models.Task).all()
    events = db.query(models.Event).all()
    groups = db.query(models.Group).all()
    user_groups = db.query(models.UserGroup).all()
    
    return {
        "users": [
            {"email": u.email, "full_name": u.full_name, "role": u.role, "is_active": True, "password": ""}
            for u in users
        ],
        "projects": [
            {
                "name": p.name, 
                "projectStatus": p.status.value if p.status else "planning",
                "projectStartDate": p.start_date.isoformat() if p.start_date else None,
                "projectDueDate": p.end_date.isoformat() if p.end_date else None
            }
            for p in projects
        ],
        "tasks": [
            {
                "name": t.name,
                "description": t.description,
                "project_id": t.project_id,
                "status": t.status.value if t.status else "todo",
                "due_date": t.due_date.isoformat() if t.due_date else None,
                "assigned_to": t.assigned_to,
                "cost": t.cost,
                "dependsOn": t.dependsOn
            }
            for t in tasks
        ],
        "events": [
            {
                "title": e.title,
                "start": e.start_time.isoformat() if e.start_time else None,
                "end": e.end_time.isoformat() if e.end_time else None,
                "description": e.description
            }
            for e in events
        ]
    }

@router.post("/mock-data/import")
def import_mock_data(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """データを一括インポート（既存データは削除される可能性あり）"""
    # 簡易実装: 本来は全削除してから再投入など慎重に行う必要があるが、
    # ここでは既存ロジックを模倣してインポートを受け付ける。
    # ※本番環境では非常に危険な操作であることに注意。
    logger.warning(f"Admin {current_user.email} is importing mock data.")
    return {"message": "Mock data import received (processing logic to be verified)"}

@router.post("/mock-data/import-csv")
async def import_csv_data(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """
    CSVからタスク・プロジェクトを一括インポートするロジック。
    セクション (プロジェクト情報/タスク情報) を判別して解析。
    """
    from ..timezone import now_jst_naive

    content = await file.read()
    decoded = _decode_csv_content(content)

    # 改行コードの標準化 (\r\n および \r を \n に統一し、CR単体改行に対応)
    decoded = decoded.replace('\r\n', '\n').replace('\r', '\n')

    reader = csv.reader(io.StringIO(decoded))
    rows = list(reader)
    
    # 解析フェーズ
    section = None
    project = None
    imported_projects = 0
    imported_tasks = 0
    warnings = []
    
    # 依存関係解決のためのキャッシュ
    # (project_id, task_name) -> db_task
    tasks_to_resolve_deps = [] # List of (db_task, deps_str_list)

    for i, row in enumerate(rows):
        if not row or all(not cell.strip() for cell in row):
            continue
            
        first_cell = row[0].strip()
        
        if "プロジェクト情報" in first_cell:
            section = "project"
            continue
        elif "タスク情報" in first_cell:
            section = "task"
            continue
        elif first_cell in ["プロジェクト名", "タスク名"]:
            continue
            
        if section == "project":
            name = row[0].strip()
            if not name: continue
            
            start_date = _parse_csv_date(row[1]) if len(row) > 1 else None
            end_date = _parse_csv_date(row[2]) if len(row) > 2 else None
            desc = row[3].strip() if len(row) > 3 else ""
            
            project = db.query(models.Project).filter(models.Project.name == name).first()
            if not project:
                project = models.Project(
                    name=name,
                    start_date=start_date,
                    end_date=end_date,
                    description=desc,
                    status=models.ProjectStatus.PLANNING,
                    created_at=now_jst_naive(),
                    updated_at=now_jst_naive()
                )
                db.add(project)
                db.flush()
                # フォルダ作成
                try:
                    from .projects import create_project_folder
                    create_project_folder(project.name)
                except ImportError:
                    # projects.py からではなく直接 scanner から呼ぶ
                    from ..services.meeting_scanner import create_project_folder
                    create_project_folder(project.name)
                imported_projects += 1
            else:
                project.start_date = start_date or project.start_date
                project.end_date = end_date or project.end_date
                project.description = desc or project.description
                project.updated_at = now_jst_naive()

        elif section == "task":
            if not project:
                warnings.append(f"{i+1}行目: プロジェクト未定義のためタスクをスキップしました")
                continue
                
            name = row[0].strip()
            if not name: continue
            
            due_date = _parse_csv_date(row[1]) if len(row) > 1 else None
            desc = row[2].strip() if len(row) > 2 else ""
            assignee = row[3].strip() if len(row) > 3 else ""
            try:
                cost = float(row[4].strip()) if len(row) > 4 and row[4].strip() else 0.0
            except:
                cost = 0.0
            t_type = row[5].strip() if len(row) > 5 else "Task"
            seq_id = row[6].strip() if len(row) > 6 else None
            shot_id = row[7].strip() if len(row) > 7 else None
            deps_raw = row[8].strip() if len(row) > 8 else ""
            
            # --- 開始日の自動計算 (8コスト=1日, 土日スキップ) ---
            start_date = None
            if due_date and cost > 0:
                days_needed = int((max(0.1, cost) - 0.1) // 8)
                current_d = due_date
                count = 0
                while count < days_needed:
                    current_d -= timedelta(days=1)
                    # 土日(5, 6)はカウント対象外
                    if current_d.weekday() >= 5:
                        continue
                    count += 1
                start_date = current_d
            
            user_id = _find_user_by_identifier(db, assignee)
            
            # 既存タスクがあるか確認
            task_obj = db.query(models.Task).filter(
                models.Task.project_id == project.id,
                models.Task.name == name
            ).first()

            if not task_obj:
                task_obj = models.Task(
                    name=name,
                    project_id=project.id,
                    created_at=now_jst_naive()
                )
                db.add(task_obj)
                imported_tasks += 1
            else:
                # 既存タスクがある場合も「更新」としてカウントする場合
                # imported_tasks += 1
                pass

            # プロパティ更新
            task_obj.due_date = due_date
            task_obj.start_date = start_date or task_obj.start_date
            task_obj.description = desc
            task_obj.assigned_to = user_id
            task_obj.cost = cost
            task_obj.type = t_type
            task_obj.seqID = seq_id
            task_obj.shotID = shot_id
            # get-or-create shot FK (seqID→seq_code / shotID→shot_code)。空のみスキップ。
            _seq = (seq_id or '').strip()
            _shot = (shot_id or '').strip()
            if _seq and _shot:
                resolved_shot_id = crud.get_or_create_shot(db, project.id, _seq, _shot)
                if resolved_shot_id:
                    task_obj.shot_id = resolved_shot_id
            task_obj.status = models.TaskStatus.TODO
            task_obj.priority = models.TaskPriority.MEDIUM
            task_obj.updated_at = now_jst_naive()
            
            # 依存関係はID確定後に解決するためメモしておく
            if deps_raw:
                dep_names = [d.strip() for d in deps_raw.replace("、", ",").split(",") if d.strip()]
                tasks_to_resolve_deps.append((task_obj, dep_names))
            else:
                task_obj.dependsOn = []

    db.flush() # IDを確定させる

    # --- 依存関係の解決 (タスク名 -> ID) ---
    from sqlalchemy.orm.attributes import flag_modified
    for task_obj, dep_names in tasks_to_resolve_deps:
        dep_ids = []
        for d_name in dep_names:
            # 同一プロジェクト内から名前でタスクを検索
            dep_task = db.query(models.Task).filter(
                models.Task.project_id == task_obj.project_id,
                models.Task.name == d_name
            ).first()
            if dep_task:
                dep_ids.append(str(dep_task.id))
            else:
                warnings.append(f"タスク '{task_obj.name}': 依存先 '{d_name}' が見つかりませんでした")
        
        task_obj.dependsOn = dep_ids
        flag_modified(task_obj, "dependsOn")

    db.commit()
    
    return {
        "message": "CSVインポートが完了しました",
        "projects": {"imported": imported_projects},
        "tasks": {"imported": imported_tasks},
        "warnings": warnings,
        "detail": f"プロジェクト: {imported_projects}件, タスク: {imported_tasks}件 登録/更新しました。"
    }

@router.post("/backup-db/token")
def get_backup_download_token(
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """短時間有効なダウンロードトークンを発行する"""
    token = str(uuid.uuid4())
    # 5分間有効
    download_tokens[token] = datetime.now() + timedelta(minutes=5)
    return {"token": token}

@router.get("/backup-db")
def backup_db_file(
    token: Optional[str] = None,
):
    """
    データベースファイル (.db) を直接ダウンロード。
    有効な一時トークンが必要。
    """
    # 1. トークンによる認証チェック
    is_valid_token = False
    if token and token in download_tokens:
        if datetime.now() < download_tokens[token]:
            is_valid_token = True
        # 使用済みまたは期限切れトークンのクリーンアップは本来必要だが
        # ここではシンプルに有効性チェックのみ
    
    # 2. トークンが無効な場合は通常の管理者認証をチェック
    if not is_valid_token:
        # トークンがない場合は、手動でDependsを呼び出すか、
        # あるいは単にエラーにする（ブラウザからの直接アクセス想定ならトークン必須にするのが安全）
        raise HTTPException(status_code=401, detail="有効なダウンロードトークンが必要です。再度ボタンを押してください。")

    if not DATABASE_FILE_PATH.exists():
        logger.error(f"Database file not found at {DATABASE_FILE_PATH}")
        raise HTTPException(status_code=404, detail="データベースファイルが見つかりません")
    
    try:
        # 直接バイナリを読み込んで返す（プロキシトラブル回避）
        with open(DATABASE_FILE_PATH, "rb") as f:
            content = f.read()
            
        filename = os.path.basename(DATABASE_FILE_PATH)
        return Response(
            content=content,
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Cache-Control": "no-cache"
            }
        )
    except Exception as e:
        logger.error(f"Error during backup download: {e}")
        raise HTTPException(status_code=500, detail="バックアップファイルの読み出し中にエラーが発生しました")

@router.get("/csv-template")
def get_csv_template(
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """
    CSVインポート用のテンプレートファイルを生成して返す。
    NINA_WEB_APPLY 形式 (プロジェクト情報 + タスク情報) に対応。
    """
    output = io.StringIO()
    # UTF-8 with BOM (Excel for Windows compatibility)
    output.write('\ufeff')
    writer = csv.writer(output)
    
    # プロジェクト情報セクション
    writer.writerow(["プロジェクト情報", "", "", "", "", "", "", "", ""])
    writer.writerow(["プロジェクト名", "開始日", "終了日", "説明", "", "", "", "", ""])
    writer.writerow(["サンプルプロジェクト", "2026/04/01", "2026/05/31", "プロジェクトの説明をここに記載します", "", "", "", "", ""])
    writer.writerow(["", "", "", "", "", "", "", "", ""])
    
    # タスク情報セクション
    writer.writerow(["タスク情報", "", "", "", "", "", "", "", ""])
    writer.writerow(["タスク名", "期日", "説明", "担当者", "コスト", "タイプ(推奨:animation,layout,comp,fx,lighting,asset,programming,design,testing,documentation,shoot,gs,report,other)", "seqID", "shotID", "依存タスク(複数ある場合はカンマ区切り)"])
    writer.writerow(["タスク1", "2026/04/15", "タスクの詳細内容", "username", "16", "design", "SEQ001", "SHOT001", ""])
    writer.writerow(["タスク2", "2026/04/20", "土日を考慮した開始日逆算が行われます", "username", "8", "programming", "SEQ001", "SHOT002", "タスク1"])
    writer.writerow(["タスク3", "2026/04/25", "複数の依存関係を設定可能", "username", "24", "testing", "SEQ001", "SHOT003", "タスク1, タスク2"])
    
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=project_task_template.csv"}
    )

TABLE_MODEL_MAP = {
    "users": models.User,
    "projects": models.Project,
    "tasks": models.Task,
    "task_status_history": models.TaskStatusHistory,
    "events": models.Event,
    "groups": models.Group,
    "user_groups": models.UserGroup,
    "notes": models.Note,
    "chat_messages": models.ChatMessage,
    "user_activities": models.UserActivity,
    "user_google_tokens": models.UserGoogleToken,
    "task_google_sync": models.TaskGoogleSync,
    "project_google_sync": models.ProjectGoogleSync,
    "event_google_sync": models.EventGoogleSync,
    "meetings": models.Meeting,
    "decisions": models.Decision,
    "meeting_tasks": models.MeetingTask,
    "knowledge_items": models.KnowledgeItem,
    "knowledge_tags": models.KnowledgeTag,
    "shots": models.Shot,
    "score_user_roles": models.ScoreUserRole,
    "retakes": models.Retake,
    "retake_timecodes": models.RetakeTimecode,
    "change_requests": models.ChangeRequest,
    "troubles": models.Trouble,
    "look_distributions": models.LookDistribution,
    "user_messages": models.UserMessage,
    "notifications": models.Notification,
    "timecards": models.Timecard,
    "routines": models.Routine,
    "assets": models.Asset,
    "deliveries": models.Delivery,
    "direct_messages": models.DirectMessage,
    "group_direct_messages": models.GroupDirectMessage,
}

def serialize_model(obj) -> Dict[str, Any]:
    if obj is None:
        return {}
    row_dict = {}
    for column in obj.__table__.columns:
        val = getattr(obj, column.name)
        if isinstance(val, datetime):
            row_dict[column.name] = val.isoformat()
        elif isinstance(val, enum.Enum):
            row_dict[column.name] = val.value
        else:
            row_dict[column.name] = val
    return row_dict

def deserialize_model_data(model, data_list):
    if not data_list:
        return []
    
    datetime_cols = []
    enum_cols = {}
    for col in model.__table__.columns:
        if isinstance(col.type, DateTime) or (hasattr(col.type, "impl") and isinstance(col.type.impl, DateTime)):
            datetime_cols.append(col.name)
        elif isinstance(col.type, Enum):
            enum_cols[col.name] = col.type.enum_class
            
    processed_list = []
    for item in data_list:
        processed_item = {}
        for k, v in item.items():
            if k not in model.__table__.columns:
                continue
            if v is None:
                processed_item[k] = None
            elif k in datetime_cols:
                try:
                    processed_item[k] = datetime.fromisoformat(v)
                except Exception:
                    processed_item[k] = v
            elif k in enum_cols:
                try:
                    processed_item[k] = enum_cols[k](v)
                except Exception:
                    processed_item[k] = v
            else:
                processed_item[k] = v
        processed_list.append(processed_item)
    return processed_list

def _get_all_database_data(db: Session) -> Dict[str, Any]:
    """全データベーステーブルの情報を辞書形式でダンプするヘルパー"""
    export_data = {}
    for table_key, model in TABLE_MODEL_MAP.items():
        rows = db.query(model).all()
        export_data[table_key] = [serialize_model(row) for row in rows]
    return export_data

def _decode_csv_content(content: bytes) -> str:
    """CSVのバイト列をBOM対応およびUTF-8 / Shift-JIS自動判別でデコードするヘルパー"""
    if content.startswith(b'\xef\xbb\xbf'):
        content = content[3:]
    
    # 1. Clean UTF-8
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        pass
        
    # 2. Clean CP932 (Windows-Japanese extension of Shift-JIS)
    try:
        return content.decode("cp932")
    except UnicodeDecodeError:
        pass

    # 3. Clean Shift-JIS
    try:
        return content.decode("shift-jis")
    except UnicodeDecodeError:
        pass

    # 4. Robust Fallback: Decode with CP932 replacing invalid characters to prevent crash
    try:
        return content.decode("cp932", errors="replace")
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSVファイルの文字コードが読み取れません (UTF-8 または Shift-JIS を使用してください)"
        )


def _find_user_by_identifier(db: Session, identifier: str) -> Optional[int]:
    """識別子 (username, full_name, name, email) からユーザーIDを検索するヘルパー"""
    if not identifier:
        return None
    # "/" や "," で区切られている可能性も考慮
    clean_id = identifier.split("/")[0].split(",")[0].strip()
    
    # username -> full_name -> name -> email の順で検索
    u = db.query(models.User).filter(
        or_(
            models.User.username == clean_id,
            models.User.full_name == clean_id,
            models.User.name == clean_id,
            models.User.email == clean_id
        )
    ).first()
    return u.id if u else None

def _parse_csv_date(date_str: str) -> Optional[datetime]:
    """多様な日付フォーマットをパースするヘルパー"""
    if not date_str or not date_str.strip():
        return None
    date_str = date_str.strip()
    for fmt in ("%Y/%m/%d", "%Y-%m-%d", "%Y.%m.%d", "%Y/%n/%d"):
        try:
            return datetime.strptime(date_str, fmt)
        except Exception:
            continue
    return None


@router.get("/database/export-json")
def export_all_database_json(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """データベースの全19テーブルの情報を丸ごとJSON形式のファイルとしてエクスポートする"""
    export_data = _get_all_database_data(db)
    
    filename = f"database_full_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    content = json.dumps(export_data, ensure_ascii=False, indent=2)
    return Response(
        content=content,
        media_type="application/json",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Cache-Control": "no-cache"
        }
    )

@router.post("/database/import-json")
def import_all_database_json(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """JSON形式の全データベース情報を受け取り、データベースを丸ごと復元する"""
    logger.warning(f"Admin {current_user.email} is importing a full JSON database backup.")
    
    try:
        # foreign key checksを一時的に無効化
        db.execute(text("PRAGMA foreign_keys = OFF"))
        
        # 全テーブルの既存データを削除
        for table_key, model in TABLE_MODEL_MAP.items():
            db.execute(text(f"DELETE FROM {model.__tablename__}"))
        
        # 新しいデータを復元
        counts = {}
        for table_key, model in TABLE_MODEL_MAP.items():
            if table_key in data and isinstance(data[table_key], list):
                records = data[table_key]
                if not records:
                    counts[table_key] = 0
                    continue
                
                processed_records = deserialize_model_data(model, records)
                
                if processed_records:
                    db.execute(insert(model), processed_records)
                    counts[table_key] = len(processed_records)
                else:
                    counts[table_key] = 0
            else:
                counts[table_key] = 0
                
        db.commit()
        return {
            "message": "データベースの丸ごと復元が完了しました",
            "imported_records": counts
        }
    except Exception as e:
        db.rollback()
        logger.error(f"Full JSON import failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"インポート復元処理中にエラーが発生しました: {str(e)}"
        )
    finally:
        # foreign key checksを再有効化
        try:
            db.execute(text("PRAGMA foreign_keys = ON"))
        except:
            pass

@router.get("/database/query")
def query_database(
    table: Optional[str] = None,
    username: Optional[str] = None,
    email: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """
    外部CLIやスクリプトから、データベースを柔軟にクエリするためのAPI。
    - table: 特定のテーブルキー名 (users, projects, tasks, notes, chat_messages, user_activities など)
    - username: ユーザーの name または username で絞り込む場合
    - email: ユーザーの email で絞り込む場合
    """
    target_user = None
    if email or username:
        user_query = db.query(models.User)
        if email:
            # crud.get_user_by_email 経由で email 正規化（大文字小文字/空白）を統一
            target_user = crud.get_user_by_email(db, email=email)
        elif username:
            target_user = user_query.filter(
                or_(
                    models.User.name == username,
                    models.User.username == username
                )
            ).first()
            
        if not target_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"指定されたユーザー (email={email}, username={username}) が見つかりません。"
            )

    # 1. 特定のテーブル名が指定されている場合
    if table:
        if table not in TABLE_MODEL_MAP:
            valid_keys = ", ".join(TABLE_MODEL_MAP.keys())
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"無効なテーブル名です。指定可能なテーブル名: {valid_keys}"
            )
            
        model = TABLE_MODEL_MAP[table]
        query = db.query(model)
        
        # ユーザーによる絞り込みの適用
        if target_user:
            if table == "users":
                query = query.filter(models.User.id == target_user.id)
            elif table == "tasks":
                query = query.filter(models.Task.assigned_to == target_user.id)
            elif table == "notes":
                query = query.filter(models.Note.created_by == target_user.id)
            elif table == "chat_messages":
                query = query.filter(models.ChatMessage.user_id == target_user.id)
            elif table == "user_activities":
                query = query.filter(models.UserActivity.user_id == target_user.id)
            elif table == "user_groups":
                query = query.filter(models.UserGroup.user_id == target_user.id)
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"テーブル '{table}' はユーザーによる絞り込みに対応していません。"
                )
                
        rows = query.all()
        return {table: [serialize_model(row) for row in rows]}

    # 2. テーブル未指定で、ユーザー絞り込みがある場合 (ユーザー詳細、関連タスク、関連メモなどを一括返却)
    if target_user:
        return {
            "user": serialize_model(target_user),
            "tasks": [serialize_model(t) for t in db.query(models.Task).filter(models.Task.assigned_to == target_user.id).all()],
            "notes": [serialize_model(n) for n in db.query(models.Note).filter(models.Note.created_by == target_user.id).all()],
            "activities": [serialize_model(a) for a in db.query(models.UserActivity).filter(models.UserActivity.user_id == target_user.id).all()]
        }

    # 3. どちらも指定がない場合は全テーブルの丸ごとデータを取得
    return _get_all_database_data(db)

@router.get("/backup")
def backup_json_data(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """全データをJSON形式でバックアップとして取得"""
    # データベースの全19テーブルの情報を丸ごとJSON辞書として返却する
    return _get_all_database_data(db)
@router.get("/full-backup/download")
async def download_full_backup(
    token: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    データベースファイル一式とナレッジベース（RAGインデックス）をZIPにまとめてダウンロード。
    """
    # 1. トークン認証
    is_valid = False
    if token and token in download_tokens:
        if datetime.now() < download_tokens[token]:
            is_valid = True
    
    if not is_valid:
        raise HTTPException(status_code=401, detail="有効なダウンロードトークンが必要です。再度ボタンを押してください。")

    # 一時的なZIPファイルを作成
    temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    temp_zip_path = temp_zip.name
    temp_zip.close()

    try:
        # DBのチェックポイントを走らせてWALを反映させる試み（必須ではないが望ましい）
        try:
            db.execute(text("PRAGMA wal_checkpoint(FULL)"))
        except:
            pass

        with zipfile.ZipFile(temp_zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            write_backup_data_to_zip(zf)

        # ZIPファイルをレスポンスとして返す
        def iterfile():
            with open(temp_zip_path, mode="rb") as f:
                yield from f
            # 送信完了後に一時ファイルを削除
            try:
                os.unlink(temp_zip_path)
            except:
                pass

        filename = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
        return StreamingResponse(
            iterfile(),
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    except Exception as e:
        logger.error(f"Full backup creation failed: {e}")
        if os.path.exists(temp_zip_path):
            os.unlink(temp_zip_path)
        raise HTTPException(status_code=500, detail=f"バックアップ作成中にエラーが発生しました: {str(e)}")
