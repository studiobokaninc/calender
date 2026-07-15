// Base types based on previous context

// task_status_redesign_plan.md §2 準拠の新ステータス体系 (19種)。
// 旧 (todo/in-progress/review/approved/completed/delayed/retake) は API 側で自動変換される。
export type TaskStatus =
  // 未着手
  | 'mk'
  // 進行中 (共通 + 工程別)
  | 'wip' | 'modeling' | 'lookdev' | 'caching' | 'rig' | 'facial'
  // チェック・FB
  | 'v1qc' | 'qc' | 'qc_fb' | 'ap' | 'ap_fb' | 'dir_wt' | 'dir_ap' | 'dir_fb' | 'fix'
  // 完了
  | 'deliver'
  // 対象外・ストップ
  | 'omit' | 'wt';

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
  shot_id?: number | null;
  seq_id?: number | null;
  phases?: { name: string; date: string; is_completed?: boolean }[] | null;
  deliverables?: string | null;
  check_items?: { label: string; checked: boolean }[] | null;
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
    shot_id?: number | null;
    isPhase?: boolean; // Added
    isCompleted?: boolean; // Added for Phase status
    isDelayed?: boolean; // Added for Phase status
    deliverables?: string | null;
    check_items?: { label: string; checked: boolean }[] | null;
    taskProgress?: number | null;
    phases?: { name: string; date: string; is_completed?: boolean }[] | null;
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
  meeting_url?: string | null; // ★★★ 追加: 議事録ミーティングURL ★★★
  minutes_id?: number | null;  // ★★★ 追加: 紐付き議事録 ID ★★★
  participants?: Participant[] | null;
  user_ids?: number[] | null;
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
    projectColor?: string | null;
    groupId?: string | null;
    groupDescription?: string | null;
    groupStartDate?: string | null;
    groupEndDate?: string | null;
    isPhase?: boolean; // Added
    isCompleted?: boolean; // Added for Phase status
    isDelayed?: boolean; // Added for Phase status
    phases?: { name: string; date: string; is_completed?: boolean }[] | null; // Added
    deliverables?: string | null;
    check_items?: { label: string; checked: boolean }[] | null;
    taskProgress?: number | null;
    shotID?: string | null;
    seqID?: string | null;
    shot_id?: number | null;
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
  is_active?: boolean; // ★★★ 追加: 退職者制御カラム ★★★
  // --- User Profile Expanded Fields (§5-bis & DB物理構造準拠) ---
  birthday?: string | null;
  bio?: string | null;
  phone?: string | null;      // DB準拠
  phoneNumber?: string | null; // フロント後方互換
  line_id?: string | null;
  work_start_time?: string | null;
  work_end_time?: string | null;
  skills?: string[] | null;
  /** DBフィールド (users.avatar_url)。BE APIが返す生の値。新規コードはこちらを正とする。 */
  avatar_url?: string | null;
  /** 表示用変換値。BE レスポンスの avatar_url → iconUrl にマッピングして付与。
   *  UIコンポーネント(Avatar等)は現状この値を参照。avatar_url への完全統一は将来対応。 */
  iconUrl?: string | null;
  settings_json?: Record<string, any> | null;
  google_linked?: boolean;
  google_email?: string | null;
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
  completed_tasks?: number;
  projects: number;
  events: number;
  shots: number;
  project_metrics?: Array<{
    id: number;
    name: string;
    tasks: number;
    completed_tasks: number;
  }>;
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

// イベント作成用 (MockDataImport経由でのみ使用)
// 注意: start/end フィールドはモックデータ形式。BE APIは start_time/end_time を使用するため
// 直接のAPI呼び出しには使用しないこと。BE スキーマとの乖離は要確認。
export interface EventCreate {
  title: string;
  start: string; // ISO形式 (モックデータ用。BE API は start_time を使用)
  end: string;   // ISO形式 (モックデータ用。BE API は end_time を使用)
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

// --- Score / Production Tracker Types ---

export interface Shot {
  id: number;
  project_id: number;
  seq_code: string;
  shot_code: string;
  display_order: number;
  status: string;
  thumbnail_url?: string | null;
  description?: string | null;
  retakes_count?: number;
  troubles_count?: number;
  tasks?: { [type: string]: Task[] };
  // Content fields (ShotBase/ShotResponse)
  cut?: string | null;
  sl_no?: number | null;
  frame_in?: number | null;
  frame_out?: number | null;
  duration?: number | null;
  second?: number | null;
  frame_rem?: number | null;
  action?: string | null;
  dialogue?: string | null;
  bg?: string | null;
  ch?: string | null;
  prop?: string | null;
  task_lay?: string | null;
  task_anim?: string | null;
  task_fx?: string | null;
  task_lighting?: string | null;
  task_comp?: string | null;
  note?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Retake {
  id: number;
  shot_id: number;
  overall_comment?: string | null;
  status: 'open' | 'in_progress' | 'closed';
  priority?: string | null;
  deadline?: string | null;
  created_by: number;
  created_at: string;
  timecodes: RetakeTimecode[];
  project_name?: string | null;
  shot_code?: string | null;
  description?: string | null;
  assignee_name?: string | null;
  creator_name?: string | null;
}

export interface RetakeTimecode {
  id: number;
  retake_id: number;
  timecode: string;
  comment?: string | null;
  paint_image?: string | null; // ★★★ 追加: オーバーペイント base64 PNG または URL ★★★
  paint_mime?: string | null;  // ★★★ 追加: MIME 型 ('image/png' 等) ★★★
}

export interface Trouble {
  id: number;
  shot_id: number;
  category: string;
  description: string;
  severity?: string | null;
  status: 'open' | 'resolved' | 'closed';
  assigned_to?: number | null;
  created_by: number;
  created_at: string;
  project_name?: string | null;
  shot_code?: string | null;
  priority?: string | null;
  title?: string | null;
  reporter_name?: string | null;
  assigned_to_name?: string | null;
}

export interface Meeting {
  id: number;
  project_id: number;
  title: string;
  date: string;
  status: string; // pending, processing, completed, failed
  event_id?: number | null; // ★★★ 追加: event 紐付き用 ID ★★★
  attendees?: string[] | null; // ★★★ 追加: 出席者リスト ★★★
  audio_url?: string | null;
  analysis_seconds?: number | null; // 議事録生成にかかった秒数
  transcript?: string | null;
  decisions?: string[] | null;
  tasks?: string[] | null;
  detected_tasks?: MeetingTask[] | null; // ★★★ 追加: 検出された構造化タスク ★★★
  discussion_points?: string[] | null;
  deadlines?: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface MeetingTask {
  id: number;
  meeting_id: number;
  project_id?: number | null;
  project_name?: string | null;
  meeting_date?: string | null;
  content: string;
  type?: string | null;
  assignee_suggestion?: string | null;
  due_date_suggestion?: string | null;
  status: 'detected' | 'adopted' | 'dismissed';
  task_id?: number | null;
  created_at?: string | null;
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

export interface ChangeRequest {
  id: number;
  shot_id?: number | null;
  task_id?: number | null;
  type: string;
  proposed_value?: string | null;
  reason?: string | null;
  status: string;
  created_by: number;
  created_at: string;
}

export interface LookDistribution {
  id: number;
  shot_ids: number[];
  look_dev_id: number;
  status: string;
  assigned_to: number;
  assignee_name?: string | null;
  created_by: number;
  created_at: string;
}

export interface Delivery {
  id: number;
  task_id: number;
  status: string;
  qc_status?: string | null;
  memo?: string | null;
  created_by: number;
  created_at: string;
}

export interface Timecard {
  id: number;
  user_id: number;
  date: string;
  clock_out_at?: string | null;
  worked_minutes: number;
  break_minutes: number;
  memo?: string | null;
}

export interface Routine {
  id: number;
  user_id: number;
  date: string;
  condition?: string | null;
  blockers?: string[] | null;
  ai_priorities_adopted?: number[] | null;
}

export interface UserMessage {
  id: number;
  channel_id: string;
  shot_id?: number | null;
  body: string;
  author_id: number;
  author_name?: string | null;
  author_username?: string | null;
  author_email?: string | null;
  created_at: string;
}

export interface Notification {
  id: number;
  recipient_id: number;
  type: string;
  body: string;
  is_read: boolean;
  created_at: string;
  project_name?: string | null;
  content?: string | null;
}

export interface ScoreUserRole {
  id: number;
  user_id: number;
  project_id: number;
  role: string;
}

export interface Asset {
  id: number;
  shot_id: number | null;
  task_id: number | null;
  version: string;
  file_path: string;
  created_by: number;
  created_at: string;
}