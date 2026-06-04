from sqlalchemy import create_engine
# from sqlalchemy.ext.declarative import declarative_base # 古いスタイル
from sqlalchemy.orm import sessionmaker, DeclarativeBase # 新しいスタイルをインポート
import os
from pathlib import Path # pathlib をインポート

# このファイル (database.py) のディレクトリを取得
DATABASE_DIR = Path(__file__).parent
# データベースファイルの絶対パスを構築
DATABASE_FILE_PATH = DATABASE_DIR / "project_management.db"

SQLALCHEMY_DATABASE_URL = f"sqlite:///{DATABASE_FILE_PATH.resolve()}" # 絶対パスを使用

print(f"Database URL: {SQLALCHEMY_DATABASE_URL}") # パスを確認するためのログ出力

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, 
    connect_args={"check_same_thread": False, "timeout": 30.0}
)

# Enable WAL mode for SQLite to handle concurrent background tasks
from sqlalchemy import event
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
    except Exception:
        pass  # WAL mode unsupported on some filesystems (e.g. NTFS via WSL2)
    finally:
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base = declarative_base() # 古いスタイル
class Base(DeclarativeBase): # 新しいスタイルで Base を定義
    pass

# 依存性注入用の関数
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close() 