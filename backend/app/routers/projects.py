import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import crud, models, schemas, security
from ..database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects", tags=["Projects"])

@router.get("", response_model=List[schemas.ProjectResponse])
def get_projects_endpoint(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
    skip: int = 0,
    limit: int = 10000,
    display_status: Optional[str] = Query(None, description="表示ステータスでフィルタ (カンマ区切りで複数指定可: online,offline,archived)")
):
    """プロジェクトのリストを取得"""
    display_status_list = None
    if display_status:
        display_status_list = [s.strip() for s in display_status.split(',') if s.strip() in ['online', 'offline', 'archived']]
        if not display_status_list:
            display_status_list = None 
    
    if current_user.role == 'admin':
        if display_status_list is None:
            display_status_list = ['online', 'offline', 'archived']
    else:
        # 一般ユーザーは online のみ表示
        display_status_list = ['online']
            
    projects = crud.get_projects(db=db, skip=skip, limit=limit, display_status_in=display_status_list)
    return projects


@router.get("/{project_id}", response_model=schemas.ProjectResponse)
def get_project_endpoint(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    """プロジェクト詳細を取得"""
    db_project = crud.get_project(db=db, project_id=project_id)
    if db_project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="プロジェクトが見つかりません")
    return db_project


@router.post("", response_model=schemas.ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project_endpoint(
    project_data: schemas.ProjectCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """新規プロジェクトを作成（管理者のみ）"""
    created_project = crud.create_project(db=db, project=project_data)
    
    from app.services.meeting_scanner import create_project_folder
    create_project_folder(created_project.name)
    
    from app.services.google_sync import auto_sync_project_bg
    background_tasks.add_task(auto_sync_project_bg, created_project.id)
    
    return created_project


@router.put("/{project_id}", response_model=schemas.ProjectResponse)
def update_project_endpoint(
    project_id: int,
    project_data: schemas.ProjectUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """プロジェクト情報を更新（管理者のみ）"""
    db_project = crud.get_project(db=db, project_id=project_id)
    if db_project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="プロジェクトが見つかりません")
    
    old_name = db_project.name
    updated_project = crud.update_project(db=db, db_project=db_project, project_in=project_data)
    
    if old_name != updated_project.name:
        from app.services.meeting_scanner import rename_project_folder
        rename_project_folder(old_name, updated_project.name)

    if updated_project.status in [models.ProjectStatus.COMPLETED, models.ProjectStatus.CANCELLED]:
        crud.complete_tasks_for_project(db=db, project_id=project_id)
        
    from app.services.google_sync import auto_sync_project_bg
    background_tasks.add_task(auto_sync_project_bg, updated_project.id)
    
    return updated_project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project_endpoint(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_active_admin),
):
    """プロジェクトを削除（関連タスク・履歴等を含めて削除、管理者のみ）"""
    # 実際には crud.delete_project_with_cascade を使用
    try:
        project = db.query(models.Project).filter(models.Project.id == project_id).first()
        project_name = project.name if project else None
        
        success = crud.delete_project_with_cascade(db, project_id)
        if not success:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="プロジェクトが見つかりません")
        
        # フォルダのリネーム (削除マーク)
        if project_name:
            from app.services.meeting_scanner import delete_project_folder
            delete_project_folder(project_name)
        
        # Google Calendar 同期削除の呼び出しが必要な場合は、crud 内で既に完結している想定。
        # 必要に応じて追加。
        
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error deleting project")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
