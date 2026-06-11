"""
§7-1 pytest — approved_status (cmd_485, subtask_485e)
14 cases (§7-1) + ISSUE-4 降格退行ガード = 15 tests total.
SKIP=FAIL: all must PASS, 0 skipped.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from app import models
from app.crud.tasks import _recalc_shot_status


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_shot(db, project_id, shot_code, task_statuses):
    """Create a shot + tasks, flush (not commit). Returns the shot."""
    shot = models.Shot(
        project_id=project_id,
        seq_code="SQ485",
        shot_code=shot_code,
        status="planning",
    )
    db.add(shot)
    db.flush()
    for i, status_str in enumerate(task_statuses):
        db.add(models.Task(
            project_id=project_id,
            name=f"{shot_code}_t{i}",
            status=models.TaskStatus(status_str),
            shot_id=shot.id,
        ))
    db.flush()
    return shot


def _recalc(db, shot):
    """Run recalc + commit + refresh, return new shot.status."""
    _recalc_shot_status(db, shot.id)
    db.commit()
    db.refresh(shot)
    return shot.status


def _fresh_status(db, shot):
    """Re-query shot.status from DB (clears session cache first)."""
    db.expire_all()
    return db.query(models.Shot).filter(models.Shot.id == shot.id).first().status


def _fresh_task_status(db, task_id):
    """Re-query task.status from DB."""
    db.expire_all()
    return db.query(models.Task).filter(models.Task.id == task_id).first().status


# ── Cases 1–10: shot 派生ステータス (_recalc_shot_status) ─────────────────────

def test_case01_no_tasks_planning(db, project):
    """Case 1: task 0件 → planning"""
    shot = _make_shot(db, project.id, "c01", [])
    db.commit()
    assert _recalc(db, shot) == "planning"


def test_case02_all_completed(db, project):
    """Case 2: 全 completed → completed"""
    shot = _make_shot(db, project.id, "c02", ["completed", "completed"])
    db.commit()
    assert _recalc(db, shot) == "completed"


def test_case03_approved_completed_mix(db, project):
    """Case 3: 全 {approved, completed} 混在 → approved"""
    shot = _make_shot(db, project.id, "c03", ["approved", "completed"])
    db.commit()
    assert _recalc(db, shot) == "approved"


def test_case04_all_approved(db, project):
    """Case 4: 全 approved → approved"""
    shot = _make_shot(db, project.id, "c04", ["approved", "approved"])
    db.commit()
    assert _recalc(db, shot) == "approved"


def test_case05_approved_todo_in_progress(db, project):
    """Case 5: {approved, todo} → in_progress (§3-1 新挙動)"""
    shot = _make_shot(db, project.id, "c05", ["approved", "todo"])
    db.commit()
    assert _recalc(db, shot) == "in_progress"


def test_case06_completed_todo_in_progress(db, project):
    """Case 6: {completed, todo} → in_progress (cmd_484→cmd_485 挙動変更)"""
    shot = _make_shot(db, project.id, "c06", ["completed", "todo"])
    db.commit()
    assert _recalc(db, shot) == "in_progress"


def test_case07_inprogress_todo(db, project):
    """Case 7: {in-progress, todo} → in_progress"""
    shot = _make_shot(db, project.id, "c07", ["in-progress", "todo"])
    db.commit()
    assert _recalc(db, shot) == "in_progress"


def test_case08_all_todo_planning(db, project):
    """Case 8: 全 todo → planning"""
    shot = _make_shot(db, project.id, "c08", ["todo", "todo"])
    db.commit()
    assert _recalc(db, shot) == "planning"


def test_case09_approved_retake_rollback(db, project):
    """Case 9: approved 群の1件を retake へ → in_progress (巻戻り)"""
    shot = _make_shot(db, project.id, "c09", ["approved", "approved"])
    db.commit()
    assert _recalc(db, shot) == "approved"

    task = db.query(models.Task).filter(models.Task.shot_id == shot.id).first()
    task.status = models.TaskStatus.RETAKE
    db.commit()
    assert _recalc(db, shot) == "in_progress"


def test_case10_completed_retake_rollback(db, project):
    """Case 10: completed 群の1件を retake へ → in_progress (巻戻り)"""
    shot = _make_shot(db, project.id, "c10", ["completed", "completed"])
    db.commit()
    assert _recalc(db, shot) == "completed"

    task = db.query(models.Task).filter(models.Task.shot_id == shot.id).first()
    task.status = models.TaskStatus.RETAKE
    db.commit()
    assert _recalc(db, shot) == "in_progress"


# ── Cases 11–14: 権限テスト (API 経由) ────────────────────────────────────────

def test_case11_task_approve_ep(db, client, project):
    """Case 11: POST /api/tasks/{id}/approve → task=approved + shot 再計算"""
    shot = _make_shot(db, project.id, "c11", ["todo"])
    db.commit()
    task = db.query(models.Task).filter(models.Task.shot_id == shot.id).first()

    resp = client.post(f"/api/tasks/{task.id}/approve")
    assert resp.status_code == 200
    assert resp.json()["message"] == "approved"

    assert _fresh_task_status(db, task.id) == models.TaskStatus.APPROVED
    assert _fresh_status(db, shot) == "approved"


def test_case12_score_approve_ep_fixed_approved(db, client, project):
    """Case 12: Score approve EP は approved 固定 — completed に到達しない (§4 権限分離)"""
    shot = _make_shot(db, project.id, "c12", ["review"])
    db.commit()
    task = db.query(models.Task).filter(models.Task.shot_id == shot.id).first()

    resp = client.post(f"/api/tasks/{task.id}/approve")
    assert resp.status_code == 200

    status_after = _fresh_task_status(db, task.id)
    assert status_after == models.TaskStatus.APPROVED
    assert status_after != models.TaskStatus.COMPLETED


def test_case13_patch_shot_status_ignored(db, client, project):
    """Case 13: PATCH /api/shots/{id} の status 指定は無視される (案A 維持)"""
    shot = _make_shot(db, project.id, "c13", ["approved"])
    db.commit()
    _recalc_shot_status(db, shot.id)
    db.commit()
    db.refresh(shot)
    assert shot.status == "approved"

    resp = client.patch(f"/api/shots/{shot.id}", json={"status": "planning"})
    assert resp.status_code == 200

    assert _fresh_status(db, shot) == "approved"


def test_case14_shot_approve_b1(db, client, project):
    """Case 14: POST /api/shots/{id}/approve (案B-1) → 全 task approved → shot=approved"""
    shot = _make_shot(db, project.id, "c14", ["todo", "review", "in-progress"])
    db.commit()

    resp = client.post(f"/api/shots/{shot.id}/approve")
    assert resp.status_code == 200

    db.expire_all()
    tasks = db.query(models.Task).filter(models.Task.shot_id == shot.id).all()
    for t in tasks:
        assert t.status == models.TaskStatus.APPROVED
    assert _fresh_status(db, shot) == "approved"


# ── ISSUE-4 降格退行ガード ─────────────────────────────────────────────────────

def test_issue4_shot_approve_does_not_demote_completed(db, client, project):
    """ISSUE-4: /shots/{id}/approve は completed タスクを approved へ降格させない"""
    shot = _make_shot(db, project.id, "i04", ["completed", "review"])
    db.commit()
    tasks = (
        db.query(models.Task)
        .filter(models.Task.shot_id == shot.id)
        .order_by(models.Task.id)
        .all()
    )
    completed_id = tasks[0].id
    review_id = tasks[1].id

    resp = client.post(f"/api/shots/{shot.id}/approve")
    assert resp.status_code == 200

    assert _fresh_task_status(db, completed_id) == models.TaskStatus.COMPLETED  # 降格禁止
    assert _fresh_task_status(db, review_id) == models.TaskStatus.APPROVED
