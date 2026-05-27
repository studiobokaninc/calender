import os
import sqlite3
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# DBファイルのパスを解決
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "app", "project_management.db")

def migrate():
    logger.info(f"Database migration started for: {DB_PATH}")
    if not os.path.exists(DB_PATH):
        logger.error(f"Database file not found: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    def add_column_if_not_exists(table, column, definition):
        # カラムが存在するかチェック
        cursor.execute(f"PRAGMA table_info({table})")
        columns = [row[1] for row in cursor.fetchall()]
        if column not in columns:
            try:
                cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
                conn.commit()
                logger.info(f"Added column '{column}' to table '{table}'.")
            except Exception as e:
                conn.rollback()
                logger.error(f"Failed to add column '{column}' to table '{table}': {e}")
        else:
            logger.info(f"Column '{column}' in table '{table}' already exists. Skipping.")

    # 1. events テーブル拡張
    add_column_if_not_exists("events", "meeting_url", "TEXT NULL")
    add_column_if_not_exists("events", "minutes_id", "INTEGER REFERENCES meetings(id) NULL")

    # 2. meetings テーブル拡張
    add_column_if_not_exists("meetings", "event_id", "INTEGER REFERENCES events(id) NULL")
    add_column_if_not_exists("meetings", "attendees", "JSON NULL")

    # 3. users テーブル拡張 (avatar_url, is_active)
    add_column_if_not_exists("users", "avatar_url", "TEXT NULL")
    add_column_if_not_exists("users", "is_active", "BOOLEAN NOT NULL DEFAULT 1")

    # users.email に対する UNIQUE インデックスの作成
    try:
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)")
        conn.commit()
        logger.info("Created UNIQUE INDEX 'idx_users_email' on users(email).")
    except Exception as e:
        conn.rollback()
        logger.error(f"Failed to create UNIQUE INDEX on users(email): {e}")

    # 4. retake_timecodes テーブル拡張 (paint_image, paint_mime)
    add_column_if_not_exists("retake_timecodes", "paint_image", "TEXT NULL")
    add_column_if_not_exists("retake_timecodes", "paint_mime", "VARCHAR(50) NOT NULL DEFAULT 'image/png'")

    # 5. users テーブル拡張 (§5-bis ユーザープロフィール拡張)
    add_column_if_not_exists("users", "birthday", "DATE NULL")
    add_column_if_not_exists("users", "bio", "TEXT NULL")
    add_column_if_not_exists("users", "phone", "VARCHAR(50) NULL")
    add_column_if_not_exists("users", "line_id", "VARCHAR(100) NULL")
    add_column_if_not_exists("users", "work_start_time", "VARCHAR(20) NULL")
    add_column_if_not_exists("users", "work_end_time", "VARCHAR(20) NULL")
    add_column_if_not_exists("users", "skills", "JSON NULL")
    add_column_if_not_exists("users", "settings_json", "JSON NULL")
    add_column_if_not_exists("users", "google_linked", "BOOLEAN NOT NULL DEFAULT 0")
    add_column_if_not_exists("users", "google_email", "VARCHAR(255) NULL")

    conn.close()
    logger.info("Database migration completed successfully.")

if __name__ == "__main__":
    migrate()
