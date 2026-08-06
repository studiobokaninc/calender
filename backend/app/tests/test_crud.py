import pytest
from sqlalchemy.orm import Session
from app import crud, models, schemas

def test_create_and_get_project(db: Session):
    # プロジェクト作成
    proj_in = schemas.ProjectCreate(
        name="Test Project",
        description="Testing crud",
        status=models.ProjectStatus.PLANNING,
        color="#FFFFFF",
        startDate="2025-04-01",
        endDate="2025-04-30"
    )
    proj = crud.create_project(db, proj_in)
    assert proj.id is not None
    assert proj.name == "Test Project"
    
    # 取得
    proj_get = crud.get_project(db, proj.id)
    assert proj_get.name == "Test Project"

def test_create_and_get_tasks(db: Session):
    # ユーザーとプロジェクト作成 (依存関係)
    user = models.User(username="testuser", email="test@example.com", hashed_password="pw", role="user")
    db.add(user)
    db.commit()
    
    proj = models.Project(name="Proj", status=models.ProjectStatus.PLANNING)
    db.add(proj)
    db.commit()
    
    # タスク作成
    task_in = schemas.TaskCreate(
        name="Test Task",
        project_id=proj.id,
        assigned_to=user.id,
        start_date="2025-04-01",
        due_date="2025-04-05",
        cost=8,
        priority=models.TaskPriority.MEDIUM,
        type=models.TaskType.DESIGN
    )
    task = crud.create_task(db, task_in)
    assert task.id is not None
    assert task.name == "Test Task"
    
    # get_tasks (辞書形式)。task_status_redesign_v2: 作成時の既定はシステム自動の 'wt'
    tasks = crud.get_tasks(db, project_id=proj.id)
    assert len(tasks) == 1
    assert tasks[0]["name"] == "Test Task"
    assert tasks[0]["status"] == "wt"

def test_update_task_status(db: Session):
    proj = models.Project(name="Proj", status=models.ProjectStatus.PLANNING)
    db.add(proj)
    db.commit()

    task = models.Task(name="Old Task", project_id=proj.id, status=models.TaskStatus.MK)
    db.add(task)
    db.commit()

    task_update = schemas.TaskUpdate(status=models.TaskStatus.WIP)
    updated = crud.update_task(db, task, task_update)
    assert updated.status == models.TaskStatus.WIP

    # 履歴が追加されたか確認
    history = db.query(models.TaskStatusHistory).filter_by(task_id=task.id).all()
    assert len(history) == 1
    assert history[0].status == models.TaskStatus.WIP

def test_project_level_task_seq_pm(db: Session):
    proj = models.Project(name="Proj PM Test", status=models.ProjectStatus.PLANNING)
    db.add(proj)
    db.commit()

    # Create task without shotID or shot_id
    task_in = schemas.TaskCreate(
        name="Project Level PM Task",
        project_id=proj.id,
        shotID="",
        seqID=""
    )
    task = crud.create_task(db, task_in)
    assert task.seqID == "SEQ_PM"

    # Create task with shotID but no seqID
    task_in_with_shot = schemas.TaskCreate(
        name="Shot Level Task",
        project_id=proj.id,
        shotID="shot01",
        seqID=""
    )
    task_with_shot = crud.create_task(db, task_in_with_shot)
    assert task_with_shot.seqID == ""

    # Update task to remove shotID and shot_id
    task_update = schemas.TaskUpdate(shotID="", seqID="")
    updated_task = crud.update_task(db, task_with_shot, task_update)
    assert updated_task.seqID == "SEQ_PM"


def test_create_and_update_event_direct_time(db: Session):
    # イベント作成
    event_in = schemas.EventCreate(
        title="Test Event",
        type="Meeting",
        start_time="2026-06-01T10:00:00+09:00",
        end_time="2026-06-01T11:00:00+09:00"
    )
    event = crud.create_event(db, event_in)
    assert event.id is not None
    assert event.title == "Test Event"
    
    # モデルの start_time は naive datetime なのでタイムゾーン部を除いたアサーション等に合わせるか、
    # または単純に crud.update_event が正常に日付を更新できるかをアサートする
    # update_event を呼んで日付が 06-05 に変わるかをテスト
    event_update = schemas.EventUpdate(
        start_time="2026-06-05T15:00:00+09:00",
        end_time="2026-06-05T16:00:00+09:00"
    )
    updated_event = crud.update_event(db, event, event_update)
    # 日付が更新されたことを検証
    assert updated_event.start_time.day == 5
    assert updated_event.start_time.month == 6
    assert updated_event.start_time.hour == 15
    assert updated_event.end_time.day == 5
    assert updated_event.end_time.month == 6
    assert updated_event.end_time.hour == 16


def test_project_end_date_updated_when_task_due_date_exceeds(db: Session):
    from datetime import datetime
    # 1. Create project with an end date
    project = models.Project(
        name="Test End Date Project",
        start_date=datetime(2026, 4, 1),
        end_date=datetime(2026, 4, 30),
        status=models.ProjectStatus.PLANNING
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    # 2. Create task with due date within project range -> project end date should not change
    task_in_1 = schemas.TaskCreate(
        name="Task Within Range",
        project_id=project.id,
        due_date="2026-04-15"
    )
    task1 = crud.create_task(db, task_in_1)
    db.refresh(project)
    assert project.end_date == datetime(2026, 4, 30)

    # 3. Create task with due date exceeding project end date -> project end date should update
    task_in_2 = schemas.TaskCreate(
        name="Task Exceeding Range",
        project_id=project.id,
        due_date="2026-05-05"
    )
    task2 = crud.create_task(db, task_in_2)
    db.refresh(project)
    assert project.end_date == datetime(2026, 5, 5)

    # 4. Update task1 to exceed new project end date -> project end date should update
    task_update = schemas.TaskUpdate(
        due_date="2026-05-10"
    )
    crud.update_task(db, task1, task_update)
    db.refresh(project)
    assert project.end_date == datetime(2026, 5, 10)

    # 5. Update task2 to a date earlier than project end date -> project end date should not change
    task_update_earlier = schemas.TaskUpdate(
        due_date="2026-04-20"
    )
    crud.update_task(db, task2, task_update_earlier)
    db.refresh(project)
    assert project.end_date == datetime(2026, 5, 10)


def test_task_seq_id_editing_and_creation(db: Session):
    # 1. Create a project and a user
    user = models.User(username="seq_user", email="seq@example.com", hashed_password="pw", role="user")
    db.add(user)
    db.commit()
    db.refresh(user)

    project = models.Project(name="Seq Project", status=models.ProjectStatus.PLANNING)
    db.add(project)
    db.commit()
    db.refresh(project)

    # 2. Create task using seq_id (snake_case) with a shotID so it's a shot-level task and not reset to SEQ_PM
    task_in = schemas.TaskCreate(
        name="Task with seq_id",
        project_id=project.id,
        assigned_to=user.id,
        shotID="shot01",
        seq_id="SEQ999"
    )
    task = crud.create_task(db, task_in)
    assert task.seqID == "SEQ999"

    # 3. Update task using seq_id (snake_case)
    task_update = schemas.TaskUpdate(
        seq_id="SEQ888"
    )
    updated = crud.update_task(db, task, task_update)
    assert updated.seqID == "SEQ888"

    # 4. Update task using seqID (camelCase)
    task_update_camel = schemas.TaskUpdate(
        seqID="SEQ777"
    )
    updated_camel = crud.update_task(db, task, task_update_camel)
    assert updated_camel.seqID == "SEQ777"


def test_task_shot_id_synchronization(db: Session):
    # 1. Create project, shot and task
    project = models.Project(name="Shot Sync Project", status=models.ProjectStatus.PLANNING)
    db.add(project)
    db.commit()
    db.refresh(project)

    shot = models.Shot(
        project_id=project.id,
        seq_code="sq_test",
        shot_code="shot_test",
        display_order=0,
        status="planning"
    )
    db.add(shot)
    db.commit()
    db.refresh(shot)

    # 2. Create task using only shot_id (integer ID of the Shot)
    task_in = schemas.TaskCreate(
        name="Task with shot_id",
        project_id=project.id,
        shot_id=shot.id
    )
    task = crud.create_task(db, task_in)
    assert task.shot_id == shot.id
    assert task.shotID == "shot_test"
    assert task.seqID == "sq_test"

    # 3. Update task to unlink from the shot (setting shot_id to None)
    task_update = schemas.TaskUpdate(
        shot_id=None
    )
    updated = crud.update_task(db, task, task_update)
    assert updated.shot_id is None
    assert updated.shotID is None
    assert updated.seqID == "SEQ_PM"

    # 4. Update task back to link to the shot (setting shot_id back to shot.id)
    task_update_back = schemas.TaskUpdate(
        shot_id=shot.id
    )
    updated_back = crud.update_task(db, task, task_update_back)
    assert updated_back.shot_id == shot.id
    assert updated_back.shotID == "shot_test"
    assert updated_back.seqID == "sq_test"




