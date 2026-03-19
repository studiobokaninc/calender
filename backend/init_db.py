# backend/init_db.py
import sys
import os
import logging # logging モジュールをインポート
from datetime import datetime, timedelta
import re
import math # math をインポート

# Allow sibling imports like `from backend.app import crud`
# Get the absolute path of the directory containing this script (backend/)
backend_dir = os.path.dirname(os.path.abspath(__file__))
# Get the absolute path of the parent directory (workspace root)
workspace_root = os.path.dirname(backend_dir)
# Add the workspace root to sys.path
if workspace_root not in sys.path:
    sys.path.insert(0, workspace_root)

try:
    from backend.app import crud, models, mock_data
    from backend.app.database import SessionLocal, engine
    # Import Pydantic models needed for CRUD function arguments from schemas.py
    from backend.app.schemas import (
        UserCreate, ProjectCreate, TaskCreate, EventCreate, GroupCreate, UserGroupCreate
    )
except ImportError as e:
    print(f"Error importing modules: {e}")
    print("Please ensure you run this script from the workspace root directory using `python -m backend.init_db`")
    sys.exit(1)

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO, format='%(levelname)s:%(name)s:%(message)s')
log = logging.getLogger('init_db') # Logger を取得

def init_db():
    log.info(f"データベースファイルパス: {engine.url}") # DBパス確認
    db = SessionLocal()

    try:
        log.info("データベーステーブルを作成します...")
        # Optional: Drop existing tables first for a clean slate
        # log.info("既存のテーブルを削除します...")
        # models.Base.metadata.drop_all(bind=engine)
        models.Base.metadata.create_all(bind=engine)
        log.info("テーブル作成完了。")

        # テーブル作成後にファイルが存在するか確認 (手動確認も推奨)
        db_file_path = str(engine.url).split('///')[-1]
        if os.path.exists(db_file_path):
            log.info(f"データベースファイル {db_file_path} が存在します。")
        else:
            log.warning(f"データベースファイル {db_file_path} が見つかりません！")


        log.info("データベースにモックデータを投入します...")

        # --- Seed Users ---
        log.info("  ユーザー投入開始...")
        initial_user_count = db.query(models.User).count()
        log.info(f"    投入前のユーザー数: {initial_user_count}")
        seeded_user_count = 0
        mock_users_by_id_str = {}
        db_users_by_email = {}
        mock_user_str_id_to_db_id = {} # ★ マッピング用辞書を初期化

        for user_data in mock_data.users:
            mock_users_by_id_str[user_data["id"]] = user_data
            log.info(f"    チェック中: {user_data['email']}")
            existing_user = crud.get_user_by_email(db, email=user_data["email"])
            if existing_user:
                log.info(f"      -> 既存ユーザー発見 (ID: {existing_user.id}). スキップします。")
                db_users_by_email[existing_user.email] = existing_user.id
                mock_user_str_id_to_db_id[user_data["id"]] = existing_user.id # ★ 既存ユーザーの場合もマッピング
            else:
                log.info(f"      -> 既存ユーザーなし。作成します。")
                user_create = UserCreate(
                    email=user_data["email"],
                    username=user_data.get("username"),
                    name=user_data.get("full_name"),
                    role=user_data.get("role"),
                    password=user_data["password"]
                )
                try:
                    db_user = crud.create_user(db, user=user_create)
                    db_users_by_email[db_user.email] = db_user.id
                    mock_user_str_id_to_db_id[user_data["id"]] = db_user.id # ★ 新規作成ユーザーをマッピング
                    seeded_user_count += 1
                    log.info(f"      -> ユーザー作成成功 (ID: {db_user.id}, Name: {db_user.name})")
                except Exception as e_user:
                    log.error(f"      -> ユーザー作成中にエラー: {e_user}")

        final_user_count = db.query(models.User).count()
        log.info(f"  ユーザー投入完了。{seeded_user_count} 件追加。最終的なユーザー数: {final_user_count}")
        log.info(f"    作成されたユーザーIDマッピング: {mock_user_str_id_to_db_id}") # ★ マッピング結果をログ出力


        # --- Seed Projects ---
        log.info("  プロジェクト投入開始...")
        initial_project_count = db.query(models.Project).count()
        log.info(f"    投入前のプロジェクト数: {initial_project_count}")
        seeded_project_count = 0
        mock_projects_by_id_str = {} # Store mock project dicts
        db_projects_by_name = {} # Store DB project IDs by name

        for project_data in mock_data.projects:
            mock_projects_by_id_str[project_data["id"]] = project_data
            log.info(f"    チェック中: {project_data['name']}")
            # Check if project with the same name exists
            existing_project = db.query(models.Project).filter(models.Project.name == project_data["name"]).first()
            if existing_project:
                log.info(f"      -> 既存プロジェクト発見 (ID: {existing_project.id}). スキップします。")
                db_projects_by_name[existing_project.name] = existing_project.id
            else:
                log.info(f"      -> 既存プロジェクトなし。作成します。")
                start_date_obj = None
                start_date_str = project_data.get("startDate")
                if start_date_str:
                    try:
                        start_date_obj = datetime.strptime(start_date_str, '%Y-%m-%d')
                    except ValueError:
                        log.warning(f"      -> プロジェクト '{project_data['name']}' の startDate '{start_date_str}' のパースに失敗しました。")
                
                end_date_obj = None
                end_date_str = project_data.get("endDate")
                if end_date_str:
                    try:
                        end_date_obj = datetime.strptime(end_date_str, '%Y-%m-%d')
                    except ValueError:
                        log.warning(f"      -> プロジェクト '{project_data['name']}' の endDate '{end_date_str}' のパースに失敗しました。")

                project_create = ProjectCreate(
                    name=project_data["name"],
                    description=project_data.get("description"),
                    status=project_data.get("status"),
                    start_date=start_date_obj, 
                    end_date=end_date_obj,   
                    color=project_data.get("color"),
                    display_status=project_data.get("display_status")
                )
                try:
                    db_project = crud.create_project(db, project=project_create)
                    db_projects_by_name[db_project.name] = db_project.id
                    seeded_project_count += 1
                    log.info(f"      -> プロジェクト作成成功 (ID: {db_project.id})")
                except Exception as e_proj:
                     log.error(f"      -> プロジェクト作成中にエラー: {e_proj}")

        final_project_count = db.query(models.Project).count()
        log.info(f"  プロジェクト投入完了。{seeded_project_count} 件追加。最終的なプロジェクト数: {final_project_count}")


        # --- Seed Tasks ---
        log.info("  タスク投入開始...")
        initial_task_count = db.query(models.Task).count()
        log.info(f"    投入前のタスク数: {initial_task_count}")
        seeded_task_count = 0
        for task_data in mock_data.tasks:
            log.info(f"    チェック中: Project: {task_data.get('projectId')} - Title: {task_data['title']}")

            # Map Mock Project ID to DB Project ID
            mock_project_id_str = task_data.get("projectId")
            db_project_id = None # DB上の実際のプロジェクトID (数値)
            if mock_project_id_str:
                mock_project_for_this_task = mock_projects_by_id_str.get(mock_project_id_str) 
                if mock_project_for_this_task:
                    db_project_id = db_projects_by_name.get(mock_project_for_this_task["name"]) 

            # 既存タスクのチェックロジックを修正
            existing_task = None
            if db_project_id is not None: 
                existing_task = db.query(models.Task).filter(
                    models.Task.name == task_data["title"],
                    models.Task.project_id == db_project_id
                ).first()
            else:
                log.warning(f"      タスク '{task_data['title']}' のプロジェクトID '{mock_project_id_str}' がDBで見つかりませんでした。タスク名のみで重複チェックします。")
                existing_task = db.query(models.Task).filter(models.Task.name == task_data["title"]).first() # インデント追加
                
            if existing_task:
                log.info(f"      -> 既存タスク発見 (ID: {existing_task.id}, Name: {existing_task.name}, ProjectID: {existing_task.project_id}). スキップします。")
            else:
                log.info(f"      -> 既存タスクなし。作成します。(Name: {task_data['title']}, Target DB ProjectID: {db_project_id})")
                # Map Mock Assignee ID (str) to DB Assignee ID (int)
                mock_assignee_str_id = task_data.get("assigned_to") # Get mock assignee string ID
                db_assignee_id = None # Initialize DB assignee ID (numeric or None)
                if mock_assignee_str_id:
                    db_assignee_id = mock_user_str_id_to_db_id.get(mock_assignee_str_id) # ★ Use mapping dict
                    if not db_assignee_id:
                        log.warning(f"Task '{task_data.get('title')}': Mock Assignee ID '{mock_assignee_str_id}' not found in mapping. Setting to None.")
                else:
                    log.info(f"Task '{task_data.get('title')}': No assignee in mock_data.")

                log.info(f"      -> Assignee for DB: {db_assignee_id}") # Should now log numeric ID or None

                # --- 開始日を期日の前日とするロジック (修正箇所) ---
                due_date_str = task_data.get("taskDueDate") 
                due_date_obj = None
                start_date_obj = None

                if due_date_str:
                    try:
                        due_date_obj = datetime.strptime(due_date_str, '%Y-%m-%d')
                        cost_hours = float(task_data.get("cost", 8.0)) # cost を float として取得、デフォルト8時間
                        days_to_subtract = math.ceil(cost_hours / 8.0) # 8時間/日で日数を計算 (切り上げ)
                        start_date_obj = due_date_obj - timedelta(days=days_to_subtract)
                    except ValueError as e:
                        log.warning(f"      -> タスク '{task_data.get('title')}' の期日 '{due_date_str}' またはコストのパースに失敗: {e}")
                    except TypeError as e:
                        log.warning(f"      -> タスク '{task_data.get('title')}' のコストが不正な型の可能性があります: {e}")
                
                start_date_for_db = start_date_obj.strftime('%Y-%m-%d') if start_date_obj else None
                due_date_for_db = due_date_obj.strftime('%Y-%m-%d') if due_date_obj else None
                # --- ここまで ---

                task_create_data = {
                    "name": task_data.get("title", "名称未設定タスク"),
                    "description": task_data.get("description"),
                    "status": task_data.get("status", "todo"),
                    "start_date": start_date_for_db, 
                    "due_date": due_date_for_db,     
                    "progress": task_data.get("progress"),
                    "project_id": db_project_id,
                    "assigned_to": db_assignee_id,
                    "cost": task_data.get("cost", 8.0),  # コストはモックデータから取得、なければ8.0
                    "type": task_data.get("type"),       # タスクタイプ
                    "dependsOn": task_data.get("dependsOn")
                }
                
                # None の値を持つキーを除外する (既存のロジック)
                final_task_data_for_creation = {k: v for k, v in task_create_data.items() if v is not None}
                
                if "name" not in final_task_data_for_creation or not final_task_data_for_creation["name"]:
                    log.error(f"Task creation skipped: 'name' (derived from mock 'title') is missing or empty for task: {task_data.get('title', 'N/A')}")
                    continue
                
                final_task_data_for_creation['project_id'] = db_project_id
                final_task_data_for_creation['assigned_to'] = db_assignee_id
                depends_on_value = task_data.get("dependsOn")
                if depends_on_value is not None and depends_on_value: 
                    final_task_data_for_creation['dependsOn'] = depends_on_value
                elif 'dependsOn' in final_task_data_for_creation: 
                    del final_task_data_for_creation['dependsOn']

                task_create_schema = TaskCreate(**final_task_data_for_creation)
                try:
                    db_task = crud.create_task(db, task=task_create_schema)
                    log.info(f"      -> タスク作成成功 (ID: {db_task.id}, AssigneeID: {db_task.assigned_to})") # ★ Log assigned_to from created task

                    # モックデータの statusHistory を処理
                    mock_history = task_data.get("statusHistory")
                    if mock_history:
                        log.info(f"        -> モック履歴 ({len(mock_history)}件) を投入します...")
                        try:
                            # 1. crud.create_task が追加した初期履歴を削除
                            deleted_count = db.query(models.TaskStatusHistory).filter(
                                models.TaskStatusHistory.task_id == db_task.id
                            ).delete(synchronize_session=False)
                            log.info(f"          -> 自動生成された初期履歴 {deleted_count} 件を削除しました。")

                            # 2. モックデータから履歴を作成して追加
                            history_entries_to_add = []
                            for entry in mock_history:
                                try:
                                    # タイムスタンプ文字列を datetime オブジェクトにパース
                                    timestamp_obj = None
                                    timestamp_str = entry.get("changed_at")
                                    if timestamp_str:
                                        try:
                                            # 日付のみの形式 (%Y-%m-%d) を想定
                                            timestamp_obj = datetime.strptime(timestamp_str, '%Y-%m-%d')
                                        except ValueError:
                                            log.warning(f"            -> 履歴タイムスタンプ '{timestamp_str}' のパースに失敗 (タスクID: {db_task.id})")
                                            continue

                                    # ステータスを Enum に変換
                                    status_enum = None
                                    status_val = entry.get("status")
                                    if status_val:
                                        try:
                                            status_enum = models.TaskStatus(status_val)
                                        except ValueError:
                                            log.warning(f"            -> 不正な履歴ステータス '{status_val}' (タスクID: {db_task.id})")
                                            continue

                                    if timestamp_obj and status_enum:
                                        # assigneeの文字列IDを数値IDに変換
                                        history_assignee_id = None
                                        if entry.get("changed_by"):
                                            mock_user = mock_users_by_id_str.get(entry["changed_by"])
                                            if mock_user:
                                                history_assignee_id = db_users_by_email.get(mock_user["email"])

                                        history_entry = models.TaskStatusHistory(
                                            task_id=db_task.id,
                                            status=status_enum,
                                            changed_at=timestamp_obj,
                                            changed_by=history_assignee_id
                                        )
                                        db.add(history_entry)
                                        history_entries_to_add.append(history_entry)
                                        log.info(f"            -> 履歴エントリ追加: タスクID={db_task.id}, ステータス={status_enum}, 変更日時={timestamp_obj}, 変更者={history_assignee_id}")
                                except Exception as e:
                                    log.error(f"            -> 履歴エントリ追加中にエラー: {e}")
                                    continue

                            if history_entries_to_add:
                                try:
                                    log.info(f"          -> モックから {len(history_entries_to_add)} 件の履歴を追加準備完了。")
                                    db.flush()  # 全履歴の即時反映
                                    db.commit()  # 履歴のコミット
                                    log.info(f"          -> モック履歴のコミット完了。")
                                except Exception as e:
                                    log.error(f"          -> 履歴のコミット中にエラー: {e}")
                                    db.rollback()
                                    raise  # エラーを上位に伝播

                        except Exception as e_hist:
                            log.error(f"        -> モック履歴の処理中にエラーが発生: {e_hist}")
                            db.rollback() # エラー時はロールバック

                    seeded_task_count += 1

                except Exception as e_task:
                    log.error(f"      -> タスク作成または履歴処理中にエラー: {e_task}")
                    db.rollback()

        final_task_count = db.query(models.Task).count()
        log.info(f"  タスク投入完了。{seeded_task_count} 件処理。最終的なタスク数: {final_task_count}")


        # --- Seed Events ---
        log.info("  イベント投入開始...")
        initial_event_count = db.query(models.Event).count()
        log.info(f"    投入前のイベント数: {initial_event_count}")
        seeded_event_count = 0
        for event_data in mock_data.events:
            event_title = event_data.get("title")
            if not event_title:
                log.warning(f"      -> イベント名(title)がないためスキップ: {event_data}")
                continue
            # ★★★ 種別プレフィックスを除去 ★★★
            cleaned_title = re.sub(r"^(締切|会議|マイルストーン|レビュー|Deadline|Meeting|Milestone|Review):\s*", "", event_title)
            log.info(f"    チェック中: {cleaned_title}")
            existing_event = db.query(models.Event).filter(models.Event.title == cleaned_title).first()
            if existing_event:
                log.info(f"      -> 既存イベント発見 (ID: {existing_event.id}). スキップします。")
            else:
                # Map Mock Project ID (could be int or str in mock) to DB Project ID (int) via Name
                mock_project_id = event_data.get("project_id") # Type might vary
                db_project_id = None
                if mock_project_id is not None:
                    mock_project = None
                    if isinstance(mock_project_id, str):
                        mock_project = mock_projects_by_id_str.get(mock_project_id)
                    elif isinstance(mock_project_id, int): # Should not happen if mock_data uses string IDs for projects
                         mock_project = next((p for p_id, p in mock_projects_by_id_str.items() if p.get('id_int') == mock_project_id), None)

                    if mock_project:
                        db_project_id = db_projects_by_name.get(mock_project["name"])
                    else:
                        log.warning(f"      -> イベント '{cleaned_title}' のプロジェクト情報が見つかりません (ProjectID: {mock_project_id})") # 変数名修正

                log.info(f"      -> 既存イベントなし。作成します。")

                # --- 日時文字列を datetime オブジェクトにパース ---
                start_time_obj = None
                start_time_str = event_data.get("start_time")
                if start_time_str:
                    try:
                        # mock_data.py のフォーマット (%Y-%m-%dT%H:%M:%S) に合わせてパース
                        start_time_obj = datetime.strptime(start_time_str, '%Y-%m-%dT%H:%M:%S')
                    except ValueError as e:
                        log.warning(f"      -> イベント '{cleaned_title}' の start_time '{start_time_str}' のパースに失敗: {e}") # 変数名修正

                end_time_obj = None
                end_time_str = event_data.get("end_time")
                if end_time_str:
                    try:
                        # mock_data.py のフォーマット (%Y-%m-%dT%H:%M:%S) に合わせてパース
                        end_time_obj = datetime.strptime(end_time_str, '%Y-%m-%dT%H:%M:%S')
                    except ValueError as e:
                        log.warning(f"      -> イベント '{cleaned_title}' の end_time '{end_time_str}' のパースに失敗: {e}") # 変数名修正
                # --- パース処理ここまで ---

                # --- type値をEnum値に正規化 ---
                type_map = {
                    "task": "TASK",
                    "meeting": "MEETING",
                    "deadline": "DEADLINE",
                    "milestone": "MILESTONE",
                    "workshop": "WORKSHOP",
                    "generic": "GENERIC",
                    # 既にEnum値ならそのまま
                    "TASK": "TASK",
                    "MEETING": "MEETING",
                    "DEADLINE": "DEADLINE",
                    "MILESTONE": "MILESTONE",
                    "WORKSHOP": "WORKSHOP",
                    "GENERIC": "GENERIC",
                }
                raw_type = event_data.get("type")
                normalized_type = type_map.get(str(raw_type).upper(), "GENERIC")

                event_payload = {
                    "title": cleaned_title,  # ← ここをcleaned_titleに
                    "description": event_data.get("description"),
                    "start_time": start_time_obj,
                    "end_time": end_time_obj,
                    "location": event_data.get("location"),
                    "type": normalized_type,
                    "allDay": event_data.get("allDay", False),
                    "project_id": db_project_id,
                    "status": event_data.get("status")
                }
                if event_payload["allDay"] is None:
                    event_payload["allDay"] = False
                event_create_schema = EventCreate(**event_payload)
                try:
                    db_event = crud.create_event(db, event=event_create_schema)
                    seeded_event_count += 1
                    log.info(f"      -> イベント作成成功 (ID: {db_event.id})")
                except Exception as create_exc:
                    log.error(f"      -> イベント作成中にエラー: {create_exc}")

        final_event_count = db.query(models.Event).count()
        log.info(f"  イベント投入完了。{seeded_event_count} 件追加。最終的なイベント数: {final_event_count}")


        # --- Seed Groups (if they exist in mock_data) ---
        if hasattr(mock_data, 'groups'):
            log.info("  グループ投入開始...")
            initial_group_count = db.query(models.Group).count()
            log.info(f"    投入前のグループ数: {initial_group_count}")
            seeded_group_count = 0
            mock_groups_by_id_str = {} # Store mock group dicts
            db_groups_by_name = {} # Store DB group IDs by name

            for group_data in mock_data.groups:
                mock_groups_by_id_str[group_data["id"]] = group_data
                log.info(f"    チェック中: {group_data['name']}")
                existing_group = db.query(models.Group).filter(models.Group.name == group_data["name"]).first()
                if existing_group:
                    log.info(f"      -> 既存グループ発見 (ID: {existing_group.id}). スキップします。")
                    db_groups_by_name[existing_group.name] = existing_group.id
                else:
                    log.info(f"      -> 既存グループなし。作成します。")
                    group_create = GroupCreate(
                        name=group_data["name"],
                        description=group_data.get("description")
                    )
                    try:
                        db_group = crud.create_group(db, group=group_create)
                        db_groups_by_name[db_group.name] = db_group.id
                        seeded_group_count += 1
                        log.info(f"      -> グループ作成成功 (ID: {db_group.id})")
                    except Exception as e_group:
                        log.error(f"      -> グループ作成中にエラー: {e_group}")

            final_group_count = db.query(models.Group).count()
            log.info(f"  グループ投入完了。{seeded_group_count} 件追加。最終的なグループ数: {final_group_count}")

            # --- Seed UserGroups (if they exist) ---
            if hasattr(mock_data, 'user_groups'):
                log.info("  ユーザーグループ投入開始...")
                initial_ug_count = db.query(models.UserGroup).count()
                log.info(f"    投入前のユーザーグループ数: {initial_ug_count}")
                seeded_user_group_count = 0
                for ug_data in mock_data.user_groups:
                    # Map Mock User ID (str) to DB User ID (int) via Email
                    mock_user_id_str = ug_data.get("user_id")
                    db_user_id = None
                    if mock_user_id_str:
                        mock_user = mock_users_by_id_str.get(mock_user_id_str)
                        if mock_user:
                            db_user_id = db_users_by_email.get(mock_user["email"])

                    # Map Mock Group ID (str) to DB Group ID (int) via Name
                    mock_group_id_str = ug_data.get("group_id")
                    db_group_id = None
                    if mock_group_id_str:
                        mock_group = mock_groups_by_id_str.get(mock_group_id_str)
                        if mock_group:
                            db_group_id = db_groups_by_name.get(mock_group["name"])

                    if db_user_id and db_group_id:
                        log.info(f"    チェック中: UserID={db_user_id}, GroupID={db_group_id}")
                        existing_relation = crud.get_user_group(db, user_id=db_user_id, group_id=db_group_id)
                        if existing_relation:
                             log.info(f"      -> 既存の関連を発見。スキップします。")
                        else:
                            log.info(f"      -> 既存の関連なし。作成します。")
                            user_group_create = UserGroupCreate(
                                user_id=str(db_user_id), # Create expects str? Check schema
                                group_id=str(db_group_id),# Create expects str? Check schema
                                role=ug_data.get("role")
                            )
                            try:
                                crud.add_user_to_group(db, user_group=user_group_create)
                                seeded_user_group_count += 1
                                log.info(f"      -> ユーザーグループ関連作成成功")
                            except Exception as e_ug:
                                log.error(f"      -> ユーザーグループ関連作成中にエラー: {e_ug}")
                    else:
                        log.warning(f"      -> User/Group ID のマッピングに失敗したためスキップ: {ug_data}")

                final_ug_count = db.query(models.UserGroup).count()
                log.info(f"  ユーザーグループ投入完了。{seeded_user_group_count} 件追加。最終的なユーザーグループ数: {final_ug_count}")

        log.info("データベースのシーディング完了。")

    except Exception as e:
        log.error(f"シーディング中に予期せぬエラーが発生: {e}")
        log.info("変更をロールバックします...")
        db.rollback()
    finally:
        db.close()
        log.info("データベースセッションを閉じました。")

if __name__ == "__main__":
    log.info("データベースの初期化とデータ投入を開始します...")
    init_db()
    log.info("完了。") 