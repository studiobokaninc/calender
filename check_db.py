import os
import sys

# Define the path to project base
project_path = r'e:\calender\backend'
sys.path.append(project_path)

from app.database import SessionLocal
from app import models, crud

def check_item():
    db = SessionLocal()
    try:
        # Get item 20
        item = db.query(models.KnowledgeItem).filter(models.KnowledgeItem.id == 20).first()
        if item:
            print(f"ID: {item.id} | File Type in DB: '{item.file_type}'")
        else:
            print("Not found")
    finally:
        db.close()

if __name__ == "__main__":
    check_item()
