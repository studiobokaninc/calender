import logging
import os
import json
import csv
import io
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import text

from .. import crud, models, schemas, security
from ..database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["Admin"])

@router.get("/projects/mapping")
def get_project_mapping(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """プロジェクト名からIDへのマッピングを返す"""
    projects = db.query(models.Project).all()
    return {p.name: p.id for p in projects}

@router.post("/mock-data/export")
def export_mock_data(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """全データをエクスポート (MockDataImport形式)"""
    users = db.query(models.User).all()
    projects = db.query(models.Project).all()
    tasks = db.query(models.Task).all()
    events = db.query(models.Event).all()
    groups = db.query(models.Group).all()
    user_groups = db.query(models.UserGroup).all()
    
    return {
        "users": [
            {"email": u.email, "full_name": u.full_name, "role": u.role, "is_active": True, "password": ""}
            for u in users
        ],
        "projects": [
            {
                "name": p.name, 
                "projectStatus": p.status.value if p.status else "planning",
                "projectStartDate": p.start_date.isoformat() if p.start_date else None,
                "projectDueDate": p.end_date.isoformat() if p.end_date else None
            }
            for p in projects
        ],
        "tasks": [
            {
                "name": t.name,
                "description": t.description,
                "project_id": t.project_id,
                "status": t.status.value if t.status else "todo",
                "due_date": t.due_date.isoformat() if t.due_date else None,
                "assigned_to": t.assigned_to,
                "cost": t.cost,
                "dependsOn": t.dependsOn
            }
            for t in tasks
        ],
        "events": [
            {
                "title": e.title,
                "start": e.start_time.isoformat() if e.start_time else None,
                "end": e.end_time.isoformat() if e.end_time else None,
                "description": e.description
            }
            for e in events
        ]
    }

@router.post("/mock-data/import")
def import_mock_data(
    data: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """データを一括インポート（既存データは削除される可能性あり）"""
    # 簡易実装: 本来は全削除してから再投入など慎重に行う必要があるが、
    # ここでは既存ロジックを模倣してインポートを受け付ける。
    # ※本番環境では非常に危険な操作であることに注意。
    logger.warning(f"Admin {current_user.email} is importing mock data.")
    return {"message": "Mock data import received (processing logic to be verified)"}

@router.post("/mock-data/import-csv")
async def import_csv_data(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """CSVからタスク等をインポート"""
    content = await file.read()
    decoded = content.decode("utf-8")
    # CSVのパースと投入処理
    return {"message": "CSV import received"}
