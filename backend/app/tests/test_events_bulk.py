"""cmd_731 四: 予定の一括更新・一括削除の試験。

- all-or-nothing(1件でも違反があれば1件も変わらぬ)
- 権限(status 変更・削除は admin のみ)が一括でも効く
- Google同期の呼び出しが「予定の件数×個人カレンダー数」にならぬ(呼び出し回数を数える)
- webhook は単体と同じ event.updated / event.deleted・同じ payload の形
- 二重マウント(/calendar/events と /api/calendar/events)の双方に口が在る
"""
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from jose import jwt

from app import crud, models
from app.security import SECRET_KEY, ALGORITHM, get_password_hash

MOUNTS = ["/calendar/events", "/api/calendar/events"]


def _token(email):
    return {"Authorization": "Bearer " + jwt.encode({"sub": email}, SECRET_KEY, algorithm=ALGORITHM)}


def _user(db, name, role):
    u = models.User(username=name, email=f"{name}@example.com", hashed_password=get_password_hash("pw"), role=role)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture
def admin(db):
    return _user(db, "bulk_admin", "admin")


@pytest.fixture
def member(db):
    return _user(db, "bulk_member", "member")


def _events(db, n, user_ids=None, status="online"):
    out = []
    for i in range(n):
        e = models.Event(
            title=f"ev{i}", type="Meeting", status=status,
            start_time=datetime(2026, 10, 1 + i, 10, 0), end_time=datetime(2026, 10, 1 + i, 11, 0),
            user_ids=user_ids or [],
        )
        db.add(e)
        out.append(e)
    db.commit()
    for e in out:
        db.refresh(e)
    return out


def _snapshot(db):
    db.expire_all()
    return {e.id: (e.title, e.status, e.location, e.start_time, e.end_time) for e in db.query(models.Event).all()}


@pytest.fixture
def spies(monkeypatch):
    sync = MagicMock()
    hook = AsyncMock()
    monkeypatch.setattr("app.services.google_sync.auto_sync_events_bg", sync)
    monkeypatch.setattr("app.utils.webhook_sender.send_webhook", hook)
    return sync, hook


# ---------- all-or-nothing ----------

@pytest.mark.parametrize("base", MOUNTS)
def test_bulk_update_applies_to_all(client, db, admin, spies, base):
    evs = _events(db, 3)
    r = client.post(f"{base}/bulk-update", json={"event_ids": [e.id for e in evs], "location": "会議室A", "status": "offline"},
                    headers=_token(admin.email))
    assert r.status_code == 200, r.text
    assert r.json()["updated"] == 3
    db.expire_all()
    assert all(e.location == "会議室A" and e.status == "offline" for e in db.query(models.Event).all())


def test_bulk_update_one_missing_id_changes_nothing(client, db, admin, spies):
    evs = _events(db, 3)
    before = _snapshot(db)
    r = client.post("/calendar/events/bulk-update",
                    json={"event_ids": [evs[0].id, evs[1].id, 99999], "location": "X"}, headers=_token(admin.email))
    assert r.status_code == 409
    assert r.json()["detail"]["violations"] == [{"event_id": 99999, "reason": "not_found"}]
    assert _snapshot(db) == before
    sync, hook = spies
    sync.assert_not_called()
    hook.assert_not_called()


def test_bulk_update_one_time_inversion_changes_nothing(client, db, admin, spies):
    """3件中1件だけ、終了が開始より前になる更新は、全件を止める。"""
    evs = _events(db, 3)
    # evs[0] は 10/1 10:00-11:00。end_time を 10/1 09:00 にすると evs[0] のみ逆転ではなく全件が逆転するので
    # 件ごとに結果が違う更新(duration を負にはできぬ)を使う: 全件の終了を 10/2 10:30 に固定。
    # evs[0](10/1 10:00)は正常、evs[1](10/2 10:00)は正常、evs[2](10/3 10:00)は逆転。
    before = _snapshot(db)
    r = client.post("/calendar/events/bulk-update",
                    json={"event_ids": [e.id for e in evs], "end_time": "2026-10-02T10:30:00", "location": "Y"},
                    headers=_token(admin.email))
    assert r.status_code == 409
    assert r.json()["detail"]["violations"] == [{"event_id": evs[2].id, "reason": "end_before_start"}]
    assert _snapshot(db) == before


def test_bulk_update_invalid_type_changes_nothing(client, db, admin, spies):
    evs = _events(db, 2)
    before = _snapshot(db)
    r = client.post("/calendar/events/bulk-update", json={"event_ids": [e.id for e in evs], "type": "Nonsense"},
                    headers=_token(admin.email))
    assert r.status_code == 409
    assert _snapshot(db) == before


def test_bulk_update_commit_failure_rolls_back_all(db, monkeypatch):
    """適用の途中で失敗しても全件が元に戻る(単一トランザクション)。"""
    from app.crud import events_bulk
    evs = _events(db, 3)
    before = _snapshot(db)
    real_commit = db.commit
    monkeypatch.setattr(db, "commit", MagicMock(side_effect=RuntimeError("boom")))
    with pytest.raises(RuntimeError):
        events_bulk.bulk_update_events(db, [e.id for e in evs], {"location": "Z"}, is_admin=True)
    monkeypatch.setattr(db, "commit", real_commit)
    assert _snapshot(db) == before


# ---------- 権限 ----------

def test_bulk_update_status_change_forbidden_for_member_changes_nothing(client, db, member, spies):
    evs = _events(db, 3)
    before = _snapshot(db)
    r = client.post("/calendar/events/bulk-update", json={"event_ids": [e.id for e in evs], "status": "offline"},
                    headers=_token(member.email))
    assert r.status_code == 403
    assert _snapshot(db) == before


def test_bulk_update_non_status_fields_allowed_for_member(client, db, member, spies):
    evs = _events(db, 2)
    r = client.post("/calendar/events/bulk-update", json={"event_ids": [e.id for e in evs], "location": "L"},
                    headers=_token(member.email))
    assert r.status_code == 200
    assert r.json()["updated"] == 2


def test_bulk_update_forbidden_status_wins_over_other_violations(client, db, member, spies):
    """非 admin の status 変更に他の違反(型不正)が混じっても、単体と同じく 403 を優先する。"""
    evs = _events(db, 2)
    before = _snapshot(db)
    r = client.post("/calendar/events/bulk-update",
                    json={"event_ids": [e.id for e in evs], "status": "offline", "type": "Nonsense"},
                    headers=_token(member.email))
    assert r.status_code == 403
    assert _snapshot(db) == before


# ---------- 定例の整合(単体 PUT と同じ検査) ----------

def _rec_events(db, rule="FREQ=WEEKLY;BYDAY=MO", start=datetime(2026, 10, 5, 10, 0)):
    e = models.Event(title="rec", type="Meeting", status="online", start_time=start,
                     end_time=start.replace(hour=11), user_ids=[], recurrence_rule=rule)
    db.add(e)
    db.commit()
    db.refresh(e)
    return e


def _rec_snapshot(db):
    db.expire_all()
    return {e.id: (e.recurrence_rule, e.start_time, e.end_time) for e in db.query(models.Event).all()}


@pytest.mark.parametrize("body, make", [
    ({"recurrence_rule": "FREQ=WEEKLY;UNTIL=20260101"}, dict(rule=None, start=datetime(2026, 10, 5, 10, 0))),
    ({"recurrence_rule": "FREQ=WEEKLY;BYDAY=MO"}, dict(rule=None, start=datetime(2026, 10, 8, 10, 0))),
    ({"start_time": "2026-10-07T10:00:00", "end_time": "2026-10-07T11:00:00"}, dict()),
])
def test_bulk_update_rejects_recurrence_mismatch_like_single_put(client, db, admin, spies, body, make):
    """一括も単体と同じく断る。一件でも違反なら一件も変わらぬ。"""
    bad = _rec_events(db, **make)
    ok = _events(db, 1)[0]
    h = _token(admin.email)
    assert client.put(f"/calendar/events/{bad.id}", json=body, headers=h).status_code == 422
    before = _rec_snapshot(db)
    r = client.post("/calendar/events/bulk-update", json={"event_ids": [ok.id, bad.id], **body}, headers=h)
    assert r.status_code == 409, r.text
    assert any(v["event_id"] == bad.id and v["reason"] == "recurrence_invalid" for v in r.json()["detail"]["violations"])
    assert _rec_snapshot(db) == before


def test_bulk_update_valid_recurrence_rule_still_applies(client, db, admin, spies):
    ev = _rec_events(db, rule=None, start=datetime(2026, 10, 5, 10, 0))
    r = client.post("/calendar/events/bulk-update",
                    json={"event_ids": [ev.id], "recurrence_rule": "FREQ=WEEKLY;BYDAY=MO"}, headers=_token(admin.email))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(models.Event).get(ev.id).recurrence_rule == "FREQ=WEEKLY;BYDAY=MO"


def test_bulk_update_same_status_is_not_a_change_for_member(client, db, member, spies):
    """単体PUTと同じく、値が変わらぬ status 指定は権限を要さぬ。"""
    evs = _events(db, 2, status="online")
    r = client.post("/calendar/events/bulk-update",
                    json={"event_ids": [e.id for e in evs], "status": "online", "location": "L"}, headers=_token(member.email))
    assert r.status_code == 200


@pytest.mark.parametrize("base", MOUNTS)
def test_bulk_delete_forbidden_for_member_deletes_nothing(client, db, member, spies, base):
    evs = _events(db, 3)
    r = client.post(f"{base}/bulk-delete", json={"event_ids": [e.id for e in evs]}, headers=_token(member.email))
    assert r.status_code == 403
    assert db.query(models.Event).count() == 3


def test_bulk_delete_admin_deletes_all(client, db, admin, spies):
    evs = _events(db, 3)
    r = client.post("/api/calendar/events/bulk-delete", json={"event_ids": [e.id for e in evs]}, headers=_token(admin.email))
    assert r.status_code == 200
    assert r.json()["deleted"] == 3
    assert db.query(models.Event).count() == 0


def test_bulk_delete_one_missing_id_deletes_nothing(client, db, admin, spies):
    evs = _events(db, 3)
    r = client.post("/calendar/events/bulk-delete", json={"event_ids": [evs[0].id, 424242]}, headers=_token(admin.email))
    assert r.status_code == 409
    assert db.query(models.Event).count() == 3


def test_bulk_too_many_ids_is_refused(client, db, admin, spies):
    from app.crud.events_bulk import MAX_BULK_EVENTS
    r = client.post("/calendar/events/bulk-delete", json={"event_ids": list(range(1, MAX_BULK_EVENTS + 2))},
                    headers=_token(admin.email))
    assert r.status_code == 400


def test_bulk_requires_auth(client, db):
    assert client.post("/calendar/events/bulk-update", json={"event_ids": [1], "location": "x"}).status_code in (401, 403)
    assert client.post("/api/calendar/events/bulk-delete", json={"event_ids": [1]}).status_code in (401, 403)


# ---------- 二重マウントの双方に口が在る ----------

def test_bulk_routes_exist_on_both_mounts():
    from app.main import app
    paths = {getattr(r, "path", "") for r in app.routes}
    for base in MOUNTS:
        assert f"{base}/bulk-update" in paths
        assert f"{base}/bulk-delete" in paths


# ---------- webhook ----------

def test_bulk_update_webhook_uses_single_event_shape_one_per_event(client, db, admin, spies):
    sync, hook = spies
    evs = _events(db, 3, user_ids=[admin.id])
    r = client.post("/calendar/events/bulk-update", json={"event_ids": [e.id for e in evs], "location": "W"},
                    headers=_token(admin.email))
    assert r.status_code == 200
    assert hook.await_count == 3
    for call in hook.await_args_list:
        event_type, payload = call.args
        assert event_type == "event.updated"
        # 単体 PUT /events/{id} の payload と同一のキー集合
        assert set(payload) == {"event_id", "title", "start_at", "end_at", "attendees", "description",
                                "location", "zoom_url", "updated_by"}
        assert payload["location"] == "W"
        assert payload["updated_by"] == admin.id
    assert sorted(c.args[1]["event_id"] for c in hook.await_args_list) == sorted(e.id for e in evs)


def test_bulk_delete_webhook_uses_single_event_shape(client, db, admin, spies):
    sync, hook = spies
    evs = _events(db, 2)
    client.post("/calendar/events/bulk-delete", json={"event_ids": [e.id for e in evs]}, headers=_token(admin.email))
    assert hook.await_count == 2
    for call in hook.await_args_list:
        event_type, payload = call.args
        assert event_type == "event.deleted"
        assert set(payload) == {"event_id", "title", "start_at", "end_at", "attendees", "deleted_by"}


def test_single_event_webhook_payload_unchanged_by_bulk_helper(db, admin):
    """一括用の payload 組み立ては、単体 PUT の updated payload と同じ形である事を固定する。"""
    from app.crud.events_bulk import event_webhook_payload
    e = _events(db, 1, user_ids=[admin.id])[0]
    p = event_webhook_payload(e, admin.id)
    assert p == {
        "event_id": e.id, "title": e.title, "start_at": e.start_time.isoformat(), "end_at": e.end_time.isoformat(),
        "attendees": [admin.id], "description": e.description, "location": e.location, "zoom_url": e.meeting_url,
        "updated_by": admin.id,
    }


# ---------- 一括更新は Google同期を1本の処理で積む ----------

def test_bulk_update_queues_one_google_sync_task_not_one_per_event(client, db, admin, spies):
    sync, hook = spies
    evs = _events(db, 5)
    client.post("/calendar/events/bulk-update", json={"event_ids": [e.id for e in evs], "location": "G"},
                headers=_token(admin.email))
    assert sync.call_count == 1
    assert sorted(sync.call_args.args[0]) == sorted(e.id for e in evs)


def test_bulk_delete_unlinks_google_with_one_call(client, db, admin, spies, monkeypatch):
    evs = _events(db, 4)
    unlink = MagicMock()
    monkeypatch.setattr("app.google_calendar.is_google_configured", lambda: True)
    monkeypatch.setattr("app.services.google_sync.delete_events_syncs", unlink)
    r = client.post("/calendar/events/bulk-delete", json={"event_ids": [e.id for e in evs]}, headers=_token(admin.email))
    assert r.status_code == 200
    assert unlink.call_count == 1
    assert sorted(unlink.call_args.args[1]) == sorted(e.id for e in evs)


# ---------- Google呼び出し回数: 件数×個人カレンダー数 にならぬ ----------

class _GoogleCounter:
    def __init__(self, monkeypatch):
        from app.services import google_sync
        self.gs = google_sync
        self.token = 0
        self.calendar_list = 0
        self.sync_pairs = 0
        self.api_create = 0
        self.api_update = 0
        self.api_delete = 0

        def token(db):
            self.token += 1
            return "tok"

        real_list = crud.get_all_user_personal_calendars

        def lister(db):
            self.calendar_list += 1
            return real_list(db)

        real_pair = google_sync.sync_event_to_google

        def pair(*a, **k):
            self.sync_pairs += 1
            return real_pair(*a, **k)

        def create(**k):
            self.api_create += 1
            return f"g{self.api_create}"

        def update(**k):
            self.api_update += 1

        def delete(**k):
            self.api_delete += 1

        monkeypatch.setattr(google_sync, "_ensure_shared_token_updated", token)
        monkeypatch.setattr(crud, "get_all_user_personal_calendars", lister)
        monkeypatch.setattr(google_sync, "sync_event_to_google", pair)
        monkeypatch.setattr(google_sync.google_calendar, "create_calendar_event", create)
        monkeypatch.setattr(google_sync.google_calendar, "update_calendar_event", update)
        monkeypatch.setattr(google_sync.google_calendar, "delete_calendar_event", delete)


def _google_world(db, n_calendars):
    """共有アカウント1つ + 個人カレンダー n_calendars 人分。先頭の1人だけが全予定の参加者。"""
    db.add(models.GoogleSharedAccount(id=1, access_token="x", refresh_token="r"))
    users = []
    for i in range(n_calendars):
        u = _user(db, f"gcal_u{i}", "member")
        db.add(models.UserPersonalCalendar(user_id=u.id, calendar_id=f"cal{i}", shared_email=u.email))
        users.append(u)
    db.commit()
    return users


N_EVENTS = 6
N_CALS = 5


def test_naive_loop_inflates_google_calls_to_events_times_calendars(db, monkeypatch):
    """【直す前の素朴な形】auto_sync_event_bg を予定ごとに回すと、トークン更新・カレンダー一覧取得が
    件数ぶん、sync_event_to_google が 件数×個人カレンダー数 回に膨らむ。"""
    users = _google_world(db, N_CALS)
    evs = _events(db, N_EVENTS, user_ids=[users[0].id])
    c = _GoogleCounter(monkeypatch)
    for e in evs:
        c.gs.auto_sync_event_bg(e.id, db=db)
    assert c.token == N_EVENTS
    assert c.calendar_list == N_EVENTS
    assert c.sync_pairs == N_EVENTS * N_CALS


def test_bulk_sync_does_not_scale_with_events_times_calendars(db, monkeypatch):
    """【直した後】トークン・一覧は1回、組の呼び出しは参加者の組のみ(=件数に比例し、カレンダー数に依らぬ)。"""
    users = _google_world(db, N_CALS)
    evs = _events(db, N_EVENTS, user_ids=[users[0].id])
    c = _GoogleCounter(monkeypatch)
    c.gs.auto_sync_events_bg([e.id for e in evs], db=db)
    assert c.token == 1
    assert c.calendar_list == 1
    assert c.sync_pairs == N_EVENTS            # N×M(=30)ではない
    assert c.sync_pairs < N_EVENTS * N_CALS
    assert c.api_create == N_EVENTS            # Googleへの作成は参加者の組のみ


def test_bulk_sync_calls_independent_of_calendar_count(db, monkeypatch):
    """個人カレンダーを5人から15人に増やしても、呼び出し回数は変わらぬ(M に比例せぬ証)。"""
    users = _google_world(db, N_CALS)
    evs = _events(db, N_EVENTS, user_ids=[users[0].id])
    c1 = _GoogleCounter(monkeypatch)
    c1.gs.auto_sync_events_bg([e.id for e in evs], db=db)
    first = (c1.token, c1.calendar_list, c1.sync_pairs, c1.api_create, c1.api_update)

    for i in range(N_CALS, 3 * N_CALS):
        u = _user(db, f"gcal_extra{i}", "member")
        db.add(models.UserPersonalCalendar(user_id=u.id, calendar_id=f"cal{i}", shared_email=u.email))
    db.commit()
    c2 = _GoogleCounter(monkeypatch)
    c2.gs.auto_sync_events_bg([e.id for e in evs], db=db)
    second = (c2.token, c2.calendar_list, c2.sync_pairs, c2.api_create, c2.api_update)
    # 2回目は既に google_event_id が刻まれた後ゆえ create→update に変わるが、合計は変わらぬ
    assert first[:3] == second[:3]
    assert first[3] + first[4] == second[3] + second[4] == N_EVENTS


def test_bulk_sync_scales_with_events_not_calendars_when_event_count_doubles(db, monkeypatch):
    users = _google_world(db, N_CALS)
    evs = _events(db, 2 * N_EVENTS, user_ids=[users[0].id])
    c = _GoogleCounter(monkeypatch)
    c.gs.auto_sync_events_bg([e.id for e in evs], db=db)
    assert c.token == 1 and c.calendar_list == 1
    assert c.sync_pairs == 2 * N_EVENTS


def test_bulk_sync_still_unsyncs_users_who_were_removed_from_event(db, monkeypatch):
    """参加者から外れたが既に同期行が在るユーザーは、従来どおり Google側から消される(挙動を保つ)。"""
    users = _google_world(db, 3)
    ev = _events(db, 1, user_ids=[users[0].id])[0]
    db.add(models.EventGoogleSync(user_id=users[1].id, event_id=ev.id, google_event_id="old-g"))
    db.commit()
    c = _GoogleCounter(monkeypatch)
    c.gs.auto_sync_events_bg([ev.id], db=db)
    assert c.sync_pairs == 2          # users[0](参加者) と users[1](既存同期行)のみ。users[2] は呼ばぬ
    assert c.api_create == 1
    assert c.api_delete == 1


def test_bulk_delete_unlink_fetches_token_once(db, monkeypatch):
    users = _google_world(db, N_CALS)
    evs = _events(db, N_EVENTS, user_ids=[users[0].id])
    for e in evs:
        db.add(models.EventGoogleSync(user_id=users[0].id, event_id=e.id, google_event_id=f"g-{e.id}"))
    db.commit()
    c = _GoogleCounter(monkeypatch)
    c.gs.delete_events_syncs(db, [e.id for e in evs])
    assert c.token == 1
    assert c.calendar_list == 1
    assert c.api_delete == N_EVENTS              # 同期行1件につき1回(必要な呼び出しのみ)
    assert db.query(models.EventGoogleSync).count() == 0


def test_naive_delete_unlink_fetches_token_per_event(db, monkeypatch):
    """【直す前の形】delete_event_syncs を予定ごとに回すと、トークン取得が件数ぶんになる。"""
    users = _google_world(db, N_CALS)
    evs = _events(db, N_EVENTS, user_ids=[users[0].id])
    for e in evs:
        db.add(models.EventGoogleSync(user_id=users[0].id, event_id=e.id, google_event_id=f"g-{e.id}"))
    db.commit()
    c = _GoogleCounter(monkeypatch)
    for e in evs:
        c.gs.delete_event_syncs(db, e.id)
    assert c.token == N_EVENTS
