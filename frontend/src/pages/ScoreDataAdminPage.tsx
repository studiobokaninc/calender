import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Alert,
  Tab,
  Tabs,
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
} from '@mui/material';
import { OpenInNew as OpenInNewIcon, Close as CloseIcon } from '@mui/icons-material';
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

const PAGE_LIMIT = 50;

const cellSx = { fontSize: '0.8rem', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 };
const headerSx = { fontSize: '0.75rem', fontWeight: 700, bgcolor: 'action.selected' };
const actionCellSx = { fontSize: '0.8rem', whiteSpace: 'nowrap' as const, width: 110 };

const USER_ID_KEYS = new Set(['user_id', 'author_id', 'created_by', 'sender_id', 'recipient_id', 'assigned_to']);
const PROJECT_ID_KEYS = new Set(['project_id']);

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
    return <Typography sx={{ p: 2, color: 'text.secondary', fontSize: '0.85rem' }}>データなし</Typography>;
  }
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 480 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <TableCell key={col} sx={headerSx}>{col}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i} hover>
              {columns.map((col) => {
                if (USER_ID_KEYS.has(col)) {
                  return <ResolvedCell key={col} value={row[col]} resolved={resolveUser(row[col], userMap)} />;
                }
                if (PROJECT_ID_KEYS.has(col)) {
                  return <ResolvedCell key={col} value={row[col]} resolved={resolveProject(row[col], projectMap)} />;
                }
                return <TruncatedCell key={col} value={row[col]} />;
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

const TABS = [
  { label: 'Notification', key: 'notification' },
  { label: 'Timecard', key: 'timecard' },
  { label: 'Routine', key: 'routine' },
  { label: 'UserMessage', key: 'user_message' },
  { label: 'Delivery', key: 'delivery' },
  { label: 'Reference Material', key: 'reference_material' },
  { label: 'DM Threads', key: 'dm_thread' },
  { label: 'ScoreUserRole', key: 'score_user_role' },
  { label: 'Trouble', key: 'trouble' },
];

export default function ScoreDataAdminPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);

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

  const sections = [notifications, timecards, routines, userMessages, deliveries, referenceMaterials, dmThreads, scoreUserRoles, troubles];

  useEffect(() => {
    fetchUsers().then((users: any[]) => {
      const m: Record<number, string> = {};
      users.forEach((u: any) => { m[u.id] = u.display_name ?? u.name ?? u.email ?? String(u.id); });
      setUserMap(m);
    }).catch(() => {});
    fetchProjects().then((projects: any[]) => {
      const m: Record<number, string> = {};
      projects.forEach((p: any) => { m[p.id] = p.name ?? String(p.id); });
      setProjectMap(m);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    sections[tab].load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const { data, loading, error } = sections[tab];
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
          {tab >= 4 && tab <= 6 && ' (BE未実装のEPは接続後に利用可能になります)'}
        </Alert>
      );
    }
    const tabKey = TABS[tab].key;
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

      <Paper variant="outlined">
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { fontSize: '0.8rem', minHeight: 40 } }}
        >
          {TABS.map((t) => (
            <Tab key={t.key} label={t.label} />
          ))}
        </Tabs>

        <Box sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>
              {TABS[tab].label}
            </Typography>
            <Chip label="Score連携" size="small" color="info" variant="outlined" sx={{ fontSize: '0.7rem', height: 20 }} />
            {!loading && !error && (
              <Chip label={`${data.length}件`} size="small" sx={{ fontSize: '0.75rem', height: 20 }} />
            )}
            <Button size="small" onClick={() => sections[tab].load()} sx={{ fontSize: '0.75rem', ml: 'auto' }}>
              再取得
            </Button>
          </Box>

          {renderContent()}
        </Box>
      </Paper>

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
