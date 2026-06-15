from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, select

from .. import models, schemas, security
from ..database import get_db

router = APIRouter(tags=["score_admin"])


@router.get("/deliveries")
def list_deliveries(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    rows = (
        db.query(models.Delivery)
        .order_by(models.Delivery.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    total = db.query(func.count(models.Delivery.id)).scalar()
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [
            {
                "id": r.id,
                "task_id": r.task_id,
                "status": r.status,
                "qc_status": r.qc_status,
                "memo": r.memo,
                "created_by": r.created_by,
                "created_at": r.created_at,
            }
            for r in rows
        ],
    }


@router.get("/reference_materials")
def list_reference_materials(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    rows = (
        db.query(models.ReferenceMaterial)
        .order_by(models.ReferenceMaterial.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    total = db.query(func.count(models.ReferenceMaterial.id)).scalar()
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [
            {
                "id": r.id,
                "shot_id": r.shot_id,
                "task_id": r.task_id,
                "title": r.title,
                "media_type": r.media_type,
                "created_by": r.created_by,
                "created_at": r.created_at,
            }
            for r in rows
        ],
    }


@router.get("/dm/threads")
def list_dm_threads(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """DMスレッドのメタデータのみ返却。本文(body)は含まない。"""
    subq = (
        db.query(
            models.DirectMessage.thread_id,
            func.count(models.DirectMessage.id).label("message_count"),
            func.max(models.DirectMessage.created_at).label("last_updated"),
        )
        .group_by(models.DirectMessage.thread_id)
        .subquery()
    )

    total_q = db.query(func.count()).select_from(subq).scalar()

    thread_rows = (
        db.query(subq)
        .order_by(subq.c.last_updated.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    result = []
    for row in thread_rows:
        participants = (
            db.query(models.DirectMessage.sender_id, models.DirectMessage.recipient_id)
            .filter(models.DirectMessage.thread_id == row.thread_id)
            .distinct()
            .all()
        )
        participant_ids = list(
            {uid for pair in participants for uid in (pair.sender_id, pair.recipient_id)}
        )
        result.append(
            {
                "thread_id": row.thread_id,
                "participant_user_ids": participant_ids,
                "message_count": row.message_count,
                "last_updated": row.last_updated,
            }
        )

    return {
        "total": total_q,
        "offset": offset,
        "limit": limit,
        "items": result,
    }


@router.patch("/notifications/{id}/read", response_model=schemas.Notification)
def admin_read_notification(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """Admin: mark any user's notification as read (cross-user)."""
    db_notif = db.query(models.Notification).filter(models.Notification.id == id).first()
    if not db_notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    db_notif.is_read = True
    db.commit()
    db.refresh(db_notif)
    return db_notif
