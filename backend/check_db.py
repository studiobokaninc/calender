"""
データベースの内容を確認するスクリプト
"""
import sqlite3
import sys

def check_database():
    """データベースの内容を確認"""
    try:
        conn = sqlite3.connect('./app/project_management.db')
        cursor = conn.cursor()
        
        print("=" * 100)
        print("タスクのtype列の値を確認")
        print("=" * 100)
        
        # タスクのtype値を確認
        cursor.execute("""
            SELECT id, name, type, seqID, shotID, priority 
            FROM tasks 
            ORDER BY id
            LIMIT 30
        """)
        rows = cursor.fetchall()
        
        print(f"\n{'ID':<5} | {'タスク名':<30} | {'type':<15} | {'seqID':<10} | {'shotID':<10} | {'priority':<10}")
        print("-" * 100)
        
        invalid_types = []
        valid_types = [
            'development', 'design', 'documentation', 'testing', 
            'review', 'meeting', 'fx', 'asset', 'animation', 
            'lighting', 'comp'
        ]
        
        for row in rows:
            task_id, name, task_type, seq_id, shot_id, priority = row
            name_short = (name[:27] + '...') if len(name) > 30 else name
            
            # type値をチェック
            is_invalid = task_type and task_type.lower() not in valid_types
            marker = " ⚠️ 無効" if is_invalid else ""
            
            print(f"{task_id:<5} | {name_short:<30} | {task_type or 'NULL':<15} | {seq_id or '':<10} | {shot_id or '':<10} | {priority or '':<10}{marker}")
            
            if is_invalid:
                invalid_types.append((task_id, name, task_type))
        
        print("\n" + "=" * 100)
        print(f"無効なtype値を持つタスク: {len(invalid_types)} 件")
        print("=" * 100)
        
        if invalid_types:
            print("\n無効なタスクの詳細:")
            for task_id, name, task_type in invalid_types:
                print(f"  - タスクID {task_id}: {name[:40]} (type='{task_type}')")
        
        # 統計情報
        print("\n" + "=" * 100)
        print("データベース統計")
        print("=" * 100)
        
        cursor.execute("SELECT COUNT(*) FROM tasks")
        total_tasks = cursor.fetchone()[0]
        print(f"総タスク数: {total_tasks}")
        
        cursor.execute("SELECT COUNT(*) FROM projects")
        total_projects = cursor.fetchone()[0]
        print(f"総プロジェクト数: {total_projects}")
        
        cursor.execute("SELECT COUNT(*) FROM users")
        total_users = cursor.fetchone()[0]
        print(f"総ユーザー数: {total_users}")
        
        # type列のユニークな値を確認
        print("\n" + "=" * 100)
        print("type列に含まれるユニークな値")
        print("=" * 100)
        cursor.execute("SELECT DISTINCT type FROM tasks WHERE type IS NOT NULL ORDER BY type")
        unique_types = cursor.fetchall()
        for (utype,) in unique_types:
            is_valid = utype.lower() in valid_types
            status = "✓ 有効" if is_valid else "✗ 無効"
            print(f"  {status}: '{utype}'")
        
        conn.close()
        
    except Exception as e:
        print(f"エラーが発生しました: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    check_database()

