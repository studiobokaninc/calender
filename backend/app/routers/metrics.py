import logging
from datetime import datetime, date, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, case

from .. import crud, models, security
from ..database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/metrics", tags=["Metrics & Analysis"])

@router.get("/dashboard")
def get_dashboard_metrics(
    current_user: models.User = Depends(security.get_current_user), 
    db: Session = Depends(get_db)
):
    """
    ダッシュボード用統計を取得する
    """
    # 統計取得前にタスクステータスを自動更新する（遅延判定など）
    try:
        crud.auto_update_task_statuses(db)
    except Exception as e:
        logger.error(f"Error auto-updating task statuses: {e}")

    try:
        num_tasks = db.query(models.Task).join(models.Project).filter(models.Project.display_status == 'online').count()
    except Exception as e:
        logger.error(f"Error counting tasks for metrics: {e}")
        num_tasks = -1

    try:
        num_completed_tasks = db.query(models.Task).join(models.Project).filter(
            models.Project.display_status == 'online',
            models.Task.status.in_([
                models.TaskStatus.AP,
                models.TaskStatus.CLIENT_AP,
                models.TaskStatus.DELIVER
            ])
        ).count()
    except Exception as e:
        logger.error(f"Error counting completed tasks for metrics: {e}")
        num_completed_tasks = -1

    try:
        num_projects = db.query(models.Project).filter(models.Project.display_status == 'online').count()
    except Exception as e:
        logger.error(f"Error counting projects for metrics: {e}")
        num_projects = -1
    
    try:
        # 紐づくプロジェクトがonlineのもの、またはプロジェクトに紐づかないイベント
        num_events = db.query(models.Event).outerjoin(models.Project).filter(
            (models.Project.display_status == 'online') | (models.Event.project_id == None)
        ).count()
    except Exception as e:
        logger.error(f"Error counting events for metrics: {e}")
        num_events = -1
    
    try:
        num_users = db.query(models.User).count()
    except Exception as e:
        logger.error(f"Error counting users for metrics: {e}")
        num_users = -1

    try:
        num_shots = db.query(models.Shot).join(models.Project).filter(models.Project.display_status == 'online').count()
    except Exception as e:
        logger.error(f"Error counting shots for metrics: {e}")
        num_shots = -1

    try:
        project_stats = db.query(
            models.Project.id,
            models.Project.name,
            func.count(models.Task.id).label('total_tasks'),
            func.sum(case((models.Task.status.in_([
                models.TaskStatus.AP,
                models.TaskStatus.CLIENT_AP,
                models.TaskStatus.DELIVER
            ]), 1), else_=0)).label('completed_tasks')
        ).outerjoin(models.Task, models.Project.id == models.Task.project_id)\
         .filter(models.Project.display_status == 'online')\
         .group_by(models.Project.id, models.Project.name).all()
        
        project_metrics = [
            {
                "id": p.id,
                "name": p.name,
                "tasks": p.total_tasks,
                "completed_tasks": int(p.completed_tasks or 0)
            }
            for p in project_stats
        ]
    except Exception as e:
        logger.error(f"Error calculating project metrics: {e}")
        project_metrics = []

    return {
        "users": num_users,
        "tasks": num_tasks,
        "completed_tasks": num_completed_tasks,
        "projects": num_projects,
        "events": num_events,
        "shots": num_shots,
        "project_metrics": project_metrics
    }


@router.get("/labor-report")
def get_labor_report_endpoint(
    group_by: str = Query("user", description="集計単位: user または project"),
    from_date: Optional[str] = Query(None, description="集計開始日 YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="集計終了日 YYYY-MM-DD"),
    include_offline: bool = Query(False, description="オフラインのプロジェクトを含めるかどうか"),
    include_completed: bool = Query(False, description="完了タスクを含めるかどうか"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """工数集計レポート（タスクの cost を担当者別またはプロジェクト別に集計）"""
    if group_by not in ("user", "project"):
        raise HTTPException(status_code=400, detail="group_by は user または project を指定してください")
    
    from_dt = None
    to_dt = None
    if from_date:
        try:
            from_dt = datetime.strptime(from_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="from_date は YYYY-MM-DD 形式で指定してください")
    if to_date:
        try:
            to_dt = datetime.strptime(to_date + " 23:59:59", "%Y-%m-%d %H:%M:%S")
        except ValueError:
            raise HTTPException(status_code=400, detail="to_date は YYYY-MM-DD 形式で指定してください")
            
    return crud.get_labor_report(db=db, group_by=group_by, from_date=from_dt, to_date=to_dt, include_offline=include_offline, include_completed=include_completed)


@router.get("/weekly-availability")
def get_weekly_availability_endpoint(
    week_start: Optional[str] = Query(None, description="週の開始日（月曜）YYYY-MM-DD。未指定時は今週の月曜"),
    only_free: bool = Query(False, description="True の場合、その週に余裕があるユーザーのみ返す"),
    include_offline: bool = Query(False, description="オフラインのプロジェクトのタスクを含めるか"),
    include_completed: bool = Query(True, description="完了タスクの工数を含めるか"),
    consider_dependencies: bool = Query(True, description="依存タスクを考慮する（依存先が未完の日は工数に含めない）"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """
    指定週のユーザー別「割り当て工数」と「余裕時間」を返す。
    """
    if week_start:
        try:
            week_start_date = datetime.strptime(week_start, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="week_start は YYYY-MM-DD 形式で指定してください")
    else:
        today = date.today()
        week_start_date = today - timedelta(days=today.weekday())  # 月曜

    reference_date = date.today()
    items = crud.get_weekly_workload(
        db=db,
        week_start=week_start_date,
        reference_date=reference_date,
        include_offline=include_offline,
        include_completed=include_completed,
        consider_dependencies=consider_dependencies,
    )
    if only_free:
        items = [x for x in items if x["free_hours"] > 0]
        
    return {
        "week_start": week_start_date.isoformat(),
        "hours_per_day": 8,
        "max_hours_per_week": 40,
        "consider_dependencies": consider_dependencies,
        "users": items,
    }


@router.get("/daily-availability")
def get_daily_availability_endpoint(
    target_date: Optional[str] = Query(None, description="対象日 YYYY-MM-DD。未指定時は今日"),
    only_free: bool = Query(False, description="True の場合、その日に余裕があるユーザーのみ返す"),
    include_offline: bool = Query(False, description="オフラインのプロジェクトのタスクを含めるか"),
    include_completed: bool = Query(True, description="完了タスクの工数を含めるか"),
    consider_dependencies: bool = Query(True, description="依存タスクを考慮する（依存先が未完ならそのタスクの工数は含めない）"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """
    指定日のユーザー別「割り当て工数」と「余裕時間」を返す。
    """
    if target_date:
        try:
            target_date_parsed = datetime.strptime(target_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="target_date は YYYY-MM-DD 形式で指定してください")
    else:
        target_date_parsed = date.today()

    items = crud.get_daily_workload(
        db=db,
        target_date=target_date_parsed,
        include_offline=include_offline,
        include_completed=False,
        consider_dependencies=consider_dependencies,
    )
    if only_free:
        items = [x for x in items if x["free_hours"] > 0]
        
    return {
        "date": target_date_parsed.isoformat(),
        "hours_per_day": 8,
        "consider_dependencies": consider_dependencies,
        "users": items,
    }
