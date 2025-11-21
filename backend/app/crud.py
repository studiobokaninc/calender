from sqlalchemy.orm import Session
from datetime import datetime
from .timezone import now_jst_naive
from typing import List, Optional
from sqlalchemy.orm import selectinload
from sqlalchemy import func
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

# --- Task CRUD ---

def get_task(db: Session, task_id: int) -> models.Task | None:
    """ID でタスクを取得"""
    return db.query(models.Task).filter(models.Task.id == task_id).first()

def get_tasks(db: Session, project_id: int | None = None, skip: int = 0, limit: int = 10000, display_status_in: Optional[List[str]] = None) -> list[dict]:
    """タスクリストを取得 (プロジェクトIDでのフィルタ、ページネーション対応、表示ステータスでのフィルタリング対応)"""
    try:
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
    return db_task

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

def update_group(db: Session, db_group: models.Group, group_in: schemas.GroupCreate) -> models.Group: # 型ヒント修正 (GroupUpdate がないので GroupCreate)
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
    
    db.delete(db_note)
    db.commit()
    return db_note