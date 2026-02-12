#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""usersテーブルにbase_load_hours_per_weekカラムを追加するスクリプト"""

import sqlite3
import os
import sys
from pathlib import Path

# このスクリプトがあるディレクトリ（backend）を基準にDBパスを絶対パスで取得
SCRIPT_DIR = Path(__file__).resolve().parent
db_path = SCRIPT_DIR / "app" / "project_management.db"
db_path = str(db_path)

print(f"使用するDBパス: {db_path}")

if not os.path.exists(db_path):
    print(f"エラー: データベースファイルが見つかりません: {db_path}")
    print(f"  スクリプトの場所: {SCRIPT_DIR}")
    sys.exit(1)

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("PRAGMA table_info(users)")
    columns = [row[1] for row in cursor.fetchall()]
    print(f"既存のカラム: {columns}")

    if 'base_load_hours_per_week' not in columns:
        print("base_load_hours_per_weekカラムを追加しています...")
        cursor.execute("ALTER TABLE users ADD COLUMN base_load_hours_per_week REAL DEFAULT 0.0")
        conn.commit()
        print("base_load_hours_per_weekカラムを追加しました")
    else:
        print("base_load_hours_per_weekカラムは既に存在します")

    cursor.execute("PRAGMA table_info(users)")
    columns = [row[1] for row in cursor.fetchall()]
    print(f"更新後のカラム: {columns}")

    conn.close()
    print("完了しました")

except sqlite3.Error as e:
    print(f"エラーが発生しました: {e}")
    sys.exit(1)
