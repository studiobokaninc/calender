
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
        task_columns = [row[1] for row in cursor.fetchall()]
        
        # phasesカラムが存在しない場合のみ追加
        if 'phases' not in task_columns:
            print("phasesカラムが見つかりません。追加しています...")
            cursor.execute("ALTER TABLE tasks ADD COLUMN phases JSON")
            conn.commit()
            print("phasesカラムを追加しました。")
            
        if 'deliverables' not in task_columns:
            print("deliverablesカラムが見つかりません。追加しています...")
            cursor.execute("ALTER TABLE tasks ADD COLUMN deliverables TEXT")
            conn.commit()
            print("deliverablesカラムを追加しました。")

        if 'check_items' not in task_columns:
            print("check_itemsカラムが見つかりません。追加しています...")
            cursor.execute("ALTER TABLE tasks ADD COLUMN check_items JSON")
            conn.commit()
            print("check_itemsカラムを追加しました。")
            
        # notesテーブルの既存のカラムを確認
        cursor.execute("PRAGMA table_info(notes)")
        note_columns = [row[1] for row in cursor.fetchall()]
        
        if 'audio_urls' not in note_columns:
            print("audio_urlsカラムが見つかりません。追加しています...")
            cursor.execute("ALTER TABLE notes ADD COLUMN audio_urls JSON")
            conn.commit()
            print("audio_urlsカラムを追加しました。")
            
        if 'audio_positions' not in note_columns:
            print("audio_positionsカラムが見つかりません。追加しています...")
            cursor.execute("ALTER TABLE notes ADD COLUMN audio_positions JSON")
            conn.commit()
            print("audio_positionsカラムを追加しました。")
            
        # user_google_tokensテーブルの既存のカラムを確認
        cursor.execute("PRAGMA table_info(user_google_tokens)")
        token_columns = [row[1] for row in cursor.fetchall()]
        
        if 'calendar_id' not in token_columns:
            print("calendar_idカラムが見つかりません。追加しています...")
            cursor.execute("ALTER TABLE user_google_tokens ADD COLUMN calendar_id VARCHAR(255)")
            conn.commit()
            print("calendar_idカラムを追加しました。")
        
        # meetingsテーブルの既存のカラムを確認
        cursor.execute("PRAGMA table_info(meetings)")
        meeting_columns = [row[1] for row in cursor.fetchall()]

        if 'status' not in meeting_columns:
            print("statusカラムが見つかりません。追加しています...")
            cursor.execute("ALTER TABLE meetings ADD COLUMN status VARCHAR(50) DEFAULT 'pending'")
            conn.commit()
            print("statusカラムを追加しました。")
            
            # 既に内容があるものは「完了」に更新（マイグレーション時のみ）
            print("既存のデータのステータスを更新しています...")
            cursor.execute("UPDATE meetings SET status = 'completed' WHERE transcript IS NOT NULL AND (status IS NULL OR status = 'pending')")
            conn.commit()
            print("既存のデータのステータスを更新しました。")
        # 既存データのステータス不整合を修正（transcriptがあるのにpendingになっているもの、
        # またはマイグレーションの順序で更新が漏れたものへの対応）
        cursor.execute("UPDATE meetings SET status = 'completed' WHERE transcript IS NOT NULL AND status = 'pending'")
        conn.commit()

        conn.close()
        
    except sqlite3.Error as e:
        print(f"DBマイグレーション中にエラーが発生しました: {e}")

if __name__ == "__main__":
    check_and_migrate_db()
