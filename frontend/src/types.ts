// Base types based on previous context

export interface Project {
  id: number;
  name: string;
  description?: string | null;
  status?: string | null;
  priority?: 'high' | 'medium' | 'low' | null;
  display_status?: 'online' | 'offline' | 'archived' | string | null;
  color?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  // Add other project-specific fields like total_cost if available
}

// ★★★ BaseSchema の代わりに Task に直接プロパティを追加 ★★★
export interface Task {
  id: number;
  project_id?: number | null;
  assigned_to?: number | null;
  name: string;
  description?: string | null;
  status?: string | null;
  display_status?: 'online' | 'offline' | 'archived' | string | null;
  start_date?: string | null;
  due_date?: string | null;
  progress?: number | null;
  cost?: number | null;
  dependsOn?: string[] | null;
  status_history?: StatusHistoryEntry[]; // ★★★ 追加: ステータス履歴の配列 (Optional) ★★★
  created_at?: string | null;
  updated_at?: string | null;
  has_validation_errors?: boolean; // ★★★ 追加: 無効なデータがあることを示すフラグ ★★★
  type?: string | null; // タスクタイプ
  priority?: 'low' | 'medium' | 'high' | 'LOW' | 'MEDIUM' | 'HIGH' | string | null;
  seqID?: string | null;
  shotID?: string | null;
  phases?: { name: string; date: string; is_completed?: boolean }[] | null;
  extendedProps: {
    type: 'project' | 'task' | 'Meeting' | 'Workshop' | 'Deadline' | 'Milestone' | 'Generic' | string;
    description?: string | null;
    location?: string | null;
    participants?: Participant[];
    projectId?: string | number | null;
    projectStatus?: string | null;
    projectDescription?: string | null;
    projectStartDate?: string | null;
    projectEndDate?: string | null;
    taskId?: number | null;
    taskDueDate?: string | null;
    taskStartDate?: string | null; // Added
    taskAssigneeId?: string | number | null;
    taskCost?: number | null;
    taskStatus?: string | null;
    status?: 'online' | 'offline' | string | null;
    displayStatus?: 'online' | 'offline' | 'archived' | string | null;
    dependsOn?: string[] | null;
    taskType?: string | null; // Added
    priority?: 'low' | 'medium' | 'high' | null;
    seqID?: string | null;
    shotID?: string | null;
    isPhase?: boolean; // Added
    isCompleted?: boolean; // Added for Phase status
    isDelayed?: boolean; // Added for Phase status
  };
}

// ★★★ ステータス履歴のエントリ ★★★
export interface StatusHistoryEntry {
  id: number; // 履歴エントリの ID
  task_id: number; // 関連するタスクの ID
  status: string; // 変更後のステータス (TaskStatus Enum に合わせるべきだが、一旦 string)
  timestamp: string; // 変更日時の ISO 文字列（後方互換性のため残す）
  changed_at: string; // 変更日時の ISO 文字列（新しい形式）
  changed_by: number; // 変更を行ったユーザーの ID
}

// Define participant structure
export interface Participant {
  id: number;
  type: 'user' | 'group';
}

// Assuming a basic backend Event structure
export interface BackendEvent {
  id: number;
  title: string;
  description?: string | null;
  type?: string | null;
  location?: string | null;
  allDay?: boolean | null;
  start_time?: string | null;
  end_time?: string | null;
  status?: string | null;
  project_id?: number | null;
  participants?: Participant[] | null;
  created_at?: string | null;
  updated_at?: string | null;
}

// FullCalendar event object structure used in the frontend
export interface CalendarEvent {
  id: string; // FullCalendar uses string IDs
  title: string;
  start: string | Date;
  end?: string | Date | null;
  allDay?: boolean;
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  classNames?: string[];
  display?: 'auto' | 'block' | 'list-item' | 'background' | 'inverse-background' | 'none';
  editable?: boolean;
  // Store original backend data and additional processed data
  extendedProps: {
    type: 'project' | 'task' | 'Meeting' | 'Workshop' | 'Deadline' | 'Milestone' | 'Generic' | string;
    description?: string | null;
    location?: string | null;
    participants?: Participant[];
    projectId?: string | number | null;
    projectStatus?: string | null;
    projectDescription?: string | null;
    projectStartDate?: string | null;
    projectEndDate?: string | null;
    taskId?: number | null;
    taskDueDate?: string | null;
    taskStartDate?: string | null; // Added
    taskAssigneeId?: string | number | null;
    taskCost?: number | null;
    taskStatus?: string | null;
    status?: 'online' | 'offline' | string | null;
    displayStatus?: 'online' | 'offline' | 'archived' | string | null;
    dependsOn?: string[] | null;
    actualStartTime?: string | null;
    taskPriority?: 'low' | 'medium' | 'high' | null; // Added
    taskType?: string | null; // Added to fix lint error
    isPhase?: boolean; // Added
    isCompleted?: boolean; // Added for Phase status
    isDelayed?: boolean; // Added for Phase status
    phases?: { name: string; date: string; is_completed?: boolean }[] | null; // Added
  };
}

// Interface for User data
export interface User {
  id: number;
  email: string;
  username?: string;
  full_name?: string;
  name?: string;
  role?: string;
  base_load_hours_per_week?: number; // 週あたりの定常業務時間（ベースロード）
  // --- User Profile Settings ---
  language?: string;
  iconUrl?: string; // URL to the user's profile picture
  birthday?: string; // ISO 8601 date string (YYYY-MM-DD)
  phoneNumber?: string;
  gender?: string;
  // --- End User Profile Settings ---
}

// Interface for Group data
export interface Group {
  id: number;
  name: string;
  description?: string;
  type?: string;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  // Add other group properties
}

// Interface for Metrics data
export interface DashboardMetrics {
  users: number;
  tasks: number;
  projects: number;
  events: number;
}

// ★★★ Remove UserGroup interface if it conflicts or isn't used extensively ★★★
// It might be simpler to manage relationships directly where needed
// export interface UserGroup { ... } 

// ★★★ UserGroup 型を追加 ★★★
export interface UserGroup {
  user_id: number;
  group_id: number;
  role?: string | null; // 役割 (Optional)
  created_at?: string | null;
  updated_at?: string | null;
}

// --- APIリクエスト/レスポンス用 (既存のものを確認) ---

// ユーザー作成用 (パスワードを含む)
export interface UserCreate {
  email: string;
  password?: string; // パスワードはインポート時に必要になる可能性
  full_name?: string | null;
  role?: 'admin' | 'user';
  is_active?: boolean;
}

// プロジェクト作成用
export interface ProjectCreate {
  name: string;
  projectStatus?: string;
  projectStartDate?: string | null;
  projectDueDate?: string | null;
}

// タスク作成用
export interface TaskCreate {
  name: string;
  description?: string;
  project_id?: number;
  status?: string;
  due_date?: string;
  assigned_to?: number;
  cost?: number;
  dependsOn?: string[];
  display_status?: 'online' | 'offline' | 'archived';
  priority?: 'low' | 'medium' | 'high';
  type?: string;
  start_date?: string;
  progress?: number;
}

// イベント作成用
export interface EventCreate {
  title: string;
  start: string; // ISO形式
  end: string;   // ISO形式
  description?: string | null;
}

// グループ作成用
export interface GroupCreate {
  name: string;
  description?: string | null;
}

// ユーザーグループ作成用
export interface UserGroupCreate {
  user_id: string;
  group_id: string;
}


// ★★★ モックデータインポート用 ★★★
export interface MockDataImport {
  users: UserCreate[];
  projects: ProjectCreate[];
  tasks: TaskCreate[];
  events: EventCreate[];
  groups?: GroupCreate[] | null;
  user_groups?: UserGroupCreate[] | null;
}

// メモ用の型
export interface Note {
  id: number;
  title?: string | null;
  content?: string | null; // 後方互換性のため残す
  image_urls?: string[] | null;
  image_positions?: { [url: string]: { x: number; y: number; width: number; height: number } } | null;
  pdf_urls?: string[] | null;
  pdf_positions?: { [url: string]: { x: number; y: number; width: number; height: number } } | null;
  audio_urls?: string[] | null;
  audio_positions?: { [url: string]: { x: number; y: number; width: number; height: number } } | null;
  content_position?: { x: number; y: number; width: number; height: number } | null; // 後方互換性のため残す
  text_boxes?: Array<{ id: string; content: string; x: number; y: number; width: number; height: number }> | null;
  project_id?: number | null;
  created_by: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface NoteCreate {
  title?: string | null;
  content?: string | null; // 後方互換性のため残す
  image_urls?: string[] | null;
  image_positions?: { [url: string]: { x: number; y: number; width: number; height: number } } | null;
  pdf_urls?: string[] | null;
  pdf_positions?: { [url: string]: { x: number; y: number; width: number; height: number } } | null;
  audio_urls?: string[] | null;
  audio_positions?: { [url: string]: { x: number; y: number; width: number; height: number } } | null;
  content_position?: { x: number; y: number; width: number; height: number } | null; // 後方互換性のため残す
  text_boxes?: Array<{ id: string; content: string; x: number; y: number; width: number; height: number }> | null;
  project_id?: number | null;
}

export interface Meeting {
  id: number;
  project_id: number;
  title: string;
  date: string;
  audio_url?: string | null;
  transcript?: string | null;
  decisions?: string[] | null;
  tasks?: string[] | null;
  discussion_points?: string[] | null;
  deadlines?: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface NoteUpdate {
  title?: string | null;
  content?: string | null; // 後方互換性のため残す
  image_urls?: string[] | null;
  image_positions?: { [url: string]: { x: number; y: number; width: number; height: number } } | null;
  pdf_urls?: string[] | null;
  pdf_positions?: { [url: string]: { x: number; y: number; width: number; height: number } } | null;
  audio_urls?: string[] | null;
  audio_positions?: { [url: string]: { x: number; y: number; width: number; height: number } } | null;
  content_position?: { x: number; y: number; width: number; height: number } | null; // 後方互換性のため残す
  text_boxes?: Array<{ id: string; content: string; x: number; y: number; width: number; height: number }> | null;
  project_id?: number | null;
}