from datetime import datetime
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from .. import models


def get_audit_action_counts(db: Session, start: datetime, end: datetime) -> list:
    """[start, end) の範囲(ts列, JST naive)でaudit_logsをactor_uid×action別に集計。
    actor_uidがNULLの行(system.error等)もそのまま返す(呼び出し側で分離すること)。"""
    stmt = (
        select(models.AuditLog.actor_uid, models.AuditLog.action, func.count(models.AuditLog.id))
        .where(models.AuditLog.ts >= start, models.AuditLog.ts < end)
        .group_by(models.AuditLog.actor_uid, models.AuditLog.action)
    )
    return db.execute(stmt).all()


def get_audit_events(db: Session, since: int = 0, limit: int = 100) -> dict:
    """監査イベントの増分取得。since=カーソル(seq), limit=最大件数(上限500固定)。"""
    limit = min(limit, 500)
    stmt = (
        select(models.AuditLog)
        .where(models.AuditLog.id > since)
        .order_by(models.AuditLog.id.asc())
        .limit(limit)
    )
    logs = db.execute(stmt).scalars().all()
    events = [
        {
            "seq": e.id,
            "event_id": f"calendar-{e.id}",
            "system": "calendar",
            "ts": e.ts.isoformat() if e.ts else None,
            "actor_uid": e.actor_uid,
            "action": e.action,
            "target_type": e.target_type,
            "target_id": e.target_id,
            "detail": e.detail,
            "level": e.level,
        }
        for e in logs
    ]
    next_cursor = logs[-1].id if logs else since
    return {"events": events, "next_cursor": next_cursor}
