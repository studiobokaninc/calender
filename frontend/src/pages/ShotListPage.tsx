import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  Avatar,
  Chip,
  Tooltip,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Breadcrumbs,
  Link,
  Snackbar,
  Grid,
} from '@mui/material';
import { Edit as EditIcon } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import api, { fetchShots, updateShot } from '../services/api';
import { Shot } from '../types';

type StatusColor = 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';

const STATUS_CONFIG: Record<string, { label: string; color: StatusColor }> = {
  planning:    { label: 'PLAN', color: 'default' },
  'in-progress': { label: 'WIP',  color: 'warning' },
  review:      { label: 'REVI', color: 'secondary' },
  approved:    { label: 'APPR', color: 'success' },
  completed:   { label: 'DONE', color: 'default' },
  retake:      { label: 'RETK', color: 'error' },
};

const EDIT_FIELDS: { key: keyof Shot; label: string; multiline?: boolean; numeric?: boolean }[] = [
  { key: 'cut',         label: 'カット' },
  { key: 'frame_in',   label: 'フレームイン',  numeric: true },
  { key: 'frame_out',  label: 'フレームアウト', numeric: true },
  { key: 'thumbnail_url', label: 'サムネイルURL' },
  { key: 'description', label: '説明',         multiline: true },
  { key: 'action',      label: 'アクション',   multiline: true },
  { key: 'dialogue',    label: 'セリフ',       multiline: true },
  { key: 'bg',          label: 'BG' },
  { key: 'ch',          label: 'CH' },
  { key: 'prop',        label: 'PROP' },
];

const thSx = { fontWeight: 700, bgcolor: 'action.selected', whiteSpace: 'nowrap' as const };

function TruncCell({ val, maxW = 160 }: { val: string | null | undefined; maxW?: number }) {
  const text = val ?? '—';
  return (
    <Tooltip title={text !== '—' && text.length > 18 ? text : ''} placement="top">
      <Box
        component="span"
        sx={{
          display: 'block',
          maxWidth: maxW,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: '0.8rem',
        }}
      >
        {text}
      </Box>
    </Tooltip>
  );
}

const ShotListPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [shots, setShots] = useState<Shot[]>([]);
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editShot, setEditShot] = useState<Shot | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [shotsRes, projRes] = await Promise.all([
        fetchShots(Number(projectId)),
        api.get(`/projects/${projectId}`),
      ]);
      setShots(shotsRes.data);
      setProjectName(projRes.data.name || `Project ${projectId}`);
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || 'データ取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const openEdit = (shot: Shot) => {
    setEditShot(shot);
    const vals: Record<string, string> = {};
    EDIT_FIELDS.forEach(({ key }) => {
      const v = shot[key];
      vals[key as string] = v != null ? String(v) : '';
    });
    setEditValues(vals);
  };

  const closeEdit = () => { setEditShot(null); setEditValues({}); };

  const handleSave = async () => {
    if (!editShot) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      EDIT_FIELDS.forEach(({ key, numeric }) => {
        const raw = editValues[key as string];
        if (raw === '' || raw == null) {
          payload[key as string] = null;
        } else if (numeric) {
          const n = Number(raw);
          payload[key as string] = isNaN(n) ? null : n;
        } else {
          payload[key as string] = raw;
        }
      });
      await updateShot(editShot.id, payload);
      setSnackbar({ open: true, message: '保存しました', severity: 'success' });
      closeEdit();
      load();
    } catch (e: any) {
      setSnackbar({ open: true, message: e.response?.data?.detail || '保存に失敗しました', severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const closeSnackbar = () => setSnackbar((s) => ({ ...s, open: false }));

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) return <Alert severity="error" sx={{ m: 3 }}>{error}</Alert>;

  return (
    <Box sx={{ p: 3 }}>
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link component={RouterLink} to="/projects" color="inherit">プロジェクト一覧</Link>
        <Link component={RouterLink} to={`/projects/${projectId}`} color="inherit">{projectName}</Link>
        <Typography color="text.primary">ショットリスト</Typography>
      </Breadcrumbs>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5">ショットリスト — {projectName}</Typography>
        <Button
          variant="outlined"
          size="small"
          onClick={() => navigate(`/production-tracker?project=${projectId}`)}
        >
          進捗トラッカー
        </Button>
      </Box>

      {shots.length === 0 ? (
        <Typography color="text.secondary">ショットが登録されていません。</Typography>
      ) : (
        <Paper variant="outlined">
          <TableContainer sx={{ maxHeight: 'calc(100vh - 220px)' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={thSx}>サムネイル</TableCell>
                  <TableCell sx={thSx}>SEQ</TableCell>
                  <TableCell sx={thSx}>SHOT</TableCell>
                  <TableCell sx={thSx}>カット</TableCell>
                  <TableCell sx={thSx}>状態</TableCell>
                  <TableCell sx={thSx}>フレームイン</TableCell>
                  <TableCell sx={thSx}>フレームアウト</TableCell>
                  <TableCell sx={thSx}>説明</TableCell>
                  <TableCell sx={thSx}>アクション</TableCell>
                  <TableCell sx={thSx}>セリフ</TableCell>
                  <TableCell sx={thSx}>BG</TableCell>
                  <TableCell sx={thSx}>CH</TableCell>
                  <TableCell sx={thSx}>PROP</TableCell>
                  <TableCell sx={thSx}>編集</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shots.map((shot) => {
                  const sc = STATUS_CONFIG[shot.status] ?? { label: shot.status, color: 'default' as StatusColor };
                  return (
                    <TableRow key={shot.id} hover>
                      <TableCell sx={{ width: 64, py: 0.5 }}>
                        {shot.thumbnail_url ? (
                          <Avatar
                            variant="rounded"
                            src={shot.thumbnail_url}
                            sx={{ width: 48, height: 27 }}
                          />
                        ) : (
                          <Avatar
                            variant="rounded"
                            sx={{
                              width: 48,
                              height: 27,
                              fontSize: '0.6rem',
                              bgcolor: 'action.disabledBackground',
                              color: 'text.secondary',
                            }}
                          >
                            {shot.shot_code.slice(0, 4)}
                          </Avatar>
                        )}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{shot.seq_code}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.8rem', fontWeight: 600 }}>{shot.shot_code}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem' }}>{shot.cut ?? '—'}</TableCell>
                      <TableCell>
                        <Chip label={sc.label} color={sc.color} size="small" />
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.8rem' }}>{shot.frame_in ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem' }}>{shot.frame_out ?? '—'}</TableCell>
                      <TableCell><TruncCell val={shot.description} /></TableCell>
                      <TableCell><TruncCell val={shot.action} /></TableCell>
                      <TableCell><TruncCell val={shot.dialogue} /></TableCell>
                      <TableCell><TruncCell val={shot.bg} maxW={100} /></TableCell>
                      <TableCell><TruncCell val={shot.ch} maxW={100} /></TableCell>
                      <TableCell><TruncCell val={shot.prop} maxW={100} /></TableCell>
                      <TableCell>
                        <IconButton size="small" onClick={() => openEdit(shot)} aria-label="編集">
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Edit Dialog */}
      <Dialog open={Boolean(editShot)} onClose={closeEdit} maxWidth="sm" fullWidth>
        <DialogTitle>ショット編集 — {editShot?.shot_code}</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2} sx={{ pt: 1 }}>
            {EDIT_FIELDS.map(({ key, label, multiline, numeric }) => (
              <Grid item xs={12} sm={multiline ? 12 : 6} key={key as string}>
                <TextField
                  label={label}
                  fullWidth
                  size="small"
                  multiline={multiline}
                  rows={multiline ? 3 : undefined}
                  type={numeric ? 'number' : 'text'}
                  value={editValues[key as string] ?? ''}
                  onChange={(e) =>
                    setEditValues((prev) => ({ ...prev, [key as string]: e.target.value }))
                  }
                />
              </Grid>
            ))}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEdit} disabled={saving}>キャンセル</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={closeSnackbar}>
        <Alert severity={snackbar.severity} onClose={closeSnackbar} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default ShotListPage;
