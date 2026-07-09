import pytest
from app import models
from jose import jwt
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
    proj = models.Project(name="Test Project", status=models.ProjectStatus.PLANNING)
    db.add(proj)
    db.commit()
    db.refresh(proj)
    return proj

def test_list_score_user_roles(client, db, admin_user, auth_headers, test_project):
    # Add a mock role
    role = models.ScoreUserRole(user_id=admin_user.id, project_id=test_project.id, role="director")
    db.add(role)
    db.commit()

    resp = client.get("/api/score_user_roles", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["user_id"] == admin_user.id
    assert data[0]["project_id"] == test_project.id
    assert data[0]["role"] == "director"


def test_list_score_user_roles_project_id_filter(client, db, admin_user, auth_headers, test_project):
    from app.security import get_password_hash
    other_proj = models.Project(name="Other Project", status=models.ProjectStatus.PLANNING)
    db.add(other_proj)
    db.commit()
    db.refresh(other_proj)

    db.add(models.ScoreUserRole(user_id=admin_user.id, project_id=test_project.id, role="director"))
    db.add(models.ScoreUserRole(user_id=admin_user.id, project_id=other_proj.id, role="pm"))
    db.commit()

    resp = client.get(f"/api/score_user_roles?project_id={test_project.id}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["project_id"] == test_project.id
    assert data[0]["role"] == "director"

    resp_all = client.get("/api/score_user_roles", headers=auth_headers)
    assert len(resp_all.json()) == 2

def test_create_score_user_role(client, db, admin_user, auth_headers, test_project):
    payload = {
        "user_id": admin_user.id,
        "project_id": test_project.id,
        "role": "pm"
    }
    resp = client.post("/api/score_user_roles", json=payload, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["user_id"] == admin_user.id
    assert data["project_id"] == test_project.id
    assert data["role"] == "pm"
    assert "id" in data

    # Try creating the same again -> Should return 409 Conflict
    resp_conflict = client.post("/api/score_user_roles", json=payload, headers=auth_headers)
    assert resp_conflict.status_code == 409

def test_update_score_user_role(client, db, admin_user, auth_headers, test_project):
    role = models.ScoreUserRole(user_id=admin_user.id, project_id=test_project.id, role="director")
    db.add(role)
    db.commit()
    db.refresh(role)

    payload = {"role": "lead"}
    resp = client.patch(f"/api/score_user_roles/{role.id}", json=payload, headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == role.id
    assert data["role"] == "lead"

    # Test updating non-existent role
    resp_404 = client.patch("/api/score_user_roles/9999", json=payload, headers=auth_headers)
    assert resp_404.status_code == 404

def test_delete_score_user_role(client, db, admin_user, auth_headers, test_project):
    role = models.ScoreUserRole(user_id=admin_user.id, project_id=test_project.id, role="director")
    db.add(role)
    db.commit()
    db.refresh(role)

    resp = client.delete(f"/api/score_user_roles/{role.id}", headers=auth_headers)
    assert resp.status_code == 204

    # Verify deletion
    db.expire_all()
    deleted_role = db.query(models.ScoreUserRole).filter_by(id=role.id).first()
    assert deleted_role is None

    # Test deleting non-existent role
    resp_404 = client.delete("/api/score_user_roles/9999", headers=auth_headers)
    assert resp_404.status_code == 404


def test_get_project_roles(client, db, admin_user, auth_headers, test_project):
    from app.security import get_password_hash
    pm_user = models.User(
        username="pm_test",
        email="pm_test@example.com",
        hashed_password=get_password_hash("password"),
        role="user",
    )
    db.add(pm_user)
    db.commit()
    db.refresh(pm_user)

    db.add(models.ScoreUserRole(user_id=admin_user.id, project_id=test_project.id, role="director"))
    db.add(models.ScoreUserRole(user_id=pm_user.id, project_id=test_project.id, role="pm"))
    db.commit()

    resp = client.get(f"/api/projects/{test_project.id}/roles", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["project_id"] == test_project.id
    assert data["roles"]["director"] == admin_user.id
    assert data["roles"]["pm"] == pm_user.id


def test_get_project_roles_not_found(client, db, admin_user, auth_headers):
    resp = client.get("/api/projects/9999/roles", headers=auth_headers)
    assert resp.status_code == 404


def test_get_project_roles_empty(client, db, admin_user, auth_headers, test_project):
    resp = client.get(f"/api/projects/{test_project.id}/roles", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["project_id"] == test_project.id
    assert data["roles"] == {}


def test_offline_project_filtering_for_general_user(client, db):
    from app.security import get_password_hash
    # Create general user
    gen_user = models.User(
        username="gen_user",
        email="gen_user@example.com",
        hashed_password=get_password_hash("password"),
        role="user",
    )
    db.add(gen_user)
    
    # Create projects
    online_proj = models.Project(name="Online Project", status=models.ProjectStatus.PLANNING, display_status="online")
    offline_proj = models.Project(name="Offline Project", status=models.ProjectStatus.PLANNING, display_status="offline")
    db.add(online_proj)
    db.add(offline_proj)
    db.commit()
    db.refresh(gen_user)
    db.refresh(online_proj)
    db.refresh(offline_proj)

    # Assign tasks to gen_user
    online_task = models.Task(name="Online Task", project_id=online_proj.id, assigned_to=gen_user.id, status="WIP")
    offline_task = models.Task(name="Offline Task", project_id=offline_proj.id, assigned_to=gen_user.id, status="WIP")
    db.add(online_task)
    db.add(offline_task)
    db.commit()

    token = make_token(gen_user.email)
    headers = {"Authorization": f"Bearer {token}"}

    # 1. /api/me/projects: Should only return online project
    resp = client.get("/api/me/projects", headers=headers)
    assert resp.status_code == 200
    projs = resp.json()
    assert len(projs) == 1
    assert projs[0]["id"] == online_proj.id

    # 2. /api/me/tasks: Should only return online task
    resp = client.get("/api/me/tasks", headers=headers)
    assert resp.status_code == 200
    tasks = resp.json()
    assert len(tasks) == 1
    assert tasks[0]["id"] == online_task.id

    # 3. /api/me/projects/{id} on offline project: Should return 403 Forbidden
    resp = client.get(f"/api/me/projects/{offline_proj.id}", headers=headers)
    assert resp.status_code == 403

    # 4. Now assign gen_user as director of the offline project
    #    仕様変更 (2026-07-08): オフラインプロジェクトは PM/Director 割当があっても
    #    /api/me/* で表示しない (Score ダッシュボードから他人のタスク混入を防止するため)。
    role = models.ScoreUserRole(user_id=gen_user.id, project_id=offline_proj.id, role="director")
    db.add(role)
    db.commit()

    # /api/me/projects: オフラインは Director 割当があっても含めない
    resp = client.get("/api/me/projects", headers=headers)
    assert resp.status_code == 200
    projs = resp.json()
    assert len(projs) == 1
    assert projs[0]["id"] == online_proj.id

    # /api/me/tasks: オフラインタスクは Director 割当があっても含めない
    resp = client.get("/api/me/tasks", headers=headers)
    assert resp.status_code == 200
    tasks = resp.json()
    assert len(tasks) == 1
    assert tasks[0]["id"] == online_task.id

    # /api/me/projects/{id} on offline project: Director 割当があっても 403
    resp = client.get(f"/api/me/projects/{offline_proj.id}", headers=headers)
    assert resp.status_code == 403
