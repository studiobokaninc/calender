"""subtask_681b (cmd_681) の動作確認テスト。
CON-1〜5(gunshi_report.yaml / queue/reports/gunshi_report.yaml, task_id: subtask_681a)を
実データ(隔離インメモリSQLite, tests/conftest.py の db/client フィクスチャ)で検証する。
"""
import os

import pytest

from app import models, status_transitions as st
from app.schemas import canonicalize_task_status


# ---------------------------------------------------------------------------
# 1. 純関数ロジック (DB不要)
# ---------------------------------------------------------------------------

class TestPureTransitionLogic:
    def test_legal_transition_qc_to_ap(self):
        """qc→apはグラフ上は合法。role要求(director_or_above・★新規確定)を満たす場合のみNone。"""
        assert st.is_transition_allowed("qc", "ap") is True
        assert st.explain_transition("qc", "ap", actor_role="director") is None

    def test_illegal_transition_qc_to_deliver_includes_allowed_next_and_suggested_path(self):
        body = st.explain_transition("qc", "deliver")
        assert body["error"] == "illegal_transition"
        assert body["http_status"] == 409
        assert any(e["status"] == "ap" for e in body["allowed_next"])
        assert body["suggested_path"] == ["qc", "ap", "deliver"]

    def test_unconfirmed_transition_ap_to_qc_fb_uses_distinct_error_code(self):
        body = st.explain_transition("ap", "qc_fb")
        assert body["error"] == "transition_pending_confirmation"
        assert body["http_status"] == 409

    def test_role_insufficient_ap_to_client_ap_for_compositor(self):
        body = st.explain_transition("ap", "client_ap", actor_role="compositor")
        assert body["error"] == "role_not_permitted"
        assert body["http_status"] == 403
        assert body["required_role"] == "pm_or_above"

    def test_role_sufficient_ap_to_client_ap_for_pm(self):
        assert st.explain_transition("ap", "client_ap", actor_role="pm") is None
        assert st.explain_transition("ap", "client_ap", actor_role="director") is None

    def test_cond1_artist_band_ap_to_deliver_is_unconstrained(self):
        """COND-1(critical): アーティスト帯のap→deliverはscore_user_roles未登録者が
        大半のため絶対に役職要求を課さない(殿裁可⑥でpm_or_aboveからnull化)。"""
        assert st.explain_transition("ap", "deliver") is None
        assert st.explain_transition("ap", "deliver", actor_role="compositor") is None
        assert st.explain_transition("ap", "deliver", actor_role=None) is None
        entry = next(e for e in st.get_allowed_transitions("ap") if e["status"] == "deliver")
        assert entry["role_required"] is None
        assert entry["owner"] == "artist"
        assert entry["owner_label"] == "アーティスト"

    def test_cond1_artist_band_client_ap_to_deliver_is_unconstrained(self):
        assert st.explain_transition("client_ap", "deliver") is None
        assert st.explain_transition("client_ap", "deliver", actor_role="compositor") is None
        entry = next(e for e in st.get_allowed_transitions("client_ap") if e["status"] == "deliver")
        assert entry["role_required"] is None
        assert entry["owner"] == "artist"

    def test_role_check_is_case_and_whitespace_insensitive_f681_2(self):
        """F681-2/F682a: 本番DBのrole値が'PM'/' Pm '等の表記ゆれでも正しく判定される(normalize_role経由)。"""
        assert st.explain_transition("ap", "client_ap", actor_role="PM") is None
        assert st.explain_transition("ap", "client_ap", actor_role=" Director ") is None
        body = st.explain_transition("ap", "client_ap", actor_role="COMPOSITOR")
        assert body["error"] == "role_not_permitted"

    def test_unconfirmed_role_stays_unconstrained_con1(self):
        # CON-1/COND-1: アーティスト帯(mk→wip等)はrole_required=Noneで無制約
        allowed = st.get_allowed_transitions("mk")
        entry = next(e for e in allowed if e["status"] == "wip")
        assert entry["role_required"] is None
        assert entry["permitted_for_actor"] is True  # actor_role未指定でも通る(無制約ゆえ)
        assert entry["owner"] == "artist"

    def test_client_ap_to_qc_fb_promoted_to_confirmed(self):
        """★F682a D-4: client_ap→qc_fbはUNCONFIRMEDから確定へ昇格(pm_or_above・制作が主語)。"""
        assert st.is_transition_allowed("client_ap", "qc_fb") is True
        assert st.explain_transition("client_ap", "qc_fb", actor_role="pm") is None
        assert st.explain_transition("client_ap", "qc_fb", actor_role="director") is None
        body = st.explain_transition("client_ap", "qc_fb", actor_role="compositor")
        assert body["error"] == "role_not_permitted"
        assert body["required_role"] == "pm_or_above"
        entry = next(e for e in st.get_allowed_transitions("client_ap") if e["status"] == "qc_fb")
        assert entry["owner"] == "pm"

    def test_client_ap_to_ap_still_unconfirmed(self):
        """client_ap→qc_fbのみ確定へ昇格し、client_ap→apは未確定のまま。"""
        body = st.explain_transition("client_ap", "ap")
        assert body["error"] == "transition_pending_confirmation"

    def test_qc_to_qc_fb_and_qc_to_ap_newly_confirmed_director_gated(self):
        """★新規確定: qc→qc_fb / qc→ap はdirector_or_above。"""
        for to_status in ("qc_fb", "ap"):
            body = st.explain_transition("qc", to_status, actor_role="pm")
            assert body["error"] == "role_not_permitted"
            assert body["required_role"] == "director_or_above"
            assert st.explain_transition("qc", to_status, actor_role="director") is None

    def test_wt_to_mk_and_wip_to_mk_newly_confirmed_pm_gated(self):
        """★新規確定: wt→mk / wip→mk はpm_or_above。"""
        assert st.explain_transition("wt", "mk", actor_role="pm") is None
        body = st.explain_transition("wt", "mk", actor_role="compositor")
        assert body["error"] == "role_not_permitted"
        assert body["required_role"] == "pm_or_above"
        assert st.explain_transition("wip", "mk", actor_role="director") is None
        body2 = st.explain_transition("wip", "mk", actor_role="compositor")
        assert body2["error"] == "role_not_permitted"

    def test_normalize_role_absorbs_notation_variants(self):
        """normalize_role: 全角/半角・大文字小文字・空白・記号の表記ゆれを吸収する。"""
        assert st.normalize_role("director") == "director"
        assert st.normalize_role("Director") == "director"
        assert st.normalize_role(" DIRECTOR ") == "director"
        assert st.normalize_role("ディレクター") == "director"
        assert st.normalize_role("制作") == "pm"
        assert st.normalize_role("PM") == "pm"
        assert st.normalize_role("アーティスト") == "artist"
        assert st.normalize_role("artist") == "artist"  # F682b-2: 英字canonical keyでも通ること
        assert st.normalize_role("Artist") == "artist"
        assert st.normalize_role("lighting_lead") == "lead"
        assert st.normalize_role("Lighting-Lead") == "lead"
        assert st.normalize_role(None) is None
        assert st.normalize_role("") is None
        assert st.normalize_role("   ") is None

    def test_unknown_role_is_rejected_and_reported_recognized_false(self):
        """未知役職はゲート判定で拒否され、actor_role_recognized=falseで呼び出し側が判別できる。"""
        assert st.normalize_role("intern") is None
        body = st.explain_transition("ap", "client_ap", actor_role="intern")
        assert body["error"] == "role_not_permitted"
        assert body["actor_role_recognized"] is False
        assert set(body["recognized_roles"]) == {"artist", "compositor", "director", "lead", "pm"}

        allowed = st.get_allowed_transitions("ap", actor_role="intern")
        entry = next(e for e in allowed if e["status"] == "client_ap")
        assert entry["actor_role_recognized"] is False
        assert entry["recognized_roles"] == sorted(entry["recognized_roles"])

    def test_known_role_reported_recognized_true_in_allowed_transitions(self):
        allowed = st.get_allowed_transitions("ap", actor_role="pm")
        entry = next(e for e in allowed if e["status"] == "client_ap")
        assert entry["actor_role_recognized"] is True

    def test_self_transition_is_noop_allowed(self):
        assert st.is_transition_allowed("qc", "qc") is True
        assert st.explain_transition("qc", "qc") is None

    def test_invalid_status_value(self):
        body = st.explain_transition("qc", "not_a_status")
        assert body["error"] == "invalid_status"
        assert body["http_status"] == 422

    def test_default_enforce_mode_is_warn(self):
        os.environ.pop("TASK_TRANSITION_ENFORCE", None)
        assert st.get_enforce_mode() == "warn"

    def test_explain_assignee_change_f681_3(self):
        """F681-3: assigned_to変更ゲートはstatus遷移(ROLE_RULES)と独立した別ロジックである。"""
        assert st.explain_assignee_change("lead") is None
        assert st.explain_assignee_change("director") is None
        assert st.explain_assignee_change("PM") is None  # F681-2の表記ゆれ吸収も及ぶ
        body = st.explain_assignee_change("compositor")
        assert body["error"] == "role_not_permitted"
        assert body["required_role"] == "lead_or_above"
        assert body["action"] == "assignee_change"
        body_none = st.explain_assignee_change(None)
        assert body_none["error"] == "role_not_permitted"

    def test_null_status_is_treated_as_mk_f681_1(self):
        """F681-1: status未設定(None)タスクを'mk'とみなし、不親切な拒否(空のallowed_next/
        illegal_transition)を起こさない。_task_row_to_dict の読取時既定'mk'と一貫させる。"""
        allowed = st.get_allowed_transitions(None)
        assert allowed == st.get_allowed_transitions("mk")
        assert {e["status"] for e in allowed} == {"wip", "wt", "omit"}

        assert st.is_transition_allowed(None, "wip") is True
        assert st.is_transition_allowed(None, "qc") is False  # mk→qcは元々グラフ上illegal

        # 合法遷移(None→wip)はNoneのまま渡してもエラーにならない
        assert st.explain_transition(None, "wip") is None

        # 役職ルールも'mk'扱いで一貫して適用される(mk→omitはpm_or_above・殿裁可⑥でdirector_or_aboveから緩和)
        body = st.explain_transition(None, "omit", actor_role="compositor")
        assert body["error"] == "role_not_permitted"
        assert body["required_role"] == "pm_or_above"
        assert st.explain_transition(None, "omit", actor_role="pm") is None
        assert st.explain_transition(None, "omit", actor_role="director") is None

        # illegal_transitionでも表示ラベルは「(未設定)」を保ち、suggested_pathはmk起点で実提示される
        body = st.explain_transition(None, "qc")
        assert body["error"] == "illegal_transition"
        assert "(未設定)" in body["detail"]
        assert body["suggested_path"] == ["mk", "wip", "qc"]


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
    def test_warn_mode_does_not_block_illegal_transition_backward_compat(self, db):
        """要求(d): 既定warnでは既存フローを壊さない(拒否しない)。"""
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "warn"
        project, task = _make_project_task(db, status="qc")
        updated = crud.update_task(db, task, schemas.TaskUpdate(status="deliver"))
        assert updated.status.value == "deliver"
        assert updated.warnings is not None
        assert updated.warnings[0]["error"] == "illegal_transition"

    def test_on_mode_blocks_illegal_transition_with_no_side_effects(self, db):
        """CON-4: 拒否時はprogress書換等の副作用が残らない(F-5)。"""
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="qc")
        original_progress = task.progress
        with pytest.raises(st.TransitionError) as excinfo:
            crud.update_task(db, task, schemas.TaskUpdate(status="deliver"))
        assert excinfo.value.body["error"] == "illegal_transition"
        db.refresh(task)
        assert task.status.value == "qc"  # ロールバックされ変化していない
        assert task.progress == original_progress

    def test_on_mode_allows_legal_transition(self, db):
        """qc→apはCasper依頼書§02+殿裁可⑥でdirector_or_above★新規確定。director actorで検証する。"""
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="qc")
        director = models.User(email="dir1@example.com", hashed_password="x", username="dir1", role="user")
        db.add(director)
        db.commit()
        db.refresh(director)
        db.add(models.ScoreUserRole(user_id=director.id, project_id=project.id, role="director"))
        db.commit()
        updated = crud.update_task(db, task, schemas.TaskUpdate(status="ap"), actor_id=director.id)
        assert updated.status.value == "ap"
        assert updated.progress == 100  # 完了カテゴリ補正は従来どおり機能

    def test_on_mode_blocks_role_insufficient_transition(self, db):
        """CON-3方向の確認(crud経由): pm_or_above必須のap→client_apをcompositorが実行→拒否。
        (ap→deliverはCOND-1によりnull化されたため、pm_or_above据置のap→client_apで検証する)"""
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="ap")
        user = models.User(email="c1@example.com", hashed_password="x", username="c1", role="user")
        db.add(user)
        db.commit()
        db.refresh(user)
        db.add(models.ScoreUserRole(user_id=user.id, project_id=project.id, role="compositor"))
        db.commit()

        with pytest.raises(st.TransitionError) as excinfo:
            crud.update_task(db, task, schemas.TaskUpdate(status="client_ap"), actor_id=user.id)
        body = excinfo.value.body
        assert body["error"] == "role_not_permitted"
        assert body["required_role"] == "pm_or_above"

    def test_on_mode_admin_bypasses_role_check_f8(self, db):
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="ap")
        admin = models.User(email="a1@example.com", hashed_password="x", username="a1", role="admin")
        db.add(admin)
        db.commit()
        db.refresh(admin)
        # score_user_roles に割当が無くても admin はバイパスできる(F-8)
        updated = crud.update_task(db, task, schemas.TaskUpdate(status="deliver"), actor_id=admin.id)
        assert updated.status.value == "deliver"

    def test_who_can_do_this_populated_from_score_user_roles(self, db):
        """ap→deliverはCOND-1によりnull化されたため、pm_or_above据置のap→client_apで検証する。"""
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="ap")
        pm_user = models.User(email="pm1@example.com", hashed_password="x", username="pm1", role="user")
        actor = models.User(email="comp1@example.com", hashed_password="x", username="comp1", role="user")
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
        assert any(w["username"] == "pm1" and w["role"] == "pm" for w in who)
        assert set(who[0].keys()) == {"user_id", "username", "role"}  # 個人情報最小化(連絡先を含まない)


class TestAssigneeChangeGate:
    """F681-3: assigned_to変更の独立ゲート(status遷移検証とは別)。"""

    def test_on_mode_blocks_assignee_change_below_lead(self, db):
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="mk")
        actor = models.User(email="comp2@example.com", hashed_password="x", username="comp2", role="user")
        target = models.User(email="target1@example.com", hashed_password="x", username="target1", role="user")
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
        assert task.assigned_to is None  # CON-4方針を踏襲: 拒否時は副作用なし

    def test_on_mode_allows_assignee_change_for_lead(self, db):
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="mk")
        actor = models.User(email="lead1@example.com", hashed_password="x", username="lead1", role="user")
        target = models.User(email="target2@example.com", hashed_password="x", username="target2", role="user")
        db.add_all([actor, target])
        db.commit()
        db.refresh(actor)
        db.refresh(target)
        db.add(models.ScoreUserRole(user_id=actor.id, project_id=project.id, role="lead"))
        db.commit()

        updated = crud.update_task(db, task, schemas.TaskUpdate(assigned_to=target.id), actor_id=actor.id)
        assert updated.assigned_to == target.id

    def test_on_mode_admin_bypasses_assignee_gate_f8(self, db):
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="mk")
        admin = models.User(email="assignadmin@example.com", hashed_password="x", username="assignadmin", role="admin")
        target = models.User(email="target3@example.com", hashed_password="x", username="target3", role="user")
        db.add_all([admin, target])
        db.commit()
        db.refresh(admin)
        db.refresh(target)

        updated = crud.update_task(db, task, schemas.TaskUpdate(assigned_to=target.id), actor_id=admin.id)
        assert updated.assigned_to == target.id

    def test_warn_mode_default_does_not_block_but_records_warning(self, db):
        """既定warn: LORD-4(実role値)未確認のうちはhard blockしない(業務停止回避の予防線)。"""
        from app import crud, schemas
        os.environ.pop("TASK_TRANSITION_ENFORCE", None)
        project, task = _make_project_task(db, status="mk")
        actor = models.User(email="comp3@example.com", hashed_password="x", username="comp3", role="user")
        target = models.User(email="target4@example.com", hashed_password="x", username="target4", role="user")
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
        """同一assigned_toへの再設定(実質no-op)はゲート対象外。"""
        from app import crud, schemas
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task = _make_project_task(db, status="mk")
        actor = models.User(email="comp5@example.com", hashed_password="x", username="comp5", role="user")
        db.add(actor)
        db.commit()
        db.refresh(actor)
        db.add(models.ScoreUserRole(user_id=actor.id, project_id=project.id, role="compositor"))
        db.commit()

        updated = crud.update_task(db, task, schemas.TaskUpdate(name="renamed only"), actor_id=actor.id)
        assert updated.name == "renamed only"  # assigned_to未指定の更新はゲートに触れない

    def test_gate_independent_of_status_transition_gate(self, db):
        """status遷移検証とassigned_to変更検証が混同されず、それぞれ別の違反として積まれる。"""
        from app import crud, schemas
        os.environ.pop("TASK_TRANSITION_ENFORCE", None)
        project, task = _make_project_task(db, status="qc")  # qc→deliverはillegal_transition
        actor = models.User(email="comp4@example.com", hashed_password="x", username="comp4", role="user")
        target = models.User(email="target5@example.com", hashed_password="x", username="target5", role="user")
        db.add_all([actor, target])
        db.commit()
        db.refresh(actor)
        db.refresh(target)
        db.add(models.ScoreUserRole(user_id=actor.id, project_id=project.id, role="compositor"))
        db.commit()

        updated = crud.update_task(
            db, task, schemas.TaskUpdate(status="deliver", assigned_to=target.id), actor_id=actor.id,
        )
        errors = {w["error"] for w in updated.warnings}
        assert errors == {"illegal_transition", "role_not_permitted"}


class TestBulkUpdateAllOrNothing:
    def test_bulk_update_on_mode_all_or_nothing(self, db):
        """BC-2: on モードで1件でも違反があれば全件ロールバックされる。"""
        from app import crud
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        project, task_ok = _make_project_task(db, status="qc")   # qc→ap は合法
        task_ng = models.Task(name="NG", project_id=project.id, status="qc")
        db.add(task_ng)
        db.commit()
        db.refresh(task_ng)

        with pytest.raises(st.TransitionError) as excinfo:
            crud.bulk_update_tasks(db, [task_ok.id, task_ng.id], {"status": "deliver"})
        assert excinfo.value.body["error"] == "bulk_illegal_transition"
        db.refresh(task_ok)
        db.refresh(task_ng)
        assert task_ok.status.value == "qc"  # 何も適用されていない
        assert task_ng.status.value == "qc"


# ---------------------------------------------------------------------------
# 3. HTTP経由 (routers/tasks.py) — TransitionError→HTTPExceptionの変換確認
# ---------------------------------------------------------------------------

@pytest.fixture
def auth_as_admin(db):
    """認証済みadminユーザーとしてリクエストできるよう get_current_user を差し替える。"""
    from app.main import app
    from app import security

    admin = models.User(email="httptest-admin@example.com", hashed_password="x", username="httptest-admin", role="admin")
    db.add(admin)
    db.commit()
    db.refresh(admin)

    async def override_get_current_user():
        return admin

    app.dependency_overrides[security.get_current_user] = override_get_current_user
    yield admin
    app.dependency_overrides.pop(security.get_current_user, None)


@pytest.fixture
def auth_as_plain_user(db):
    """F-8のadminバイパスと切り分けるための非admin(role未割当)ユーザー。"""
    from app.main import app
    from app import security

    plain = models.User(email="httptest-plain@example.com", hashed_password="x", username="httptest-plain", role="user")
    db.add(plain)
    db.commit()
    db.refresh(plain)

    async def override_get_current_user():
        return plain

    app.dependency_overrides[security.get_current_user] = override_get_current_user
    yield plain
    app.dependency_overrides.pop(security.get_current_user, None)


class TestHttpEndpoints:
    def test_task_response_includes_allowed_next(self, client, db, auth_as_admin):
        project, task = _make_project_task(db, status="qc")
        resp = client.get(f"/tasks/{task.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert any(e["status"] == "ap" for e in data["allowed_next"])
        assert "permitted_for_actor" not in data["allowed_next"][0]  # 一覧/単票はrole_requiredのみ

    def test_allowed_transitions_endpoint(self, client, db, auth_as_admin):
        project, task = _make_project_task(db, status="ap")
        resp = client.get(f"/tasks/{task.id}/allowed-transitions")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ap"
        assert any(e["status"] == "deliver" for e in data["allowed_next"])

    def test_allowed_transitions_endpoint_null_status_not_empty_f681_1(self, client, db, auth_as_admin):
        """F681-1: status未設定タスクでもGET allowed-transitionsが空配列にならない(mk扱い)。"""
        project, task = _make_project_task(db, status=None)
        resp = client.get(f"/tasks/{task.id}/allowed-transitions")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] is None  # canonical_statusはNoneのまま(表示は呼び出し側の責務)
        assert len(data["allowed_next"]) > 0  # だがallowed_nextは空配列にならない(F681-1本題)
        assert any(e["status"] == "wip" for e in data["allowed_next"])

    def test_task_response_null_status_allowed_next_not_empty_f681_1(self, client, db, auth_as_admin):
        """F681-1: TaskResponse(GET /tasks/{id})側でもstatus未設定でallowed_nextが空にならない。"""
        project, task = _make_project_task(db, status=None)
        resp = client.get(f"/tasks/{task.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["allowed_next"]) > 0
        assert any(e["status"] == "wip" for e in data["allowed_next"])

    def test_put_task_illegal_transition_on_mode_returns_409(self, client, db, auth_as_plain_user):
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        try:
            project, task = _make_project_task(db, status="qc")
            resp = client.put(f"/tasks/{task.id}", json={"status": "deliver"})
            assert resp.status_code == 409
            assert resp.json()["detail"]["error"] == "illegal_transition"
        finally:
            os.environ.pop("TASK_TRANSITION_ENFORCE", None)

    def test_put_task_warn_mode_default_does_not_block(self, client, db, auth_as_admin):
        os.environ.pop("TASK_TRANSITION_ENFORCE", None)
        project, task = _make_project_task(db, status="qc")
        resp = client.put(f"/tasks/{task.id}", json={"status": "deliver"})
        assert resp.status_code == 200  # 要求(d): 既定warnは既存呼出を壊さない
        assert resp.json()["status"] == "deliver"

    def test_readonly_task_status_transitions_endpoint(self, client, db):
        os.environ.setdefault("SCORE_READONLY_TOKEN", "test_readonly_token_abc")
        resp = client.get(
            "/api/readonly/task-status-transitions",
            headers={"X-Readonly-Token": os.environ["SCORE_READONLY_TOKEN"]},
        )
        assert resp.status_code == 200
        rows = resp.json()
        assert any(r["from"] == "qc" and r["to"] == "ap" and r["confirmed"] for r in rows)
        assert any(r["from"] == "ap" and r["to"] == "qc_fb" and not r["confirmed"] for r in rows)


class TestScoreApproveDirectAssignPaths:
    """CON-3/BC-1: routers/score.py の approve_shot(L145)・approve_task(L168) は
    crud非経由の直代入だが、それでも遷移検証を通ることを確認する。"""

    def test_approve_task_blocks_illegal_transition_in_on_mode(self, client, db, auth_as_plain_user):
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        try:
            # wt → ap は TRANSITIONS 上に定義が無い(illegal_transition)
            project, task = _make_project_task(db, status="wt")
            resp = client.post(f"/api/tasks/{task.id}/approve")
            assert resp.status_code == 409
            assert resp.json()["detail"]["error"] == "illegal_transition"
            db.refresh(task)
            assert task.status.value == "wt"  # 副作用なし(F-5)
        finally:
            os.environ.pop("TASK_TRANSITION_ENFORCE", None)

    def test_approve_task_allows_legal_transition(self, client, db, auth_as_admin):
        os.environ["TASK_TRANSITION_ENFORCE"] = "on"
        try:
            project, task = _make_project_task(db, status="qc")  # qc→ap は合法
            resp = client.post(f"/api/tasks/{task.id}/approve")
            assert resp.status_code == 200
            db.refresh(task)
            assert task.status.value == "ap"
        finally:
            os.environ.pop("TASK_TRANSITION_ENFORCE", None)

    def test_approve_task_warn_mode_default_does_not_block(self, client, db, auth_as_plain_user):
        os.environ.pop("TASK_TRANSITION_ENFORCE", None)
        project, task = _make_project_task(db, status="wt")  # 本来illegalだがwarnは拒否しない
        resp = client.post(f"/api/tasks/{task.id}/approve")
        assert resp.status_code == 200
        db.refresh(task)
        assert task.status.value == "ap"
