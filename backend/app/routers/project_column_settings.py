import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from .. import models, schemas, security
from ..database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/projects", tags=["column_settings"])


class ProjectColumnSettingUpdate(BaseModel):
    is_enabled: Optional[bool] = None
    display_order: Optional[int] = None
    display_label: Optional[str] = None


@router.get("/{project_id}/column_settings", response_model=List[schemas.ProjectColumnSettingResponse])
def get_column_settings(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    settings = db.query(models.ProjectColumnSetting).filter(
        models.ProjectColumnSetting.project_id == project_id
    ).all()
    return settings


@router.post(
    "/{project_id}/column_settings",
    response_model=schemas.ProjectColumnSettingResponse,
    status_code=status.HTTP_201_CREATED
)
def create_column_setting(
    project_id: int,
    setting_in: schemas.ProjectColumnSettingCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    new_setting = models.ProjectColumnSetting(
        project_id=project_id,
        field_key=setting_in.field_key,
        is_enabled=setting_in.is_enabled,
        display_order=setting_in.display_order,
        display_label=setting_in.display_label
    )
    db.add(new_setting)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Column setting for this project_id and field_key already exists"
        )
    db.refresh(new_setting)
    return new_setting


@router.patch("/{project_id}/column_settings/{field_key}", response_model=schemas.ProjectColumnSettingResponse)
def update_column_setting(
    project_id: int,
    field_key: str,
    update_in: ProjectColumnSettingUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    setting = db.query(models.ProjectColumnSetting).filter(
        models.ProjectColumnSetting.project_id == project_id,
        models.ProjectColumnSetting.field_key == field_key
    ).first()
    if not setting:
        raise HTTPException(status_code=404, detail="Column setting not found")

    if update_in.is_enabled is not None:
        setting.is_enabled = update_in.is_enabled
    if update_in.display_order is not None:
        setting.display_order = update_in.display_order
    if update_in.display_label is not None:
        setting.display_label = update_in.display_label

    db.commit()
    db.refresh(setting)
    return setting


@router.delete("/{project_id}/column_settings/{field_key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_column_setting(
    project_id: int,
    field_key: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    setting = db.query(models.ProjectColumnSetting).filter(
        models.ProjectColumnSetting.project_id == project_id,
        models.ProjectColumnSetting.field_key == field_key
    ).first()
    if not setting:
        raise HTTPException(status_code=404, detail="Column setting not found")

    db.delete(setting)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
