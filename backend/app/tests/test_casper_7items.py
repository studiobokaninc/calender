import pytest
from datetime import datetime
from fastapi.testclient import TestClient
from app import models, schemas
from app.schemas import normalize_task_type
from app.crud.events import _derive_user_ids_from_participants

def test_normalize_task_type():
    assert normalize_task_type("Compositing") == "comp"
    assert normalize_task_type("L//C") == "unclassified"
    assert normalize_task_type("Task") == "unclassified"
    assert normalize_task_type("素材image作成 1〜15") == "unclassified"
    assert normalize_task_type("animation") == "animation"
    assert normalize_task_type("other") == "other"
    assert normalize_task_type(None) is None

def test_derive_user_ids_from_participants():
    participants = [
        {"type": "user", "id": 10},
        {"type": "user", "id": 20},
        {"type": "user", "id": 10},  # duplicate
        {"type": "unknown", "id": "invalid"}
    ]
    user_ids = _derive_user_ids_from_participants(participants)
    assert user_ids == [10, 20]

def test_update_retake_status_endpoint(client: TestClient, db, monkeypatch):
    monkeypatch.setenv("CLI_BYPASS_TOKEN", "test_bypass_token")
    user = models.User(username="test_retake_user", email="retake@example.com", hashed_password="pwd", role="admin", is_active=True)
    db.add(user)
    db.commit()

    proj = models.Project(name="Retake Test Project")
    db.add(proj)
    db.commit()

    shot = models.Shot(project_id=proj.id, seq_code="SQ1", shot_code="SH1")
    db.add(shot)
    db.commit()

    retake = models.Retake(shot_id=shot.id, overall_comment="Needs fix", status="open", created_by=user.id)
    db.add(retake)
    db.commit()

    response = client.patch(
        f"/api/retakes/{retake.id}/status",
        json={"status": "in_progress"},
        headers={"Authorization": "Bearer test_bypass_token", "X-Actor-User-Id": str(user.id)}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "in_progress"
    assert data["status_changed_by"] == user.id

    db.refresh(retake)
    assert retake.status == "in_progress"
    assert retake.status_changed_by == user.id
    assert retake.updated_at is not None

def test_decision_shot_id_schema_and_model(db):
    proj = models.Project(name="Decision Shot Test Project")
    db.add(proj)
    db.commit()

    shot = models.Shot(project_id=proj.id, seq_code="SQ1", shot_code="SH2")
    db.add(shot)
    db.commit()

    task = models.Task(name="Test Task", project_id=proj.id)
    db.add(task)
    db.commit()

    decision = models.Decision(content="Approved shot design", project_id=proj.id, shot_id=shot.id, task_id=task.id)
    db.add(decision)
    db.commit()

    db.refresh(decision)
    assert decision.shot_id == shot.id
    assert decision.task_id == task.id

    r_dec = schemas.ReadonlyDecision.model_validate(decision)
    assert r_dec.shot_id == shot.id
    assert r_dec.task_id == task.id

def test_readonly_new_endpoints(client: TestClient, db, monkeypatch):
    monkeypatch.setenv("SCORE_READONLY_TOKEN", "SCORE_READONLY_TOKEN")
    token_headers = {"Authorization": "Bearer SCORE_READONLY_TOKEN"}

    # Retakes readonly endpoint
    res_retakes = client.get("/api/readonly/retakes", headers=token_headers)
    assert res_retakes.status_code == 200
    assert "items" in res_retakes.json()

    # Assets readonly endpoint
    res_assets = client.get("/api/readonly/assets", headers=token_headers)
    assert res_assets.status_code == 200
    assert "items" in res_assets.json()

    # Task status history readonly endpoint
    res_history = client.get("/api/readonly/task_status_history", headers=token_headers)
    assert res_history.status_code == 200
    assert "items" in res_history.json()

def test_mcp_new_tools(db):
    from app.mcp_server import get_retakes, get_assets, get_task_status_history

    retakes_res = get_retakes()
    assert "items" in retakes_res

    assets_res = get_assets()
    assert "items" in assets_res

    history_res = get_task_status_history()
    assert "items" in history_res
