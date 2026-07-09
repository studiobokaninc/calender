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
    // 0.0: 未着手 (クールカラー)
    case 'mk':
      return '#1E88E5'; // Blue 600
    // 0.2: 作業ストップ (警告・一時停止)
    case 'wt':
      return '#E53935'; // Red 600
    // 0.4: 進行中 (暖色系・進行順)
    case 'wip':
      return '#FFA726'; // Orange 400
    case 'modeling':
      return '#FB8C00'; // Orange 600
    case 'lookdev':
      return '#F57C00'; // Orange 700
    case 'caching':
      return '#E65100'; // Orange 900
    case 'rig':
      return '#FFB300'; // Amber 600
    case 'facial':
      return '#FDD835'; // Yellow 600
    // 0.4: 各種フィードバック (アクション要・ピンク/ローズ系)
    case 'qc_fb':
      return '#E91E63'; // Pink 500 (社内FB)
    case 'ap_fb':
      return '#D81B60'; // Pink 600 (社外FB)
    case 'dir_fb':
      return '#C2185B'; // Pink 700 (ディレクターFB)
    // 0.7: レビュー中 (中間色・パープル/ティール系)
    case 'v1qc':
      return '#BA68C8'; // Orchid/Purple 300 (社内チェック初回)
    case 'qc':
      return '#8E24AA'; // Purple 600 (社内チェック中)
    case 'dir_wt':
      return '#26A69A'; // Teal 500 (クライアント確認待ち)
    // 0.85 - 0.95: 承認済・最終調整 (グリーン系・ゴール目前)
    case 'ap':
      return '#81C784'; // Light Green 400 (社内承認済)
    case 'dir_ap':
      return '#4CAF50'; // Green 500 (社外承認済)
    case 'fix':
      return '#2E7D32'; // Green 800 (最終FIX)
    // 1.0: 完了 (用済み・グレー)
    case 'deliver':
      return '#757575'; // Gray 600 (納品完了)
    // その他/対象外
    case 'omit':
      return '#E0E0E0'; // Light Gray (対象外)
    default:
      return '#BDBDBD';
  }
};

// ---------------------------------------------------------------------------
// Chip 統合スタイル (§6.2 の getTaskStatusChipStyle)
// - omit は取り消し線 + ダッシュボーダーでアクセシビリティ確保
// - オレンジ・黄・ライトグリーン・ライトティール等の明度の高い色は白文字だとコントラスト不足のためダーク文字に自動切替
// - theme 引数があれば MUI palette.getContrastText を優先利用
// ---------------------------------------------------------------------------
export const getTaskStatusChipStyle = (
  status?: string | null,
  theme?: { palette?: { getContrastText?: (bg: string) => string } },
): CSSProperties => {
  const color = getTaskStatusColor(status);
  const s = status?.toLowerCase();
  const canonical = LEGACY_STATUS_MAP[s ?? ''] ?? s;
  const isOmit = canonical === 'omit';

  let textColor: string = 'white';
  if (isOmit) {
    textColor = '#757575';
  } else if (theme?.palette?.getContrastText) {
    textColor = theme.palette.getContrastText(color);
  } else if (
    canonical === 'wip' ||
    canonical === 'modeling' ||
    canonical === 'lookdev' ||
    canonical === 'caching' ||
    canonical === 'rig' ||
    canonical === 'facial' ||
    canonical === 'v1qc' ||
    canonical === 'dir_wt' ||
    canonical === 'ap'
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

export interface StatusBreakdown {
  todo: number;
  inProgress: number;
  delayed: number;
  completed: number;
}

export const getStatusBreakdown = (
  tasks: any[],
  options?: { projectDisplayStatus?: string | null }
): StatusBreakdown => {
  let todo = 0;
  let inProgress = 0;
  let delayed = 0;
  let completed = 0;

  const today = todayStrJST();

  tasks.forEach(task => {
    const status = (task.status || 'mk').toLowerCase();
    const canonical = (LEGACY_STATUS_MAP[status] ?? status) as string;

    // Completed: deliver, completed
    if (canonical === 'deliver' || canonical === 'completed') {
      completed++;
      return;
    }

    // Excluded from breakdown: omit and wt
    if (canonical === 'omit' || canonical === 'wt') {
      return;
    }

    // Check if task is overdue
    if (isOverdue(task, today, options)) {
      delayed++;
      return;
    }

    // Todo: mk, todo, planning
    if (canonical === 'mk' || canonical === 'todo' || canonical === 'planning') {
      todo++;
      return;
    }

    // In Progress: everything else
    inProgress++;
  });

  return { todo, inProgress, delayed, completed };
};
