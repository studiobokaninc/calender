import datetime

from app import models
from app.mcp_server import get_meeting_minutes, get_delay_rates


def test_mcp_get_meeting_minutes_list_and_detail(db, monkeypatch):
    monkeypatch.setattr("app.mcp_server.SessionLocal", lambda: db)
    monkeypatch.setattr(db, "close", lambda: None)

    project = models.Project(name="Minutes Project", display_status="online")
    db.add(project)
    db.commit()
    db.refresh(project)

    meeting = models.Meeting(
        project_id=project.id,
        title="定例会議",
        date=datetime.datetime(2026, 9, 1, 10, 0, 0),
        status="completed",
        transcript="全文の文字起こし",
        decisions=["方針Aで進める"],
        tasks=["資料を作成する"],
        discussion_points=["予算について議論"],
        deadlines=["9/10までに提出"],
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)

    # 一覧取得: transcript は含まれない
    res_list = get_meeting_minutes(project_id=project.id)
    assert res_list["total"] == 1
    item = res_list["items"][0]
    assert item["id"] == meeting.id
    assert item["title"] == "定例会議"
    assert item["project_name"] == "Minutes Project"
    assert item["decisions"] == ["方針Aで進める"]
    assert "transcript" not in item

    # 詳細取得: transcript を含む
    res_detail = get_meeting_minutes(meeting_id=meeting.id)
    assert res_detail["meeting"]["id"] == meeting.id
    assert res_detail["meeting"]["transcript"] == "全文の文字起こし"

    # 存在しないID
    res_404 = get_meeting_minutes(meeting_id=999999)
    assert res_404["error"] == "Meeting not found"
    assert res_404["status_code"] == 404


def test_mcp_get_delay_rates(db, monkeypatch):
    monkeypatch.setattr("app.mcp_server.SessionLocal", lambda: db)
    monkeypatch.setattr(db, "close", lambda: None)

    project = models.Project(name="Delay Project", display_status="online")
    db.add(project)
    db.commit()
    db.refresh(project)

    user_a = models.User(username="alice", email="alice@example.com", hashed_password="x",
                          full_name="Alice", is_active=True)
    user_b = models.User(username="bob", email="bob@example.com", hashed_password="x",
                          full_name="Bob", is_active=True)
    db.add_all([user_a, user_b])
    db.commit()
    db.refresh(user_a)
    db.refresh(user_b)

    past = datetime.datetime(2020, 1, 1)
    future = datetime.datetime(2999, 1, 1)

    tasks = [
        # alice: 2件中1件遅延 -> 50%
        models.Task(name="A1", project_id=project.id, assigned_to=user_a.id,
                    status=models.TaskStatus.WIP, due_date=past, display_status="online"),
        models.Task(name="A2", project_id=project.id, assigned_to=user_a.id,
                    status=models.TaskStatus.WIP, due_date=future, display_status="online"),
        # bob: 1件中0件遅延 -> 0%
        models.Task(name="B1", project_id=project.id, assigned_to=user_b.id,
                    status=models.TaskStatus.AP, due_date=past, display_status="online"),
    ]
    db.add_all(tasks)
    db.commit()

    res = get_delay_rates(project_id=project.id)
    by_name = {i["name"]: i for i in res["items"]}
    assert by_name["Alice"]["total"] == 2
    assert by_name["Alice"]["delayed"] == 1
    assert by_name["Alice"]["delay_rate"] == 50.0
    assert by_name["Bob"]["total"] == 1
    assert by_name["Bob"]["delayed"] == 0
    assert by_name["Bob"]["delay_rate"] == 0.0
    # delay_rate 降順
    assert res["items"][0]["name"] == "Alice"
