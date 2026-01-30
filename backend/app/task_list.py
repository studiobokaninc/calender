"""
チャット用タスクリスト生成（toDatatable.py のロジックをアプリ内DBで実行）
DBからタスク・プロジェクト・ユーザーを取得し、toDatatable と同じ形式のCSV文字列を生成する。
"""
import csv
import io
import json
import logging
from datetime import datetime, timezone, timedelta, date
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


def classify_task_for_dify(arg1) -> dict:
    """
    Dify用のタスク分類処理
    
    期待入力例:
      {
        "output": "name,description,assigned_to,due_date,status,project_id,priority,type,start_date,taskID,seqID,shotID,cost,updated_at,dependsOn\\n\\n...",
        "today": "2025-09-19"  # 任意。無ければ実行日のYYYY-MM-DD
      }
    出力:
      {"result": "本日: YYYY-MM-DD\n件数: 完了a / 遅延x / 本日開始y / 開始前p / 期日当日r / 期日前z / 未設定w\n\nname／...／updated_at／dependsOn／tag\n\n..."}
    """
    # -------- 入力正規化 --------
    src = arg1
    if isinstance(src, str):
        s = src.strip()
        if s.startswith("{") and s.endswith("}"):
            try:
                src = json.loads(s)
            except Exception:
                src = {"output": s}
        else:
            src = {"output": s}
    elif not isinstance(src, dict):
        src = {}

    # today の取得（優先順: arg1.today -> arg1.result.today -> 実行日）
    def pick_today(obj: dict) -> str:
        for k in ("today", "date", "now"):
            v = obj.get(k)
            if isinstance(v, str) and len(v) >= 10:
                return v[:10]
        res = obj.get("result")
        if isinstance(res, dict):
            v = res.get("today")
            if isinstance(v, str) and len(v) >= 10:
                return v[:10]
        return date.today().isoformat()

    today = pick_today(src)

    # output の文字列を取得（arg1.output or arg1.result.output）
    output = ""
    if "output" in src and isinstance(src["output"], str):
        output = src["output"]
    elif isinstance(src.get("result"), dict) and isinstance(src["result"].get("output"), str):
        output = src["result"]["output"]

    output = (output or "").strip()
    if not output:
        return {"result": "本日: " + today + "\n件数: 完了0 / 遅延0 / 本日開始0 / 開始前0 / 期日当日0 / 期日前0 / 未設定0\n\n（タスクが見つかりませんでした: output が空です）"}

    # -------- CSV風テキストをパース --------
    # 仕様: 空行(\n\n)で行ブロックを区切る。カンマ区切り15列（旧12/13/14列も許容）。
    blocks = [b.strip() for b in output.split("\n\n") if b.strip()]
    if not blocks:
        return {"result": f"本日: {today}\n件数: 完了0 / 遅延0 / 本日開始0 / 開始前0 / 期日当日0 / 期日前0 / 未設定0\n\n（タスクが見つかりませんでした: ブロック0件）"}

    # 先頭がヘッダか判定（12/13/14/15列のいずれも許容）
    header = blocks[0]
    header_l = header.lower().replace(" ", "")
    header12 = "name,description,assigned_to,due_date,status,project_id,priority,type,start_date,seqid,shotid,cost"
    header13 = header12 + ",updated_at"
    header14 = header13 + ",dependson"
    header15 = "name,description,assigned_to,due_date,status,project_id,priority,type,start_date,taskid,seqid,shotid,cost,updated_at,dependson"
    is_header = (
        header_l.startswith(header15)
        or header_l.startswith(header14)
        or header_l.startswith(header13)
        or header_l.startswith(header12)
    )
    rows = blocks[1:] if is_header else blocks

    # 安全のため列数を揃える関数（15列に合わせる。旧12/13/14列は不足分を空で補完）
    def split_cols(line: str):
        cols = [c.strip() for c in line.split(",")]
        need = 15  # taskID + updated_at + dependsOn まで
        if len(cols) < need:
            cols += [""] * (need - len(cols))
        return cols[:need]

    # 正規化関数
    def ymd(s: str) -> str:
        s = (s or "").strip()
        if not s:
            return ""
        return s.split("T")[0]

    def to_date(s: str):
        try:
            return datetime.strptime(s, "%Y-%m-%d").date()
        except Exception:
            return None

    def norm_status(status: str) -> str:
        s = (status or "").strip().lower()
        mapping = {
            "completed": "completed", "完了": "completed",
            "delayed": "delayed", "遅延": "delayed",
            "todo": "todo", "未着手": "todo",
            "in-progress": "in-progress", "進行中": "in-progress",
            "review": "review", "レビュー中": "review",
        }
        return mapping.get(s, s)

    today_d = to_date(today)

    # -------- 区分タグ判定 --------
    def classify(start_ymd: str, due_ymd: str, status: str) -> str:
        st = norm_status(status)

        if st == "completed":
            return "完了"
        if st == "delayed":
            return "遅延"

        if not today_d:
            if not start_ymd and not due_ymd:
                return "未設定"
            return "期日前"

        if not start_ymd and not due_ymd:
            return "未設定"

        sd = to_date(start_ymd) if start_ymd else None
        dd = to_date(due_ymd) if due_ymd else None

        if sd is None and dd is not None:
            if dd < today_d:
                return "遅延"
            if dd == today_d:
                return "期日当日"
            return "期日前"
        if sd is not None and dd is None:
            if sd == today_d:
                return "本日開始"
            if sd > today_d:
                return "開始前"
            return "期日前"

        if sd == today_d:
            return "本日開始"
        if sd > today_d:
            return "開始前"
        if dd < today_d:
            return "遅延"
        if dd == today_d:
            return "期日当日"
        return "期日前"

    # -------- 生成 --------
    out_lines = []
    counts = {
        "完了": 0,
        "遅延": 0,
        "本日開始": 0,
        "開始前": 0,
        "期日当日": 0,
        "期日前": 0,
        "未設定": 0,
    }

    for r in rows:
        cols = split_cols(r)
        (
            name, desc, assigned_to, due_date, status,
            project_id, priority, typ, start_date, taskID,
            seqID, shotID, cost, updated_at, depends_on
        ) = cols

        due_ymd = ymd(due_date)
        start_ymd = ymd(start_date)

        tag = classify(start_ymd, due_ymd, status)
        counts[tag] = counts.get(tag, 0) + 1

        out_lines.append("／".join([
            name,               # 1: タスク名
            desc,               # 2: 説明
            assigned_to,        # 3: 担当者
            due_ymd,            # 4: 期日(YYYY-MM-DD)
            status,             # 5: ステータス（元値を保持）
            project_id,         # 6: プロジェクト
            priority,           # 7: 優先度
            typ,                # 8: タスクタイプ
            start_ymd,          # 9: 開始日(YYYY-MM-DD)
            taskID,             # 10: タスクID（新規列）
            seqID,              # 11: シーケンスID
            shotID,             # 12: ショットID
            cost,               # 13: コスト
            updated_at,         # 14: updated_at（そのまま）
            depends_on,         # 15: dependsOn（そのまま）
            tag                 # 16: 区分タグ（出力のみの付加列）
        ]))

    header_lines = [
        f"本日: {today}",
        "件数: "
        f"完了{counts.get('完了',0)} / "
        f"遅延{counts.get('遅延',0)} / "
        f"本日開始{counts.get('本日開始',0)} / "
        f"開始前{counts.get('開始前',0)} / "
        f"期日当日{counts.get('期日当日',0)} / "
        f"期日前{counts.get('期日前',0)} / "
        f"未設定{counts.get('未設定',0)}",
    ]
    body = "\n\n".join(out_lines)
    return {"result": "\n".join(header_lines) + "\n\n" + body}
