"""
カレンダーAI予測・提案サービス (cmd_568 / MVP)

役割:
  既存 tasks/shots テーブルから集計統計を抽出し、
  OPENAI_API_KEY 経由の LLM と組み合わせて担当者推薦・工数見積もりを提供する。

MVP方式: ルール + 集計統計 + LLM 文脈付与 (重量級ML・新規テーブルなし)
"""
import logging
from typing import Dict, Any, List, Optional

from sqlalchemy.orm import Session

from .. import models
from .llm import get_llm_client

logger = logging.getLogger(__name__)

_DONE_STATUSES = {models.TaskStatus.COMPLETED, models.TaskStatus.APPROVED}
_IN_PROGRESS_STATUS = models.TaskStatus.IN_PROGRESS


def get_task_completion_stats(
    db: Session,
    project_id: Optional[int] = None,
    task_type: Optional[str] = None,
) -> Dict[str, Any]:
    """
    tasks テーブルから担当者別・種別別・優先度別の集計統計を返す。
    新規テーブル・マイグレーション不要。既存データのみ使用。
    """
    query = db.query(models.Task).filter(models.Task.display_status == "online")
    if project_id is not None:
        query = query.filter(models.Task.project_id == project_id)
    if task_type:
        query = query.filter(models.Task.type == task_type)

    tasks = query.limit(2000).all()

    by_assignee: Dict[int, Dict] = {}
    by_type: Dict[str, int] = {}
    by_priority: Dict[str, int] = {}
    total_progress = 0
    progress_count = 0

    for t in tasks:
        st = t.status if isinstance(t.status, models.TaskStatus) else None

        # 担当者別集計
        if t.assigned_to:
            if t.assigned_to not in by_assignee:
                by_assignee[t.assigned_to] = {
                    "user_id": t.assigned_to,
                    "total": 0,
                    "completed": 0,
                    "in_progress": 0,
                    "todo": 0,
                }
            by_assignee[t.assigned_to]["total"] += 1
            if st in _DONE_STATUSES:
                by_assignee[t.assigned_to]["completed"] += 1
            elif st == _IN_PROGRESS_STATUS:
                by_assignee[t.assigned_to]["in_progress"] += 1
            else:
                by_assignee[t.assigned_to]["todo"] += 1

        # 種別別
        tp = t.type or "other"
        by_type[tp] = by_type.get(tp, 0) + 1

        # 優先度別
        pr = (t.priority.value if hasattr(t.priority, "value") else str(t.priority)) if t.priority else "unknown"
        by_priority[pr] = by_priority.get(pr, 0) + 1

        # 進捗
        if t.progress is not None:
            total_progress += t.progress
            progress_count += 1

    # ユーザー名解決
    user_ids = list(by_assignee.keys())
    users = db.query(models.User).filter(models.User.id.in_(user_ids)).all() if user_ids else []
    user_map = {u.id: (u.full_name or u.username or f"User#{u.id}") for u in users}

    assignee_stats = []
    for uid, data in by_assignee.items():
        data["name"] = user_map.get(uid, f"User#{uid}")
        data["completion_rate"] = (
            round(data["completed"] / data["total"] * 100, 1) if data["total"] > 0 else 0
        )
        assignee_stats.append(data)
    assignee_stats.sort(key=lambda x: x["total"], reverse=True)

    return {
        "total_tasks": len(tasks),
        "avg_progress": round(total_progress / progress_count, 1) if progress_count > 0 else 0,
        "by_assignee": assignee_stats[:20],
        "by_type": by_type,
        "by_priority": by_priority,
    }


async def suggest_task(
    db: Session,
    task_name: str,
    task_type: Optional[str] = None,
    project_id: Optional[int] = None,
) -> Dict[str, Any]:
    """
    タスク名・種別・PJ ID から担当者推薦・工数見積もりを LLM で提案する。

    MVP手順:
      1. get_task_completion_stats で集計統計取得
      2. 類似完了タスクを名前で近似検索 (上位5件)
      3. 統計 + 類似実績を LLM (OPENAI_API_KEY) に渡して自然文で推薦生成
    """
    # 1. 集計統計
    stats = get_task_completion_stats(db, project_id=project_id, task_type=task_type)

    # 2. 類似完了タスク検索
    keyword = task_name[:15] if len(task_name) > 5 else task_name
    similar_query = (
        db.query(models.Task)
        .filter(
            models.Task.display_status == "online",
            models.Task.status.in_(list(_DONE_STATUSES)),
            models.Task.name.ilike(f"%{keyword}%"),
        )
    )
    if task_type:
        similar_query = similar_query.filter(models.Task.type == task_type)
    if project_id is not None:
        similar_query = similar_query.filter(models.Task.project_id == project_id)

    similar_tasks = similar_query.order_by(models.Task.updated_at.desc()).limit(5).all()

    # 類似タスクのユーザー名解決
    sim_user_ids = [t.assigned_to for t in similar_tasks if t.assigned_to]
    sim_user_map: Dict[int, str] = {}
    if sim_user_ids:
        sim_users = db.query(models.User).filter(models.User.id.in_(sim_user_ids)).all()
        sim_user_map = {u.id: (u.full_name or u.username or f"User#{u.id}") for u in sim_users}

    similar_lines = []
    for t in similar_tasks:
        uname = sim_user_map.get(t.assigned_to, "未割当") if t.assigned_to else "未割当"
        prog = f"{t.progress}%" if t.progress is not None else "-"
        tp = t.type or "-"
        similar_lines.append(f"- 「{t.name}」種別:{tp} 担当:{uname} 進捗:{prog}")
    similar_summary = "\n".join(similar_lines) if similar_lines else "(類似タスクなし)"

    # 3. LLM プロンプト組立
    top_assignees = stats["by_assignee"][:5]
    assignee_lines = ""
    for a in top_assignees:
        assignee_lines += (
            f"- {a['name']}: 総担当{a['total']}件, 完了率{a['completion_rate']}%,"
            f" 進行中{a['in_progress']}件\n"
        )
    if not assignee_lines:
        assignee_lines = "(担当実績データなし)"

    prompt = f"""あなたはプロジェクト管理アシスタントです。以下のデータを踏まえて、新規タスクへの適切な担当者と工数目安を提案してください。

【新規タスク】
タスク名: {task_name}
種別: {task_type or "未指定"}

【現在の担当者別実績 (上位5名)】
{assignee_lines}
【類似タスクの実績】
{similar_summary}

以下の形式で簡潔に回答してください:
1. 推薦担当者: (名前と理由)
2. 工数目安: (時間または日数の目安)
3. 注意事項: (リスクや考慮事項があれば)"""

    try:
        client = get_llm_client()
        suggestion_text = await client.oneshot_chat(
            prompt,
            inputs={"mode": "utility", "no_actions": True},
        )
    except Exception as e:
        logger.warning("LLM suggestion failed: %s", type(e).__name__)
        suggestion_text = "(LLMによる提案生成に失敗しました。統計データのみ参照してください)"

    return {
        "task_name": task_name,
        "suggestion": suggestion_text,
        "stats_summary": {
            "total_tasks_analyzed": stats["total_tasks"],
            "assignees_found": len(stats["by_assignee"]),
            "similar_tasks_found": len(similar_tasks),
        },
    }
