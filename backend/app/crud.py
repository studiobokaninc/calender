from sqlalchemy.orm import Session
from datetime import datetime, timedelta, date
import math
from .timezone import now_jst_naive
from typing import List, Optional
from sqlalchemy.orm import selectinload
from sqlalchemy import func, or_
import logging
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

from . import models
from . import schemas # Pydantic モデルのインポート元を変更
from .security import pwd_context # security.py から pwd_context をインポート

# --- Helper Functions ---

def _parse_datetime(date_val: str | datetime | None) -> datetime | None:
    """日付文字列またはdatetimeオブジェクトをdatetimeオブジェクトに変換"""
    logger.debug("[_parse_datetime] Received date value: %r", date_val)
    if date_val is None or date_val == '':
        logger.debug("[_parse_datetime] Input is None or empty string, returning None.")
        return None
    if isinstance(date_val, datetime):
        logger.debug("[_parse_datetime] Input is already datetime, returning as is.")
        return date_val
    if not isinstance(date_val, str):
        logger.debug("[_parse_datetime] Input is not a string or datetime: %s. Returning None.", type(date_val))
        return None
    try:
        # YYYY-MM-DD形式の文字列をdatetimeに変換
        parsed_dt = datetime.fromisoformat(date_val.replace('Z', '+00:00'))
        logger.debug("[_parse_datetime] Parsed successfully: %s", parsed_dt)
        return parsed_dt
    except (ValueError, TypeError) as e:
        logger.debug("[_parse_datetime] Failed to parse date string '%s'. Error: %s", date_val, e)
        return None

def _parse_int_safe(value: str | None) -> int | None:
    """文字列を安全に整数に変換。失敗したら None を返す"""
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        print(f"Warning: Could not parse string to int: {value}")
        return None

def _check_and_update_overdue_task(db: Session, db_task: models.Task) -> bool:
    """期日を過ぎたタスクのステータスをdelayedに更新する。更新した場合Trueを返す。"""
    if db_task.due_date is None:
        return False
    
    # 期日が設定されている場合、現在時刻と比較
    now = now_jst_naive()
    # 期日を日付のみで比較（時刻を無視）
    due_date_only = db_task.due_date.replace(hour=0, minute=0, second=0, microsecond=0)
    now_date_only = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    # 期日を過ぎていて、かつステータスがcompleted以外の場合
    if due_date_only < now_date_only and db_task.status != models.TaskStatus.COMPLETED:
        # 既にdelayedでない場合のみ更新
        if db_task.status != models.TaskStatus.DELAYED:
            original_status = db_task.status
            db_task.status = models.TaskStatus.DELAYED
            db_task.updated_at = now
            
            # ステータス履歴を記録
            status_history_entry = models.TaskStatusHistory(
                task_id=db_task.id,
                status=models.TaskStatus.DELAYED,
                changed_at=now,
                changed_by=db_task.assigned_to
            )
            db.add(status_history_entry)
            db.commit()
            db.refresh(db_task)
            logger.info(f"タスク {db_task.id} のステータスを {original_status} から DELAYED に自動更新しました（期日超過）")
            return True
    return False

# --- User CRUD ---

def get_user(db: Session, user_id: int) -> models.User | None:
    """ID でユーザーを取得"""
    return db.query(models.User).filter(models.User.id == user_id).first()

def get_user_by_email(db: Session, email: str) -> models.User | None:
    """Email でユーザーを取得"""
    return db.query(models.User).filter(models.User.email == email).first()

def get_users(db: Session, skip: int = 0, limit: int = 100) -> list[models.User]:
    """ユーザーリストを取得 (ページネーション対応)"""
    return db.query(models.User).offset(skip).limit(limit).all()

def create_user(db: Session, user: schemas.UserCreate) -> models.User:
    """新規ユーザーを作成"""
    hashed_password = pwd_context.hash(user.password)
    print(f"[DEBUG crud.create_user] Received user.name: {repr(user.name)}")
    db_user = models.User(
        email=user.email,
        username=user.username,
        name=user.name,
        hashed_password=hashed_password,
        role=user.role,
        base_load_hours_per_week=getattr(user, 'base_load_hours_per_week', None) or 0.0,
        created_at=now_jst_naive(),
        updated_at=now_jst_naive()
    )
    db.add(db_user)
    db.commit()
    print(f"[DEBUG crud.create_user] After commit, db_user.name: {repr(db_user.name)}")
    db.refresh(db_user)
    return db_user

def update_user(db: Session, db_user: models.User, user_in: schemas.UserUpdate) -> models.User:
    """ユーザー情報を更新"""
    update_data = user_in.dict(exclude_unset=True)
    
    if "password" in update_data and update_data["password"]:
        hashed_password = pwd_context.hash(update_data["password"])
        db_user.hashed_password = hashed_password
    if "full_name" in update_data:
         db_user.name = update_data["full_name"]
    if "email" in update_data:
        db_user.email = update_data["email"]
    if "role" in update_data:
        db_user.role = update_data["role"]
    if "base_load_hours_per_week" in update_data:
        db_user.base_load_hours_per_week = update_data["base_load_hours_per_week"] or 0.0
    db_user.updated_at = now_jst_naive()
    
    db.commit()
    db.refresh(db_user)
    return db_user

def delete_user(db: Session, db_user: models.User) -> models.User:
    """ユーザーを削除"""
    db.delete(db_user)
    db.commit()
    return db_user

# --- Project CRUD ---

def get_project(db: Session, project_id: int) -> models.Project | None:
    """ID でプロジェクトを取得"""
    return db.query(models.Project).filter(models.Project.id == project_id).first()

def get_projects(db: Session, skip: int = 0, limit: int = 100, display_status_in: Optional[List[str]] = None) -> list[models.Project]:
    """プロジェクトリストを取得 (ページネーション対応、表示ステータスでのフィルタリング対応)"""
    query = db.query(models.Project)
    if display_status_in is not None and display_status_in:
        query = query.filter(models.Project.display_status.in_(display_status_in))
    return query.offset(skip).limit(limit).all()

def create_project(db: Session, project: schemas.ProjectCreate) -> models.Project:
    """新規プロジェクトを作成"""
    db_project = models.Project(
        name=project.name,
        description=project.description,
        status=project.status,
        display_status=project.display_status,
        start_date=_parse_datetime(project.start_date),
        end_date=_parse_datetime(project.end_date),
        color=project.color,
    )
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project

def update_project(db: Session, db_project: models.Project, project_in: schemas.ProjectUpdate) -> models.Project: # 型ヒント修正
    """プロジェクト情報を更新"""
    update_data = project_in.dict(exclude_unset=True)
    
    for key, value in update_data.items():
        db_key = key
        parsed_value = value
        if key == "startDate":
            db_key = "start_date"
            parsed_value = _parse_datetime(value)
        elif key == "endDate":
            db_key = "end_date"
            parsed_value = _parse_datetime(value)
        elif key == "display_status" and value not in ['online', 'offline', 'archived']:
            continue

        if hasattr(db_project, db_key):
            setattr(db_project, db_key, parsed_value)
            
    db.commit()
    db.refresh(db_project)
    return db_project

def delete_project(db: Session, db_project: models.Project) -> models.Project:
    """プロジェクトを削除"""
    db.delete(db_project)
    db.commit()
    return db_project

def get_project_by_name(db: Session, name: str) -> Optional[models.Project]:
    """プロジェクト名からプロジェクトを取得"""
    return db.query(models.Project).filter(models.Project.name == name).first()


def complete_tasks_for_project(db: Session, project_id: int) -> int:
    """プロジェクトに属する未完了タスクをすべて完了にする。完了にしたタスク数を返す。"""
    tasks_to_complete = db.query(models.Task).filter(
        models.Task.project_id == project_id,
        models.Task.status != models.TaskStatus.COMPLETED,
    ).all()
    now = now_jst_naive()
    for task in tasks_to_complete:
        task.status = models.TaskStatus.COMPLETED
        task.updated_at = now
        db.add(models.TaskStatusHistory(
            task_id=task.id,
            status=models.TaskStatus.COMPLETED,
            changed_at=now,
            changed_by=task.assigned_to,
        ))
    if tasks_to_complete:
        db.commit()
    return len(tasks_to_complete)


# --- Task CRUD ---

def auto_update_tasks_start_date_to_in_progress(db: Session) -> None:
    """開始日を迎えた「未着手」タスクのステータスを「進行中」に更新する。未着手のみ更新（完了・進行中・レビュー中・遅延は触らない）。"""
    now = now_jst_naive()
    now_date = now.date()
    candidates = db.query(models.Task).filter(
        models.Task.start_date.isnot(None),
        models.Task.status == models.TaskStatus.TODO,
    ).all()
    updated = 0
    for db_task in candidates:
        if not db_task.start_date:
            continue
        start_date_val = db_task.start_date.date() if hasattr(db_task.start_date, 'date') else db_task.start_date
        if start_date_val > now_date:
            continue
        db_task.status = models.TaskStatus.IN_PROGRESS
        db_task.updated_at = now
        db.add(models.TaskStatusHistory(
            task_id=db_task.id,
            status=models.TaskStatus.IN_PROGRESS,
            changed_at=now,
            changed_by=db_task.assigned_to,
        ))
        logger.info(f"タスク {db_task.id} のステータスを TODO から IN_PROGRESS に自動更新しました（開始日到達）")
        updated += 1
    if updated:
        db.commit()


def get_task(db: Session, task_id: int) -> models.Task | None:
    """ID でタスクを取得"""
    db_task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if db_task:
        _check_and_update_overdue_task(db, db_task)
    return db_task

def get_tasks(db: Session, project_id: int | None = None, skip: int = 0, limit: int = 10000, display_status_in: Optional[List[str]] = None) -> list[dict]:
    """タスクリストを取得 (プロジェクトIDでのフィルタ、ページネーション対応、表示ステータスでのフィルタリング対応)"""
    try:
        # 開始日を迎えた未着手タスクを進行中に自動更新（1回の取得につき1回だけ実行）
        auto_update_tasks_start_date_to_in_progress(db)

        # SQLAlchemyを使わず、直接SQL文でデータ取得（Enum検証を回避）
        from sqlalchemy import text

        query_parts = ["SELECT * FROM tasks"]
        conditions = []
        params = {}
        
        if project_id is not None:
            conditions.append("project_id = :project_id")
            params["project_id"] = project_id
        
        if display_status_in is not None and display_status_in:
            placeholders = ','.join([f":status{i}" for i in range(len(display_status_in))])
            conditions.append(f"display_status IN ({placeholders})")
            for i, status in enumerate(display_status_in):
                params[f"status{i}"] = status
        
        if conditions:
            query_parts.append("WHERE " + " AND ".join(conditions))
        
        query_parts.append(f"LIMIT :limit OFFSET :skip")
        params["limit"] = limit
        params["skip"] = skip
        
        query_str = " ".join(query_parts)
        result = db.execute(text(query_str), params)
        rows = result.fetchall()
        
        # 期日を過ぎたタスクをチェックして更新（一括処理）
        task_ids = [row.id for row in rows]
        if task_ids:
            # 期日が設定されていて、completed以外のタスクを取得
            overdue_tasks = db.query(models.Task).filter(
                models.Task.id.in_(task_ids),
                models.Task.due_date.isnot(None),
                models.Task.status != models.TaskStatus.COMPLETED,
                models.Task.status != models.TaskStatus.DELAYED
            ).all()
            
            now = now_jst_naive()
            now_date_only = now.replace(hour=0, minute=0, second=0, microsecond=0)
            
            for db_task in overdue_tasks:
                due_date_only = db_task.due_date.replace(hour=0, minute=0, second=0, microsecond=0)
                if due_date_only < now_date_only:
                    original_status = db_task.status
                    db_task.status = models.TaskStatus.DELAYED
                    db_task.updated_at = now
                    
                    # ステータス履歴を記録
                    status_history_entry = models.TaskStatusHistory(
                        task_id=db_task.id,
                        status=models.TaskStatus.DELAYED,
                        changed_at=now,
                        changed_by=db_task.assigned_to
                    )
                    db.add(status_history_entry)
                    logger.info(f"タスク {db_task.id} のステータスを {original_status} から DELAYED に自動更新しました（期日超過）")
            
            if overdue_tasks:
                db.commit()
                # 更新されたタスクのステータスを反映するため、再度取得
                for db_task in overdue_tasks:
                    db.refresh(db_task)
        
        # タスクを辞書に変換
        task_dicts = []
        for row in rows:
            # 日付フィールドの安全な処理（文字列の場合も対応）
            def safe_date_format(date_value):
                if date_value is None:
                    return None
                if isinstance(date_value, str):
                    return date_value  # 既に文字列の場合はそのまま返す
                if hasattr(date_value, 'isoformat'):
                    return date_value.isoformat()
                return str(date_value)
            
            # typeはどんな値でも許容（検証なし）
            task_type = row.type
            
            # priorityの安全な処理
            try:
                priority_value = row.priority if row.priority and row.priority != '' else None
            except:
                priority_value = None
            
            # statusの安全な処理（大文字を小文字に変換）
            try:
                if hasattr(row, 'status') and row.status:
                    # ステータス値のマッピング（大文字→小文字、アンダースコア→ハイフン）
                    status_mapping = {
                        'TODO': 'todo',
                        'IN_PROGRESS': 'in-progress',
                        'REVIEW': 'review',
                        'COMPLETED': 'completed',
                        'DELAYED': 'delayed',
                        'todo': 'todo',
                        'in-progress': 'in-progress',
                        'review': 'review',
                        'completed': 'completed',
                        'delayed': 'delayed'
                    }
                    task_status = status_mapping.get(row.status, row.status.lower().replace('_', '-'))
                else:
                    task_status = 'todo'
            except Exception as e:
                logger.warning(f"タスク {row.id} のstatusの処理に失敗: {str(e)}")
                task_status = 'todo'
            
            # dependsOnの安全な処理
            try:
                depends_on = row.dependsOn if row.dependsOn else []
                if not isinstance(depends_on, list):
                    if isinstance(depends_on, str):
                        import json
                        try:
                            depends_on = json.loads(depends_on)
                        except:
                            depends_on = [depends_on] if depends_on else []
                    else:
                        depends_on = []
            except:
                depends_on = []
            
            task_dict = {
                'id': row.id,
                'project_id': row.project_id,
                'name': row.name,
                'description': row.description,
                'assigned_to': row.assigned_to,
                'due_date': safe_date_format(row.due_date),
                'status': task_status,
                'priority': priority_value,
                'type': task_type,  # 無効な値もそのまま保持
                'start_date': safe_date_format(row.start_date),
                'progress': row.progress if hasattr(row, 'progress') else 0,
                'cost': row.cost if hasattr(row, 'cost') else 0,
                'dependsOn': depends_on,
                'shotID': row.shotID if hasattr(row, 'shotID') else None,
                'seqID': row.seqID if hasattr(row, 'seqID') else None,
                'created_at': safe_date_format(row.created_at),
                'display_status': row.display_status if hasattr(row, 'display_status') else 'offline',
                'updated_at': safe_date_format(row.updated_at),
                'status_history': []
            }
            
            # ステータス履歴を取得して辞書に変換
            try:
                history_entries = db.query(models.TaskStatusHistory).filter(
                    models.TaskStatusHistory.task_id == row.id
                ).order_by(models.TaskStatusHistory.changed_at).all()
                
                task_dict['status_history'] = [
                    {
                        'id': entry.id,
                        'task_id': entry.task_id,
                        'status': entry.status,
                        'timestamp': entry.changed_at.isoformat() if entry.changed_at else None,
                        'changed_at': entry.changed_at.isoformat() if entry.changed_at else None,
                        'changed_by': entry.changed_by
                    }
                    for entry in history_entries
                ]
            except Exception as e:
                logger.warning(f"タスク ID {row.id} のステータス履歴取得に失敗: {str(e)}")
                task_dict['status_history'] = []
            
            task_dicts.append(task_dict)
        
        return task_dicts
    except Exception as e:
        logger.error(f"タスクの取得に失敗: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"タスクの取得に失敗しました: {str(e)}"
        )

def create_task(db: Session, task: schemas.TaskCreate) -> models.Task:
    """新規タスクを作成"""
    task_start_date = task.start_date
    if task_start_date is None:
        task_start_date = task.due_date

    db_task = models.Task(
        name=task.name,
        description=task.description,
        project_id=task.project_id,
        assigned_to=task.assigned_to,
        status=task.status,
        display_status=task.display_status,
        priority=task.priority,
        start_date=task_start_date,
        due_date=task.due_date,
        cost=task.cost,
        dependsOn=task.dependsOn,
        shotID=task.shotID,
        seqID=task.seqID,
        type=task.type,
        created_at=now_jst_naive(),
        updated_at=now_jst_naive()
    )
    db.add(db_task)
    db.commit()
    db.refresh(db_task)

    if db_task.status is not None:
        initial_history = models.TaskStatusHistory(
            task_id=db_task.id,
            status=db_task.status,
            changed_at=db_task.created_at or now_jst_naive(),
            changed_by=task.assigned_to  # タスクの担当者を設定
        )
        db.add(initial_history)
        db.commit()

    return db_task

def update_task(db: Session, db_task: models.Task, task_in: schemas.TaskUpdate) -> models.Task:
    """タスク情報を更新"""
    update_data = task_in.dict(exclude_unset=True)
    original_status = db_task.status

    for key, value in update_data.items():
        db_key = key
        parsed_value = value
        if key == "title": db_key = "name"
        elif key == "taskStatus": db_key = "status"
        elif key == "taskCost": db_key = "cost"
        elif key == "projectId":
            db_key = "project_id"
            parsed_value = _parse_int_safe(value)
            if parsed_value is None and value is not None: continue
        elif key == "taskAssigneeId":
            db_key = "assigned_to"
            parsed_value = _parse_int_safe(value)
            if parsed_value is None and value is not None: continue
        elif key == "taskStartDate":
            db_key = "start_date"
            parsed_value = _parse_datetime(value)
        elif key == "taskDueDate":
            db_key = "due_date"
            parsed_value = _parse_datetime(value)
        elif key == "display_status" and value not in ['online', 'offline', 'archived']:
            continue
        elif key == "priority" and value not in ['low', 'medium', 'high', None]:
            continue
        # typeは任意の文字列を許容するため、検証を削除

        if hasattr(db_task, db_key):
            setattr(db_task, db_key, parsed_value)

    db_task.updated_at = now_jst_naive()

    new_status = db_task.status
    if new_status is not None and new_status != original_status:
        status_history_entry = models.TaskStatusHistory(
            task_id=db_task.id,
            status=new_status,
            changed_at=db_task.updated_at,
            changed_by=db_task.assigned_to  # タスクの担当者を設定
        )
        db.add(status_history_entry)

    db.commit()
    db.refresh(db_task)
    
    # 期日を過ぎたタスクのステータスをチェックして更新
    _check_and_update_overdue_task(db, db_task)
    return db_task


def bulk_update_tasks(db: Session, task_ids: List[int], updates: dict) -> int:
    """複数タスクに同じ更新を適用。更新したタスク数を返す。"""
    updated = 0
    for task_id in task_ids:
        db_task = get_task(db=db, task_id=task_id)
        if db_task is None:
            continue
        task_in = schemas.TaskUpdate(**updates)
        update_task(db=db, db_task=db_task, task_in=task_in)
        updated += 1
    return updated


def delete_task(db: Session, db_task: models.Task) -> models.Task:
    """タスクを削除"""
    db.delete(db_task)
    db.commit()
    return db_task

def get_task_by_name(db: Session, name: str) -> Optional[models.Task]:
    """タスク名からタスクを取得"""
    return db.query(models.Task).filter(models.Task.name == name).first()

# --- Event CRUD ---

def get_event(db: Session, event_id: int) -> models.Event | None:
    """ID でイベントを取得"""
    return db.query(models.Event).filter(models.Event.id == event_id).first()

def get_events(
    db: Session, 
    skip: int = 0, 
    limit: int = 100, 
    status: str | None = None,
    project_id: int | None = None
) -> list[models.Event]:
    """イベントリストを取得 (ステータス・プロジェクトIDフィルタ、ページネーション対応)"""
    print(f"[crud.get_events] Called with: status={status}, project_id={project_id}, skip={skip}, limit={limit}")
    query = db.query(models.Event)
    if status is not None:
        print(f"[crud.get_events] Filtering by status: {status}")
        query = query.filter(models.Event.status == status)
    if project_id is not None:
        print(f"[crud.get_events] Filtering by project_id: {project_id}")
        query = query.filter(models.Event.project_id == project_id)
    
    db_events = query.offset(skip).limit(limit).all()
    print(f"[crud.get_events] Query returned {len(db_events)} events.")
    # print(f"[crud.get_events] First few events from DB: {db_events[:3]}") # 内容も確認する場合
    return db_events


def search_projects(db: Session, q: str, limit: int = 10) -> List[models.Project]:
    """検索文字列でプロジェクトを検索（name, description）"""
    if not q or len(q.strip()) == 0:
        return []
    term = f"%{q.strip()}%"
    return (
        db.query(models.Project)
        .filter(
            or_(
                models.Project.name.ilike(term),
                (models.Project.description or "").ilike(term),
            )
        )
        .limit(limit)
        .all()
    )


def search_tasks(db: Session, q: str, limit: int = 10) -> List[models.Task]:
    """検索文字列でタスクを検索（name, description）"""
    if not q or len(q.strip()) == 0:
        return []
    term = f"%{q.strip()}%"
    return (
        db.query(models.Task)
        .filter(
            or_(
                models.Task.name.ilike(term),
                (models.Task.description or "").ilike(term),
            )
        )
        .limit(limit)
        .all()
    )


def search_events(db: Session, q: str, limit: int = 10) -> List[models.Event]:
    """検索文字列でイベントを検索（title, description）"""
    if not q or len(q.strip()) == 0:
        return []
    term = f"%{q.strip()}%"
    return (
        db.query(models.Event)
        .filter(
            or_(
                models.Event.title.ilike(term),
                (models.Event.description or "").ilike(term),
            )
        )
        .limit(limit)
        .all()
    )


def get_labor_report(
    db: Session,
    group_by: str,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    include_offline: bool = False,
    include_completed: bool = False,
) -> List[dict]:
    """工数集計: group_by が 'user' のとき担当者別、'project' のときプロジェクト別。due_date で期間フィルタ可能。include_offlineがFalseの場合、オフラインのプロジェクトを除外。include_completedがFalseの場合、完了タスクを除外。"""
    from collections import defaultdict

    query = db.query(models.Task)
    if from_date is not None:
        query = query.filter(models.Task.due_date >= from_date)
    if to_date is not None:
        query = query.filter(models.Task.due_date <= to_date)
    
    # オフラインを含めない場合、オフラインのプロジェクトに属するタスクを除外
    if not include_offline:
        offline_project_ids = [
            p.id for p in db.query(models.Project).filter(models.Project.display_status == 'offline').all()
        ]
        if offline_project_ids:
            query = query.filter(~models.Task.project_id.in_(offline_project_ids))
    
    # 完了タスクを含めない場合、完了タスクを除外
    if not include_completed:
        query = query.filter(models.Task.status != models.TaskStatus.COMPLETED)
    
    tasks = query.all()

    groups: dict = defaultdict(lambda: {"total_cost": 0.0, "task_count": 0})
    for t in tasks:
        key = t.assigned_to if group_by == "user" else t.project_id
        key = key if key is not None else 0
        groups[key]["total_cost"] += float(t.cost or 0)
        groups[key]["task_count"] += 1

    result = []
    if group_by == "user":
        user_ids = [k for k in groups if k != 0]
        users_map = {}
        if user_ids:
            for u in db.query(models.User).filter(models.User.id.in_(user_ids)).all():
                users_map[u.id] = u.username or u.full_name or u.name or f"User {u.id}"
        for gid, data in sorted(groups.items(), key=lambda x: -x[1]["total_cost"]):
            name = users_map.get(gid, "未割り当て") if gid != 0 else "未割り当て"
            result.append({"group_id": gid, "group_name": name, "total_cost": round(data["total_cost"], 2), "task_count": data["task_count"]})
    else:
        project_ids = [k for k in groups if k != 0]
        projects_map = {}
        if project_ids:
            project_query = db.query(models.Project).filter(models.Project.id.in_(project_ids))
            # オフラインを含めない場合、オフラインのプロジェクトを除外
            if not include_offline:
                project_query = project_query.filter(models.Project.display_status != 'offline')
            for p in project_query.all():
                projects_map[p.id] = p.name or f"Project {p.id}"
        # オフラインを含めない場合、オフラインのプロジェクトのタスクを除外
        for gid, data in sorted(groups.items(), key=lambda x: -x[1]["total_cost"]):
            if gid == 0:
                name = "プロジェクトなし"
            elif gid in projects_map:
                name = projects_map[gid]
            else:
                # オフラインを含めない場合、プロジェクトが見つからない（オフライン）場合はスキップ
                if not include_offline:
                    continue
                name = f"Project {gid}"
            result.append({"group_id": gid, "group_name": name, "total_cost": round(data["total_cost"], 2), "task_count": data["task_count"]})
    return result


# 週次・日次工数・余裕時間（1日=8時間、週=5営業日=40時間）
# コスト/8＝タスク完了までのおおよその日数。開始日・期日は管理者が設定。依存タスクは依存先が完了/進捗するまで着手不可。
# 計算対象は未完了タスクのみ。基準日は「今日」で経過平日・経過労働時間・残りコストを算出。
HOURS_PER_DAY = 8
WORKING_DAYS_PER_WEEK = 5
MAX_HOURS_PER_WEEK = HOURS_PER_DAY * WORKING_DAYS_PER_WEEK  # 40


def _count_weekdays(start_d: date, end_d: date) -> int:
    """start_d から end_d まで（両端含む）の平日（月〜金）の日数を返す"""
    if start_d > end_d:
        return 0
    n = 0
    d = start_d
    while d <= end_d:
        if d.weekday() < 5:  # 0=月 .. 4=金
            n += 1
        d += timedelta(days=1)
    return n


def _parse_depends_on_ids(depends_on) -> List[int]:
    """dependsOn（JSONのリスト、要素はstrまたはint）をタスクIDのリストに変換"""
    if not depends_on or not isinstance(depends_on, list):
        return []
    ids = []
    for x in depends_on:
        try:
            ids.append(int(x))
        except (TypeError, ValueError):
            continue
    return ids


def _is_task_unblocked_on_date(task, d: date, tasks_by_id: dict, to_date) -> bool:
    """
    指定日 d の時点で、そのタスクに着手可能か。
    依存先がすべて「完了」または「期日が d 以前」（その日までに終わっている想定）なら True。
    """
    dep_ids = _parse_depends_on_ids(getattr(task, "dependsOn", None) or getattr(task, "depends_on", None))
    if not dep_ids:
        return True
    for dep_id in dep_ids:
        dep = tasks_by_id.get(dep_id)
        if dep is None:
            continue  # 参照先が無い場合はブロックしない
        status = getattr(dep, "status", None)
        if status == models.TaskStatus.COMPLETED or (str(status).lower() if status else "") == "completed":
            continue
        dep_due = to_date(getattr(dep, "due_date", None))
        if dep_due is not None and dep_due <= d:
            continue  # 期日が d 以前ならその日までに終わっているとみなす
        return False  # 未完了かつ期日が d より後 → ブロック
    return True


def _convert_cost_to_hours(cost_value) -> float:
    """
    コスト値を時間（float）に変換する。
    S/M/L形式の文字列の場合は標準時間に変換、数値の場合はそのまま返す。
    S=2h, M=8h, L=24h
    """
    if cost_value is None:
        return 0.0
    if isinstance(cost_value, str):
        cost_str = cost_value.strip().upper()
        if cost_str == 'S':
            return 2.0
        elif cost_str == 'M':
            return 8.0
        elif cost_str == 'L':
            return 24.0
        else:
            # 数値文字列の場合は変換を試みる
            try:
                return float(cost_value)
            except (ValueError, TypeError):
                return 0.0
    try:
        return float(cost_value)
    except (TypeError, ValueError):
        return 0.0


def _task_calendar_range(task, to_date):
    """タスクのカレンダー上の開始日・終了日（date）とコスト（時間）を返す。(task_start, task_end, cost) または (None, None, 0)"""
    cost_raw = getattr(task, "cost", None)
    cost = _convert_cost_to_hours(cost_raw)
    if cost <= 0:
        return None, None, 0
    start_d = to_date(getattr(task, "start_date", None))
    end_d = to_date(getattr(task, "due_date", None))
    if start_d is None and end_d is None:
        return None, None, 0
    if start_d is None:
        days_span = max(1, math.ceil(cost / HOURS_PER_DAY))
        task_start = end_d - timedelta(days=days_span - 1)
        task_end = end_d
    elif end_d is None:
        days_span = max(1, math.ceil(cost / HOURS_PER_DAY))
        task_start = start_d
        task_end = start_d + timedelta(days=days_span - 1)
    else:
        task_start = min(start_d, end_d)
        task_end = max(start_d, end_d)
    return task_start, task_end, cost


def get_weekly_workload(
    db: Session,
    week_start: date,
    reference_date: Optional[date] = None,
    include_offline: bool = False,
    include_completed: bool = False,
    consider_dependencies: bool = True,
) -> List[dict]:
    """
    指定週のユーザー別工数（時間）を計算する。計算対象は未完了タスクのみ。
    基準日（reference_date、省略時は今日）から見て、開始日からの経過平日・経過労働時間・残りコストを考慮。
    残りコストを「基準日以降の平日」に按分して割り当て。余裕時間 = 40 - 割り当て工数。
    """
    from collections import defaultdict

    if reference_date is None:
        reference_date = date.today()
    week_end = week_start + timedelta(days=6)  # 月〜日

    def to_date(d):
        if d is None:
            return None
        if hasattr(d, "date"):
            return d.date()
        if isinstance(d, str):
            try:
                return datetime.strptime(d[:10], "%Y-%m-%d").date()
            except Exception:
                return None
        return None

    # 未完了タスクのみ対象（担当者あり）。プロジェクト未設定のタスクも含める。
    query = db.query(models.Task).filter(models.Task.assigned_to.isnot(None))
    query = query.filter(models.Task.status != models.TaskStatus.COMPLETED)
    if not include_offline:
        offline_project_ids = [
            p.id for p in db.query(models.Project).filter(models.Project.display_status == "offline").all()
        ]
        if offline_project_ids:
            # オフラインプロジェクトは除外するが、project_id が NULL（プロジェクト未設定）のタスクは含める
            query = query.filter(
                or_(
                    models.Task.project_id.is_(None),
                    ~models.Task.project_id.in_(offline_project_ids),
                )
            )
    tasks = list(query.all())

    dependency_ids = set()
    for t in tasks:
        dependency_ids.update(_parse_depends_on_ids(getattr(t, "dependsOn", None)))
    if dependency_ids:
        dep_tasks = db.query(models.Task).filter(models.Task.id.in_(list(dependency_ids))).all()
        tasks_by_id = {t.id: t for t in list(tasks) + list(dep_tasks)}
    else:
        tasks_by_id = {t.id: t for t in tasks}

    user_hours: dict = defaultdict(float)
    user_daily_hours: dict = defaultdict(float)
    user_labor_passed: dict = defaultdict(float)
    user_remaining_cost: dict = defaultdict(float)
    user_weekdays_passed: dict = defaultdict(int)
    user_tasks: dict = defaultdict(list)

    for t in tasks:
        task_start, task_end, cost = _task_calendar_range(t, to_date)
        if task_start is None or cost <= 0:
            continue
        total_weekdays = _count_weekdays(task_start, task_end)
        if total_weekdays <= 0:
            total_weekdays = 1
        # 基準日までに経過した平日・経過労働時間・残りコスト（タスクごと）
        # 経過労働 = 経過平日×8（1日8時間）。コストを超えないよう min(cost, 経過平日×8)
        if reference_date < task_start:
            weekdays_passed = 0
            labor_passed = 0
            remaining = cost
        elif reference_date > task_end:
            weekdays_passed = total_weekdays
            labor_passed = cost
            remaining = 0
        else:
            end_for_passed = min(reference_date, task_end)
            weekdays_passed = _count_weekdays(task_start, end_for_passed)
            weekdays_passed = min(weekdays_passed, total_weekdays)
            labor_passed = min(cost, weekdays_passed * HOURS_PER_DAY)
            labor_passed = round(labor_passed, 2)
            remaining = max(0, round(cost - labor_passed, 2))
        # 開始日〜期日までの平日数でコストを按分した「1日あたりの時間」
        hours_per_weekday = round(cost / total_weekdays, 2) if total_weekdays else 0
        # 今週に「期間がかかっている」タスクか（今週内に1日でも平日が重なる）
        _in_week_start = max(task_start, week_start)
        _in_week_end = min(task_end, week_end)
        overlaps_week = _count_weekdays(_in_week_start, _in_week_end) > 0
        user_tasks[t.assigned_to].append({
            "task_id": t.id,
            "task_name": t.name or "",
            "cost": round(cost, 2),
            "start_date": task_start.isoformat() if task_start else None,
            "due_date": task_end.isoformat() if task_end else None,
            "total_weekdays": total_weekdays,
            "hours_per_weekday": hours_per_weekday,
            "overlaps_week": overlaps_week,
            "weekdays_passed": weekdays_passed,
            "labor_hours_passed": round(labor_passed, 2),
            "remaining_cost_hours": round(remaining, 2),
        })
        user_labor_passed[t.assigned_to] += labor_passed
        user_remaining_cost[t.assigned_to] += remaining
        user_weekdays_passed[t.assigned_to] = max(user_weekdays_passed[t.assigned_to], weekdays_passed)
        # 週内日別: 「開始日〜期日」の平日に、コストを等分して割り当てる（週を跨ぐ場合も全期間で按分）。
        # 例: 月開始・火期日・コスト4（平日2日）→ 月2, 火2
        # 例: 火開始・木期日・コスト18（平日3日）→ 火6, 水6, 木6（週内の月・金は0）
        in_week_start = max(task_start, week_start)
        in_week_end = min(task_end, week_end)
        weekdays_in_week = _count_weekdays(in_week_start, in_week_end)
        if weekdays_in_week <= 0:
            continue
        per_day_in_week = hours_per_weekday  # cost / total_weekdays
        d = week_start
        while d <= week_end:
            if not (in_week_start <= d <= in_week_end):
                d += timedelta(days=1)
                continue
            if d.weekday() >= 5:
                d += timedelta(days=1)
                continue
            if consider_dependencies and not _is_task_unblocked_on_date(t, d, tasks_by_id, to_date):
                d += timedelta(days=1)
                continue
            user_hours[t.assigned_to] += per_day_in_week
            user_daily_hours[(t.assigned_to, d)] += per_day_in_week
            d += timedelta(days=1)

    all_user_ids = {u.id for u in db.query(models.User).all()}
    for uid in user_hours:
        all_user_ids.add(uid)
    for uid in user_labor_passed:
        all_user_ids.add(uid)
    users_map = {}
    user_base_loads = {}  # ユーザーID -> ベースロード（週あたり時間）
    for u in db.query(models.User).filter(models.User.id.in_(all_user_ids)).all():
        users_map[u.id] = u.username or u.full_name or u.name or f"User {u.id}"
        user_base_loads[u.id] = float(u.base_load_hours_per_week or 0.0)

    result = []
    for uid in sorted(all_user_ids):
        base_load = user_base_loads.get(uid, 0.0)
        task_assigned = round(user_hours.get(uid, 0), 2)
        # ベースロードを考慮した総割当工数
        assigned = round(task_assigned + base_load, 2)
        free = max(0, MAX_HOURS_PER_WEEK - assigned)
        daily_breakdown = []
        # ベースロードを平日に按分（週5日で割る）
        base_load_per_day = base_load / 5.0 if base_load > 0 else 0.0
        d = week_start
        while d <= week_end:
            task_day_assigned = round(user_daily_hours.get((uid, d), 0), 2)
            # 平日のみベースロードを追加
            if d.weekday() < 5:
                day_assigned = round(task_day_assigned + base_load_per_day, 2)
                day_free = round(max(0, HOURS_PER_DAY - day_assigned), 2)
            else:
                day_assigned = task_day_assigned
                day_free = 0
            daily_breakdown.append({
                "date": d.isoformat(),
                "assigned_hours": day_assigned,
                "free_hours": day_free,
            })
            d += timedelta(days=1)
        task_list = user_tasks.get(uid, [])
        total_cost_hours = round(sum(x["cost"] for x in task_list), 2)
        result.append({
            "user_id": uid,
            "user_name": users_map.get(uid, ""),
            "total_cost_hours": total_cost_hours,
            "assigned_hours": assigned,
            "free_hours": round(free, 2),
            "base_load_hours_per_week": round(base_load, 2),
            "task_assigned_hours": round(task_assigned, 2),
            "labor_hours_passed": round(user_labor_passed.get(uid, 0), 2),
            "remaining_cost_hours": round(user_remaining_cost.get(uid, 0), 2),
            "weekdays_passed": user_weekdays_passed.get(uid, 0),
            "tasks": task_list,
            "daily_breakdown": daily_breakdown,
        })
    result.sort(key=lambda x: (-x["free_hours"], x["user_name"] or str(x["user_id"])))
    return result


def get_daily_workload(
    db: Session,
    target_date: date,
    include_offline: bool = False,
    include_completed: bool = False,
    consider_dependencies: bool = True,
) -> List[dict]:
    """
    指定日のユーザー別工数（時間）を計算する。計算対象は未完了タスクのみ。
    基準日は target_date（今日から見た情報）。開始日からの経過平日・経過労働時間・残りコストを返す。
    その日の割り当ては残りコストを基準日以降の平日に按分したうちの対象日分。1日=8時間上限。
    """
    from collections import defaultdict

    def to_date(d):
        if d is None:
            return None
        if hasattr(d, "date"):
            return d.date()
        if isinstance(d, str):
            try:
                return datetime.strptime(d[:10], "%Y-%m-%d").date()
            except Exception:
                return None
        return None

    query = db.query(models.Task).filter(models.Task.assigned_to.isnot(None))
    query = query.filter(models.Task.status != models.TaskStatus.COMPLETED)
    if not include_offline:
        offline_project_ids = [
            p.id for p in db.query(models.Project).filter(models.Project.display_status == "offline").all()
        ]
        if offline_project_ids:
            query = query.filter(~models.Task.project_id.in_(offline_project_ids))
    tasks = list(query.all())

    dependency_ids = set()
    for t in tasks:
        dependency_ids.update(_parse_depends_on_ids(getattr(t, "dependsOn", None)))
    if dependency_ids:
        dep_tasks = db.query(models.Task).filter(models.Task.id.in_(list(dependency_ids))).all()
        tasks_by_id = {t.id: t for t in list(tasks) + list(dep_tasks)}
    else:
        tasks_by_id = {t.id: t for t in tasks}

    user_hours: dict = defaultdict(float)
    user_labor_passed: dict = defaultdict(float)
    user_remaining_cost: dict = defaultdict(float)
    user_weekdays_passed: dict = defaultdict(int)

    for t in tasks:
        task_start, task_end, cost = _task_calendar_range(t, to_date)
        if task_start is None or cost <= 0:
            continue
        total_weekdays = _count_weekdays(task_start, task_end)
        if total_weekdays <= 0:
            total_weekdays = 1
        if target_date < task_start:
            weekdays_passed = 0
            labor_passed = 0
            remaining = cost
        elif target_date > task_end:
            weekdays_passed = total_weekdays
            labor_passed = cost
            remaining = 0
        else:
            end_for_passed = min(target_date, task_end)
            weekdays_passed = _count_weekdays(task_start, end_for_passed)
            weekdays_passed = min(weekdays_passed, total_weekdays)
            labor_passed = min(cost, weekdays_passed * HOURS_PER_DAY)
            labor_passed = round(labor_passed, 2)
            remaining = max(0, round(cost - labor_passed, 2))
        effective_start = max(task_start, target_date)
        remaining_weekdays = _count_weekdays(effective_start, task_end)
        overlaps_today = task_start <= target_date <= task_end
        if overlaps_today and consider_dependencies and not _is_task_unblocked_on_date(t, target_date, tasks_by_id, to_date):
            user_labor_passed[t.assigned_to] += labor_passed
            user_remaining_cost[t.assigned_to] += remaining
            user_weekdays_passed[t.assigned_to] = max(user_weekdays_passed[t.assigned_to], weekdays_passed)
            continue
        if overlaps_today and remaining_weekdays > 0 and target_date.weekday() < 5:
            user_hours[t.assigned_to] += remaining / remaining_weekdays
        user_labor_passed[t.assigned_to] += labor_passed
        user_remaining_cost[t.assigned_to] += remaining
        user_weekdays_passed[t.assigned_to] = max(user_weekdays_passed[t.assigned_to], weekdays_passed)

    all_user_ids = {u.id for u in db.query(models.User).all()}
    for uid in user_hours:
        all_user_ids.add(uid)
    for uid in user_labor_passed:
        all_user_ids.add(uid)
    users_map = {}
    user_base_loads = {}  # ユーザーID -> ベースロード（週あたり時間）
    for u in db.query(models.User).filter(models.User.id.in_(all_user_ids)).all():
        users_map[u.id] = u.username or u.full_name or u.name or f"User {u.id}"
        user_base_loads[u.id] = float(u.base_load_hours_per_week or 0.0)

    result = []
    for uid in sorted(all_user_ids):
        base_load = user_base_loads.get(uid, 0.0)
        task_assigned = round(user_hours.get(uid, 0), 2)
        # 平日のみベースロードを追加（週5日で按分）
        if target_date.weekday() < 5:
            base_load_per_day = base_load / 5.0
            assigned = round(task_assigned + base_load_per_day, 2)
            free = max(0, HOURS_PER_DAY - assigned)
        else:
            assigned = task_assigned
            free = 0
        base_load = user_base_loads.get(uid, 0.0)
        base_load_per_day = base_load / 5.0 if target_date.weekday() < 5 else 0.0
        task_assigned = round(user_hours.get(uid, 0), 2)
        result.append({
            "user_id": uid,
            "user_name": users_map.get(uid, ""),
            "assigned_hours": assigned,
            "free_hours": round(free, 2),
            "base_load_hours_per_week": round(base_load, 2),
            "base_load_hours_per_day": round(base_load_per_day, 2),
            "task_assigned_hours": round(task_assigned, 2),
            "labor_hours_passed": round(user_labor_passed.get(uid, 0), 2),
            "remaining_cost_hours": round(user_remaining_cost.get(uid, 0), 2),
            "weekdays_passed": user_weekdays_passed.get(uid, 0),
        })
    result.sort(key=lambda x: (-x["free_hours"], x["user_name"] or str(x["user_id"])))
    return result


def create_event(db: Session, event: schemas.EventCreate) -> models.Event: # 型ヒント修正
    """新規イベントを作成"""
    project_id_int = _parse_int_safe(event.project_id) # project_id は Optional なので None かもしれない

    db_event = models.Event(
        title=event.title,
        description=event.description,
        start_time=_parse_datetime(event.start_time),
        end_time=_parse_datetime(event.end_time),
        location=event.location,      # Base から継承された Optional な属性
        type=event.type,
        allDay=event.allDay,          # Base から継承された Optional な属性
        project_id=project_id_int,    # パース済み or None
        status='online', # 新規作成時は常に online とする
        participants=event.participants # 追加: スキーマから participants を渡す
    )
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    # ★★★ デバッグログ追加: 保存後の participants を確認 ★★★
    print(f"[DEBUG crud.create_event] Saved event with participants: {db_event.participants}")
    return db_event

def update_event(db: Session, db_event: models.Event, event_in: schemas.EventUpdate) -> models.Event: # 型ヒント修正
    """イベント情報を更新"""
    update_data = event_in.dict(exclude_unset=True)

    for key, value in update_data.items():
        db_key = key
        parsed_value = value
        if key == "project_id":
            parsed_value = _parse_int_safe(value)
            if parsed_value is None and value is not None: continue
        elif key == "start_time" or key == "end_time":
            parsed_value = _parse_datetime(value)
        elif key == "status":
            if value not in ['online', 'offline']:
                continue

        if hasattr(db_event, db_key):
             setattr(db_event, db_key, parsed_value)

    db.commit()
    db.refresh(db_event)
    return db_event

def delete_event(db: Session, db_event: models.Event) -> models.Event:
    """イベントを削除"""
    db.delete(db_event)
    db.commit()
    return db_event

# --- Group CRUD ---

def get_group(db: Session, group_id: int) -> models.Group | None:
    """ID でグループを取得"""
    return db.query(models.Group).filter(models.Group.id == group_id).first()

def get_groups(db: Session, skip: int = 0, limit: int = 100) -> list[models.Group]:
    """グループリストを取得 (ページネーション対応)"""
    return db.query(models.Group).offset(skip).limit(limit).all()

def create_group(db: Session, group: schemas.GroupCreate) -> models.Group: # 型ヒント修正
    """新規グループを作成"""
    db_group = models.Group(
        name=group.name,
        description=group.description,
    )
    db.add(db_group)
    db.commit()
    db.refresh(db_group)
    return db_group

def update_group(db: Session, db_group: models.Group, group_in: schemas.GroupUpdate) -> models.Group:
    """グループ情報を更新"""
    update_data = group_in.dict(exclude_unset=True)
    
    for key, value in update_data.items():
        if hasattr(db_group, key):
            setattr(db_group, key, value)
            
    db.commit()
    db.refresh(db_group)
    return db_group

def delete_group(db: Session, db_group: models.Group) -> models.Group:
    """グループを削除"""
    db.delete(db_group)
    db.commit()
    return db_group

# --- UserGroup CRUD ---

def get_user_group(db: Session, user_id: int, group_id: int) -> models.UserGroup | None:
    """ユーザーIDとグループIDで関連を取得"""
    return db.query(models.UserGroup).filter(
        models.UserGroup.user_id == user_id, 
        models.UserGroup.group_id == group_id
    ).first()

def get_user_groups_by_user(db: Session, user_id: int, skip: int = 0, limit: int = 100) -> list[models.UserGroup]:
    """特定のユーザーが所属するグループ関連のリストを取得"""
    return db.query(models.UserGroup).filter(models.UserGroup.user_id == user_id).offset(skip).limit(limit).all()

def get_user_groups_by_group(db: Session, group_id: int, skip: int = 0, limit: int = 100) -> list[models.UserGroup]:
    """特定のグループに所属するユーザー関連のリストを取得"""
    return db.query(models.UserGroup).filter(models.UserGroup.group_id == group_id).offset(skip).limit(limit).all()

def add_user_to_group(db: Session, user_group: schemas.UserGroupCreate) -> models.UserGroup | None: # 型ヒント修正
    """ユーザーをグループに追加"""
    user_id_int = _parse_int_safe(user_group.user_id)
    group_id_int = _parse_int_safe(user_group.group_id)

    if user_id_int is None or group_id_int is None:
        print("Warning: Invalid user_id or group_id provided for UserGroup creation.")
        return None

    db_user_group = models.UserGroup(
        user_id=user_id_int,
        group_id=group_id_int,
        role=user_group.role
    )
    db.add(db_user_group)
    db.commit()
    db.refresh(db_user_group)
    return db_user_group

def remove_user_from_group(db: Session, user_id: int, group_id: int) -> models.UserGroup | None:
    """ユーザーをグループから削除"""
    db_user_group = get_user_group(db, user_id, group_id)
    if db_user_group:
        db.delete(db_user_group)
        db.commit()
    return db_user_group

# update_user_group_role なども必要に応じて追加

def create_status_history(db: Session, task_id: int, status_history: schemas.StatusHistoryCreate) -> models.TaskStatusHistory:
    """タスクのステータス履歴を記録"""
    db_status_history = models.TaskStatusHistory(
        task_id=task_id,
        status=status_history.status,
        changed_at=status_history.changed_at or now_jst_naive(),
        changed_by=status_history.changed_by
    )
    db.add(db_status_history)
    db.commit()
    db.refresh(db_status_history)
    return db_status_history

def get_task_status_history(db: Session, task_id: int) -> List[models.TaskStatusHistory]:
    """タスクのステータス履歴を取得"""
    try:
        return db.query(models.TaskStatusHistory).filter(
            models.TaskStatusHistory.task_id == task_id
        ).order_by(models.TaskStatusHistory.changed_at).all()
    except Exception as e:
        logger.error(f"ステータス履歴の取得に失敗: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ステータス履歴の取得に失敗しました: {str(e)}"
        )

def get_status_change_metrics(
    db: Session,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    project_id: Optional[int] = None
) -> List[dict]:
    """ステータス変更のメトリクスを取得"""
    query = db.query(
        models.TaskStatusHistory.changed_at.label('date'),
        models.TaskStatusHistory.status,
        func.count(models.TaskStatusHistory.id).label('count'),
        models.Task.project_id,
        models.Project.name.label('project_name')
    ).join(
        models.Task,
        models.TaskStatusHistory.task_id == models.Task.id
    ).join(
        models.Project,
        models.Task.project_id == models.Project.id
    )

    if start_date:
        query = query.filter(models.TaskStatusHistory.changed_at >= start_date)
    if end_date:
        query = query.filter(models.TaskStatusHistory.changed_at <= end_date)
    if project_id:
        query = query.filter(models.Task.project_id == project_id)

    return query.group_by(
        models.TaskStatusHistory.changed_at,
        models.TaskStatusHistory.status,
        models.Task.project_id,
        models.Project.name
    ).all()

# --- Note CRUD ---

def get_note(db: Session, note_id: int) -> models.Note | None:
    """ID でメモを取得"""
    return db.query(models.Note).filter(models.Note.id == note_id).first()

def get_notes(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    created_by: int | None = None,
    project_id: int | None = None
) -> list[models.Note]:
    """メモリストを取得 (ページネーション対応、作成者・プロジェクトフィルタ可能)
    
    project_idがNoneの場合:
    - フロントエンドからproject_idパラメータが送られてこない場合 → フィルタリングしない（全件取得）
    - フロントエンドからproject_id=nullが明示的に送られてきた場合 → project_id IS NULLでフィルタリング
    """
    from sqlalchemy import or_
    query = db.query(models.Note)
    if created_by is not None:
        query = query.filter(models.Note.created_by == created_by)
    # project_idはOptional[int]なので、Noneの場合はフィルタリングしない
    # ただし、明示的にnullを指定したい場合は別の方法が必要
    # 現在の実装では、project_idがNoneの場合はフィルタリングしない
    if project_id is not None:
        query = query.filter(models.Note.project_id == project_id)
    return query.order_by(models.Note.created_at.desc()).offset(skip).limit(limit).all()

def create_note(db: Session, note: schemas.NoteCreate, created_by: int) -> models.Note:
    """新規メモを作成"""
    db_note = models.Note(
        title=note.title,
        content=note.content,
        image_urls=note.image_urls or [],
        pdf_urls=getattr(note, 'pdf_urls', None) or [],
        project_id=note.project_id,
        created_by=created_by,
        created_at=now_jst_naive(),
        updated_at=now_jst_naive()
    )
    db.add(db_note)
    db.commit()
    db.refresh(db_note)
    return db_note

def update_note(db: Session, db_note: models.Note, note_in: schemas.NoteUpdate, upload_dir: str = None) -> models.Note:
    """メモ情報を更新（削除された画像ファイルも削除）"""
    import os
    
    # 画像URLが更新される場合、削除された画像ファイルを削除
    if 'image_urls' in note_in.dict(exclude_unset=True) and upload_dir:
        old_image_urls = set(db_note.image_urls or [])
        new_image_urls = set(note_in.image_urls or [])
        deleted_urls = old_image_urls - new_image_urls
        
        # 削除された画像ファイルを物理的に削除
        for image_url in deleted_urls:
            if image_url and image_url.startswith('/static/uploads/'):
                filename = os.path.basename(image_url)
                file_path = os.path.join(upload_dir, filename)
                if os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                        logger.info(f"画像ファイルを削除しました: {file_path}")
                    except Exception as e:
                        logger.warning(f"画像ファイルの削除に失敗しました: {file_path}, エラー: {str(e)}")
    
    # PDF URLが更新される場合、削除されたPDFファイルを削除
    if 'pdf_urls' in note_in.dict(exclude_unset=True) and upload_dir:
        old_pdf_urls = set(db_note.pdf_urls or [])
        new_pdf_urls = set(note_in.pdf_urls or [])
        deleted_pdf_urls = old_pdf_urls - new_pdf_urls
        
        for pdf_url in deleted_pdf_urls:
            if pdf_url and pdf_url.startswith('/static/uploads/'):
                filename = os.path.basename(pdf_url)
                file_path = os.path.join(upload_dir, filename)
                if os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                        logger.info(f"PDFファイルを削除しました: {file_path}")
                    except Exception as e:
                        logger.warning(f"PDFファイルの削除に失敗しました: {file_path}, エラー: {str(e)}")
    
    update_data = note_in.dict(exclude_unset=True)
    
    for key, value in update_data.items():
        if hasattr(db_note, key):
            setattr(db_note, key, value)
    
    db_note.updated_at = now_jst_naive()
    db.commit()
    db.refresh(db_note)
    return db_note

def delete_note(db: Session, db_note: models.Note, upload_dir: str = None) -> models.Note:
    """メモを削除（画像ファイルも削除）"""
    import os
    
    # 画像ファイルを削除
    if db_note.image_urls and upload_dir:
        for image_url in db_note.image_urls:
            if image_url and image_url.startswith('/static/uploads/'):
                # URLからファイル名を抽出
                filename = os.path.basename(image_url)
                file_path = os.path.join(upload_dir, filename)
                
                # ファイルが存在する場合のみ削除
                if os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                    except Exception as e:
                        logger.warning(f"画像ファイルの削除に失敗しました: {file_path}, エラー: {str(e)}")
    
    # PDFファイルを削除
    if db_note.pdf_urls and upload_dir:
        for pdf_url in db_note.pdf_urls:
            if pdf_url and pdf_url.startswith('/static/uploads/'):
                filename = os.path.basename(pdf_url)
                file_path = os.path.join(upload_dir, filename)
                if os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                    except Exception as e:
                        logger.warning(f"PDFファイルの削除に失敗しました: {file_path}, エラー: {str(e)}")
    
    db.delete(db_note)
    db.commit()
    return db_note

# --- UserActivity CRUD ---

def get_cycle_date(dt: datetime) -> datetime:
    """5:00~28:59（翌日の4:59まで）の周期を計算し、その周期の開始日（5:00）を返す"""
    # 現在時刻が5:00より前なら、前日の5:00を周期開始日とする
    if dt.hour < 5:
        # 前日の5:00を周期開始日とする
        cycle_start = dt.replace(hour=5, minute=0, second=0, microsecond=0) - timedelta(days=1)
    else:
        # 当日の5:00を周期開始日とする
        cycle_start = dt.replace(hour=5, minute=0, second=0, microsecond=0)
    return cycle_start

def create_user_activity(db: Session, user_id: int, active_at: Optional[datetime] = None) -> models.UserActivity:
    """ユーザーのアクティビティを記録"""
    if active_at is None:
        active_at = now_jst_naive()
    
    cycle_date = get_cycle_date(active_at)
    
    db_activity = models.UserActivity(
        user_id=user_id,
        active_at=active_at,
        cycle_date=cycle_date,
        created_at=now_jst_naive()
    )
    db.add(db_activity)
    db.commit()
    db.refresh(db_activity)
    return db_activity

def get_user_activities(
    db: Session,
    user_id: Optional[int] = None,
    cycle_date: Optional[datetime] = None,
    skip: int = 0,
    limit: int = 10000
) -> List[models.UserActivity]:
    """ユーザーアクティビティを取得"""
    from sqlalchemy import func, cast, Date
    
    query = db.query(models.UserActivity)
    
    if user_id is not None:
        query = query.filter(models.UserActivity.user_id == user_id)
    
    if cycle_date is not None:
        # 周期日の日付部分のみで比較（時刻を無視）
        cycle_date_only = cycle_date.date()
        query = query.filter(func.date(models.UserActivity.cycle_date) == cycle_date_only)
    
    return query.order_by(models.UserActivity.active_at.desc()).offset(skip).limit(limit).all()

def get_user_activities_by_cycle(
    db: Session,
    cycle_date: Optional[datetime] = None,
    skip: int = 0,
    limit: int = 10000
) -> List[models.UserActivity]:
    """周期日でアクティビティを取得（全ユーザー）"""
    if cycle_date is None:
        cycle_date = get_cycle_date(now_jst_naive())
    
    return get_user_activities(db, user_id=None, cycle_date=cycle_date, skip=skip, limit=limit)


# --- Google Calendar 連携 ---

def get_user_google_token(db: Session, user_id: int) -> Optional[models.UserGoogleToken]:
    """ユーザーの Google トークンを取得"""
    return db.query(models.UserGoogleToken).filter(models.UserGoogleToken.user_id == user_id).first()


def upsert_user_google_token(
    db: Session,
    user_id: int,
    access_token: str,
    refresh_token: Optional[str] = None,
    expires_at: Optional[datetime] = None,
) -> models.UserGoogleToken:
    """Google トークンを保存（存在すれば更新）"""
    now = now_jst_naive()
    row = get_user_google_token(db, user_id)
    if row:
        row.access_token = access_token
        row.refresh_token = refresh_token or row.refresh_token
        row.expires_at = expires_at
        row.updated_at = now
        db.commit()
        db.refresh(row)
        return row
    row = models.UserGoogleToken(
        user_id=user_id,
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_task_google_sync(db: Session, user_id: int, task_id: int) -> Optional[models.TaskGoogleSync]:
    """ユーザー・タスクの Google 同期レコードを取得"""
    return (
        db.query(models.TaskGoogleSync)
        .filter(models.TaskGoogleSync.user_id == user_id, models.TaskGoogleSync.task_id == task_id)
        .first()
    )


def get_synced_task_ids_for_user(db: Session, user_id: int) -> List[int]:
    """ユーザーが「Googleに表示」をONにしているタスクIDのリスト"""
    rows = db.query(models.TaskGoogleSync.task_id).filter(models.TaskGoogleSync.user_id == user_id).all()
    return [r[0] for r in rows]


def set_task_google_sync(
    db: Session, user_id: int, task_id: int, google_event_id: str
) -> models.TaskGoogleSync:
    """タスクの Google 同期を登録"""
    now = now_jst_naive()
    row = get_task_google_sync(db, user_id, task_id)
    if row:
        row.google_event_id = google_event_id
        row.updated_at = now
        db.commit()
        db.refresh(row)
        return row
    row = models.TaskGoogleSync(
        user_id=user_id,
        task_id=task_id,
        google_event_id=google_event_id,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_task_google_sync(db: Session, user_id: int, task_id: int) -> bool:
    """タスクの Google 同期を削除"""
    row = get_task_google_sync(db, user_id, task_id)
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


def get_task_google_syncs_for_task(db: Session, task_id: int) -> List[models.TaskGoogleSync]:
    """あるタスクを同期している全ユーザーのレコード"""
    return db.query(models.TaskGoogleSync).filter(models.TaskGoogleSync.task_id == task_id).all()