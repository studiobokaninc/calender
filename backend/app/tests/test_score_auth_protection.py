import pytest
from jose import jwt
from app import models
from app.security import SECRET_KEY, ALGORITHM, get_password_hash


def make_token(email: str) -> str:
    return jwt.encode({"sub": email}, SECRET_KEY, algorithm=ALGORITHM)


@pytest.fixture
def test_user(db):
    user = models.User(
        username="score_test_user",
        email="score_test_user@example.com",
        hashed_password=get_password_hash("password"),
        role="user",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def auth_headers(test_user):
    token = make_token(test_user.email)
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize(
    "endpoint",
    [
        "/api/deliveries",
        "/api/retakes",
        "/api/troubles",
        "/api/change_requests",
        "/api/look_distributions",
        "/api/shots/similar?based_on=1",
        "/api/timecards",
        "/api/routines",
        "/api/notifications",
        "/api/user_messages",
    ],
)
def test_endpoints_reject_unauthenticated_request(client, endpoint):
    """認証ヘッダーなしのリクエストは必ず 401 Unauthorized を返すこと"""
    resp = client.get(endpoint)
    assert resp.status_code == 401, f"{endpoint} should return 401 without auth, got {resp.status_code}"


@pytest.mark.parametrize(
    "endpoint",
    [
        "/api/deliveries",
        "/api/retakes",
        "/api/troubles",
        "/api/change_requests",
        "/api/look_distributions",
        "/api/timecards",
        "/api/routines",
        "/api/notifications",
        "/api/user_messages",
    ],
)
def test_endpoints_allow_authenticated_request(client, auth_headers, endpoint):
    """認証ヘッダーありのリクエストは 200 OK を返すこと"""
    resp = client.get(endpoint, headers=auth_headers)
    assert resp.status_code == 200, f"{endpoint} should return 200 with auth, got {resp.status_code}"
