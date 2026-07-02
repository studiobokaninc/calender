"""監査ログ閲覧エンドポイント (サービストークン認可)"""
import os
from fastapi import APIRouter, Depends, Query, HTTPException, Header
from sqlalchemy.orm import Session
from ..database import get_db
from .. import crud

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
    return crud.get_audit_events(db, since=since, limit=limit)
