import logging
import re
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, Response
from sqlalchemy.orm import Session

from .. import models, schemas, security
from ..database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/shots", tags=["Shots"])

# seq_code: 1〜50文字の英数字・アンダースコア・ハイフン（大文字小文字不問）
# 例: seq01, C, OP, SQ001, A, ep01, scene-1
SEQ_CODE_REGEX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]{0,49}$")

# shot_code: 1〜50文字の英数字・アンダースコア・ハイフン（大文字小文字不問）
# 例: shot010, C001, 0010, shot_01, 001
SHOT_CODE_REGEX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]{0,49}$")

@router.get("", response_model=List[schemas.ShotResponse])
def get_shots(
    project_id: Optional[int] = Query(None, description="プロジェクトIDでフィルタ"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    query = db.query(models.Shot)
    if project_id is not None:
        query = query.filter(models.Shot.project_id == project_id)
    return query.all()

@router.get("/{id}", response_model=schemas.ShotResponse)
def get_shot(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    shot = db.query(models.Shot).filter(models.Shot.id == id).first()
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")
    return shot

@router.post("", response_model=schemas.ShotResponse, status_code=status.HTTP_201_CREATED)
def create_shot(
    shot_in: schemas.ShotCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    if not SEQ_CODE_REGEX.match(shot_in.seq_code):
        raise HTTPException(status_code=400, detail="Invalid seq_code format")
    if not SHOT_CODE_REGEX.match(shot_in.shot_code):
        raise HTTPException(status_code=400, detail="Invalid shot_code format")

    # UNIQUEチェック
    existing = db.query(models.Shot).filter(
        models.Shot.project_id == shot_in.project_id,
        models.Shot.seq_code == shot_in.seq_code,
        models.Shot.shot_code == shot_in.shot_code
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Shot with same project_id, seq_code, shot_code already exists")

    new_shot = models.Shot(
        project_id=shot_in.project_id,
        seq_code=shot_in.seq_code,
        shot_code=shot_in.shot_code,
        display_order=shot_in.display_order,
        status=shot_in.status,
        thumbnail_url=shot_in.thumbnail_url,
        description=shot_in.description
    )
    db.add(new_shot)
    db.commit()
    db.refresh(new_shot)
    return new_shot

@router.patch("/{id}", response_model=schemas.ShotResponse)
def update_shot(
    id: int,
    shot_in: schemas.ShotUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    shot = db.query(models.Shot).filter(models.Shot.id == id).first()
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")

    if shot_in.seq_code is not None:
        if not SEQ_CODE_REGEX.match(shot_in.seq_code):
            raise HTTPException(status_code=400, detail="Invalid seq_code format")
        shot.seq_code = shot_in.seq_code

    if shot_in.shot_code is not None:
        if not SHOT_CODE_REGEX.match(shot_in.shot_code):
            raise HTTPException(status_code=400, detail="Invalid shot_code format")
        shot.shot_code = shot_in.shot_code

    # Unique check if seq_code or shot_code changed
    if shot_in.seq_code is not None or shot_in.shot_code is not None:
        existing = db.query(models.Shot).filter(
            models.Shot.project_id == shot.project_id,
            models.Shot.seq_code == shot.seq_code,
            models.Shot.shot_code == shot.shot_code,
            models.Shot.id != id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Shot with same project_id, seq_code, shot_code already exists")

    if shot_in.display_order is not None:
        shot.display_order = shot_in.display_order
    if shot_in.status is not None:
        shot.status = shot_in.status
    if shot_in.thumbnail_url is not None:
        shot.thumbnail_url = shot_in.thumbnail_url
    if shot_in.description is not None:
        shot.description = shot_in.description

    db.commit()
    db.refresh(shot)
    return shot

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shot(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    shot = db.query(models.Shot).filter(models.Shot.id == id).first()
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")

    # 紐づく task の shot_id は NULL になる
    db.query(models.Task).filter(models.Task.shot_id == id).update({"shot_id": None})
    db.delete(shot)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@router.get("/{id}/tasks", response_model=List[schemas.TaskResponse])
def get_shot_tasks(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    shot = db.query(models.Shot).filter(models.Shot.id == id).first()
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")
    tasks = db.query(models.Task).filter(models.Task.shot_id == id).all()
    return tasks

@router.get("/{id}/progress", response_model=schemas.ShotProgressResponse)
def get_shot_progress(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    shot = db.query(models.Shot).filter(models.Shot.id == id).first()
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")

    tasks = db.query(models.Task).filter(models.Task.shot_id == id).all()
    total = len(tasks)
    if total == 0:
        return schemas.ShotProgressResponse(
            shot_id=id,
            total_tasks=0,
            completed_tasks=0,
            average_progress=0.0
        )

    completed = sum(1 for t in tasks if t.status == models.TaskStatus.COMPLETED)
    total_prog = sum(t.progress if t.progress is not None else (100 if t.status == models.TaskStatus.COMPLETED else 0) for t in tasks)
    avg_prog = total_prog / total

    return schemas.ShotProgressResponse(
        shot_id=id,
        total_tasks=total,
        completed_tasks=completed,
        average_progress=avg_prog
    )
