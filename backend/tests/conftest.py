"""Test fixtures for backend/tests/ - provides db, project, test_user, client."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from app.database import SessionLocal
from app import models
from app.security import get_current_user


@pytest.fixture
def db():
    """Function-scoped DB session backed by the in-memory test engine."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(scope="module")
def test_user():
    """Admin user for auth override, created once per module."""
    session = SessionLocal()
    try:
        user = models.User(
            email="testadmin_485e@example.com",
            hashed_password="hashed_pw",
            name="Test Admin 485e",
            role="admin",
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        # Access attributes while session is open so they cache on the detached object.
        _ = user.id, user.role, user.name
        return user
    finally:
        session.close()


@pytest.fixture(scope="module")
def project():
    """Test project created once per module."""
    session = SessionLocal()
    try:
        p = models.Project(name="test_485e_approved_status")
        session.add(p)
        session.commit()
        session.refresh(p)
        _ = p.id, p.name
        return p
    finally:
        session.close()


@pytest.fixture
def client(test_user):
    """FastAPI TestClient with get_current_user overridden to test_user."""
    from app.main import app as fastapi_app

    def override_current_user():
        return test_user

    fastapi_app.dependency_overrides[get_current_user] = override_current_user
    with TestClient(fastapi_app) as c:
        yield c
    fastapi_app.dependency_overrides.pop(get_current_user, None)
