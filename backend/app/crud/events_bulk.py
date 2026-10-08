"""予定の一括更新・一括削除(cmd_731 四)。

雛形は crud/tasks.py の bulk_update_tasks: 全件を先に検証し、1件でも違反があれば
1件も変えずに EventBulkError を送出する(all-or-nothing)。検証を通ったら単一トランザクションで
適用し、commit は最後に1回だけ行う(途中で失敗すれば rollback して全件無変更)。
"""
import logging
from typing import Any, Dict, List, Optional

from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models, recurrence, schemas
from ..timezone import now_jst_naive
from .base import _parse_datetime
from .events import _apply_date_time_fields

logger = logging.getLogger(__name__)

# 一括の対象件数の上限。webhook を1件ずつ直列に送るため、暴れぬよう上限を設ける。
MAX_BULK_EVENTS = 200


class EventBulkUpdateRequest(schemas.EventUpdate):
    """一括更新: 指定した予定に同じ項目を適用(EventUpdate と同じ項目 + event_ids)"""
    event_ids: List[int]


class EventBulkDeleteRequest(BaseModel):
    """一括削除"""
    event_ids: List[int]


class EventBulkError(Exception):
    """一括操作の検証違反。detail は HTTP 応答の detail にそのまま載せる dict。"""

    def __init__(self, http_status: int, detail: Dict[str, Any]):
        super().__init__(detail.get("detail", ""))
        self.http_status = http_status
        self.detail = detail


def collect_updates(payload: EventBulkUpdateRequest) -> Dict[str, Any]:
    """リクエストから更新項目を取り出す(tasks の bulk-update と同じく None は無指定扱い)。"""
    raw = payload.dict(exclude_unset=True, exclude={"event_ids"})
    return {k: v for k, v in raw.items() if v is not None}


def _unique_ids(event_ids: List[int]) -> List[int]:
    return list(dict.fromkeys(event_ids))


def _check_count(ids: List[int]) -> None:
    if len(ids) > MAX_BULK_EVENTS:
        raise EventBulkError(400, {
            "error": "bulk_too_many_events",
            "detail": f"一括操作の上限は{MAX_BULK_EVENTS}件です({len(ids)}件が指定されました)。",
            "violations": [],
        })


def _load_all(db: Session, ids: List[int]) -> List[models.Event]:
    """全件を取得。1件でも無ければ何も変えず EventBulkError(409)。"""
    events = db.query(models.Event).filter(models.Event.id.in_(ids)).all()
    found = {e.id for e in events}
    missing = [i for i in ids if i not in found]
    if missing:
        raise EventBulkError(409, {
            "error": "bulk_event_not_found",
            "detail": f"{len(missing)}件の予定が存在しないため、一括操作を中断しました(all-or-nothing)。",
            "violations": [{"event_id": i, "reason": "not_found"} for i in missing],
        })
    by_id = {e.id: e for e in events}
    return [by_id[i] for i in ids]


def _plan_update(event: models.Event, updates: Dict[str, Any]) -> Dict[str, Any]:
    """1件分の更新後の値(DB列のみ)を、DBに触れずに計算する。単体 update_event と同じ組み立て。"""
    plan = dict(updates)
    _apply_date_time_fields(plan, event.start_time, event.end_time, event.allDay or False)
    for key in ("start_time", "end_time"):
        if key in plan:
            plan[key] = _parse_datetime(plan[key])
    return plan


def bulk_update_events(
    db: Session,
    event_ids: List[int],
    updates: Dict[str, Any],
    is_admin: bool,
) -> List[models.Event]:
    """複数予定に同じ更新を適用。更新した予定のリストを返す。

    all-or-nothing: 存在しないID・権限違反・不正な値・時刻の逆転が1件でもあれば何も変更しない。
    権限は単体 PUT に揃える(status を実際に変える場合は admin のみ)。
    """
    ids = _unique_ids(event_ids)
    _check_count(ids)
    events = _load_all(db, ids)

    violations: List[Dict[str, Any]] = []

    # 値そのものの検証(全件共通)
    if "type" in updates:
        valid_types = {t.value for t in models.EventType}
        raw_type = updates["type"].value if hasattr(updates["type"], "value") else updates["type"]
        if raw_type not in valid_types:
            violations.append({"event_id": None, "reason": "invalid_type", "value": str(raw_type)})
    if updates.get("project_id") is not None:
        if db.query(models.Project.id).filter(models.Project.id == updates["project_id"]).first() is None:
            violations.append({"event_id": None, "reason": "project_not_found", "value": updates["project_id"]})

    # 権限(status 変更は admin のみ。実際に値が変わる予定がある時だけ)。
    # 他の違反が混じっても 403 を優先する(単体の権限判定と揃える)。
    if "status" in updates and not is_admin:
        forbidden = [{"event_id": e.id, "reason": "status_change_forbidden"}
                     for e in events if e.status != updates["status"]]
        if forbidden:
            raise EventBulkError(403, {
                "error": "bulk_forbidden",
                "detail": "イベントステータスを変更する権限がありません",
                "violations": forbidden,
            })

    plans: Dict[int, Dict[str, Any]] = {}
    for e in events:
        plan = _plan_update(e, updates)
        plans[e.id] = plan
        new_start = plan.get("start_time", e.start_time)
        new_end = plan.get("end_time", e.end_time)
        if new_start is not None and new_end is not None and new_end < new_start:
            violations.append({"event_id": e.id, "reason": "end_before_start"})
        # 定例の整合(単体 update_event と同じ条件・同じ検査)
        if "recurrence_rule" in plan or "start_time" in plan:
            new_rule = (plan["recurrence_rule"] or None) if "recurrence_rule" in plan else e.recurrence_rule
            try:
                recurrence.validate_rule_for_start(new_rule, new_start)
            except recurrence.RecurrenceError as exc:
                violations.append({"event_id": e.id, "reason": "recurrence_invalid", "message": str(exc)})
        if "recurrence_rule" in plan:
            plan["recurrence_rule"] = plan["recurrence_rule"] or None

    if violations:
        raise EventBulkError(409, {
            "error": "bulk_event_validation_failed",
            "detail": f"{len(violations)}件の違反があるため、一括更新を中断しました(all-or-nothing)。",
            "violations": violations,
        })

    # 適用(commit は最後に1回。失敗すれば全件 rollback)
    now = now_jst_naive()
    try:
        for e in events:
            for key, value in plans[e.id].items():
                if hasattr(e, key):
                    setattr(e, key, value)
            if (not e.user_ids or len(e.user_ids) == 0) and e.participants:
                from .events import _derive_user_ids_from_participants
                derived = _derive_user_ids_from_participants(e.participants)
                if derived:
                    e.user_ids = derived
            e.updated_at = now
        db.commit()
    except Exception:
        db.rollback()
        raise
    for e in events:
        db.refresh(e)
    return events


def validate_bulk_delete(db: Session, event_ids: List[int], is_admin: bool) -> List[models.Event]:
    """一括削除の検証のみ(何も変更しない)。非 admin・上限超過・存在せぬIDがあれば EventBulkError。"""
    ids = _unique_ids(event_ids)
    _check_count(ids)
    if not is_admin:
        raise EventBulkError(403, {
            "error": "bulk_forbidden",
            "detail": "イベントを削除する権限がありません",
            "violations": [],
        })
    return _load_all(db, ids)


def bulk_delete_events(db: Session, event_ids: List[int], is_admin: bool) -> List[Dict[str, Any]]:
    """複数予定を削除。削除した予定の webhook 用 payload(削除前に採取)を返す。

    all-or-nothing: 非 admin、または存在しないIDが1件でもあれば何も消さない。
    Google側の同期解除は呼び出し側(router)が削除前に1回のトークン取得でまとめて行う。
    """
    events = validate_bulk_delete(db, event_ids, is_admin)
    payloads = [{
        "event_id": e.id,
        "title": e.title,
        "start_at": e.start_time.isoformat() if e.start_time else None,
        "end_at": e.end_time.isoformat() if e.end_time else None,
        "attendees": e.user_ids or [],
    } for e in events]
    try:
        for e in events:
            db.delete(e)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return payloads


def event_webhook_payload(event: models.Event, updated_by: Optional[int]) -> Dict[str, Any]:
    """単体 PUT /events/{id} の event.updated payload と同一の形(キー・値とも変えない)。"""
    return {
        "event_id": event.id,
        "title": event.title,
        "start_at": event.start_time.isoformat() if event.start_time else None,
        "end_at": event.end_time.isoformat() if event.end_time else None,
        "attendees": event.user_ids or [],
        "description": event.description,
        "location": event.location,
        "zoom_url": event.meeting_url,
        "updated_by": updated_by,
    }


async def send_webhooks_serial(items: List[tuple]) -> None:
    """(event_type, payload) の列を1本のバックグラウンド処理で直列に送る。
    先方の受け口は単体と同じ event.updated / event.deleted と payload の形のまま受け取る。
    send_webhook は例外を伝播させぬ設計ゆえ、1件の失敗が残りを止めぬ。"""
    from app.utils.webhook_sender import send_webhook
    for event_type, payload in items:
        await send_webhook(event_type, payload)
