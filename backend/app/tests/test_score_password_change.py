import pytest
import os
from app import models
from app.security import get_password_hash, verify_password
from jose import jwt
from app.security import SECRET_KEY, ALGORITHM


@pytest.fixture(autouse=True)
def setup_tokens():
    if not os.environ.get("SCORE_READONLY_TOKEN"):
        os.environ["SCORE_READONLY_TOKEN"] = "test_readonly_token_abc"
    if not os.environ.get("CASPER_WRITE_TOKEN"):
        os.environ["CASPER_WRITE_TOKEN"] = "test_casper_write_token"
    yield


def make_token(email: str) -> str:
    return jwt.encode({"sub": email}, SECRET_KEY, algorithm=ALGORITHM)


@pytest.fixture
def user(db):
    u = models.User(
        username="score_pw_user",
        email="score_pw_user@example.com",
        hashed_password=get_password_hash("old_score_password"),
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


def test_score_password_change_success(client, db, user, auth_headers):
    payload = {
        "current_password": "old_score_password",
        "new_password": "new_password_12345",
    }
    resp = client.post("/api/score/change-password", json=payload, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"

    # Verify that database password is updated
    db.refresh(user)
    assert verify_password("new_password_12345", user.hashed_password)
    assert not verify_password("old_score_password", user.hashed_password)


def test_score_password_change_incorrect_current_password(client, db, user, auth_headers):
    payload = {
        "current_password": "wrong_password",
        "new_password": "new_password_12345",
    }
    resp = client.post("/api/score/change-password", json=payload, headers=auth_headers)
    assert resp.status_code == 400
    assert "現在のパスワードが正しくありません" in resp.json()["detail"]

    # Verify that database password is not updated
    db.refresh(user)
    assert verify_password("old_score_password", user.hashed_password)


def test_score_password_change_unauthenticated(client):
    payload = {
        "current_password": "old_score_password",
        "new_password": "new_password_12345",
    }
    resp = client.post("/api/score/change-password", json=payload)
    assert resp.status_code == 401
