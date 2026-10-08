"""cmd_731 五 / subtask_731c — 旧ステータス値の変換を監査表(audit_logs)へ残す試験。

受け入れ:
 (1) 旧い値を送ると監査行が立ち、送った値(sent)と刻まれた値(stored)の双方が判る
 (2) 既存の読取の口 GET /api/audit/logs でその行が引ける
 (3) 記録に失敗しても本処理が巻き戻らぬ
 (4) detail に PII・本文・トークンが入らぬ
"""
import json

import pytest

from app import models, schemas
from app.services import audit_service

SVC_TOKEN = "svc-token-731c"
ACTION = audit_service.STATUS_CONVERTED_ACTION


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("CALENDER_SERVICE_TOKEN", SVC_TOKEN)
    # 遷移ゲート(別件)を本試験から切り離す
    monkeypatch.setenv("TASK_TRANSITION_ENFORCE", "off")


@pytest.fixture
def admin(db):
    from app.main import app
    from app import security

    u = models.User(email="aud731c@example.com", username="aud731c", hashed_password="x", role="admin")
    db.add(u)
    db.commit()
    db.refresh(u)

    async def _override():
        return u

    app.dependency_overrides[security.get_current_user] = _override
    yield u
    app.dependency_overrides.pop(security.get_current_user, None)


def _task(db, status="wt", name="T731c"):
    p = models.Project(name="P731c", display_status="online")
    db.add(p)
    db.commit()
    db.refresh(p)
    t = models.Task(name=name, project_id=p.id, status=status)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _logs(client, since=0):
    r = client.get(f"/api/audit/logs?since={since}&limit=500",
                   headers={"Authorization": f"Bearer {SVC_TOKEN}"})
    assert r.status_code == 200, r.text
    return [e for e in r.json()["events"] if e["action"] == ACTION]


# ---------------------------------------------------------------------------
# 変換の地図名(純関数)
# ---------------------------------------------------------------------------

class TestTracedCanonicalizer:
    @pytest.mark.parametrize("raw", [
        None, "", "  ", "wip", "WIP", "qc_fb", "qc-fb", "todo", "In-Progress", "REVIEW",
        "approved", "dir_ap", "dir-ap", "modeling", "cashing", "未着手", "unknown_xyz",
    ])
    @pytest.mark.parametrize("is_csv", [False, True])
    def test_traced_result_equals_canonicalize(self, raw, is_csv):
        assert schemas.canonicalize_task_status_traced(raw, is_csv=is_csv)[0] == \
            schemas.canonicalize_task_status(raw, is_csv=is_csv)

    def test_map_names(self):
        t = schemas.canonicalize_task_status_traced
        assert t("todo") == ("mk", ["api_deprecation"])
        assert t("dir-ap") == ("ap", ["new_status_alias", "legacy_pipeline_collapse"])
        assert t("modeling") == ("wip", ["legacy_pipeline_collapse"])
        assert t("未着手", is_csv=True) == ("mk", ["csv_label"])
        assert t("wip") == ("wip", [])
        assert t("unknown_xyz") == ("unknown_xyz", [])


# ---------------------------------------------------------------------------
# (1)(2) 旧い値を送ると行が立ち、API で引ける
# ---------------------------------------------------------------------------

class TestAuditRowOnLegacyValue:
    def test_put_legacy_value_records_row_and_is_readable_via_audit_logs(self, client, db, admin):
        t = _task(db, "wt")
        resp = client.put(f"/tasks/{t.id}", json={"status": "in-progress"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "wip"

        rows = _logs(client)
        assert len(rows) == 1
        ev = rows[0]
        assert ev["target_type"] == "task" and ev["target_id"] == t.id
        assert ev["actor_uid"] == admin.id
        detail = json.loads(ev["detail"])
        assert detail["sent"] == "in-progress"      # 送られた値
        assert detail["stored"] == "wip"            # 刻まれた値
        assert detail["maps"] == ["api_deprecation"]  # 通った地図
        assert detail["source"] == "crud.update_task:manual"

        # 刻まれた値が実際に DB の値と一致する
        db.expire_all()
        assert db.get(models.Task, t.id).status.value == detail["stored"]

    def test_put_collapse_map_value_records_both_maps(self, client, db, admin):
        t = _task(db, "wt")
        resp = client.put(f"/tasks/{t.id}", json={"status": "dir-ap"})
        assert resp.status_code == 200, resp.text
        detail = json.loads(_logs(client)[0]["detail"])
        assert detail["sent"] == "dir-ap" and detail["stored"] == "ap"
        assert detail["maps"] == ["new_status_alias", "legacy_pipeline_collapse"]

    def test_put_current_value_leaves_no_row(self, client, db, admin):
        t = _task(db, "wt")
        assert client.put(f"/tasks/{t.id}", json={"status": "wip"}).status_code == 200
        assert client.put(f"/tasks/{t.id}", json={"status": "QC"}).status_code == 200  # 大文字小文字のみ
        assert _logs(client) == []

    def test_put_without_status_leaves_no_row(self, client, db, admin):
        t = _task(db, "wt")
        assert client.put(f"/tasks/{t.id}", json={"name": "renamed"}).status_code == 200
        assert _logs(client) == []

    def test_unknown_value_is_rejected_and_not_recorded(self, client, db, admin):
        """自由入力(未知の語)は監査に載せぬ=本文・PII・トークンの混入口を閉じる。"""
        t = _task(db, "wt")
        resp = client.put(f"/tasks/{t.id}", json={"status": "tanaka-taro@example.com Bearer sk-secret-123"})
        assert resp.status_code == 422
        assert _logs(client) == []

    def test_bulk_update_records_one_row_per_task(self, client, db, admin):
        t1 = _task(db, "wt", "B1")
        t2 = _task(db, "wt", "B2")
        resp = client.post("/tasks/bulk-update", json={"task_ids": [t1.id, t2.id], "status": "review"})
        assert resp.status_code == 200, resp.text
        rows = _logs(client)
        assert sorted(r["target_id"] for r in rows) == sorted([t1.id, t2.id])
        for r in rows:
            d = json.loads(r["detail"])
            assert (d["sent"], d["stored"]) == ("review", "qc")
            assert d["source"] == "crud.update_task:bulk_update"
            assert r["actor_uid"] == admin.id

    def test_mcp_change_source_is_distinguished(self, db, admin):
        from app import crud
        t = _task(db, "wt")
        crud.update_task(db, t, schemas.TaskUpdate(status="retake"), actor_id=admin.id,
                         change_source=models.TaskChangeSource.MCP)
        rows = db.query(models.AuditLog).filter(models.AuditLog.action == ACTION).all()
        assert len(rows) == 1
        d = json.loads(rows[0].detail)
        assert (d["sent"], d["stored"], d["source"]) == ("retake", "qc_fb", "crud.update_task:mcp")

    def test_create_with_legacy_value_records_row(self, db):
        from app import crud
        p = models.Project(name="PC731c", display_status="online")
        db.add(p)
        db.commit()
        db.refresh(p)
        created = crud.create_task(db, schemas.TaskCreate(name="C1", project_id=p.id, status="todo"))
        assert created.status.value == "mk"
        rows = db.query(models.AuditLog).filter(models.AuditLog.action == ACTION).all()
        assert len(rows) == 1
        assert rows[0].target_id == created.id
        d = json.loads(rows[0].detail)
        assert (d["sent"], d["stored"], d["source"]) == ("todo", "mk", "crud.create_task")


# ---------------------------------------------------------------------------
# (3) 記録に失敗しても本処理が巻き戻らぬ
# ---------------------------------------------------------------------------

class TestAuditFailureDoesNotRollBack:
    def test_record_commit_failure_keeps_main_change(self, client, db, admin, monkeypatch):
        """監査行の flush が DB 制約で落ちる(=record_event 内の commit 失敗)場合でも、
        本処理(status 更新)は永続し、応答は 200、後続の DB 操作も生きている。"""
        t = _task(db, "wt")

        def _bad_auditlog(**kw):
            if kw.get("action") == ACTION:
                kw["action"] = None  # NOT NULL 違反 → commit で失敗(変換記録だけを落とす)
            return models.AuditLog(**kw)

        monkeypatch.setattr(audit_service, "AuditLog", _bad_auditlog)
        resp = client.put(f"/tasks/{t.id}", json={"status": "todo"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "mk"

        db.expire_all()
        assert db.get(models.Task, t.id).status.value == "mk"           # 本処理は永続
        assert db.query(models.AuditLog).filter(models.AuditLog.action == ACTION).count() == 0
        # セッションが壊れたまま残らぬ: 直後にルータが立てる task.update の行は通っている
        assert db.query(models.AuditLog).filter(models.AuditLog.action == "task.update").count() == 1

        # 続く更新・記録も通る
        monkeypatch.undo()
        monkeypatch.setenv("CALENDER_SERVICE_TOKEN", SVC_TOKEN)
        monkeypatch.setenv("TASK_TRANSITION_ENFORCE", "off")
        assert client.put(f"/tasks/{t.id}", json={"status": "in_progress"}).status_code == 200
        assert len(_logs(client)) == 1

    def test_helper_exception_is_swallowed(self, client, db, admin, monkeypatch):
        t = _task(db, "wt")

        def _boom(*a, **kw):
            raise RuntimeError("audit exploded")

        monkeypatch.setattr(audit_service, "record_event", _boom)
        resp = client.put(f"/tasks/{t.id}", json={"status": "todo"})
        assert resp.status_code == 200, resp.text
        db.expire_all()
        assert db.get(models.Task, t.id).status.value == "mk"


# ---------------------------------------------------------------------------
# (4) detail に PII・本文・トークンが入らぬ
# ---------------------------------------------------------------------------

class TestNoSensitiveDataInDetail:
    def test_detail_has_only_whitelisted_keys_and_no_payload_text(self, client, db, admin):
        t = _task(db, "wt", name="極秘案件名-田中太郎")
        resp = client.put(f"/tasks/{t.id}", json={
            "status": "todo",
            "name": "田中太郎の個人案件",
            "description": "連絡先 tanaka-taro@example.com 090-1234-5678 token=sk-abc123SECRET",
        })
        assert resp.status_code == 200, resp.text
        ev = _logs(client)[0]
        detail = json.loads(ev["detail"])
        assert set(detail.keys()) == {"sent", "stored", "maps", "source"}
        blob = json.dumps(ev, ensure_ascii=False)
        for needle in ("田中", "tanaka", "090-", "sk-abc123", "SECRET", "極秘", SVC_TOKEN, "Bearer", "@"):
            assert needle not in blob, needle
        # 値は固定語彙のみ
        assert detail["sent"] == "todo" and detail["stored"] == "mk"

    def test_sent_value_is_length_capped(self, db):
        """万一長い語が入っても上限で切る(地図に載る語彙+空白のみが通る)。"""
        t = _task(db, "wt")
        audit_service.record_status_conversion(
            db, "todo" + " " * 500, task_id=t.id, actor_uid=None, source="unit")
        row = db.query(models.AuditLog).filter(models.AuditLog.action == ACTION).one()
        assert len(json.loads(row.detail)["sent"]) <= 40
