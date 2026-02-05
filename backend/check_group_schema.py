# backend/check_group_schema.py
"""
groupsテーブルのスキーマを確認するスクリプト
"""
import sys
import os

backend_dir = os.path.dirname(os.path.abspath(__file__))
workspace_root = os.path.dirname(backend_dir)
if workspace_root not in sys.path:
    sys.path.insert(0, workspace_root)

from sqlalchemy import text, inspect
from backend.app.database import engine

def check_schema():
    """groupsテーブルのスキーマを確認"""
    inspector = inspect(engine)
    
    # groupsテーブルのカラム情報を取得
    columns = inspector.get_columns('groups')
    
    print("groupsテーブルのカラム一覧:")
    for col in columns:
        print(f"  - {col['name']}: {col['type']}")

if __name__ == "__main__":
    check_schema()
