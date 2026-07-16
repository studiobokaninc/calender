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

