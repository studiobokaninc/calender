import logging
import json
from typing import List, Optional, Any, Dict
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import text, or_, and_
from fastapi import HTTPException, status

from .. import models, schemas
from ..timezone import now_jst_naive
from ..task_utils import normalize_task_type
from .base import _parse_datetime, _parse_int_safe, _safe_json_load

logger = logging.getLogger(__name__)

def get_task(db: Session, task_id: int) -> Optional[models.Task]:
    """ID でタスクを取得"""
    return db.query(models.Task).filter(models.Task.id == task_id).first()

def _task_row_to_dict(row: Any, history_map: Dict[int, List[Dict[str, Any]]]) -> Dict[str, Any]:
    """SQL結果の1行をタスク辞書に変換するヘルパー（安全なパース処理を含む）"""
    
    # 1. ステータスの正規化 (Enum検証回避のための大文字->小文字変換)
    task_status = 'todo'
    if hasattr(row, 'status') and row.status:
        status_map = {
            'TODO': 'todo', 'IN_PROGRESS': 'in-progress', 'REVIEW': 'review', 
            'COMPLETED': 'completed', 'DELAYED': 'delayed'
        }
        raw_status = row.status
        task_status = status_map.get(raw_status, raw_status.lower().replace('_', '-'))

    # 2. JSONフィールドの安全なパース
    depends_on = _safe_json_load(getattr(row, 'dependsOn', None))
    phases = _safe_json_load(getattr(row, 'phases', None))
    check_items = _safe_json_load(getattr(row, 'check_items', None))
    
    # 3. 日付フィールドを安全に isoformat 変換
    def safe_isoformat(val: Any) -> Optional[str]:
        dt = _parse_datetime(val)
        return dt.isoformat() if dt else None
    
    # 4. その他フィールドの安全な取得
    priority_value = row.priority if (hasattr(row, 'priority') and row.priority != '') else None
    
    return {
        'id': row.id,
        'project_id': row.project_id,
        'name': row.name,
        'description': row.description,
        'assigned_to': row.assigned_to,
        'due_date': safe_isoformat(getattr(row, 'due_date', None)),
        'status': task_status,
        'priority': priority_value,
        'type': row.type,
        'start_date': safe_isoformat(getattr(row, 'start_date', None)),
        'progress': getattr(row, 'progress', 0),
        'cost': getattr(row, 'cost', 0),
        'dependsOn': depends_on,
        'shotID': getattr(row, 'shotID', None),
        'seqID': getattr(row, 'seqID', None),
        'created_at': safe_isoformat(getattr(row, 'created_at', None)),
        'display_status': getattr(row, 'display_status', 'offline'),
        'updated_at': safe_isoformat(getattr(row, 'updated_at', None)),
        'phases': phases,
        'check_items': check_items,
        'deliverables': getattr(row, 'deliverables', ""),
        'status_history': history_map.get(row.id, [])
    }

def get_tasks(db: Session, project_id: Optional[int] = None, skip: int = 0, limit: int = 10000, display_status_in: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """タスクリストを取得 (プロジェクトIDでのフィルタ、ページネーション対応、表示ステータスでのフィルタリング対応)"""
    try:
        # 自動ステータス更新を実行
        # TODO: This depends on tasks_utils. We could also move batch update to a separate file.
        # For simplicity, we assume we re-import the entry point which will eventually be re-exported.
        # But wait, we need it here. I'll move _perform_task_auto_update to a shared place later.
        pass

        # SQLAlchemy を使わず、直接 SQL 文でデータ取得（Enum 検証を回避）
        query_parts = ["SELECT * FROM tasks"]
        conditions = []
        params = {"limit": limit, "skip": skip}
        
        if project_id is not None:
            conditions.append("project_id = :project_id")
            params["project_id"] = project_id
        
        if display_status_in:
            placeholders = ','.join([f":status{i}" for i in range(len(display_status_in))])
            conditions.append(f"display_status IN ({placeholders})")
            for i, val in enumerate(display_status_in):
                params[f"status{i}"] = val
        
        if conditions:
            query_parts.append("WHERE " + " AND ".join(conditions))
        
        query_parts.append("LIMIT :limit OFFSET :skip")
        
        rows = db.execute(text(" ".join(query_parts)), params).fetchall()
        task_ids = [row.id for row in rows]
        
        # ステータス履歴を一括取得
        history_map = {tid: [] for tid in task_ids}
        if task_ids:
            try:
                # SQLite のプレースホルダ制限 (999) を考慮してチャンク分け
                for i in range(0, len(task_ids), 900):
                    chunk = task_ids[i:i + 900]
                    history_entries = db.query(models.TaskStatusHistory).filter(
                        models.TaskStatusHistory.task_id.in_(chunk)
                    ).order_by(models.TaskStatusHistory.changed_at).all()
                    
                    for entry in history_entries:
                        history_map[entry.task_id].append({
                            'id': entry.id,
                            'task_id': entry.task_id,
                            'status': entry.status.value if hasattr(entry.status, "value") else str(entry.status),
                            'timestamp': entry.changed_at.isoformat() if entry.changed_at else None,
                            'changed_at': entry.changed_at.isoformat() if entry.changed_at else None,
                            'changed_by': entry.changed_by
                        })
            except Exception as e:
                logger.warning(f"ステータス履歴の一括取得に失敗: {e}")
        
        return [_task_row_to_dict(row, history_map) for row in rows]
        
    except Exception as e:
        logger.error(f"タスクの取得に失敗: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"タスクの取得に失敗しました: {e}"
        )

def create_task(db: Session, task: schemas.TaskCreate) -> models.Task:
    """新規タスクを作成"""
    db_task = models.Task(
        name=task.name if hasattr(task, 'name') and task.name else getattr(task, 'title', '新しいたタスク'),
        description=task.description,
        assigned_to=task.assigned_to,
        project_id=task.project_id,
        due_date=_parse_datetime(task.due_date) if hasattr(task, 'due_date') else _parse_datetime(getattr(task, 'taskDueDate', None)),
        status=task.status or models.TaskStatus.TODO,
        display_status=task.display_status or 'online',
        priority=task.priority or models.TaskPriority.MEDIUM,
        type=task.type,
        start_date=_parse_datetime(task.start_date) if hasattr(task, 'start_date') else _parse_datetime(getattr(task, 'taskStartDate', None)),
        progress=task.progress or 0,
        cost=task.cost or 0.0,
        dependsOn=task.dependsOn or [],
        shotID=task.shotID,
        seqID=task.seqID,
        phases=task.phases or [],
        deliverables=task.deliverables or "",
        check_items=task.check_items or []
    )
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    
    # 履歴追加
    status_history_entry = models.TaskStatusHistory(
        task_id=db_task.id,
        status=db_task.status,
        changed_at=db_task.created_at or now_jst_naive(),
        changed_by=db_task.assigned_to
    )
    db.add(status_history_entry)
    db.commit()
    
    return db_task

def update_task(db: Session, db_task: models.Task, task_in: schemas.TaskUpdate) -> models.Task:
    """タスク情報を更新"""
    update_data = task_in.dict(exclude_unset=True)
    original_status = db_task.status

    # フィールド名のマッピング定義
    field_map = {
        "title": ("name", None),
        "taskStatus": ("status", None),
        "taskCost": ("cost", None),
        "projectId": ("project_id", _parse_int_safe),
        "taskAssigneeId": ("assigned_to", _parse_int_safe),
        "taskStartDate": ("start_date", _parse_datetime),
        "taskDueDate": ("due_date", _parse_datetime),
        "type": ("type", normalize_task_type),
    }

    for key, value in update_data.items():
        if key == "display_status" and value not in ['online', 'offline', 'archived']:
            continue
            
        db_key, converter = field_map.get(key, (key, None))
        parsed_value = converter(value) if converter else value
        
        if db_key in ["project_id", "assigned_to"] and parsed_value is None and value is not None:
            continue

        if hasattr(db_task, db_key):
            if db_key == "start_date" and db_task.start_date != parsed_value:
                db_task.auto_started = False
            if db_key == "due_date" and db_task.due_date != parsed_value:
                db_task.auto_delayed = False

            setattr(db_task, db_key, parsed_value)
            if db_key in ["phases", "check_items", "deliverables", "dependsOn"]:
                flag_modified(db_task, db_key)

    db_task.updated_at = now_jst_naive()

    new_status = db_task.status
    if new_status and new_status != original_status:
        db.add(models.TaskStatusHistory(
            task_id=db_task.id,
            status=new_status,
            changed_at=db_task.updated_at,
            changed_by=db_task.assigned_to
        ))

    db.commit()
    db.refresh(db_task)
    return db_task

def bulk_update_tasks(db: Session, task_ids: List[int], updates: dict) -> int:
    """複数タスクに同じ更新を適用。更新したタスク数を返す。"""
    tasks = db.query(models.Task).filter(models.Task.id.in_(task_ids)).all()
    count = 0
    for task in tasks:
        # updates が dict なので、schemas.TaskUpdate に変換して共通ロジックを通す
        task_update = schemas.TaskUpdate(**updates)
        update_task(db, task, task_update)
        count += 1
    return count

def delete_task(db: Session, db_task: models.Task) -> None:
    """タスクを削除"""
    # 履歴も削除
    db.execute(text("DELETE FROM task_status_history WHERE task_id = :tid"), {"tid": db_task.id})
    db.delete(db_task)
    db.commit()

def get_task_by_name(db: Session, name: str) -> Optional[models.Task]:
    """タスク名からタスクを取得"""
    return db.query(models.Task).filter(models.Task.name == name).first()
