from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models import Base, Task, TaskPriority
from app.database import SQLALCHEMY_DATABASE_URL

# データベース接続の設定
engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def update_task_priorities():
    db = SessionLocal()
    try:
        # すべてのタスクを取得
        tasks = db.query(Task).all()
        
        # 各タスクの優先度を大文字に更新
        for task in tasks:
            if task.priority:
                task.priority = TaskPriority[task.priority.value.upper()]
        
        # 変更を保存
        db.commit()
        print("タスクの優先度を大文字に更新しました。")
    except Exception as e:
        print(f"エラーが発生しました: {str(e)}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    update_task_priorities() 