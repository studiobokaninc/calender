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
    
    # get_tasks (辞書形式)
    tasks = crud.get_tasks(db, project_id=proj.id)
    assert len(tasks) == 1
    assert tasks[0]["name"] == "Test Task"
    assert tasks[0]["status"] == "todo"

def test_update_task_status(db: Session):
    proj = models.Project(name="Proj", status=models.ProjectStatus.PLANNING)
    db.add(proj)
    db.commit()
    
    task = models.Task(name="Old Task", project_id=proj.id, status=models.TaskStatus.TODO)
    db.add(task)
    db.commit()
    
    task_update = schemas.TaskUpdate(status=models.TaskStatus.IN_PROGRESS)
    updated = crud.update_task(db, task, task_update)
    assert updated.status == models.TaskStatus.IN_PROGRESS
    
    # 履歴が追加されたか確認
    history = db.query(models.TaskStatusHistory).filter_by(task_id=task.id).all()
    assert len(history) == 1
    assert history[0].status == models.TaskStatus.IN_PROGRESS
