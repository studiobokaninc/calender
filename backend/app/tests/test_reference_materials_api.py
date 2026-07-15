import pytest
from datetime import datetime
from jose import jwt
from app import models
from app.security import SECRET_KEY, ALGORITHM

def make_token(email: str) -> str:
    return jwt.encode({"sub": email}, SECRET_KEY, algorithm=ALGORITHM)

@pytest.fixture
def admin_user(db):
    from app.security import get_password_hash
    user = models.User(
        username="admin_test",
        email="admin_test@example.com",
        hashed_password=get_password_hash("password"),
        role="admin",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@pytest.fixture
def auth_headers(admin_user):
    token = make_token(admin_user.email)
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def test_project(db):
    proj = models.Project(
        name="Test Proj",
        status="planning"
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)
    return proj

@pytest.fixture
def test_shot(db, test_project):
    shot = models.Shot(
        project_id=test_project.id,
        seq_code="SEQ01",
        shot_code="SHOT01",
        status="planning"
    )
    db.add(shot)
    db.commit()
    db.refresh(shot)
    return shot

@pytest.fixture
def test_task(db, test_project, admin_user):
    task = models.Task(
        name="Layout",
        project_id=test_project.id,
        assigned_to=admin_user.id,
        status="mk"
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task

def test_create_reference_material(client, db, admin_user, auth_headers, test_shot, test_task):
    payload = {
        "shot_id": test_shot.id,
        "task_id": test_task.id,
        "title": "Reference Image 1",
        "media_type": "image",
        "file_path": "/static/ref/shot_1.png"
    }
    resp = client.post("/api/reference_materials", json=payload, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Reference Image 1"
    assert data["media_type"] == "image"
    assert data["file_path"] == "/static/ref/shot_1.png"
    assert data["shot_id"] == test_shot.id
    assert data["task_id"] == test_task.id
    assert data["created_by"] == admin_user.id

def test_get_my_reference_materials_filtering(client, db, admin_user, auth_headers, test_shot, test_task):
    # Create shot 2
    shot2 = models.Shot(
        project_id=test_shot.project_id,
        seq_code="SEQ01",
        shot_code="SHOT02",
        status="planning"
    )
    db.add(shot2)
    db.commit()
    db.refresh(shot2)

    # Reference 1: shot1, task1
    ref1 = models.ReferenceMaterial(
        shot_id=test_shot.id,
        task_id=test_task.id,
        title="Ref 1",
        media_type="image",
        file_path="/ref1.png",
        created_by=admin_user.id
    )
    # Reference 2: shot2, no task
    ref2 = models.ReferenceMaterial(
        shot_id=shot2.id,
        task_id=None,
        title="Ref 2",
        media_type="url",
        file_path="http://ref2.com",
        created_by=admin_user.id
    )
    db.add_all([ref1, ref2])
    db.commit()

    # Get all
    resp = client.get("/api/me/reference_materials", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 2
    titles = [x["title"] for x in data]
    assert "Ref 1" in titles
    assert "Ref 2" in titles

    # Filter by shot_id
    resp_shot = client.get(f"/api/me/reference_materials?shot_id={test_shot.id}", headers=auth_headers)
    assert resp_shot.status_code == 200
    data_shot = resp_shot.json()
    assert len(data_shot) == 1
    assert data_shot[0]["title"] == "Ref 1"

    # Filter by task_id
    resp_task = client.get(f"/api/me/reference_materials?task_id={test_task.id}", headers=auth_headers)
    assert resp_task.status_code == 200
    data_task = resp_task.json()
    assert len(data_task) == 1
    assert data_task[0]["title"] == "Ref 1"
