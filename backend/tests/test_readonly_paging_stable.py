"""
tests/test_readonly_paging_stable.py — cmd_730 / subtask_730a2
可変列 updated_at 主の並び順は offset 頁送りの合間の更新で重複・取り落としを生む。
作成後に動かぬ created_at(+id)主へ是正した事を、同一試験内で
 (1) 旧順序(updated_at desc, id desc)では壊れる  (2) 新順序(created_at desc, id desc)では壊れない
の対で示す。(2) は実エンドポイント GET /api/readonly/tasks を叩く。
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from app import models
from app.database import SessionLocal

TOKEN = "readonly-test-token-730a2"
LIMIT = 2
N = 6


def _seed():
    s = SessionLocal()
    try:
        p = models.Project(name="test_730a2_paging")
        s.add(p)
        s.commit()
        s.refresh(p)
        base = datetime(2026, 1, 1, 0, 0, 0)
        ids = []
        for i in range(N):
            t = models.Task(
                project_id=p.id,
                name=f"t730a2_{i}",
                created_at=base + timedelta(minutes=i),
                updated_at=base + timedelta(minutes=i),
            )
            s.add(t)
            s.commit()
            s.refresh(t)
            ids.append(t.id)
        return p.id, ids
    finally:
        s.close()


def _touch(task_id):
    s = SessionLocal()
    try:
        t = s.get(models.Task, task_id)
        t.updated_at = datetime(2026, 6, 1, 0, 0, 0)  # 最新へ跳ぶ
        s.commit()
    finally:
        s.close()


def _page_db(pid, order_cols, touch_id):
    """旧順序の再現: 同じ頁送り(limit=2)を DB 直で行い、2頁目の前に1行更新する。"""
    got = []
    for page in range(N // LIMIT):
        if page == 1:
            _touch(touch_id)
        s = SessionLocal()
        try:
            rows = (s.query(models.Task).filter(models.Task.project_id == pid)
                    .order_by(*order_cols).offset(page * LIMIT).limit(LIMIT).all())
            got += [r.id for r in rows]
        finally:
            s.close()
    return got


def _page_api(client, pid, touch_id):
    got = []
    for page in range(N // LIMIT):
        if page == 1:
            _touch(touch_id)
        r = client.get(f"/api/readonly/tasks?project_id={pid}&limit={LIMIT}&offset={page * LIMIT}",
                       headers={"Authorization": f"Bearer {TOKEN}"})
        assert r.status_code == 200, r.text
        got += [it["id"] for it in r.json()["items"]]
    return got


def test_paging_stable_under_concurrent_update(monkeypatch):
    monkeypatch.setenv("SCORE_READONLY_TOKEN", TOKEN)
    from app.main import app

    # --- 旧順序(updated_at 主): 頁送りの合間の更新で壊れる事を先に確認 ---
    pid_old, ids_old = _seed()
    old = _page_db(pid_old, [models.Task.updated_at.desc(), models.Task.id.desc()], ids_old[1])
    print("OLD_ORDER_RESULT", old)
    assert not (len(old) == len(set(old)) and set(old) == set(ids_old)), \
        f"旧順序が壊れていない(試験の前提が崩れた): {old}"

    # --- 新順序(created_at+id 主): 実エンドポイントで重複・取り落としなし ---
    pid_new, ids_new = _seed()
    with TestClient(app) as client:
        monkeypatch.setenv("SCORE_READONLY_TOKEN", TOKEN)  # lifespan の .env 読込後に再設定
        new = _page_api(client, pid_new, ids_new[1])
    assert len(new) == len(set(new)), f"重複あり: {new}"
    assert set(new) == set(ids_new), f"取り落としあり: {new}"
    assert new == sorted(ids_new, reverse=True)
