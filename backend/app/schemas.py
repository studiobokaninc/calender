from pydantic import BaseModel, Field, EmailStr, validator, root_validator, computed_field
from typing import Optional, List, Dict, Any, ForwardRef
from datetime import datetime, date, timezone
from . import models # models をインポート

VALID_TASK_TYPES = {
    "animation", "layout", "comp", "fx", "lighting", "asset", 
    "programming", "design", "testing", "documentation", 
    "shoot", "gs", "report", "other"
}

# --- User Schemas ---

class UserBase(BaseModel):
    email: Optional[EmailStr] = None
    username: Optional[str] = None  # ユーザーID
    full_name: Optional[str] = None # 氏名
    name: Optional[str] = None # 旧フィールド（後方互換用）
    role: Optional[str] = 'user'
    iconUrl: Optional[str] = None
    avatar_url: Optional[str] = None
    is_active: Optional[bool] = True
    base_load_hours_per_week: Optional[float] = Field(default=0.0, ge=0.0, le=40.0, description="週あたりの定常業務時間（ベースロード）")




class UserCreate(UserBase):
    email: EmailStr
    password: str

class UserUpdate(UserBase):
    email: Optional[EmailStr] = None
    password: Optional[str] = None

class AvatarUpdate(BaseModel):
    avatar_url: str

class UserResponse(UserBase):
    id: int
    email: EmailStr
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# --- Event Schemas ---

class EventBase(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    type: Optional[str] = None
    location: Optional[str] = None
    allDay: Optional[bool] = Field(default=False, alias='allDay')
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    status: Optional[str] = Field(default='offline')
    project_id: Optional[int] = None
    participants: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    user_ids: Optional[List[int]] = Field(default_factory=list)
    meeting_url: Optional[str] = None
    minutes_id: Optional[int] = None
    date: Optional[str] = None
    time: Optional[str] = None
    duration_minutes: Optional[int] = None

    class Config:
        from_attributes = True
        validate_assignment = True

class EventCreate(EventBase):
    title: str
    type: str

class EventUpdate(EventBase):
    description: Optional[str] = None
    type: Optional[str] = None
    location: Optional[str] = None
    allDay: Optional[bool] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    status: Optional[str] = None
    project_id: Optional[int] = None
    participants: Optional[List[Dict[str, Any]]] = None
    user_ids: Optional[List[int]] = None
    date: Optional[str] = None
    time: Optional[str] = None
    duration_minutes: Optional[int] = None

class EventResponse(EventBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by: Optional[int] = None
    updated_by: Optional[int] = None

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

# --- Group Schemas ---

class GroupBase(BaseModel):
    name: str
    description: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    # Add other fields like type if needed

class GroupCreate(GroupBase):
    pass


class GroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class GroupResponse(GroupBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True # orm_mode から変更

# --- UserGroup Schemas ---

class UserGroupBase(BaseModel):
    user_id: int
    group_id: int
    role: Optional[str] = 'member' 

class UserGroupCreate(UserGroupBase):
    pass

# Define UserGroupUpdate if role update is needed
# class UserGroupUpdate(BaseModel):
#     role: Optional[str] = None

class UserGroupResponse(UserGroupBase):
    # Assuming user_id/group_id map directly
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True # orm_mode から変更

# --- Project Schemas ---

class ProjectBase(BaseModel):
    name: str
    description: Optional[str] = None
    status: Optional[models.ProjectStatus] = models.ProjectStatus.PLANNING # Enum を使用し、デフォルト値を設定
    display_status: Optional[str] = 'online' # 追加
    start_date: Optional[datetime] = None # startDate -> start_date
    end_date: Optional[datetime] = None   # endDate -> end_date
    color: Optional[str] = None

class ProjectCreate(ProjectBase):
    pass

class ProjectUpdate(ProjectBase):
    # Make fields optional for partial update
    name: Optional[str] = None
    status: Optional[models.ProjectStatus] = None # 更新時も Enum を使用
    display_status: Optional[str] = None # 更新時も追加

class ProjectResponse(ProjectBase):
    id: int # Changed to int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True # orm_mode から変更

# --- Status History Schemas ---
class StatusHistoryBase(BaseModel):
    status: models.TaskStatus
    changed_at: datetime
    changed_by: Optional[int]

class StatusHistoryCreate(BaseModel):
    status: str
    changed_by: Optional[int]
    changed_at: Optional[datetime] = None

class StatusHistoryEntry(BaseModel):
    id: int
    task_id: int
    status: str
    changed_at: datetime
    changed_by: Optional[int]

    class Config:
        from_attributes = True

class StatusChangeMetric(BaseModel):
    date: datetime
    status: str
    count: int
    project_id: Optional[int]
    project_name: Optional[str]

    class Config:
        from_attributes = True

class StatusHistoryResponse(StatusHistoryBase):
    id: int
    task_id: int
    changed_at: datetime
    changed_by: Optional[int]

    # Pydantic V1 の場合
    class Config:
        # Pydantic V2 の場合: model_config = ConfigDict(from_attributes=True) 
        from_attributes = True # orm_mode から変更 

# --- Task Schemas ---

class TaskBase(BaseModel):
    name: str
    description: Optional[str] = None
    assigned_to: Optional[int] = None
    due_date: Optional[datetime] = None
    status: Optional[models.TaskStatus] = None
    display_status: Optional[str] = 'online' # 追加
    priority: Optional[models.TaskPriority] = None # TaskPriority列挙型を使用
    type: Optional[str] = None     # 必要であれば Enum を使用
    start_date: Optional[datetime] = None
    progress: Optional[int] = None
    cost: Optional[float] = None
    dependsOn: Optional[List[str]] = Field(default_factory=list)
    shotID: Optional[str] = None
    seqID: Optional[str] = None
    shot_id: Optional[int] = None
    phases: Optional[List[Dict[str, Any]]] = None
    deliverables: Optional[str] = None
    check_items: Optional[List[Dict[str, Any]]] = None

    @validator('type', pre=True)
    def validate_task_type(cls, v):
        if v is None:
            return None
        s = str(v).strip().lower()
        if s == "aseet":
            s = "asset"
        elif s == "anim":
            s = "animation"
        if s not in VALID_TASK_TYPES:
            s = "other"
        return s

class TaskCreate(TaskBase):
    project_id: Optional[int] = None

class TaskUpdate(BaseModel): # 更新用は Optional にすることが多い
    name: Optional[str] = None
    project_id: Optional[int] = None
    description: Optional[str] = None
    assigned_to: Optional[int] = None
    due_date: Optional[datetime] = None
    status: Optional[models.TaskStatus] = None
    display_status: Optional[str] = None # 追加
    priority: Optional[models.TaskPriority] = None # TaskPriority列挙型を使用
    type: Optional[str] = None
    start_date: Optional[datetime] = None
    progress: Optional[int] = None
    cost: Optional[float] = None
    dependsOn: Optional[List[str]] = None
    shotID: Optional[str] = None
    seqID: Optional[str] = None
    shot_id: Optional[int] = None
    phases: Optional[List[Dict[str, Any]]] = None
    deliverables: Optional[str] = None
    check_items: Optional[List[Dict[str, Any]]] = None

    @validator('type', pre=True)
    def validate_task_type_update(cls, v):
        if v is None:
            return None
        s = str(v).strip().lower()
        if s == "aseet":
            s = "asset"
        elif s == "anim":
            s = "animation"
        if s not in VALID_TASK_TYPES:
            s = "other"
        return s

class TaskBulkUpdateRequest(BaseModel):
    """一括更新: 指定したタスクに同じ項目を適用"""
    task_ids: List[int]
    status: Optional[str] = None
    assigned_to: Optional[int] = None
    due_date: Optional[datetime] = None
    priority: Optional[str] = None


class TaskResponse(TaskBase):
    id: int
    project_id: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    status_history: List[StatusHistoryResponse] = [] # status_history フィールドを追加

    # Pydantic V1 の場合
    class Config:
        from_attributes = True # orm_mode から変更

# --- Shot Schemas ---

class ShotBase(BaseModel):
    project_id: int
    seq_code: str
    shot_code: str
    display_order: Optional[int] = 0
    status: Optional[str] = "planning"
    thumbnail_url: Optional[str] = None
    description: Optional[str] = None

class ShotCreate(ShotBase):
    pass

class ShotUpdate(BaseModel):
    seq_code: Optional[str] = None
    shot_code: Optional[str] = None
    display_order: Optional[int] = None
    status: Optional[str] = None
    thumbnail_url: Optional[str] = None
    description: Optional[str] = None

class ShotResponse(ShotBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class ShotProgressResponse(BaseModel):
    shot_id: int
    total_tasks: int
    completed_tasks: int
    average_progress: float

# --- Note Schemas ---

class NoteBase(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None  # 後方互換性のため残す
    image_urls: Optional[List[str]] = Field(default_factory=list)
    image_positions: Optional[Dict[str, Dict[str, float]]] = Field(default_factory=dict)  # {url: {x, y, width, height}}
    pdf_urls: Optional[List[str]] = Field(default_factory=list)
    pdf_positions: Optional[Dict[str, Dict[str, float]]] = Field(default_factory=dict)  # {url: {x, y, width, height}}
    audio_urls: Optional[List[str]] = Field(default_factory=list)
    audio_positions: Optional[Dict[str, Dict[str, float]]] = Field(default_factory=dict)  # {url: {x, y, width, height}}
    content_position: Optional[Dict[str, float]] = None  # {x, y, width, height}（後方互換性のため残す）
    text_boxes: Optional[List[Dict[str, Any]]] = None  # テキストボックス配列 [{id, content, x, y, width, height}]
    project_id: Optional[int] = None

class NoteCreate(NoteBase):
    pass

class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None  # 後方互換性のため残す
    image_urls: Optional[List[str]] = None
    image_positions: Optional[Dict[str, Dict[str, float]]] = None  # {url: {x, y, width, height}}
    pdf_urls: Optional[List[str]] = None
    pdf_positions: Optional[Dict[str, Dict[str, float]]] = None  # {url: {x, y, width, height}}
    audio_urls: Optional[List[str]] = None
    audio_positions: Optional[Dict[str, Dict[str, float]]] = None  # {url: {x, y, width, height}}
    content_position: Optional[Dict[str, float]] = None  # {x, y, width, height}（後方互換性のため残す）
    text_boxes: Optional[List[Dict[str, Any]]] = None  # テキストボックス配列 [{id, content, x, y, width, height}]
    project_id: Optional[int] = None

class NoteResponse(NoteBase):
    id: int
    created_by: int
    project_id: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

# --- UserActivity Schemas ---

class UserActivityBase(BaseModel):
    user_id: int
    active_at: datetime
    cycle_date: datetime

class UserActivityCreate(BaseModel):
    user_id: Optional[int] = None  # 現在のユーザーから取得する場合はNone

class UserActivityResponse(UserActivityBase):
    id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


# --- Meeting Schemas ---

class MeetingBase(BaseModel):
    title: str
    project_id: int
    date: Optional[datetime] = None
    event_id: Optional[int] = None
    attendees: Optional[List[Dict[str, Any]]] = None
    version_group: Optional[str] = None

class MeetingCreate(MeetingBase):
    pass

class MeetingCreateManual(BaseModel):
    title: str
    project_id: int
    date: Optional[datetime] = None
    event_id: Optional[int] = None
    transcript: Optional[str] = None
    decisions: Optional[List[str]] = Field(default_factory=list)
    tasks: Optional[List[str]] = Field(default_factory=list)
    discussion_points: Optional[List[str]] = Field(default_factory=list)
    deadlines: Optional[List[str]] = Field(default_factory=list)
    attendees: Optional[List[Dict[str, Any]]] = Field(default_factory=list)
    version_group: Optional[str] = None

class MeetingUpdate(BaseModel):
    title: Optional[str] = None
    date: Optional[datetime] = None
    event_id: Optional[int] = None
    attendees: Optional[List[Dict[str, Any]]] = None
    status: Optional[str] = None
    audio_url: Optional[str] = None
    transcript: Optional[str] = None
    decisions: Optional[List[str]] = None
    tasks: Optional[List[str]] = None
    discussion_points: Optional[List[str]] = None
    deadlines: Optional[List[str]] = None
    version_group: Optional[str] = None

class MeetingUpdateManual(BaseModel):
    title: Optional[str] = None
    date: Optional[datetime] = None
    event_id: Optional[int] = None
    transcript: Optional[str] = None
    decisions: Optional[List[str]] = None
    tasks: Optional[List[str]] = None
    discussion_points: Optional[List[str]] = None
    deadlines: Optional[List[str]] = None
    attendees: Optional[List[Dict[str, Any]]] = None
    version_group: Optional[str] = None


class MeetingTaskBase(BaseModel):
    content: str
    type: Optional[str] = None
    assignee_suggestion: Optional[str] = None
    due_date_suggestion: Optional[datetime] = None
    status: Optional[str] = "detected"
    meeting_id: int
    task_id: Optional[int] = None

class MeetingTaskCreate(MeetingTaskBase):
    pass

class MeetingTaskUpdate(BaseModel):
    content: Optional[str] = None
    type: Optional[str] = None
    assignee_suggestion: Optional[str] = None
    due_date_suggestion: Optional[datetime] = None
    status: Optional[str] = None
    task_id: Optional[int] = None

class MeetingTaskResponse(MeetingTaskBase):
    id: int
    created_at: Optional[datetime] = None
    project_id: Optional[int] = None
    project_name: Optional[str] = None
    meeting_date: Optional[datetime] = None

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

class MeetingResponse(MeetingBase):
    id: int
    status: str
    audio_url: Optional[str] = None
    transcript: Optional[str] = None
    decisions: Optional[List[str]] = None
    tasks: Optional[List[str]] = None
    discussion_points: Optional[List[str]] = None
    deadlines: Optional[List[str]] = None
    version_group: Optional[str] = None
    detected_tasks: List[MeetingTaskResponse] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

class OpenExplorerRequest(BaseModel):
    path: str

# --- Decision Schemas ---

class DecisionBase(BaseModel):
    content: str
    date: Optional[datetime] = None
    superseded: bool = False
    project_id: Optional[int] = None
    meeting_id: Optional[int] = None

class DecisionCreate(DecisionBase):
    pass

class DecisionUpdate(BaseModel):
    content: Optional[str] = None
    date: Optional[datetime] = None
    superseded: Optional[bool] = None
    project_id: Optional[int] = None
    meeting_id: Optional[int] = None

class DecisionResponse(DecisionBase):
    id: int

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


# --- Knowledge Base Schemas ---

class KnowledgeTagBase(BaseModel):
    name: str

class KnowledgeTagCreate(KnowledgeTagBase):
    pass

class KnowledgeTagResponse(KnowledgeTagBase):
    id: int
    knowledge_item_id: int

    class Config:
        from_attributes = True

class KnowledgeItemBase(BaseModel):
    title: str
    project_id: Optional[int] = None
    file_type: str

class KnowledgeItemCreate(KnowledgeItemBase):
    file_name: str
    file_path: str
    created_by: int

class KnowledgeItemResponse(KnowledgeItemBase):
    id: int
    file_name: str
    file_path: str
    status: str
    summary: Optional[str] = None
    content_text: Optional[str] = None
    metadata_json: Optional[Dict[str, Any]] = None
    created_by: int
    created_at: datetime
    updated_at: datetime
    tags: List[KnowledgeTagResponse] = []

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

# --- Ask API Schemas ---

class AskRequest(BaseModel):
    question: str = Field(..., description="自然言語の質問")

class AskResponse(BaseModel):
    answer: str = Field(..., description="AIによる回答")
    sources: List[str] = Field(default_factory=list, description="根拠となった情報源（会議名など）")

# --- Score Related Schemas ---

class ScoreUserRoleBase(BaseModel):
    user_id: int
    project_id: int
    role: str

class ScoreUserRoleCreate(ScoreUserRoleBase):
    pass

class ScoreUserRoleUpdate(BaseModel):
    role: str

class ScoreUserRole(ScoreUserRoleBase):
    id: int
    class Config:
        from_attributes = True

class RetakeTimecodeBase(BaseModel):
    timecode: str
    comment: Optional[str] = None
    paint_image: Optional[str] = None
    paint_mime: Optional[str] = "image/png"

class RetakeTimecodeCreate(RetakeTimecodeBase):
    pass

class RetakeTimecode(RetakeTimecodeBase):
    id: int
    retake_id: int
    class Config:
        from_attributes = True

class RetakeBase(BaseModel):
    shot_id: int
    overall_comment: Optional[str] = None
    status: str = "open"
    priority: Optional[str] = None
    deadline: Optional[datetime] = None

class RetakeCreate(RetakeBase):
    timecodes: List[RetakeTimecodeCreate] = []

class Retake(RetakeBase):
    id: int
    created_by: int
    created_at: datetime
    timecodes: List[RetakeTimecode] = []
    shot_code: Optional[str] = None
    project_name: Optional[str] = None
    assignee_name: Optional[str] = None
    class Config:
        from_attributes = True

class ChangeRequestBase(BaseModel):
    shot_id: Optional[int] = None
    task_id: Optional[int] = None
    type: str
    proposed_value: Optional[str] = None
    reason: Optional[str] = None
    status: str = "pending"

class ChangeRequestCreate(ChangeRequestBase):
    pass

class ChangeRequest(ChangeRequestBase):
    id: int
    created_by: int
    created_at: datetime
    class Config:
        from_attributes = True

class TroubleBase(BaseModel):
    shot_id: int
    category: str
    description: str
    severity: Optional[str] = None
    status: str = "open"
    assigned_to: Optional[int] = None

class TroubleCreate(TroubleBase):
    pass

class Trouble(TroubleBase):
    id: int
    created_by: int
    created_at: datetime
    shot_code: Optional[str] = None
    project_name: Optional[str] = None
    reporter_name: Optional[str] = None
    class Config:
        from_attributes = True

class LookDistributionBase(BaseModel):
    shot_ids: List[int]
    look_dev_id: int
    status: str = "pending"
    assigned_to: int
    estimated_hours: Optional[int] = None

class LookDistributionCreate(LookDistributionBase):
    pass

class LookDistribution(LookDistributionBase):
    id: int
    created_by: int
    created_at: datetime
    result_asset_id: Optional[int] = None
    notes: Optional[str] = None
    class Config:
        from_attributes = True

class UserMessageBase(BaseModel):
    channel_id: str
    shot_id: Optional[int] = None
    body: str
    timecode: Optional[str] = None

class UserMessageCreate(UserMessageBase):
    pass

class UserMessage(UserMessageBase):
    id: int
    author_id: int
    created_at: datetime
    class Config:
        from_attributes = True

class AssetBase(BaseModel):
    shot_id: int
    task_id: Optional[int] = None
    version: str
    file_path: str

class AssetCreate(AssetBase):
    pass

class AssetResponse(AssetBase):
    id: int
    created_by: int
    created_at: datetime
    class Config:
        from_attributes = True

class DeliveryBase(BaseModel):
    task_id: int
    status: str = "pending"
    qc_status: Optional[str] = None
    memo: Optional[str] = None

class DeliveryCreate(DeliveryBase):
    pass

class DeliveryResponse(DeliveryBase):
    id: int
    created_by: int
    created_at: datetime
    class Config:
        from_attributes = True

class DirectMessageBase(BaseModel):
    thread_id: int
    recipient_id: int
    body: str
    context_json: Optional[Dict[str, Any]] = None

class DirectMessageCreate(DirectMessageBase):
    sender_id: Optional[int] = None

class DirectMessageResponse(DirectMessageBase):
    id: int
    sender_id: int
    created_at: datetime
    class Config:
        from_attributes = True

class GroupDirectMessageBase(BaseModel):
    group_id: str
    body: str

class GroupDirectMessageCreate(GroupDirectMessageBase):
    sender_id: Optional[int] = None

class GroupDirectMessageResponse(GroupDirectMessageBase):
    id: int
    sender_id: int
    created_at: datetime
    class Config:
        from_attributes = True

class NotificationBase(BaseModel):
    recipient_id: int
    type: str
    body: str
    is_read: bool = False

class NotificationCreate(NotificationBase):
    pass

class Notification(NotificationBase):
    id: int
    created_at: datetime
    project_name: Optional[str] = None
    class Config:
        from_attributes = True

class TimecardBase(BaseModel):
    date: datetime
    clock_out_at: Optional[datetime] = None
    worked_minutes: int = 0
    break_minutes: int = 0
    memo: Optional[str] = None

class TimecardCreate(TimecardBase):
    user_id: Optional[int] = None

class Timecard(TimecardBase):
    id: int
    user_id: int
    class Config:
        from_attributes = True

class RoutineBase(BaseModel):
    date: datetime
    condition: Optional[str] = None
    blockers: Optional[List[str]] = None
    ai_priorities_adopted: Optional[List[int]] = None

class RoutineCreate(RoutineBase):
    user_id: Optional[int] = None

class Routine(RoutineBase):
    id: int
    user_id: int
    class Config:
        from_attributes = True

# --- User Profile Expanded Schemas (§5-bis) ---

class UserProfileResponse(BaseModel):
    id: int
    username: Optional[str] = None
    full_name: Optional[str] = None
    email: str
    role: Optional[str] = None
    is_active: bool
    avatar_url: Optional[str] = None
    birthday: Optional[datetime] = None
    bio: Optional[str] = None
    phone: Optional[str] = None
    line_id: Optional[str] = None
    work_start_time: Optional[str] = None
    work_end_time: Optional[str] = None
    skills: Optional[List[str]] = None
    settings_json: Optional[Dict[str, Any]] = None
    google_linked: bool = False
    google_email: Optional[str] = None

    class Config:
        from_attributes = True

class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    birthday: Optional[datetime] = None
    bio: Optional[str] = None
    phone: Optional[str] = None
    line_id: Optional[str] = None
    work_start_time: Optional[str] = None
    work_end_time: Optional[str] = None
    skills: Optional[List[str]] = None
    settings_json: Optional[Dict[str, Any]] = None

