import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app import models
from jose import jwt
from app.security import SECRET_KEY, ALGORITHM


def make_token(email: str) -> str:
    return jwt.encode({"sub": email}, SECRET_KEY, algorithm=ALGORITHM)


@pytest.fixture
def two_users(db: Session):
    from app.security import get_password_hash
    u1 = models.User(
        username="dm_user1",
        email="dm_user1@example.com",
        hashed_password=get_password_hash("pw"),
        role="user",
    )
    u2 = models.User(
        username="dm_user2",
        email="dm_user2@example.com",
        hashed_password=get_password_hash("pw"),
        role="user",
    )
    db.add_all([u1, u2])
    db.commit()
    db.refresh(u1)
    db.refresh(u2)
    return u1, u2


def test_get_dm_thread_messages_returns_all(client: TestClient, db: Session, two_users):
    u1, u2 = two_users
    thread_id = min(u1.id, u2.id) * 10000 + max(u1.id, u2.id)

    # Insert 3 messages directly into the DB
    msgs = [
        models.DirectMessage(thread_id=thread_id, sender_id=u1.id, recipient_id=u2.id, body="Hello"),
        models.DirectMessage(thread_id=thread_id, sender_id=u2.id, recipient_id=u1.id, body="Hi there"),
        models.DirectMessage(thread_id=thread_id, sender_id=u1.id, recipient_id=u2.id, body="How are you?"),
    ]
    db.add_all(msgs)
    db.commit()

    headers = {"Authorization": f"Bearer {make_token(u1.email)}"}
    resp = client.get(f"/api/dm/threads/{thread_id}/messages", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 3
    assert data[0]["body"] == "Hello"
    assert data[1]["body"] == "Hi there"
    assert data[2]["body"] == "How are you?"
    for item in data:
        assert item["thread_id"] == thread_id


def test_post_dm_thread_read_marks_unread(client: TestClient, db: Session, two_users):
    u1, u2 = two_users
    thread_id = min(u1.id, u2.id) * 10000 + max(u1.id, u2.id)

    # u2 sends two messages to u1 (unread for u1)
    msgs = [
        models.DirectMessage(thread_id=thread_id, sender_id=u2.id, recipient_id=u1.id, body="Msg A"),
        models.DirectMessage(thread_id=thread_id, sender_id=u2.id, recipient_id=u1.id, body="Msg B"),
    ]
    db.add_all(msgs)
    db.commit()
    msg_ids = [m.id for m in msgs]

    # u1 calls read endpoint
    headers = {"Authorization": f"Bearer {make_token(u1.email)}"}
    resp = client.post(f"/api/dm/threads/{thread_id}/read", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["thread_id"] == thread_id
    assert data["read_count"] == 2

    # Verify persistence: re-fetch via GET and check read_at is set
    resp2 = client.get(f"/api/dm/threads/{thread_id}/messages", headers=headers)
    assert resp2.status_code == 200
    fetched = resp2.json()
    for item in fetched:
        assert item["read_at"] is not None

    # Idempotent: calling again returns read_count == 0
    resp3 = client.post(f"/api/dm/threads/{thread_id}/read", headers=headers)
    assert resp3.status_code == 200
    assert resp3.json()["read_count"] == 0
