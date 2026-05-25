
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
        
        # version_groupカラムが存在しない場合のみ追加
        if 'version_group' not in meeting_columns:
            print("version_groupカラムが見つかりません。追加しています...")
            cursor.execute("ALTER TABLE meetings ADD COLUMN version_group VARCHAR(255)")
            conn.commit()
            print("version_groupカラムを追加しました。")

        # 既存データのステータス不整合を修正（transcriptがあるのにpendingになっているもの、
        # またはマイグレーションの順序で更新が漏れたものへの対応）
        cursor.execute("UPDATE meetings SET status = 'completed' WHERE transcript IS NOT NULL AND status = 'pending'")
        conn.commit()

        # chat_messagesテーブルの作成
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id VARCHAR(255),
                role VARCHAR(50),
                content TEXT,
                user_id INTEGER,
                created_at DATETIME,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON chat_messages(conversation_id)")
        conn.commit()
        print("chat_messagesテーブルを確認・作成しました。")

        # knowledge_itemsテーブルの作成
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS knowledge_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title VARCHAR(255),
                project_id INTEGER,
                file_name VARCHAR(255),
                file_path TEXT,
                file_type VARCHAR(50),
                status VARCHAR(50),
                summary TEXT,
                content_text TEXT,
                metadata_json JSON,
                created_by INTEGER,
                created_at DATETIME,
                updated_at DATETIME,
                FOREIGN KEY(project_id) REFERENCES projects(id),
                FOREIGN KEY(created_by) REFERENCES users(id)
            )
        """)
        
        # knowledge_tagsテーブルの作成
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS knowledge_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                knowledge_item_id INTEGER,
                name VARCHAR(100),
                FOREIGN KEY(knowledge_item_id) REFERENCES knowledge_items(id)
            )
        """)
        conn.commit()
        print("knowledge_items/tagsテーブルを確認・作成しました。")

        # shotsテーブルの作成
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS shots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                seq_code VARCHAR(50) NOT NULL,
                shot_code VARCHAR(50) NOT NULL,
                display_order INTEGER DEFAULT 0,
                status VARCHAR(50) DEFAULT 'planning',
                thumbnail_url TEXT,
                description TEXT,
                created_at DATETIME,
                updated_at DATETIME,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                UNIQUE(project_id, seq_code, shot_code)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_shots_project ON shots(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_shots_seq ON shots(project_id, seq_code)")
        conn.commit()
        print("shotsテーブルを確認・作成しました。")

        # tasksテーブルにshot_idカラムが存在するか確認して追加
        if 'shot_id' not in task_columns:
            print("shot_idカラムが見つかりません。追加しています...")
            cursor.execute("ALTER TABLE tasks ADD COLUMN shot_id INTEGER REFERENCES shots(id) ON DELETE SET NULL")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_shot ON tasks(shot_id)")
            conn.commit()
            print("shot_idカラムを追加しました。")
        
        # --- Score Related Tables ---
        
        # score_user_roles
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS score_user_roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                project_id INTEGER NOT NULL,
                role VARCHAR(50) NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                UNIQUE(user_id, project_id, role)
            )
        """)
        
        # retakes
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS retakes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                shot_id INTEGER NOT NULL,
                overall_comment TEXT,
                status VARCHAR(50) DEFAULT 'open',
                priority VARCHAR(50),
                deadline DATETIME,
                created_by INTEGER NOT NULL,
                created_at DATETIME,
                FOREIGN KEY(shot_id) REFERENCES shots(id) ON DELETE CASCADE,
                FOREIGN KEY(created_by) REFERENCES users(id)
            )
        """)
        
        # retake_timecodes
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS retake_timecodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                retake_id INTEGER NOT NULL,
                timecode VARCHAR(20),
                comment TEXT,
                FOREIGN KEY(retake_id) REFERENCES retakes(id) ON DELETE CASCADE
            )
        """)
        
        # change_requests
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS change_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                shot_id INTEGER,
                task_id INTEGER,
                type VARCHAR(50),
                proposed_value TEXT,
                reason TEXT,
                status VARCHAR(50) DEFAULT 'pending',
                created_by INTEGER NOT NULL,
                created_at DATETIME,
                FOREIGN KEY(shot_id) REFERENCES shots(id),
                FOREIGN KEY(task_id) REFERENCES tasks(id),
                FOREIGN KEY(created_by) REFERENCES users(id)
            )
        """)
        
        # troubles
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS troubles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                shot_id INTEGER NOT NULL,
                category VARCHAR(50),
                description TEXT NOT NULL,
                severity VARCHAR(50),
                status VARCHAR(50) DEFAULT 'open',
                assigned_to INTEGER,
                created_by INTEGER NOT NULL,
                created_at DATETIME,
                FOREIGN KEY(shot_id) REFERENCES shots(id),
                FOREIGN KEY(assigned_to) REFERENCES users(id),
                FOREIGN KEY(created_by) REFERENCES users(id)
            )
        """)
        
        # look_distributions
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS look_distributions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                shot_ids JSON,
                look_dev_id INTEGER,
                status VARCHAR(50) DEFAULT 'pending',
                assigned_to INTEGER NOT NULL,
                created_by INTEGER NOT NULL,
                created_at DATETIME,
                FOREIGN KEY(assigned_to) REFERENCES users(id),
                FOREIGN KEY(created_by) REFERENCES users(id)
            )
        """)
        
        # user_messages
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id VARCHAR(100),
                shot_id INTEGER,
                body TEXT NOT NULL,
                author_id INTEGER NOT NULL,
                created_at DATETIME,
                FOREIGN KEY(shot_id) REFERENCES shots(id),
                FOREIGN KEY(author_id) REFERENCES users(id)
            )
        """)
        
        # notifications
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipient_id INTEGER NOT NULL,
                type VARCHAR(50),
                body TEXT NOT NULL,
                is_read BOOLEAN DEFAULT 0,
                created_at DATETIME,
                FOREIGN KEY(recipient_id) REFERENCES users(id)
            )
        """)
        
        # timecards
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS timecards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                date DATETIME,
                clock_out_at DATETIME,
                worked_minutes INTEGER DEFAULT 0,
                break_minutes INTEGER DEFAULT 0,
                memo TEXT,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        """)
        
        # routines
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS routines (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                date DATETIME,
                condition VARCHAR(50),
                blockers JSON,
                ai_priorities_adopted JSON,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        """)
        
        # look_distributions の既存のカラムを確認・追加
        cursor.execute("PRAGMA table_info(look_distributions)")
        look_columns = [row[1] for row in cursor.fetchall()]
        if 'estimated_hours' not in look_columns:
            print("estimated_hoursカラムが見つかりません。追加しています...")
            cursor.execute("ALTER TABLE look_distributions ADD COLUMN estimated_hours INTEGER")
        if 'result_asset_id' not in look_columns:
            print("result_asset_idカラムが見つかりません。追加しています...")
            cursor.execute("ALTER TABLE look_distributions ADD COLUMN result_asset_id INTEGER")
        if 'notes' not in look_columns:
            print("notesカラムが見つかりません。追加しています...")
            cursor.execute("ALTER TABLE look_distributions ADD COLUMN notes TEXT")

        # user_messages の既存のカラムを確認・追加
        cursor.execute("PRAGMA table_info(user_messages)")
        msg_columns = [row[1] for row in cursor.fetchall()]
        if 'timecode' not in msg_columns:
            print("timecodeカラムが見つかりません。追加しています...")
            cursor.execute("ALTER TABLE user_messages ADD COLUMN timecode VARCHAR(20)")

        # assets テーブルの作成
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                shot_id INTEGER NOT NULL,
                task_id INTEGER,
                version VARCHAR(50) NOT NULL,
                file_path TEXT NOT NULL,
                created_by INTEGER NOT NULL,
                created_at DATETIME,
                FOREIGN KEY(shot_id) REFERENCES shots(id) ON DELETE CASCADE,
                FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL,
                FOREIGN KEY(created_by) REFERENCES users(id)
            )
        """)

        # deliveries テーブルの作成
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS deliveries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                status VARCHAR(50) DEFAULT 'pending',
                qc_status VARCHAR(50),
                memo TEXT,
                created_by INTEGER NOT NULL,
                created_at DATETIME,
                FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY(created_by) REFERENCES users(id)
            )
        """)

        # direct_messages テーブルの作成
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS direct_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_id INTEGER,
                sender_id INTEGER NOT NULL,
                recipient_id INTEGER NOT NULL,
                body TEXT NOT NULL,
                context_json JSON,
                created_at DATETIME,
                FOREIGN KEY(sender_id) REFERENCES users(id),
                FOREIGN KEY(recipient_id) REFERENCES users(id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_direct_messages_thread ON direct_messages(thread_id)")

        # group_direct_messages テーブルの作成
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS group_direct_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id VARCHAR(100) NOT NULL,
                sender_id INTEGER NOT NULL,
                body TEXT NOT NULL,
                created_at DATETIME,
                FOREIGN KEY(sender_id) REFERENCES users(id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_group_direct_messages_group ON group_direct_messages(group_id)")

        conn.commit()
        print("Score 関連テーブルの確認・作成を完了しました。")

        conn.close()
        
    except sqlite3.Error as e:
        print(f"DBマイグレーション中にエラーが発生しました: {e}")

if __name__ == "__main__":
    check_and_migrate_db()
