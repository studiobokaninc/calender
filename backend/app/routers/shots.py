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

# shot_code: 1〜50文字。先頭・末尾は英数字、中間に URLセーフ記号（. _ ~ -）を許可（大文字小文字不問）。
# 案B緩和（cmd_496 / 殿御裁可 2026-06-12）: 型縛りを緩め、中間ドット等URLセーフ記号を許可（例 c01.v2）。
# 末尾を英数字に固定することで、cmd_493 で除外確定した末尾ドット値（例 "LookDev."）は引き続き排除し、
# 空白・日本語・スラッシュ・バックスラッシュ・% 等のSQL/URL/制御危険文字も除外。
# （score.py の Notification.body.contains(shot_code) fuzzy join を空文字/危険文字から守るため非空＋文字種を維持。）
# 例: shot010, C001, shot_01, c01.v2 / 不可: "LookDev."(末尾ドット), "data deriver"(空白), 日本語
SHOT_CODE_REGEX = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9._~\-]{0,48}[A-Za-z0-9])?$")

@router.get("", response_model=List[schemas.ShotResponse])
def get_shots(
    project_id: Optional[int] = Query(None, description="プロジェクトIDでフィルタ"),
    include_deleted: bool = Query(False, description="論理削除済みshotを含める"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    query = db.query(models.Shot)
    if project_id is not None:
        query = query.filter(models.Shot.project_id == project_id)
    if not include_deleted:
        query = query.filter(models.Shot.is_deleted == False)  # noqa: E712
    shots = query.order_by(models.Shot.display_order).all()
    return shots

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
    # status は自動導出値のため手動更新を無視
    if shot_in.thumbnail_url is not None:
        shot.thumbnail_url = shot_in.thumbnail_url
    if shot_in.description is not None:
        shot.description = shot_in.description
    if shot_in.cut is not None:
        shot.cut = shot_in.cut
    if shot_in.sl_no is not None:
        shot.sl_no = shot_in.sl_no
    if shot_in.frame_in is not None:
        shot.frame_in = shot_in.frame_in
    if shot_in.frame_out is not None:
        shot.frame_out = shot_in.frame_out
    if shot_in.duration is not None:
        shot.duration = shot_in.duration
    if shot_in.second is not None:
        shot.second = shot_in.second
    if shot_in.frame_rem is not None:
        shot.frame_rem = shot_in.frame_rem
    if shot_in.action is not None:
        shot.action = shot_in.action
    if shot_in.dialogue is not None:
        shot.dialogue = shot_in.dialogue
    if shot_in.bg is not None:
        shot.bg = shot_in.bg
    if shot_in.ch is not None:
        shot.ch = shot_in.ch
    if shot_in.prop is not None:
        shot.prop = shot_in.prop
    if shot_in.task_lay is not None:
        shot.task_lay = shot_in.task_lay
    if shot_in.task_anim is not None:
        shot.task_anim = shot_in.task_anim
    if shot_in.task_fx is not None:
        shot.task_fx = shot_in.task_fx
    if shot_in.task_lighting is not None:
        shot.task_lighting = shot_in.task_lighting
    if shot_in.task_comp is not None:
        shot.task_comp = shot_in.task_comp
    if shot_in.note is not None:
        shot.note = shot_in.note

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

    completed = sum(1 for t in tasks if t.status == models.TaskStatus.DELIVER)
    total_prog = sum(t.progress if t.progress is not None else (100 if t.status == models.TaskStatus.DELIVER else 0) for t in tasks)
    avg_prog = total_prog / total

    return schemas.ShotProgressResponse(
        shot_id=id,
        total_tasks=total,
        completed_tasks=completed,
        average_progress=avg_prog
    )
