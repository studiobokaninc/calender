from pydantic import BaseModel, Field, EmailStr, validator, root_validator
from typing import Optional, List, Dict, Any, ForwardRef
from datetime import datetime, date, timezone
from . import models # models をインポート
from typing import Optional

# --- User Schemas ---

class UserBase(BaseModel):
    email: Optional[EmailStr] = None
    username: Optional[str] = None  # ユーザーID
    full_name: Optional[str] = None # 氏名
    name: Optional[str] = None # 旧フィールド（後方互換用）
    role: Optional[str] = 'user'
    iconUrl: Optional[str] = None

class UserCreate(UserBase):
    email: EmailStr
    password: str

class UserUpdate(UserBase):
    email: Optional[EmailStr] = None
    password: Optional[str] = None

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
    # Add other fields like type if needed

class GroupCreate(GroupBase):
    pass

# Define GroupUpdate if needed for partial updates
# class GroupUpdate(BaseModel):
#     name: Optional[str] = None
#     description: Optional[str] = None

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
        orm_mode = True
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

class TaskResponse(TaskBase):
    id: int
    project_id: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    status_history: List[StatusHistoryResponse] = [] # status_history フィールドを追加

    # Pydantic V1 の場合
    class Config:
        orm_mode = True
        # Pydantic V2 の場合: model_config = ConfigDict(from_attributes=True) 
        from_attributes = True # orm_mode から変更 
        from_attributes = True # orm_mode から変更

# --- Note Schemas ---

class NoteBase(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None  # 後方互換性のため残す
    image_urls: Optional[List[str]] = Field(default_factory=list)
    image_positions: Optional[Dict[str, Dict[str, float]]] = Field(default_factory=dict)  # {url: {x, y, width, height}}
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