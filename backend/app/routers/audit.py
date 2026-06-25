"""監査ログ閲覧エンドポイント (サービストークン認可)"""
import os
from fastapi import APIRouter, Depends, Query, HTTPException, Header
from sqlalchemy.orm import Session
from sqlalchemy import select
from ..database import get_db
from ..models import AuditLog

router = APIRouter(prefix="/audit", tags=["audit"])


def _check_service_token(authorization: str = Header(None)) -> bool:
    """サービストークン検証。CALENDER_SERVICE_TOKEN と一致すれば True。"""
    svc_token = os.getenv("CALENDER_SERVICE_TOKEN", "")
    if not svc_token:
        return False
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:].strip() == svc_token
    return False


@router.get("/logs")
def get_audit_logs(
    since: int = Query(0, description="この seq-id より大きいものを返す (カーソル)"),
    limit: int = Query(100, le=500, description="最大取得件数 (上限500)"),
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    """サービストークン (CALENDER_SERVICE_TOKEN) のみアクセス可。
    Casper確定認可: 集約専用token1本・全user event meta読取専用・PII不可。"""
    if not _check_service_token(authorization):
        raise HTTPException(status_code=403, detail="CALENDER_SERVICE_TOKEN required")
    stmt = (
        select(AuditLog)
        .where(AuditLog.id > since)
        .order_by(AuditLog.id.asc())
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
