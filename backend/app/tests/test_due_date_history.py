import pytest
import os
import datetime
from sqlalchemy import text
from app import models, crud, schemas
from app.mcp_server import get_task_due_date_history
from app.timezone import now_jst_naive

@pytest.fixture(autouse=True)
def setup_tokens():
    # If there is no token in the environment, set default ones
    if not os.environ.get("SCORE_READONLY_TOKEN"):
        os.environ["SCORE_READONLY_TOKEN"] = "test_readonly_token_abc"
    if not os.environ.get("CASPER_WRITE_TOKEN"):
        os.environ["CASPER_WRITE_TOKEN"] = "test_casper_write_token"
    yield

def test_due_date_history_table_creation(db):
    # Verify the table exists in SQLite database
    res = db.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='task_due_date_history'")).fetchone()
    assert res is not None
    
    # Verify the indexes exist (supports both custom DDL migration and SQLAlchemy auto-generated naming)
    idx_task = db.execute(text(
        "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_task_due_date_history_task_id', 'ix_task_due_date_history_task_id')"
    )).fetchone()
    assert idx_task is not None
    
    idx_time = db.execute(text(
        "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_task_due_date_history_changed_at', 'ix_task_due_date_history_changed_at')"
    )).fetchone()
    assert idx_time is not None

def test_update_task_records_due_date_history(db):
    # Create test user and project
    user = models.User(email="actor1@example.com", username="actor1", hashed_password="pw", is_active=True, role="user")
    project = models.Project(name="Proj 1", display_status="online")
    db.add_all([user, project])
    db.commit()
    db.refresh(user)
    db.refresh(project)

    # Create task with initial due date
    initial_due = datetime.datetime(2026, 8, 1, 12, 0, 0)
    task = models.Task(
        name="Test Task",
        project_id=project.id,
        due_date=initial_due,
        status=models.TaskStatus.WIP,
        display_status="online"
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    # Update due date using crud.update_task
    new_due = datetime.datetime(2026, 8, 15, 12, 0, 0)
    task_update = schemas.TaskUpdate(due_date=new_due)
    
    updated_task = crud.update_task(
        db=db,
        db_task=task,
        task_in=task_update,
        actor_id=user.id,
        change_source=models.TaskChangeSource.MANUAL
    )

    # 1. Verify history record exists
    history = db.query(models.TaskDueDateHistory).filter(models.TaskDueDateHistory.task_id == task.id).all()
    assert len(history) == 1
    record = history[0]

    # 2. Check correctness of fields
    assert record.old_due_date == initial_due
    assert record.new_due_date == new_due
    assert record.changed_by == user.id
    assert record.change_source == models.TaskChangeSource.MANUAL

    # 3. Check exact timestamp synchronization
    assert record.changed_at == updated_task.updated_at

def test_update_task_no_fallback_for_changed_by(db):
    # Create test assignee user and project
    assignee = models.User(email="assignee@example.com", username="assignee", hashed_password="pw", is_active=True, role="user")
    project = models.Project(name="Proj 2", display_status="online")
    db.add_all([assignee, project])
    db.commit()
    db.refresh(assignee)
    db.refresh(project)

    # Create task assigned to user
    initial_due = datetime.datetime(2026, 8, 1, 12, 0, 0)
    task = models.Task(
        name="Test Task 2",
        project_id=project.id,
        due_date=initial_due,
        assigned_to=assignee.id,
        status=models.TaskStatus.WIP,
        display_status="online"
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    # Update due date with actor_id=None
    new_due = datetime.datetime(2026, 8, 20, 12, 0, 0)
    task_update = schemas.TaskUpdate(due_date=new_due)
    
    crud.update_task(
        db=db,
        db_task=task,
        task_in=task_update,
        actor_id=None,
        change_source=models.TaskChangeSource.SYSTEM
    )

    # Verify history is recorded but changed_by is None (no fallback to assignee)
    history = db.query(models.TaskDueDateHistory).filter(models.TaskDueDateHistory.task_id == task.id).all()
    assert len(history) == 1
    assert history[0].changed_by is None
    assert history[0].change_source == models.TaskChangeSource.SYSTEM

def test_update_task_no_history_on_non_due_date_changes(db):
    actor = models.User(id=1, email="actor@example.com", username="actor", hashed_password="pw", is_active=True, role="user")
    fallback_user = models.User(id=28, email="ryoji@example.com", username="ryoji", hashed_password="pw", is_active=True, role="admin")
    project = models.Project(name="Proj 3", display_status="online")
    db.add_all([actor, fallback_user, project])
    db.commit()
    db.refresh(project)

    initial_due = datetime.datetime(2026, 8, 1, 12, 0, 0)
    task = models.Task(
        name="Test Task 3",
        project_id=project.id,
        due_date=initial_due,
        status=models.TaskStatus.WIP,
        display_status="online"
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    # Update progress and status instead of due date
    task_update = schemas.TaskUpdate(progress=50, status=models.TaskStatus.QC)
    crud.update_task(
        db=db,
        db_task=task,
        task_in=task_update,
        actor_id=1
    )

    # Verify no due date history was recorded
    history = db.query(models.TaskDueDateHistory).filter(models.TaskDueDateHistory.task_id == task.id).all()
    assert len(history) == 0

def test_update_task_no_history_on_same_due_date(db):
    project = models.Project(name="Proj 4", display_status="online")
    db.add(project)
    db.commit()
    db.refresh(project)

    initial_due = datetime.datetime(2026, 8, 1, 12, 0, 0)
    task = models.Task(
        name="Test Task 4",
        project_id=project.id,
        due_date=initial_due,
        status=models.TaskStatus.WIP,
        display_status="online"
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    # Update with the same due date
    task_update = schemas.TaskUpdate(due_date=initial_due)
    crud.update_task(
        db=db,
        db_task=task,
        task_in=task_update,
        actor_id=1
    )

    # Verify no due date history was recorded
    history = db.query(models.TaskDueDateHistory).filter(models.TaskDueDateHistory.task_id == task.id).all()
    assert len(history) == 0

def test_user_delete_set_null_behavior(db):
    # NOTE: SQLite は接続ごとに foreign_keys pragma が既定で OFF のため、ON DELETE SET NULL
    # を実DBレベルで検証するにはこのテストの接続でのみ明示的に有効化する必要がある。
    # `db` はテスト用エンジン(StaticPool)の単一接続を共有するため、他のテストに
    # 影響しないよう try/finally で必ず OFF に戻す。
    db.execute(text("PRAGMA foreign_keys=ON"))
    db.commit()
    try:
        user = models.User(email="actor_del@example.com", username="actordel", hashed_password="pw", is_active=True, role="user")
        project = models.Project(name="Proj 5", display_status="online")
        db.add_all([user, project])
        db.commit()
        db.refresh(user)
        db.refresh(project)

        task = models.Task(name="Test Task 5", project_id=project.id, due_date=datetime.datetime(2026, 8, 1), status="wip")
        db.add(task)
        db.commit()
        db.refresh(task)

        # Change due date
        task_update = schemas.TaskUpdate(due_date=datetime.datetime(2026, 8, 5))
        crud.update_task(db, task, task_update, actor_id=user.id)

        # Verify user set in history
        history = db.query(models.TaskDueDateHistory).filter(models.TaskDueDateHistory.task_id == task.id).first()
        assert history.changed_by == user.id

        # Delete the user
        db.delete(user)
        db.commit()

        # Verify user deletion trigger SET NULL on task_due_date_history
        db.expire_all()
        db.refresh(history)
        assert history.changed_by is None
    finally:
        db.execute(text("PRAGMA foreign_keys=OFF"))
        db.commit()

def test_task_view_permission_checks(db):
    # Setup test users
    admin = models.User(email="admin_perm@example.com", username="adminperm", hashed_password="pw", is_active=True, role="admin")
    non_admin = models.User(email="user_perm@example.com", username="userperm", hashed_password="pw", is_active=True, role="user")
    assignee = models.User(email="assign_perm@example.com", username="assignperm", hashed_password="pw", is_active=True, role="user")
    db.add_all([admin, non_admin, assignee])
    db.commit()
    db.refresh(admin)
    db.refresh(non_admin)
    db.refresh(assignee)

    # Create an offline project
    project = models.Project(name="Offline Proj", display_status="offline")
    db.add(project)
    db.commit()
    db.refresh(project)

    # Create task belonging to offline project
    task = models.Task(
        name="Offline Task",
        project_id=project.id,
        due_date=datetime.datetime(2026, 8, 1),
        status="wip",
        display_status="online",
        assigned_to=assignee.id
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    # 1. Admin can always view
    assert crud.check_task_view_permission(db, task, admin) is True

    # 2. Assignee can view even if project is offline
    assert crud.check_task_view_permission(db, task, assignee) is True

    # 3. Random non-admin cannot view offline project's task
    assert crud.check_task_view_permission(db, task, non_admin) is False

    # 4. If non-admin is added to project user roles, they can view
    role = models.ScoreUserRole(user_id=non_admin.id, project_id=project.id, role="artist")
    db.add(role)
    db.commit()
    assert crud.check_task_view_permission(db, task, non_admin) is True

    # 5. If task display_status is offline, non-admin project member cannot view unless assignee or admin
    db.delete(role)
    db.commit()
    task.display_status = "offline"
    db.commit()
    assert crud.check_task_view_permission(db, task, non_admin) is False

def test_due_date_history_rest_endpoint(client, db):
    # Setup project and task
    project = models.Project(name="Rest Project", display_status="online")
    db.add(project)
    db.commit()
    db.refresh(project)

    task = models.Task(
        name="Rest Task",
        project_id=project.id,
        due_date=datetime.datetime(2026, 8, 1),
        status="wip",
        display_status="online"
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    # Setup admin user for login (FastAPI TestClient headers)
    admin = models.User(email="admin_rest@example.com", username="adminrest", hashed_password="pw", is_active=True, role="admin")
    db.add(admin)
    db.commit()
    db.refresh(admin)

    # 1. Change due date multiple times
    dates = [
        datetime.datetime(2026, 8, 5),
        datetime.datetime(2026, 8, 10),
        datetime.datetime(2026, 8, 15)
    ]
    for d in dates:
        task_update = schemas.TaskUpdate(due_date=d)
        crud.update_task(db, task, task_update, actor_id=admin.id)

    # Generate JWT token for admin
    from app.security import create_access_token
    token = create_access_token(data={"sub": admin.email})
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Get history via REST API
    resp = client.get(f"/api/tasks/{task.id}/due-date-history", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 3

    # Check sorting order: changed_at.asc()
    assert datetime.datetime.fromisoformat(data[0]["new_due_date"]) == dates[0]
    assert datetime.datetime.fromisoformat(data[1]["new_due_date"]) == dates[1]
    assert datetime.datetime.fromisoformat(data[2]["new_due_date"]) == dates[2]

    # 3. Check pagination: limit=1
    resp_paginated = client.get(f"/api/tasks/{task.id}/due-date-history?limit=1", headers=headers)
    assert resp_paginated.status_code == 200
    assert len(resp_paginated.json()) == 1

def test_due_date_history_mcp_tool(db, monkeypatch):
    # Setup test DB injection for MCP tool
    monkeypatch.setattr("app.mcp_server.SessionLocal", lambda: db)
    monkeypatch.setattr(db, "close", lambda: None)

    admin = models.User(email="admin_mcp@example.com", username="adminmcp", hashed_password="pw", is_active=True, role="admin")
    project = models.Project(name="Mcp Project", display_status="online")
    db.add_all([admin, project])
    db.commit()
    db.refresh(admin)
    db.refresh(project)

    task = models.Task(
        name="Mcp Task",
        project_id=project.id,
        due_date=datetime.datetime(2026, 8, 1),
        status="wip",
        display_status="online"
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    # Change due date
    task_update = schemas.TaskUpdate(due_date=datetime.datetime(2026, 8, 5))
    crud.update_task(db, task, task_update, actor_id=admin.id)

    # Call get_task_due_date_history MCP tool
    res = get_task_due_date_history(task_id=task.id, actor_id=admin.id)
    assert "due_date_history" in res
    assert res["task_id"] == task.id
    assert len(res["due_date_history"]) == 1
    assert res["due_date_history"][0]["new_due_date"] == datetime.datetime(2026, 8, 5).isoformat()
    assert res["due_date_history"][0]["change_source"] == models.TaskChangeSource.MANUAL.value

    # Check permission error on invalid user
    res_err = get_task_due_date_history(task_id=task.id, actor_id=99999)
    assert "error" in res_err
    assert res_err["status_code"] == 403


def test_due_date_history_via_rest_api_timezone_string(client, db):
    project = models.Project(name="TZ Rest Project", display_status="online")
    db.add(project)
    db.commit()
    db.refresh(project)

    task = models.Task(
        name="TZ Rest Task",
        project_id=project.id,
        due_date=datetime.datetime(2026, 8, 1, 0, 0),
        status="wip",
        display_status="online"
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    admin = models.User(email="admin_tz@example.com", username="admintz", hashed_password="pw", is_active=True, role="admin")
    db.add(admin)
    db.commit()
    db.refresh(admin)

    from app.security import create_access_token
    token = create_access_token(data={"sub": admin.email})
    headers = {"Authorization": f"Bearer {token}"}

    # Put new due date as ISO string with timezone offset (+09:00)
    payload = {"due_date": "2026-08-15T00:00:00+09:00"}
    resp = client.put(f"/api/tasks/{task.id}", json=payload, headers=headers)
    assert resp.status_code == 200

    # Retrieve history
    resp_hist = client.get(f"/api/tasks/{task.id}/due-date-history", headers=headers)
    assert resp_hist.status_code == 200
    data = resp_hist.json()
    assert len(data) == 1
    # Check that new_due_date is correct JST naive datetime string format or similar
    assert "2026-08-15" in data[0]["new_due_date"]

    # 2. Put the same due date with offset but changing the description
    payload_same_due = {
        "due_date": "2026-08-15T00:00:00+09:00",
        "description": "Updated description"
    }
    resp = client.put(f"/api/tasks/{task.id}", json=payload_same_due, headers=headers)
    assert resp.status_code == 200

    # Check that history size is still 1 (no extra history added)
    resp_hist2 = client.get(f"/api/tasks/{task.id}/due-date-history", headers=headers)
    assert resp_hist2.status_code == 200
    data2 = resp_hist2.json()
    assert len(data2) == 1


