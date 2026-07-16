// タスクステータス関連の共有ユーティリティ (docs/task_status_redesign_v2_plan.md 準拠)
// - 有効9ステータス (wt/mk/wip/qc/qc_fb/ap/client_ap/deliver/omit) のカラー・ラベル・カテゴリ
// - 旧19体系/旧7体系の値は新9値へ畳み込んで表示・集計する (LEGACY_STATUS_MAP)
// - MUI Chip 用のコントラスト自動調整スタイル (getTaskStatusChipStyle)
// - Asia/Tokyo 基準の isOverdue 派生フラグ
//
// バックエンド app/status_meta.py と必ず同期すること。
// 各ページは本モジュールから import することでラベル・色の齟齬を防ぐ。

import type { CSSProperties } from 'react';
import type { TaskStatus } from '../types';

// ---------------------------------------------------------------------------
// カテゴリ (ロジック用 5分類)
//   completed = ap / client_ap / deliver
//   held      = wt / omit  (遅延・オンスケ統計から除外)
// ---------------------------------------------------------------------------
export type TaskStatusCategory = 'todo' | 'in_progress' | 'review' | 'completed' | 'held';

const CATEGORY_MAP: Record<string, TaskStatusCategory> = {
  wt: 'held',
  mk: 'todo',
  wip: 'in_progress',
  qc: 'review',
  qc_fb: 'review',
  ap: 'completed',
  client_ap: 'completed',
  deliver: 'completed',
  omit: 'held',
};

export const getTaskStatusCategory = (status?: string | null): TaskStatusCategory | null => {
  if (!status) return null;
  const canonical = canonicalizeStatus(status);
  return (canonical && CATEGORY_MAP[canonical]) || null;
};

// ---------------------------------------------------------------------------
// 表示ラベル (有効9ステータス)
// ---------------------------------------------------------------------------
const LABEL_MAP: Record<string, string> = {
  wt: 'WT',
  mk: 'MK',
  wip: 'WIP',
  qc: 'QC',
  qc_fb: 'QC_FB',
  ap: 'AP',
  client_ap: 'CLIENT_AP',
  deliver: 'DELIVER',
  omit: 'OMIT',
};

export const getTaskStatusLabel = (status?: string | null): string => {
  if (!status) return '未定';
  const canonical = canonicalizeStatus(status) ?? status.toLowerCase();
  return LABEL_MAP[canonical] || status;
};

// ---------------------------------------------------------------------------
// 系統色 (§7)。旧値は新9値へ畳み込んでから色を返す。
// ---------------------------------------------------------------------------
const COLOR_MAP: Record<string, string> = {
  wt: '#BDBDBD',        // グレー (待機/初期)
  mk: '#2196F3',        // ブルー (未着手)
  wip: '#FF9800',       // オレンジ (進行中)
  qc: '#9C27B0',        // パープル (社内チェック)
  qc_fb: '#E91E63',     // ピンク (FB修正)
  ap: '#4CAF50',        // グリーン (社内承認済)
  client_ap: '#2E7D32', // 濃グリーン (クライアント承認済)
  deliver: '#757575',   // ダークグレー (納品完了)
  omit: '#E0E0E0',      // 薄グレー / 取消線 (対象外)
};

export const getTaskStatusColor = (status?: string | null): string => {
  if (!status) return '#BDBDBD';
  const canonical = canonicalizeStatus(status) ?? status.toLowerCase();
  return COLOR_MAP[canonical] || '#BDBDBD';
};

// ---------------------------------------------------------------------------
// Chip 統合スタイル
// - omit は取り消し線 + ダッシュボーダーでアクセシビリティ確保
// - 明度の高い背景 (wt グレー / wip オレンジ / mk ブルー) は暗色文字へ自動切替
// - theme 引数があれば MUI palette.getContrastText を優先利用
// ---------------------------------------------------------------------------
const DARK_TEXT_STATUSES = new Set(['wt', 'wip']);

export const getTaskStatusChipStyle = (
  status?: string | null,
  theme?: { palette?: { getContrastText?: (bg: string) => string } },
): CSSProperties => {
  const color = getTaskStatusColor(status);
  const canonical = canonicalizeStatus(status) ?? status?.toLowerCase();
  const isOmit = canonical === 'omit';

  let textColor: string = 'white';
  if (isOmit) {
    textColor = '#757575';
  } else if (theme?.palette?.getContrastText) {
    textColor = theme.palette.getContrastText(color);
  } else if (canonical && DARK_TEXT_STATUSES.has(canonical)) {
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
// 選択肢 (有効9ステータス、UI 表示順)
// ---------------------------------------------------------------------------
export const TASK_STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
  { value: 'wt', label: 'WT' },
  { value: 'mk', label: 'MK' },
  { value: 'wip', label: 'WIP' },
  { value: 'qc', label: 'QC' },
  { value: 'qc_fb', label: 'QC_FB' },
  { value: 'ap', label: 'AP' },
  { value: 'client_ap', label: 'CLIENT_AP' },
  { value: 'deliver', label: 'DELIVER' },
  { value: 'omit', label: 'OMIT' },
];

// ---------------------------------------------------------------------------
// 推奨遷移マトリクス (§1.3) — UIガイド用。
// API は任意遷移を許容するため、ここでは「推奨」を示すのみで選択自体は制限しない。
// current(正規化後) → 推奨される遷移先(表示順)。omit へは全ステータスから遷移可。
// ※ 印付き遷移(差戻し)も含む。
// ---------------------------------------------------------------------------
const RECOMMENDED_NEXT: Record<string, string[]> = {
  wt: ['mk', 'omit'],
  mk: ['wip', 'omit'],
  wip: ['qc', 'omit'],
  qc: ['ap', 'qc_fb', 'wip', 'omit'],
  qc_fb: ['wip', 'qc', 'omit'],
  ap: ['client_ap', 'deliver', 'qc_fb', 'omit'],
  client_ap: ['deliver', 'qc_fb', 'omit'],
  deliver: ['qc_fb', 'wip', 'qc', 'omit'],
  omit: ['wt', 'mk'],
};

// current から推奨される遷移先ステータス(有効9値)の配列を返す。
export const getRecommendedNextStatuses = (current?: string | null): string[] => {
  const c = canonicalizeStatus(current);
  if (!c) return [];
  return RECOMMENDED_NEXT[c] ?? [];
};

// from → to が推奨遷移か。
export const isRecommendedTransition = (from?: string | null, to?: string | null): boolean => {
  const t = canonicalizeStatus(to);
  if (!t) return false;
  return getRecommendedNextStatuses(from).includes(t);
};

// ステータス選択肢に「推奨(★)」フラグを付けて返す。
// 並び順は常に TASK_STATUS_OPTIONS の既定順で固定（current によって順序は変わらない）。
// 全9値を常に含む（API は任意遷移を許容するため選択自体は制限しない）。
export interface StatusOption {
  value: TaskStatus;
  label: string;
  recommended: boolean;
}

export const getStatusOptionsFor = (current?: string | null): StatusOption[] => {
  const recSet = new Set(getRecommendedNextStatuses(current));
  // 既定順を維持したまま推奨フラグのみ付与する
  return TASK_STATUS_OPTIONS.map(o => ({
    value: o.value,
    label: o.label,
    recommended: recSet.has(o.value),
  }));
};

// ---------------------------------------------------------------------------
// プロジェクト全体進捗のウェイト (§4)
// omit は null = 分母分子ともに除外扱い
// ---------------------------------------------------------------------------
export const STATUS_PROGRESS_WEIGHT: Record<string, number | null> = {
  ap: 1.0,
  client_ap: 1.0,
  deliver: 1.0,
  qc: 0.7,
  wip: 0.4,
  qc_fb: 0.4,
  mk: 0,
  wt: 0,
  omit: null,
};

export const getStatusProgressWeight = (status?: string | null): number | null => {
  if (!status) return null;
  const canonical = canonicalizeStatus(status) ?? status.toLowerCase();
  const w = STATUS_PROGRESS_WEIGHT[canonical];
  return w === undefined ? null : w;
};

// ---------------------------------------------------------------------------
// Asia/Tokyo 基準の overdue 判定
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

// 遅延はステータスではなく派生フラグ (§2)。
// 完了カテゴリ (ap/client_ap/deliver) と 待機・対象外 (wt/omit) は遅延から除外。
// options.projectDisplayStatus を渡すとオンラインプロジェクトのみに絞れる:
//   'online' 以外 (offline / archived) のプロジェクトのタスクは isOverdue=false を返す。
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
  const canonical = canonicalizeStatus(task.status) ?? task.status?.toLowerCase();
  // 完了カテゴリ・待機・対象外は遅延から除外
  const cat = canonical ? CATEGORY_MAP[canonical] : null;
  if (cat === 'completed' || cat === 'held') return false;
  return due < today;
};

// ---------------------------------------------------------------------------
// 旧ステータス → 新9ステータスへの畳み込み
// 旧7体系 (todo/in-progress/...) + 旧19体系 (modeling/fix/...) + 表記揺れ を吸収
// ---------------------------------------------------------------------------
const LEGACY_STATUS_MAP: Record<string, TaskStatus> = {
  // 旧7体系 / API 表記
  todo: 'mk',
  'in-progress': 'wip',
  in_progress: 'wip',
  review: 'qc',
  approved: 'ap',
  completed: 'deliver',
  delayed: 'wip',
  retake: 'qc_fb',
  cashing: 'wip',
  // 表記揺れ
  'qc-fb': 'qc_fb',
  'ap-fb': 'qc_fb',
  'dir-wt': 'qc',
  'dir-ap': 'ap',
  'dir-fb': 'qc_fb',
  'client-ap': 'client_ap',
  // 旧19体系の工程別 → wip
  modeling: 'wip',
  lookdev: 'wip',
  caching: 'wip',
  rig: 'wip',
  facial: 'wip',
  // 旧19体系のチェック/FB系 → 新体系へ集約
  v1qc: 'qc',
  dir_wt: 'qc',
  ap_fb: 'qc_fb',
  dir_fb: 'qc_fb',
  fix: 'qc_fb',
  dir_ap: 'ap',
};

const ACTIVE_STATUS_SET = new Set<string>(Object.keys(LABEL_MAP));

// 任意のステータス文字列を有効9値へ正規化する。未知値は null。
export const canonicalizeStatus = (value?: string | null): string | null => {
  if (!value) return null;
  const s = String(value).trim().toLowerCase();
  if (!s) return null;
  if (ACTIVE_STATUS_SET.has(s)) return s;
  const mapped = LEGACY_STATUS_MAP[s];
  return mapped ?? null;
};

export const migrateLegacyStatus = (value?: string | null): TaskStatus | null => {
  if (!value) return null;
  const s = String(value).trim().toLowerCase();
  if (ACTIVE_STATUS_SET.has(s)) return s as TaskStatus;
  if (LEGACY_STATUS_MAP[s]) return LEGACY_STATUS_MAP[s];
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
    const canonical = canonicalizeStatus(task.status) ?? 'mk';
    const cat = CATEGORY_MAP[canonical];

    // Completed: ap / client_ap / deliver
    if (cat === 'completed') {
      completed++;
      return;
    }

    // Excluded from breakdown: 待機・対象外 (wt / omit)
    if (cat === 'held') {
      return;
    }

    // Check if task is overdue
    if (isOverdue(task, today, options)) {
      delayed++;
      return;
    }

    // Todo: mk
    if (cat === 'todo') {
      todo++;
      return;
    }

    // In Progress: wip / qc / qc_fb
    inProgress++;
  });

  return { todo, inProgress, delayed, completed };
};
