# backend/migrate_add_group_dates.py
"""
グループテーブルにstart_dateとend_dateカラムを追加するマイグレーションスクリプト
"""
import sys
import os

# Allow sibling imports
backend_dir = os.path.dirname(os.path.abspath(__file__))
workspace_root = os.path.dirname(backend_dir)
if workspace_root not in sys.path:
    sys.path.insert(0, workspace_root)

from sqlalchemy import text
from backend.app.database import engine

def migrate():
    """groupsテーブルにstart_dateとend_dateカラムを追加"""
    with engine.connect() as conn:
        try:
            # カラムが存在するかチェック（SQLiteでは直接チェックできないため、エラーハンドリングで対応）
            # start_dateカラムを追加
            try:
                conn.execute(text("ALTER TABLE groups ADD COLUMN start_date DATETIME"))
                conn.commit()
                print("[OK] start_dateカラムを追加しました")
            except Exception as e:
                error_msg = str(e).lower()
                if "duplicate column" in error_msg or "already exists" in error_msg or "既に存在" in str(e):
                    print("  start_dateカラムは既に存在します")
                else:
                    print(f"  start_dateカラム追加時のエラー: {e}")
                    # SQLiteのエラーメッセージを確認
                    if "no such column" not in error_msg:
                        raise
            
            # end_dateカラムを追加
            try:
                conn.execute(text("ALTER TABLE groups ADD COLUMN end_date DATETIME"))
                conn.commit()
                print("[OK] end_dateカラムを追加しました")
            except Exception as e:
                error_msg = str(e).lower()
                if "duplicate column" in error_msg or "already exists" in error_msg or "既に存在" in str(e):
                    print("  end_dateカラムは既に存在します")
                else:
                    print(f"  end_dateカラム追加時のエラー: {e}")
                    # SQLiteのエラーメッセージを確認
                    if "no such column" not in error_msg:
                        raise
            
            print("マイグレーションが完了しました")
        except Exception as e:
            print(f"マイグレーションエラー: {e}")
            conn.rollback()
            raise

if __name__ == "__main__":
    migrate()
