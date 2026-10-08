"""cmd_730 / subtask_730a: 会議の題名・日付検索と読取APIの並び順。

- 会議を案件なしで題名(部分一致)・日付範囲で引ける(読取API・MCPの双方)
- 「69件中49件は既定の呼び方では返らぬ」現状の再現と、絞り込みで直る事の証明
- 読取API全一覧の並び順の決定性(同一問いで同一順序・頁送りで取り落ち/重複なし)
- 新引数を渡さぬ従来呼出の後方互換
- Meeting.date の index が models.py と db_auto_migrate.py の双方に在る事
"""
import datetime
import os
import sqlite3
import tempfile

import pytest

from app import models
from app.mcp_server import get_meeting_minutes


@pytest.fixture(autouse=True)
def setup_readonly_env():
    if not os.environ.get("SCORE_READONLY_TOKEN"):
        os.environ["SCORE_READONLY_TOKEN"] = "test_readonly_token_abc"
    yield


@pytest.fixture
def readonly_headers():
    return {"X-Readonly-Token": os.environ.get("SCORE_READONLY_TOKEN") or "test_readonly_token_abc"}


@pytest.fixture
def mcp_db(db, monkeypatch):
    monkeypatch.setattr("app.mcp_server.SessionLocal", lambda: db)
    monkeypatch.setattr(db, "close", lambda: None)
    return db


def _project(db, name="P"):
    p = models.Project(name=name, display_status="online")
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _meeting(db, project, title, dt):
    m = models.Meeting(project_id=project.id, title=title, date=dt, status="completed")
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def _seed_69(db):
    """ローカル写しの実測(会議69件・複数案件)を模す。最古の1件が「目的の会議」。"""
    projects = [_project(db, f"案件{i}") for i in range(3)]
    base = datetime.datetime(2026, 9, 24, 10, 0, 0)
    target = _meeting(db, projects[2], "カラーグレーディング方針打合せ", base - datetime.timedelta(days=200))
    for i in range(68):
        _meeting(db, projects[i % 3], f"定例会議 第{i}回", base - datetime.timedelta(days=i))
    return projects, target


# ── 49/69 の再現と、絞り込みで直る事 ─────────────────────────────

def test_default_call_misses_49_of_69_and_title_filter_fixes_it(mcp_db, client, readonly_headers):
    projects, target = _seed_69(mcp_db)
    assert mcp_db.query(models.Meeting).count() == 69

    # 再現: MCP 既定(limit=20)では 69件中 49件が返らず、目的の会議も返らぬ
    res = get_meeting_minutes()
    assert res["total"] == 69
    assert len(res["items"]) == 20
    assert 69 - len(res["items"]) == 49
    assert target.id not in [m["id"] for m in res["items"]]

    # 案件も指定せず題名の一部で引ける(MCP)
    res = get_meeting_minutes(title="グレーディング")
    assert res["total"] == 1
    assert [m["id"] for m in res["items"]] == [target.id]
    assert res["limit"] == 20  # 既定 limit は不変

    # 同じ事が読取APIでも言える(先方の頁幅20で頁送りせず1頁目だけ見る呼び方)
    r = client.get("/api/readonly/meetings?limit=20", headers=readonly_headers)
    assert r.status_code == 200 and r.json()["total"] == 69
    assert target.id not in [m["id"] for m in r.json()["items"]]
    r = client.get("/api/readonly/meetings?limit=20&title=グレーディング", headers=readonly_headers)
    assert r.status_code == 200
    assert [m["id"] for m in r.json()["items"]] == [target.id]
    assert r.json()["total"] == 1


def test_title_partial_match_case_insensitive_readonly_and_mcp(mcp_db, client, readonly_headers):
    p = _project(mcp_db)
    a = _meeting(mcp_db, p, "Kickoff Meeting", datetime.datetime(2026, 9, 1))
    _meeting(mcp_db, p, "週次定例", datetime.datetime(2026, 9, 2))

    r = client.get("/api/readonly/meetings?title=kickoff", headers=readonly_headers)
    assert [m["id"] for m in r.json()["items"]] == [a.id]
    assert [m["id"] for m in get_meeting_minutes(title="KICKOFF")["items"]] == [a.id]
    # 当たりが無ければ空
    assert client.get("/api/readonly/meetings?title=存在しない", headers=readonly_headers).json()["items"] == []
    assert get_meeting_minutes(title="存在しない")["items"] == []


# ── 日付範囲 ───────────────────────────────────────────────

def test_date_range_filter_excludes_out_of_range(mcp_db, client, readonly_headers):
    p = _project(mcp_db)
    d = datetime.datetime
    before = _meeting(mcp_db, p, "範囲前", d(2026, 8, 31, 23, 59, 59))
    lo = _meeting(mcp_db, p, "下限当日", d(2026, 9, 1, 0, 0, 0))
    mid = _meeting(mcp_db, p, "中間", d(2026, 9, 15, 14, 30, 0))
    hi = _meeting(mcp_db, p, "上限当日午後", d(2026, 9, 30, 15, 0, 0))
    after = _meeting(mcp_db, p, "範囲後", d(2026, 10, 1, 0, 0, 0))

    expected = [hi.id, mid.id, lo.id]  # date 降順
    r = client.get("/api/readonly/meetings?date_from=2026-09-01&date_to=2026-09-30", headers=readonly_headers)
    assert r.status_code == 200
    ids = [m["id"] for m in r.json()["items"]]
    assert ids == expected  # 上限が日付のみなら当日末まで含む
    assert before.id not in ids and after.id not in ids
    assert r.json()["total"] == 3

    res = get_meeting_minutes(date_from="2026-09-01", date_to="2026-09-30")
    assert [m["id"] for m in res["items"]] == expected
    assert res["total"] == 3

    # 片側のみ
    assert [m["id"] for m in get_meeting_minutes(date_from="2026-09-30")["items"]] == [after.id, hi.id]
    assert [m["id"] for m in get_meeting_minutes(date_to="2026-08-31")["items"]] == [before.id]
    # 時刻つき上限は時刻どおり
    res = get_meeting_minutes(date_from="2026-09-01", date_to="2026-09-30T12:00:00")
    assert [m["id"] for m in res["items"]] == [mid.id, lo.id]


def test_date_and_title_and_project_combine(mcp_db, client, readonly_headers):
    p1, p2 = _project(mcp_db, "A"), _project(mcp_db, "B")
    t = datetime.datetime(2026, 9, 10)
    hit = _meeting(mcp_db, p1, "編集会議", t)
    _meeting(mcp_db, p2, "編集会議", t)  # 別案件
    _meeting(mcp_db, p1, "編集会議", datetime.datetime(2026, 1, 1))  # 範囲外
    _meeting(mcp_db, p1, "音響会議", t)  # 題名違い
    q = f"project_id={p1.id}&title=編集&date_from=2026-09-01&date_to=2026-09-30"
    assert [m["id"] for m in client.get(f"/api/readonly/meetings?{q}", headers=readonly_headers).json()["items"]] == [hit.id]
    res = get_meeting_minutes(project_id=p1.id, title="編集", date_from="2026-09-01", date_to="2026-09-30")
    assert [m["id"] for m in res["items"]] == [hit.id]


def test_bad_date_is_rejected(mcp_db, client, readonly_headers):
    assert client.get("/api/readonly/meetings?date_from=昨日", headers=readonly_headers).status_code == 400
    assert client.get("/api/readonly/meetings?date_to=2026-13-45", headers=readonly_headers).status_code == 400
    assert get_meeting_minutes(date_from="昨日")["status_code"] == 400


# ── 後方互換 ───────────────────────────────────────────────

def test_backward_compatible_without_new_args(mcp_db, client, readonly_headers):
    projects, target = _seed_69(mcp_db)
    res = get_meeting_minutes()
    assert set(res.keys()) == {"total", "limit", "offset", "items"}
    assert res["total"] == 69 and res["limit"] == 20 and res["offset"] == 0 and len(res["items"]) == 20
    assert set(res["items"][0].keys()) == {
        "id", "project_id", "project_name", "title", "date", "status", "decisions", "tasks",
        "discussion_points", "deadlines", "attendees", "version_group",
    }
    res_p = get_meeting_minutes(project_id=projects[0].id)
    assert res_p["total"] == 23

    r = client.get("/api/readonly/meetings", headers=readonly_headers).json()
    # cmd_733: 返りに next_cursor 欄が増える事のみ許容(cursor 無しなら null)
    assert set(r.keys()) == {"total", "limit", "offset", "items", "next_cursor"} and r["next_cursor"] is None
    assert r["total"] == 69 and r["limit"] == 100 and len(r["items"]) == 69
    r = client.get(f"/api/readonly/meetings?project_id={projects[1].id}", headers=readonly_headers).json()
    assert r["total"] == 23 and len(r["items"]) == 23
    # updated_since は従来どおり効く
    far = (datetime.datetime.now() + datetime.timedelta(days=365)).isoformat()
    assert client.get(f"/api/readonly/meetings?updated_since={far}", headers=readonly_headers).json()["total"] == 0


# ── 全一覧の並び順 ─────────────────────────────────────────

T = datetime.datetime(2026, 9, 24, 12, 0, 0)  # 全行を同時刻にして id 決め手を試す
N = 7


def _seed_ordering(db):
    user = models.User(name="U0", email="u0@example.com", hashed_password="x", role="admin", created_at=T, updated_at=T)
    db.add(user)
    project = models.Project(name="P0", display_status="online", created_at=T, updated_at=T)
    db.add(project)
    db.commit()
    db.refresh(user)
    db.refresh(project)
    shot = models.Shot(project_id=project.id, seq_code="S", shot_code="c0", created_at=T, updated_at=T)
    db.add(shot)
    db.commit()
    db.refresh(shot)
    ctx = {"user": user.id, "project": project.id, "shot": shot.id}

    users = [models.User(name=f"U{i}", email=f"u{i}@example.com", hashed_password="x", role="member", created_at=T, updated_at=T) for i in range(1, N)]
    projects = [models.Project(name=f"P{i}", display_status="online", created_at=T, updated_at=T) for i in range(1, N)]
    db.add_all(users + projects)
    db.commit()
    shots = [models.Shot(project_id=project.id, seq_code="S", shot_code=f"c{i}", created_at=T, updated_at=T) for i in range(1, N)]
    db.add_all(shots)
    db.commit()
    for i in range(N):
        db.add(models.Task(name=f"T{i}", project_id=project.id, shot_id=shot.id, status="wip", created_at=T, updated_at=T))
        db.add(models.Event(title=f"E{i}", project_id=project.id, start_time=T, end_time=T + datetime.timedelta(hours=1),
                            type=models.EventType.MEETING if hasattr(models.EventType, "MEETING") else list(models.EventType)[0],
                            created_at=T, updated_at=T))
        db.add(models.Notification(recipient_id=user.id, type="info", body=f"n{i}", project_id=project.id, created_at=T))
        db.add(models.Meeting(project_id=project.id, title=f"M{i}", date=T, status="completed"))
        db.add(models.Retake(shot_id=shot.id, created_by=user.id, created_at=T))
        db.add(models.Asset(shot_id=shot.id, version=f"v{i}", file_path="https://example.com/a", created_by=user.id, created_at=T))
    db.commit()
    task_id = db.query(models.Task).first().id
    meeting_id = db.query(models.Meeting).first().id
    ctx["task"] = task_id
    for i in range(N):
        db.add(models.Decision(content=f"d{i}", date=T, meeting_id=meeting_id, project_id=project.id))
        db.add(models.TaskStatusHistory(task_id=task_id, status="wip", changed_at=T, changed_by=user.id))
    for i, u in enumerate(users):
        db.add(models.ScoreUserRole(user_id=u.id, project_id=project.id, role="director"))
    db.commit()
    return ctx


def _list_urls(ctx):
    return [
        "/api/readonly/projects",
        f"/api/readonly/projects/{ctx['project']}/shots",
        "/api/readonly/shots",
        f"/api/readonly/shots/{ctx['shot']}/tasks",
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


def test_all_readonly_lists_have_stable_order_and_lossless_paging(db, client, readonly_headers):
    ctx = _seed_ordering(db)
    urls = _list_urls(ctx)
    assert len(urls) == 14  # readonly.py の一覧エンドポイント全数
    for url in urls:
        first = client.get(url, headers=readonly_headers).json()
        second = client.get(url, headers=readonly_headers).json()
        ids = [i["id"] for i in first["items"]]
        assert len(ids) >= N - 1, url
        assert ids == [i["id"] for i in second["items"]], f"{url}: 同一問いで順序が変わる"
        # 全行が同時刻なので、id 降順が決め手として効いている事の証明
        assert ids == sorted(ids, reverse=True), f"{url}: id 降順になっていない"

        # 頁送り(幅2)で取り落ち・重複が無い
        paged, offset = [], 0
        while True:
            page = client.get(url, params={"limit": 2, "offset": offset}, headers=readonly_headers).json()
            got = [i["id"] for i in page["items"]]
            if not got:
                break
            paged += got
            offset += 2
        assert paged == ids, f"{url}: 頁送りで取り落ちまたは重複"
        assert len(paged) == len(set(paged)) == first["total"], url


def test_time_column_is_primary_sort_key(db, client, readonly_headers):
    p = _project(db)
    old = _meeting(db, p, "古い", datetime.datetime(2026, 1, 1))
    new = _meeting(db, p, "新しい", datetime.datetime(2026, 9, 1))
    mid = _meeting(db, p, "中", datetime.datetime(2026, 5, 1))
    ids = [m["id"] for m in client.get("/api/readonly/meetings", headers=readonly_headers).json()["items"]]
    assert ids == [new.id, mid.id, old.id]  # id ではなく時刻が主キー


def test_crud_get_events_is_ordered(db):
    from app import crud
    p = _project(db)
    et = list(models.EventType)[0]
    evs = [models.Event(title=f"e{i}", project_id=p.id, start_time=T, end_time=T + datetime.timedelta(hours=1), type=et) for i in range(5)]
    db.add_all(evs)
    db.commit()
    got = [e.id for e in crud.get_events(db, skip=0, limit=100)]
    assert got == sorted(got, reverse=True)
    paged = []
    for skip in range(0, 6, 2):
        paged += [e.id for e in crud.get_events(db, skip=skip, limit=2)]
    assert paged == got


# ── index ──────────────────────────────────────────────────

def test_meeting_date_index_in_model():
    assert models.Meeting.__table__.c.date.index is True
    assert "ix_meetings_date" in {i.name for i in models.Meeting.__table__.indexes}


def test_meeting_date_index_created_by_db_auto_migrate(monkeypatch):
    """db_auto_migrate.py 経路(既存DB・create_all では索引が付かぬ経路)で ix_meetings_date が出来る。"""
    from app import db_auto_migrate

    from sqlalchemy import create_engine
    from app.database import Base

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        fake_module_file = os.path.join(tmp, "db_auto_migrate.py")
        db_file = os.path.join(tmp, "project_management.db")
        # 実スキーマで既存DBを作り、index だけが無い旧状態にする
        eng = create_engine(f"sqlite:///{db_file}")
        Base.metadata.create_all(bind=eng)
        eng.dispose()
        conn = sqlite3.connect(db_file)
        conn.execute("DROP INDEX IF EXISTS ix_meetings_date")
        conn.commit()
        assert "ix_meetings_date" not in {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
        conn.close()

        monkeypatch.setattr(db_auto_migrate, "__file__", fake_module_file)
        db_auto_migrate.check_and_migrate_db()
        db_auto_migrate.check_and_migrate_db()  # 冪等

        conn = sqlite3.connect(db_file)
        idx = {r[0]: r[1] for r in conn.execute("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='meetings'")}
        conn.close()
    assert "ix_meetings_date" in idx
    assert "meetings(date)" in idx["ix_meetings_date"].replace(" ", "")
