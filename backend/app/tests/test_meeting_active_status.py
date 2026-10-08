import pytest
from app import models
from app.security import get_current_user
from datetime import datetime

@pytest.fixture
def auth_user(db):
    user = models.User(
        username="test_user",
        email="test@example.com",
        hashed_password="hashed_pw",
        role="admin",
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_active_meetings_status_empty(client, db, auth_user):
    from app.main import app
    app.dependency_overrides[get_current_user] = lambda: auth_user

    res = client.get("/api/meetings/active-status")
    assert res.status_code == 200
    data = res.json()
    assert data["has_active_tasks"] is False
    assert data["recording_count"] == 0
    assert data["processing_count"] == 0
    assert data["total_active_count"] == 0
    assert len(data["meetings"]) == 0


def test_active_meetings_status_with_recording_and_processing(client, db, auth_user):
    from app.main import app
    app.dependency_overrides[get_current_user] = lambda: auth_user

    project = models.Project(name="プロジェクトA", description="テスト用")
    db.add(project)
    db.commit()
    db.refresh(project)

    # 1. recording
    m_rec = models.Meeting(
        project_id=project.id,
        title="企画定例会議",
        status="recording",
        attendees=[{"name": "田中"}, {"name": "佐藤"}],
        date=datetime.now()
    )
    # 2. processing
    m_proc = models.Meeting(
        project_id=project.id,
        title="開発レビュー会議",
        status="processing",
        attendees=[{"name": "鈴木"}],
        analysis_progress=45,
        analysis_backend="local",
        date=datetime.now()
    )
    # 3. completed (アクティブ対象外)
    m_comp = models.Meeting(
        project_id=project.id,
        title="完了済み会議",
        status="completed",
        date=datetime.now()
    )
    # 4. failed (アクティブ対象外)
    m_failed = models.Meeting(
        project_id=project.id,
        title="失敗会議",
        status="failed",
        date=datetime.now()
    )
    db.add_all([m_rec, m_proc, m_comp, m_failed])
    db.commit()

    res = client.get("/api/meetings/active-status")
    assert res.status_code == 200
    data = res.json()
    assert data["has_active_tasks"] is True
    assert data["recording_count"] == 1
    assert data["processing_count"] == 1
    assert data["total_active_count"] == 2
    assert len(data["meetings"]) == 2

    titles = [m["title"] for m in data["meetings"]]
    assert "企画定例会議" in titles
    assert "開発レビュー会議" in titles
    assert "完了済み会議" not in titles
    assert "失敗会議" not in titles

    rec_item = next(m for m in data["meetings"] if m["title"] == "企画定例会議")
    assert rec_item["status"] == "recording"
    assert rec_item["project_name"] == "プロジェクトA"
    assert "田中" in rec_item["attendees"]
    assert "佐藤" in rec_item["attendees"]

    proc_item = next(m for m in data["meetings"] if m["title"] == "開発レビュー会議")
    assert proc_item["status"] == "processing"
    assert proc_item["analysis_progress"] == 45
    assert proc_item["analysis_backend"] == "local"
