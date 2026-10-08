"""cmd_731 三(subtask_731a): 定例(規則のみ持ち読み出し時に展開)の試験。

- 三経路(crud.get_events=GET /calendar/events・score GET /api/me/events・readonly GET /api/readonly/events)が同じ結果
- 期間なし・上限超えで暴れぬ/受け付けぬ規則を断る
- 規則を持たぬ既存予定の見え方が変わらぬ(既存データ無影響)
- db_auto_migrate の ALTER TABLE が生 sqlite3 の旧DBに通る
"""
import importlib.util
import os
import shutil
import sqlite3
import sys
from datetime import datetime

import pytest
from jose import jwt

from app import crud, models, recurrence
from app.security import SECRET_KEY, ALGORITHM, get_password_hash

MOUNTS = ["/calendar/events", "/api/calendar/events"]


def _auth(email):
    return {"Authorization": "Bearer " + jwt.encode({"sub": email}, SECRET_KEY, algorithm=ALGORITHM)}


def _ro():
    """readonly 用ヘッダ。アプリ起動時に .env が環境変数を上書きし得る為、リクエスト直前に現在値を読む。"""
    return {"X-Readonly-Token": os.environ.get("SCORE_READONLY_TOKEN") or "test_readonly_token_recurrence"}


@pytest.fixture(autouse=True)
def _readonly_env(client):
    # client 生成(=アプリ起動・.env読込)の後で、未設定の時のみ既定値を入れる
    if not os.environ.get("SCORE_READONLY_TOKEN"):
        os.environ["SCORE_READONLY_TOKEN"] = "test_readonly_token_recurrence"
    yield


@pytest.fixture
def admin(db):
    u = models.User(username="rec_admin", email="rec_admin@example.com",
                    hashed_password=get_password_hash("pw"), role="admin")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _event(db, title, start, end, rule=None, user_ids=None):
    e = models.Event(title=title, type="Meeting", status="online", start_time=start, end_time=end,
                     user_ids=user_ids or [], recurrence_rule=rule)
    db.add(e)
    db.commit()
    db.refresh(e)
    return e


def _key(rows):
    """三経路を突き合わせる為の正規形: (id, 開始, 終了, 回番号)。"""
    return sorted((r["id"], r["start_time"][:19], r["end_time"][:19], r.get("occurrence_index")) for r in rows)


def _via_three_routes(client, admin, start, end):
    h = _auth(admin.email)
    a = client.get("/calendar/events", params={"start_date": start, "end_date": end, "limit": 1000}, headers=h)
    a2 = client.get("/api/calendar/events", params={"start_date": start, "end_date": end, "limit": 1000}, headers=h)
    b = client.get("/api/me/events", params={"from": start, "to": end}, headers=h)
    c = client.get("/api/readonly/events", params={"start_date": start, "end_date": end, "limit": 500},
                   headers=_ro())
    for r in (a, a2, b, c):
        assert r.status_code == 200, r.text
    return a.json(), a2.json(), b.json(), c.json()["items"]


# ---------- 三経路で同じ結果 ----------

def test_three_routes_return_same_occurrences(client, db, admin):
    ev = _event(db, "定例", datetime(2026, 10, 1, 10, 0), datetime(2026, 10, 1, 11, 0),
                rule="FREQ=DAILY;COUNT=10", user_ids=[admin.id])
    a, a2, b, c = _via_three_routes(client, admin, "2026-10-03T00:00:00", "2026-10-07T23:59:59")
    expect = sorted(
        (ev.id, f"2026-10-0{d}T10:00:00", f"2026-10-0{d}T11:00:00", d - 1) for d in range(3, 8)
    )
    assert len(expect) == 5  # 期間内の回数だけ
    assert _key(a) == _key(a2) == _key(b) == _key(c) == expect
    # id の意味は変わらぬ(全て元の1件の id)
    assert {r["id"] for r in a + b + c} == {ev.id}
    # DBは1行のまま
    assert db.query(models.Event).count() == 1


def test_three_routes_with_mixed_plain_and_recurring(client, db, admin):
    plain = _event(db, "単発", datetime(2026, 10, 5, 9, 0), datetime(2026, 10, 5, 9, 30), user_ids=[admin.id])
    outside = _event(db, "期間外", datetime(2026, 12, 5, 9, 0), datetime(2026, 12, 5, 9, 30), user_ids=[admin.id])
    rec = _event(db, "週次", datetime(2026, 10, 1, 10, 0), datetime(2026, 10, 1, 11, 0),
                 rule="FREQ=WEEKLY;BYDAY=TH;COUNT=4", user_ids=[admin.id])
    a, a2, b, c = _via_three_routes(client, admin, "2026-10-01T00:00:00", "2026-10-31T23:59:59")
    assert _key(a) == _key(a2) == _key(b) == _key(c)
    ids = [r["id"] for r in a]
    assert ids.count(rec.id) == 4 and ids.count(plain.id) == 1 and outside.id not in ids


def test_occurrence_index_is_stable_across_windows(client, db, admin):
    ev = _event(db, "定例", datetime(2026, 10, 1, 10, 0), datetime(2026, 10, 1, 11, 0),
                rule="FREQ=DAILY", user_ids=[admin.id])
    a, _, _, _ = _via_three_routes(client, admin, "2026-10-05T00:00:00", "2026-10-06T23:59:59")
    assert sorted((r["id"], r["occurrence_index"]) for r in a) == [(ev.id, 4), (ev.id, 5)]


# ---------- 期間なし・上限 ----------

def test_no_window_does_not_expand(client, db, admin):
    ev = _event(db, "定例", datetime(2026, 10, 1, 10, 0), datetime(2026, 10, 1, 11, 0),
                rule="FREQ=DAILY", user_ids=[admin.id])
    h = _auth(admin.email)
    assert crud.get_events(db) == [ev]
    for url, params, hdr in [
        ("/calendar/events", {}, h),
        ("/calendar/events", {"start_date": "2026-10-01T00:00:00"}, h),  # 片端のみ
        ("/api/me/events", {}, h),
        ("/api/me/events", {"to": "2026-12-31T00:00:00"}, h),
        ("/api/readonly/events", {}, _ro()),
        ("/api/readonly/events", {"end_date": "2026-12-31T00:00:00"}, _ro()),
    ]:
        r = client.get(url, params=params, headers=hdr)
        assert r.status_code == 200, (url, params, r.text)
        rows = r.json()["items"] if isinstance(r.json(), dict) else r.json()
        assert [x["id"] for x in rows] == [ev.id], (url, params)
        assert rows[0].get("occurrence_index") is None


def test_unbounded_rule_is_capped_by_window_and_limits(client, db, admin):
    _event(db, "無期限", datetime(2026, 1, 1, 10, 0), datetime(2026, 1, 1, 11, 0),
           rule="FREQ=DAILY", user_ids=[admin.id])
    # 上限ちょうど(366日)の問いは有限の回数で返る
    a, _, b, c = _via_three_routes(client, admin, "2026-02-01T00:00:00", "2027-01-31T23:59:59")
    assert 0 < len(a) <= recurrence.MAX_OCCURRENCES_PER_RULE
    assert len(a) == len(b)
    # 期間の長さでは断らぬ。回数の上限を実際に溢れさせた時のみ三経路とも400
    h = _auth(admin.email)
    ro = _ro()
    assert client.get("/calendar/events", params={"start_date": "2020-01-01T00:00:00", "end_date": "2030-01-01T00:00:00"}, headers=h).status_code == 400
    assert client.get("/api/me/events", params={"from": "2020-01-01T00:00:00", "to": "2030-01-01T00:00:00"}, headers=h).status_code == 400
    assert client.get("/api/readonly/events", params={"start_date": "2020-01-01T00:00:00", "end_date": "2030-01-01T00:00:00"}, headers=ro).status_code == 400
    with pytest.raises(recurrence.RecurrenceError):
        crud.get_events(db, start_date=datetime(2020, 1, 1), end_date=datetime(2030, 1, 1))


def test_long_window_ok_with_finished_rule(client, db, admin):
    """2年の期間の問いは、とうに終わった定例(COUNT=1)が在っても三経路とも200(期間の長さでは断らぬ)。"""
    ev = _event(db, "終わった定例", datetime(2026, 1, 1, 10, 0), datetime(2026, 1, 1, 11, 0),
                rule="FREQ=DAILY;COUNT=1", user_ids=[admin.id])
    a, a2, b, c = _via_three_routes(client, admin, "2026-01-01T00:00:00", "2028-01-01T00:00:00")
    assert _key(a) == _key(a2) == _key(b) == _key(c)
    assert [r["id"] for r in a] == [ev.id]
    assert crud.get_events(db, start_date=datetime(2026, 1, 1), end_date=datetime(2028, 1, 1)) != []


def test_long_window_far_from_old_rule_ok(client, db, admin):
    """終わった定例から遠い2年の期間でも200で空。"""
    _event(db, "終わった定例", datetime(2020, 1, 1, 10, 0), datetime(2020, 1, 1, 11, 0),
           rule="FREQ=DAILY;COUNT=3", user_ids=[admin.id])
    a, a2, b, c = _via_three_routes(client, admin, "2026-01-01T00:00:00", "2028-01-01T00:00:00")
    assert a == a2 == b == c == []


@pytest.mark.parametrize("suffix", ["Z", "+09:00"])
def test_tz_aware_window_with_recurring_event(client, db, admin, suffix):
    """期間の引数に tz 付き日時を渡しても、定例が在る時に三経路とも200(500にならぬ)。tz は落とすのみで換算しない。"""
    ev = _event(db, "定例", datetime(2026, 10, 1, 10, 0), datetime(2026, 10, 1, 11, 0),
                rule="FREQ=DAILY;COUNT=10", user_ids=[admin.id])
    a, a2, b, c = _via_three_routes(client, admin, "2026-10-03T00:00:00" + suffix, "2026-10-07T23:59:59" + suffix)
    expect = sorted((ev.id, f"2026-10-0{d}T10:00:00", f"2026-10-0{d}T11:00:00", d - 1) for d in range(3, 8))
    assert _key(a) == _key(a2) == _key(b) == _key(c) == expect
    got = crud.get_events(db, start_date=datetime.fromisoformat("2026-10-03T00:00:00+09:00"),
                          end_date=datetime.fromisoformat("2026-10-07T23:59:59+09:00"))
    assert len(got) == 5


def test_window_too_long_is_not_refused_without_recurring_events(client, db, admin):
    """定例が無ければ長い期間でも従来どおり(新しい制限を既存の問いに持ち込まぬ)。"""
    plain = _event(db, "単発", datetime(2026, 10, 5, 9, 0), datetime(2026, 10, 5, 9, 30), user_ids=[admin.id])
    r = client.get("/calendar/events", params={"start_date": "2020-01-01T00:00:00", "end_date": "2030-01-01T00:00:00"},
                   headers=_auth(admin.email))
    assert r.status_code == 200 and [x["id"] for x in r.json()] == [plain.id]


def test_total_expansion_cap(db):
    start, end = datetime(2026, 1, 1, 10, 0), datetime(2026, 1, 1, 11, 0)
    for i in range(14):  # 14規則 × 366回 > MAX_EXPANDED_TOTAL
        _event(db, f"d{i}", start, end, rule="FREQ=DAILY")
    with pytest.raises(recurrence.RecurrenceError):
        crud.get_events(db, limit=10000, start_date=datetime(2026, 1, 1), end_date=datetime(2026, 12, 31))


# ---------- 受け付けぬ規則を断る ----------

BAD_RULES = [
    "FREQ=YEARLY",                       # 対象外の頻度
    "FREQ=HOURLY",
    "FREQ=DAILY;BYSETPOS=1",             # 対象外のキー
    "FREQ=MONTHLY;BYMONTHDAY=15",
    "FREQ=DAILY;BYDAY=MO",               # BYDAY は WEEKLY のみ
    "FREQ=WEEKLY;BYDAY=XX",
    "FREQ=DAILY;COUNT=3;UNTIL=20261231", # 同時指定
    "FREQ=DAILY;COUNT=0",
    "FREQ=DAILY;COUNT=100000",
    "FREQ=DAILY;INTERVAL=0",
    "FREQ=DAILY;INTERVAL=-1",
    "FREQ=DAILY;INTERVAL=1000",
    "FREQ=DAILY;FREQ=WEEKLY",            # 重複
    "INTERVAL=2",                        # FREQ 無し
    "FREQ=DAILY;UNTIL=abc",
    "garbage",
    "FREQ=DAILY;" + "X" * 300,
]


@pytest.mark.parametrize("rule", BAD_RULES)
def test_bad_rule_rejected_on_create(client, db, admin, rule):
    r = client.post("/calendar/events", json={
        "title": "x", "type": "Meeting", "start_time": "2026-10-01T10:00:00", "end_time": "2026-10-01T11:00:00",
        "recurrence_rule": rule}, headers=_auth(admin.email))
    assert r.status_code == 422, (rule, r.text)
    assert db.query(models.Event).count() == 0


def test_bad_rule_rejected_on_update_and_original_kept(client, db, admin):
    ev = _event(db, "定例", datetime(2026, 10, 1, 10, 0), datetime(2026, 10, 1, 11, 0), rule="FREQ=DAILY;COUNT=3")
    r = client.put(f"/calendar/events/{ev.id}", json={"recurrence_rule": "FREQ=YEARLY"}, headers=_auth(admin.email))
    assert r.status_code == 422
    db.expire_all()
    assert db.query(models.Event).get(ev.id).recurrence_rule == "FREQ=DAILY;COUNT=3"


def test_rule_inconsistent_with_start_rejected(client, db, admin):
    base = {"title": "x", "type": "Meeting", "start_time": "2026-10-01T10:00:00", "end_time": "2026-10-01T11:00:00"}
    h = _auth(admin.email)
    # 2026-10-01 は木曜: BYDAY に木曜が無い/UNTIL が開始前は断る
    assert client.post("/calendar/events", json={**base, "recurrence_rule": "FREQ=WEEKLY;BYDAY=MO"}, headers=h).status_code == 422
    assert client.post("/calendar/events", json={**base, "recurrence_rule": "FREQ=DAILY;UNTIL=20260901"}, headers=h).status_code == 422
    assert db.query(models.Event).count() == 0


def test_good_rule_accepted_and_normalized(client, db, admin):
    r = client.post("/api/calendar/events", json={
        "title": "x", "type": "Meeting", "start_time": "2026-10-01T10:00:00", "end_time": "2026-10-01T11:00:00",
        "recurrence_rule": "rrule:freq=weekly;byday=th,th;interval=2;count=3"}, headers=_auth(admin.email))
    assert r.status_code == 201, r.text
    assert r.json()["recurrence_rule"] == "FREQ=WEEKLY;INTERVAL=2;BYDAY=TH;COUNT=3"


def test_expansion_rules():
    def occ(rule, start, end, w0, w1):
        e = models.Event(start_time=start, end_time=end, recurrence_rule=rule)
        return [s for _, s, _ in recurrence.occurrences(e, w0, w1)]

    s, e = datetime(2026, 1, 31, 10, 0), datetime(2026, 1, 31, 11, 0)
    # 毎月31日: 31日の無い月は飛ばす
    got = occ("FREQ=MONTHLY;COUNT=3", s, e, datetime(2026, 1, 1), datetime(2026, 12, 31))
    assert got == [datetime(2026, 1, 31, 10), datetime(2026, 3, 31, 10), datetime(2026, 5, 31, 10)]
    # 隔週・複数曜日 / UNTIL
    s, e = datetime(2026, 10, 5, 9, 0), datetime(2026, 10, 5, 10, 0)  # 月曜
    got = occ("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261022", s, e, datetime(2026, 10, 1), datetime(2026, 12, 31))
    assert got == [datetime(2026, 10, 5, 9), datetime(2026, 10, 7, 9), datetime(2026, 10, 19, 9), datetime(2026, 10, 21, 9)]


# ---------- 既存データ無影響 ----------

def test_plain_events_unchanged_by_feature(client, db, admin):
    evs = [
        _event(db, f"e{i}", datetime(2026, 10, 1 + i, 10, 0), datetime(2026, 10, 1 + i, 11, 0), user_ids=[admin.id])
        for i in range(6)
    ]
    w0, w1 = datetime(2026, 10, 2), datetime(2026, 10, 5, 23, 59)
    legacy = (db.query(models.Event)
              .filter(models.Event.end_time >= w0, models.Event.start_time <= w1)
              .order_by(models.Event.start_time.desc(), models.Event.id.desc()).all())
    now = crud.get_events(db, start_date=w0, end_date=w1)
    assert [e.id for e in now] == [e.id for e in legacy]
    assert all(a is b for a, b in zip(now, legacy))  # 同一のORM行のまま(展開の変換を通っておらぬ)
    # 全件(期間なし)も従来の並び
    assert [e.id for e in crud.get_events(db)] == [e.id for e in sorted(evs, key=lambda x: (x.start_time, x.id), reverse=True)]

    a, a2, b, c = _via_three_routes(client, admin, "2026-10-02T00:00:00", "2026-10-05T23:59:59")
    assert [r["id"] for r in a] == [e.id for e in legacy]
    assert [r["id"] for r in c] == [e.id for e in legacy]
    assert sorted(r["id"] for r in b) == sorted(e.id for e in legacy)
    for r in a + b + c:
        assert r["recurrence_rule"] is None and r["occurrence_index"] is None


def test_plain_event_json_shape_unchanged_apart_from_new_keys(client, db, admin):
    ev = _event(db, "単発", datetime(2026, 10, 5, 9, 0), datetime(2026, 10, 5, 9, 30), user_ids=[admin.id])
    r = client.get(f"/calendar/events/{ev.id}", headers=_auth(admin.email)).json()
    assert r["title"] == "単発" and r["date"] == "2026-10-05" and r["time"] == "09:00" and r["duration_minutes"] == 30
    assert r["recurrence_rule"] is None


# ---------- db_auto_migrate の DDL を生 sqlite3 の旧DBへ ----------

def test_auto_migrate_adds_column_on_raw_sqlite(tmp_path):
    from app.database import Base
    from sqlalchemy import create_engine

    src = os.path.join(os.path.dirname(os.path.dirname(__file__)), "db_auto_migrate.py")
    pkg = tmp_path / "pkg"
    pkg.mkdir()
    shutil.copy(src, pkg / "db_auto_migrate.py")
    db_file = pkg / "project_management.db"

    eng = create_engine(f"sqlite:///{db_file}")
    Base.metadata.create_all(bind=eng)
    eng.dispose()
    con = sqlite3.connect(db_file)
    con.execute("ALTER TABLE events DROP COLUMN recurrence_rule")  # 旧DB(列なし)を再現
    con.execute("INSERT INTO events (title, start_time, end_time, type, status) VALUES ('旧','2026-10-01 10:00:00','2026-10-01 11:00:00','Meeting','offline')")
    con.commit()
    assert "recurrence_rule" not in [r[1] for r in con.execute("PRAGMA table_info(events)")]
    con.close()

    spec = importlib.util.spec_from_file_location("_mig_copy", pkg / "db_auto_migrate.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.check_and_migrate_db()
    mod.check_and_migrate_db()  # 冪等

    con = sqlite3.connect(db_file)
    cols = {r[1]: r for r in con.execute("PRAGMA table_info(events)")}
    assert "recurrence_rule" in cols and cols["recurrence_rule"][3] == 0  # nullable
    # (db_auto_migrate は元から試験用イベントを INSERT する。ここでは旧行が無傷で規則NULLの事だけ見る)
    assert con.execute("SELECT title, recurrence_rule FROM events WHERE title='旧'").fetchall() == [("旧", None)]
    con.close()
