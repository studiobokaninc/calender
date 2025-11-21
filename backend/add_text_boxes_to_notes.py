#!/usr/bin/env python3
"""notesテーブルにtext_boxesカラムを追加するスクリプト"""
import sqlite3
import os
from pathlib import Path

# データベースファイルのパス（現在のスクリプトのディレクトリを基準にする）
SCRIPT_DIR = Path(__file__).parent.absolute()
DB_PATH = SCRIPT_DIR / 'app' / 'project_management.db'
print(f"Database path: {DB_PATH}")

def add_text_boxes_column():
    """text_boxesカラムを追加"""
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    
    try:
        # カラムが存在するか確認
        cursor.execute("PRAGMA table_info(notes)")
        columns = [col[1] for col in cursor.fetchall()]
        
        if 'text_boxes' not in columns:
            # カラムを追加
            cursor.execute("ALTER TABLE notes ADD COLUMN text_boxes JSON")
            conn.commit()
            print("text_boxesカラムを追加しました")
        else:
            print("text_boxesカラムは既に存在します")
            
    except Exception as e:
        print(f"エラーが発生しました: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    add_text_boxes_column()

