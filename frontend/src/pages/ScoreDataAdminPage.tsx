import React, { useState, useEffect } from 'react';
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

const cellSx = { fontSize: '0.8rem', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 };
const headerSx = { fontSize: '0.75rem', fontWeight: 700, bgcolor: 'action.selected' };
const actionCellSx = { fontSize: '0.8rem', whiteSpace: 'nowrap' as const, width: 110 };

const USER_ID_KEYS = new Set(['user_id', 'author_id', 'created_by', 'sender_id', 'recipient_id', 'assigned_to']);
const PROJECT_ID_KEYS = new Set(['project_id']);

// 生のカラム名 → 日本語ラベル（テーブル見出しの可読性向上）
const FIELD_LABEL: Record<string, string> = {
  id: 'ID', created_at: '日時', updated_at: '更新', submitted_at: '提出', read_at: '既読日時',
  clock_out_at: '退勤', date: '日付', channel_id: 'チャンネル', thread_id: 'スレッド',
  shot_id: 'ショット', task_id: 'タスク', project_id: 'プロジェクト', shot_code: 'ショット',
  author_id: '作成者', created_by: '作成者', sender_id: '送信者', recipient_id: '受信者', user_id: 'ユーザー',
  body: '本文', content: '本文', title: 'タイトル', memo: 'メモ', description: '説明',
  status: 'ステータス', qc_status: 'QC', type: '種別', media_type: '種別', role: 'ロール',
  is_read: '既読', timecode: 'TC', file_path: 'ファイル', version: 'Ver', severity: '重要度',
  category: 'カテゴリ', reporter_name: '報告者', worked_minutes: '稼働(分)', break_minutes: '休憩(分)',
  condition: 'コンディション', blockers: 'ブロッカー',
};
const fieldLabel = (col: string) => FIELD_LABEL[col] ?? col;

const DATE_FIELDS = new Set(['created_at', 'updated_at', 'read_at', 'submitted_at', 'clock_out_at', 'date']);
const fmtDateTime = (v: unknown): string => {
  if (v == null || v === '') return '—';
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' });
};

// 空状態（アイコン＋メッセージ）
function EmptyState({ label = 'データがありません' }: { label?: string }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 5, color: 'text.disabled', gap: 1 }}>
      <InboxIcon sx={{ fontSize: 40 }} />
      <Typography sx={{ fontSize: '0.85rem' }}>{label}</Typography>
    </Box>
  );
}

function resolveUser(id: unknown, map: Record<number, string>): string {
  if (id == null) return '—';
  const n = Number(id);
  return isNaN(n) ? String(id) : (map[n] ? `${map[n]} (#${n})` : `#${n}`);
}

function resolveProject(id: unknown, map: Record<number, string>): string {
  if (id == null) return '—';
  const n = Number(id);
  return isNaN(n) ? String(id) : (map[n] ? `${map[n]} (#${n})` : `#${n}`);
}

function TruncatedCell({ value }: { value: unknown }) {
  const text = value == null ? '—' : String(value);
  return (
    <TableCell sx={cellSx} title={text}>
      {text}
    </TableCell>
  );
}

function ResolvedCell({ value, resolved }: { value: unknown; resolved: string }) {
  const raw = value == null ? '—' : String(value);
  return (
    <TableCell sx={cellSx} title={`${resolved} (raw: ${raw})`}>
      {resolved}
    </TableCell>
  );
}

function DataTable({
  rows,
  columns,
  userMap,
  projectMap,
}: {
  rows: Record<string, unknown>[];
  columns: string[];
  userMap: Record<number, string>;
  projectMap: Record<number, string>;
}) {
  if (!rows || rows.length === 0) {
    return <EmptyState />;
  }
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 520 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <TableCell key={col} sx={headerSx}>{fieldLabel(col)}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i} hover>
              {columns.map((col) => {
                const v = row[col];
                if (USER_ID_KEYS.has(col)) {
                  return <ResolvedCell key={col} value={v} resolved={resolveUser(v, userMap)} />;
                }
                if (PROJECT_ID_KEYS.has(col)) {
                  return <ResolvedCell key={col} value={v} resolved={resolveProject(v, projectMap)} />;
                }
                if (DATE_FIELDS.has(col)) {
                  return <TableCell key={col} sx={cellSx} title={String(v ?? '')}>{fmtDateTime(v)}</TableCell>;
                }
                if (typeof v === 'boolean') {
                  return (
                    <TableCell key={col} sx={cellSx}>
                      <Chip size="small" label={v ? '✓' : '—'} color={v ? 'success' : 'default'} variant={v ? 'filled' : 'outlined'} sx={{ height: 18, fontSize: '0.65rem' }} />
                    </TableCell>
                  );
                }
                return <TruncatedCell key={col} value={v} />;
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

// Notification tab: 既読ボタン付き
function NotificationTable({
  rows,
  onRead,
  userMap,
}: {
  rows: Record<string, unknown>[];
  onRead: (id: number) => void;
  userMap: Record<number, string>;
}) {
  const COLS = ['id', 'recipient_id', 'sender_id', 'content', 'is_read', 'created_at'];
  if (!rows || rows.length === 0) {
    return <Typography sx={{ p: 2, color: 'text.secondary', fontSize: '0.85rem' }}>データなし</Typography>;
  }
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 480 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {COLS.map((col) => <TableCell key={col} sx={headerSx}>{col}</TableCell>)}
            <TableCell sx={headerSx}>操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i} hover>
              {COLS.map((col) => {
                if (col === 'recipient_id' || col === 'sender_id') {
                  return <ResolvedCell key={col} value={row[col]} resolved={resolveUser(row[col], userMap)} />;
                }
                return <TruncatedCell key={col} value={row[col]} />;
              })}
              <TableCell sx={actionCellSx}>
                {!row.is_read && (
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: '0.7rem', py: 0, px: 0.5 }}
                    onClick={() => onRead(row.id as number)}
                  >
                    既読にする
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

// Trouble tab: 解決/再オープンボタン付き
function TroubleTable({ rows, onAction }: { rows: Record<string, unknown>[]; onAction: (id: number, action: 'resolve' | 'reopen') => void }) {
  const COLS = ['id', 'shot_code', 'category', 'description', 'severity', 'status', 'reporter_name', 'created_at'];
  if (!rows || rows.length === 0) {
    return <Typography sx={{ p: 2, color: 'text.secondary', fontSize: '0.85rem' }}>データなし</Typography>;
  }
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 480 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {COLS.map((col) => <TableCell key={col} sx={headerSx}>{col}</TableCell>)}
            <TableCell sx={headerSx}>操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => {
            const isResolved = String(row.status ?? '') === 'resolved';
            return (
              <TableRow key={i} hover>
                {COLS.map((col) => <TruncatedCell key={col} value={row[col]} />)}
                <TableCell sx={actionCellSx}>
                  {isResolved ? (
                    <Button
                      size="small"
                      variant="outlined"
                      color="warning"
                      sx={{ fontSize: '0.7rem', py: 0, px: 0.5 }}
                      onClick={() => onAction(row.id as number, 'reopen')}
                    >
                      再オープン
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      variant="outlined"
                      color="success"
                      sx={{ fontSize: '0.7rem', py: 0, px: 0.5 }}
                      onClick={() => onAction(row.id as number, 'resolve')}
                    >
                      解決
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

// ScoreUserRole tab: ロール編集ボタン付き
function ScoreUserRoleTable({
  rows,
  onEdit,
  userMap,
  projectMap,
}: {
  rows: Record<string, unknown>[];
  onEdit: (id: number, currentRole: string) => void;
  userMap: Record<number, string>;
  projectMap: Record<number, string>;
}) {
  const COLS = ['id', 'user_id', 'project_id', 'role'];
  if (!rows || rows.length === 0) {
    return <Typography sx={{ p: 2, color: 'text.secondary', fontSize: '0.85rem' }}>データなし</Typography>;
  }
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 480 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {COLS.map((col) => <TableCell key={col} sx={headerSx}>{col}</TableCell>)}
            <TableCell sx={headerSx}>操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i} hover>
              {COLS.map((col) => {
                if (col === 'user_id') {
                  return <ResolvedCell key={col} value={row[col]} resolved={resolveUser(row[col], userMap)} />;
                }
                if (col === 'project_id') {
                  return <ResolvedCell key={col} value={row[col]} resolved={resolveProject(row[col], projectMap)} />;
                }
                return <TruncatedCell key={col} value={row[col]} />;
              })}
              <TableCell sx={actionCellSx}>
                <Button
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.7rem', py: 0, px: 0.5 }}
                  onClick={() => onEdit(row.id as number, String(row.role ?? ''))}
                >
                  編集
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

interface SectionState {
  data: Record<string, unknown>[];
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

// カテゴリでグループ化したナビゲーション（左サイドバー）
const NAV: Array<{ category: string; items: Array<{ key: string; label: string; icon: React.ReactNode }> }> = [
  {
    category: 'やり取り',
    items: [
      { key: 'notification', label: '通知', icon: <NotificationsIcon fontSize="small" /> },
      { key: 'user_message', label: 'コメント', icon: <ChatIcon fontSize="small" /> },
      { key: 'dm_thread', label: 'ダイレクトメッセージ', icon: <MailIcon fontSize="small" /> },
    ],
  },
  {
    category: '資料',
    items: [
      { key: 'materials_preview', label: '資料プレビュー', icon: <PhotoLibraryIcon fontSize="small" /> },
      { key: 'reference_material', label: '参照素材', icon: <ImageIcon fontSize="small" /> },
      { key: 'delivery', label: '納品', icon: <LocalShippingIcon fontSize="small" /> },
    ],
  },
  {
    category: '記録',
    items: [
      { key: 'timecard', label: 'タイムカード', icon: <AccessTimeIcon fontSize="small" /> },
      { key: 'routine', label: 'ルーティン', icon: <ChecklistIcon fontSize="small" /> },
    ],
  },
  {
    category: '管理',
    items: [
      { key: 'trouble', label: 'トラブル', icon: <ReportProblemIcon fontSize="small" /> },
      { key: 'score_user_role', label: 'ユーザーロール', icon: <BadgeIcon fontSize="small" /> },
    ],
  },
];
const ITEM_LABEL: Record<string, string> = Object.fromEntries(
  NAV.flatMap((g) => g.items.map((it) => [it.key, it.label])),
);

export default function ScoreDataAdminPage() {
  const navigate = useNavigate();
  const [activeKey, setActiveKey] = useState<string>('materials_preview');

  const [userMap, setUserMap] = useState<Record<number, string>>({});
  const [projectMap, setProjectMap] = useState<Record<number, string>>({});

  const [toast, setToast] = useState<ToastState>({ open: false, message: '', severity: 'success' });
  const showToast = (message: string, severity: 'success' | 'error') =>
    setToast({ open: true, message, severity });

  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; id: number; action: 'resolve' | 'reopen' }>({ open: false, id: 0, action: 'resolve' });
  const [roleDialog, setRoleDialog] = useState<{ open: boolean; id: number; role: string }>({ open: false, id: 0, role: '' });

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

  useEffect(() => {
    fetchUsers().then((users: any[]) => {
      const m: Record<number, string> = {};
      users.forEach((u: any) => {
        // name/full_name は空文字のことがあるため || で username/email へフォールバックする
        // （?? だと空文字 '' が残り、resolveUser で falsy 扱いされて ID 表示になる）
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
    if (active) active.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  const { data, loading, error } = active ?? { data: [] as any[], loading: false, error: null as string | null };
  const columns = data.length > 0 ? Object.keys(data[0]) : [];

  const handleNotificationRead = async (id: number) => {
    try {
      await patchAdminNotificationRead(id);
      showToast('既読にしました', 'success');
      notifications.load();
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? '更新エラー', 'error');
    }
  };

  const handleTroubleAction = (id: number, action: 'resolve' | 'reopen') => {
    setConfirmDialog({ open: true, id, action });
  };

  const handleTroubleConfirm = async () => {
    const { id, action } = confirmDialog;
    setConfirmDialog((d) => ({ ...d, open: false }));
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

  const handleRoleEdit = (id: number, currentRole: string) => {
    setRoleDialog({ open: true, id, role: currentRole });
  };

  const handleRoleSave = async () => {
    const { id, role } = roleDialog;
    setRoleDialog((d) => ({ ...d, open: false }));
    try {
      await updateScoreUserRole(id, { role });
      showToast('ロールを更新しました', 'success');
      scoreUserRoles.load();
    } catch (e: any) {
      showToast(e?.response?.data?.detail ?? '更新エラー', 'error');
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      );
    }
    if (error) {
      return (
        <Alert severity="warning" sx={{ fontSize: '0.8rem' }}>
          {error}
          {['delivery', 'reference_material', 'dm_thread'].includes(activeKey) && ' (BE未実装のEPは接続後に利用可能になります)'}
        </Alert>
      );
    }
    const tabKey = activeKey;
    if (tabKey === 'materials_preview') {
      return <MaterialsView userMap={userMap} />;
    }
    if (tabKey === 'dm_thread') {
      return <DmView userMap={userMap} />;
    }
    if (tabKey === 'notification') {
      return <NotificationTable rows={data} onRead={handleNotificationRead} userMap={userMap} />;
    }
    if (tabKey === 'trouble') {
      return <TroubleTable rows={data} onAction={handleTroubleAction} />;
    }
    if (tabKey === 'score_user_role') {
      return <ScoreUserRoleTable rows={data} onEdit={handleRoleEdit} userMap={userMap} projectMap={projectMap} />;
    }
    return <DataTable rows={data} columns={columns} userMap={userMap} projectMap={projectMap} />;
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1200 }}>
      <Breadcrumbs sx={{ mb: 1, fontSize: '0.8rem' }}>
        <Link component="button" onClick={() => navigate('/metrics')} underline="hover" sx={{ fontSize: '0.8rem' }}>
          管理
        </Link>
        <Typography sx={{ fontSize: '0.8rem', color: 'text.primary' }}>Score連携データ管理</Typography>
      </Breadcrumbs>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1rem' }}>
          Score連携データ管理
        </Typography>
        <Button
          size="small"
          variant="outlined"
          endIcon={<OpenInNewIcon fontSize="small" />}
          onClick={() => navigate('/production-tracker')}
          sx={{ fontSize: '0.8rem' }}
        >
          制作データ (ProductionTracker)
        </Button>
      </Box>

      <Alert severity="info" sx={{ mb: 2, fontSize: '0.8rem' }}>
        このページはScoreが書き込んだデータの管理ページです。制作系データ (Shot / Retake / Trouble 等) は
        <Button size="small" onClick={() => navigate('/production-tracker')} sx={{ fontSize: '0.8rem', p: 0, ml: 0.5, textTransform: 'none' }}>
          ProductionTracker
        </Button>
        をご利用ください。
      </Alert>

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexDirection: { xs: 'column', md: 'row' } }}>
        {/* カテゴリ・サイドバー */}
        <Paper variant="outlined" sx={{ width: { xs: '100%', md: 240 }, flexShrink: 0, py: 0.5, position: { md: 'sticky' }, top: { md: 16 } }}>
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
                    sx={{ py: 0.5, mx: 0.5, borderRadius: 1 }}
                  >
                    <ListItemIcon sx={{ minWidth: 32, color: activeKey === it.key ? 'primary.main' : 'text.secondary' }}>
                      {it.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={it.label}
                      primaryTypographyProps={{ fontSize: '0.82rem', fontWeight: activeKey === it.key ? 700 : 500 }}
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <Typography sx={{ fontSize: '1rem', fontWeight: 700 }}>{ITEM_LABEL[activeKey] ?? ''}</Typography>
              {active && !loading && !error && (
                <Chip label={`${data.length}件`} size="small" sx={{ fontSize: '0.72rem', height: 20 }} />
              )}
              {active && (
                <Tooltip title="再取得">
                  <IconButton size="small" onClick={() => active.load()} sx={{ ml: 'auto' }}>
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
            {renderContent()}
          </Box>
        </Paper>
      </Box>

      {/* Trouble 確認ダイアログ */}
      <Dialog open={confirmDialog.open} onClose={() => setConfirmDialog((d) => ({ ...d, open: false }))}>
        <DialogTitle sx={{ fontSize: '0.95rem' }}>確認</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '0.85rem' }}>
            {confirmDialog.action === 'resolve'
              ? 'このトラブルを解決済みにしますか？'
              : 'このトラブルを再オープンしますか？'}
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
            {confirmDialog.action === 'resolve' ? '解決' : '再オープン'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ScoreUserRole ロール編集ダイアログ */}
      <Dialog open={roleDialog.open} onClose={() => setRoleDialog((d) => ({ ...d, open: false }))}>
        <DialogTitle sx={{ fontSize: '0.95rem' }}>ロール編集</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <TextField
            label="Role"
            value={roleDialog.role}
            onChange={(e) => setRoleDialog((d) => ({ ...d, role: e.target.value }))}
            size="small"
            fullWidth
            sx={{ mt: 1, '& .MuiInputBase-input': { fontSize: '0.85rem' } }}
            helperText="例: director, pm, member"
          />
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
