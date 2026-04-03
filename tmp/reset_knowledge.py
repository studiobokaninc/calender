
import sys
import os
from pathlib import Path

# backend/app をパスに追加してモデルを読み込めるようにする
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from app.database import SessionLocal, engine
from app import models
from sqlalchemy import text

def reset_knowledge():
    db = SessionLocal()
    print("Connecting to database to reset knowledge...")
    try:
        # 1. データの削除を試みる
        print("Clearing knowledge_tags and knowledge_items tables...")
        db.execute(text("DELETE FROM knowledge_tags"))
        db.execute(text("DELETE FROM knowledge_items"))
        db.commit()
        print("Successfully cleared knowledge records.")
    except Exception as e:
        print(f"Error during deletion: {e}")
        print("Knowledge tables might be corrupted. Attempting to drop and recreate them...")
        db.rollback()
        try:
            # テーブル自体が壊れている場合は一度消して再作成
            db.execute(text("DROP TABLE IF EXISTS knowledge_tags"))
            db.execute(text("DROP TABLE IF EXISTS knowledge_items"))
            db.commit()
            # models.Base.metadata.create_all を使って再定義されたテーブルを作成
            models.Base.metadata.create_all(bind=engine)
            print("Successfully recreated knowledge tables.")
        except Exception as e2:
            print(f"Critical error: Could not even recreate tables: {e2}")
    finally:
        db.close()

if __name__ == "__main__":
    reset_knowledge()
    
    # ChromaDBフォルダの削除（もし存在すれば）
    chroma_path = Path(r"E:\calender\backend\data\chroma")
    if chroma_path.exists():
        print(f"Deleting chroma directory at {chroma_path}...")
        import shutil
        try:
            shutil.rmtree(chroma_path)
            print("Successfully deleted chroma directory.")
        except Exception as e:
            print(f"Failed to delete chroma directory: {e}")
    else:
        print("Chroma directory not found, skipping.")
