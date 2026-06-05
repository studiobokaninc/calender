import pytest
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient
from app import models, schemas, crud
from jose import jwt
from app.security import SECRET_KEY, ALGORITHM

def make_token(email: str) -> str:
    return jwt.encode({"sub": email}, SECRET_KEY, algorithm=ALGORITHM)

def assert_no_dm_thread_groups(db: Session):
    count = db.query(models.Group).filter(models.Group.name.like("DM_Thread_%")).count()
    assert count == 0, f"groupsテーブルにDM_Thread_が{count}件残存"

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

    assert task.thread_id is not None  # 1
    assert task.thread_id >= 10000000  # 2

    # データベースにメッセージが1件のみ挿入されていること（複製なし）を確認
    dms = db.query(models.DirectMessage).filter(models.DirectMessage.thread_id == task.thread_id).all()
    assert len(dms) == 1  # 3

    dm = dms[0]
    assert dm.body == "Task message thread initialized."  # 4
    assert dm.sender_id in [director.id, lead.id, pm.id]  # 5

    # dm_thread_participantsに4人登録されていること
    dtp_count = db.query(models.DmThreadParticipant).filter(
        models.DmThreadParticipant.thread_id == task.thread_id
    ).count()
    assert dtp_count == 4  # 6

    # groupsテーブルにDM_Thread_が存在しないこと
    assert_no_dm_thread_groups(db)  # 7

    # スレッド一覧取得 API で全参加者が取得できるか確認
    token = make_token(assignee.email)
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.get("/api/me/dm/threads", headers=headers)
    assert resp.status_code == 200  # 8
    threads_data = resp.json()
    assert len(threads_data) == 1  # 9

    thread = threads_data[0]
    assert thread["thread_id"] == task.thread_id  # 10
    assert len(thread["participants"]) == 4  # 11

    p_ids = [p["user_id"] for p in thread["participants"]]
    assert set(p_ids) == {assignee.id, director.id, lead.id, pm.id}  # 12

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
    assert resp.status_code == 201  # 13
    data = resp.json()
    assert "thread_id" in data  # 14
    assert data["thread_id"] >= 10000000  # 15
    assert len(data["participants"]) == 3  # 16

    thread_id = data["thread_id"]

    dms = db.query(models.DirectMessage).filter(models.DirectMessage.thread_id == thread_id).all()
    assert len(dms) == 1  # 17
    assert dms[0].body == "Thread started."  # 18

    # dm_thread_participantsに3人登録されていること
    dtp_count = db.query(models.DmThreadParticipant).filter(
        models.DmThreadParticipant.thread_id == thread_id
    ).count()
    assert dtp_count == 3  # 19

    # groupsテーブルにDM_Thread_が存在しないこと
    assert_no_dm_thread_groups(db)  # 20

    # メッセージ送信時にレコードが1件のみ（複製なし）であることを確認
    token = make_token(u1.email)
    headers = {"Authorization": f"Bearer {token}"}

    msg_payload = {
        "thread_id": thread_id,
        "body": "Hello Group!"
    }

    resp_msg = client.post("/api/dm", json=msg_payload, headers=headers)
    assert resp_msg.status_code == 201  # 21

    dms_after = db.query(models.DirectMessage).filter(models.DirectMessage.thread_id == thread_id).all()
    assert len(dms_after) == 2  # 22

def test_dm_thread_reuse_same_participants(client: TestClient, db: Session, auth_headers):
    u1 = models.User(username="r1", email="r1@example.com", role="user", hashed_password="pw")
    u2 = models.User(username="r2", email="r2@example.com", role="user", hashed_password="pw")
    u3 = models.User(username="r3", email="r3@example.com", role="user", hashed_password="pw")
    db.add_all([u1, u2, u3])
    db.commit()

    payload = {"participant_ids": [u1.id, u2.id, u3.id]}

    resp1 = client.post("/api/dm/threads", json=payload, headers=auth_headers)
    assert resp1.status_code == 201
    first_tid = resp1.json()["thread_id"]
    assert first_tid >= 10000000  # 23

    dtp_count_after_first = db.query(models.DmThreadParticipant).filter(
        models.DmThreadParticipant.thread_id == first_tid
    ).count()

    # 同じ参加者で2回目の呼び出し → 同一thread_idが返る
    resp2 = client.post("/api/dm/threads", json=payload, headers=auth_headers)
    assert resp2.status_code == 201
    second_tid = resp2.json()["thread_id"]
    assert second_tid == first_tid  # 24

    # dm_thread_participants件数が増えていないこと
    dtp_count_after_second = db.query(models.DmThreadParticipant).filter(
        models.DmThreadParticipant.thread_id == first_tid
    ).count()
    assert dtp_count_after_second == dtp_count_after_first  # 25

def test_get_dm_threads_returns_correct_participants(client: TestClient, db: Session, auth_headers):
    u1 = models.User(username="gp1", email="gp1@example.com", role="user", hashed_password="pw")
    u2 = models.User(username="gp2", email="gp2@example.com", role="user", hashed_password="pw")
    u3 = models.User(username="gp3", email="gp3@example.com", role="user", hashed_password="pw")
    db.add_all([u1, u2, u3])
    db.commit()

    # u1としてスレッド作成
    token = make_token(u1.email)
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"participant_ids": [u1.id, u2.id, u3.id]}
    resp_create = client.post("/api/dm/threads", json=payload, headers=headers)
    assert resp_create.status_code == 201
    thread_id = resp_create.json()["thread_id"]

    # groupsテーブルにDM_Thread_が存在しないこと
    assert_no_dm_thread_groups(db)  # 26

    # u1のスレッド一覧を取得
    resp = client.get("/api/me/dm/threads", headers=headers)
    assert resp.status_code == 200  # 27
    threads = resp.json()
    assert len(threads) == 1  # 28

    thread = threads[0]
    assert thread["thread_id"] == thread_id  # 29

    p_ids = {p["user_id"] for p in thread["participants"]}
    assert p_ids == {u1.id, u2.id, u3.id}  # 30

def test_dm_send_to_group_thread(client: TestClient, db: Session, auth_headers):
    u1 = models.User(username="sg1", email="sg1@example.com", role="user", hashed_password="pw")
    u2 = models.User(username="sg2", email="sg2@example.com", role="user", hashed_password="pw")
    u3 = models.User(username="sg3", email="sg3@example.com", role="user", hashed_password="pw")
    outsider = models.User(username="sgout", email="sgout@example.com", role="user", hashed_password="pw")
    db.add_all([u1, u2, u3, outsider])
    db.commit()

    token_u1 = make_token(u1.email)
    headers_u1 = {"Authorization": f"Bearer {token_u1}"}

    # スレッド作成
    payload = {"participant_ids": [u1.id, u2.id, u3.id]}
    resp_create = client.post("/api/dm/threads", json=payload, headers=headers_u1)
    assert resp_create.status_code == 201
    thread_id = resp_create.json()["thread_id"]

    # groupsテーブルにDM_Thread_が存在しないこと
    assert_no_dm_thread_groups(db)  # 31

    # 参加者(u1)はDM送信可能
    resp_ok = client.post("/api/dm", json={"thread_id": thread_id, "body": "Hi!"}, headers=headers_u1)
    assert resp_ok.status_code == 201  # 32

    # 存在しないthread_idへの送信は404
    resp_not_found = client.post("/api/dm", json={"thread_id": 99999999, "body": "Hi!"}, headers=headers_u1)
    assert resp_not_found.status_code == 404  # 33

    # 非参加者は403
    token_out = make_token(outsider.email)
    headers_out = {"Authorization": f"Bearer {token_out}"}
    resp_forbidden = client.post("/api/dm", json={"thread_id": thread_id, "body": "Hi!"}, headers=headers_out)
    assert resp_forbidden.status_code == 403  # 34

def test_get_thread_messages_membership(client: TestClient, db: Session, auth_headers):
    u1 = models.User(username="tm1", email="tm1@example.com", role="user", hashed_password="pw")
    u2 = models.User(username="tm2", email="tm2@example.com", role="user", hashed_password="pw")
    u3 = models.User(username="tm3", email="tm3@example.com", role="user", hashed_password="pw")
    outsider = models.User(username="tmout", email="tmout@example.com", role="user", hashed_password="pw")
    db.add_all([u1, u2, u3, outsider])
    db.commit()

    token_u1 = make_token(u1.email)
    headers_u1 = {"Authorization": f"Bearer {token_u1}"}

    payload = {"participant_ids": [u1.id, u2.id, u3.id]}
    resp_create = client.post("/api/dm/threads", json=payload, headers=headers_u1)
    thread_id = resp_create.json()["thread_id"]

    # groupsテーブルにDM_Thread_が存在しないこと
    assert_no_dm_thread_groups(db)  # 35

    # 参加者は200
    resp_member = client.get(f"/api/dm/threads/{thread_id}/messages", headers=headers_u1)
    assert resp_member.status_code == 200  # 36

    # 非参加者は403
    token_out = make_token(outsider.email)
    headers_out = {"Authorization": f"Bearer {token_out}"}
    resp_nonmember = client.get(f"/api/dm/threads/{thread_id}/messages", headers=headers_out)
    assert resp_nonmember.status_code == 403  # 37

def test_mark_thread_read_membership(client: TestClient, db: Session, auth_headers):
    u1 = models.User(username="mr1", email="mr1@example.com", role="user", hashed_password="pw")
    u2 = models.User(username="mr2", email="mr2@example.com", role="user", hashed_password="pw")
    u3 = models.User(username="mr3", email="mr3@example.com", role="user", hashed_password="pw")
    outsider = models.User(username="mrout", email="mrout@example.com", role="user", hashed_password="pw")
    db.add_all([u1, u2, u3, outsider])
    db.commit()

    token_u1 = make_token(u1.email)
    headers_u1 = {"Authorization": f"Bearer {token_u1}"}

    payload = {"participant_ids": [u1.id, u2.id, u3.id]}
    resp_create = client.post("/api/dm/threads", json=payload, headers=headers_u1)
    thread_id = resp_create.json()["thread_id"]

    # groupsテーブルにDM_Thread_が存在しないこと
    assert_no_dm_thread_groups(db)  # 38

    # 参加者は200
    resp_member = client.post(f"/api/dm/threads/{thread_id}/read", headers=headers_u1)
    assert resp_member.status_code == 200  # 39

    # 非参加者は403
    token_out = make_token(outsider.email)
    headers_out = {"Authorization": f"Bearer {token_out}"}
    resp_nonmember = client.post(f"/api/dm/threads/{thread_id}/read", headers=headers_out)
    assert resp_nonmember.status_code == 403  # 40
