"""
チャット用タスクリスト生成（toDatatable.py のロジックをアプリ内DBで実行）
DBからタスク・プロジェクト・ユーザーを取得し、toDatatable と同じ形式のCSV文字列を生成する。
"""
import csv
import io
import json
import logging
import os
import re
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
    
def _extract_task_id(value):
    """タスクIDを抽出。整数、文字列の整数、"task-XXXX"形式に対応"""
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        value = value.strip()
        # "task-XXXX"形式の場合
        if value.startswith("task-"):
            try:
                return int(value[5:])  # "task-"の後の部分を抽出
            except (ValueError, TypeError):
                pass
        # 通常の数値文字列の場合
        try:
            return int(value)
        except (ValueError, TypeError):
            pass
    return None

def _resolve_task_dependencies(item: dict, id_to_taskname: dict):
    """タスクのdependsOn（IDリストまたは文字列）をタスク名のカンマ区切り文字列に変換する"""
    depends_on = item.get("dependsOn", "")
    if not depends_on:
        item["dependsOn"] = ""
        return

    task_names = []
    
    # リスト形式の場合
    if isinstance(depends_on, list):
        for dep_id in depends_on:
            dep_id_int = _extract_task_id(dep_id)
            if dep_id_int and dep_id_int in id_to_taskname:
                task_names.append(id_to_taskname[dep_id_int])
            elif dep_id:
                task_names.append(str(dep_id))
    # 文字列形式の場合（カンマ区切りなど）
    elif isinstance(depends_on, str):
        dep_ids_str = [d.strip() for d in depends_on.split(",") if d.strip()]
        for dep_id_str in dep_ids_str:
            dep_id_int = _extract_task_id(dep_id_str)
            if dep_id_int and dep_id_int in id_to_taskname:
                task_names.append(id_to_taskname[dep_id_int])
            elif dep_id_str:
                task_names.append(dep_id_str)
    # 単一のIDの場合
    else:
        dep_id_int = _extract_task_id(depends_on)
        if dep_id_int and dep_id_int in id_to_taskname:
            task_names.append(id_to_taskname[dep_id_int])
        elif depends_on:
            task_names.append(str(depends_on))
    
    item["dependsOn"] = ", ".join(task_names) if task_names else ""



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


def _date_only(value) -> str:
    """日付値から時刻を除き YYYY-MM-DD 形式の文字列を返す。チャット送信用。"""
    if value is None or value == "":
        return ""
    if isinstance(value, date) and not isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    s = str(value).strip()
    if not s:
        return ""
    # "2025-11-04 00:00:00.000000" or "2025-11-04T00:00:00" -> "2025-11-04"
    if "T" in s:
        s = s.split("T")[0]
    elif " " in s:
        s = s.split(" ")[0]
    if len(s) >= 10:
        return s[:10]
    return s


def _cell_str(value, normalize_text: bool = False) -> str:
    """CSVセル用に値を文字列化。Noneは空文字。normalize_text=Trueで改行をスペースに。"""
    if value is None:
        return ""
    s = str(value).strip()
    if not s:
        return ""
    if normalize_text:
        # 改行・複数スペースを1スペースにし、AIが1行1タスクで解釈しやすくする
        s = re.sub(r"\s+", " ", s)
    return s


def build_tasks_csv_text(tasks: list[dict]) -> str:
    """タスク配列から指定順のCSV文字列を生成して返す（toDatatable と同じ列順）。AI向けに日付はYYYY-MM-DD、テキストは1行に正規化。"""
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
        "check_items",
        "deliverables",
    ]
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(field_order)
    for item in tasks:
        row = [
            _cell_str(item.get("name"), normalize_text=True),
            _cell_str(item.get("description"), normalize_text=True),
            _cell_str(item.get("assigned_to")),
            _date_only(item.get("due_date")),
            _cell_str(item.get("status")),
            _cell_str(item.get("project_id")),
            _cell_str(item.get("priority")),
            _cell_str(item.get("type")),
            _date_only(item.get("start_date")),
            _cell_str(item.get("id")),
            _cell_str(item.get("seqID")),
            _cell_str(item.get("shotID")),
            _cell_str(item.get("cost")),
            get_latest_changed_at(item),
            _cell_str(item.get("dependsOn")),
            _cell_str(item.get("check_items"), normalize_text=True),
            _cell_str(item.get("deliverables"), normalize_text=True),
        ]
        writer.writerow(row)
    return buffer.getvalue()


def _project_status_value(p) -> str:
    """Project の status を文字列で返す（Enum 対応）"""
    if p.status is None:
        return ""
    return getattr(p.status, "value", str(p.status))


def build_projects_list_for_chat(db: Session) -> str:
    """
    プロジェクトリストをCSV形式で生成する。
    チャットで「プロジェクトリスト」を送る際に使用。
    キャンセル・完了済み（cancelled, completed）のプロジェクトは除外する。
    """
    try:
        projects = crud.get_projects(db, skip=0, limit=100000, display_status_in=None)
        # キャンセル・完了済みを除外（チャットでは進行中・計画中などのみ送る）
        projects = [p for p in projects if _project_status_value(p) not in ("cancelled", "completed")]
        if not projects:
            return ""
        
        field_order = [
            "id",
            "name",
            "status",
        ]
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(field_order)
        
        for p in projects:
            row = [
                _cell_str(p.id),
                _cell_str(p.name, normalize_text=True),
                _cell_str(_project_status_value(p)),
            ]
            writer.writerow(row)
        return buffer.getvalue()
    except Exception as e:
        logger.exception("build_projects_list_for_chat failed: %s", e)
        return ""


def build_users_list_for_chat(db: Session) -> str:
    """
    ユーザーリストをCSV形式で生成する。
    チャットで「ユーザーリスト」を送る際に使用。
    """
    try:
        users = crud.get_users(db, skip=0, limit=100000)
        if not users:
            return ""
        
        field_order = [
            "id",
            "username",
            "name",
        ]
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(field_order)
        
        for u in users:
            row = [
                _cell_str(u.id),
                _cell_str(u.username),
                _cell_str(u.name),
            ]
            writer.writerow(row)
        return buffer.getvalue()
    except Exception as e:
        logger.exception("build_users_list_for_chat failed: %s", e)
        return ""


def build_task_list_for_chat(db: Session) -> str:
    """
    アプリ内DBからタスク・プロジェクト・ユーザーを取得し、
    toDatatable と同じ形式のCSV文字列を生成する。
    チャットで「タスクリスト」を送る際に使用。
    """
    try:
        projects = crud.get_projects(db, skip=0, limit=100000, display_status_in=None)
        # status が completed または cancelled でないプロジェクトをアクティブとする（toDatatable に合わせる）
        active_projects = [
            p for p in (projects or [])
            if _project_status_value(p) not in ["completed", "cancelled"]
        ]
        id_to_name = {p.id: p.name for p in active_projects}
        active_project_ids = {p.id for p in active_projects}

        users = crud.get_users(db, skip=0, limit=100000)
        id_to_username = {u.id: (u.username or u.email or str(u.id)) for u in (users or [])}

        tasks = crud.get_tasks(db, limit=100000)
        if not tasks:
            return build_tasks_csv_text([])

        # タスクIDからタスク名へのマッピングを作成
        id_to_taskname = {t.get("id"): _cell_str(t.get("name"), normalize_text=True) for t in tasks if t.get("id") and t.get("name")}

        filtered_tasks = [t for t in tasks if t.get("project_id") in active_project_ids]
        # チャット送信用: ステータスが complete のタスクを除外
        filtered_tasks = [
            t for t in filtered_tasks
            if (t.get("status") or "").strip().lower() != "completed"
        ]

        for item in filtered_tasks:
            pid = item.get("project_id")
            if pid in id_to_name:
                item["project_id"] = id_to_name[pid]
            uid = item.get("assigned_to")
            if uid is not None and uid in id_to_username:
                item["assigned_to"] = id_to_username[uid]
            elif uid is not None:
                item["assigned_to"] = id_to_username.get(uid, str(uid))

            # 依存タスクをタスクIDからタスク名に置き換え
            _resolve_task_dependencies(item, id_to_taskname)


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


def build_events_list_for_chat(db: Session, user_id: int = None) -> str:
    """
    イベントリストをCSV形式で生成する。
    user_id が指定された場合は、そのユーザーが関与するイベントを抽出（簡易実装）
    直近のイベント（過去7日〜未来30日）をリストアップする。
    """
    try:
        # 直近のイベントを取得
        start_range = datetime.now() - timedelta(days=7)
        end_range = datetime.now() + timedelta(days=30)
        
        events = db.query(models.Event).filter(
            models.Event.start_time >= start_range,
            models.Event.start_time <= end_range
        ).all()
        
        if not events:
            return ""
            
        filtered_events = []
        if user_id:
            # ユーザーフィルタリング（簡易実装）
            # participantsカラムがJSONで、[{id: ...}, ...] のような構造を想定
            # またはタイトルや説明にユーザー名が含まれるかなど
            # 今回は「全員参加」と思われるタイプと、participantsに含まれる場合のみ抽出
            
            # ユーザー名取得
            user = crud.get_user(db, user_id)
            user_name = user.name if user else ""
            
            for ev in events:
                # 重要なイベントタイプは全員に表示
                if ev.type in [models.EventType.MILESTONE, models.EventType.DEADLINE, models.EventType.WORKSHOP]:
                    filtered_events.append(ev)
                    continue
                
                # 参加者チェック
                is_participant = False
                if ev.participants:
                    # participants は List[dict] なのでループしてチェック
                    for p in ev.participants:
                        if isinstance(p, dict):
                            # IDまたは名前で一致判定
                            if str(p.get("id")) == str(user_id) or (user_name and p.get("name") == user_name):
                                is_participant = True
                                break
                
                if is_participant:
                    filtered_events.append(ev)
        else:
            filtered_events = events

        field_order = ["id", "title", "start_time", "end_time", "location", "type", "description"]
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(field_order)
        
        for ev in filtered_events:
            row = [
                _cell_str(ev.id),
                _cell_str(ev.title, normalize_text=True),
                _cell_str(ev.start_time),
                _cell_str(ev.end_time),
                _cell_str(ev.location),
                _cell_str(ev.type),
                _cell_str(ev.description, normalize_text=True),
            ]
            writer.writerow(row)
            
        return buffer.getvalue()
    except Exception as e:
        logger.exception("build_events_list_for_chat failed: %s", e)
        return ""


def build_notes_list_for_chat(db: Session, user_id: int) -> str:
    """
    ユーザーのメモリストをテキスト形式で生成する。
    チャットで「メモ」を送る際に使用。
    """
    try:
        # ユーザーのメモを全件取得
        notes = crud.get_notes(db, skip=0, limit=1000, created_by=user_id)
        if not notes:
            return ""

        buffer = io.StringIO()
        
        for note in notes:
            buffer.write(f"--- Note ID: {note.id} ---\n")
            if note.title:
                buffer.write(f"Title: {note.title}\n")
            
            # メインコンテンツ
            if note.content:
                buffer.write(f"Content: {note.content}\n")
            
            # テキストボックス (JSON)
            if note.text_boxes:
                # text_boxes は [{"id":..., "content":"...", ...}, ...] のリスト
                try:
                    for tb in note.text_boxes:
                        if isinstance(tb, dict) and tb.get("content"):
                            buffer.write(f"- {tb.get('content')}\n")
                except Exception:
                    pass
            
            # 画像・PDFの存在情報（内容は読めないがファイルがあることは伝える）
            if note.image_urls:
                img_count = len(note.image_urls)
                buffer.write(f"(Images: {img_count})\n")
            if note.pdf_urls:
                pdf_count = len(note.pdf_urls)
                buffer.write(f"(PDFs: {pdf_count})\n")
                
            buffer.write("\n")
            
        return buffer.getvalue()
    except Exception as e:
        logger.exception("build_notes_list_for_chat failed: %s", e)
        return ""


def get_personal_context(db: Session, user_id: int) -> dict:
    """
    特定のユーザー向けのコンテキスト情報を生成する。
    - 自分のタスク (Activeのみ)
    - 関連プロジェクト
    - 自分のスケジュール
    - 自分のメモ
    """
    inputs = {}
    
    # 1. 自分のタスク (Activeのみ)
    all_tasks = crud.get_tasks(db, limit=10000)
    
    # 担当者一致チェック
    my_tasks = []
    for t in all_tasks:
        assigned = t.get("assigned_to")
        # assigned_to は int だったり str だったりする可能性があるので安全に比較
        if assigned is not None and str(assigned) == str(user_id):
            my_tasks.append(t)
            
    # 完了済みは除外するか、直近のみにする
    # ここでは「未完了」または「完了して日が浅い」もののみにする
    my_active_tasks = []
    for t in my_tasks:
        status = (t.get("status") or "").lower()
        if status != "completed":
            my_active_tasks.append(t)
    
    # プロジェクト名・ユーザー名解決用マップ
    projects = crud.get_projects(db, skip=0, limit=10000)
    id_to_project_name = {p.id: p.name for p in projects}
    
    users = crud.get_users(db, skip=0, limit=10000)
    id_to_username = {u.id: (u.username or u.name or str(u.id)) for u in users}
    
    # タスクIDからタスク名へのマッピングを作成（全てのタスクを対象にする）
    id_to_taskname = {t.get("id"): _cell_str(t.get("name"), normalize_text=True) for t in all_tasks if t.get("id") and t.get("name")}

    # タスクデータの加工（ID -> Name変換）
    processed_tasks = []
    for item in my_active_tasks:
        t = item.copy() # dict copy
        pid = t.get("project_id")
        if pid in id_to_project_name:
            t["project_id"] = id_to_project_name[pid]
        uid = t.get("assigned_to")
        if uid in id_to_username:
            t["assigned_to"] = id_to_username[uid]
        
        # 依存タスクを解決
        _resolve_task_dependencies(t, id_to_taskname)
        
        processed_tasks.append(t)

        
    inputs["csv"] = build_tasks_csv_text(processed_tasks)
    
    # 2. 関連プロジェクト (タスクが含まれるプロジェクト + 全体公開プロジェクト)
    my_project_ids = {t.get("project_id") for t in my_tasks if t.get("project_id")}
    
    filtered_projects = []
    for p in projects:
        # 自分がタスクを持っている、または進行中のプロジェクト
        status_val = _project_status_value(p)
        if p.id in my_project_ids or status_val not in ["completed", "cancelled"]:
            filtered_projects.append(p)
            
    # プロジェクトCSV生成（簡易実装：build_projects_list_for_chat の中身を展開）
    p_buffer = io.StringIO()
    p_writer = csv.writer(p_buffer, lineterminator="\n")
    p_writer.writerow(["id", "name", "description", "start_date", "end_date", "status", "display_status"])
    for p in filtered_projects:
        p_writer.writerow([
            _cell_str(p.id),
            _cell_str(p.name, normalize_text=True),
            _cell_str(p.description, normalize_text=True),
            _date_only(p.start_date),
            _date_only(p.end_date),
            _cell_str(_project_status_value(p)),
            _cell_str(p.display_status),
        ])
    inputs["proj"] = p_buffer.getvalue()
    
    # 3. カレンダーイベント
    inputs["events"] = build_events_list_for_chat(db, user_id)

    # 4. メモ & ファイル (画像/PDF/Audio)
    inputs["notes"] = build_notes_list_for_chat(db, user_id)
    
    # RAG Integration removed to prevent blocking the event loop on every chat request.
    # We also do not attach massive PDFs/images directly to every request to prevent huge TTFT lag.
    inputs["attachments"] = []
    
    return inputs


def get_dashboard_context(db: Session, user_id: int = None) -> dict:
    """
    管理者ダッシュボード向けのコンテキスト情報を生成する。
    - アジェンダ：遅延、期限切れ間近、高優先度
    - プロジェクト一覧（全件）
    - ユーザー一覧（全件）
    """
    inputs = {}
    
    # プロジェクトリスト（全件）
    inputs["proj"] = build_projects_list_for_chat(db)
    
    # ユーザーリスト（全件）
    inputs["user_list"] = build_users_list_for_chat(db)
    
    # タスク：全データ（完了済みも直近のものは含める）
    all_tasks = crud.get_tasks(db, limit=100000)
    
    projects = crud.get_projects(db, limit=10000)
    id_to_project_name = {p.id: p.name for p in projects}
    
    users = crud.get_users(db, limit=10000)
    id_to_username = {u.id: (u.username or u.name or str(u.id)) for u in users}

    # タスクIDからタスク名へのマッピングを作成（全てのタスクを対象にする）
    id_to_taskname = {t.get("id"): _cell_str(t.get("name"), normalize_text=True) for t in all_tasks if t.get("id") and t.get("name")}

    target_tasks = []
    
    for t in all_tasks:
        status = (t.get("status") or "").lower()
        
        # 完了タスクの場合はスキップ
        if status == "completed":
            continue
        
        # マッピング適用
        ct = t.copy()
        pid = ct.get("project_id")
        if pid in id_to_project_name:
            ct["project_id"] = id_to_project_name[pid]
        uid = ct.get("assigned_to")
        if uid in id_to_username:
            ct["assigned_to"] = id_to_username[uid]
        
        # 依存タスクを解決
        _resolve_task_dependencies(ct, id_to_taskname)
            
        target_tasks.append(ct)


    inputs["csv"] = build_tasks_csv_text(target_tasks)
    
    # イベント：全ユーザー分を含める (user_id=None)
    inputs["events"] = build_events_list_for_chat(db, None)
    
    # メモ & ファイル (画像/PDF/Audio) - admin も自身のメモを参照可能に
    if user_id:
        inputs["notes"] = build_notes_list_for_chat(db, user_id)
        # We do not attach massive PDFs/images directly to every request to prevent huge TTFT lag.
        inputs["attachments"] = []
    else:
        inputs["notes"] = ""
        inputs["attachments"] = []
    
    return inputs
