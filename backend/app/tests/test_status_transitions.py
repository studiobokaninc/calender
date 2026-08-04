"""subtask_681b の動作確認テスト（遷移グラフ撤去版）。"""
import os

import pytest

from app import models, status_transitions as st
from app.schemas import canonicalize_task_status


# ---------------------------------------------------------------------------
# 1. 純関数ロジック (DB不要)
# ---------------------------------------------------------------------------

class TestPureTransitionLogic:
    def test_role_check_is_case_and_whitespace_insensitive(self):
        """F681-2/F682a: 本番DBのrole値が'PM'/' Pm '等の表記ゆれでも正しく判定される。"""
        assert st.explain_transition("qc", "client_ap", actor_role="PM") is None
        assert st.explain_transition("qc", "client_ap", actor_role=" Director ") is None
        body = st.explain_transition("qc", "client_ap", actor_role="COMPOSITOR")
        assert body["error"] == "role_not_permitted"

    def test_normalize_role_absorbs_notation_variants(self):
        assert st.normalize_role("director") == "director"
        assert st.normalize_role("Director") == "director"
        assert st.normalize_role(" DIRECTOR ") == "director"
        assert st.normalize_role("ディレクター") == "director"
        assert st.normalize_role("制作") == "pm"
        assert st.normalize_role("PM") == "pm"
        assert st.normalize_role("アーティスト") == "artist"
        assert st.normalize_role("artist") == "artist"
        assert st.normalize_role("Artist") == "artist"
        assert st.normalize_role("lighting_lead") == "lead"
        assert st.normalize_role("Lighting-Lead") == "lead"
        assert st.normalize_role(None) is None
        assert st.normalize_role("") is None
        assert st.normalize_role("   ") is None

    def test_unknown_role_is_rejected_and_reported_recognized_false(self):
        assert st.normalize_role("intern") is None
        body = st.explain_transition("qc", "client_ap", actor_role="intern")
        assert body["error"] == "role_not_permitted"
        assert body["actor_role_recognized"] is False
        assert set(body["recognized_roles"]) == {"artist", "compositor", "director", "lead", "pm"}

    def test_invalid_status_value(self):
        body = st.explain_transition("qc", "not_a_status")
        assert body["error"] == "invalid_status"
        assert body["http_status"] == 422

    def test_default_enforce_mode_is_on(self):
        os.environ.pop("TASK_TRANSITION_ENFORCE", None)
        assert st.get_enforce_mode() == "on"

    def test_explain_assignee_change(self):
        assert st.explain_assignee_change("lead") is None
        assert st.explain_assignee_change("director") is None
        assert st.explain_assignee_change("PM") is None
        body = st.explain_assignee_change("compositor")
        assert body["error"] == "role_not_permitted"
        assert body["required_role"] == "lead_or_above"
        assert body["action"] == "assignee_change"
        body_none = st.explain_assignee_change(None)
        assert body_none["error"] == "role_not_permitted"

    def test_null_status_is_treated_as_mk(self):
        # status未設定は'mk'扱いとなり、無資格での移行が検知される
        body = st.explain_transition(None, "completed", actor_role="compositor")
        assert body["error"] == "role_not_permitted"
        assert body["required_role"] == "pm_or_above"
        assert st.explain_transition(None, "completed", actor_role="pm") is None


# ---------------------------------------------------------------------------
# 2. crud.update_task 経由 (DB込み・warn既定・on切替)
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_enforce_env():
    original = os.environ.get("TASK_TRANSITION_ENFORCE")
    yield
    if original is None:
        os.environ.pop("TASK_TRANSITION_ENFORCE", None)
    else:
        os.environ["TASK_TRANSITION_ENFORCE"] = original


def _make_project_task(db, status="qc"):
    from app import crud
    project = models.Project(name="TransitionTestProject", display_status="online")
    db.add(project)
    db.commit()
    db.refresh(project)
    task = models.Task(name="T", project_id=project.id, status=status)
    db.add(task)
    db.commit()
    db.refresh(task)
    return project, task


class TestUpdateTaskEnforcement:
    def test_warn_mode_does_not_block_role_insufficient_transition(self, db):
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "warn"
        project, task = _make_project_task(db, status="qc")
        # pm_or_above 必要な client_ap への遷移を compositor が実行
        user = models.User(email="c1@example.com", username="c1", hashed_password="x", role="user")
        db.add(user); db.commit(); db.refresh(user)
        db.add(models.ScoreUserRole(user_id=user.id, project_id=project.id, role="compositor"))
        db.commit()

        updated = crud.update_task(db, task, schemas.TaskUpdate(status="client_ap"), actor_id=user.id)
        assert updated.status.value == "client_ap"
        assert updated.warnings is not None
        assert updated.warnings[0]["error"] == "role_not_permitted"

    def test_on_mode_blocks_role_insufficient_transition_with_no_side_effects(self, db):
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="qc")
        user = models.User(email="c2@example.com", username="c2", hashed_password="x", role="user")
        db.add(user); db.commit(); db.refresh(user)
        db.add(models.ScoreUserRole(user_id=user.id, project_id=project.id, role="compositor"))
        db.commit()

        original_progress = task.progress
        with pytest.raises(st.TransitionError) as excinfo:
            crud.update_task(db, task, schemas.TaskUpdate(status="client_ap"), actor_id=user.id)
        assert excinfo.value.body["error"] == "role_not_permitted"
        db.refresh(task)
        assert task.status.value == "qc"
        assert task.progress == original_progress

    def test_on_mode_allows_legal_role_transition(self, db):
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="qc")
        pm = models.User(email="pm1@example.com", username="pm1", hashed_password="x", role="user")
        db.add(pm); db.commit(); db.refresh(pm)
        db.add(models.ScoreUserRole(user_id=pm.id, project_id=project.id, role="pm"))
        db.commit()

        updated = crud.update_task(db, task, schemas.TaskUpdate(status="client_ap"), actor_id=pm.id)
        assert updated.status.value == "client_ap"

    def test_on_mode_admin_without_role_allowed(self, db):
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="qc")
        admin = models.User(email="a1@example.com", username="a1", hashed_password="x", role="admin")
        db.add(admin); db.commit(); db.refresh(admin)

        updated = crud.update_task(db, task, schemas.TaskUpdate(status="client_ap"), actor_id=admin.id)
        assert updated.status.value == "client_ap"

    def test_on_mode_admin_with_role_allowed(self, db):
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="qc")
        admin = models.User(email="a2@example.com", username="a2", hashed_password="x", role="admin")
        db.add(admin); db.commit(); db.refresh(admin)
        db.add(models.ScoreUserRole(user_id=admin.id, project_id=project.id, role="pm"))
        db.commit()

        updated = crud.update_task(db, task, schemas.TaskUpdate(status="client_ap"), actor_id=admin.id)
        assert updated.status.value == "client_ap"

    def test_who_can_do_this_populated_from_score_user_roles(self, db):
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="qc")
        pm_user = models.User(email="pm2@example.com", username="pm2", hashed_password="x", role="user")
        actor = models.User(email="comp1@example.com", username="comp1", hashed_password="x", role="user")
        db.add_all([pm_user, actor])
        db.commit()
        db.refresh(pm_user)
        db.refresh(actor)
        db.add(models.ScoreUserRole(user_id=pm_user.id, project_id=project.id, role="pm"))
        db.add(models.ScoreUserRole(user_id=actor.id, project_id=project.id, role="compositor"))
        db.commit()

        with pytest.raises(st.TransitionError) as excinfo:
            crud.update_task(db, task, schemas.TaskUpdate(status="client_ap"), actor_id=actor.id)
        who = excinfo.value.body["who_can_do_this"]
        assert any(w["username"] == "pm2" and w["role"] == "pm" for w in who)


class TestAssigneeChangeGate:
    def test_on_mode_blocks_assignee_change_below_lead(self, db):
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="mk")
        actor = models.User(email="comp2@example.com", username="comp2", hashed_password="x", role="user")
        target = models.User(email="target1@example.com", username="target1", hashed_password="x", role="user")
        db.add_all([actor, target])
        db.commit()
        db.refresh(actor)
        db.refresh(target)
        db.add(models.ScoreUserRole(user_id=actor.id, project_id=project.id, role="compositor"))
        db.commit()

        with pytest.raises(st.TransitionError) as excinfo:
            crud.update_task(db, task, schemas.TaskUpdate(assigned_to=target.id), actor_id=actor.id)
        assert excinfo.value.body["error"] == "role_not_permitted"
        assert excinfo.value.body["required_role"] == "lead_or_above"
        db.refresh(task)
        assert task.assigned_to is None

    def test_on_mode_allows_assignee_change_for_lead(self, db):
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="mk")
        actor = models.User(email="lead1@example.com", username="lead1", hashed_password="x", role="user")
        target = models.User(email="target2@example.com", username="target2", hashed_password="x", role="user")
        db.add_all([actor, target])
        db.commit()
        db.refresh(actor)
        db.refresh(target)
        db.add(models.ScoreUserRole(user_id=actor.id, project_id=project.id, role="lead"))
        db.commit()

        updated = crud.update_task(db, task, schemas.TaskUpdate(assigned_to=target.id), actor_id=actor.id)
        assert updated.assigned_to == target.id

    def test_on_mode_admin_without_role_allows_assignee_gate(self, db):
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="mk")
        admin = models.User(email="assignadmin@example.com", username="assignadmin", hashed_password="x", role="admin")
        target = models.User(email="target3@example.com", username="target3", hashed_password="x", role="user")
        db.add_all([admin, target])
        db.commit()
        db.refresh(admin)
        db.refresh(target)

        updated = crud.update_task(db, task, schemas.TaskUpdate(assigned_to=target.id), actor_id=admin.id)
        assert updated.assigned_to == target.id

    def test_on_mode_admin_with_role_allows_assignee_gate(self, db):
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="mk")
        admin = models.User(email="assignadmin2@example.com", username="assignadmin2", hashed_password="x", role="admin")
        target = models.User(email="target3_2@example.com", username="target3_2", hashed_password="x", role="user")
        db.add_all([admin, target])
        db.commit()
        db.refresh(admin)
        db.refresh(target)
        db.add(models.ScoreUserRole(user_id=admin.id, project_id=project.id, role="lead"))
        db.commit()

        updated = crud.update_task(db, task, schemas.TaskUpdate(assigned_to=target.id), actor_id=admin.id)
        assert updated.assigned_to == target.id

    def test_default_on_mode_blocks_assignee_change(self, db):
        from app import crud, schemas
        os.environ.pop("TASK_TRANSITION_ENFORCE", None)
        project, task = _make_project_task(db, status="mk")
        actor = models.User(email="comp3@example.com", username="comp3", hashed_password="x", role="user")
        target = models.User(email="target4@example.com", username="target4", hashed_password="x", role="user")
        db.add_all([actor, target])
        db.commit()
        db.refresh(actor)
        db.refresh(target)
        db.add(models.ScoreUserRole(user_id=actor.id, project_id=project.id, role="compositor"))
        db.commit()

        with pytest.raises(st.TransitionError) as excinfo:
            crud.update_task(db, task, schemas.TaskUpdate(assigned_to=target.id), actor_id=actor.id)
        assert excinfo.value.body["error"] == "role_not_permitted"

    def test_warn_mode_explicit_does_not_block_assignee_change(self, db):
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "warn"
        project, task = _make_project_task(db, status="mk")
        actor = models.User(email="comp3_2@example.com", username="comp3_2", hashed_password="x", role="user")
        target = models.User(email="target4_2@example.com", username="target4_2", hashed_password="x", role="user")
        db.add_all([actor, target])
        db.commit()
        db.refresh(actor)
        db.refresh(target)
        db.add(models.ScoreUserRole(user_id=actor.id, project_id=project.id, role="compositor"))
        db.commit()

        updated = crud.update_task(db, task, schemas.TaskUpdate(assigned_to=target.id), actor_id=actor.id)
        assert updated.assigned_to == target.id
        assert updated.warnings is not None
        assert any(
            w["error"] == "role_not_permitted" and w.get("action") == "assignee_change"
            for w in updated.warnings
        )

    def test_no_change_does_not_trigger_gate(self, db):
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="mk")
        actor = models.User(email="comp5@example.com", username="comp5", hashed_password="x", role="user")
        db.add(actor); db.commit(); db.refresh(actor)
        db.add(models.ScoreUserRole(user_id=actor.id, project_id=project.id, role="compositor"))
        db.commit()

        updated = crud.update_task(db, task, schemas.TaskUpdate(name="renamed only"), actor_id=actor.id)
        assert updated.name == "renamed only"


class TestBulkUpdateAllOrNothing:
    def test_bulk_update_on_mode_all_or_nothing(self, db):
        from app import crud
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task_ok = _make_project_task(db, status="qc")
        task_ng = models.Task(name="NG", project_id=project.id, status="qc")
        db.add(task_ng); db.commit(); db.refresh(task_ng)

        # compositor が pm_or_above 必要な client_ap への一括更新を試みる
        actor = models.User(email="comp6@example.com", username="comp6", hashed_password="x", role="user")
        db.add(actor); db.commit(); db.refresh(actor)
        db.add(models.ScoreUserRole(user_id=actor.id, project_id=project.id, role="compositor"))
        db.commit()

        with pytest.raises(st.TransitionError) as excinfo:
            crud.bulk_update_tasks(db, [task_ok.id, task_ng.id], {"status": "client_ap"}, actor_id=actor.id)
        assert excinfo.value.body["error"] == "bulk_illegal_transition"
        db.refresh(task_ok)
        db.refresh(task_ng)
        assert task_ok.status.value == "qc"
        assert task_ng.status.value == "qc"


# ---------------------------------------------------------------------------
# 3. HTTP経由 (routers/tasks.py)
# ---------------------------------------------------------------------------

@pytest.fixture
def auth_as_admin(db):
    from app.main import app
    from app import security

    admin = models.User(email="httptest-admin@example.com", username="httptest-admin", hashed_password="x", role="admin")
    db.add(admin); db.commit(); db.refresh(admin)

    async def override_get_current_user():
        return admin

    app.dependency_overrides[security.get_current_user] = override_get_current_user
    yield admin
    app.dependency_overrides.pop(security.get_current_user, None)


@pytest.fixture
def auth_as_plain_user(db):
    from app.main import app
    from app import security

    plain = models.User(email="httptest-plain@example.com", username="httptest-plain", hashed_password="x", role="user")
    db.add(plain); db.commit(); db.refresh(plain)

    async def override_get_current_user():
        return plain

    app.dependency_overrides[security.get_current_user] = override_get_current_user
    yield plain
    app.dependency_overrides.pop(security.get_current_user, None)


class TestHttpEndpoints:
    def test_task_response_does_not_include_allowed_next(self, client, db, auth_as_admin):
        project, task = _make_project_task(db, status="qc")
        resp = client.get(f"/tasks/{task.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert "allowed_next" not in data

    def test_put_task_role_insufficient_on_mode_returns_403(self, client, db, auth_as_plain_user):
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="qc")
        # score_user_role なし = compositor 以下で pm_or_above の client_ap に遷移
        resp = client.put(f"/tasks/{task.id}", json={"status": "client_ap"})
        assert resp.status_code == 403
        assert resp.json()["detail"]["error"] == "role_not_permitted"

    def test_put_task_default_on_mode_blocks_role_insufficient(self, client, db, auth_as_plain_user):
        os.environ.pop("TASK_TRANSITION_ENFORCE", None)
        project, task = _make_project_task(db, status="qc")
        resp = client.put(f"/tasks/{task.id}", json={"status": "client_ap"})
        assert resp.status_code == 403
        assert resp.json()["detail"]["error"] == "role_not_permitted"

    def test_put_task_warn_mode_explicit_does_not_block(self, client, db, auth_as_plain_user):
        os.environ["TASK_TRANSITION_ENFORCE"] = "warn"
        project, task = _make_project_task(db, status="qc")
        resp = client.put(f"/tasks/{task.id}", json={"status": "client_ap"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "client_ap"


class TestScoreApproveDirectAssignPaths:
    def test_approve_task_blocks_role_insufficient_in_on_mode(self, client, db, auth_as_plain_user):
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="qc")
        # /approve は AP への遷移を実行する。AP 遷移は pm_or_above。
        # plain ユーザーはロールが無いため 403
        resp = client.post(f"/api/tasks/{task.id}/approve")
        assert resp.status_code == 403
        assert resp.json()["detail"]["error"] == "role_not_permitted"

    def test_approve_task_allows_role_sufficient(self, client, db, auth_as_admin):
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="qc")
        # admin must have a project role now that bypass is removed
        db.add(models.ScoreUserRole(user_id=auth_as_admin.id, project_id=project.id, role="pm"))
        db.commit()
        resp = client.post(f"/api/tasks/{task.id}/approve")
        assert resp.status_code == 200
        db.refresh(task)
        assert task.status.value == "ap"

    def test_approve_task_default_on_mode_blocks_role_insufficient(self, client, db, auth_as_plain_user):
        os.environ.pop("TASK_TRANSITION_ENFORCE", None)
        project, task = _make_project_task(db, status="qc")
        resp = client.post(f"/api/tasks/{task.id}/approve")
        assert resp.status_code == 403
        assert resp.json()["detail"]["error"] == "role_not_permitted"

    def test_approve_task_warn_mode_explicit_does_not_block(self, client, db, auth_as_plain_user):
        os.environ["TASK_TRANSITION_ENFORCE"] = "warn"
        project, task = _make_project_task(db, status="qc")
        resp = client.post(f"/api/tasks/{task.id}/approve")
        assert resp.status_code == 200
        db.refresh(task)
        assert task.status.value == "ap"
