import logging
import os
import json
import csv
import io
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import text

from .. import crud, models, schemas, security
from ..database import get_db, DATABASE_FILE_PATH
from fastapi.responses import FileResponse, Response

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["Admin"])

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
    from sqlalchemy import or_
    from ..timezone import now_jst_naive

    content = await file.read()
    # Handle BOM (Byte Order Mark)
    if content.startswith(b'\xef\xbb\xbf'):
        content = content[3:]
    
    try:
        decoded = content.decode("utf-8")
    except UnicodeDecodeError:
        # Fallback to Shift-JIS if UTF-8 fails (for old Excel Japanese CSV)
        try:
            decoded = content.decode("shift-jis")
        except:
            raise HTTPException(status_code=400, detail="CSVファイルの文字コードが読み取れません (UTF-8 または Shift-JIS を使用してください)")

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

    def find_user_id(identifier: str) -> Optional[int]:
        if not identifier: return None
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

    # --- Helper: Parse Date ---
    def parse_csv_date(date_str: str) -> Optional[datetime]:
        if not date_str or not date_str.strip(): return None
        date_str = date_str.strip()
        for fmt in ("%Y/%m/%d", "%Y-%m-%d", "%Y/%n/%d"):
            try: return datetime.strptime(date_str, fmt)
            except: continue
        return None

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
            
            start_date = parse_csv_date(row[1]) if len(row) > 1 else None
            end_date = parse_csv_date(row[2]) if len(row) > 2 else None
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
            
            due_date = parse_csv_date(row[1]) if len(row) > 1 else None
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
            
            user_id = find_user_id(assignee)
            
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

@router.get("/backup-db")
def backup_db_file(
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """データベースファイル (.db) を直接ダウンロード"""
    if not DATABASE_FILE_PATH.exists():
        logger.error(f"Database file not found at {DATABASE_FILE_PATH}")
        raise HTTPException(status_code=404, detail="データベースファイルが見つかりません")
    
    return FileResponse(
        path=str(DATABASE_FILE_PATH),
        filename=os.path.basename(DATABASE_FILE_PATH),
        media_type="application/octet-stream"
    )

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
    writer.writerow(["タスク名", "期日", "説明", "担当者", "コスト", "タイプ(推奨:development,design,documentation,testing,review,meeting,fx,asset,animation,lighting,comp)", "seqID", "shotID", "依存タスク(複数ある場合はカンマ区切り)"])
    writer.writerow(["タスク1", "2026/04/15", "タスクの詳細内容", "username", "16", "design", "SEQ001", "SHOT001", ""])
    writer.writerow(["タスク2", "2026/04/20", "土日を考慮した開始日逆算が行われます", "username", "8", "development", "SEQ001", "SHOT002", "タスク1"])
    writer.writerow(["タスク3", "2026/04/25", "複数の依存関係を設定可能", "username", "24", "testing", "SEQ001", "SHOT003", "タスク1, タスク2"])
    
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=project_task_template.csv"}
    )

@router.get("/backup")
def backup_json_data(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """全データをJSON形式でバックアップとして取得"""
    # エクスポートロジックを流用（または共通化）
    return export_mock_data(db=db, current_user=current_user)
