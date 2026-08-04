import pytest
from app import models
from app.security import get_password_hash, verify_password
from jose import jwt
from app.security import SECRET_KEY, ALGORITHM


def make_token(email: str) -> str:
    return jwt.encode({"sub": email}, SECRET_KEY, algorithm=ALGORITHM)


@pytest.fixture
def user(db):
    u = models.User(
        username="pw_test_user",
        email="pw_test_user@example.com",
        hashed_password=get_password_hash("old_password"),
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


def test_password_change_success(client, db, user, auth_headers):
    payload = {
        "current_password": "old_password",
        "new_password": "new_password_123",
    }
    resp = client.post("/api/me/change-password", json=payload, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"

    # Verify that database password is updated
    db.refresh(user)
    assert verify_password("new_password_123", user.hashed_password)
    assert not verify_password("old_password", user.hashed_password)


def test_password_change_incorrect_current_password(client, db, user, auth_headers):
    payload = {
        "current_password": "wrong_password",
        "new_password": "new_password_123",
    }
    resp = client.post("/api/me/change-password", json=payload, headers=auth_headers)
    assert resp.status_code == 400
    assert "現在のパスワードが正しくありません" in resp.json()["detail"]

    # Verify that database password is not updated
    db.refresh(user)
    assert verify_password("old_password", user.hashed_password)


def test_password_change_too_short_new_password(client, db, user, auth_headers):
    # Pydantic min_length=4 validation
    payload = {
        "current_password": "old_password",
        "new_password": "123", # 3 chars
    }
    resp = client.post("/api/me/change-password", json=payload, headers=auth_headers)
    assert resp.status_code == 422


def test_password_change_unauthenticated(client):
    payload = {
        "current_password": "old_password",
        "new_password": "new_password_123",
    }
    resp = client.post("/api/me/change-password", json=payload)
    assert resp.status_code == 401
