from app.database import SessionLocal
from app import task_list
db = SessionLocal()
ctx = task_list.get_dashboard_context(db, 1)
print("proj", len(ctx.get("proj", "")))
print("user_list", len(ctx.get("user_list", "")))
print("csv", len(ctx.get("csv", "")))
print("events", len(ctx.get("events", "")))
print("notes", len(ctx.get("notes", "")))
print("attachments", len(ctx.get("attachments", [])))
