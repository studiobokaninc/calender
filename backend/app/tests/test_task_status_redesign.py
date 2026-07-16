"""task_status_redesign_plan.md §7 準拠のテスト。
- canonicalize_task_status のマッピング (旧値, 新エイリアス, CSV日本語)
- progress 補正 (deliver → 100, mk → 0, deliver 差し戻し時の progress 保持)
- _recalc_shot_status の新体系での集約
"""

import pytest
from datetime import datetime, timedelta

from app import crud, models, schemas
from app.schemas import canonicalize_task_status
from app.timezone import now_jst_naive


# ---------------------------------------------------------------------------
# canonicalize_task_status のテスト
# ---------------------------------------------------------------------------

class TestCanonicalizeTaskStatus:
    def test_legacy_status_names_are_mapped(self):
        assert canonicalize_task_status("todo") == "mk"
        assert canonicalize_task_status("in-progress") == "wip"
        assert canonicalize_task_status("in_progress") == "wip"
        assert canonicalize_task_status("delayed") == "wip"
        assert canonicalize_task_status("completed") == "deliver"
        assert canonicalize_task_status("review") == "qc"
        assert canonicalize_task_status("approved") == "ap"
        assert canonicalize_task_status("retake") == "qc_fb"
        assert canonicalize_task_status("cashing") == "caching"  # スペル修正

    def test_hyphen_aliases_normalized_then_collapsed_to_new9(self):
        # V2: ハイフン表記を解消した上で旧19→新9へ畳み込む
        assert canonicalize_task_status("qc-fb") == "qc_fb"
        assert canonicalize_task_status("dir-wt") == "qc"       # dir_wt → qc
        assert canonicalize_task_status("dir-ap") == "ap"       # dir_ap → ap
        assert canonicalize_task_status("dir-fb") == "qc_fb"    # dir_fb → qc_fb
        assert canonicalize_task_status("ap-fb") == "qc_fb"     # ap_fb → qc_fb

    def test_new9_status_passthrough(self):
        # V2 の有効9ステータスは素通し
        for s in ("wt", "mk", "wip", "qc", "qc_fb", "ap", "client_ap", "deliver", "omit"):
            assert canonicalize_task_status(s) == s

    def test_legacy19_collapse_to_new9(self):
        # 旧19体系は新9体系へ畳み込む
        assert canonicalize_task_status("modeling") == "wip"
        assert canonicalize_task_status("lookdev") == "wip"
        assert canonicalize_task_status("caching") == "wip"
        assert canonicalize_task_status("rig") == "wip"
        assert canonicalize_task_status("facial") == "wip"
        assert canonicalize_task_status("v1qc") == "qc"
        assert canonicalize_task_status("dir_wt") == "qc"
        assert canonicalize_task_status("ap_fb") == "qc_fb"
        assert canonicalize_task_status("dir_fb") == "qc_fb"
        assert canonicalize_task_status("fix") == "qc_fb"
        assert canonicalize_task_status("dir_ap") == "ap"
        # client_ap の表記揺れ
        assert canonicalize_task_status("client-ap") == "client_ap"

    def test_case_and_whitespace_normalization(self):
        assert canonicalize_task_status(" TODO ") == "mk"
        assert canonicalize_task_status("Deliver") == "deliver"
        # 日本語ラベルは is_csv=True の経路でのみ救済される。全角空白も除去対象。
        assert canonicalize_task_status("　完了　", is_csv=True) == "deliver"
        assert canonicalize_task_status("完了", is_csv=True) == "deliver"

    def test_csv_japanese_labels(self):
        assert canonicalize_task_status("未着手", is_csv=True) == "mk"
        assert canonicalize_task_status("進行中", is_csv=True) == "wip"
        assert canonicalize_task_status("確認中", is_csv=True) == "qc"
        assert canonicalize_task_status("承認済み", is_csv=True) == "ap"
        assert canonicalize_task_status("完了", is_csv=True) == "deliver"
        assert canonicalize_task_status("完了済み", is_csv=True) == "deliver"
        assert canonicalize_task_status("遅延", is_csv=True) == "wip"
        assert canonicalize_task_status("リテイク", is_csv=True) == "qc_fb"

    def test_none_and_empty(self):
        assert canonicalize_task_status(None) is None
        assert canonicalize_task_status("") is None
        assert canonicalize_task_status("   ") is None

    def test_unknown_value_passes_through(self):
        # 未知の値は素通しし、Enum 変換で最終的に弾かれる
        assert canonicalize_task_status("nonexistent") == "nonexistent"
        # Enum への変換で ValueError
        with pytest.raises(ValueError):
            models.TaskStatus(canonicalize_task_status("nonexistent"))


# ---------------------------------------------------------------------------
# schemas.TaskUpdate バリデータ経由の変換
# ---------------------------------------------------------------------------

class TestSchemaValidator:
    def test_task_update_status_migration(self):
        u = schemas.TaskUpdate(status="completed")
        assert u.status == models.TaskStatus.DELIVER

    def test_task_update_status_hyphen_alias(self):
        u = schemas.TaskUpdate(status="qc-fb")
        assert u.status == models.TaskStatus.QC_FB

    def test_task_update_progress_clamp(self):
        assert schemas.TaskUpdate(progress=150).progress == 100
        assert schemas.TaskUpdate(progress=-10).progress == 0
        assert schemas.TaskUpdate(progress=42).progress == 42


# ---------------------------------------------------------------------------
# progress 補正 (crud.update_task)
# ---------------------------------------------------------------------------

class TestProgressCompensation:
    def _create_project_and_task(self, db, status="wip", progress=40):
        proj = models.Project(name="P")
        db.add(proj); db.commit(); db.refresh(proj)
        t = models.Task(
            project_id=proj.id, name="T",
            status=models.TaskStatus(status), progress=progress,
        )
        db.add(t); db.commit(); db.refresh(t)
        return t

    def test_deliver_forces_progress_100(self, db):
        t = self._create_project_and_task(db, status="wip", progress=50)
        updated = crud.update_task(db, t, schemas.TaskUpdate(status="deliver", progress=50))
        assert updated.status == models.TaskStatus.DELIVER
        assert updated.progress == 100

    def test_ap_forces_progress_100_and_completed_at(self, db):
        t = self._create_project_and_task(db, status="qc", progress=70)
        updated = crud.update_task(db, t, schemas.TaskUpdate(status="ap", progress=70))
        assert updated.status == models.TaskStatus.AP
        assert updated.progress == 100
        assert updated.completed_at is not None

    def test_client_ap_forces_progress_100(self, db):
        t = self._create_project_and_task(db, status="ap", progress=100)
        updated = crud.update_task(db, t, schemas.TaskUpdate(status="client_ap"))
        assert updated.status == models.TaskStatus.CLIENT_AP
        assert updated.progress == 100

    def test_completed_at_preserved_across_completed_transitions(self, db):
        # ap → client_ap → deliver で completed_at は最初の完了時刻を維持
        t = self._create_project_and_task(db, status="qc", progress=70)
        u1 = crud.update_task(db, t, schemas.TaskUpdate(status="ap"))
        first = u1.completed_at
        assert first is not None
        u2 = crud.update_task(db, u1, schemas.TaskUpdate(status="client_ap"))
        assert u2.completed_at == first
        u3 = crud.update_task(db, u2, schemas.TaskUpdate(status="deliver"))
        assert u3.completed_at == first

    def test_completed_at_reset_on_revert(self, db):
        # 完了カテゴリ → 非完了 への差し戻しで completed_at は None
        t = self._create_project_and_task(db, status="ap", progress=100)
        # まず completed_at を持たせるため一旦 ap へ再遷移
        t.completed_at = now_jst_naive(); db.commit()
        updated = crud.update_task(db, t, schemas.TaskUpdate(status="qc_fb"))
        assert updated.status == models.TaskStatus.QC_FB
        assert updated.completed_at is None

    def test_wt_forces_progress_0(self, db):
        t = self._create_project_and_task(db, status="wip", progress=50)
        updated = crud.update_task(db, t, schemas.TaskUpdate(status="wt", progress=50))
        assert updated.status == models.TaskStatus.WT
        assert updated.progress == 0

    def test_mk_forces_progress_0(self, db):
        t = self._create_project_and_task(db, status="wip", progress=50)
        updated = crud.update_task(db, t, schemas.TaskUpdate(status="mk", progress=50))
        assert updated.status == models.TaskStatus.MK
        assert updated.progress == 0

    def test_non_deliver_status_change_respects_explicit_progress(self, db):
        t = self._create_project_and_task(db, status="wip", progress=40)
        updated = crud.update_task(db, t, schemas.TaskUpdate(status="qc_fb", progress=80))
        assert updated.status == models.TaskStatus.QC_FB
        assert updated.progress == 80

    def test_deliver_revert_retains_progress_when_unspecified(self, db):
        # deliver 状態から他へ差し戻す際、progress 未指定なら既存値を保持
        t = self._create_project_and_task(db, status="deliver", progress=100)
        updated = crud.update_task(db, t, schemas.TaskUpdate(status="qc_fb"))
        assert updated.status == models.TaskStatus.QC_FB
        assert updated.progress == 100


# ---------------------------------------------------------------------------
# ステータス遷移通知 (§1.4)
# ---------------------------------------------------------------------------

class TestStatusChangeNotification:
    def _setup(self, db, assignee_id=101):
        proj = models.Project(name="P")
        db.add(proj); db.commit(); db.refresh(proj)
        t = models.Task(project_id=proj.id, name="Shot A", status=models.TaskStatus.QC,
                        assigned_to=assignee_id, progress=70)
        db.add(t); db.commit(); db.refresh(t)
        return t

    def test_ap_transition_notifies_assignee(self, db):
        t = self._setup(db, assignee_id=101)
        # 別ユーザー(ディレクター=202)が承認
        crud.update_task(db, t, schemas.TaskUpdate(status="ap"), actor_id=202)
        notifs = db.query(models.Notification).filter(
            models.Notification.recipient_id == 101
        ).all()
        assert len(notifs) == 1
        assert notifs[0].type == "task_status_changed"
        assert notifs[0].meta.get("to") == "ap"
        assert notifs[0].meta.get("actor_id") == 202

    def test_self_transition_is_suppressed(self, db):
        t = self._setup(db, assignee_id=101)
        # 担当者自身が操作 → 自己通知は抑制
        crud.update_task(db, t, schemas.TaskUpdate(status="ap"), actor_id=101)
        notifs = db.query(models.Notification).filter(
            models.Notification.recipient_id == 101
        ).all()
        assert len(notifs) == 0

    def test_client_fb_notifies_assignee(self, db):
        # 完了カテゴリ(ap) からの qc_fb 差し戻し = クライアントFB
        t = self._setup(db, assignee_id=101)
        crud.update_task(db, t, schemas.TaskUpdate(status="ap"), actor_id=202)
        crud.update_task(db, t, schemas.TaskUpdate(status="qc_fb"), actor_id=202)
        notifs = db.query(models.Notification).filter(
            models.Notification.recipient_id == 101,
            models.Notification.type == "client_fb",
        ).all()
        assert len(notifs) == 1


# ---------------------------------------------------------------------------
# _recalc_shot_status の新体系集約
# ---------------------------------------------------------------------------

class TestRecalcShotStatus:
    def _make_shot_with_tasks(self, db, task_statuses):
        proj = models.Project(name="P")
        db.add(proj); db.commit(); db.refresh(proj)
        shot = models.Shot(project_id=proj.id, seq_code="sq01", shot_code="c001", status="planning")
        db.add(shot); db.commit(); db.refresh(shot)
        for s in task_statuses:
            t = models.Task(project_id=proj.id, name=f"T-{s}", status=models.TaskStatus(s), shot_id=shot.id)
            db.add(t)
        db.commit()
        return shot

    def test_all_completed_category_becomes_completed(self, db):
        # V2: ap/client_ap/deliver は全て完了カテゴリ → completed
        shot = self._make_shot_with_tasks(db, ["ap", "client_ap", "deliver"])
        crud.tasks._recalc_shot_status(db, shot.id)
        db.commit(); db.refresh(shot)
        assert shot.status == "completed"

    def test_partial_completed_becomes_in_progress(self, db):
        # 一部のみ完了（qc が残る）→ in_progress ('approved' は廃止)
        shot = self._make_shot_with_tasks(db, ["deliver", "ap", "qc"])
        crud.tasks._recalc_shot_status(db, shot.id)
        db.commit(); db.refresh(shot)
        assert shot.status == "in_progress"

    def test_wip_present_becomes_in_progress(self, db):
        shot = self._make_shot_with_tasks(db, ["mk", "wip", "qc"])
        crud.tasks._recalc_shot_status(db, shot.id)
        db.commit(); db.refresh(shot)
        assert shot.status == "in_progress"

    def test_omit_is_excluded_from_aggregation(self, db):
        # omit のタスクは集約対象外。残りが全て mk なら planning
        shot = self._make_shot_with_tasks(db, ["mk", "mk", "omit"])
        crud.tasks._recalc_shot_status(db, shot.id)
        db.commit(); db.refresh(shot)
        assert shot.status == "planning"

    def test_all_wt_or_mk_becomes_planning(self, db):
        # V2: wt/mk はともに未着手系 → planning
        shot = self._make_shot_with_tasks(db, ["wt", "mk"])
        crud.tasks._recalc_shot_status(db, shot.id)
        db.commit(); db.refresh(shot)
        assert shot.status == "planning"
