import json
from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app import models, security
from datetime import datetime

def print_api_responses():
    client = TestClient(app)
    db = SessionLocal()

    # 1. 認証トークン生成用のテストユーザー
    test_user = db.query(models.User).filter(models.User.email == "test@example.com").first()
    if not test_user:
        test_user = models.User(
            email="test@example.com",
            hashed_password=security.get_password_hash("password"),
            username="testuser",
            full_name="テストユーザー",
            role="admin"
        )
        db.add(test_user)
        db.commit()
        db.refresh(test_user)

    token = security.create_access_token(data={"sub": test_user.email})
    headers = {"Authorization": f"Bearer {token}"}

    project = db.query(models.Project).first()
    if not project:
        project = models.Project(
            name="テストプロジェクト",
            description="テスト用のプロジェクトです",
            status=models.ProjectStatus.IN_PROGRESS
        )
        db.add(project)
        db.commit()
        db.refresh(project)

    event = db.query(models.Event).first()
    if not event:
        event = models.Event(
            project_id=project.id,
            title="テスト会議イベント",
            description="テストイベントです",
            start_time=datetime.now(),
            end_time=datetime.now(),
            type=models.EventType.MEETING
        )
        db.add(event)
        db.commit()
        db.refresh(event)

    print("=== API RESPONSE VERIFICATION ===")

    # §1: Prefix Aliasing (GET /api/projects)
    res_projects = client.get("/api/projects", headers=headers)
    print("\n[§1: GET /api/projects]")
    print(f"Status: {res_projects.status_code}")
    print(json.dumps(res_projects.json()[:1] if isinstance(res_projects.json(), list) else res_projects.json(), indent=2, ensure_ascii=False))

    # §2.1: GET /api/holidays
    res_holidays = client.get("/api/holidays?year=2026", headers=headers)
    print("\n[§2.1: GET /api/holidays?year=2026]")
    print(f"Status: {res_holidays.status_code}")
    # 最初と最後の3つを表示
    h_data = res_holidays.json()
    print(json.dumps(h_data[:3] + [{"...": "..."}] + h_data[-3:] if len(h_data) > 6 else h_data, indent=2, ensure_ascii=False))

    # §2.2: GET /api/users/{id}/avatar
    res_avatar = client.get(f"/api/users/{test_user.id}/avatar", headers=headers)
    print("\n[§2.2: GET /api/users/{id}/avatar]")
    print(f"Status: {res_avatar.status_code}")
    print(f"Content-Type: {res_avatar.headers.get('content-type')}")
    print(f"SVG Preview (first 150 chars): {res_avatar.text[:150]}...")

    # §2.5: POST /api/projects/{id}/meetings
    payload = {
        "title": "手動作成された会議の議事録",
        "project_id": project.id,
        "event_id": event.id,
        "transcript": "アジェンダに沿って進行。今後のマイルストーンを確認。",
        "decisions": ["マイルストーンを2026年6月末に設定する", "UIアバターはSVG動的生成とする"],
        "tasks": ["アバターAPIの検証スクリプト作成", "祝日計算APIのライブラリ化"],
        "deadlines": ["2026-06-01", "2026-05-30"],
        "attendees": [{"user_id": test_user.id, "name": test_user.full_name}]
    }
    res_create = client.post(f"/api/projects/{project.id}/meetings", json=payload, headers=headers)
    print("\n[§2.5: POST /api/projects/{id}/meetings]")
    print(f"Status: {res_create.status_code}")
    create_data = res_create.json()
    print(json.dumps(create_data, indent=2, ensure_ascii=False))

    meeting_id = create_data["id"]

    # §2.4: GET /api/meetings/{meeting_id}
    res_get = client.get(f"/api/meetings/{meeting_id}", headers=headers)
    print("\n[§2.4: GET /api/meetings/{meeting_id}]")
    print(f"Status: {res_get.status_code}")
    print(json.dumps(res_get.json(), indent=2, ensure_ascii=False))

    # §2.6: PATCH /api/meetings/{meeting_id}
    patch_payload = {
        "title": "【修正】手動作成された会議の議事録",
        "decisions": ["マイルストーンを2026年6月末に設定する", "UIアバターはSVG動的生成とする", "祝日はpython-holidaysで堅牢化する"]
    }
    res_patch = client.patch(f"/api/meetings/{meeting_id}", json=patch_payload, headers=headers)
    print("\n[§2.6: PATCH /api/meetings/{meeting_id}]")
    print(f"Status: {res_patch.status_code}")
    print(json.dumps(res_patch.json(), indent=2, ensure_ascii=False))

    # §2.3: GET /api/events/{event_id}/meetings
    res_event_meetings = client.get(f"/api/events/{event.id}/meetings", headers=headers)
    print("\n[§2.3: GET /api/events/{event_id}/meetings]")
    print(f"Status: {res_event_meetings.status_code}")
    print(json.dumps(res_event_meetings.json(), indent=2, ensure_ascii=False))

    db.close()

if __name__ == "__main__":
    print_api_responses()
