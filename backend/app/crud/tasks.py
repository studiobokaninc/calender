import logging
import json
import re
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

_DONE_STATUSES = {"completed"}
_APPROVED_OR_DONE = {"approved", "completed"}

# shots.py SHOT_CODE_REGEX と同一パターン（routers→crud の逆依存回避のため inline 定義）。
# ★案B緩和（cmd_496 / 2026-06-12）で両所を同時更新。shots.py:SHOT_CODE_REGEX と必ず一致させること。
# API(POST/PATCH /api/shots)はこの正規表現で shot_code を検証するため、
# get_or_create_shot もこれに不適合な値は作成しない（APIで管理不能なshotを生まない）。
_SHOT_CODE_REGEX = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9._~\-]{0,48}[A-Za-z0-9])?$")

# REGEX には適合するが shot として扱わない予約語（殿御裁可 2026-06-12 / cmd_493）。
# "master" は通知 body 等に誤マッチするため明示的に除外する。大小文字を無視して比較。
_SKIP_SHOT_CODES = {"master"}


def _recalc_shot_status(db: Session, shot_id: int) -> None:
    """Shot に紐づく全Taskのstatusを集計し、shot.statusを自動更新する。
    commit は呼び出し側(update_task)のトランザクションに委譲。
    """
    shot = db.query(models.Shot).filter(models.Shot.id == shot_id).first()
    if shot is None:
        return

    tasks = db.query(models.Task).filter(models.Task.shot_id == shot_id).all()
    statuses = [
        (t.status.value if hasattr(t.status, "value") else t.status)
        for t in tasks if t.status is not None
    ]

    if not statuses:
        new_status = "planning"
    elif all(s in _DONE_STATUSES for s in statuses):
        new_status = "completed"
    elif all(s in _APPROVED_OR_DONE for s in statuses):
        new_status = "approved"
    elif any(s != "todo" for s in statuses):
        new_status = "in_progress"
    else:
        new_status = "planning"

    if shot.status != new_status:
        shot.status = new_status


def get_or_create_shot(db: Session, project_id: int, seq_code: str, shot_code: str) -> Optional[int]:
    """(project_id, seq_code, shot_code) で shots を get-or-create し shot.id を返す。

    seqID→seq_code / shotID→shot_code をそのまま採用（seq_code='sq01' のハードコードはしない）。
    入力が空文字/None/空白のみなら None を返す（スキップ）。ゴミ値はそのまま取り込む（殿方針 2026-06-12）。
    一意性は DB UNIQUE(project_id, seq_code, shot_code) に委ね、存在チェックで重複作成を防ぐ。
    commit は呼び出し側に委譲（flush で id を確定）。
    """
    seq_code = (seq_code or "").strip()
    shot_code = (shot_code or "").strip()
    if not seq_code or not shot_code or not project_id:
        return None

    # shot_code が API の SHOT_CODE_REGEX に不適合なら作成しない（スキップ→tasks.shot_id は NULL のまま）。
    # seq_code はフィルタ対象外（FQ 等の値を許容）。
    if not _SHOT_CODE_REGEX.match(shot_code):
        return None

    # 予約語（master 等）は REGEX 適合でも shot 化しない（通知誤マッチ回避）。
    if shot_code.lower() in _SKIP_SHOT_CODES:
        return None

    shot = db.query(models.Shot).filter(
        models.Shot.project_id == project_id,
        models.Shot.seq_code == seq_code,
        models.Shot.shot_code == shot_code,
    ).first()
    if shot:
        return shot.id

    shot = models.Shot(
        project_id=project_id,
        seq_code=seq_code,
        shot_code=shot_code,
        display_order=0,
        status="planning",
    )
    db.add(shot)
    db.flush()
    return shot.id


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
            'APPROVED': 'approved', 'COMPLETED': 'completed', 'DELAYED': 'delayed', 'RETAKE': 'retake'
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

def get_tasks(db: Session, project_id: Optional[int] = None, skip: int = 0, limit: int = 10000, display_status_in: Optional[List[str]] = None, include_history: bool = True, due_date_from: Optional[str] = None, due_date_to: Optional[str] = None) -> List[Dict[str, Any]]:
    """タスクリストを取得 (プロジェクトIDでのフィルタ、ページネーション対応、表示ステータスでのフィルタリング対応)

    due_date_from/due_date_to: ISO8601 文字列。指定時は due_date または start_date が範囲内のタスクのみ返す。
    日付なし（due_date IS NULL かつ start_date IS NULL）のタスクは範囲指定に関わらず常に含む。
    """
    try:
        # SQLAlchemy を使わず、直接 SQL 文でデータ取得（Enum 検証を回避）
        query_parts = ["SELECT * FROM tasks"]
        conditions = []
        params: dict = {"limit": limit, "skip": skip}

        if project_id is not None:
            conditions.append("project_id = :project_id")
            params["project_id"] = project_id

        if display_status_in:
            placeholders = ','.join([f":status{i}" for i in range(len(display_status_in))])
            conditions.append(f"display_status IN ({placeholders})")
            for i, val in enumerate(display_status_in):
                params[f"status{i}"] = val

        if due_date_from or due_date_to:
            # 日付あり && 範囲内、または日付なしタスクを含む
            # (due_date >= from OR start_date >= from) AND (due_date <= to OR start_date <= to)
            # を日付なしタスク込みで表現:
            date_conds = []
            if due_date_from and due_date_to:
                date_conds.append(
                    "(due_date IS NULL AND start_date IS NULL)"
                    " OR (due_date >= :ddf AND due_date <= :ddt)"
                    " OR (start_date >= :ddf AND start_date <= :ddt)"
                    " OR (start_date IS NOT NULL AND due_date IS NOT NULL AND start_date <= :ddt AND due_date >= :ddf)"
                )
                params["ddf"] = due_date_from
                params["ddt"] = due_date_to
            elif due_date_from:
                date_conds.append(
                    "(due_date IS NULL AND start_date IS NULL)"
                    " OR due_date >= :ddf OR start_date >= :ddf"
                )
                params["ddf"] = due_date_from
            else:
                date_conds.append(
                    "(due_date IS NULL AND start_date IS NULL)"
                    " OR due_date <= :ddt OR start_date <= :ddt"
                )
                params["ddt"] = due_date_to
            conditions.append(f"({date_conds[0]})")

        if conditions:
            query_parts.append("WHERE " + " AND ".join(conditions))

        query_parts.append("LIMIT :limit OFFSET :skip")
        
        rows = db.execute(text(" ".join(query_parts)), params).fetchall()
        task_ids = [row.id for row in rows]
        
        # ステータス履歴を一括取得
        history_map = {tid: [] for tid in task_ids}
        if include_history and task_ids:
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

def _get_project_supervisors(db: Session, project_id: int) -> List[int]:
    """プロジェクトの監督者（Lead, Director, PM）のユーザーIDリストを取得する。
    いなければデフォルトの管理者ID 28 (ryoji) を含むリストを返す。
    """
    rows = db.execute(
        text("SELECT user_id FROM score_user_roles WHERE project_id = :pid AND role IN ('lead', 'director', 'pm', 'Lead', 'Director', 'PM')"),
        {"pid": project_id}
    ).fetchall()
    supervisor_ids = [row[0] for row in rows]
    
    if not supervisor_ids:
        # フォールバックとして role='admin' を探す
        row_admin = db.execute(
            text("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
        ).fetchone()
        fallback_id = row_admin[0] if row_admin else 28
        supervisor_ids = [fallback_id]
        
    return supervisor_ids

def _resolve_dm_thread_id(db: Session, participant_ids: List[int]) -> int:
    """参加者リストから一意のスレッドIDを取得または新規採番する。
    1対1の場合は既存の min*10000+max 規則を使用。
    3人以上の場合は dm_thread_participants テーブルで参加者集合一致を検索する。
    """
    from sqlalchemy import func
    participants = sorted(list(set(participant_ids)))
    if len(participants) < 2:
        raise ValueError("スレッドには少なくとも2人の参加者が必要です")

    if len(participants) == 2:
        return participants[0] * 10000 + participants[1]

    # 3人以上: dm_thread_participants で参加者集合一致のthread_idを検索
    target_set = set(participants)
    target_len = len(target_set)

    # 候補: 参加者数が一致するthread_idを取得
    rows = db.query(
        models.DmThreadParticipant.thread_id,
        func.count(models.DmThreadParticipant.user_id).label("cnt")
    ).group_by(models.DmThreadParticipant.thread_id)\
     .having(func.count(models.DmThreadParticipant.user_id) == target_len)\
     .all()

    for row in rows:
        tid = row.thread_id
        members = set(
            uid for (uid,) in
            db.query(models.DmThreadParticipant.user_id)
              .filter(models.DmThreadParticipant.thread_id == tid).all()
        )
        if members == target_set:
            return tid

    # 新規採番
    max_dm_tid = db.query(func.max(models.DirectMessage.thread_id)).scalar() or 0
    max_dtp_tid = db.query(func.max(models.DmThreadParticipant.thread_id)).scalar() or 0
    new_tid = max(10000000, max_dm_tid + 1, max_dtp_tid + 1)

    for pid in participants:
        db.add(models.DmThreadParticipant(
            thread_id=new_tid,
            user_id=pid,
            created_at=now_jst_naive()
        ))
    db.commit()

    return new_tid

def _send_dm_to_participants(db: Session, thread_id: int, sender_id: int, participant_ids: List[int], body: str):
    """送信者を除く全参加者に対して、代表者1名に向けてメッセージを1件だけ挿入する（複製データ無し）"""
    other_participants = [p for p in set(participant_ids) if p != sender_id]
    if not other_participants:
        return
    representative_id = other_participants[0]
    
    db_dm = models.DirectMessage(
        thread_id=thread_id,
        sender_id=sender_id,
        recipient_id=representative_id,
        body=body,
        created_at=now_jst_naive()
    )
    db.add(db_dm)
    db.commit()

def _auto_create_task_dm_thread(db: Session, task_id: int, project_id: Optional[int], assigned_to: Optional[int]) -> Optional[int]:
    """タスクに関連するDMスレッドを自動生成する。
    担当者とプロジェクトの監督者全員（Lead/Director/PM）とのスレッドを作成し、初期メッセージを登録。
    """
    if not assigned_to or not project_id:
        return None
        
    supervisor_ids = _get_project_supervisors(db, project_id)
    participant_ids = list(set([assigned_to] + supervisor_ids))
    
    if len(participant_ids) < 2:
        if 28 not in participant_ids:
            participant_ids.append(28)
        else:
            return None
            
    thread_id = _resolve_dm_thread_id(db, participant_ids)
    
    existing = db.execute(
        text("SELECT id FROM direct_messages WHERE thread_id = :tid LIMIT 1"),
        {"tid": thread_id}
    ).fetchone()
    
    if not existing:
        sender_id = supervisor_ids[0] if supervisor_ids else 28
        _send_dm_to_participants(db, thread_id, sender_id, participant_ids, "Task message thread initialized.")
        
    return thread_id

def _resolve_and_sync_shot_id(db: Session, project_id: Optional[int], shot_id: Optional[int], shot_id_str: Optional[str]) -> Optional[int]:
    """shotID(文字列)とproject_idから、対応するShotレコードのid(数値)を解決する。
    無ければ自動的に新規Shotレコードを作成してそのidを返す。
    同じプロジェクトで同じshotIDなら、同じShot.idを再利用する。
    """
    if not shot_id_str or not project_id:
        return None
    
    seq_code = "sq01"
    shot_code = shot_id_str
    
    # 既存の shot_id がある場合、それが現在の project_id と shotID に一致しているか確認
    if shot_id is not None:
        existing = db.query(models.Shot).filter(models.Shot.id == shot_id).first()
        if existing and existing.project_id == project_id and existing.shot_code == shot_code:
            return shot_id
    
    # 一致していない、あるいは既存の shot_id がない場合は検索
    existing_shot = db.query(models.Shot).filter(
        models.Shot.project_id == project_id,
        models.Shot.seq_code == seq_code,
        models.Shot.shot_code == shot_code
    ).first()
    
    if existing_shot:
        return existing_shot.id
        
    # なければ新規作成
    new_shot = models.Shot(
        project_id=project_id,
        seq_code=seq_code,
        shot_code=shot_code,
        display_order=0,
        status="planning"
    )
    db.add(new_shot)
    db.commit()
    db.refresh(new_shot)
    return new_shot.id

def create_task(db: Session, task: schemas.TaskCreate) -> models.Task:
    """新規タスクを作成"""
    resolved_shot_id = _resolve_and_sync_shot_id(db, task.project_id, task.shot_id, task.shotID)
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
        seqID=task.seqID if (task.shotID or resolved_shot_id) else "SEQ_PM",
        shot_id=resolved_shot_id,
        phases=task.phases or [],
        deliverables=task.deliverables or "",
        check_items=task.check_items or []
    )
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    
    # DM スレッドを自動作成して紐付け
    if db_task.assigned_to and db_task.project_id:
        thread_id = _auto_create_task_dm_thread(db, db_task.id, db_task.project_id, db_task.assigned_to)
        if thread_id:
            db_task.thread_id = thread_id
            db.commit()
            db.refresh(db_task)
    
    # 履歴追加
    status_history_entry = models.TaskStatusHistory(
        task_id=db_task.id,
        status=db_task.status,
        changed_at=db_task.created_at or now_jst_naive(),
        changed_by=db_task.assigned_to,
        change_source='manual'
    )
    db.add(status_history_entry)
    if db_task.shot_id is not None:
        _recalc_shot_status(db, db_task.shot_id)
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
                
            # 手動でステータスが変更された場合
            if db_key == "status" and db_task.status != parsed_value:
                # 期日を過ぎているタスクのステータスを手動で変更したなら、自動遅延を抑止する
                if db_task.due_date:
                    due_date = db_task.due_date.date() if hasattr(db_task.due_date, 'date') else db_task.due_date
                    if due_date < now_jst_naive().date():
                        db_task.auto_delayed = True

            setattr(db_task, db_key, parsed_value)
            if db_key in ["phases", "check_items", "deliverables", "dependsOn"]:
                flag_modified(db_task, db_key)

    # 規則: 特定のSHOTに紐づかないタスク (shotID / shot_id が空) の場合、seqID を "SEQ_PM" で統一する
    db_task.shot_id = _resolve_and_sync_shot_id(db, db_task.project_id, db_task.shot_id, db_task.shotID)
    if not db_task.shotID and not db_task.shot_id:
        db_task.seqID = "SEQ_PM"

    db_task.updated_at = now_jst_naive()

    new_status = db_task.status
    if new_status and new_status != original_status:
        db.add(models.TaskStatusHistory(
            task_id=db_task.id,
            status=new_status,
            changed_at=db_task.updated_at,
            changed_by=db_task.assigned_to,
            change_source='manual'
        ))

    if db_task.shot_id is not None:
        _recalc_shot_status(db, db_task.shot_id)

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
    shot_id = db_task.shot_id  # 削除前に退避
    # 履歴も削除
    db.execute(text("DELETE FROM task_status_history WHERE task_id = :tid"), {"tid": db_task.id})
    db.delete(db_task)
    db.commit()
    if shot_id is not None:
        _recalc_shot_status(db, shot_id)
        db.commit()

def get_task_by_name(db: Session, name: str) -> Optional[models.Task]:
    """タスク名からタスクを取得"""
    return db.query(models.Task).filter(models.Task.name == name).first()

def get_task_status_history(db: Session, task_id: int) -> List[models.TaskStatusHistory]:
    """特定のタスクのステータス変更履歴を取得"""
    return db.query(models.TaskStatusHistory).filter(models.TaskStatusHistory.task_id == task_id).order_by(models.TaskStatusHistory.changed_at.asc()).all()

