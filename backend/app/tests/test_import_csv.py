import pytest
import io
from app import models
from app.security import get_password_hash
from jose import jwt
from app.security import SECRET_KEY, ALGORITHM

def make_token(email: str) -> str:
    return jwt.encode({"sub": email}, SECRET_KEY, algorithm=ALGORITHM)

@pytest.fixture
def admin_user(db):
    u = models.User(
        username="admin_test_user",
        email="admin_test_user@example.com",
        hashed_password=get_password_hash("admin_password"),
        role="admin",
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u

@pytest.fixture
def normal_user(db):
    u = models.User(
        username="normal_test_user",
        email="normal_test_user@example.com",
        hashed_password=get_password_hash("normal_password"),
        role="user",
        full_name="Normal User FullName"
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u

@pytest.fixture
def admin_auth_headers(admin_user):
    token = make_token(admin_user.email)
    return {"Authorization": f"Bearer {token}"}

def test_import_csv_success(client, db, admin_user, normal_user, admin_auth_headers):
    # CSV content with project info and task info
    csv_content = (
        "プロジェクト情報\n"
        "プロジェクト名,開始日,終了日,説明\n"
        "テストプロジェクト,2026/04/01,2026/05/31,テストプロジェクトの説明\n"
        "\n"
        "タスク情報\n"
        "タスク名,期日,説明,担当者,コスト,タイプ,seqID,shotID,依存タスク\n"
        "タスク1,2026/04/15,タスク詳細1,Normal User FullName,16.0,design,SEQ001,SHOT001_v1,\n"
        "タスク2,2026/04/20,タスク詳細2,normal_test_user,8.0,programming,SEQ001,SHOT001_v1,タスク1\n"
    )

    # Encode CSV content in shift-jis or utf-8
    csv_bytes = csv_content.encode("utf-8")

    # Send the request to /admin/mock-data/import-csv
    files = {"file": ("test_import.csv", csv_bytes, "text/csv")}
    resp = client.post("/admin/mock-data/import-csv", files=files, headers=admin_auth_headers)

    # Verify response
    assert resp.status_code == 200, resp.json()
    data = resp.json()
    assert data["projects"]["imported"] == 1
    assert data["tasks"]["imported"] == 2
    assert data["tasks"]["updated"] == 0
    assert len(data["warnings"]) == 0

    # Query DB to check if project and tasks are imported correctly
    proj = db.query(models.Project).filter(models.Project.name == "テストプロジェクト").first()
    assert proj is not None
    assert proj.description == "テストプロジェクトの説明"

    tasks = db.query(models.Task).filter(models.Task.project_id == proj.id).all()
    assert len(tasks) == 2

    t1 = next(t for t in tasks if t.name == "タスク1")
    t2 = next(t for t in tasks if t.name == "タスク2")

    assert t1.assigned_to == normal_user.id
    assert t1.seqID == "SEQ001"
    assert t1.shotID == "SHOT001_v1"
    assert t1.cost == 16.0
    assert t1.type == "design"

    # Verify auto-calculated start date (8 cost per day, skipping weekends)
    # due_date = 2026/04/15 (Wednesday)
    # cost = 16.0 (1 day before due_date needed, formula: (16.0-0.1)//8 = 1 day)
    # count=0: start_date starts at due_date (2026/04/15)
    # count=1: current_d -= 1 day => 2026/04/14 (Tuesday)
    # So start_date is 2026/04/14
    assert t1.start_date.strftime("%Y-%m-%d") == "2026-04-14"

    assert t2.assigned_to == normal_user.id
    assert t2.dependsOn == [str(t1.id)]
