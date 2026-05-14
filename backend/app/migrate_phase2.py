import sqlite3
import os

def migrate_phase2():
    db_path = os.path.join(os.path.dirname(__file__), 'project_management.db')
    if not os.path.exists(db_path):
        print(f"Error: Database file not found at {db_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    print("=== Phase 2: shots テーブル新設とデータ移行 ===")
    cursor.execute("SELECT id, project_id, seqID, shotID FROM tasks WHERE seqID IS NOT NULL AND shotID IS NOT NULL AND seqID != '' AND shotID != ''")
    shot_tasks = cursor.fetchall()
    print(f"対象タスク件数: {len(shot_tasks)} 件")

    unique_shots = {} # (project_id, seq_code, shot_code) -> None
    for t_id, p_id, seq, shot in shot_tasks:
        key = (p_id, seq.strip(), shot.strip())
        unique_shots[key] = True

    print(f"生成するショットユニーク数: {len(unique_shots)} 件")
    
    shots_inserted = 0
    for p_id, seq, shot in unique_shots.keys():
        cursor.execute("SELECT id FROM shots WHERE project_id = ? AND seq_code = ? AND shot_code = ?", (p_id, seq, shot))
        row = cursor.fetchone()
        if not row:
            cursor.execute("INSERT INTO shots (project_id, seq_code, shot_code, status) VALUES (?, ?, ?, 'planning')", (p_id, seq, shot))
            shots_inserted += 1

    conn.commit()
    print(f"新規ショット作成数: {shots_inserted} 件")

    # タスクの shot_id を更新
    tasks_linked = 0
    for t_id, p_id, seq, shot in shot_tasks:
        s_seq = seq.strip()
        s_shot = shot.strip()
        cursor.execute("SELECT id FROM shots WHERE project_id = ? AND seq_code = ? AND shot_code = ?", (p_id, s_seq, s_shot))
        row = cursor.fetchone()
        if row:
            shot_id = row[0]
            cursor.execute("UPDATE tasks SET shot_id = ? WHERE id = ?", (shot_id, t_id))
            tasks_linked += 1

    conn.commit()
    print(f"タスクへの shot_id リンク完了: {tasks_linked} 件")

    # 整合性検証
    print("\n=== 整合性検証 ===")
    cursor.execute("SELECT count(*) FROM tasks WHERE shot_id IS NOT NULL")
    linked_total = cursor.fetchone()[0]
    print(f"shot_id が NOT NULL のタスク数: {linked_total} 件")

    cursor.execute("SELECT count(*) FROM shots")
    shots_total = cursor.fetchone()[0]
    print(f"shots テーブルの総レコード数: {shots_total} 件")

    conn.close()
    print("Phase 2 マイグレーション正常終了。")

if __name__ == "__main__":
    migrate_phase2()
