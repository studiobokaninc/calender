
import sqlite3
import os
import sys

# データベースファイルのパス
# database.py と同様に app/project_management.db を指す
db_path = os.path.join(os.path.dirname(__file__), 'app', 'project_management.db')

if not os.path.exists(db_path):
    print(f"エラー: データベースファイルが見つかりません: {db_path}")
    sys.exit(1)

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # 既存のカラムを確認
    cursor.execute("PRAGMA table_info(tasks)")
    columns = [row[1] for row in cursor.fetchall()]
    print(f"既存のカラム: {columns}")
    
    # phasesカラムが存在しない場合のみ追加
    if 'phases' not in columns:
        print("phasesカラムを追加しています...")
        # JSON型として追加（SQLiteではTEXTとして扱われるが、型定義としてはJSONを指定可能）
        # ただし、互換性を考慮してTEXTまたはJSONとする。SQLAlchemyではJSON型は通常JSONまたはTEXTにマップされる。
        cursor.execute("ALTER TABLE tasks ADD COLUMN phases JSON")
        conn.commit()
        print("phasesカラムを追加しました")
    else:
        print("phasesカラムは既に存在します")
    
    # 確認
    cursor.execute("PRAGMA table_info(tasks)")
    columns = [row[1] for row in cursor.fetchall()]
    print(f"更新後のカラム: {columns}")
    
    conn.close()
    print("完了しました")
    
except sqlite3.Error as e:
    print(f"エラーが発生しました: {e}")
    sys.exit(1)
