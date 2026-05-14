import sqlite3
import os

VALID_TASK_TYPES = {
    "animation", "layout", "comp", "fx", "lighting", "asset", 
    "programming", "design", "testing", "documentation", 
    "shoot", "gs", "report", "other"
}

def migrate_phase1():
    db_path = os.path.join(os.path.dirname(__file__), 'project_management.db')
    if not os.path.exists(db_path):
        print(f"Error: Database file not found at {db_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    print("=== Phase 1: task.type 正規化 + typo 修繕 ===")
    cursor.execute("SELECT id, type FROM tasks")
    tasks = cursor.fetchall()

    phase1_updated_count = 0
    aseet_fixed_count = 0

    for task_id, t_type in tasks:
        orig_type = t_type
        if not t_type or not t_type.strip():
            new_type = "other"
        else:
            new_type = t_type.strip().lower()
            if new_type == "aseet":
                new_type = "asset"
                aseet_fixed_count += 1
            elif new_type == "anim":
                new_type = "animation"

            if new_type not in VALID_TASK_TYPES:
                new_type = "other"

        if orig_type != new_type:
            cursor.execute("UPDATE tasks SET type = ? WHERE id = ?", (new_type, task_id))
            phase1_updated_count += 1

    conn.commit()
    print(f"Phase 1 完了: {phase1_updated_count} 件の task.type を正規化しました (うち aseet 修正 {aseet_fixed_count} 件)。")
    conn.close()
    print("Phase 1 マイグレーション正常終了。")

if __name__ == "__main__":
    migrate_phase1()
