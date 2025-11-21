from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, DateTime, Float, Text, Enum, JSON
from sqlalchemy.orm import relationship, Mapped, mapped_column, selectinload
import enum
from typing import List, Optional, Dict
from datetime import datetime
from .timezone import now_jst_naive
from .database import Base

class ProjectStatus(str, enum.Enum):
    PLANNING = "planning"
    IN_PROGRESS = "in-progress"
    COMPLETED = "completed"
    ON_HOLD = "on-hold"
    CANCELLED = "cancelled"
    DELAYED = "delayed"

class ProjectPriority(str, enum.Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

class TaskStatus(str, enum.Enum):
    TODO = "todo"
    IN_PROGRESS = "in-progress"
    REVIEW = "review"
    COMPLETED = "completed"
    DELAYED = "delayed"

class TaskPriority(str, enum.Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"

class TaskType(str, enum.Enum):
    DEVELOPMENT = "development"
    DESIGN = "design"
    DOCUMENTATION = "documentation"
    TESTING = "testing"
    REVIEW = "review"
    MEETING = "meeting"
    FX = "fx"
    ASSET = "asset"
    ANIMATION = "animation"
    LIGHTING = "lighting"
    COMP = "comp"
    EDIT = "edit"

class EventType(str, enum.Enum):
    MEETING = "Meeting"
    DEADLINE = "Deadline"
    MILESTONE = "Milestone"
    WORKSHOP = "Workshop"
    GENERIC = "Generic"
    TASK = "Task"

class GroupType(str, enum.Enum):
    DEPARTMENT = "department"
    PROJECT = "project"
    CROSS_FUNCTIONAL = "cross-functional"

class GroupRole(str, enum.Enum):
    LEADER = "leader"
    MEMBER = "member"
    OBSERVER = "observer"

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[Optional[str]] = mapped_column(index=True)
    email: Mapped[str] = mapped_column(unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column()
    role: Mapped[Optional[str]] = mapped_column()
    created_at: Mapped[Optional[datetime]] = mapped_column()
    updated_at: Mapped[Optional[datetime]] = mapped_column()
    username: Mapped[Optional[str]] = mapped_column(unique=True, index=True)
    full_name: Mapped[Optional[str]] = mapped_column(index=True)

class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(index=True)
    description: Mapped[Optional[str]] = mapped_column(Text)
    start_date: Mapped[Optional[datetime]] = mapped_column()
    end_date: Mapped[Optional[datetime]] = mapped_column()
    budget: Mapped[Optional[float]] = mapped_column()
    status: Mapped[Optional[ProjectStatus]] = mapped_column()
    priority: Mapped[Optional[ProjectPriority]] = mapped_column()
    display_status: Mapped[str] = mapped_column(String, default='online', index=True)
    color: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column()
    updated_at: Mapped[Optional[datetime]] = mapped_column()

class TaskStatusHistory(Base):
    __tablename__ = "task_status_history"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    status: Mapped[TaskStatus] = mapped_column()
    changed_at: Mapped[datetime] = mapped_column(default=now_jst_naive, index=True)
    changed_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=True)

    task: Mapped["Task"] = relationship(back_populates="status_history")

class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id"))
    name: Mapped[str] = mapped_column(index=True)
    description: Mapped[Optional[str]] = mapped_column(Text)
    assigned_to: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    due_date: Mapped[Optional[datetime]] = mapped_column()
    status: Mapped[Optional[TaskStatus]] = mapped_column()
    priority: Mapped[Optional[TaskPriority]] = mapped_column()
    type: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # Enum → String に変更（任意の値を許容）
    start_date: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    progress: Mapped[Optional[int]] = mapped_column(nullable=True)
    cost: Mapped[Optional[float]] = mapped_column(nullable=True)
    dependsOn: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
    shotID: Mapped[Optional[str]] = mapped_column(String, index=True, nullable=True)
    seqID: Mapped[Optional[str]] = mapped_column(String, index=True, nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column()
    display_status: Mapped[str] = mapped_column(String, default='online', index=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column()

    status_history: Mapped[List["TaskStatusHistory"]] = relationship(
        back_populates="task",
        order_by="TaskStatusHistory.changed_at",
        cascade="all, delete-orphan"
    )

class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id"))
    title: Mapped[str] = mapped_column(index=True)
    description: Mapped[Optional[str]] = mapped_column(Text)
    start_time: Mapped[datetime] = mapped_column()
    end_time: Mapped[datetime] = mapped_column()
    location: Mapped[Optional[str]] = mapped_column()
    type: Mapped[EventType] = mapped_column(nullable=False)
    allDay: Mapped[Optional[bool]] = mapped_column(nullable=True)
    participants: Mapped[Optional[List[dict]]] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String, default='offline', index=True)
    created_at: Mapped[Optional[datetime]] = mapped_column()
    updated_at: Mapped[Optional[datetime]] = mapped_column()

class Group(Base):
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(index=True)
    description: Mapped[Optional[str]] = mapped_column(Text)
    type: Mapped[Optional[GroupType]] = mapped_column()
    created_at: Mapped[Optional[datetime]] = mapped_column()
    updated_at: Mapped[Optional[datetime]] = mapped_column()

class UserGroup(Base):
    __tablename__ = "user_groups"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"), primary_key=True)
    role: Mapped[Optional[GroupRole]] = mapped_column()
    created_at: Mapped[Optional[datetime]] = mapped_column()
    updated_at: Mapped[Optional[datetime]] = mapped_column()

class Note(Base):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_urls: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)  # 画像のパスをリストで保存
    image_positions: Mapped[Optional[Dict[str, Dict[str, float]]]] = mapped_column(JSON, nullable=True)  # 画像の位置情報 {url: {x, y, width, height}}
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id"), nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)

    owner: Mapped["User"] = relationship("User")
    project: Mapped[Optional["Project"]] = relationship("Project") 