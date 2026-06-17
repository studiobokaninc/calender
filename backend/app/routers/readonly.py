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
