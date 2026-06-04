import pytest
from app import models
from app.security import get_password_hash
from jose import jwt
from app.security import SECRET_KEY, ALGORITHM


def make_token(email: str) -> str:
    return jwt.encode({"sub": email}, SECRET_KEY, algorithm=ALGORITHM)


@pytest.fixture
def user(db):
    u = models.User(
        username="notif_user",
        email="notif_user@example.com",
        hashed_password=get_password_hash("password"),
        role="user",
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture
def auth_headers(user):
    token = make_token(user.email)
    return {"Authorization": f"Bearer {token}"}


def test_create_notification_returns_201(client, user, auth_headers):
    payload = {
        "recipient_id": user.id,
        "title": "テスト通知",
        "body": "テスト本文",
        "type": "mention",
        "meta": {"key": "value"},
    }
    resp = client.post("/api/notifications", json=payload, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["recipient_id"] == user.id
    assert data["title"] == "テスト通知"
    assert data["body"] == "テスト本文"
    assert data["type"] == "mention"
    assert data["meta"] == {"key": "value"}
    assert "id" in data
    assert "created_at" in data


def test_create_notification_reflected_in_get(client, user, auth_headers):
    payload = {
        "recipient_id": user.id,
        "title": "GET確認通知",
        "body": "GET確認本文",
        "type": "notice",
    }
    post_resp = client.post("/api/notifications", json=payload, headers=auth_headers)
    assert post_resp.status_code == 201
    created_id = post_resp.json()["id"]

    get_resp = client.get(f"/api/notifications?recipient_id={user.id}", headers=auth_headers)
    assert get_resp.status_code == 200
    ids = [n["id"] for n in get_resp.json()]
    assert created_id in ids
