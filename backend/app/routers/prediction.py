"""
カレンダーAI予測・提案ルーター (cmd_568 / MVP)

エンドポイント:
  GET  /api/ai/stats   — タスク集計統計
  POST /api/ai/suggest — 担当者推薦・工数見積もり (LLM)
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..security import get_current_user
from ..services.prediction_service import get_task_completion_stats, suggest_task, generate_insights

router = APIRouter(prefix="/ai", tags=["ai_prediction"])


@router.get("/stats")
def task_stats(
    project_id: Optional[int] = Query(None, description="プロジェクトID絞り込み"),
    task_type: Optional[str] = Query(None, description="タスク種別絞り込み"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """タスク集計統計を返す（担当者別・種別別・優先度別）。"""
    return get_task_completion_stats(db, project_id=project_id, task_type=task_type)


@router.get("/insights")
async def task_insights(
    force: bool = Query(False, description="True の場合 TTL キャッシュを無視して再生成"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """タスク統計データからAIが生成した有機的インサイトを返す。
    通常はプロセス内TTLキャッシュ(既定12h)を返す。force=true で再生成。"""
    stats = get_task_completion_stats(db)
    insights = await generate_insights(stats, force=force)
    return {"insights": insights}


class SuggestRequest(BaseModel):
    task_name: str = Field(..., description="新規タスク名")
    task_type: Optional[str] = Field(None, description="タスク種別")
    project_id: Optional[int] = Field(None, description="プロジェクトID")


@router.post("/suggest")
async def suggest_assignment(
    body: SuggestRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """タスク名から担当者推薦・工数見積もりをLLMで提案する（MVP）。"""
    if not body.task_name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="task_nameは必須です。")
    return await suggest_task(
        db,
        task_name=body.task_name.strip(),
        task_type=body.task_type,
        project_id=body.project_id,
    )
