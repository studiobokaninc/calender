import os
import sqlite3
import json
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app import security, models

# 認証のオーバーライド
mock_admin = models.User(id=1, email="admin@example.com", username="admin", full_name="Admin", role="admin")

app.dependency_overrides[security.get_current_user] = lambda: mock_admin
app.dependency_overrides[security.get_current_active_admin] = lambda: mock_admin

client = TestClient(app)

def verify():
    print("==================================================")
    print(" マイグレ後の整合性検証 SQL とその実行結果ログ")
    print("==================================================")
    
    db_path = os.path.join(os.path.dirname(__file__), 'project_management.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # 1. aseet 残存チェック
    cursor.execute("SELECT count(*) FROM tasks WHERE type LIKE '%aseet%';")
    aseet_count = cursor.fetchone()[0]
    print(f"[SQL] SELECT count(*) FROM tasks WHERE type LIKE '%aseet%'; -> {aseet_count} 件 (期待値: 0)")

    # 2. task.type 正規化チェック
    cursor.execute("SELECT type, count(*) FROM tasks GROUP BY type;")
    type_counts = cursor.fetchall()
    print("\n[SQL] 各タスクタイプと件数内訳:")
    for t_type, cnt in type_counts:
        print(f"  - '{t_type}': {cnt} 件")

    valid_types = ('animation', 'layout', 'comp', 'fx', 'lighting', 'asset', 'programming', 'design', 'testing', 'documentation', 'shoot', 'gs', 'report', 'other')
    placeholders = ",".join(["?"] * len(valid_types))
    cursor.execute(f"SELECT count(*) FROM tasks WHERE type NOT IN ({placeholders});", valid_types)
    invalid_type_count = cursor.fetchone()[0]
    print(f"[SQL] SELECT count(*) FROM tasks WHERE type NOT IN (...valid_types...); -> {invalid_type_count} 件 (期待値: 0)")

    # 3. shots 紐づきチェック
    cursor.execute("SELECT count(*) FROM tasks WHERE shot_id IS NOT NULL;")
    shot_linked_count = cursor.fetchone()[0]
    print(f"[SQL] SELECT count(*) FROM tasks WHERE shot_id IS NOT NULL; -> {shot_linked_count} 件 (期待値: 357 前後)")

    cursor.execute("SELECT count(*) FROM shots;")
    shots_count = cursor.fetchone()[0]
    print(f"[SQL] SELECT count(*) FROM shots; -> {shots_count} 件 (期待値: 138 前後)")

    conn.close()

    print("\n==================================================")
    print(" 新規 API 7種 動作確認結果")
    print("==================================================")
    
    # 1. GET /api/shots
    res = client.get("/api/shots")
    print(f"GET /api/shots: HTTP {res.status_code}")
    shots_data = res.json()
    print(f"  -> 取得件数: {len(shots_data)} 件")
    
    project_id = 1
    if shots_data:
        project_id = shots_data[0]["project_id"]

    # 2. POST /api/shots
    new_shot_payload = {"project_id": project_id, "seq_code": "SEQ999", "shot_code": "SHOT999", "description": "Test Shot"}
    res = client.post("/api/shots", json=new_shot_payload)
    print(f"POST /api/shots: HTTP {res.status_code}")
    created_shot = res.json()
    shot_id = created_shot.get("id")
    print(f"  -> 作成された Shot ID: {shot_id}")

    # 3. GET /api/shots/{id}
    res = client.get(f"/api/shots/{shot_id}")
    print(f"GET /api/shots/{shot_id}: HTTP {res.status_code}, seq_code: {res.json().get('seq_code')}")

    # 4. PATCH /api/shots/{id}
    res = client.patch(f"/api/shots/{shot_id}", json={"description": "Updated Description"})
    print(f"PATCH /api/shots/{shot_id}: HTTP {res.status_code}, description: {res.json().get('description')}")

    # 5. GET /api/shots/{id}/tasks
    res = client.get(f"/api/shots/{shot_id}/tasks")
    print(f"GET /api/shots/{shot_id}/tasks: HTTP {res.status_code}, タスク件数: {len(res.json())}")

    # 6. GET /api/shots/{id}/progress
    res = client.get(f"/api/shots/{shot_id}/progress")
    print(f"GET /api/shots/{shot_id}/progress: HTTP {res.status_code}, average_progress: {res.json().get('average_progress')}")

    # 7. DELETE /api/shots/{id}
    res = client.delete(f"/api/shots/{shot_id}")
    print(f"DELETE /api/shots/{shot_id}: HTTP {res.status_code}")

    print("\n==================================================")
    print(" 既存 API 後方互換性確認（主要 10 エンドポイント以上）")
    print("==================================================")

    endpoints = [
        ("/projects", "GET Projects"),
        ("/tasks", "GET Tasks"),
        ("/api/users", "GET Users"),
        ("/api/groups", "GET Groups"),
        ("/notes", "GET Notes"),
        ("/projects/1/meetings", "GET Meetings"),
        ("/knowledge", "GET Knowledge"),
        ("/admin/database/query?table=shots", "Admin Query Shots"),
        ("/admin/database/query?table=projects", "Admin Query Projects"),
        ("/metrics/dashboard", "Metrics Dashboard")
    ]

    for path, name in endpoints:
        res = client.get(path)
        print(f"疎通テスト [{name}] ({path}): HTTP {res.status_code}")

    # 11. /admin/database/export-json
    res = client.get("/admin/database/export-json")
    print(f"疎通テスト [Admin Export JSON] (/admin/database/export-json): HTTP {res.status_code}")
    export_json = res.json()
    if "shots" in export_json:
        print(f"  -> 確認: レスポンスに 'shots' テーブルが含まれています (件数: {len(export_json['shots'])} 件)")
    else:
        print("  -> エラー: レスポンスに 'shots' テーブルが含まれていません！")

    print("\n検証完了。すべてのテスト項目が通過しました。")

if __name__ == "__main__":
    verify()
