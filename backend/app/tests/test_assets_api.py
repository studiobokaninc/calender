import io
import os
import pytest
from pathlib import Path
from jose import jwt
from app import models
from app.security import SECRET_KEY, ALGORITHM, get_password_hash

def make_token(email: str) -> str:
    return jwt.encode({"sub": email}, SECRET_KEY, algorithm=ALGORITHM)

@pytest.fixture
def user1(db):
    user = models.User(
        username="user1",
        email="user1@example.com",
        hashed_password=get_password_hash("password"),
        role="user",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@pytest.fixture
def user2(db):
    user = models.User(
        username="user2",
        email="user2@example.com",
        hashed_password=get_password_hash("password"),
        role="user",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@pytest.fixture
def admin_user(db):
    user = models.User(
        username="admin_user",
        email="admin_user@example.com",
        hashed_password=get_password_hash("password"),
        role="admin",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@pytest.fixture
def user1_headers(user1):
    token = make_token(user1.email)
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def user2_headers(user2):
    token = make_token(user2.email)
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def admin_headers(admin_user):
    token = make_token(admin_user.email)
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def test_project(db):
    proj = models.Project(name="Test Proj", status="planning")
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
def test_task(db, test_project, user1):
    task = models.Task(
        name="Layout",
        project_id=test_project.id,
        assigned_to=user1.id,
        status="todo"
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task

def test_upload_and_delete_by_owner(client, db, test_shot, test_task, user1_headers):
    # 1. Upload asset as user1
    file_content = b"fake image bytes"
    file_name = "test_upload_owner.png"
    files = {"file": (file_name, io.BytesIO(file_content), "image/png")}
    data = {
        "shot_id": test_shot.id,
        "task_id": test_task.id,
        "version": "v001"
    }

    resp = client.post("/api/assets", data=data, files=files, headers=user1_headers)
    assert resp.status_code == 201
    asset_data = resp.json()
    asset_id = asset_data["id"]
    file_path = Path(asset_data["file_path"])

    # Verify physical file exists
    assert file_path.exists()
    assert file_path.read_bytes() == file_content

    # Verify record in DB
    db_asset = db.query(models.Asset).filter(models.Asset.id == asset_id).first()
    assert db_asset is not None

    # 2. Delete asset as owner (user1)
    del_resp = client.delete(f"/api/assets/{asset_id}", headers=user1_headers)
    assert del_resp.status_code == 204

    # Verify physical file is removed
    assert not file_path.exists()

    # Verify DB record is removed
    db_asset_after = db.query(models.Asset).filter(models.Asset.id == asset_id).first()
    assert db_asset_after is None

def test_delete_by_admin(client, db, test_shot, test_task, user1_headers, admin_headers):
    # 1. Upload asset as user1
    file_content = b"fake image bytes admin test"
    file_name = "test_upload_admin.png"
    files = {"file": (file_name, io.BytesIO(file_content), "image/png")}
    data = {
        "shot_id": test_shot.id,
        "task_id": test_task.id,
        "version": "v001"
    }

    resp = client.post("/api/assets", data=data, files=files, headers=user1_headers)
    assert resp.status_code == 201
    asset_data = resp.json()
    asset_id = asset_data["id"]
    file_path = Path(asset_data["file_path"])

    assert file_path.exists()

    # 2. Delete asset as admin
    del_resp = client.delete(f"/api/assets/{asset_id}", headers=admin_headers)
    assert del_resp.status_code == 204

    # Verify deleted
    assert not file_path.exists()
    db_asset_after = db.query(models.Asset).filter(models.Asset.id == asset_id).first()
    assert db_asset_after is None

def test_delete_unauthorized_forbidden(client, db, test_shot, test_task, user1_headers, user2_headers):
    # 1. Upload asset as user1
    file_content = b"fake image bytes forbidden test"
    file_name = "test_upload_forbidden.png"
    files = {"file": (file_name, io.BytesIO(file_content), "image/png")}
    data = {
        "shot_id": test_shot.id,
        "task_id": test_task.id,
        "version": "v001"
    }

    resp = client.post("/api/assets", data=data, files=files, headers=user1_headers)
    assert resp.status_code == 201
    asset_data = resp.json()
    asset_id = asset_data["id"]
    file_path = Path(asset_data["file_path"])

    assert file_path.exists()

    # 2. Try to delete asset as user2 (not owner, not admin)
    del_resp = client.delete(f"/api/assets/{asset_id}", headers=user2_headers)
    assert del_resp.status_code == 403

    # Verify physical file and DB record STILL EXIST
    assert file_path.exists()
    db_asset = db.query(models.Asset).filter(models.Asset.id == asset_id).first()
    assert db_asset is not None

    # Clean up (delete as owner so file is not left behind)
    cleanup_resp = client.delete(f"/api/assets/{asset_id}", headers=user1_headers)
    assert cleanup_resp.status_code == 204
    assert not file_path.exists()

def test_delete_not_found(client, admin_headers):
    resp = client.delete("/api/assets/999999", headers=admin_headers)
    assert resp.status_code == 404

def test_delete_asset_cleans_up_look_distribution(client, db, test_shot, test_task, user1, user1_headers):
    # Create asset
    db_asset = models.Asset(
        shot_id=test_shot.id,
        task_id=test_task.id,
        version="v001",
        file_path="dummy_path.png",
        created_by=user1.id
    )
    db.add(db_asset)
    db.commit()
    db.refresh(db_asset)

    # Create look distribution referencing this asset
    dist = models.LookDistribution(
        shot_ids=[test_shot.id],
        look_dev_id=1,
        status="pending",
        assigned_to=user1.id,
        created_by=user1.id,
        result_asset_id=db_asset.id
    )
    db.add(dist)
    db.commit()
    db.refresh(dist)

    # Verify initial relation
    assert dist.result_asset_id == db_asset.id

    # Delete asset
    del_resp = client.delete(f"/api/assets/{db_asset.id}", headers=user1_headers)
    assert del_resp.status_code == 204

    # Verify look distribution result_asset_id is now NULL
    db.refresh(dist)
    assert dist.result_asset_id is None
