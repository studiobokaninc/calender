import pytest
import os
from app import models
from app.mcp_server import get_task_thread, get_shot_tasks, get_project_tasks

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

def test_readonly_task_thread_exposure(client, db, readonly_headers):
    # Create a project and a task with a thread_id
    project = models.Project(name="Test Project", display_status="online")
    db.add(project)
    db.commit()
    db.refresh(project)

    task = models.Task(
        name="Test Task with Thread",
        project_id=project.id,
        status="wip",
        thread_id=9876543
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    # 1. Verify Option A: GET /api/readonly/tasks/{task_id} contains thread_id
    resp = client.get(f"/api/readonly/tasks/{task.id}", headers=readonly_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == task.id
    assert data["thread_id"] == 9876543

    # 2. Verify Option B: GET /api/readonly/tasks/{task_id}/thread
    resp_thread = client.get(f"/api/readonly/tasks/{task.id}/thread", headers=readonly_headers)
    assert resp_thread.status_code == 200
    data_thread = resp_thread.json()
    assert data_thread["task_id"] == task.id
    assert data_thread["thread_id"] == 9876543

    # 3. Verify Option B (no thread_id): Task exists but thread_id is None
    task_no_thread = models.Task(
        name="Test Task without Thread",
        project_id=project.id,
        status="wip",
        thread_id=None
    )
    db.add(task_no_thread)
    db.commit()
    db.refresh(task_no_thread)

    resp_no_thread = client.get(f"/api/readonly/tasks/{task_no_thread.id}/thread", headers=readonly_headers)
    assert resp_no_thread.status_code == 200
    data_no_thread = resp_no_thread.json()
    assert data_no_thread["task_id"] == task_no_thread.id
    assert data_no_thread["thread_id"] is None

    # 4. Verify 404 for non-existent task
    resp_404 = client.get("/api/readonly/tasks/9999999/thread", headers=readonly_headers)
    assert resp_404.status_code == 404
    assert resp_404.json()["detail"] == "Task not found"


def test_mcp_tool_get_task_thread(db, monkeypatch):
    # Monkeypatch SessionLocal in mcp_server to return our test db session
    monkeypatch.setattr("app.mcp_server.SessionLocal", lambda: db)
    # Prevent the tool from closing our test session
    monkeypatch.setattr(db, "close", lambda: None)

    # Create a project and a task with a thread_id
    project = models.Project(name="Test Project MCP", display_status="online")
    db.add(project)
    db.commit()
    db.refresh(project)

    task = models.Task(
        name="Test Task MCP",
        project_id=project.id,
        status="wip",
        thread_id=12345
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    task_id_val = task.id

    # Test the MCP tool directly (via direct function call)
    res = get_task_thread(task_id=task_id_val)
    assert res["task_id"] == task_id_val
    assert res["thread_id"] == 12345

    res_404 = get_task_thread(task_id=999999)
    assert res_404["error"] == "Task not found"
    assert res_404["status_code"] == 404


def test_mcp_get_tasks_by_shot_and_project(db, monkeypatch):
    # Monkeypatch SessionLocal in mcp_server to return our test db session
    monkeypatch.setattr("app.mcp_server.SessionLocal", lambda: db)
    # Prevent the tool from closing our test session
    monkeypatch.setattr(db, "close", lambda: None)

    # Create project, shot, and task
    project = models.Project(name="Shot Project", display_status="online")
    db.add(project)
    db.commit()
    db.refresh(project)

    shot = models.Shot(
        project_id=project.id,
        seq_code="seq01",
        shot_code="shot02",
        status="planning"
    )
    db.add(shot)
    db.commit()
    db.refresh(shot)

    task = models.Task(
        name="Task in Shot",
        project_id=project.id,
        shot_id=shot.id,
        status="wip",
        thread_id=556677
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    shot_id_val = shot.id
    project_id_val = project.id
    task_id_val = task.id

    # 1. Test get_shot_tasks
    res_shot = get_shot_tasks(shot_id=shot_id_val)
    assert res_shot["total"] == 1
    item = res_shot["items"][0]
    assert item["id"] == task_id_val
    assert item["name"] == "Task in Shot"
    assert item["shot_code"] == "shot02"
    assert item["thread_id"] == 556677

    # 2. Test get_project_tasks
    res_project = get_project_tasks(project_id=project_id_val)
    assert res_project["total"] == 1
    item_p = res_project["items"][0]
    assert item_p["id"] == task_id_val
    assert item_p["name"] == "Task in Shot"
    assert item_p["shot_code"] == "shot02"
    assert item_p["thread_id"] == 556677


