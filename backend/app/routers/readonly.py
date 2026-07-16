import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..security import verify_readonly_token

logger = logging.getLogger(__name__)

router = APIRouter()


def _public_url(url: Optional[str]) -> Optional[str]:
    """Return url only if HTTP/HTTPS; local paths return None (§4.5)."""
    if url and (url.startswith("http://") or url.startswith("https://")):
        return url
    return None


def _parse_updated_since(value: Optional[str]) -> Optional[datetime]:
    if value is None:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail="updated_since は ISO8601 形式で指定してください。")


# ---- Projects ----

@router.get("/projects", response_model=schemas.ReadonlyListResponse)
def list_projects(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    updated_since: Optional[str] = Query(default=None),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.Project)
    dt = _parse_updated_since(updated_since)
    if dt:
        q = q.filter(models.Project.updated_at >= dt)
    total = q.count()
    rows = q.offset(offset).limit(limit).all()
    items = [schemas.ReadonlyProject.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items)


@router.get("/projects/{project_id}", response_model=schemas.ReadonlyProject)
def get_project(
    project_id: int,
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    row = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    return schemas.ReadonlyProject.from_orm(row)


@router.get("/projects/{project_id}/shots", response_model=schemas.ReadonlyListResponse)
def list_project_shots(
    project_id: int,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    updated_since: Optional[str] = Query(default=None),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.Shot).filter(
        models.Shot.project_id == project_id,
        models.Shot.is_deleted == False,
    )
    dt = _parse_updated_since(updated_since)
    if dt:
        q = q.filter(models.Shot.updated_at >= dt)
    total = q.count()
    rows = q.offset(offset).limit(limit).all()
    items = []
    for r in rows:
        s = schemas.ReadonlyShot.from_orm(r)
        s.thumbnail_url = _public_url(s.thumbnail_url)
        items.append(s)
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items)


# ---- Shots ----

@router.get("/shots", response_model=schemas.ReadonlyListResponse)
def list_shots(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    updated_since: Optional[str] = Query(default=None),
    project_id: Optional[int] = Query(default=None),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.Shot).filter(models.Shot.is_deleted == False)
    if project_id is not None:
        q = q.filter(models.Shot.project_id == project_id)
    dt = _parse_updated_since(updated_since)
    if dt:
        q = q.filter(models.Shot.updated_at >= dt)
    total = q.count()
    rows = q.offset(offset).limit(limit).all()
    items = []
    for r in rows:
        s = schemas.ReadonlyShot.from_orm(r)
        s.thumbnail_url = _public_url(s.thumbnail_url)
        items.append(s)
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items)


@router.get("/shots/{shot_id}", response_model=schemas.ReadonlyShot)
def get_shot(
    shot_id: int,
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    row = db.query(models.Shot).filter(
        models.Shot.id == shot_id,
        models.Shot.is_deleted == False,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Shot not found")
    s = schemas.ReadonlyShot.from_orm(row)
    s.thumbnail_url = _public_url(s.thumbnail_url)
    return s


@router.get("/shots/{shot_id}/tasks", response_model=schemas.ReadonlyListResponse)
def list_shot_tasks(
    shot_id: int,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.Task).filter(models.Task.shot_id == shot_id)
    total = q.count()
    rows = q.offset(offset).limit(limit).all()
    items = [schemas.ReadonlyTask.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items)


# ---- Tasks ----

@router.get("/tasks", response_model=schemas.ReadonlyListResponse)
def list_tasks(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    updated_since: Optional[str] = Query(default=None),
    project_id: Optional[int] = Query(default=None),
    shot_id: Optional[int] = Query(default=None),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.Task)
    if project_id is not None:
        q = q.filter(models.Task.project_id == project_id)
    if shot_id is not None:
        q = q.filter(models.Task.shot_id == shot_id)
    dt = _parse_updated_since(updated_since)
    if dt:
        q = q.filter(models.Task.updated_at >= dt)
    total = q.count()
    rows = q.offset(offset).limit(limit).all()
    items = [schemas.ReadonlyTask.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items)


@router.get("/tasks/{task_id}", response_model=schemas.ReadonlyTask)
def get_task(
    task_id: int,
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    row = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    return schemas.ReadonlyTask.from_orm(row)


# ---- Events ----

@router.get("/events", response_model=schemas.ReadonlyListResponse)
def list_events(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    updated_since: Optional[str] = Query(default=None),
    project_id: Optional[int] = Query(default=None),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.Event)
    if project_id is not None:
        q = q.filter(models.Event.project_id == project_id)
    dt = _parse_updated_since(updated_since)
    if dt:
        q = q.filter(models.Event.updated_at >= dt)
    total = q.count()
    rows = q.offset(offset).limit(limit).all()
    items = [schemas.ReadonlyEvent.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items)


# ---- Users ----

@router.get("/users", response_model=schemas.ReadonlyListResponse)
def list_users(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    updated_since: Optional[str] = Query(default=None),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.User)
    dt = _parse_updated_since(updated_since)
    if dt:
        q = q.filter(models.User.updated_at >= dt)
    total = q.count()
    rows = q.offset(offset).limit(limit).all()
    items = []
    for r in rows:
        u = schemas.ReadonlyUser.from_orm(r)
        u.avatar_url = _public_url(u.avatar_url)
        items.append(u)
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items)


# ---- Notifications ----

@router.get("/notifications", response_model=schemas.ReadonlyListResponse)
def list_notifications(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.Notification)
    total = q.count()
    rows = q.offset(offset).limit(limit).all()
    items = [schemas.ReadonlyNotification.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items)


# ---- Meetings ----

@router.get("/meetings", response_model=schemas.ReadonlyListResponse)
def list_meetings(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    updated_since: Optional[str] = Query(default=None),
    project_id: Optional[int] = Query(default=None),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.Meeting)
    if project_id is not None:
        q = q.filter(models.Meeting.project_id == project_id)
    dt = _parse_updated_since(updated_since)
    if dt:
        q = q.filter(models.Meeting.updated_at >= dt)
    total = q.count()
    rows = q.offset(offset).limit(limit).all()
    items = [schemas.ReadonlyMeeting.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items)


@router.get("/meetings/{meeting_id}", response_model=schemas.ReadonlyMeeting)
def get_meeting(
    meeting_id: int,
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    row = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return schemas.ReadonlyMeeting.from_orm(row)


# ---- Decisions ----

@router.get("/decisions", response_model=schemas.ReadonlyListResponse)
def list_decisions(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    project_id: Optional[int] = Query(default=None),
    meeting_id: Optional[int] = Query(default=None),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.Decision)
    if project_id is not None:
        q = q.filter(models.Decision.project_id == project_id)
    if meeting_id is not None:
        q = q.filter(models.Decision.meeting_id == meeting_id)
    total = q.count()
    rows = q.offset(offset).limit(limit).all()
    items = [schemas.ReadonlyDecision.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items)


# ---- ScoreUserRoles ----

@router.get("/score_user_roles", response_model=schemas.ReadonlyListResponse)
def list_score_user_roles(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    project_id: Optional[int] = Query(default=None),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.ScoreUserRole)
    if project_id is not None:
        q = q.filter(models.ScoreUserRole.project_id == project_id)
    total = q.count()
    rows = q.offset(offset).limit(limit).all()
    items = [schemas.ReadonlyScoreUserRole.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items)


# ---- Task status metadata ----

@router.get("/task-statuses", response_model=list[dict])
def get_task_statuses(
    _: None = Depends(verify_readonly_token),
):
    """ステータスメタデータ一覧 (凡例・フィルタ・ピッカー用)"""
    from app.status_meta import STATUS_META_LIST
    return STATUS_META_LIST


@router.get("/onschedule")
def get_onschedule_stats(
    group_by: Optional[str] = Query(default=None, description="group_by fields, e.g., 'assignee', 'type', or 'assignee,type'"),
    project_id: Optional[int] = Query(default=None),
    assignee_id: Optional[int] = Query(default=None),
    type: Optional[str] = Query(default=None),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    """オンスケ率の統計情報を集計して取得する"""
    from sqlalchemy import func
    import math

    # 1. オンラインプロジェクトに紐づき、かつ omit/wt 以外のタスクを対象にする
    q = db.query(models.Task).join(models.Project, models.Task.project_id == models.Project.id)
    q = q.filter(models.Project.display_status == 'online')
    q = q.filter(~func.lower(models.Task.status).in_(['omit', 'wt']))

    # フィルタ
    if project_id is not None:
        q = q.filter(models.Task.project_id == project_id)
    if assignee_id is not None:
        q = q.filter(models.Task.assigned_to == assignee_id)
    if type is not None:
        q = q.filter(models.Task.type == type)

    tasks = q.all()

    # ユーザー表示名解決用の辞書
    users_dict = {u.id: u.full_name or u.username for u in db.query(models.User).all()}

    # グルーピングキーのパース
    group_keys = []
    if group_by:
        group_keys = [k.strip() for k in group_by.split(",") if k.strip()]

    # 集計処理
    from app.status_meta import COMPLETED_STATUSES
    groups = {}
    for task in tasks:
        gk = []
        for key in group_keys:
            if key == "assignee":
                gk.append(str(task.assigned_to or "unassigned"))
            elif key == "type":
                gk.append(str(task.type or "other"))
            else:
                gk.append("all")
        
        gk_tuple = tuple(gk)
        if gk_tuple not in groups:
            groups[gk_tuple] = {
                "completed": 0,
                "on_time": 0,
                "assignee_id": task.assigned_to if "assignee" in group_keys else None,
                "assignee_name": users_dict.get(task.assigned_to) if "assignee" in group_keys and task.assigned_to else None,
                "type": task.type if "type" in group_keys else None,
            }
        
        status_str = task.status.value if hasattr(task.status, 'value') else str(task.status or '')
        if status_str.lower() in COMPLETED_STATUSES:
            groups[gk_tuple]["completed"] += 1
            # 期日内完了の判定
            is_on_time_task = True
            if task.due_date:
                if task.completed_at:
                    is_on_time_task = (task.completed_at.date() <= task.due_date.date())
                else:
                    is_on_time_task = (task.updated_at.date() <= task.due_date.date()) if task.updated_at else False
            if is_on_time_task:
                groups[gk_tuple]["on_time"] += 1

    results = []
    for gk_tuple, data in groups.items():
        n = data["completed"]
        on_time = data["on_time"]
        rate = round(on_time / n, 3) if n > 0 else None
        
        # Wilsonスコア区間計算 (95% 信頼区間)
        if n > 0:
            p = on_time / n
            z = 1.96
            denominator = 1 + z**2 / n
            center = (p + z**2 / (2 * n)) / denominator
            spread = z * math.sqrt((p * (1 - p) / n) + (z**2 / (4 * n**2))) / denominator
            ci_lower = max(0.0, center - spread)
            ci_upper = min(1.0, center + spread)
            ci = [round(ci_lower, 3), round(ci_upper, 3)]
        else:
            ci = [0.0, 1.0]

        results.append({
            "assignee_id": data["assignee_id"],
            "assignee_name": data["assignee_name"],
            "type": data["type"],
            "completed": n,
            "on_time": on_time,
            "rate": rate,
            "n": n,
            "ci": ci
        })

    # ソートして決定論的に返す
    results.sort(key=lambda x: (x["assignee_name"] or "", x["type"] or ""))
    return results
