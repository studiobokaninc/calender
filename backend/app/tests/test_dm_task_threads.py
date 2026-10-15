"""cmd_735: タスク別DMスレッド(task_dm_threads 対応表)の試験 (T1〜T9)。"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from jose import jwt

from app import models
from app.crud import tasks as crud_tasks
from app.crud.tasks import _resolve_dm_thread_id, _resolve_task_dm_thread_id
from app.database import Base
from app.security import SECRET_KEY, ALGORITHM, get_password_hash


def make_token(email: str) -> str:
    return jwt.encode({"sub": email}, SECRET_KEY, algorithm=ALGORITHM)


def _headers(user) -> dict:
    return {"Authorization": f"Bearer {make_token(user.email)}"}


@pytest.fixture
def users(db: Session):
    admin = models.User(username="tdm_admin", email="tdm_admin@example.com",
                        hashed_password=get_password_hash("pw"), role="admin")
    others = [
        models.User(username=f"tdm_u{i}", email=f"tdm_u{i}@example.com",
                    hashed_password=get_password_hash("pw"), role="user")
        for i in range(1, 5)
    ]
    db.add_all([admin] + others)
    db.commit()
    for u in [admin] + others:
        db.refresh(u)
    return admin, others


@pytest.fixture
def proj(db: Session):
    p = models.Project(name="TDM Proj", status=models.ProjectStatus.PLANNING)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _task(db: Session, proj, name: str, thread_id=None):
    t = models.Task(name=name, project_id=proj.id, thread_id=thread_id)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _post_thread(client: TestClient, admin, participants, task_id=None):
    body = {"participant_ids": participants}
    if task_id is not None:
        body["task_id"] = task_id
    resp = client.post("/api/dm/threads", json=body, headers=_headers(admin))
    assert resp.status_code == 201, resp.text
    return resp.json()["thread_id"]


def _dtp_count(db: Session, tid: int) -> int:
    return db.query(models.DmThreadParticipant).filter(
        models.DmThreadParticipant.thread_id == tid).count()


def _started_count(db: Session, tid: int) -> int:
    return db.query(models.DirectMessage).filter(
        models.DirectMessage.thread_id == tid,
        models.DirectMessage.body == "Thread started.").count()


# ---- T1 同顔ぶれ(2人・3人)で task A/B → 別ID ----
@pytest.mark.parametrize("n_participants", [2, 3])
def test_t1_same_participants_different_tasks_get_distinct_threads(
        client, db, users, proj, n_participants):
    admin, others = users
    pids = [u.id for u in others[:n_participants]]
    ta, tb = _task(db, proj, "A"), _task(db, proj, "B")

    tid_a = _post_thread(client, admin, pids, ta.id)
    tid_b = _post_thread(client, admin, pids, tb.id)

    assert tid_a != tid_b
    assert tid_a >= 10000000 and tid_b >= 10000000
    assert _dtp_count(db, tid_a) == n_participants
    assert _dtp_count(db, tid_b) == n_participants
    assert db.query(models.TaskDmThread).count() == 2
    db.expire_all()
    assert db.get(models.Task, ta.id).thread_id == tid_a
    assert db.get(models.Task, tb.id).thread_id == tid_b


# ---- T2 同task_id二度 → 同ID・増えない ----
def test_t2_same_task_twice_is_idempotent(client, db, users, proj):
    admin, others = users
    pids = [others[0].id, others[1].id, others[2].id]
    t = _task(db, proj, "A")

    first = _post_thread(client, admin, pids, t.id)
    dtp_before = db.query(models.DmThreadParticipant).count()
    second = _post_thread(client, admin, pids, t.id)

    assert first == second
    assert db.query(models.DmThreadParticipant).count() == dtp_before
    assert db.query(models.TaskDmThread).count() == 1
    assert _started_count(db, first) == 1


# ---- T3 task無し2人 → min*10000+max (task スレッド作成の前後とも) ----
def test_t3_two_party_without_task_keeps_pair_rule(client, db, users, proj):
    admin, others = users
    a, b = others[0].id, others[1].id
    expected = min(a, b) * 10000 + max(a, b)

    assert _post_thread(client, admin, [a, b]) == expected

    t = _task(db, proj, "A")
    task_tid = _post_thread(client, admin, [a, b], t.id)
    assert task_tid != expected and task_tid >= 10000000

    assert _post_thread(client, admin, [a, b]) == expected


# ---- T4 task無し3人 / task先後でも混入しない ----
def test_t4_three_party_without_task_not_polluted_by_task_thread(client, db, users, proj):
    admin, others = users
    pids = [u.id for u in others[:3]]
    t = _task(db, proj, "A")

    x = _post_thread(client, admin, pids)
    y = _post_thread(client, admin, pids, t.id)
    assert y != x
    assert _post_thread(client, admin, pids) == x


def test_t4_task_first_then_taskless_does_not_return_task_thread(client, db, users, proj):
    admin, others = users
    pids = [u.id for u in others[:3]]
    t = _task(db, proj, "A")

    y = _post_thread(client, admin, pids, t.id)
    x = _post_thread(client, admin, pids)
    assert x != y
    assert db.query(models.TaskDmThread).filter(
        models.TaskDmThread.thread_id == x).count() == 0
    assert _post_thread(client, admin, pids) == x


# ---- T5 既存共用スレッド S の task A を専用へ切替。S と B は不変 ----
def test_t5_existing_shared_thread_switches_to_dedicated(client, db, users, proj):
    admin, others = users
    pids = [u.id for u in others[:3]]
    shared = _resolve_dm_thread_id(db, pids)
    db.add(models.DirectMessage(thread_id=shared, sender_id=pids[0],
                                recipient_id=pids[1], body="old conversation"))
    db.commit()
    ta = _task(db, proj, "A", thread_id=shared)
    tb = _task(db, proj, "B", thread_id=shared)

    dtp_rows = _dtp_count(db, shared)
    dm_rows = db.query(models.DirectMessage).filter(
        models.DirectMessage.thread_id == shared).count()

    new_tid = _post_thread(client, admin, pids, ta.id)

    assert new_tid != shared and new_tid >= 10000000
    db.expire_all()
    assert db.get(models.Task, ta.id).thread_id == new_tid
    assert db.get(models.Task, tb.id).thread_id == shared
    assert _dtp_count(db, shared) == dtp_rows
    msgs = db.query(models.DirectMessage).filter(
        models.DirectMessage.thread_id == shared).all()
    assert len(msgs) == dm_rows
    assert [m.body for m in msgs] == ["old conversation"]


# ---- T6 存在しない task_id → task無しと同結果・対応表に行なし ----
def test_t6_unknown_task_id_falls_back_to_legacy(client, db, users):
    admin, others = users
    a, b = others[0].id, others[1].id
    tid = _post_thread(client, admin, [a, b], task_id=999999)
    assert tid == min(a, b) * 10000 + max(a, b)
    assert db.query(models.TaskDmThread).count() == 0

    pids = [u.id for u in others[:3]]
    tid3 = _post_thread(client, admin, pids, task_id=999999)
    assert tid3 == _post_thread(client, admin, pids)
    assert db.query(models.TaskDmThread).count() == 0


# ---- T7 競合 ----
def test_t7_existing_row_returns_existing_thread(db, users, proj):
    _, others = users
    pids = [others[0].id, others[1].id]
    t = _task(db, proj, "A")
    db.add(models.TaskDmThread(task_id=t.id, thread_id=12345678))
    db.commit()

    assert _resolve_task_dm_thread_id(db, pids, t.id) == 12345678
    assert db.query(models.DmThreadParticipant).count() == 0


def test_t7_integrity_error_path_returns_winner_id(db, users, proj, monkeypatch):
    _, others = users
    pids = [others[0].id, others[1].id]
    t = _task(db, proj, "A")
    winner = 12345678
    db.add(models.TaskDmThread(task_id=t.id, thread_id=winner))
    db.commit()

    real_query = db.query
    calls = {"n": 0}

    class _Blind:
        """初回の対応表検索だけ『無し』を見せる(競合の敗者の視点)。"""
        def filter(self, *a, **k):
            return self

        def first(self):
            return None

    def fake_query(*entities, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            return _Blind()
        return real_query(*entities, **kw)

    monkeypatch.setattr(db, "query", fake_query)

    assert _resolve_task_dm_thread_id(db, pids, t.id) == winner
    monkeypatch.undo()
    # 敗者の DTP 行は rollback で巻き戻っている
    assert db.query(models.DmThreadParticipant).count() == 0
    assert db.query(models.TaskDmThread).count() == 1


# ---- T8 2人タスクスレッドの送受信・一覧・既読 ----
def test_t8_two_party_task_thread_messaging(client, db, users, proj):
    admin, others = users
    u1, u2, u3 = others[0], others[1], others[2]
    t = _task(db, proj, "A")
    tid = _post_thread(client, admin, [u1.id, u2.id], t.id)
    assert tid >= 10000000

    # 送信(thread_id 指定)
    resp = client.post("/api/dm", json={"thread_id": tid, "body": "hello task"},
                       headers=_headers(u1))
    assert resp.status_code == 201, resp.text
    assert resp.json()["thread_id"] == tid

    # 一覧に2名で出る
    resp = client.get("/api/me/dm/threads", headers=_headers(u2))
    assert resp.status_code == 200
    entry = [x for x in resp.json() if x["thread_id"] == tid]
    assert len(entry) == 1
    assert {p["user_id"] for p in entry[0]["participants"]} == {u1.id, u2.id}

    # messages / read が参加者判定を通る
    resp = client.get(f"/api/dm/threads/{tid}/messages", headers=_headers(u2))
    assert resp.status_code == 200
    assert "hello task" in [m["body"] for m in resp.json()]

    resp = client.post(f"/api/dm/threads/{tid}/read", headers=_headers(u2))
    assert resp.status_code == 200
    assert resp.json()["read_count"] >= 1

    # 非参加者は拒否
    assert client.get(f"/api/dm/threads/{tid}/messages",
                      headers=_headers(u3)).status_code == 403
    assert client.post("/api/dm", json={"thread_id": tid, "body": "x"},
                       headers=_headers(u3)).status_code == 403


# ---- T9 DDL: 一時ファイル SQLite へ create_all ----
def _pk_cols(conn):
    rows = conn.execute(text("PRAGMA table_info(task_dm_threads)")).fetchall()
    return {r[1] for r in rows if r[5]}


def _unique_index_cols(conn):
    cols = []
    for idx in conn.execute(text("PRAGMA index_list(task_dm_threads)")).fetchall():
        if idx[2]:  # unique
            info = conn.execute(text(f"PRAGMA index_info('{idx[1]}')")).fetchall()
            cols.append({i[2] for i in info})
    return cols


def test_t9_ddl_pk_and_unique_on_file_sqlite(tmp_path):
    eng = create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    try:
        Base.metadata.create_all(bind=eng)
        with eng.connect() as conn:
            assert _pk_cols(conn) == {"task_id"}
            assert {"thread_id"} in _unique_index_cols(conn)

        with eng.begin() as conn:
            conn.execute(text("INSERT INTO task_dm_threads (task_id, thread_id) VALUES (1, 10000001)"))
        with pytest.raises(IntegrityError):
            with eng.begin() as conn:
                conn.execute(text("INSERT INTO task_dm_threads (task_id, thread_id) VALUES (1, 10000002)"))
        with pytest.raises(IntegrityError):
            with eng.begin() as conn:
                conn.execute(text("INSERT INTO task_dm_threads (task_id, thread_id) VALUES (2, 10000001)"))
    finally:
        eng.dispose()


def test_t9_create_all_adds_table_to_existing_db(tmp_path):
    eng = create_engine(f"sqlite:///{tmp_path / 'existing.db'}")
    try:
        others = [t for t in Base.metadata.sorted_tables if t.name != "task_dm_threads"]
        Base.metadata.create_all(bind=eng, tables=others)
        with eng.connect() as conn:
            names = {r[0] for r in conn.execute(
                text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()}
        assert "task_dm_threads" not in names
        assert "dm_thread_participants" in names

        Base.metadata.create_all(bind=eng)  # 起動時 create_all と同経路
        with eng.connect() as conn:
            assert _pk_cols(conn) == {"task_id"}
            assert {"thread_id"} in _unique_index_cols(conn)
    finally:
        eng.dispose()
