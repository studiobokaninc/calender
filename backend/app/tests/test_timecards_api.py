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
    from datetime import timedelta
    from app.timezone import now_jst_naive
    now = now_jst_naive()
    for i in range(5):
        tc = models.Timecard(
            user_id=admin_user.id,
            date=now - timedelta(days=i),
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


def test_clock_out_with_new_fields(client, db, admin_user, auth_headers):
    # Test POST /api/timecards/clock_out with all new fields
    payload = {
        "date": "2026-06-02T19:30:00",
        "clock_out_at": "2026-06-02T19:30:00",
        "worked_minutes": 480,
        "break_minutes": 60,
        "memo": "Test memo",
        "type": "clock_out",
        "mode": "current",
        "created_at": "2026-06-02T19:30:00",
        "submitted_at": "2026-06-02T19:30:00",
        "for_date": "2026-06-02",
        "fields": {"progress_summary": "Done layout", "completed_tasks": ["layout"]}
    }
    resp = client.post("/api/timecards/clock_out", json=payload, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["type"] == "clock_out"
    assert data["mode"] == "current"
    assert data["for_date"] == "2026-06-02"
    assert data["fields"] == {"progress_summary": "Done layout", "completed_tasks": ["layout"]}

    # Verify defaults backfill for_date if omitted
    payload_no_fordate = {
        "date": "2026-06-03T10:00:00",
        "worked_minutes": 100,
        "break_minutes": 0,
        "type": "clock_in",
        "mode": "current"
    }
    resp2 = client.post("/api/timecards/clock_out", json=payload_no_fordate, headers=auth_headers)
    assert resp2.status_code == 201
    data2 = resp2.json()
    assert data2["for_date"] == "2026-06-03"
    assert data2["type"] == "clock_in"


def test_get_my_timecards_filters_and_defaults(client, db, admin_user, auth_headers):
    from datetime import timedelta
    from app.timezone import now_jst_naive

    now = now_jst_naive()

    # Timecard A: within default range, type="clock_in"
    tc_a = models.Timecard(
        user_id=admin_user.id,
        date=now - timedelta(days=2),
        worked_minutes=120,
        type="clock_in",
        mode="current",
        for_date=(now - timedelta(days=2)).strftime("%Y-%m-%d")
    )
    # Timecard B: within default range, type="clock_out"
    tc_b = models.Timecard(
        user_id=admin_user.id,
        date=now - timedelta(days=1),
        worked_minutes=480,
        type="clock_out",
        mode="current",
        for_date=(now - timedelta(days=1)).strftime("%Y-%m-%d")
    )
    # Timecard C: outside default range (past), type="clock_in"
    tc_c = models.Timecard(
        user_id=admin_user.id,
        date=now - timedelta(days=32),
        worked_minutes=30,
        type="clock_in",
        mode="current",
        for_date=(now - timedelta(days=32)).strftime("%Y-%m-%d")
    )
    # Timecard D: outside default range (future), type="clock_in"
    tc_d = models.Timecard(
        user_id=admin_user.id,
        date=now + timedelta(days=2),
        worked_minutes=40,
        type="clock_in",
        mode="current",
        for_date=(now + timedelta(days=2)).strftime("%Y-%m-%d")
    )

    db.add_all([tc_a, tc_b, tc_c, tc_d])
    db.commit()

    # 1. Test GET with defaults (should return A and B, but not C or D)
    resp = client.get("/api/me/timecards", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    worked_mins = [x["worked_minutes"] for x in data]
    assert 120 in worked_mins  # tc_a
    assert 480 in worked_mins  # tc_b
    assert 30 not in worked_mins  # tc_c (past)
    assert 40 not in worked_mins  # tc_d (future)

    # 2. Test GET with type filter "clock_in"
    resp_in = client.get("/api/me/timecards?type=clock_in", headers=auth_headers)
    assert resp_in.status_code == 200
    data_in = resp_in.json()
    worked_mins_in = [x["worked_minutes"] for x in data_in]
    assert 120 in worked_mins_in
    assert 480 not in worked_mins_in

    # 3. Test GET with explicit from/to dates to capture everything
    from_str = (now - timedelta(days=40)).strftime("%Y-%m-%d")
    to_str = (now + timedelta(days=5)).strftime("%Y-%m-%d")
    resp_all = client.get(f"/api/me/timecards?from={from_str}&to={to_str}", headers=auth_headers)
    assert resp_all.status_code == 200
    data_all = resp_all.json()
    worked_mins_all = [x["worked_minutes"] for x in data_all]
    assert 120 in worked_mins_all
    assert 480 in worked_mins_all
    assert 30 in worked_mins_all
    assert 40 in worked_mins_all
