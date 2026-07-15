import pytest
import os
from datetime import datetime, timedelta
from app import models, schemas, crud
from app.timezone import now_jst_naive

@pytest.fixture(autouse=True)
def setup_readonly_env():
    # If there is no token in the environment, set a default one
    if not os.environ.get("SCORE_READONLY_TOKEN"):
        os.environ["SCORE_READONLY_TOKEN"] = "test_readonly_token_abc"
    yield

@pytest.fixture
def readonly_headers():
    token = os.environ.get("SCORE_READONLY_TOKEN") or "test_readonly_token_abc"
    return {"X-Readonly-Token": token}

@pytest.fixture
def test_data(db):
    from app.security import get_password_hash
    # Create test users
    u1 = models.User(username="user1", email="u1@example.com", hashed_password=get_password_hash("pass"), full_name="User One")
    u2 = models.User(username="user2", email="u2@example.com", hashed_password=get_password_hash("pass"), full_name="User Two")
    db.add_all([u1, u2])
    db.commit()
    db.refresh(u1)
    db.refresh(u2)

    # Create projects
    p_online = models.Project(name="Online Project", status=models.ProjectStatus.IN_PROGRESS, display_status="online")
    p_offline = models.Project(name="Offline Project", status=models.ProjectStatus.IN_PROGRESS, display_status="offline")
    db.add_all([p_online, p_offline])
    db.commit()
    db.refresh(p_online)
    db.refresh(p_offline)

    # Define base dates
    base_due = datetime(2026, 7, 10, 18, 0, 0)
    on_time_date = datetime(2026, 7, 9, 10, 0, 0)
    late_date = datetime(2026, 7, 11, 10, 0, 0)

    # Create tasks in online project
    # u1: 2 completed (1 on time, 1 late), 1 omit
    t1 = models.Task(
        name="Task 1", project_id=p_online.id, assigned_to=u1.id, due_date=base_due,
        status="DELIVER", completed_at=on_time_date, type="comp"
    )
    t2 = models.Task(
        name="Task 2", project_id=p_online.id, assigned_to=u1.id, due_date=base_due,
        status="DELIVER", completed_at=late_date, type="comp"
    )
    t3 = models.Task(
        name="Task 3", project_id=p_online.id, assigned_to=u1.id, due_date=base_due,
        status="OMIT", type="comp"
    )

    # u2: 1 completed (on time), 1 in progress (wip)
    t4 = models.Task(
        name="Task 4", project_id=p_online.id, assigned_to=u2.id, due_date=base_due,
        status="DELIVER", completed_at=on_time_date, type="animation"
    )
    t5 = models.Task(
        name="Task 5", project_id=p_online.id, assigned_to=u2.id, due_date=base_due,
        status="WIP", type="animation"
    )

    # Offline project task (should not count)
    t6 = models.Task(
        name="Task 6", project_id=p_offline.id, assigned_to=u1.id, due_date=base_due,
        status="DELIVER", completed_at=on_time_date, type="comp"
    )

    db.add_all([t1, t2, t3, t4, t5, t6])
    db.commit()

    return {
        "user1": u1,
        "user2": u2,
        "project_online": p_online,
        "project_offline": p_offline,
    }


def test_onschedule_auth(client):
    # Missing token
    resp = client.get("/api/readonly/onschedule")
    assert resp.status_code == 401

    # Invalid token
    resp = client.get("/api/readonly/onschedule", headers={"X-Readonly-Token": "wrong"})
    assert resp.status_code == 401


def test_onschedule_global_stats(client, test_data, readonly_headers):
    # Global statistics (no group_by)
    resp = client.get("/api/readonly/onschedule", headers=readonly_headers)
    print("DEBUG GLOBAL STATS RESP:", resp.status_code, resp.text)
    assert resp.status_code == 200
    data = resp.json()
    
    # Expected deliverables in online project:
    # t1 (u1, comp, DELIVER, on_time) -> count: completed=1, on_time=1
    # t2 (u1, comp, DELIVER, late) -> count: completed=2, on_time=1
    # t4 (u2, animation, DELIVER, on_time) -> count: completed=3, on_time=2
    # Total completed = 3, on_time = 2.
    assert len(data) == 1
    stats = data[0]
    assert stats["completed"] == 3
    assert stats["on_time"] == 2
    assert stats["rate"] == round(2 / 3, 3)
    assert stats["n"] == 3
    assert len(stats["ci"]) == 2
    assert stats["ci"][0] <= stats["rate"] <= stats["ci"][1]


def test_onschedule_group_by_assignee(client, test_data, readonly_headers):
    # Group by assignee
    resp = client.get("/api/readonly/onschedule?group_by=assignee", headers=readonly_headers)
    assert resp.status_code == 200
    data = resp.json()

    # Sort key is assignee name: "User One" then "User Two"
    assert len(data) == 2
    
    # User One (u1)
    # t1 (on_time), t2 (late) -> completed = 2, on_time = 1
    assert data[0]["assignee_name"] == "User One"
    assert data[0]["completed"] == 2
    assert data[0]["on_time"] == 1
    assert data[0]["rate"] == 0.5

    # User Two (u2)
    # t4 (on_time) -> completed = 1, on_time = 1
    assert data[1]["assignee_name"] == "User Two"
    assert data[1]["completed"] == 1
    assert data[1]["on_time"] == 1
    assert data[1]["rate"] == 1.0


def test_onschedule_group_by_type(client, test_data, readonly_headers):
    # Group by type
    resp = client.get("/api/readonly/onschedule?group_by=type", headers=readonly_headers)
    assert resp.status_code == 200
    data = resp.json()

    # Types: "animation" then "comp" (sorted alphabetically)
    assert len(data) == 2

    # type = animation (t4) -> completed = 1, on_time = 1
    assert data[0]["type"] == "animation"
    assert data[0]["completed"] == 1
    assert data[0]["on_time"] == 1
    assert data[0]["rate"] == 1.0

    # type = comp (t1, t2) -> completed = 2, on_time = 1
    assert data[1]["type"] == "comp"
    assert data[1]["completed"] == 2
    assert data[1]["on_time"] == 1
    assert data[1]["rate"] == 0.5


def test_onschedule_group_by_both(client, test_data, readonly_headers):
    # Group by assignee,type
    resp = client.get("/api/readonly/onschedule?group_by=assignee,type", headers=readonly_headers)
    assert resp.status_code == 200
    data = resp.json()

    # Expected groups:
    # 1. User One - comp (t1, t2) -> completed = 2, on_time = 1
    # 2. User Two - animation (t4) -> completed = 1, on_time = 1
    assert len(data) == 2
    assert data[0]["assignee_name"] == "User One"
    assert data[0]["type"] == "comp"
    assert data[0]["completed"] == 2

    assert data[1]["assignee_name"] == "User Two"
    assert data[1]["type"] == "animation"
    assert data[1]["completed"] == 1


def test_completed_at_triggers(db, test_data):
    # 1. Test create_task status=deliver sets completed_at
    task_schema = schemas.TaskCreate(
        name="New Test Task A",
        project_id=test_data["project_online"].id,
        status="deliver",
    )
    t = crud.create_task(db, task_schema)
    assert t.completed_at is not None
    assert (now_jst_naive() - t.completed_at) < timedelta(seconds=5)

    # 2. Test create_task status=mk does NOT set completed_at
    task_schema2 = schemas.TaskCreate(
        name="New Test Task B",
        project_id=test_data["project_online"].id,
        status="mk",
    )
    t2 = crud.create_task(db, task_schema2)
    assert t2.completed_at is None

    # 3. Test update_task transitioning to deliver sets completed_at
    update_schema = schemas.TaskUpdate(status="deliver")
    t2_updated = crud.update_task(db, t2, update_schema)
    assert t2_updated.completed_at is not None
    
    # Preserve original completion if transitioning deliver -> deliver
    original_completed_at = t2_updated.completed_at
    t2_updated2 = crud.update_task(db, t2_updated, update_schema)
    assert t2_updated2.completed_at == original_completed_at

    # 4. Test update_task transitioning away from deliver resets completed_at to None
    update_schema_wip = schemas.TaskUpdate(status="wip")
    t2_wip = crud.update_task(db, t2_updated2, update_schema_wip)
    assert t2_wip.completed_at is None


def test_complete_tasks_for_project_trigger(db, test_data):
    # Create two WIP tasks for project_online
    t1 = models.Task(name="Bulk task 1", project_id=test_data["project_online"].id, status="WIP")
    t2 = models.Task(name="Bulk task 2", project_id=test_data["project_online"].id, status="WIP")
    db.add_all([t1, t2])
    db.commit()

    # Call complete_tasks_for_project
    crud.projects.complete_tasks_for_project(db, test_data["project_online"].id)
    
    db.refresh(t1)
    db.refresh(t2)
    assert t1.status == models.TaskStatus.DELIVER
    assert t1.completed_at is not None
    assert t2.status == models.TaskStatus.DELIVER
    assert t2.completed_at is not None
