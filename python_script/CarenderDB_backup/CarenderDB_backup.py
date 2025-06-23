# -*- coding: utf-8 -*-
"""
Created on Mon Jun  2 12:20:56 2025

@author: bokan
"""

import os
import shutil
import time
from datetime import datetime

# === 設定 ===
source_file = 'E:/calender/backend/app/project_management.db'         # コピー元ファイルのパス
backup_dir = 'E:/calender/backend/app/backup_db'     # バックアップ先フォルダ

# === メイン処理 ===
def backup_file():
    if not os.path.exists(source_file):
        print(f"指定されたファイルが存在しません: {source_file}")
        return

    if not os.path.exists(backup_dir):
        os.makedirs(backup_dir)

    while True:
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = os.path.basename(source_file)
        name, ext = os.path.splitext(filename)
        backup_filename = f"{name}_{timestamp}{ext}"
        backup_path = os.path.join(backup_dir, backup_filename)

        shutil.copy2(source_file, backup_path)
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] バックアップ作成: {backup_path}")

        time.sleep(43200)   # 12時間（43200秒）

# 実行
if __name__ == "__main__":
    backup_file()
