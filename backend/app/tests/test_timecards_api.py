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


def test_get_my_timecards_returns_200(client, db, admin_user, auth_headers):
    tc = models.Timecard(
        user_id=admin_user.id,
        date=datetime(2026, 6, 1, 9, 0),
        worked_minutes=480,
        break_minutes=60,
    )
    db.add(tc)
    db.commit()

    resp = client.get("/api/me/timecards", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["user_id"] == admin_user.id
    assert data[0]["worked_minutes"] == 480


def test_get_my_timecards_limit(client, db, admin_user, auth_headers):
    for i in range(5):
        tc = models.Timecard(
            user_id=admin_user.id,
            date=datetime(2026, 6, i + 1, 9, 0),
            worked_minutes=480,
            break_minutes=60,
        )
        db.add(tc)
    db.commit()

    resp = client.get("/api/me/timecards?limit=3", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 3


def test_get_my_timecards_only_own(client, db, admin_user, auth_headers):
    from app.security import get_password_hash
    other = models.User(
        username="other_user",
        email="other@example.com",
        hashed_password=get_password_hash("pw"),
        role="user",
    )
    db.add(other)
    db.commit()

    db.add(models.Timecard(user_id=admin_user.id, date=datetime(2026, 6, 1, 9, 0), worked_minutes=480, break_minutes=0))
    db.add(models.Timecard(user_id=other.id, date=datetime(2026, 6, 1, 9, 0), worked_minutes=480, break_minutes=0))
    db.commit()

    resp = client.get("/api/me/timecards", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert all(tc["user_id"] == admin_user.id for tc in data)
