import pytest
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient
from app import models, schemas, crud
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

def test_task_creation_triggers_dm_thread_auto_creation(client: TestClient, db: Session, auth_headers):
    # Setup project
    proj = models.Project(name="Test Proj", status=models.ProjectStatus.PLANNING)
    db.add(proj)
    db.commit()

    # Setup supervisors (Director, Lead, PM)
    director = models.User(username="director", email="director@example.com", role="user", hashed_password="pw")
    lead = models.User(username="lead", email="lead@example.com", role="user", hashed_password="pw")
    pm = models.User(username="pm", email="pm@example.com", role="user", hashed_password="pw")
    db.add_all([director, lead, pm])
    db.commit()

    # Assign roles
    for u, role in [(director, "director"), (lead, "lead"), (pm, "pm")]:
        db.execute(
            models.Base.metadata.tables['score_user_roles'].insert().values(
                user_id=u.id,
                project_id=proj.id,
                role=role
            )
        )
    db.commit()

    # Setup assignee user
    assignee = models.User(username="assignee", email="assignee@example.com", role="user", hashed_password="pw")
    db.add(assignee)
    db.commit()

    # Create task with assignee
    task_in = schemas.TaskCreate(
        name="Task with Sync",
        project_id=proj.id,
        assigned_to=assignee.id
    )
    task = crud.create_task(db, task_in)
    
    assert task.thread_id is not None
    assert task.thread_id >= 10000000
    
    # データベースにメッセージが1件のみ挿入されていること（複製なし）を確認
    dms = db.query(models.DirectMessage).filter(models.DirectMessage.thread_id == task.thread_id).all()
    assert len(dms) == 1
    
    dm = dms[0]
    assert dm.body == "Task message thread initialized."
    assert dm.sender_id in [director.id, lead.id, pm.id]
    
    # スレッド一覧取得 API で全参加者が取得できるか確認
    token = make_token(assignee.email)
    headers = {"Authorization": f"Bearer {token}"}
    
    resp = client.get("/api/me/dm/threads", headers=headers)
    assert resp.status_code == 200
    threads_data = resp.json()
    assert len(threads_data) == 1
    
    thread = threads_data[0]
    assert thread["thread_id"] == task.thread_id
    assert len(thread["participants"]) == 4
    
    p_ids = [p["user_id"] for p in thread["participants"]]
    assert set(p_ids) == {assignee.id, director.id, lead.id, pm.id}

def test_manual_dm_thread_creation(client: TestClient, db: Session, auth_headers):
    u1 = models.User(username="u1", email="u1@example.com", role="user", hashed_password="pw")
    u2 = models.User(username="u2", email="u2@example.com", role="user", hashed_password="pw")
    u3 = models.User(username="u3", email="u3@example.com", role="user", hashed_password="pw")
    db.add_all([u1, u2, u3])
    db.commit()

    payload = {
        "participant_ids": [u1.id, u2.id, u3.id]
    }
    
    resp = client.post("/api/dm/threads", json=payload, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert "thread_id" in data
    assert data["thread_id"] >= 10000000
    assert len(data["participants"]) == 3
    
    thread_id = data["thread_id"]
    
    dms = db.query(models.DirectMessage).filter(models.DirectMessage.thread_id == thread_id).all()
    assert len(dms) == 1
    assert dms[0].body == "Thread started."

    # メッセージ送信時にレコードが1件のみ（複製なし）であることを確認
    token = make_token(u1.email)
    headers = {"Authorization": f"Bearer {token}"}
    
    msg_payload = {
        "thread_id": thread_id,
        "body": "Hello Group!"
    }
    
    resp_msg = client.post("/api/dm", json=msg_payload, headers=headers)
    assert resp_msg.status_code == 201
    
    dms_after = db.query(models.DirectMessage).filter(models.DirectMessage.thread_id == thread_id).all()
    assert len(dms_after) == 2
