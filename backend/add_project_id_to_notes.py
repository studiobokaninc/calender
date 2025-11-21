#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""notesテーブルにproject_idカラムを追加するスクリプト"""

import sqlite3
import os
import sys

# データベースファイルのパス
db_path = os.path.join(os.path.dirname(__file__), 'app', 'project_management.db')

if not os.path.exists(db_path):
    print(f"エラー: データベースファイルが見つかりません: {db_path}")
    sys.exit(1)

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # 既存のカラムを確認
    cursor.execute("PRAGMA table_info(notes)")
    columns = [row[1] for row in cursor.fetchall()]
    print(f"既存のカラム: {columns}")
    
    # project_idカラムが存在しない場合のみ追加
    if 'project_id' not in columns:
        print("project_idカラムを追加しています...")
        cursor.execute("ALTER TABLE notes ADD COLUMN project_id INTEGER")
        conn.commit()
        print("project_idカラムを追加しました")
    else:
        print("project_idカラムは既に存在します")
    
    # 確認
    cursor.execute("PRAGMA table_info(notes)")
    columns = [row[1] for row in cursor.fetchall()]
    print(f"更新後のカラム: {columns}")
    
    conn.close()
    print("完了しました")
    
except sqlite3.Error as e:
    print(f"エラーが発生しました: {e}")
    sys.exit(1)

