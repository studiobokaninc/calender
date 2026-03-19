"""
無効なtype値を持つタスクを検索
"""
import sqlite3

def find_invalid_types():
    conn = sqlite3.connect('./app/project_management.db')
    cursor = conn.cursor()
    
    valid_types = [
        'design', 'documentation', 'testing', 'review', 'meeting',
        'fx', 'asset', 'animation', 'lighting', 'comp'
    ]
    
    # すべてのタスクのtype値を取得
    cursor.execute('SELECT id, name, type, seqID, shotID FROM tasks WHERE type IS NOT NULL')
    rows = cursor.fetchall()
    
    invalid_tasks = []
    for row in rows:
        task_id, name, task_type, seq_id, shot_id = row
        if task_type.lower() not in valid_types:
            invalid_tasks.append((task_id, name, task_type, seq_id, shot_id))
    
    print(f"無効なtype値を持つタスク: {len(invalid_tasks)} 件")
    print("=" * 80)
    
    if invalid_tasks:
        for task_id, name, task_type, seq_id, shot_id in invalid_tasks:
            print(f"ID {task_id}: {name[:40]}")
            print(f"  type='{task_type}', seqID='{seq_id}', shotID='{shot_id}'")
            print()
    else:
        print("無効なtype値は見つかりませんでした。")
    
    # type列のユニーク値を表示
    print("\n" + "=" * 80)
    print("type列のユニーク値:")
    cursor.execute('SELECT DISTINCT type FROM tasks WHERE type IS NOT NULL ORDER BY type')
    unique_types = cursor.fetchall()
    for (t,) in unique_types:
        is_valid = t.lower() in valid_types
        status = "OK" if is_valid else "NG"
        print(f"  [{status}] '{t}'")
    
    conn.close()

if __name__ == "__main__":
    find_invalid_types()

