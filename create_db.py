# create_db.py
from sqlalchemy.orm import Session
from backend.app.database import engine, Base, SessionLocal
from backend.app.models import User, Project, Task, Event, Group, UserGroup  # Import all models
from backend.app.security import get_password_hash

def create_initial_data(db: Session):
    """Creates the initial admin user if it doesn't exist."""
    db_user = db.query(User).filter(User.email == "tanaka@example.com").first()
    if not db_user:
        hashed_password = get_password_hash("adminpassword")
        admin_user = User(
            email="tanaka@example.com",
            hashed_password=hashed_password,
            role="admin"
        )
        db.add(admin_user)
        db.commit()
        db.refresh(admin_user)
        print("Admin user 'tanaka@example.com' created.")
    else:
        print("Admin user 'tanaka@example.com' already exists.")

def main():
    print("Creating database tables...")
    # Create all tables defined in models.py
    Base.metadata.create_all(bind=engine)
    print("Database tables created.")

    db = SessionLocal()
    try:
        create_initial_data(db)
    finally:
        db.close()

if __name__ == "__main__":
    main() 