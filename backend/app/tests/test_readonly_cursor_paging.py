"""app/tests/test_readonly_cursor_paging.py — cmd_733 / subtask_733a
読取専用の一覧に「続きから取る頁送り」(cursor / next_cursor)を足した事の試験。

 (1) 歩く合間に 行を足す・消す・並びの軸の列を書き換える を挟んでも、歩き始めから終わりまで在った行が
     全件・重複なしで返る(会議一覧・タスク一覧の実エンドポイント)
 (2) 同じ割り込みを offset の頁送りで行うと重複か取り落ちが出る(対)
 (3) 一覧すべてが cursor を受け next_cursor を返す
 (4) cursor を付けぬ従来呼出の回帰
 (5) 400 の三種(壊れた cursor / cursor と offset>0 / 予定の定例展開経路)
"""
import os
from datetime import datetime, timedelta

import pytest

from app import models

LIMIT = 3
N = 10


@pytest.fixture(autouse=True)
def setup_readonly_env(monkeypatch):
    monkeypatch.setenv("SCORE_READONLY_TOKEN", "test_readonly_token_abc")
    yield


@pytest.fixture
def hdr():
    return {"X-Readonly-Token": os.environ.get("SCORE_READONLY_TOKEN") or "test_readonly_token_abc"}


BASE = datetime(2026, 1, 1, 0, 0, 0)


def _project(db, name="p733"):
    p = models.Project(name=name, display_status="online")
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _meetings(db, pid, n=N):
    out = []
    for i in range(n):
        m = models.Meeting(project_id=pid, title=f"m733_{i}", date=BASE + timedelta(days=i), status="completed")
        db.add(m)
        db.commit()
        db.refresh(m)
        out.append(m.id)
    return out


def _tasks(db, pid, n=N):
    out = []
    for i in range(n):
        t = models.Task(project_id=pid, name=f"t733_{i}",
                        created_at=BASE + timedelta(minutes=i), updated_at=BASE + timedelta(minutes=i))
        db.add(t)
        db.commit()
        db.refresh(t)
        out.append(t.id)
    return out


# ---- 割り込み(足す・消す・並びの軸を書き換える) ----

def _meeting_interrupt(db, pid, ids):
    """既存の先頭側・末尾側の会議日を書き換え、1件消し、1件足す。(消す行は歩き始めから終わりまで在った行に含めない)"""
    first, last, victim = ids[-1], ids[0], ids[4]
    db.get(models.Meeting, first).date = BASE - timedelta(days=500)   # 先頭の行を最後尾へ
    db.get(models.Meeting, last).date = BASE + timedelta(days=500)    # 末尾の行を先頭へ
    db.delete(db.get(models.Meeting, victim))
    db.commit()
    _meetings(db, pid, 1)
    return {victim}


def _task_interrupt(db, pid, ids):
    db.get(models.Task, ids[-1]).created_at = BASE - timedelta(days=500)
    db.get(models.Task, ids[0]).created_at = BASE + timedelta(days=500)
    db.get(models.Task, ids[0]).updated_at = BASE + timedelta(days=500)
    victim = ids[4]
    db.delete(db.get(models.Task, victim))
    db.commit()
    _tasks(db, pid, 1)
    return {victim}


CASES = {
    "meetings": (_meetings, _meeting_interrupt, "/api/readonly/meetings"),
    "tasks": (_tasks, _task_interrupt, "/api/readonly/tasks"),
}


def _walk_cursor(client, db, hdr, url, pid, interrupt):
    got, cursor, page = [], "start", 0
    while cursor:
        if page == 1:
            interrupt()
        r = client.get(f"{url}?project_id={pid}&limit={LIMIT}&cursor={cursor}", headers=hdr)
        assert r.status_code == 200, r.text
        body = r.json()
        got += [it["id"] for it in body["items"]]
        cursor = body["next_cursor"]
        page += 1
        assert page < 50
    return got


def _walk_offset(client, db, hdr, url, pid, interrupt):
    got, page = [], 0
    while True:
        if page == 1:
            interrupt()
        r = client.get(f"{url}?project_id={pid}&limit={LIMIT}&offset={page * LIMIT}", headers=hdr)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        got += [it["id"] for it in items]
        page += 1
        if len(items) < LIMIT or page > 50:
            return got


@pytest.mark.parametrize("kind", ["meetings", "tasks"])
def test_cursor_walk_exactly_once_under_interruption(client, db, hdr, kind):
    seed, interrupt, url = CASES[kind]
    p = _project(db)
    ids = seed(db, p.id)
    removed = set()

    def go():
        removed.update(interrupt(db, p.id, ids))

    got = _walk_cursor(client, db, hdr, url, p.id, go)
    assert len(got) == len(set(got)), f"重複あり: {got}"
    stayed = set(ids) - removed          # 歩き始めから終わりまで在った行
    assert stayed <= set(got), f"取り落としあり: 欠け={sorted(stayed - set(got))}"
    assert got == sorted(got, reverse=True)  # id 降順一本


@pytest.mark.parametrize("kind", ["meetings", "tasks"])
def test_offset_walk_breaks_under_same_interruption(client, db, hdr, kind):
    """対: 同じ割り込みを offset の頁送りで行うと、重複か取り落ちが出る。"""
    seed, interrupt, url = CASES[kind]
    p = _project(db)
    ids = seed(db, p.id)
    removed = set()

    def go():
        removed.update(interrupt(db, p.id, ids))

    got = _walk_offset(client, db, hdr, url, p.id, go)
    stayed = set(ids) - removed
    broken = len(got) != len(set(got)) or not (stayed <= set(got))
    assert broken, f"offset でも壊れていない(対の前提が崩れた): {got}"


# ---- 全一覧が cursor を受け next_cursor を返す ----

LIST_URLS = [
    "/api/readonly/projects",
    "/api/readonly/projects/{pid}/shots",
    "/api/readonly/shots",
    "/api/readonly/shots/{sid}/tasks",
    "/api/readonly/tasks",
    "/api/readonly/events",
    "/api/readonly/users",
    "/api/readonly/notifications",
    "/api/readonly/meetings",
    "/api/readonly/decisions",
    "/api/readonly/score_user_roles",
    "/api/readonly/retakes",
    "/api/readonly/assets",
    "/api/readonly/task_status_history",
]


def test_all_lists_accept_cursor_and_return_next_cursor(client, db, hdr):
    p = _project(db)
    for url in LIST_URLS:
        u = url.format(pid=p.id, sid=1)
        r = client.get(f"{u}?cursor=start&limit=2", headers=hdr)
        assert r.status_code == 200, (u, r.text)
        assert "next_cursor" in r.json(), u
        assert r.json()["next_cursor"] is None, u   # 空の一覧は続き無し


def test_all_lists_cursor_walk_with_rows(client, db, hdr):
    """行が在る一覧(案件・会議・タスク・案件下の実体)で next_cursor が連鎖し、取り切ると null。"""
    p = _project(db)
    _meetings(db, p.id, 5)
    _tasks(db, p.id, 5)
    for u in ("/api/readonly/projects", "/api/readonly/meetings", "/api/readonly/tasks"):
        seen, cursor = [], "start"
        while cursor:
            r = client.get(f"{u}?cursor={cursor}&limit=2", headers=hdr)
            assert r.status_code == 200, r.text
            seen += [it["id"] for it in r.json()["items"]]
            cursor = r.json()["next_cursor"]
        assert len(seen) == len(set(seen)) and seen == sorted(seen, reverse=True), u


def test_filters_and_total_still_apply_with_cursor(client, db, hdr):
    p1, p2 = _project(db, "a733"), _project(db, "b733")
    _meetings(db, p1.id, 5)
    other = _meetings(db, p2.id, 4)
    r = client.get(f"/api/readonly/meetings?project_id={p2.id}&cursor=start&limit=2", headers=hdr)
    b = r.json()
    assert b["total"] == 4 and all(it["id"] in other for it in b["items"]) and b["next_cursor"]
    r = client.get(f"/api/readonly/meetings?title=m733_1&cursor=start&limit=50", headers=hdr)
    assert r.json()["total"] == 2 and r.json()["next_cursor"] is None


# ---- 従来呼出の回帰 ----

def test_legacy_calls_unchanged(client, db, hdr):
    p = _project(db)
    mids = _meetings(db, p.id, 6)
    tids = _tasks(db, p.id, 6)
    # 会議は日付降順→id降順、タスクは作成時刻降順→id降順(変更前の並び)。offset も従来どおり効く
    r = client.get(f"/api/readonly/meetings?project_id={p.id}&limit=2&offset=1", headers=hdr)
    assert r.status_code == 200
    b = r.json()
    assert [it["id"] for it in b["items"]] == [mids[-2], mids[-3]]
    assert b["total"] == 6 and b["limit"] == 2 and b["offset"] == 1 and b["next_cursor"] is None
    r = client.get(f"/api/readonly/tasks?project_id={p.id}&limit=3", headers=hdr)
    assert [it["id"] for it in r.json()["items"]] == [tids[-1], tids[-2], tids[-3]]
    assert r.json()["next_cursor"] is None
    # 並びが id 降順と食い違う状態でも、cursor 無しは従来の並びのまま
    db.get(models.Task, tids[0]).created_at = BASE + timedelta(days=900)
    db.commit()
    r = client.get(f"/api/readonly/tasks?project_id={p.id}&limit=2", headers=hdr)
    assert [it["id"] for it in r.json()["items"]] == [tids[0], tids[-1]]


# ---- 400 の三種 ----

def test_bad_cursor_is_400(client, db, hdr):
    for bad in ("garbage", "!!!", "djE6YWJj", "v1:3"):
        r = client.get(f"/api/readonly/meetings?cursor={bad}", headers=hdr)
        assert r.status_code == 400, (bad, r.text)


def test_cursor_with_offset_is_400(client, db, hdr):
    r = client.get("/api/readonly/tasks?cursor=start&offset=1", headers=hdr)
    assert r.status_code == 400
    # offset=0 の明示は併用に当たらぬ
    assert client.get("/api/readonly/tasks?cursor=start&offset=0", headers=hdr).status_code == 200


def test_cursor_with_recurrence_expansion_is_400(client, db, hdr):
    r = client.get(
        "/api/readonly/events?cursor=start&start_date=2026-01-01T00:00:00&end_date=2026-02-01T00:00:00",
        headers=hdr)
    assert r.status_code == 400
    # 期間指定なしの events は cursor を受ける
    assert client.get("/api/readonly/events?cursor=start", headers=hdr).status_code == 200


# ---- 値の範囲外の cursor は 400(例外=500 にしない) ----

def _forged(last_id):
    import base64
    return base64.urlsafe_b64encode(f"v1:{last_id}".encode("ascii")).decode("ascii")


@pytest.mark.parametrize("last_id", [2 ** 63, 2 ** 63 + 1, 10 ** 30, -1, -5, 0])
@pytest.mark.parametrize("url", ["/api/readonly/events", "/api/readonly/meetings", "/api/readonly/tasks"])
def test_out_of_range_cursor_is_400(client, db, hdr, url, last_id):
    r = client.get(f"{url}?cursor={_forged(last_id)}", headers=hdr)
    assert r.status_code == 400, (url, last_id, r.status_code)


def test_max_signed_int64_cursor_is_accepted(client, db, hdr):
    r = client.get(f"/api/readonly/tasks?cursor={_forged(2 ** 63 - 1)}", headers=hdr)
    assert r.status_code == 200
