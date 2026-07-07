// タスクステータス関連の共有ユーティリティ (docs/task_status_redesign_plan.md §6 準拠)
// - 19 種の状態を 7 色に集約したカラーパレット
// - MUI Chip 用のコントラスト自動調整スタイル (getTaskStatusChipStyle)
// - Asia/Tokyo 基準の isOverdue 派生フラグ
// - 旧ステータス値の sessionStorage 移行ヘルパー
//
// 各ページは本モジュールから import することでラベル・色の齟齬を防ぐ。

import type { CSSProperties } from 'react';
import type { TaskStatus } from '../types';

// ---------------------------------------------------------------------------
// カテゴリ (ロジック用 5分類)
// ---------------------------------------------------------------------------
export type TaskStatusCategory = 'todo' | 'in_progress' | 'review' | 'completed' | 'held';

const CATEGORY_MAP: Record<string, TaskStatusCategory> = {
  mk: 'todo',
  wip: 'in_progress',
  modeling: 'in_progress',
  lookdev: 'in_progress',
  caching: 'in_progress',
  rig: 'in_progress',
  facial: 'in_progress',
  v1qc: 'review',
  qc: 'review',
  qc_fb: 'review',
  ap: 'review',
  ap_fb: 'review',
  dir_wt: 'review',
  dir_ap: 'review',
  dir_fb: 'review',
  fix: 'review',
  deliver: 'completed',
  omit: 'held',
  wt: 'held',
};

export const getTaskStatusCategory = (status?: string | null): TaskStatusCategory | null => {
  if (!status) return null;
  return CATEGORY_MAP[status.toLowerCase()] || null;
};

// ---------------------------------------------------------------------------
// アルファベット表示ラベル (§6.2)
// ---------------------------------------------------------------------------
const LABEL_MAP: Record<string, string> = {
  mk: 'MK',
  wip: 'WIP',
  modeling: 'Modeling',
  lookdev: 'LookDev',
  caching: 'Caching',
  rig: 'Rig',
  facial: 'Facial',
  v1qc: 'V1QC',
  qc: 'QC',
  qc_fb: 'QC_FB',
  ap: 'AP',
  ap_fb: 'AP_FB',
  dir_wt: 'Dir_WT',
  dir_ap: 'Dir_AP',
  dir_fb: 'Dir_FB',
  fix: 'FIX',
  deliver: 'Deliver',
  omit: 'Omit',
  wt: 'WT',
};

export const getTaskStatusLabel = (status?: string | null): string => {
  if (!status) return '未定';
  const s = status.toLowerCase();
  // 旧値 (todo/in-progress/completed 等) が渡ってきても新体系のラベルを返す
  const canonical = LEGACY_STATUS_MAP[s] ?? s;
  return LABEL_MAP[canonical] || status;
};

// ---------------------------------------------------------------------------
// 系統色 (7 パターン)
// 旧値 (todo/in-progress/review/approved/completed/delayed/retake) が渡ってきても
// 新値に自動マッピングして正しい色を返す (移行期間中の互換性確保)。
// ---------------------------------------------------------------------------
export const getTaskStatusColor = (status?: string | null): string => {
  if (!status) return '#BDBDBD';
  const lower = status.toLowerCase();
  const canonical = LEGACY_STATUS_MAP[lower] ?? lower;
  switch (canonical) {
    case 'mk':
      return '#2196F3'; // 1. 未着手 (青)
    case 'omit':
      return '#E0E0E0'; // 2. 作業対象外 (最薄グレー)
    case 'wt':
      return '#F44336'; // 3. 作業ストップ (赤)
    case 'wip':
    case 'modeling':
    case 'lookdev':
    case 'caching':
    case 'rig':
    case 'facial':
      return '#FF9800'; // 4. 進行中 (オレンジ)
    case 'v1qc':
    case 'qc':
    case 'qc_fb':
    case 'ap':
      return '#9C27B0'; // 5. 社内チェック (パープル)
    case 'ap_fb':
    case 'dir_wt':
    case 'dir_ap':
    case 'dir_fb':
    case 'fix':
      return '#4CAF50'; // 6. 社外チェック (緑)
    case 'deliver':
      return '#757575'; // 7. 完了 (ダークグレー)
    default:
      return '#BDBDBD';
  }
};

// ---------------------------------------------------------------------------
// Chip 統合スタイル (§6.2 の getTaskStatusChipStyle)
// - omit は取り消し線 + ダッシュボーダーでアクセシビリティ確保
// - オレンジ系は白文字だとコントラスト不足のためダーク文字に自動切替
// - theme 引数があれば MUI palette.getContrastText を優先利用
// ---------------------------------------------------------------------------
export const getTaskStatusChipStyle = (
  status?: string | null,
  theme?: { palette?: { getContrastText?: (bg: string) => string } },
): CSSProperties => {
  const color = getTaskStatusColor(status);
  const s = status?.toLowerCase();
  const isOmit = s === 'omit';

  let textColor: string = 'white';
  if (isOmit) {
    textColor = '#757575';
  } else if (theme?.palette?.getContrastText) {
    textColor = theme.palette.getContrastText(color);
  } else if (
    s === 'wip' ||
    s === 'modeling' ||
    s === 'lookdev' ||
    s === 'caching' ||
    s === 'rig' ||
    s === 'facial'
  ) {
    textColor = '#202124';
  }

  return {
    backgroundColor: color,
    color: textColor,
    textDecoration: isOmit ? 'line-through' : 'none',
    border: isOmit ? '1px dashed #9E9E9E' : undefined,
  };
};

// ---------------------------------------------------------------------------
// 選択肢 (19 種、UI 表示順)
// ---------------------------------------------------------------------------
export const TASK_STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: 'mk', label: 'MK' },
  { value: 'wip', label: 'WIP' },
  { value: 'modeling', label: 'Modeling' },
  { value: 'lookdev', label: 'LookDev' },
  { value: 'caching', label: 'Caching' },
  { value: 'rig', label: 'Rig' },
  { value: 'facial', label: 'Facial' },
  { value: 'v1qc', label: 'V1QC' },
  { value: 'qc', label: 'QC' },
  { value: 'qc_fb', label: 'QC_FB' },
  { value: 'ap', label: 'AP' },
  { value: 'ap_fb', label: 'AP_FB' },
  { value: 'dir_wt', label: 'Dir_WT' },
  { value: 'dir_ap', label: 'Dir_AP' },
  { value: 'dir_fb', label: 'Dir_FB' },
  { value: 'fix', label: 'FIX' },
  { value: 'deliver', label: 'Deliver' },
  { value: 'omit', label: 'Omit' },
  { value: 'wt', label: 'WT' },
];

// ---------------------------------------------------------------------------
// プロジェクト全体進捗のウェイト (§3.4)
// omit は null = 分母分子ともに除外扱い
// ---------------------------------------------------------------------------
export const STATUS_PROGRESS_WEIGHT: Record<string, number | null> = {
  mk: 0,
  wip: 0.4,
  modeling: 0.4,
  lookdev: 0.4,
  caching: 0.4,
  rig: 0.4,
  facial: 0.4,
  qc_fb: 0.4,
  ap_fb: 0.4,
  dir_fb: 0.4,
  wt: 0.2,
  qc: 0.7,
  v1qc: 0.7,
  dir_wt: 0.7,
  ap: 0.85,
  fix: 0.95,
  dir_ap: 0.95,
  deliver: 1.0,
  omit: null,
};

export const getStatusProgressWeight = (status?: string | null): number | null => {
  if (!status) return null;
  const w = STATUS_PROGRESS_WEIGHT[status.toLowerCase()];
  return w === undefined ? null : w;
};

// ---------------------------------------------------------------------------
// Asia/Tokyo 基準の overdue 判定 (§6.4)
// date-fns-tz 未導入のため Intl.DateTimeFormat で軽量に算出する
// ---------------------------------------------------------------------------
export const PROJECT_TIMEZONE = 'Asia/Tokyo';

export const normalizeDateOnly = (value?: string | null): string | null => {
  if (!value) return null;
  const raw = String(value).trim();
  // YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss...
  const isoLike = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoLike) {
    const [, y, m, d] = isoLike;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // YYYY/M/D
  const slashLike = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slashLike) {
    const [, y, m, d] = slashLike;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
};

// Intl で「JST の今日 (YYYY-MM-DD)」を得る。ブラウザ TZ に依存しない。
export const todayStrJST = (base: Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PROJECT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(base);
  const y = parts.find(p => p.type === 'year')?.value ?? '1970';
  const m = parts.find(p => p.type === 'month')?.value ?? '01';
  const d = parts.find(p => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
};

// 遅延はステータスではなく派生フラグ。deliver / omit / 旧 completed は対象外 (§6.4)
// options.projectDisplayStatus を渡すとオンラインプロジェクトのみに絞れる (§遅延タスク表示ルール):
//   'online' 以外 (offline / archived) のプロジェクトのタスクは isOverdue=false を返す。
// 呼び出し側で親プロジェクトを解決してから渡すこと。
export const isOverdue = (
  task: { due_date?: string | null; status?: string | null },
  today: string = todayStrJST(),
  options?: { projectDisplayStatus?: string | null },
): boolean => {
  // オンラインプロジェクト以外のタスクは遅延扱いにしない
  if (options && options.projectDisplayStatus !== undefined) {
    const pds = (options.projectDisplayStatus ?? 'online').toLowerCase();
    if (pds !== 'online') return false;
  }
  const due = normalizeDateOnly(task.due_date);
  if (!due) return false;
  const s = task.status?.toLowerCase();
  // 新: deliver / omit、旧: completed は完了/対象外扱いで遅延から除外
  if (s === 'deliver' || s === 'omit' || s === 'completed') return false;
  return due < today;
};

// ---------------------------------------------------------------------------
// 旧ステータス → 新ステータス変換 (sessionStorage 内フィルター等の互換用)
// ---------------------------------------------------------------------------
const LEGACY_STATUS_MAP: Record<string, TaskStatus> = {
  todo: 'mk',
  'in-progress': 'wip',
  in_progress: 'wip',
  review: 'qc',
  approved: 'ap',
  completed: 'deliver',
  delayed: 'wip',
  retake: 'qc_fb',
  cashing: 'caching',
  // 新体系のハイフン表記揺れも救済
  'qc-fb': 'qc_fb',
  'ap-fb': 'ap_fb',
  'dir-wt': 'dir_wt',
  'dir-ap': 'dir_ap',
  'dir-fb': 'dir_fb',
};

const NEW_STATUS_SET = new Set<string>(Object.keys(LABEL_MAP));

export const migrateLegacyStatus = (value?: string | null): TaskStatus | null => {
  if (!value) return null;
  const s = String(value).trim().toLowerCase();
  if (LEGACY_STATUS_MAP[s]) return LEGACY_STATUS_MAP[s];
  if (NEW_STATUS_SET.has(s)) return s as TaskStatus;
  return null;
};
