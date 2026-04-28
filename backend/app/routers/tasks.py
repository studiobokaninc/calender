import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks, Response
from sqlalchemy.orm import Session

from .. import crud, models, schemas, security
from ..database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tasks", tags=["Tasks"])

@router.get("/{task_id}", response_model=schemas.TaskResponse)
def get_task_endpoint(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """1件のタスクを取得"""
    db_task = crud.get_task(db=db, task_id=task_id)
    if db_task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="タスクが見つかりません")
    return db_task


@router.get("/{task_id}/status-history", response_model=List[schemas.StatusHistoryResponse])
def get_task_status_history_endpoint(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """特定のタスクのステータス変更履歴を取得"""
    db_task = crud.get_task(db=db, task_id=task_id)
    if db_task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="タスクが見つかりません")
    
    history = crud.get_task_status_history(db=db, task_id=task_id)
    return history


@router.get("", response_model=List[schemas.TaskResponse])
def get_tasks_endpoint(
    project_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 10000,
    display_status_in: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db)
):
    """タスクリストを取得"""
    try:
        tasks = crud.get_tasks(
            db=db,
            project_id=project_id,
            skip=skip,
            limit=limit,
            display_status_in=display_status_in
        )
        
        # 依存関係解決のバッチ処理
        all_depends_on_ids = set()
        for task in tasks:
            task['dependsOnTasks'] = []
            depends_on = task.get('dependsOn')
            if depends_on and isinstance(depends_on, list):
                for dep_id in depends_on:
                    try:
                        all_depends_on_ids.add(int(dep_id))
                    except (ValueError, TypeError):
                        continue
        
        if all_depends_on_ids:
            depends_on_tasks_list = db.query(models.Task).filter(
                models.Task.id.in_(list(all_depends_on_ids))
            ).all()
            tasks_map = {t.id: {'id': t.id, 'name': t.name, 'status': t.status} for t in depends_on_tasks_list}
            
            for task in tasks:
                depends_on = task.get('dependsOn')
                if depends_on and isinstance(depends_on, list):
                    valid_deps = []
                    for did in depends_on:
                        try:
                            did_int = int(did)
                            if did_int in tasks_map:
                                valid_deps.append(tasks_map[did_int])
                        except (ValueError, TypeError):
                            continue
                    task['dependsOnTasks'] = valid_deps
        
        return tasks

    except Exception:
        logger.exception("タスクの取得に失敗しました")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="タスクの取得に失敗しました。")


@router.post("", response_model=schemas.TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task_endpoint(
    task_data: schemas.TaskCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    """新規タスクを作成"""
    if task_data.project_id is not None:
        project = crud.get_project(db, project_id=task_data.project_id)
        if project is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="指定されたプロジェクトが見つかりません")
            
    created_task = crud.create_task(db=db, task=task_data)
    
    from app.services.google_sync import auto_sync_task_bg
    background_tasks.add_task(auto_sync_task_bg, created_task.id)
    
    return created_task


@router.put("/{task_id}", response_model=schemas.TaskResponse)
async def update_task_endpoint(
    task_id: int,
    task_data: schemas.TaskUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    """タスク情報を更新"""
    db_task = crud.get_task(db=db, task_id=task_id)
    if db_task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="タスクが見つかりません")
        
    # 管理者以外は表示ステータスを変更不可
    if task_data.display_status is not None and db_task.display_status != task_data.display_status:
        if current_user.role != 'admin':
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="タスクの表示ステータスを変更する権限がありません")

    updated_task = crud.update_task(db=db, db_task=db_task, task_in=task_data)
    
    from app.services.google_sync import auto_sync_task_bg
    background_tasks.add_task(auto_sync_task_bg, updated_task.id)
    
    return updated_task


@router.post("/bulk-update")
async def bulk_update_tasks_endpoint(
    payload: schemas.TaskBulkUpdateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """複数タスクを一括更新"""
    if not payload.task_ids:
        return {"updated": 0, "message": "対象タスクが指定されていません"}
    
    updates = {}
    for attr in ["status", "assigned_to", "due_date", "priority"]:
        val = getattr(payload, attr, None)
        if val is not None:
            updates[attr] = val
            
    if not updates:
        return {"updated": 0, "message": "更新項目が指定されていません"}
        
    updated = crud.bulk_update_tasks(db=db, task_ids=payload.task_ids, updates=updates)
    
    from app.services.google_sync import auto_sync_task_bg
    for tid in payload.task_ids:
        background_tasks.add_task(auto_sync_task_bg, tid)
        
    return {"updated": updated, "message": f"{updated}件のタスクを更新しました"}


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task_endpoint(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user)
):
    """タスクを削除"""
    db_task = crud.get_task(db=db, task_id=task_id)
    if db_task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="タスクが見つかりません")
        
    from .. import google_calendar as google_cal
    if google_cal.is_google_configured():
        from app.services.google_sync import delete_task_syncs
        delete_task_syncs(db, task_id)

    crud.delete_task(db=db, db_task=db_task)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
