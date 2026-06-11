from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, DateTime, Float, Text, Enum, JSON, UniqueConstraint
from sqlalchemy.orm import relationship, Mapped, mapped_column, selectinload
import enum
from typing import List, Optional, Dict, Any
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
    APPROVED = "approved"
    COMPLETED = "completed"
    DELAYED = "delayed"
    RETAKE = "retake"

class TaskPriority(str, enum.Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"

class TaskType(str, enum.Enum):
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
    base_load_hours_per_week: Mapped[Optional[float]] = mapped_column(Float, nullable=True, default=0.0)
    avatar_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # §5-bis ユーザープロフィール拡張用フィールド
    birthday: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    bio: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    line_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    work_start_time: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    work_end_time: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    skills: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
    settings_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    google_linked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="0")
    google_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)




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


class Shot(Base):
    __tablename__ = "shots"
    __table_args__ = (UniqueConstraint('project_id', 'seq_code', 'shot_code', name='uix_project_seq_shot'),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    seq_code: Mapped[str] = mapped_column(String(50), index=True)
    shot_code: Mapped[str] = mapped_column(String(50), index=True)
    display_order: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(50), default="planning")
    thumbnail_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)

    # --- shotlist import columns (cmd_481) ---
    cut = Column(String(20), nullable=True, index=True)
    sl_no = Column(Integer, nullable=True)
    frame_in = Column(Integer, nullable=True)
    frame_out = Column(Integer, nullable=True)
    duration = Column(Integer, nullable=True)
    second = Column(Integer, nullable=True)
    frame_rem = Column(Integer, nullable=True)
    action = Column(Text, nullable=True)
    dialogue = Column(Text, nullable=True)
    bg = Column(Text, nullable=True)
    ch = Column(Text, nullable=True)
    prop = Column(Text, nullable=True)
    task_lay = Column(Text, nullable=True)
    task_anim = Column(Text, nullable=True)
    task_fx = Column(Text, nullable=True)
    task_lighting = Column(Text, nullable=True)
    task_comp = Column(Text, nullable=True)
    note = Column(Text, nullable=True)
    is_deleted = Column(Boolean(create_constraint=False), nullable=False,
                        default=False, server_default='0')
    deleted_at = Column(DateTime, nullable=True)

    project: Mapped["Project"] = relationship("Project")

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
    shot_id: Mapped[Optional[int]] = mapped_column(ForeignKey("shots.id", ondelete="SET NULL"), index=True, nullable=True)
    thread_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    phases: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSON, nullable=True)
    deliverables: Mapped[Optional[str]] = mapped_column(Text, nullable=True) # 提出物
    check_items: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSON, nullable=True) # 確認事項
    auto_started: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_delayed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[Optional[datetime]] = mapped_column()
    display_status: Mapped[str] = mapped_column(String, default='online', index=True)
    updated_at: Mapped[Optional[datetime]] = mapped_column()

    assignee: Mapped[Optional["User"]] = relationship("User")
    project: Mapped[Optional["Project"]] = relationship("Project")
    shot: Mapped[Optional["Shot"]] = relationship("Shot")

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
    user_ids: Mapped[Optional[List[int]]] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String, default='offline', index=True)
    meeting_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    minutes_id: Mapped[Optional[int]] = mapped_column(ForeignKey("meetings.id"), nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column()
    updated_at: Mapped[Optional[datetime]] = mapped_column()

    @property
    def date(self) -> Optional[str]:
        if self.start_time:
            return self.start_time.date().isoformat()
        return None

    @property
    def time(self) -> Optional[str]:
        if self.start_time and not self.allDay:
            return self.start_time.time().strftime("%H:%M")
        return None

    @property
    def duration_minutes(self) -> Optional[int]:
        if self.start_time and self.end_time:
            delta = self.end_time - self.start_time
            return int(delta.total_seconds() / 60)
        return None

class Group(Base):
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(index=True)
    description: Mapped[Optional[str]] = mapped_column(Text)
    type: Mapped[Optional[GroupType]] = mapped_column()
    start_date: Mapped[Optional[datetime]] = mapped_column()
    end_date: Mapped[Optional[datetime]] = mapped_column()
    created_at: Mapped[Optional[datetime]] = mapped_column()
    updated_at: Mapped[Optional[datetime]] = mapped_column()

class UserGroup(Base):
    __tablename__ = "user_groups"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"), primary_key=True)
    role: Mapped[Optional[GroupRole]] = mapped_column()
    created_at: Mapped[Optional[datetime]] = mapped_column()
    updated_at: Mapped[Optional[datetime]] = mapped_column()

class DmThreadParticipant(Base):
    __tablename__ = "dm_thread_participants"

    thread_id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    created_at: Mapped[Optional[datetime]] = mapped_column()

class Note(Base):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_urls: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)  # 画像のパスをリストで保存
    image_positions: Mapped[Optional[Dict[str, Dict[str, float]]]] = mapped_column(JSON, nullable=True)  # 画像の位置情報 {url: {x, y, width, height}}
    pdf_urls: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)  # PDFのパスをリストで保存
    pdf_positions: Mapped[Optional[Dict[str, Dict[str, float]]]] = mapped_column(JSON, nullable=True)  # PDFの位置情報 {url: {x, y, width, height}}
    audio_urls: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)  # 音声のパスをリストで保存
    audio_positions: Mapped[Optional[Dict[str, Dict[str, float]]]] = mapped_column(JSON, nullable=True)  # 音声の位置情報 {url: {x, y, width, height}}
    content_position: Mapped[Optional[Dict[str, float]]] = mapped_column(JSON, nullable=True)  # テキストボックスの位置情報 {x, y, width, height}（後方互換性のため残す）
    text_boxes: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSON, nullable=True)  # テキストボックス配列 [{id, content, x, y, width, height}]
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id"), nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)

    owner: Mapped["User"] = relationship("User")
    project: Mapped[Optional["Project"]] = relationship("Project")

class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    conversation_id: Mapped[str] = mapped_column(String(255), index=True)
    role: Mapped[str] = mapped_column(String(50)) # user, model, system
    content: Mapped[str] = mapped_column(Text)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)

class UserActivity(Base):
    __tablename__ = "user_activities"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    active_at: Mapped[datetime] = mapped_column(default=now_jst_naive, index=True)  # アクティブになった日時
    cycle_date: Mapped[datetime] = mapped_column(index=True)  # 周期日（その日の5:00を基準とした日付）
    created_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)

    user: Mapped["User"] = relationship("User")


class UserGoogleToken(Base):
    """ユーザーごとの Google OAuth トークン（カレンダー連携用）"""
    __tablename__ = "user_google_tokens"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    access_token: Mapped[str] = mapped_column(Text)
    refresh_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    calendar_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)


class TaskGoogleSync(Base):
    """タスクをユーザーの Google カレンダーに表示する紐付け（ユーザー・タスクごと）"""
    __tablename__ = "task_google_sync"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), primary_key=True)
    google_event_id: Mapped[str] = mapped_column(String(512), index=True)  # Google Calendar のイベント ID
    created_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)


class ProjectGoogleSync(Base):
    """プロジェクトをユーザーの Google カレンダーに表示する紐付け"""
    __tablename__ = "project_google_sync"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), primary_key=True)
    google_event_id: Mapped[str] = mapped_column(String(512), index=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)


class EventGoogleSync(Base):
    """イベントをユーザーの Google カレンダーに表示する紐付け"""
    __tablename__ = "event_google_sync"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), primary_key=True)
    google_event_id: Mapped[str] = mapped_column(String(512), index=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    title: Mapped[str] = mapped_column(index=True)
    date: Mapped[datetime] = mapped_column(default=now_jst_naive)
    status: Mapped[str] = mapped_column(String(50), default="pending", index=True) # pending, processing, completed, failed
    audio_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # 保存先パス
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    decisions: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
    tasks: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
    discussion_points: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
    deadlines: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
    version_group: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    event_id: Mapped[Optional[int]] = mapped_column(ForeignKey("events.id"), nullable=True)
    attendees: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)

    project: Mapped["Project"] = relationship("Project")
    detected_tasks: Mapped[List["MeetingTask"]] = relationship("MeetingTask", back_populates="meeting", cascade="all, delete-orphan")


class Decision(Base):
    __tablename__ = "decisions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    meeting_id: Mapped[Optional[int]] = mapped_column(ForeignKey("meetings.id"), nullable=True)
    content: Mapped[str] = mapped_column(Text)
    date: Mapped[datetime] = mapped_column(default=now_jst_naive)
    superseded: Mapped[bool] = mapped_column(Boolean, default=False)
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id"), index=True, nullable=True)

    meeting: Mapped[Optional["Meeting"]] = relationship("Meeting")
    project: Mapped[Optional["Project"]] = relationship("Project")

class MeetingTask(Base):
    __tablename__ = "meeting_tasks"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id"), index=True)
    content: Mapped[str] = mapped_column(Text)
    type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    assignee_suggestion: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    due_date_suggestion: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="detected") # detected, adopted, dismissed
    task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id"), nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)

    meeting: Mapped["Meeting"] = relationship("Meeting", back_populates="detected_tasks")
    task: Mapped[Optional["Task"]] = relationship("Task")

    @property
    def project_id(self) -> Optional[int]:
        if self.meeting:
            return self.meeting.project_id
        return None

    @property
    def project_name(self) -> str:
        if self.meeting and self.meeting.project:
            return self.meeting.project.name
        return "不明"

    @property
    def meeting_date(self) -> Optional[datetime]:
        if self.meeting:
            return self.meeting.date
        return None

class KnowledgeItem(Base):
    __tablename__ = "knowledge_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id"), index=True, nullable=True)
    title: Mapped[str] = mapped_column(index=True)
    file_name: Mapped[str] = mapped_column(index=True)
    file_path: Mapped[str] = mapped_column(Text) # Local path or URL
    file_type: Mapped[str] = mapped_column(String(50)) # pdf, excel, ppt, image, audio, doc
    status: Mapped[str] = mapped_column(String(50), default="pending", index=True) # pending, processing, completed, failed
    
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True) # OCR results, transcriptions, or doc content
    metadata_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True) # AI extracted metadata
    
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive)

    project: Mapped[Optional["Project"]] = relationship("Project")
    creator: Mapped["User"] = relationship("User", foreign_keys=[created_by])
    tags: Mapped[List["KnowledgeTag"]] = relationship("KnowledgeTag", back_populates="knowledge_item", cascade="all, delete-orphan")

class KnowledgeTag(Base):
    __tablename__ = "knowledge_tags"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    knowledge_item_id: Mapped[int] = mapped_column(ForeignKey("knowledge_items.id"), index=True)
    name: Mapped[str] = mapped_column(index=True)

    knowledge_item: Mapped["KnowledgeItem"] = relationship("KnowledgeItem", back_populates="tags")

# --- Score Related Models ---

class ScoreUserRole(Base):
    __tablename__ = "score_user_roles"
    __table_args__ = (UniqueConstraint('user_id', 'project_id', name='uix_user_project'),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(50)) # director, compositor, etc.

class Retake(Base):
    __tablename__ = "retakes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    shot_id: Mapped[int] = mapped_column(ForeignKey("shots.id", ondelete="CASCADE"), index=True)
    overall_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="open") # open, in_progress, closed
    priority: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    deadline: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=now_jst_naive)

    timecodes: Mapped[List["RetakeTimecode"]] = relationship("RetakeTimecode", back_populates="retake", cascade="all, delete-orphan")

class RetakeTimecode(Base):
    __tablename__ = "retake_timecodes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    retake_id: Mapped[int] = mapped_column(ForeignKey("retakes.id", ondelete="CASCADE"), index=True)
    timecode: Mapped[str] = mapped_column(String(20))
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    paint_image: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    paint_mime: Mapped[str] = mapped_column(String(50), default="image/png", nullable=False)

    retake: Mapped["Retake"] = relationship("Retake", back_populates="timecodes")

class ChangeRequest(Base):
    __tablename__ = "change_requests"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    shot_id: Mapped[Optional[int]] = mapped_column(ForeignKey("shots.id"), nullable=True)
    task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id"), nullable=True)
    type: Mapped[str] = mapped_column(String(50)) # deadline_extension, etc.
    proposed_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=now_jst_naive)

class Trouble(Base):
    __tablename__ = "troubles"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    shot_id: Mapped[int] = mapped_column(ForeignKey("shots.id"), index=True)
    category: Mapped[str] = mapped_column(String(50))
    description: Mapped[str] = mapped_column(Text)
    severity: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="open")
    assigned_to: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=now_jst_naive)

class LookDistribution(Base):
    __tablename__ = "look_distributions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    shot_ids: Mapped[List[int]] = mapped_column(JSON)
    look_dev_id: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    assigned_to: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=now_jst_naive)
    estimated_hours: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    result_asset_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

class UserMessage(Base):
    __tablename__ = "user_messages"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    channel_id: Mapped[str] = mapped_column(String(100), index=True)
    shot_id: Mapped[Optional[int]] = mapped_column(ForeignKey("shots.id"), nullable=True, index=True)
    body: Mapped[str] = mapped_column(Text)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=now_jst_naive)
    timecode: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    shot_id: Mapped[Optional[int]] = mapped_column(ForeignKey("shots.id", ondelete="CASCADE"), nullable=True, index=True)
    task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True)
    version: Mapped[str] = mapped_column(String(50))
    file_path: Mapped[str] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=now_jst_naive)

class Delivery(Base):
    __tablename__ = "deliveries"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    qc_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    memo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=now_jst_naive)

class DirectMessage(Base):
    __tablename__ = "direct_messages"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    thread_id: Mapped[int] = mapped_column(Integer, index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    body: Mapped[str] = mapped_column(Text)
    context_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=now_jst_naive)
    read_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

class GroupDirectMessage(Base):
    __tablename__ = "group_direct_messages"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    group_id: Mapped[str] = mapped_column(String(100), index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=now_jst_naive)

class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    type: Mapped[str] = mapped_column(String(50))
    body: Mapped[str] = mapped_column(Text)
    meta: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(default=now_jst_naive)

class Timecard(Base):
    __tablename__ = "timecards"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    date: Mapped[datetime] = mapped_column(default=now_jst_naive, index=True)
    clock_out_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    worked_minutes: Mapped[int] = mapped_column(default=0)
    break_minutes: Mapped[int] = mapped_column(default=0)
    memo: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    type: Mapped[str] = mapped_column(String(50), default="clock_out")
    mode: Mapped[Optional[str]] = mapped_column(String(50), default="current", nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=now_jst_naive)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(default=now_jst_naive, nullable=True)
    for_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    fields: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

class Routine(Base):
    __tablename__ = "routines"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    date: Mapped[datetime] = mapped_column(default=now_jst_naive, index=True)
    condition: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    blockers: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
    ai_priorities_adopted: Mapped[Optional[List[int]]] = mapped_column(JSON, nullable=True)

class ReferenceMaterial(Base):
    __tablename__ = "reference_materials"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    shot_id: Mapped[int] = mapped_column(ForeignKey("shots.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255))
    media_type: Mapped[str] = mapped_column(String(50))  # image / video / url / memo
    file_path: Mapped[str] = mapped_column(Text)  # file path or url
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=now_jst_naive)


class ProjectColumnSetting(Base):
    __tablename__ = "project_column_settings"
    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    field_key = Column(String(30), nullable=False)
    is_enabled = Column(Boolean(create_constraint=False), nullable=False,
                        default=True, server_default='1')
    display_order = Column(Integer, nullable=True)
    display_label = Column(String(50), nullable=True)
    __table_args__ = (
        UniqueConstraint("project_id", "field_key", name="uix_pcs_project_field"),
    )