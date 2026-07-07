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

    def test_new_status_hyphen_aliases_are_normalized(self):
        assert canonicalize_task_status("qc-fb") == "qc_fb"
        assert canonicalize_task_status("dir-wt") == "dir_wt"
        assert canonicalize_task_status("dir-ap") == "dir_ap"
        assert canonicalize_task_status("dir-fb") == "dir_fb"
        assert canonicalize_task_status("ap-fb") == "ap_fb"

    def test_new_status_passthrough(self):
        for s in ("mk", "wip", "modeling", "lookdev", "caching", "rig", "facial",
                  "v1qc", "qc", "qc_fb", "ap", "ap_fb", "dir_wt", "dir_ap",
                  "dir_fb", "fix", "deliver", "omit", "wt"):
            assert canonicalize_task_status(s) == s

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

    def test_all_deliver_becomes_completed(self, db):
        shot = self._make_shot_with_tasks(db, ["deliver", "deliver"])
        crud.tasks._recalc_shot_status(db, shot.id)
        db.commit(); db.refresh(shot)
        assert shot.status == "completed"

    def test_mixed_deliver_and_fix_becomes_approved(self, db):
        shot = self._make_shot_with_tasks(db, ["deliver", "fix", "ap"])
        crud.tasks._recalc_shot_status(db, shot.id)
        db.commit(); db.refresh(shot)
        assert shot.status == "approved"

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

    def test_all_mk_becomes_planning(self, db):
        shot = self._make_shot_with_tasks(db, ["mk", "mk"])
        crud.tasks._recalc_shot_status(db, shot.id)
        db.commit(); db.refresh(shot)
        assert shot.status == "planning"
