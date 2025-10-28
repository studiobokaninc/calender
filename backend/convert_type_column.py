"""
タスクのtype列をEnum型からString型に変更するスクリプト
SQLiteで列の型を変更するための移行処理
"""
import sqlite3
import sys

def convert_type_column():
    """type列を再作成してString型に変更"""
    try:
        conn = sqlite3.connect('./app/project_management.db')
        cursor = conn.cursor()
        
        print("=" * 80)
        print("タスクのtype列をEnum型からString型に変更します")
        print("=" * 80)
        
        # 1. 現在のtype列の値を確認
        cursor.execute("SELECT DISTINCT type FROM tasks WHERE type IS NOT NULL")
        existing_types = cursor.fetchall()
        print(f"\n既存のtype値: {[t[0] for t in existing_types]}")
        
        # 2. バックアップテーブルを作成
        print("\n1. tasksテーブルのバックアップを作成中...")
        cursor.execute("DROP TABLE IF EXISTS tasks_backup")
        cursor.execute("""
            CREATE TABLE tasks_backup AS 
            SELECT * FROM tasks
        """)
        print("   ✓ バックアップ完了")
        
        # 3. 新しいtasksテーブルを作成（typeをVARCHAR型に）
        print("\n2. 新しいtasksテーブルを作成中...")
        cursor.execute("DROP TABLE IF EXISTS tasks_new")
        cursor.execute("""
            CREATE TABLE tasks_new (
                id INTEGER PRIMARY KEY,
                project_id INTEGER,
                name VARCHAR NOT NULL,
                description TEXT,
                assigned_to INTEGER,
                due_date DATETIME,
                status VARCHAR,
                priority VARCHAR,
                type VARCHAR,
                start_date DATETIME,
                progress INTEGER,
                cost FLOAT,
                "dependsOn" JSON,
                "shotID" VARCHAR,
                "seqID" VARCHAR,
                created_at DATETIME,
                display_status VARCHAR DEFAULT 'online',
                updated_at DATETIME,
                FOREIGN KEY(project_id) REFERENCES projects(id),
                FOREIGN KEY(assigned_to) REFERENCES users(id)
            )
        """)
        print("   ✓ 新テーブル作成完了")
        
        # 4. データをコピー
        print("\n3. データを新テーブルにコピー中...")
        cursor.execute("""
            INSERT INTO tasks_new 
            SELECT * FROM tasks_backup
        """)
        rows_copied = cursor.rowcount
        print(f"   ✓ {rows_copied}件のデータをコピー完了")
        
        # 5. インデックスを再作成
        print("\n4. インデックスを再作成中...")
        cursor.execute("CREATE INDEX ix_tasks_name ON tasks_new(name)")
        cursor.execute("CREATE INDEX ix_tasks_display_status ON tasks_new(display_status)")
        cursor.execute('CREATE INDEX "ix_tasks_shotID" ON tasks_new("shotID")')
        cursor.execute('CREATE INDEX "ix_tasks_seqID" ON tasks_new("seqID")')
        print("   ✓ インデックス作成完了")
        
        # 6. 古いテーブルを削除し、新テーブルをリネーム
        print("\n5. テーブルを入れ替え中...")
        cursor.execute("DROP TABLE tasks")
        cursor.execute("ALTER TABLE tasks_new RENAME TO tasks")
        print("   ✓ テーブル入れ替え完了")
        
        # 7. 変更をコミット
        conn.commit()
        
        print("\n" + "=" * 80)
        print("✓ type列の型変更が完了しました！")
        print("=" * 80)
        print("\n変更内容:")
        print("  - type列: Enum型 → String型")
        print("  - 任意のタスクタイプ値を保存可能になりました")
        print(f"  - {rows_copied}件のタスクデータを保持")
        
        conn.close()
        
    except Exception as e:
        print(f"\n❌ エラーが発生しました: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    print("\n⚠️  このスクリプトはデータベースの構造を変更します")
    print("⚠️  バックエンドサーバーを停止してから実行してください\n")
    
    response = input("続行しますか？ (yes/no): ")
    if response.lower() in ['yes', 'y']:
        convert_type_column()
        print("\n完了しました！バックエンドサーバーを再起動してください。")
    else:
        print("キャンセルしました")

