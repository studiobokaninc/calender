import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Breadcrumbs,
  Link,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Snackbar,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Tooltip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  InputAdornment,
  FormControlLabel,
  Switch,
} from '@mui/material';
import {
  OpenInNew as OpenInNewIcon,
  Close as CloseIcon,
  Refresh as RefreshIcon,
  Notifications as NotificationsIcon,
  ChatBubbleOutline as ChatIcon,
  MailOutline as MailIcon,
  PhotoLibrary as PhotoLibraryIcon,
  Image as ImageIcon,
  LocalShipping as LocalShippingIcon,
  AccessTime as AccessTimeIcon,
  PlaylistAddCheck as ChecklistIcon,
  ReportProblem as ReportProblemIcon,
  Badge as BadgeIcon,
  InboxOutlined as InboxIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import {
  fetchAdminTimecards,
  fetchAdminRoutines,
  fetchAdminNotifications,
  fetchAdminUserMessages,
  fetchAdminDeliveries,
  fetchAdminReferenceMaterials,
  fetchAdminDMThreads,
  fetchAdminScoreUserRoles,
  fetchAdminTroubles,
  updateScoreUserRole,
  patchAdminTroubleResolve,
  patchAdminTroubleReopen,
  patchAdminNotificationRead,
  fetchUsers,
  fetchProjects,
} from '../services/api';
import MaterialsView from '../components/score/MaterialsView';
import DmView from '../components/score/DmView';

const PAGE_LIMIT = 50;

type Row = Record<string, unknown>;
type ChipColor = 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';

const cellSx = { fontSize: '0.8rem', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 };
const headerSx = { fontSize: '0.75rem', fontWeight: 700, bgcolor: 'action.selected', whiteSpace: 'nowrap' as const };
const actionCellSx = { fontSize: '0.8rem', whiteSpace: 'nowrap' as const, width: 110 };
const chipSx = { height: 20, fontSize: '0.7rem', fontWeight: 600 };

const USER_ID_KEYS = new Set(['user_id', 'author_id', 'created_by', 'sender_id', 'recipient_id', 'assigned_to']);
const PROJECT_ID_KEYS = new Set(['project_id']);
const DATE_FIELDS = new Set(['created_at', 'updated_at', 'read_at', 'submitted_at', 'clock_out_at', 'date']);
const MINUTE_FIELDS = new Set(['worked_minutes', 'break_minutes']);

// 生のカラム名 → 日本語ラベル（テーブル見出しの可読性向上）
const FIELD_LABEL: Record<string, string> = {
  id: 'ID', created_at: '日時', updated_at: '更新', submitted_at: '提出', read_at: '既読日時',
  clock_out_at: '退勤', date: '日付', for_date: '対象日', channel_id: 'チャンネル', thread_id: 'スレッド',
  shot_id: 'ショット', task_id: 'タスク', project_id: 'プロジェクト', project_name: 'プロジェクト', shot_code: 'ショット',
  author_id: '作成者', created_by: '作成者', sender_id: '送信者', recipient_id: '宛先', user_id: 'ユーザー',
  assigned_to: '担当者', assigned_to_name: '担当者',
  body: '本文', content: '本文', title: 'タイトル', memo: 'メモ', description: '内容',
  status: 'ステータス', qc_status: 'QC', type: '種別', media_type: '種別', role: '役職', mode: 'モード',
  is_read: '既読', timecode: 'TC', file_path: 'ファイル', version: 'Ver', severity: '重要度',
  category: 'カテゴリ', reporter_name: '報告者', worked_minutes: '稼働', break_minutes: '休憩',
  condition: 'コンディション', blockers: 'ブロッカー',
};
const fieldLabel = (col: string) => FIELD_LABEL[col] ?? col;

// Score制作ロールの正準値 (backend/app/status_transitions.py の ROLE_RANK と一致させる)
const SCORE_ROLE_OPTIONS: Array<{ value: string; label: string; short: string }> = [
  { value: 'director', label: 'ディレクター (director)', short: 'ディレクター' },
  { value: 'pm', label: '制作 (pm)', short: '制作' },
  { value: 'lead', label: 'リーダー (lead)', short: 'リーダー' },
  { value: 'compositor', label: 'コンポジター (compositor)', short: 'コンポジター' },
  { value: 'artist', label: 'アーティスト (artist)', short: 'アーティスト' },
  { value: 'help', label: 'ヘルプ (help)', short: 'ヘルプ' },
];
const ROLE_SHORT: Record<string, string> = Object.fromEntries(SCORE_ROLE_OPTIONS.map((o) => [o.value, o.short]));

// ステータス系の値 → 日本語ラベル＋色
const STATUS_LABEL: Record<string, [string, ChipColor]> = {
  open: ['未対応', 'warning'],
  in_progress: ['対応中', 'info'],
  resolved: ['解決済', 'success'],
  closed: ['クローズ', 'default'],
  pending: ['保留中', 'default'],
  submitted: ['提出済', 'info'],
  approved: ['承認', 'success'],
  ok: ['OK', 'success'],
  passed: ['合格', 'success'],
  rejected: ['差し戻し', 'error'],
  ng: ['NG', 'error'],
  failed: ['不合格', 'error'],
  delivered: ['納品済', 'success'],
  completed: ['完了', 'success'],
};
const SEVERITY_LABEL: Record<string, [string, ChipColor]> = {
  critical: ['緊急', 'error'],
  high: ['高', 'error'],
  medium: ['中', 'warning'],
  low: ['低', 'default'],
};

const fmtDateTime = (v: unknown): string => {
  if (v == null || v === '') return '—';
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' });
};

const fmtMinutes = (v: unknown): string => {
  const n = Number(v);
  if (v == null || isNaN(n)) return '—';
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h ? (m ? `${h}時間${m}分` : `${h}時間`) : `${m}分`;
};

function resolveName(id: unknown, map: Record<number, string>): string {
  if (id == null) return '—';
  const n = Number(id);
  return isNaN(n) ? String(id) : (map[n] ? `${map[n]} (#${n})` : `#${n}`);
}

// 空状態（アイコン＋メッセージ）
function EmptyState({ label = 'データがありません', hint }: { label?: string; hint?: string }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 5, color: 'text.disabled', gap: 1, textAlign: 'center' }}>
      <InboxIcon sx={{ fontSize: 40 }} />
      <Typography sx={{ fontSize: '0.85rem' }}>{label}</Typography>
      {hint && <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{hint}</Typography>}
    </Box>
  );
}

function LabelChip({ value, map }: { value: unknown; map: Record<string, [string, ChipColor]> }) {
  if (value == null || value === '') return <>—</>;
  const key = String(value).toLowerCase();
  const hit = map[key];
  return hit
    ? <Chip size="small" label={hit[0]} color={hit[1]} sx={chipSx} />
    : <Chip size="small" label={String(value)} variant="outlined" sx={chipSx} />;
}

interface Maps {
  userMap: Record<number, string>;
  projectMap: Record<number, string>;
}

// 1セル分の表示（値の種類ごとに読みやすく整形）
function renderValue(col: string, v: unknown, { userMap, projectMap }: Maps): { node: React.ReactNode; title: string } {
  const raw = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (USER_ID_KEYS.has(col)) {
    const s = resolveName(v, userMap);
    return { node: s, title: s };
  }
  if (PROJECT_ID_KEYS.has(col)) {
    const s = resolveName(v, projectMap);
    return { node: s, title: s };
  }
  if (DATE_FIELDS.has(col)) return { node: fmtDateTime(v), title: raw };
  if (MINUTE_FIELDS.has(col)) return { node: fmtMinutes(v), title: raw };
  if (col === 'is_read') {
    return {
      node: v ? <Chip size="small" label="既読" variant="outlined" sx={chipSx} /> : <Chip size="small" label="未読" color="primary" sx={chipSx} />,
      title: v ? '既読' : '未読',
    };
  }
  if (col === 'status' || col === 'qc_status') return { node: <LabelChip value={v} map={STATUS_LABEL} />, title: raw };
  if (col === 'severity') return { node: <LabelChip value={v} map={SEVERITY_LABEL} />, title: raw };
  if (col === 'role') {
    const s = ROLE_SHORT[String(v)] ?? raw;
    return { node: <Chip size="small" label={s || '—'} variant="outlined" color="primary" sx={chipSx} />, title: raw };
  }
  if (typeof v === 'boolean') {
    return { node: <Chip size="small" label={v ? 'はい' : 'いいえ'} color={v ? 'success' : 'default'} variant={v ? 'filled' : 'outlined'} sx={chipSx} />, title: raw };
  }
  if (Array.isArray(v)) {
    const s = v.length ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('、') : '—';
    return { node: s, title: s };
  }
  return { node: raw || '—', title: raw };
}

// 汎用テーブル（列定義＋任意の操作列）
function SmartTable({
  rows,
  columns,
  maps,
  actions,
}: {
  rows: Row[];
  columns: string[];
  maps: Maps;
  actions?: (row: Row) => React.ReactNode;
}) {
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 560 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <TableCell key={col} sx={headerSx}>{fieldLabel(col)}</TableCell>
            ))}
            {actions && <TableCell sx={headerSx}>操作</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={(row.id as number) ?? i} hover>
              {columns.map((col) => {
                const { node, title } = renderValue(col, row[col], maps);
                return (
                  <TableCell key={col} sx={cellSx} title={title}>
                    {node}
                  </TableCell>
                );
              })}
              {actions && <TableCell sx={actionCellSx}>{actions(row)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

interface SectionState {
  data: Row[];
  loading: boolean;
  error: string | null;
}

function useSection(fetcher: (p: { limit: number; offset: number }) => Promise<any[]>) {
  const [state, setState] = useState<SectionState>({ data: [], loading: false, error: null });
  const load = () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher({ limit: PAGE_LIMIT, offset: 0 })
      .then((data) => setState({ data: data ?? [], loading: false, error: null }))
      .catch((e) => setState({ data: [], loading: false, error: e?.response?.data?.detail ?? e.message ?? '取得エラー' }));
  };
  return { ...state, load };
}

interface ToastState {
  open: boolean;
  message: string;
  severity: 'success' | 'error';
}

interface SectionDef {
  key: string;
  label: string;
  icon: React.ReactNode;
  description: string;
  emptyHint: string;
  // 表示する列（主要なものを先頭に）。レスポンスに無い列は自動で除外し、1つも無ければ全列表示にフォールバック
  columns?: string[];
  // 「◯◯のみ」の絞り込みスイッチ
  onlyFilter?: { label: string; test: (row: Row) => boolean };
}

// カテゴリでグループ化したナビゲーション（左サイドバー）
const NAV: Array<{ category: string; items: SectionDef[] }> = [
  {
    category: 'やり取り',
    items: [
      {
        key: 'notification', label: '通知', icon: <NotificationsIcon fontSize="small" />,
        description: 'Score からメンバーへ送られた通知です。未読のものは「既読にする」で既読にできます。',
        emptyHint: 'Score から通知が送られるとここに表示されます。',
        columns: ['created_at', 'is_read', 'type', 'title', 'body', 'recipient_id', 'project_name'],
        onlyFilter: { label: '未読のみ', test: (r) => !r.is_read },
      },
      {
        key: 'user_message', label: 'コメント', icon: <ChatIcon fontSize="small" />,
        description: 'ショットやチャンネルに書き込まれたコメントの一覧です。',
        emptyHint: 'Score でコメントが書き込まれるとここに表示されます。',
        columns: ['created_at', 'author_id', 'body', 'channel_id', 'shot_id', 'timecode'],
      },
      {
        key: 'dm_thread', label: 'ダイレクトメッセージ', icon: <MailIcon fontSize="small" />,
        description: 'メンバー同士のダイレクトメッセージを確認できます。',
        emptyHint: 'ダイレクトメッセージはまだありません。',
      },
    ],
  },
  {
    category: '資料',
    items: [
      {
        key: 'materials_preview', label: '資料プレビュー', icon: <PhotoLibraryIcon fontSize="small" />,
        description: '参照素材を画像・動画のサムネイルで確認できます。',
        emptyHint: '参照素材が登録されるとここに表示されます。',
      },
      {
        key: 'reference_material', label: '参照素材（一覧表）', icon: <ImageIcon fontSize="small" />,
        description: '登録された参照素材を表で一覧します。',
        emptyHint: '参照素材が登録されるとここに表示されます。',
        columns: ['created_at', 'title', 'media_type', 'shot_id', 'task_id', 'created_by', 'file_path'],
      },
      {
        key: 'delivery', label: '納品', icon: <LocalShippingIcon fontSize="small" />,
        description: 'タスクごとの納品状況と QC 結果です。',
        emptyHint: '納品が登録されるとここに表示されます。',
        columns: ['created_at', 'status', 'qc_status', 'task_id', 'created_by', 'memo'],
      },
    ],
  },
  {
    category: '記録',
    items: [
      {
        key: 'timecard', label: 'タイムカード', icon: <AccessTimeIcon fontSize="small" />,
        description: 'メンバーの退勤打刻と稼働・休憩時間の記録です。',
        emptyHint: 'Score で退勤が打刻されるとここに表示されます。',
        columns: ['date', 'user_id', 'worked_minutes', 'break_minutes', 'clock_out_at', 'type', 'memo'],
      },
      {
        key: 'routine', label: 'ルーティン', icon: <ChecklistIcon fontSize="small" />,
        description: '毎日のコンディションとブロッカー（困りごと）の申告です。',
        emptyHint: 'Score でルーティンが記録されるとここに表示されます。',
        columns: ['date', 'user_id', 'condition', 'blockers'],
      },
    ],
  },
  {
    category: '管理',
    items: [
      {
        key: 'trouble', label: 'トラブル', icon: <ReportProblemIcon fontSize="small" />,
        description: '制作中に報告された問題です。対応が済んだら「解決」、再発したら「再オープン」してください。',
        emptyHint: 'トラブルが報告されるとここに表示されます。',
        columns: ['created_at', 'status', 'severity', 'shot_code', 'project_name', 'category', 'description', 'reporter_name', 'assigned_to_name'],
        onlyFilter: { label: '未解決のみ', test: (r) => String(r.status ?? '') !== 'resolved' },
      },
      {
        key: 'score_user_role', label: 'ユーザーロール', icon: <BadgeIcon fontSize="small" />,
        description: 'プロジェクトごとのメンバーの制作上の役職です。「編集」で変更できます。',
        emptyHint: 'Score でメンバーがプロジェクトに参加するとここに表示されます。',
        columns: ['user_id', 'project_id', 'role'],
      },
    ],
  },
];
const SECTION: Record<string, SectionDef> = Object.fromEntries(NAV.flatMap((g) => g.items.map((it) => [it.key, it])));

// 自分専用のUIを持つセクション（表・検索を出さない）
const CUSTOM_VIEWS = new Set(['materials_preview', 'dm_thread']);

export default function ScoreDataAdminPage() {
  const navigate = useNavigate();
  const [activeKey, setActiveKey] = useState<string>('materials_preview');
  const [search, setSearch] = useState('');
  const [onlyOn, setOnlyOn] = useState(false);

  const [userMap, setUserMap] = useState<Record<number, string>>({});
  const [projectMap, setProjectMap] = useState<Record<number, string>>({});
  const maps: Maps = { userMap, projectMap };

  const [toast, setToast] = useState<ToastState>({ open: false, message: '', severity: 'success' });
  const showToast = (message: string, severity: 'success' | 'error') =>
    setToast({ open: true, message, severity });

  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; row: Row | null; action: 'resolve' | 'reopen' }>({ open: false, row: null, action: 'resolve' });
  const [roleDialog, setRoleDialog] = useState<{ open: boolean; row: Row | null; role: string }>({ open: false, row: null, role: '' });

  const notifications = useSection(fetchAdminNotifications);
  const timecards = useSection(fetchAdminTimecards);
  const routines = useSection(fetchAdminRoutines);
  const userMessages = useSection(fetchAdminUserMessages);
  const deliveries = useSection(fetchAdminDeliveries);
  const referenceMaterials = useSection(fetchAdminReferenceMaterials);
  const dmThreads = useSection(fetchAdminDMThreads);
  const scoreUserRoles = useSection(fetchAdminScoreUserRoles);
  const troubles = useSection(fetchAdminTroubles);

  const sectionByKey: Record<string, ReturnType<typeof useSection>> = {
    notification: notifications, timecard: timecards, routine: routines,
    user_message: userMessages, delivery: deliveries, reference_material: referenceMaterials,
    dm_thread: dmThreads, score_user_role: scoreUserRoles, trouble: troubles,
  };
  const active = sectionByKey[activeKey];
  const def = SECTION[activeKey];
  const isCustomView = CUSTOM_VIEWS.has(activeKey);

  useEffect(() => {
    fetchUsers().then((users: any[]) => {
      const m: Record<number, string> = {};
      users.forEach((u: any) => {
        // name/full_name は空文字のことがあるため || で username/email へフォールバックする
        // （?? だと空文字 '' が残り、resolveName で falsy 扱いされて ID 表示になる）
        m[u.id] = (u.full_name || '').trim() || (u.name || '').trim() || u.username || u.email || String(u.id);
      });
      setUserMap(m);
    }).catch(() => {});
    fetchProjects().then((projects: any[]) => {
      const m: Record<number, string> = {};
      projects.forEach((p: any) => { m[p.id] = p.name || String(p.id); });
      setProjectMap(m);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setSearch('');
    setOnlyOn(false);
    if (active) active.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  const { data, loading, error } = active ?? { data: [] as Row[], loading: false, error: null as string | null };

  const columns = useMemo(() => {
    if (data.length === 0) return [];
    const keys = Object.keys(data[0]);
    const picked = (def?.columns ?? []).filter((c) => keys.includes(c));
    return picked.length > 0 ? picked : keys;
  }, [data, def]);

  // 検索（表示中の列を文字列一致）と「◯◯のみ」の絞り込み
  const filtered = useMemo(() => {
    let rows = data;
    if (onlyOn && def?.onlyFilter) rows = rows.filter(def.onlyFilter.test);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        columns.some((c) => {
          const { title } = renderValue(c, r[c], maps);
          return title.toLowerCase().includes(q);
        }),
      );
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, onlyOn, search, columns, def, userMap, projectMap]);

  const handleNotificationRead = async (id: number) => {
    try {
      await patchAdminNotificationRead(id);
      showToast('既読にしました', 'success');
      notifications.load();
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? '更新エラー', 'error');
    }
  };

  const handleTroubleConfirm = async () => {
    const { row, action } = confirmDialog;
    setConfirmDialog((d) => ({ ...d, open: false }));
    if (!row) return;
    const id = row.id as number;
    try {
      if (action === 'resolve') {
        await patchAdminTroubleResolve(id);
        showToast('解決済みにしました', 'success');
      } else {
        await patchAdminTroubleReopen(id);
        showToast('再オープンしました', 'success');
      }
      troubles.load();
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? '更新エラー', 'error');
    }
  };

  const handleRoleSave = async () => {
    const { row, role } = roleDialog;
    setRoleDialog((d) => ({ ...d, open: false }));
    if (!row) return;
    try {
      await updateScoreUserRole(row.id as number, { role });
      showToast('役職を更新しました', 'success');
      scoreUserRoles.load();
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? '更新エラー', 'error');
    }
  };

  const actionBtnSx = { fontSize: '0.7rem', py: 0, px: 0.75 };
  const actionsFor = (key: string): ((row: Row) => React.ReactNode) | undefined => {
    if (key === 'notification') {
      return (row) => !row.is_read && (
        <Button size="small" variant="outlined" sx={actionBtnSx} onClick={() => handleNotificationRead(row.id as number)}>
          既読にする
        </Button>
      );
    }
    if (key === 'trouble') {
      return (row) => String(row.status ?? '') === 'resolved' ? (
        <Button size="small" variant="outlined" color="warning" sx={actionBtnSx} onClick={() => setConfirmDialog({ open: true, row, action: 'reopen' })}>
          再オープン
        </Button>
      ) : (
        <Button size="small" variant="outlined" color="success" sx={actionBtnSx} onClick={() => setConfirmDialog({ open: true, row, action: 'resolve' })}>
          解決
        </Button>
      );
    }
    if (key === 'score_user_role') {
      return (row) => (
        <Button size="small" variant="outlined" sx={actionBtnSx} onClick={() => setRoleDialog({ open: true, row, role: String(row.role ?? '') })}>
          編集
        </Button>
      );
    }
    return undefined;
  };

  const renderContent = () => {
    if (activeKey === 'materials_preview') {
      return <MaterialsView userMap={userMap} />;
    }
    if (loading) {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 5, gap: 1.5, color: 'text.secondary' }}>
          <CircularProgress size={28} />
          <Typography sx={{ fontSize: '0.8rem' }}>読み込み中…</Typography>
        </Box>
      );
    }
    if (error) {
      return (
        <Alert
          severity="warning"
          sx={{ fontSize: '0.8rem' }}
          action={active && <Button color="inherit" size="small" onClick={() => active.load()}>再試行</Button>}
        >
          データを取得できませんでした（{error}）
          {['delivery', 'reference_material', 'dm_thread'].includes(activeKey) && ' ※この機能は現在準備中です'}
        </Alert>
      );
    }
    if (activeKey === 'dm_thread') {
      return <DmView userMap={userMap} />;
    }
    if (data.length === 0) {
      return <EmptyState label="まだデータがありません" hint={def?.emptyHint} />;
    }
    if (filtered.length === 0) {
      return <EmptyState label="条件に一致するデータがありません" hint="検索語や絞り込みを変えてみてください。" />;
    }
    return <SmartTable rows={filtered} columns={columns} maps={maps} actions={actionsFor(activeKey)} />;
  };

  const countLabel = data.length >= PAGE_LIMIT ? `最新${PAGE_LIMIT}件以上` : `${data.length}件`;
  const unresolvedCount = activeKey === 'trouble' ? troubles.data.filter((r) => String(r.status ?? '') !== 'resolved').length : 0;
  const unreadCount = activeKey === 'notification' ? notifications.data.filter((r) => !r.is_read).length : 0;

  const confirmRow = confirmDialog.row;
  const roleRow = roleDialog.row;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1280 }}>
      <Breadcrumbs sx={{ mb: 1, fontSize: '0.8rem' }}>
        <Link component="button" onClick={() => navigate('/metrics')} underline="hover" sx={{ fontSize: '0.8rem' }}>
          管理
        </Link>
        <Typography sx={{ fontSize: '0.8rem', color: 'text.primary' }}>Score連携データ管理</Typography>
      </Breadcrumbs>

      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1.1rem' }}>
            Score連携データ管理
          </Typography>
          <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', mt: 0.5 }}>
            Score アプリから連携された、やり取り・資料・勤怠・トラブルなどを確認・管理する画面です。
            左のメニューから見たいデータを選んでください。
          </Typography>
        </Box>
        <Tooltip title="ショット・リテイクなどの制作データは進捗トラッカーで管理します">
          <Button
            size="small"
            variant="outlined"
            endIcon={<OpenInNewIcon fontSize="small" />}
            onClick={() => navigate('/production-tracker')}
            sx={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}
          >
            制作データは進捗トラッカーへ
          </Button>
        </Tooltip>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexDirection: { xs: 'column', md: 'row' } }}>
        {/* カテゴリ・サイドバー */}
        <Paper variant="outlined" sx={{ width: { xs: '100%', md: 260 }, flexShrink: 0, py: 0.5, position: { md: 'sticky' }, top: { md: 16 } }}>
          <List dense disablePadding>
            {NAV.map((group) => (
              <React.Fragment key={group.category}>
                <ListSubheader disableSticky sx={{ fontSize: '0.7rem', fontWeight: 800, lineHeight: 2.6, color: 'text.secondary', bgcolor: 'transparent' }}>
                  {group.category}
                </ListSubheader>
                {group.items.map((it) => (
                  <ListItemButton
                    key={it.key}
                    selected={activeKey === it.key}
                    onClick={() => setActiveKey(it.key)}
                    sx={{ py: 0.5, mx: 0.5, borderRadius: 1, alignItems: 'flex-start' }}
                  >
                    <ListItemIcon sx={{ minWidth: 32, mt: 0.5, color: activeKey === it.key ? 'primary.main' : 'text.secondary' }}>
                      {it.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={it.label}
                      secondary={it.description}
                      primaryTypographyProps={{ fontSize: '0.82rem', fontWeight: activeKey === it.key ? 700 : 500 }}
                      secondaryTypographyProps={{
                        fontSize: '0.68rem',
                        sx: { display: { xs: 'none', md: '-webkit-box' }, WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
                      }}
                    />
                  </ListItemButton>
                ))}
              </React.Fragment>
            ))}
          </List>
        </Paper>

        {/* コンテンツ */}
        <Paper variant="outlined" sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          <Box sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography sx={{ fontSize: '1rem', fontWeight: 700 }}>{def?.label ?? ''}</Typography>
              {active && !isCustomView && !loading && !error && (
                <Chip label={countLabel} size="small" sx={{ fontSize: '0.72rem', height: 20 }} />
              )}
              {unreadCount > 0 && !loading && (
                <Chip label={`未読 ${unreadCount}件`} size="small" color="primary" sx={{ fontSize: '0.72rem', height: 20 }} />
              )}
              {unresolvedCount > 0 && !loading && (
                <Chip label={`未解決 ${unresolvedCount}件`} size="small" color="warning" sx={{ fontSize: '0.72rem', height: 20 }} />
              )}
              {active && (
                <Tooltip title="最新の情報に更新">
                  <IconButton size="small" onClick={() => active.load()} sx={{ ml: 'auto' }}>
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
            {def?.description && (
              <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', mt: 0.5, mb: 1.5 }}>
                {def.description}
                {!isCustomView && ` 新しい順に最大${PAGE_LIMIT}件を表示しています。`}
              </Typography>
            )}

            {!isCustomView && !loading && !error && data.length > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
                <TextField
                  size="small"
                  placeholder="名前・本文などで絞り込み"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  sx={{ width: { xs: '100%', sm: 280 }, '& input': { fontSize: '0.82rem' } }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                    endAdornment: search ? (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setSearch('')}>
                          <CloseIcon fontSize="inherit" />
                        </IconButton>
                      </InputAdornment>
                    ) : undefined,
                  }}
                />
                {def?.onlyFilter && (
                  <FormControlLabel
                    control={<Switch size="small" checked={onlyOn} onChange={(e) => setOnlyOn(e.target.checked)} />}
                    label={def.onlyFilter.label}
                    sx={{ '& .MuiFormControlLabel-label': { fontSize: '0.82rem' } }}
                  />
                )}
                {(search || onlyOn) && (
                  <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                    {filtered.length}件を表示中
                  </Typography>
                )}
              </Box>
            )}

            {renderContent()}
          </Box>
        </Paper>
      </Box>

      {/* Trouble 確認ダイアログ */}
      <Dialog open={confirmDialog.open} onClose={() => setConfirmDialog((d) => ({ ...d, open: false }))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: '0.95rem' }}>
          {confirmDialog.action === 'resolve' ? 'トラブルを解決済みにしますか？' : 'トラブルを再オープンしますか？'}
        </DialogTitle>
        <DialogContent>
          {confirmRow && (
            <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'action.hover' }}>
              <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
                {[confirmRow.project_name, confirmRow.shot_code, confirmRow.category].filter(Boolean).join(' / ') || `#${confirmRow.id}`}
              </Typography>
              <Typography sx={{ fontSize: '0.85rem', mt: 0.5, whiteSpace: 'pre-wrap' }}>
                {String(confirmRow.description ?? '')}
              </Typography>
            </Paper>
          )}
          <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mt: 1.5 }}>
            {confirmDialog.action === 'resolve'
              ? '解決済みにすると未解決の一覧から外れます。あとから再オープンもできます。'
              : '再オープンすると未解決に戻ります。'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog((d) => ({ ...d, open: false }))} sx={{ fontSize: '0.8rem' }}>
            キャンセル
          </Button>
          <Button
            onClick={handleTroubleConfirm}
            variant="contained"
            color={confirmDialog.action === 'resolve' ? 'success' : 'warning'}
            sx={{ fontSize: '0.8rem' }}
          >
            {confirmDialog.action === 'resolve' ? '解決にする' : '再オープン'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ScoreUserRole 役職編集ダイアログ */}
      <Dialog open={roleDialog.open} onClose={() => setRoleDialog((d) => ({ ...d, open: false }))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: '0.95rem' }}>役職を変更</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          {roleRow && (
            <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', mb: 1 }}>
              {resolveName(roleRow.user_id, userMap)} ／ {resolveName(roleRow.project_id, projectMap)}
            </Typography>
          )}
          <FormControl size="small" fullWidth sx={{ mt: 1 }}>
            <InputLabel id="role-dialog-select-label">役職</InputLabel>
            <Select
              labelId="role-dialog-select-label"
              label="役職"
              value={roleDialog.role}
              onChange={(e) => setRoleDialog((d) => ({ ...d, role: e.target.value as string }))}
              sx={{ fontSize: '0.85rem' }}
            >
              {SCORE_ROLE_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: '0.85rem' }}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRoleDialog((d) => ({ ...d, open: false }))} sx={{ fontSize: '0.8rem' }}>
            キャンセル
          </Button>
          <Button onClick={handleRoleSave} variant="contained" sx={{ fontSize: '0.8rem' }}>
            保存
          </Button>
        </DialogActions>
      </Dialog>

      {/* Toast */}
      <Snackbar
        open={toast.open}
        autoHideDuration={3000}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={toast.severity}
          sx={{ fontSize: '0.85rem' }}
          action={
            <IconButton size="small" onClick={() => setToast((t) => ({ ...t, open: false }))}>
              <CloseIcon fontSize="inherit" />
            </IconButton>
          }
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
