import logging
import os
from datetime import datetime
from typing import Optional


from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..crud import meetings as crud_meetings
from ..crud.events import collect_with_recurrence
from ..recurrence import RecurrenceError, sort_key_desc
from ..database import get_db
from ..readonly_paging import page_rows
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
    cursor: Optional[str] = Query(default=None, description="続きから取る頁送り。1回目は start、以降は直前の応答の next_cursor をそのまま指定(offset とは併用不可)。この指定時の並びは id 降順"),
    updated_since: Optional[str] = Query(default=None),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.Project)
    dt = _parse_updated_since(updated_since)
    if dt:
        q = q.filter(models.Project.updated_at >= dt)
    total, rows, next_cursor = page_rows(q, models.Project.id, [models.Project.created_at.desc(), models.Project.id.desc()], limit, offset, cursor)
    items = [schemas.ReadonlyProject.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items, next_cursor=next_cursor)


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
    cursor: Optional[str] = Query(default=None, description="続きから取る頁送り。1回目は start、以降は直前の応答の next_cursor をそのまま指定(offset とは併用不可)。この指定時の並びは id 降順"),
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
    total, rows, next_cursor = page_rows(q, models.Shot.id, [models.Shot.created_at.desc(), models.Shot.id.desc()], limit, offset, cursor)
    items = []
    for r in rows:
        s = schemas.ReadonlyShot.from_orm(r)
        s.thumbnail_url = _public_url(s.thumbnail_url)
        items.append(s)
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items, next_cursor=next_cursor)


# ---- Shots ----

@router.get("/shots", response_model=schemas.ReadonlyListResponse)
def list_shots(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    cursor: Optional[str] = Query(default=None, description="続きから取る頁送り。1回目は start、以降は直前の応答の next_cursor をそのまま指定(offset とは併用不可)。この指定時の並びは id 降順"),
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
    total, rows, next_cursor = page_rows(q, models.Shot.id, [models.Shot.created_at.desc(), models.Shot.id.desc()], limit, offset, cursor)
    items = []
    for r in rows:
        s = schemas.ReadonlyShot.from_orm(r)
        s.thumbnail_url = _public_url(s.thumbnail_url)
        items.append(s)
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items, next_cursor=next_cursor)


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
    cursor: Optional[str] = Query(default=None, description="続きから取る頁送り。1回目は start、以降は直前の応答の next_cursor をそのまま指定(offset とは併用不可)。この指定時の並びは id 降順"),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.Task).filter(models.Task.shot_id == shot_id)
    total, rows, next_cursor = page_rows(q, models.Task.id, [models.Task.created_at.desc(), models.Task.id.desc()], limit, offset, cursor)
    items = [schemas.ReadonlyTask.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items, next_cursor=next_cursor)


# ---- Tasks ----

@router.get("/tasks", response_model=schemas.ReadonlyListResponse)
def list_tasks(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    cursor: Optional[str] = Query(default=None, description="続きから取る頁送り。1回目は start、以降は直前の応答の next_cursor をそのまま指定(offset とは併用不可)。この指定時の並びは id 降順"),
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
    total, rows, next_cursor = page_rows(q, models.Task.id, [models.Task.created_at.desc(), models.Task.id.desc()], limit, offset, cursor)
    items = [schemas.ReadonlyTask.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items, next_cursor=next_cursor)


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


@router.get("/tasks/{task_id}/thread", response_model=schemas.ReadonlyTaskThread)
def get_task_thread(
    task_id: int,
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    row = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    return schemas.ReadonlyTaskThread(task_id=task_id, thread_id=row.thread_id)


# ---- Events ----

@router.get("/events", response_model=schemas.ReadonlyListResponse)
def list_events(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    cursor: Optional[str] = Query(default=None, description="続きから取る頁送り。1回目は start、以降は直前の応答の next_cursor をそのまま指定(offset とは併用不可)。この指定時の並びは id 降順"),
    updated_since: Optional[str] = Query(default=None),
    project_id: Optional[int] = Query(default=None),
    start_date: Optional[datetime] = Query(default=None, description="期間の始端 ISO8601。start_date と end_date の両方を指定した時のみ期間絞込み+定例の展開を行う"),
    end_date: Optional[datetime] = Query(default=None, description="期間の終端 ISO8601"),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.Event)
    if project_id is not None:
        q = q.filter(models.Event.project_id == project_id)
    dt = _parse_updated_since(updated_since)
    if dt:
        q = q.filter(models.Event.updated_at >= dt)
    if start_date is not None and end_date is not None:
        if cursor is not None:
            raise HTTPException(status_code=400, detail="start_date/end_date(定例の展開)指定時は cursor を使えません。")
        # 期間指定あり(新引数): 重なりで絞り、定例を展開する。指定なしの従来呼出は下の無改変の経路
        try:
            expanded = collect_with_recurrence(
                q,
                [models.Event.end_time >= start_date, models.Event.start_time <= end_date],
                start_date, end_date,
                keep=lambda s, e: e >= start_date and s <= end_date,
            )
        except RecurrenceError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if expanded is None:
            q = q.filter(models.Event.end_time >= start_date, models.Event.start_time <= end_date)
        else:
            expanded.sort(key=sort_key_desc, reverse=True)
            items = [schemas.ReadonlyEvent.from_orm(r) for r in expanded[offset:offset + limit]]
            return schemas.ReadonlyListResponse(total=len(expanded), limit=limit, offset=offset, items=items)
    total, rows, next_cursor = page_rows(q, models.Event.id, [models.Event.start_time.desc(), models.Event.id.desc()], limit, offset, cursor)
    items = [schemas.ReadonlyEvent.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items, next_cursor=next_cursor)


# ---- Users ----

@router.get("/users", response_model=schemas.ReadonlyListResponse)
def list_users(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    cursor: Optional[str] = Query(default=None, description="続きから取る頁送り。1回目は start、以降は直前の応答の next_cursor をそのまま指定(offset とは併用不可)。この指定時の並びは id 降順"),
    updated_since: Optional[str] = Query(default=None),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.User)
    dt = _parse_updated_since(updated_since)
    if dt:
        q = q.filter(models.User.updated_at >= dt)
    total, rows, next_cursor = page_rows(q, models.User.id, [models.User.created_at.desc(), models.User.id.desc()], limit, offset, cursor)
    items = []
    for r in rows:
        u = schemas.ReadonlyUser.from_orm(r)
        u.avatar_url = _public_url(u.avatar_url)
        items.append(u)
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items, next_cursor=next_cursor)


# ---- Notifications ----

@router.get("/notifications", response_model=schemas.ReadonlyListResponse)
def list_notifications(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    cursor: Optional[str] = Query(default=None, description="続きから取る頁送り。1回目は start、以降は直前の応答の next_cursor をそのまま指定(offset とは併用不可)。この指定時の並びは id 降順"),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.Notification)
    total, rows, next_cursor = page_rows(q, models.Notification.id, [models.Notification.created_at.desc(), models.Notification.id.desc()], limit, offset, cursor)
    items = [schemas.ReadonlyNotification.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items, next_cursor=next_cursor)


# ---- Meetings ----

@router.get("/meetings", response_model=schemas.ReadonlyListResponse)
def list_meetings(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    cursor: Optional[str] = Query(default=None, description="続きから取る頁送り。1回目は start、以降は直前の応答の next_cursor をそのまま指定(offset とは併用不可)。この指定時の並びは id 降順"),
    updated_since: Optional[str] = Query(default=None),
    project_id: Optional[int] = Query(default=None),
    title: Optional[str] = Query(default=None, description="題名の部分一致(大文字小文字を区別しない)"),
    date_from: Optional[str] = Query(default=None, description="会議日の下限(ISO8601・含む)"),
    date_to: Optional[str] = Query(default=None, description="会議日の上限(ISO8601・含む。日付のみなら当日末まで)"),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    try:
        d_from = crud_meetings.parse_date_bound(date_from)
        d_to = crud_meetings.parse_date_bound(date_to, end=True)
    except ValueError:
        raise HTTPException(status_code=400, detail="date_from / date_to は ISO8601 形式で指定してください。")
    q = crud_meetings.filter_meetings(db.query(models.Meeting), project_id, title, d_from, d_to)
    dt = _parse_updated_since(updated_since)
    if dt:
        q = q.filter(models.Meeting.updated_at >= dt)
    total, rows, next_cursor = page_rows(q, models.Meeting.id, [models.Meeting.date.desc(), models.Meeting.id.desc()], limit, offset, cursor)
    items = [schemas.ReadonlyMeeting.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items, next_cursor=next_cursor)


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
    cursor: Optional[str] = Query(default=None, description="続きから取る頁送り。1回目は start、以降は直前の応答の next_cursor をそのまま指定(offset とは併用不可)。この指定時の並びは id 降順"),
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
    total, rows, next_cursor = page_rows(q, models.Decision.id, [models.Decision.date.desc(), models.Decision.id.desc()], limit, offset, cursor)
    items = [schemas.ReadonlyDecision.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items, next_cursor=next_cursor)


# ---- ScoreUserRoles ----

@router.get("/score_user_roles", response_model=schemas.ReadonlyListResponse)
def list_score_user_roles(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    cursor: Optional[str] = Query(default=None, description="続きから取る頁送り。1回目は start、以降は直前の応答の next_cursor をそのまま指定(offset とは併用不可)。この指定時の並びは id 降順"),
    project_id: Optional[int] = Query(default=None),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.ScoreUserRole)
    if project_id is not None:
        q = q.filter(models.ScoreUserRole.project_id == project_id)
    total, rows, next_cursor = page_rows(q, models.ScoreUserRole.id, [models.ScoreUserRole.id.desc()], limit, offset, cursor)
    items = [schemas.ReadonlyScoreUserRole.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items, next_cursor=next_cursor)


# ---- Retakes ----

@router.get("/retakes", response_model=schemas.ReadonlyListResponse)
def list_readonly_retakes(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    cursor: Optional[str] = Query(default=None, description="続きから取る頁送り。1回目は start、以降は直前の応答の next_cursor をそのまま指定(offset とは併用不可)。この指定時の並びは id 降順"),
    shot_id: Optional[int] = Query(default=None),
    status: Optional[str] = Query(default=None),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.Retake)
    if shot_id is not None:
        q = q.filter(models.Retake.shot_id == shot_id)
    if status is not None:
        q = q.filter(models.Retake.status == status)
    total, rows, next_cursor = page_rows(q, models.Retake.id, [models.Retake.created_at.desc(), models.Retake.id.desc()], limit, offset, cursor)
    items = [schemas.ReadonlyRetake.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items, next_cursor=next_cursor)


@router.get("/retakes/{retake_id}", response_model=schemas.ReadonlyRetake)
def get_readonly_retake(
    retake_id: int,
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    row = db.query(models.Retake).filter(models.Retake.id == retake_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Retake not found")
    return schemas.ReadonlyRetake.from_orm(row)


# ---- Assets ----

@router.get("/assets", response_model=schemas.ReadonlyListResponse)
def list_readonly_assets(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    cursor: Optional[str] = Query(default=None, description="続きから取る頁送り。1回目は start、以降は直前の応答の next_cursor をそのまま指定(offset とは併用不可)。この指定時の並びは id 降順"),
    shot_id: Optional[int] = Query(default=None),
    task_id: Optional[int] = Query(default=None),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.Asset)
    if shot_id is not None:
        q = q.filter(models.Asset.shot_id == shot_id)
    if task_id is not None:
        q = q.filter(models.Asset.task_id == task_id)
    total, rows, next_cursor = page_rows(q, models.Asset.id, [models.Asset.created_at.desc(), models.Asset.id.desc()], limit, offset, cursor)
    items = []
    for r in rows:
        a = schemas.ReadonlyAsset.from_orm(r)
        a.filename = os.path.basename(r.file_path) if r.file_path else None
        a.file_path = _public_url(a.file_path)
        items.append(a)
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items, next_cursor=next_cursor)


# ---- Task Status History ----

@router.get("/task_status_history", response_model=schemas.ReadonlyListResponse)
def list_readonly_task_status_history(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    cursor: Optional[str] = Query(default=None, description="続きから取る頁送り。1回目は start、以降は直前の応答の next_cursor をそのまま指定(offset とは併用不可)。この指定時の並びは id 降順"),
    task_id: Optional[int] = Query(default=None),
    project_id: Optional[int] = Query(default=None),
    _: None = Depends(verify_readonly_token),
    db: Session = Depends(get_db),
):
    q = db.query(models.TaskStatusHistory)
    if task_id is not None:
        q = q.filter(models.TaskStatusHistory.task_id == task_id)
    if project_id is not None:
        q = q.join(models.Task, models.TaskStatusHistory.task_id == models.Task.id).filter(
            models.Task.project_id == project_id
        )
    total, rows, next_cursor = page_rows(q, models.TaskStatusHistory.id, [models.TaskStatusHistory.changed_at.desc(), models.TaskStatusHistory.id.desc()], limit, offset, cursor)
    items = [schemas.ReadonlyTaskStatusHistory.from_orm(r) for r in rows]
    return schemas.ReadonlyListResponse(total=total, limit=limit, offset=offset, items=items, next_cursor=next_cursor)



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

    # 1. オンラインプロジェクトに紐づき、かつ wt 以外のタスクを対象にする
    q = db.query(models.Task).join(models.Project, models.Task.project_id == models.Project.id)
    q = q.filter(models.Project.display_status == 'online')
    q = q.filter(~func.lower(models.Task.status).in_(['wt']))

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
