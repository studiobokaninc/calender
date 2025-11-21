"""メモテーブルを作成するスクリプト"""
import sys
from pathlib import Path

# appディレクトリをパスに追加
sys.path.insert(0, str(Path(__file__).parent))

from app.database import engine
from app.models import Base, Note

def create_notes_table():
    """メモテーブルを作成"""
    try:
        # メモテーブルが存在するか確認
        Note.__table__.create(engine, checkfirst=True)
        print("[OK] メモテーブルが正常に作成されました（既に存在する場合はスキップされました）")
        return True
    except Exception as e:
        print(f"[ERROR] メモテーブルの作成に失敗しました: {e}")
        return False

if __name__ == "__main__":
    print("メモテーブルを作成しています...")
    success = create_notes_table()
    if success:
        print("完了しました。")
    else:
        print("エラーが発生しました。")
        sys.exit(1)

