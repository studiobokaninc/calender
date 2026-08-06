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

from ..status_meta import COMPLETED_STATUSES
from .. import status_transitions

# task_status_redesign_v2 のカテゴリ集合（status_meta を単一の真実として参照）
_COMPLETED_STATUSES = set(COMPLETED_STATUSES)
_HELD_STATUSES = set()  # OMIT は COMPLETED に移行されたため除外なし
_TODO_STATUSES = {"wt", "mk"}  # Shot 集約で「計画中」とみなす未着手系


# --- 遷移検証(subtask_681b / gunshi_report.yaml CON-1〜5) 共通ヘルパー ---
# routers/score.py の approve_shot/approve_task (CON-3) からも import して使う。


def _actor_project_role(db: Session, actor_id: Optional[int], project_id: Optional[int]) -> Optional[str]:
    """プロジェクト単位の制作役職(score_user_roles)を引く。未割当は None(=role_not_permitted扱い/F-7)。"""
    if not actor_id or not project_id:
        return None
    row = db.query(models.ScoreUserRole).filter(
        models.ScoreUserRole.user_id == actor_id,
        models.ScoreUserRole.project_id == project_id,
    ).first()
    return row.role if row else None


def _who_can_do_this(db: Session, project_id: Optional[int], required_role: Optional[str]) -> list:
    """role_not_permitted エラーの who_can_do_this を ScoreUserRole から充填する。
    連絡先等は含めず user_id/username/role の3項目のみ返す(個人情報最小化)。"""
    roles = status_transitions.roles_meeting_requirement(required_role)
    if not project_id or not roles:
        return []
    rows = db.query(models.ScoreUserRole, models.User).join(
        models.User, models.User.id == models.ScoreUserRole.user_id
    ).filter(
        models.ScoreUserRole.project_id == project_id,
        models.ScoreUserRole.role.in_(roles),
    ).all()
    return [{"user_id": u.id, "username": u.username, "role": sur.role} for sur, u in rows]


def _actor_is_admin(db: Session, actor_id: Optional[int]) -> bool:
    """システム管理者(User.role == 'admin')であるかどうかを判定。"""
    if not actor_id:
        return False
    user = db.query(models.User).filter(models.User.id == actor_id).first()
    return user is not None and user.role == "admin"


def _validate_status_transition(
    db: Session, actor_id: Optional[int], project_id: Optional[int],
    from_status: Optional[str], to_status: Optional[str],
) -> Optional[dict]:
    """CON-3/CON-4/CON-5: 検証本体。合法なら None。
    違反時は explain_transition の body(dict)を返す(who_can_do_this を実データで充填済み)。
    from/to は canonicalize_task_status 通過後の値で呼ぶこと(CON-5)。"""
    if _actor_is_admin(db, actor_id):
        return None  # システム管理者は制限をバイパス
    actor_role = _actor_project_role(db, actor_id, project_id)
    violation = status_transitions.validate_transition(from_status, to_status, actor_role)
    if violation and violation.get("error") == "role_not_permitted":
        violation["who_can_do_this"] = _who_can_do_this(db, project_id, violation.get("required_role"))
    return violation


def _enforce_status_transition(
    db: Session, actor_id: Optional[int], project_id: Optional[int],
    from_status: Optional[str], to_status: Optional[str], *, task_id: Optional[int] = None,
) -> Optional[dict]:
    """TASK_TRANSITION_ENFORCE(off/warn/on, 既定on)を適用する(CON-2)。
    on: 違反時に TransitionError を送出(呼び出し側で拒否・副作用ゼロを保証すること)。
    warn: 拒否せず warning dict を返す(呼び出し側が logger.warning + レスポンス同梱に使う)。
    off: 何もしない(検証自体を評価しない)。"""
    mode = status_transitions.get_enforce_mode()
    if mode == "off":
        return None
    violation = _validate_status_transition(db, actor_id, project_id, from_status, to_status)
    if not violation:
        return None
    if mode == "on":
        raise status_transitions.TransitionError(violation)
    logger.warning(
        "TASK_TRANSITION_ENFORCE=warn: 違法/未確定/役職不足の遷移を許可 task_id=%s %s→%s error=%s",
        task_id, from_status, to_status, violation.get("error"),
    )
    return violation


def _enforce_assignee_change(
    db: Session, actor_id: Optional[int], project_id: Optional[int], *, task_id: Optional[int] = None,
) -> Optional[dict]:
    """F681-3: assigned_to(担当者)変更の独立ゲート(status遷移検証とは別・混同しない)。
    Casper依頼書§02「アサイン wt/mk→担当設定 Lead以上」の実装。
    TASK_TRANSITION_ENFORCE(off/warn/on、既定on)に従う点は _enforce_status_transition と同じ。"""
    mode = status_transitions.get_enforce_mode()
    if mode == "off":
        return None
    if _actor_is_admin(db, actor_id):
        return None  # システム管理者は制限をバイパス
    actor_role = _actor_project_role(db, actor_id, project_id)
    violation = status_transitions.explain_assignee_change(actor_role)
    if not violation:
        return None
    violation["who_can_do_this"] = _who_can_do_this(db, project_id, violation.get("required_role"))
    if mode == "on":
        raise status_transitions.TransitionError(violation)
    logger.warning(
        "TASK_TRANSITION_ENFORCE=warn: 役職不足のassigned_to変更を許可 task_id=%s actor_id=%s error=%s",
        task_id, actor_id, violation.get("error"),
    )
    return violation

# shots.py SHOT_CODE_REGEX と同一パターン（routers→crud の逆依存回避のため inline 定義）。
# ★案B緩和（cmd_496 / 2026-06-12）で両所を同時更新。shots.py:SHOT_CODE_REGEX と必ず一致させること。
# API(POST/PATCH /api/shots)はこの正規表現で shot_code を検証するため、
# get_or_create_shot もこれに不適合な値は作成しない（APIで管理不能なshotを生まない）。
_SHOT_CODE_REGEX = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9._~\-]{0,48}[A-Za-z0-9])?$")

# REGEX には適合するが shot として扱わない予約語（殿御裁可 2026-06-12 / cmd_493）。
# "master" は通知 body 等に誤マッチするため明示的に除外する。大小文字を無視して比較。
_SKIP_SHOT_CODES = {"master"}


def _recalc_shot_status(db: Session, shot_id: int) -> None:
    """Shot に紐づく全Taskのstatusを新9体系で集計し、shot.statusを自動更新する。
    commit は呼び出し側(update_task)のトランザクションに委譲。

    集約ルール (task_status_redesign_v2_plan.md §6, 3値):
      - 有効タスク(omit以外)が存在しない、または全てが wt/mk       → planning
      - 有効タスクが全て完了カテゴリ {ap, client_ap, deliver}      → completed
      - それ以外（wip/qc/qc_fb を含む、または一部のみ完了）        → in_progress

    ※ 旧体系の中間 shot ステータス 'approved' は廃止（3値へ収束）。
      status は canonicalize して旧19値も新9値へ畳み込んでから判定する。
    """
    shot = db.query(models.Shot).filter(models.Shot.id == shot_id).first()
    if shot is None:
        return

    from .. import schemas as _schemas
    tasks = db.query(models.Task).filter(models.Task.shot_id == shot_id).all()
    all_statuses = []
    for t in tasks:
        if t.status is None:
            continue
        raw = t.status.value if hasattr(t.status, "value") else str(t.status)
        all_statuses.append(_schemas.canonicalize_task_status(raw) or raw)

    # omit は集約対象から除外
    statuses = [s for s in all_statuses if s not in _HELD_STATUSES]

    if not statuses:
        new_status = "planning"
    elif all(s in _TODO_STATUSES for s in statuses):
        new_status = "planning"
    elif all(s in _COMPLETED_STATUSES for s in statuses):
        new_status = "completed"
    else:
        new_status = "in_progress"

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

    # 1. ステータスの正規化。schemas.canonicalize_task_status に一元化して
    #    旧値 (todo/in-progress/completed 等) と Enum 大文字名 (TODO/IN_PROGRESS/...) の
    #    両方を新19値へマップする。従来の replace('_','-') は qc_fb/dir_ap 等を壊すため撤廃。
    task_status = 'mk'
    if hasattr(row, 'status') and row.status:
        from .. import schemas as _schemas
        raw_status = str(row.status)
        # SQLAlchemy Enum は物理値(小文字)を返すが、旧レコードの大文字名残存に備え lower 化
        canonical = _schemas.canonicalize_task_status(raw_status.lower())
        task_status = canonical or 'mk'

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
        'completed_at': safe_isoformat(getattr(row, 'completed_at', None)),
        'phases': phases,
        'check_items': check_items,
        'deliverables': getattr(row, 'deliverables', ""),
        'status_history': history_map.get(row.id, [])
    }

def get_tasks(db: Session, project_id: Optional[int] = None, skip: int = 0, limit: int = 10000, display_status_in: Optional[List[str]] = None, include_history: bool = True, due_date_from: Optional[str] = None, due_date_to: Optional[str] = None, project_display_status: Optional[str] = None) -> List[Dict[str, Any]]:
    """タスクリストを取得 (プロジェクトIDでのフィルタ、ページネーション対応、表示ステータスでのフィルタリング対応、プロジェクトの表示ステータスでのフィルタリング対応)

    due_date_from/due_date_to: ISO8601 文字列。指定時は due_date または start_date が範囲内のタスクのみ返す。
    日付なし（due_date IS NULL かつ start_date IS NULL）のタスクは範囲指定に関わらず常に含む。
    """
    try:
        # SQLAlchemy を使わず、直接 SQL 文でデータ取得（Enum 検証を回避）
        conditions = []
        params: dict = {"limit": limit, "skip": skip}

        if project_display_status:
            query_parts = [
                "SELECT tasks.* FROM tasks",
                "LEFT JOIN projects ON tasks.project_id = projects.id"
            ]
            if project_display_status == 'online':
                conditions.append("(projects.display_status = :proj_status OR tasks.project_id IS NULL)")
                params["proj_status"] = project_display_status
            else:
                conditions.append("projects.display_status = :proj_status")
                params["proj_status"] = project_display_status
        else:
            query_parts = ["SELECT tasks.* FROM tasks"]

        if project_id is not None:
            conditions.append("tasks.project_id = :project_id")
            params["project_id"] = project_id

        if display_status_in:
            placeholders = ','.join([f":status{i}" for i in range(len(display_status_in))])
            conditions.append(f"tasks.display_status IN ({placeholders})")
            for i, val in enumerate(display_status_in):
                params[f"status{i}"] = val

        if due_date_from or due_date_to:
            # 日付あり && 範囲内、または日付なしタスクを含む
            # (due_date >= from OR start_date >= from) AND (due_date <= to OR start_date <= to)
            # を日付なしタスク込みで表現:
            date_conds = []
            if due_date_from and due_date_to:
                date_conds.append(
                    "(tasks.due_date IS NULL AND tasks.start_date IS NULL)"
                    " OR (tasks.due_date >= :ddf AND tasks.due_date <= :ddt)"
                    " OR (tasks.start_date >= :ddf AND tasks.start_date <= :ddt)"
                    " OR (tasks.start_date IS NOT NULL AND tasks.due_date IS NOT NULL AND tasks.start_date <= :ddt AND tasks.due_date >= :ddf)"
                )
                params["ddf"] = due_date_from
                params["ddt"] = due_date_to
            elif due_date_from:
                date_conds.append(
                    "(tasks.due_date IS NULL AND tasks.start_date IS NULL)"
                    " OR tasks.due_date >= :ddf OR tasks.start_date >= :ddf"
                )
                params["ddf"] = due_date_from
            else:
                date_conds.append(
                    "(tasks.due_date IS NULL AND tasks.start_date IS NULL)"
                    " OR tasks.due_date <= :ddt OR tasks.start_date <= :ddt"
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

def _create_status_notification(
    db: Session,
    recipient_id: Optional[int],
    task: models.Task,
    ntype: str,
    title: str,
    to_status: str,
    actor_id: Optional[int],
    extra_meta: Optional[Dict[str, Any]] = None,
) -> None:
    """ステータス遷移通知を1件生成する（§1.4 共通ルール適用）。
    - 宛先が空、または宛先==操作者(自己通知)ならスキップ。
    - 同一 (recipient_id, task_id, to) の未読通知が既にあれば重複生成しない。
    """
    if not recipient_id:
        return
    if actor_id is not None and recipient_id == actor_id:
        return  # 自己通知の抑制

    # 重複抑制: 同一宛先・同一タスク・同一遷移先の未読通知が既にあるか
    dup = db.execute(
        text(
            "SELECT 1 FROM notifications "
            "WHERE recipient_id = :rid AND is_read = 0 "
            "AND json_extract(meta, '$.task_id') = :tid "
            "AND json_extract(meta, '$.to') = :to LIMIT 1"
        ),
        {"rid": recipient_id, "tid": task.id, "to": to_status},
    ).fetchone()
    if dup:
        return

    meta: Dict[str, Any] = {"task_id": task.id, "to": to_status, "actor_id": actor_id}
    if extra_meta:
        meta.update(extra_meta)

    db.add(models.Notification(
        recipient_id=recipient_id,
        title=title,
        type=ntype,
        body=title,
        meta=meta,
        project_id=task.project_id,
    ))


def _notify_status_change(
    db: Session,
    task: models.Task,
    from_status: str,
    to_status: str,
    actor_id: Optional[int] = None,
) -> None:
    """ステータス遷移に応じた通知を生成する (task_status_redesign_v2 §1.4)。"""
    name = task.name or f"Task#{task.id}"
    assignee = task.assigned_to

    if to_status == "qc":
        # チェック依頼 → プロジェクト監督者(Lead/Director/PM)へ
        if task.project_id:
            for sup in _get_project_supervisors(db, task.project_id):
                _create_status_notification(
                    db, sup, task, "task_review_requested",
                    f"チェック依頼: {name}", to_status, actor_id,
                )
    elif to_status == "qc_fb":
        # 完了カテゴリからの差し戻し = クライアントFB修正 (アーティスト+ディレクター)
        # それ以外 = 社内FB (アーティストのみ)
        if from_status in _COMPLETED_STATUSES:
            _create_status_notification(
                db, assignee, task, "client_fb",
                f"クライアントFB修正: {name}", to_status, actor_id,
            )
            if task.project_id:
                for sup in _get_project_supervisors(db, task.project_id):
                    _create_status_notification(
                        db, sup, task, "client_fb",
                        f"クライアントFB修正: {name}", to_status, actor_id,
                    )
        else:
            _create_status_notification(
                db, assignee, task, "task_feedback",
                f"修正依頼(FB): {name}", to_status, actor_id,
            )
    elif to_status == "ap":
        _create_status_notification(
            db, assignee, task, "task_status_changed",
            f"社内承認(AP): {name}", to_status, actor_id,
        )
    elif to_status == "client_ap":
        _create_status_notification(
            db, assignee, task, "task_status_changed",
            f"クライアント承認: {name}", to_status, actor_id,
        )
    elif to_status == "deliver":
        _create_status_notification(
            db, assignee, task, "task_status_changed",
            f"納品/引渡し: {name}", to_status, actor_id,
        )
    elif to_status == "completed":
        _create_status_notification(
            db, assignee, task, "task_status_changed",
            f"納品完了(COMPLETED): {name}", to_status, actor_id,
        )
    # wt/mk/wip への遷移は通知なし


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
    # task_status_redesign_v2 §1.2: 作成時の初期ステータスはシステム自動の WT。
    init_status = task.status or models.TaskStatus.WT
    init_status_val = init_status.value if hasattr(init_status, 'value') else str(init_status)
    resolved_shot_id = task.shot_id
    resolved_shot_id_str = task.shotID
    if resolved_shot_id is not None:
        shot = db.query(models.Shot).filter(models.Shot.id == resolved_shot_id).first()
        if shot:
            resolved_shot_id_str = shot.shot_code
    elif resolved_shot_id_str:
        resolved_shot_id = _resolve_and_sync_shot_id(db, task.project_id, resolved_shot_id, resolved_shot_id_str)

    seq_id_val = task.seq_id if getattr(task, 'seq_id', None) is not None else task.seqID
    if (seq_id_val is None or seq_id_val == "SEQ_PM") and resolved_shot_id is not None:
        shot = db.query(models.Shot).filter(models.Shot.id == resolved_shot_id).first()
        if shot:
            seq_id_val = shot.seq_code


    db_task = models.Task(
        name=task.name if hasattr(task, 'name') and task.name else getattr(task, 'title', '新しいたタスク'),
        description=task.description,
        assigned_to=task.assigned_to,
        project_id=task.project_id,
        due_date=_parse_datetime(task.due_date) if hasattr(task, 'due_date') else _parse_datetime(getattr(task, 'taskDueDate', None)),
        status=init_status,
        display_status=task.display_status or 'online',
        priority=task.priority or models.TaskPriority.MEDIUM,
        type=task.type,
        start_date=_parse_datetime(task.start_date) if hasattr(task, 'start_date') else _parse_datetime(getattr(task, 'taskStartDate', None)),
        progress=task.progress or 0,
        cost=task.cost or 0.0,
        dependsOn=task.dependsOn or [],
        shotID=resolved_shot_id_str,
        seqID=seq_id_val if (resolved_shot_id_str or resolved_shot_id) else "SEQ_PM",
        shot_id=resolved_shot_id,
        phases=task.phases or [],
        deliverables=task.deliverables or "",
        check_items=task.check_items or [],
        completed_at=now_jst_naive() if init_status_val.lower() in _COMPLETED_STATUSES else None
    )
    db.add(db_task)
    if db_task.due_date and db_task.project_id:
        project = db.query(models.Project).filter(models.Project.id == db_task.project_id).first()
        if project and project.end_date and db_task.due_date > project.end_date:
            project.end_date = db_task.due_date
            project.updated_at = now_jst_naive()
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

def update_task(
    db: Session, 
    db_task: models.Task, 
    task_in: schemas.TaskUpdate, 
    actor_id: Optional[int] = None,
    change_source: models.TaskChangeSource = models.TaskChangeSource.MANUAL
) -> models.Task:
    """タスク情報を更新。
    task_status_redesign_plan.md §3.1 に従い、auto_started/auto_delayed の書き換えと
    締切超過による自動遷移は廃止。auto_delayed カラムは互換のため残すが本メソッドから触れない。

    actor_id: 操作者ユーザーID。ステータス履歴の changed_by と通知の自己抑制/actor_id に使用。
    未指定時は担当者(assigned_to)を changed_by に用いる（後方互換）。
    """
    change_time = now_jst_naive()
    original_due_date = db_task.due_date
    update_data = task_in.dict(exclude_unset=True)
    original_status = (
        db_task.status.value if hasattr(db_task.status, "value") else db_task.status
    )
    original_progress = db_task.progress

    # --- CON-3/CON-4/CON-5: 検証は全setattrより前・canonicalize後の値で行う ---
    transition_warning = None
    raw_new_status = update_data.get("status", update_data.get("taskStatus"))
    if raw_new_status is not None:
        raw_new_status_str = raw_new_status.value if hasattr(raw_new_status, "value") else raw_new_status
        canonical_from = schemas.canonicalize_task_status(original_status)
        canonical_to = schemas.canonicalize_task_status(raw_new_status_str)
        if canonical_from != canonical_to:
            transition_warning = _enforce_status_transition(
                db, actor_id, db_task.project_id, canonical_from, canonical_to, task_id=db_task.id,
            )

    # --- F681-3: assigned_to(担当者)変更ゲート。status遷移検証(上のブロック)とは
    # 独立した別ゲート(混同禁止)。こちらも全setattrより前・canonicalize不要の生値で判定する。
    assignee_warning = None
    if "assigned_to" in update_data:
        new_assignee_id = (
            _parse_int_safe(update_data["assigned_to"]) if update_data["assigned_to"] is not None else None
        )
        if new_assignee_id != db_task.assigned_to:
            assignee_warning = _enforce_assignee_change(
                db, actor_id, db_task.project_id, task_id=db_task.id,
            )

    # フィールド名のマッピング定義
    field_map = {
        "title": ("name", None),
        "taskStatus": ("status", None),
        "taskCost": ("cost", None),
        "projectId": ("project_id", _parse_int_safe),
        "taskAssigneeId": ("assigned_to", _parse_int_safe),
        "taskStartDate": ("start_date", _parse_datetime),
        "taskDueDate": ("due_date", _parse_datetime),
        "start_date": ("start_date", _parse_datetime),
        "due_date": ("due_date", _parse_datetime),
        "type": ("type", normalize_task_type),
        "seq_id": ("seqID", None),
    }

    for key, value in update_data.items():
        if key == "display_status" and value not in ['online', 'offline', 'archived']:
            continue

        db_key, converter = field_map.get(key, (key, None))
        parsed_value = converter(value) if converter else value

        if db_key in ["project_id", "assigned_to"] and parsed_value is None and value is not None:
            continue

        if hasattr(db_task, db_key):
            setattr(db_task, db_key, parsed_value)
            if db_key in ["phases", "check_items", "deliverables", "dependsOn"]:
                flag_modified(db_task, db_key)

    # progress 補正 (§3.2): status 変更に伴う整合性を API 層で一元的に担保する
    new_status_val = (
        db_task.status.value if hasattr(db_task.status, "value") else db_task.status
    )
    if new_status_val != original_status:
        progress_explicit = "progress" in update_data
        if new_status_val in _COMPLETED_STATUSES:
            # 完了カテゴリ (ap/client_ap/deliver) への遷移は
            # 明示 progress 指定より優先して 100 に強制補正
            db_task.progress = 100
        elif new_status_val in ("mk", "wt"):
            # 未着手・待機への移行は 0 へ強制補正
            db_task.progress = 0
        elif original_status in _COMPLETED_STATUSES and not progress_explicit:
            # 完了カテゴリから非完了へ差し戻す際、progress 未指定なら完了前の値(=既存値)を保持する。
            # ここでは original_progress を書き戻すことで、
            # 前段の setattr で入ったかもしれない値を上書きしない (progress が update_data 未含なので実質NO-OP)
            db_task.progress = original_progress

    # Sync shot_id and shotID depending on what was provided in update_data
    if "shot_id" in update_data:
        if db_task.shot_id is None:
            db_task.shotID = None
        else:
            shot = db.query(models.Shot).filter(models.Shot.id == db_task.shot_id).first()
            if shot:
                db_task.shotID = shot.shot_code
                if not db_task.seqID or db_task.seqID == "SEQ_PM":
                    db_task.seqID = shot.seq_code
            else:
                db_task.shot_id = None
                db_task.shotID = None
    elif "shotID" in update_data:
        if not db_task.shotID:
            db_task.shot_id = None
            db_task.shotID = None
        else:
            db_task.shot_id = _resolve_and_sync_shot_id(db, db_task.project_id, db_task.shot_id, db_task.shotID)
    else:
        # Fallback sync if needed
        if db_task.shot_id is not None:
            shot = db.query(models.Shot).filter(models.Shot.id == db_task.shot_id).first()
            if shot:
                db_task.shotID = shot.shot_code
        elif db_task.shotID:
            db_task.shot_id = _resolve_and_sync_shot_id(db, db_task.project_id, db_task.shot_id, db_task.shotID)

    # 規則: 特定のSHOTに紐づかないタスク (shotID / shot_id が空) の場合、seqID を "SEQ_PM" で統一する
    if not db_task.shotID and not db_task.shot_id:
        db_task.seqID = "SEQ_PM"

    db_task.updated_at = change_time

    # 期日変更の検知と履歴記録
    new_due_date = db_task.due_date
    if new_due_date != original_due_date:
        # NOTE: 既存の TaskStatusHistory（ステータス履歴）では後方互換性のため
        # changed_by が未指定（None）の場合に db_task.assigned_to にフォールバックする
        # 仕様としていますが、期日変更（TaskDueDateHistory）では変更者の誤認防止のため、
        # フォールバックを行わず厳密に actor_id (Noneを含む) のみを登録します。
        db.add(models.TaskDueDateHistory(
            task_id=db_task.id,
            old_due_date=original_due_date,
            new_due_date=new_due_date,
            changed_at=change_time,
            changed_by=actor_id,
            change_source=change_source
        ))
        if new_due_date and db_task.project_id:
            project = db.query(models.Project).filter(models.Project.id == db_task.project_id).first()
            if project and project.end_date and new_due_date > project.end_date:
                project.end_date = new_due_date
                project.updated_at = change_time

    new_status = db_task.status
    if new_status and new_status != original_status:
        new_status_val = (new_status.value if hasattr(new_status, 'value') else str(new_status)).lower()
        # completed_at 制御 (§3.1): 完了カテゴリ集合 {ap, client_ap, deliver} で判定。
        #  - 非完了 → 完了: 新規記録 (completed_at 未設定時のみ)
        #  - 完了 → 完了 (ap→client_ap→deliver): 上書きせず維持
        #  - 完了 → 非完了 (差し戻し): None にリセット
        if new_status_val in _COMPLETED_STATUSES:
            if db_task.completed_at is None:
                db_task.completed_at = db_task.updated_at
        else:
            db_task.completed_at = None

        db.add(models.TaskStatusHistory(
            task_id=db_task.id,
            status=new_status,
            changed_at=change_time,
            changed_by=actor_id if actor_id is not None else db_task.assigned_to,
            change_source='manual'
        ))

        # ステータス遷移通知 (§1.4)
        try:
            _notify_status_change(db, db_task, original_status, new_status_val, actor_id)
        except Exception as e:
            logger.warning(f"ステータス遷移通知の生成に失敗 (task_id={db_task.id}): {e}")

    if db_task.shot_id is not None:
        _recalc_shot_status(db, db_task.shot_id)

    db.commit()
    db.refresh(db_task)
    combined_warnings = [w for w in (transition_warning, assignee_warning) if w]
    db_task.warnings = combined_warnings or None
    return db_task

def bulk_update_tasks(db: Session, task_ids: List[int], updates: dict, actor_id: Optional[int] = None) -> int:
    """複数タスクに同じ更新を適用。更新したタスク数を返す。

    BC-2: status変更を含む場合は all-or-nothing とする。全件を先に検証し、
    1件でも(on モードで)違反があれば何も変更せず TransitionError(違反明細配列込み)を送出する。
    (warn/off モードでは検証しても拒否しないため、通常どおり全件適用する。)
    """
    tasks = db.query(models.Task).filter(models.Task.id.in_(task_ids)).all()

    new_status_raw = updates.get("status")
    if new_status_raw is not None and status_transitions.get_enforce_mode() == "on":
        canonical_to = schemas.canonicalize_task_status(
            new_status_raw.value if hasattr(new_status_raw, "value") else new_status_raw
        )
        violations = []
        for task in tasks:
            original_status = task.status.value if hasattr(task.status, "value") else task.status
            canonical_from = schemas.canonicalize_task_status(original_status)
            if canonical_from == canonical_to:
                continue
            violation = _validate_status_transition(db, actor_id, task.project_id, canonical_from, canonical_to)
            if violation:
                violations.append({"task_id": task.id, **violation})
        if violations:
            raise status_transitions.TransitionError({
                "http_status": 409,
                "error": "bulk_illegal_transition",
                "detail": f"{len(violations)}件のタスクが違法な遷移を含むため、一括更新を中断しました(all-or-nothing)。",
                "violations": violations,
            })

    count = 0
    for task in tasks:
        # updates が dict なので、schemas.TaskUpdate に変換して共通ロジックを通す
        task_update = schemas.TaskUpdate(**updates)
        update_task(db, task, task_update, actor_id=actor_id, change_source=models.TaskChangeSource.BULK_UPDATE)
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


def check_task_view_permission(db: Session, task: models.Task, user: models.User) -> bool:
    """ユーザーが対象タスクを閲覧可能か判断する認可ロジック"""
    # 1. 管理者は常に許可
    if user.role == "admin":
        return True
    
    # 2. タスク単体の表示ステータスチェック
    # タスク自体が offline/archived かつ、ユーザーが担当者ではない場合は閲覧不可
    if task.display_status in ("offline", "archived") and task.assigned_to != user.id:
        # プロジェクト内のロールを持っていないか確認
        role_exists = db.query(models.ScoreUserRole).filter(
            models.ScoreUserRole.user_id == user.id,
            models.ScoreUserRole.project_id == task.project_id
        ).first() is not None
        if not role_exists:
            return False
            
    # 3. 関連プロジェクトの表示ステータスチェック
    # プロジェクトが offline/archived の場合、プロジェクトメンバーか担当者のみ許可
    if task.project_id:
        project = task.project
        if project and project.display_status in ("offline", "archived"):
            if task.assigned_to == user.id:
                return True
            role_exists = db.query(models.ScoreUserRole).filter(
                models.ScoreUserRole.user_id == user.id,
                models.ScoreUserRole.project_id == task.project_id
            ).first() is not None
            return role_exists
            
    return True


def get_task_due_date_history(db: Session, task_id: int, limit: int = 50, offset: int = 0) -> List[models.TaskDueDateHistory]:
    """特定のタスクの期日変更履歴を取得（閲覧権限必須、件数制限付き）"""
    return db.query(models.TaskDueDateHistory)\
             .filter(models.TaskDueDateHistory.task_id == task_id)\
             .order_by(models.TaskDueDateHistory.changed_at.asc(), models.TaskDueDateHistory.id.asc())\
             .offset(offset).limit(limit).all()

