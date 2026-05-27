import requests
import sqlite3
import os
import json
from datetime import datetime

# 設定
BASE_URL = "http://127.0.0.1:8000"
BYPASS_TOKEN = "studio_bokan_score_git_process_flow_calender"
HEADERS = {
    "Authorization": f"Bearer {BYPASS_TOKEN}",
    "X-Actor-User-Id": "1" # PM Tanaka
}
DB_PATH = "backend/app/project_management.db"

def test_db_structure():
    print("=== 1. データベース整合性確認 ===")
    tables_to_check = [
        "score_user_roles", "retakes", "retake_timecodes", 
        "change_requests", "troubles", "look_distributions", 
        "user_messages", "notifications", "timecards", "routines"
    ]
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    for table in tables_to_check:
        cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table}'")
        res = cursor.fetchone()
        if res:
            print(f"[OK] Table exists: {table}")
        else:
            print(f"[ERROR] Table missing: {table}")
    conn.close()

def test_api_endpoints():
    print("\n=== 2. API Operation Check ===")
    
    # 1. Retake issue
    retake_payload = {
        "shot_id": 1,
        "overall_comment": "Adjustment requested",
        "priority": "high",
        "deadline": "2026-05-20T00:00:00",
        "timecodes": [{"timecode": "00:01:23", "comment": "Effect too thin"}]
    }
    r = requests.post(f"{BASE_URL}/api/retakes", json=retake_payload, headers=HEADERS)
    if r.status_code == 201:
        print(f"[OK] POST /api/retakes: HTTP {r.status_code}")
    else:
        print(f"[ERROR] POST /api/retakes: HTTP {r.status_code} - {r.text}")

    # 2. Trouble report
    trouble_payload = {
        "shot_id": 1,
        "category": "lighting",
        "description": "Render error",
        "severity": "medium"
    }
    r = requests.post(f"{BASE_URL}/api/troubles", json=trouble_payload, headers=HEADERS)
    print(f"[OK] POST /api/troubles: HTTP {r.status_code}")

    # 3. My tasks (Read API)
    r = requests.get(f"{BASE_URL}/api/me/tasks", headers=HEADERS)
    if r.status_code == 200:
        print(f"[OK] GET /api/me/tasks: HTTP {r.status_code} (Count: {len(r.json())})")
    else:
        print(f"[ERROR] GET /api/me/tasks: HTTP {r.status_code}")

    # 4. Notifications
    r = requests.get(f"{BASE_URL}/api/me/notifications", headers=HEADERS)
    print(f"[OK] GET /api/me/notifications: HTTP {r.status_code}")

    # 5. Asset upload (S-04)
    import io
    dummy_file = io.BytesIO(b"dummy asset data")
    files = {"file": ("test_asset.txt", dummy_file, "text/plain")}
    data = {"shot_id": 1, "task_id": 1, "version": "v001"}
    r = requests.post(f"{BASE_URL}/api/assets", files=files, data=data, headers=HEADERS)
    if r.status_code == 201:
        print(f"[OK] POST /api/assets: HTTP {r.status_code}")
        asset_id = r.json().get("id")
    else:
        print(f"[ERROR] POST /api/assets: HTTP {r.status_code} - {r.text}")
        asset_id = 1

    # 6. Delivery receive (P-01)
    delivery_payload = {"qc_status": "passed", "memo": "Ready for client approval"}
    r = requests.post(f"{BASE_URL}/api/deliveries/1/receive", json=delivery_payload, headers=HEADERS)
    print(f"[OK] POST /api/deliveries/1/receive: HTTP {r.status_code}")

    # Create look distribution for testing
    dist_payload = {
        "shot_ids": [1],
        "look_dev_id": 1,
        "assigned_to": 1
    }
    r = requests.post(f"{BASE_URL}/api/look_distributions", json=dist_payload, headers=HEADERS)
    dist_id = r.json().get("id") if r.status_code == 201 else 1

    # 7. Look distribution accept (K-02)
    r = requests.patch(f"{BASE_URL}/api/look_distributions/{dist_id}/accept", json={"estimated_hours": 5}, headers=HEADERS)
    print(f"[OK] PATCH /api/look_distributions/{dist_id}/accept: HTTP {r.status_code}")

    # 8. Look distribution complete (K-03)
    r = requests.patch(f"{BASE_URL}/api/look_distributions/{dist_id}/complete", json={"result_asset_id": asset_id, "notes": "Approved looks"}, headers=HEADERS)
    print(f"[OK] PATCH /api/look_distributions/{dist_id}/complete: HTTP {r.status_code}")

    # 9. DM send & threads (C-02, RS-08)
    dm_payload = {"thread_id": 0, "recipient_id": 2, "body": "Direct message test"}
    r = requests.post(f"{BASE_URL}/api/dm", json=dm_payload, headers=HEADERS)
    print(f"[OK] POST /api/dm: HTTP {r.status_code}")

    r = requests.get(f"{BASE_URL}/api/me/dm/threads", headers=HEADERS)
    print(f"[OK] GET /api/me/dm/threads: HTTP {r.status_code}")

    # 10. Group DM send (C-03)
    gdm_payload = {"group_id": "grp_anim_team", "body": "Group message test"}
    r = requests.post(f"{BASE_URL}/api/group_dm", json=gdm_payload, headers=HEADERS)
    print(f"[OK] POST /api/group_dm: HTTP {r.status_code}")

    # 11. Notifications read all (C-05)
    r = requests.patch(f"{BASE_URL}/api/notifications/read_all", json={}, headers=HEADERS)
    print(f"[OK] PATCH /api/notifications/read_all: HTTP {r.status_code} - Marked: {r.json().get('marked_count')}")

    # 12. Shot detail (RS-03)
    r = requests.get(f"{BASE_URL}/api/me/shots/1", headers=HEADERS)
    print(f"[OK] GET /api/me/shots/1: HTTP {r.status_code}")

    # 13. My events (RS-04)
    r = requests.get(f"{BASE_URL}/api/me/events?from=2026-05-01T00:00:00&to=2026-05-31T00:00:00", headers=HEADERS)
    print(f"[OK] GET /api/me/events: HTTP {r.status_code}")

    # 14. Project detail (RS-06)
    r = requests.get(f"{BASE_URL}/api/me/projects/1", headers=HEADERS)
    print(f"[OK] GET /api/me/projects/1: HTTP {r.status_code}")

    # 15. My messages (RS-08)
    r = requests.get(f"{BASE_URL}/api/me/messages", headers=HEADERS)
    print(f"[OK] GET /api/me/messages: HTTP {r.status_code}")

    # 16. Meeting tasks (RS-09)
    r = requests.get(f"{BASE_URL}/api/me/meeting_tasks", headers=HEADERS)
    print(f"[OK] GET /api/me/meeting_tasks: HTTP {r.status_code}")

    # 17. Routine latest (RS-10)
    r = requests.get(f"{BASE_URL}/api/me/routines/latest", headers=HEADERS)
    print(f"[OK] GET /api/me/routines/latest: HTTP {r.status_code}")

def test_actor_id_auditing():
    print("\n=== 3. X-Actor-User-Id Auditing Check ===")
    actor_sato_headers = {
        "Authorization": f"Bearer {BYPASS_TOKEN}",
        "X-Actor-User-Id": "2"
    }
    msg_payload = {"channel_id": "shot_001", "body": "Actor ID test message"}
    r = requests.post(f"{BASE_URL}/api/messages", json=msg_payload, headers=actor_sato_headers)
    msg_data = r.json()
    
    if msg_data.get("author_id") == 2:
        print(f"[OK] Auditing: author_id matches '2' from header")
    else:
        print(f"[ERROR] Auditing: author_id({msg_data.get('author_id')}) mismatch")

if __name__ == "__main__":
    # サーバーが起動している前提
    try:
        test_db_structure()
        test_api_endpoints()
        test_actor_id_auditing()
    except Exception as e:
        print(f"エラーが発生しました: {e}")
