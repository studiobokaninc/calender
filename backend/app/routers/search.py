from typing import Dict, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import crud, models, security
from ..database import get_db

router = APIRouter(tags=["Global Search"])

def _do_global_search(db: Session, q_trimmed: str, limit: int):
    """検索実行（/search と /api/search の両方から利用）"""
    if len(q_trimmed) < 1:
        return {"projects": [], "tasks": [], "events": []}
    
    projects = crud.search_projects(db=db, q=q_trimmed, limit=limit)
    tasks = crud.search_tasks(db=db, q=q_trimmed, limit=limit)
    events = crud.search_events(db=db, q=q_trimmed, limit=limit)
    
    project_id_to_name: Dict[int, str] = {}
    for t in tasks:
        if t.project_id and t.project_id not in project_id_to_name:
            proj = crud.get_project(db, t.project_id)
            project_id_to_name[t.project_id] = proj.name if proj else ""

    def _event_to_dict(e):
        return {
            "id": e.id,
            "title": e.title,
            "start_time": e.start_time.isoformat() if e.start_time else None,
            "end_time": e.end_time.isoformat() if e.end_time else None,
        }

    return {
        "projects": [{"id": p.id, "name": p.name, "description": (p.description or "")[:200]} for p in projects],
        "tasks": [
            {
                "id": t.id, 
                "name": t.name, 
                "project_id": t.project_id, 
                "project_name": project_id_to_name.get(t.project_id) if t.project_id else None, 
                "due_date": t.due_date.isoformat() if t.due_date else None
            }
            for t in tasks
        ],
        "events": [_event_to_dict(e) for e in events],
    }


@router.get("/search")
@router.get("/api/search")
def global_search(
    q: str = Query("", min_length=0, description="検索キーワード"),
    limit: int = Query(10000, ge=1, le=10000, description="最大取得件数"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(security.get_current_user),
):
    """プロジェクト・タスク・イベントを横断検索"""
    q_trimmed = (q or "").strip()
    return _do_global_search(db, q_trimmed, limit)
