# -*- coding: utf-8 -*-
import random
from datetime import datetime, timedelta
# from passlib.context import CryptContext # ここで定義しない
# main.py の pwd_context を使う想定
from . import models # ★★★ models をインポート ★★★

# --- ヘルパー関数定義を先に移動 ★★★ ---
def isAfter(date1, date2):
    """Check if date1 is after date2."""
    return date1 > date2

def isEqual(date1, date2):
    """Check if date1 is equal to date2."""
    return date1 == date2

# --- パスワードハッシュ ---
# pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto") # ここで定義しない
def get_password_hash(password):
    # return pwd_context.hash(password) # 以前のコード
    # この関数は crud.create_user から呼ばれるが、crud.create_user 内部で
    # main.py の pwd_context を使ってハッシュ化するべき。
    # 混乱を避けるため、この関数はここでは何もしないか、エラーを出すようにする。
    # raise NotImplementedError("get_password_hash in mock_data should not be used directly. Use main.pwd_context")
    # または、一時的に平文を返す (crud.create_user が main の context でハッシュ化すると信じる)
    # return password # 一時的な回避策 (非推奨)
    
    # 最も安全なのは crud.create_user 側で main.pwd_context を使うように修正することだが、
    # ここでは crud.create_user が適切にハッシュ化することを期待し、
    # mock_data.py 内での users リスト作成時のハッシュ化はスキップする。
    # この get_password_hash 関数自体は不要になる。
    pass # users リスト作成時に直接平文パスワードを使うため、この関数は呼ばれない想定。

# --- ユーザーデータ (管理者1人 + 一般10人 = 合計11人) ---
users = [
    {
        "id": "user-admin", "username": "tanaka@example.com", "full_name": "田中 太郎 (Admin)",
        "email": "tanaka@example.com", "role": "admin",
        # "hashed_password": get_password_hash("password123") # ここではハッシュ化しない
        "password": "adminpassword" # create_db.py で使うための平文パスワードキーを追加
    }
]
for i in range(1, 11):
    user_id = f"user-{i}"
    email = f"user{i}@example.com"
    username = email.split("@")[0]
    users.append({
        "id": user_id, "username": username, "full_name": f"一般ユーザー {i}",
        "email": email, "role": "user",
        # "hashed_password": get_password_hash(f"password{i}") # ここではハッシュ化しない
        "password": f"password{i}" # 平文パスワードキーを追加
    })

# ★★★ users リスト定義後に user_ids_non_admin を定義 ★★★
user_ids_non_admin = [u["id"] for u in users if u["role"] != "admin"]

# --- プロジェクトデータ (4件) ---
projects = [
    {
        "id": "proj-1", "name": "プロジェクトA",
        "description": "進行中のオンラインプロジェクト",
        "status": models.ProjectStatus.IN_PROGRESS.value, 
        "display_status": "online",
        "color": "#4CAF50", 
        "startDate": "2025-01-01", 
        "endDate": "2025-06-30", 
    },
    {
        "id": "proj-2", "name": "プロジェクトB",
        "description": "計画段階のオンラインプロジェクト",
        "status": models.ProjectStatus.PLANNING.value, 
        "display_status": "online",
        "color": "#2196F3",
        "startDate": "2025-03-01", 
        "endDate": "2025-09-30",
    },
    {
        "id": "proj-3", "name": "プロジェクトC",
        "description": "保留されているオフラインプロジェクト",
        "status": models.ProjectStatus.ON_HOLD.value, 
        "display_status": "offline",
        "color": "#FF9800",
        "startDate": "2024-10-01",
        "endDate": "2025-02-28",
    },
    {
        "id": "proj-4",
        "name": "プロジェクトD",
        "description": "アーカイブ済みの完了プロジェクト",
        "status": models.ProjectStatus.COMPLETED.value, 
        "display_status": "archived",
        "color": "#9E9E9E",
        "startDate": "2024-01-01",
        "endDate": "2024-09-30",
    }
]

# --- タスクデータ (各プロジェクト30件、合計120件) ---
tasks = []
possible_costs = [4, 8, 12, 16, 20, 24, 28, 32, 36, 40]
possible_priorities = [models.TaskPriority.HIGH, models.TaskPriority.MEDIUM, models.TaskPriority.LOW]
possible_types = [models.TaskType.DEVELOPMENT, models.TaskType.DESIGN, models.TaskType.DOCUMENTATION, models.TaskType.TESTING, models.TaskType.COMP]

for p_idx, project in enumerate(projects):
    project_id = project["id"]
    project_display_status = project["display_status"]
    project_start_date = datetime.strptime(project["startDate"], '%Y-%m-%d')
    project_end_date = datetime.strptime(project["endDate"], '%Y-%m-%d')
    
    # プロジェクト期間の日数
    project_duration_days = (project_end_date - project_start_date).days
    if project_duration_days <= 0: project_duration_days = 30 # 期間が不正な場合のフォールバック

    project_task_ids = [] # プロジェクト内のタスクIDを保持（依存関係用）

    for i in range(30): # tasks を生成するループ (インデントレベル1)
        task_sequential_id = (p_idx * 30) + i + 1 # (インデントレベル2)
        task_id_str = f"task-{task_sequential_id}" # (インデントレベル2)
        project_task_ids.append(task_id_str) # (インデントレベル2)

        assignee = random.choice(user_ids_non_admin) if user_ids_non_admin else None # (インデントレベル2)
        cost = random.choice(possible_costs) # (インデントレベル2)
        priority = random.choice(possible_priorities) # 優先度をランダムに設定
        task_type = random.choice(possible_types) # タスクタイプをランダムに設定
    
        # 日付生成: プロジェクト期間内に収まるように調整 (インデントレベル2)
        task_duration = random.randint(1, max(1, project_duration_days // 5)) # (インデントレベル2)
        
        max_start_offset = max(0, project_duration_days - task_duration) # (インデントレベル2)
        start_offset = random.randint(0, max_start_offset) # (インデントレベル2)
        
        start_date_obj = project_start_date + timedelta(days=start_offset) # (インデントレベル2)
        due_date_obj = start_date_obj + timedelta(days=task_duration -1) # (インデントレベル2)
        
        start_date_str = start_date_obj.strftime('%Y-%m-%d') # (インデントレベル2)
        due_date_str = due_date_obj.strftime('%Y-%m-%d') # (インデントレベル2)

        # 業務ステータス生成 (インデントレベル2)
        task_status_choices = [s for s in models.TaskStatus]
        if project["status"] == models.ProjectStatus.COMPLETED.value: 
            final_db_status = models.TaskStatus.COMPLETED # (インデントレベル3)
        elif project["status"] == models.ProjectStatus.CANCELLED.value or project["status"] == models.ProjectStatus.ON_HOLD.value:
            final_db_status = random.choice([models.TaskStatus.TODO, models.TaskStatus.IN_PROGRESS]) # (インデントレベル3)
        else:
            final_db_status = random.choice(task_status_choices) # (インデントレベル3)

        # ★ 遅延判定ロジックを追加 ★
        if final_db_status not in [models.TaskStatus.COMPLETED, models.TaskStatus.REVIEW] and \
           due_date_obj < datetime.now() and \
           project["status"] not in [models.ProjectStatus.COMPLETED, models.ProjectStatus.CANCELLED, models.ProjectStatus.ON_HOLD]:
            if random.random() < 0.3: 
                final_db_status = models.TaskStatus.DELAYED

        # statusHistory 生成 (簡易版)
        status_history = [] # ★インデントを修正 (レベル2へ)
        history_start_date = start_date_obj # インデントを status_history = [] に合わせる
        status_history.append({
            "status": models.TaskStatus.TODO.value,
            "changed_at": history_start_date.strftime('%Y-%m-%d'),
            "changed_by": assignee
        })
        if final_db_status == models.TaskStatus.IN_PROGRESS or final_db_status == models.TaskStatus.COMPLETED or final_db_status == models.TaskStatus.REVIEW:
            inprogress_date = history_start_date + timedelta(days=random.randint(0, task_duration // 2))
            if isAfter(inprogress_date, history_start_date):
                status_history.append({
                    "status": models.TaskStatus.IN_PROGRESS.value,
                    "changed_at": inprogress_date.strftime('%Y-%m-%d'),
                    "changed_by": assignee
                })
                history_start_date = inprogress_date
        if final_db_status == models.TaskStatus.REVIEW or final_db_status == models.TaskStatus.COMPLETED:
            review_date = history_start_date + timedelta(days=random.randint(0, (due_date_obj - history_start_date).days // 2 if (due_date_obj - history_start_date).days > 0 else 0))
            if isAfter(review_date, history_start_date):
                status_history.append({
                    "status": models.TaskStatus.REVIEW.value,
                    "changed_at": review_date.strftime('%Y-%m-%d'),
                    "changed_by": assignee
                })
                history_start_date = review_date
        if final_db_status == models.TaskStatus.COMPLETED:
            completed_date = history_start_date + timedelta(days=random.randint(0, (due_date_obj - history_start_date).days if (due_date_obj - history_start_date).days >=0 else 0))
            completed_date = min(completed_date, due_date_obj)
            if isAfter(completed_date, history_start_date) or isEqual(completed_date, history_start_date):
                status_history.append({
                    "status": models.TaskStatus.COMPLETED.value,
                    "changed_at": completed_date.strftime('%Y-%m-%d'),
                    "changed_by": assignee
                })

        # 依存関係生成 (インデントレベル2)
        depends_on = [] # ★インデントを修正 (レベル2へ)
        available_predecessors = project_task_ids[:i]

        if available_predecessors and random.random() < 0.60:
            num_dependencies = 0
            rand_for_num_deps = random.random()
            if rand_for_num_deps < (0.20 / 0.60):
                num_dependencies = 3
            else:
                num_dependencies = 2
            num_dependencies = min(num_dependencies, len(available_predecessors))
            if num_dependencies > 0:
                depends_on = random.sample(available_predecessors, num_dependencies)

        task_data = { # (インデントレベル2)
            "id": task_id_str,
            "projectId": project_id,
            "title": f"タスク {i+1}",
            "description": f"これは {project['name']} のタスク {i+1} の詳細です。",
            "status": final_db_status.value,
            "display_status": project_display_status,
            "taskStartDate": start_date_str,
            "taskDueDate": due_date_str,
            "assigned_to": assignee,
            "cost": cost,
            "priority": priority.value,  # Enumの値を文字列として保存
            "type": task_type.value,     # Enumの値を文字列として保存
            "dependsOn": depends_on,
            "statusHistory": status_history
        }
        tasks.append(task_data) # (インデントレベル2)
    # ★★★ ここまでが for i in range(30) のループ内 ★★★

# ★デバッグプリント追加
print(f"Total tasks generated in mock_data: {len(tasks)}")
if len(tasks) > 5:
    print("First 5 tasks in mock_data:")
    for i in range(5):
        print(tasks[i]['title'])
    print("Last 5 tasks in mock_data:")
    for i in range(len(tasks)-5, len(tasks)):
        print(tasks[i]['title'])
# ★ここまで

# --- グループデータ (既存のものを流用または新規作成) ---
groups = [
    {"id": "group-dev-alpha", "name": "開発チームα", "description": "新製品開発プロジェクトα担当"},
    {"id": "group-dev-beta", "name": "開発チームβ", "description": "既存システム改善β担当"},
    {"id": "group-design", "name": "デザインチーム", "description": "UI/UX担当横断チーム"},
]

# --- イベントデータ (約100件、ミーティング・ワークショップ・締切・マイルストーン) ---
events = []
event_types = [models.EventType.MEETING, models.EventType.WORKSHOP, models.EventType.DEADLINE, models.EventType.MILESTONE]
project_ids = [p["id"] for p in projects]

for i in range(100):
    event_type = random.choice(event_types)
    event_name_prefix = ""
    if event_type == models.EventType.MEETING: event_name_prefix = "会議: "
    elif event_type == models.EventType.DEADLINE: event_name_prefix = "締切: "
    elif event_type == models.EventType.MILESTONE: event_name_prefix = "マイルストーン: "
    
    # イベントの日付をランダムなプロジェクトの期間内に設定
    random_project = random.choice(projects)
    event_project_start = datetime.strptime(random_project["startDate"], '%Y-%m-%d')
    event_project_end = datetime.strptime(random_project["endDate"], '%Y-%m-%d')
    project_duration_days = (event_project_end - event_project_start).days
    if project_duration_days <=0: project_duration_days = 1 # 期間が0以下なら1日に

    event_day_offset = random.randint(0, project_duration_days)
    event_date = event_project_start + timedelta(days=event_day_offset)
    
    all_day = False
    participants = None
    if event_type in [models.EventType.DEADLINE, models.EventType.MILESTONE]:
        all_day = True
        start_time = event_date.strftime('%Y-%m-%dT00:00:00')
        end_time = event_date.strftime('%Y-%m-%dT23:59:59')
    elif event_type in [models.EventType.MEETING, models.EventType.WORKSHOP]:
        start_hour = random.randint(9, 20)
        start_minute = random.choice([0, 30])
        start_datetime = event_date.replace(hour=start_hour, minute=start_minute)
        end_datetime = start_datetime + timedelta(hours=1)
        start_time = start_datetime.strftime('%Y-%m-%dT%H:%M:%S')
        end_time = end_datetime.strftime('%Y-%m-%dT%H:%M:%S')
        # 参加者を必ず1人以上割り当て
        participant_candidates = ([{"type": "user", "id": u["id"]} for u in users if u["role"] != "admin"] +
                                 [{"type": "group", "id": g["id"]} for g in groups])
        num_participants = random.randint(1, min(3, len(participant_candidates)))
        participants = random.sample(participant_candidates, num_participants)

    event_status = random.choice(['online', 'offline'])

    events.append({
        "id": f"event-{i+1}",
        "title": f"{event_name_prefix}{random_project['name']}関連 - {i+1}",
        "description": f"{event_type.value}イベントの詳細説明です。",
        "type": event_type.value.upper(),
        "start_time": start_time,
        "end_time": end_time,
        "allDay": all_day,
        "status": event_status, # online/offline
        "project_id": random.choice(project_ids) if project_ids else None,
        "location": random.choice(["会議室A", "オンライン", "第3会議室", None]),
        "participants": participants
    })

# --- ユーザーグループデータ (ランダム割り当て) ---
user_groups = []
if groups and users:
    for user_entry in users:
        if user_entry["role"] != "admin": # 管理者以外をグループに割り当て
            num_groups_for_user = random.randint(0, len(groups)) # 0も許容
            assigned_groups = random.sample(groups, num_groups_for_user)
            for group_entry in assigned_groups:
                user_groups.append({
                    "user_id": user_entry["id"],
                    "group_id": group_entry["id"],
                    "role": random.choice([models.GroupRole.MEMBER.value, models.GroupRole.OBSERVER.value])
                })

# データを辞書としてエクスポート (init_db.py からインポートされることを想定)
mock_data_for_db = {
    "users": users,
    "projects": projects,
    "tasks": tasks,
    "events": events,
    "groups": groups,
    "user_groups": user_groups
}

print("Mock data generated/updated (proj-A adjusted for April 30th completion).") # 起動時に確認用 