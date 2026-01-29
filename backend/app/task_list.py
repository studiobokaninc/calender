"""
チャット用タスクリスト生成（toDatatable.py のロジックをアプリ内DBで実行）
DBからタスク・プロジェクト・ユーザーを取得し、toDatatable と同じ形式のCSV文字列を生成する。
"""
import csv
import io
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session

from . import crud, models

logger = logging.getLogger(__name__)


def to_relative_minutes(updated_at_str: str) -> str:
    """ISO形式の日時を受け取り、24時間超は「n日前」、24時間以内は「n時間n分前」に変換する。"""
    if not updated_at_str:
        return ""
    try:
        text = str(updated_at_str).strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
    except Exception:
        return updated_at_str if isinstance(updated_at_str, str) else ""

    jst = timezone(timedelta(hours=9))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=jst)
    dt_jst = dt.astimezone(jst)
    now = datetime.now(jst)
    delta = now - dt_jst
    if delta.total_seconds() < 0:
        return "0時間0分前"
    if delta.days >= 1:
        return f"{delta.days}日前"
    total_seconds = delta.seconds
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    return f"{hours}時間{minutes}分前"


def get_latest_changed_at(task: dict) -> str:
    """タスクのstatus_historyから最新のchanged_atを取得し、経過時間を返す"""
    status_history = task.get("status_history", [])
    if not status_history:
        return ""
    latest = status_history[-1]
    changed_at = latest.get("changed_at") or latest.get("timestamp")
    if not changed_at:
        return ""
    return to_relative_minutes(changed_at)


def build_tasks_csv_text(tasks: list[dict]) -> str:
    """タスク配列から指定順のCSV文字列を生成して返す（toDatatable と同じ列順）"""
    field_order = [
        "name",
        "description",
        "assigned_to",
        "due_date",
        "status",
        "project_id",
        "priority",
        "type",
        "start_date",
        "taskID",
        "seqID",
        "shotID",
        "cost",
        "updated_at",
        "dependsOn",
    ]
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(field_order)
    for item in tasks:
        row = [
            item.get("name", ""),
            item.get("description", ""),
            item.get("assigned_to", ""),
            item.get("due_date", ""),
            item.get("status", ""),
            item.get("project_id", ""),
            item.get("priority", ""),
            item.get("type", ""),
            item.get("start_date", ""),
            item.get("id", ""),
            item.get("seqID", ""),
            item.get("shotID", ""),
            item.get("cost", ""),
            get_latest_changed_at(item),
            item.get("dependsOn", ""),
        ]
        writer.writerow(row)
    return buffer.getvalue()


def _project_status_value(p) -> str:
    """Project の status を文字列で返す（Enum 対応）"""
    if p.status is None:
        return ""
    return getattr(p.status, "value", str(p.status))


def build_task_list_for_chat(db: Session) -> str:
    """
    アプリ内DBからタスク・プロジェクト・ユーザーを取得し、
    toDatatable と同じ形式のCSV文字列を生成する。
    チャットで「タスクリスト」を送る際に使用。
    """
    try:
        projects = crud.get_projects(db, skip=0, limit=100000, display_status_in=None)
        # status が completed でないプロジェクトをアクティブとする（toDatatable に合わせる）
        active_projects = [
            p for p in (projects or [])
            if _project_status_value(p) != "completed"
        ]
        id_to_name = {p.id: p.name for p in active_projects}
        active_project_ids = {p.id for p in active_projects}

        users = crud.get_users(db, skip=0, limit=100000)
        id_to_username = {u.id: (u.username or u.email or str(u.id)) for u in (users or [])}

        tasks = crud.get_tasks(db, limit=100000)
        if not tasks:
            return build_tasks_csv_text([])

        filtered_tasks = [t for t in tasks if t.get("project_id") in active_project_ids]

        for item in filtered_tasks:
            pid = item.get("project_id")
            if pid in id_to_name:
                item["project_id"] = id_to_name[pid]
            uid = item.get("assigned_to")
            if uid is not None and uid in id_to_username:
                item["assigned_to"] = id_to_username[uid]
            elif uid is not None:
                item["assigned_to"] = id_to_username.get(uid, str(uid))

            depends_on = item.get("dependsOn", "")
            if depends_on:
                if isinstance(depends_on, list):
                    item["dependsOn"] = ", ".join(map(str, depends_on))
                else:
                    item["dependsOn"] = str(depends_on)
            else:
                item["dependsOn"] = ""

        return build_tasks_csv_text(filtered_tasks)
    except Exception as e:
        logger.exception("build_task_list_for_chat failed: %s", e)
        return ""
