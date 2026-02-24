import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), 'app', 'project_management.db')
if not os.path.exists(db_path):
    print(f"DB not found at {db_path}")
else:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE notes ADD COLUMN audio_urls JSON")
        print("Added audio_urls")
    except Exception as e:
        print(e)
    try:
        cursor.execute("ALTER TABLE notes ADD COLUMN audio_positions JSON")
        print("Added audio_positions")
    except Exception as e:
        print(e)
    conn.commit()
    conn.close()
