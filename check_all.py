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
        # Get all items ordered by ID desc
        items = db.query(models.KnowledgeItem).order_by(models.KnowledgeItem.id.desc()).all()
        for item in items:
             print(f"ID: {item.id} | Title: {item.title} | Status: {item.status}")
             print(f"Summary: '{item.summary[:50]}...'" if item.summary else "Summary: None")
             print("-" * 20)
    finally:
        db.close()

if __name__ == "__main__":
    check_item()
