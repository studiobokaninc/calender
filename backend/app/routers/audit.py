"""監査ログ閲覧エンドポイント (サービストークン認可)"""
import os
from datetime import date as date_type, datetime, timedelta
from fastapi import APIRouter, Depends, Query, HTTPException, Header
from sqlalchemy.orm import Session
from ..database import get_db
from .. import crud, models

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


@router.get("/usage-summary")
def get_usage_summary(
    cycle_date: date_type = Query(
        ...,
        description="集計対象の周期日(YYYY-MM-DD)。JST 5:00起点の1日を指す(models.UserActivity.cycle_date準拠)。",
    ),
    authorization: str = Header(None),
    db: Session = Depends(get_db),
):
    """サービストークン (CALENDER_SERVICE_TOKEN) のみアクセス可。読取専用。
    Calendar利用状況(打刻user_activities・操作ログaudit_logs)をユーザー毎に集計して返す。
    Casper確定認可: 集約専用token1本・全user event meta読取専用・PII不可(名前/user_idのみ)。

    ★cycle_dateの意味: user_activities.cycle_dateはJST朝5:00を境界とした「周期日」
    (models.py:368の既存定義)。本APIのcycle_dateもこれに合わせ、集計ウィンドウは
    「cycle_dateの05:00:00」から「翌日05:00:00」の手前まで(JST, naive)。
    例: cycle_date=2026-08-05 なら 2026-08-05T05:00:00 〜 2026-08-06T04:59:59.999999。

    ★打刻数(user_activities count)は5分毎のハートビートであり、タブ/端末を複数開けば
    比例して膨らむ。打刻数だけで利用量を判断せず、必ずfirst_at/last_atの幅と併せて読むこと。
    """
    if not _check_service_token(authorization):
        raise HTTPException(status_code=403, detail="CALENDER_SERVICE_TOKEN required")

    window_start = datetime.combine(cycle_date, datetime.min.time()).replace(hour=5)
    window_end = window_start + timedelta(days=1)

    activity_rows = crud.get_user_activity_counts(db, window_start)
    action_rows = crud.get_audit_action_counts(db, window_start, window_end)

    user_ids = {uid for uid, _count, _first, _last in activity_rows}
    user_ids |= {uid for uid, _action, _count in action_rows if uid is not None}

    names = {}
    if user_ids:
        for u in db.query(models.User).filter(models.User.id.in_(user_ids)).all():
            names[u.id] = (u.name or "").strip() or u.username or f"user#{u.id}"

    def display_name(uid: int) -> str:
        return names.get(uid, f"user#{uid}")

    user_activities = sorted(
        (
            {
                "user_id": uid,
                "name": display_name(uid),
                "count": count,
                "first_at": first_at.isoformat() if first_at else None,
                "last_at": last_at.isoformat() if last_at else None,
            }
            for uid, count, first_at, last_at in activity_rows
        ),
        key=lambda r: r["count"],
        reverse=True,
    )

    by_user: dict = {}
    system_actions: dict = {}
    for uid, action, count in action_rows:
        if uid is None:
            system_actions[action] = system_actions.get(action, 0) + count
            continue
        entry = by_user.setdefault(
            uid, {"user_id": uid, "name": display_name(uid), "actions": {}, "total": 0}
        )
        entry["actions"][action] = entry["actions"].get(action, 0) + count
        entry["total"] += count

    audit_by_user = sorted(by_user.values(), key=lambda r: r["total"], reverse=True)

    return {
        "cycle_date": cycle_date.isoformat(),
        "window_note": (
            "cycle_dateはJST 5:00起点の周期日(models.UserActivity.cycle_date準拠)。"
            "集計対象は当日05:00:00〜翌日04:59:59.999999(JST, naive)。"
        ),
        "window": {"start": window_start.isoformat(), "end": window_end.isoformat()},
        "user_activities": user_activities,
        "audit_logs": {
            "note": "actor_uidがNULLの行(system.error等)はsystem_eventsに分離し、ユーザーの活動として数えない。",
            "by_user": audit_by_user,
            "system_events": {"actions": system_actions, "total": sum(system_actions.values())},
        },
    }
