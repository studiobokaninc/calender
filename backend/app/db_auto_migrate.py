
import sqlite3
import os
import sys

def check_and_migrate_db():
    # データベースファイルのパス
    db_path = os.path.join(os.path.dirname(__file__), 'project_management.db')

    if not os.path.exists(db_path):
        print(f"データベースファイルが見つかりません: {db_path} (新規作成されるため問題ありません)")
        return

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # tasksテーブルの既存のカラムを確認
        cursor.execute("PRAGMA table_info(tasks)")
        columns = [row[1] for row in cursor.fetchall()]
        
        # phasesカラムが存在しない場合のみ追加
        if 'phases' not in columns:
            print("phasesカラムが見つかりません。追加しています...")
            cursor.execute("ALTER TABLE tasks ADD COLUMN phases JSON")
            conn.commit()
            print("phasesカラムを追加しました。")
        
        conn.close()
        
    except sqlite3.Error as e:
        print(f"DBマイグレーション中にエラーが発生しました: {e}")

if __name__ == "__main__":
    check_and_migrate_db()
