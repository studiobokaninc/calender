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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { Edit as EditIcon, Close as CloseIcon } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import api, { fetchShots, updateShot, uploadShotThumbnail } from '../services/api';
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
  { key: 'sl_no',       label: 'No.',           numeric: true },
  { key: 'seq_code',    label: 'SEQ' },
  { key: 'shot_code',   label: 'SHOT' },
  { key: 'cut',         label: 'カット' },
  { key: 'frame_in',   label: 'フレームイン',  numeric: true },
  { key: 'frame_out',  label: 'フレームアウト', numeric: true },
  { key: 'duration',    label: 'デュレーション', numeric: true },
  { key: 'second',      label: '秒数',         numeric: true },
  { key: 'frame_rem',   label: '余りフレーム',  numeric: true },
  { key: 'thumbnail_url', label: 'サムネイルURL' },
  { key: 'description', label: '説明',         multiline: true },
  { key: 'action',      label: 'アクション',   multiline: true },
  { key: 'dialogue',    label: 'セリフ',       multiline: true },
  { key: 'bg',          label: 'BG' },
  { key: 'ch',          label: 'CH' },
  { key: 'prop',        label: 'PROP' },
  { key: 'task_lay',    label: 'レイアウト (LAY)' },
  { key: 'task_anim',   label: 'アニメーション (ANIM)' },
  { key: 'task_fx',     label: 'エフェクト (FX)' },
  { key: 'task_lighting', label: 'ライティング (LIGHT)' },
  { key: 'task_comp',   label: 'コンポジット (COMP)' },
  { key: 'note',        label: 'ノート / 備考', multiline: true },
];

const thSx = { fontWeight: 700, bgcolor: 'action.selected', whiteSpace: 'nowrap' as const };



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

  const [uploadingShotId, setUploadingShotId] = useState<number | null>(null);
  const [dragOverShotId, setDragOverShotId] = useState<number | null>(null);
  const [dialogDragOver, setDialogDragOver] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const [selectedSeq, setSelectedSeq] = useState<string>('all');

  const seqCodes = React.useMemo(() => {
    const codes = new Set(shots.map(s => s.seq_code).filter(Boolean));
    return Array.from(codes).sort();
  }, [shots]);

  const sortedAndFilteredShots = React.useMemo(() => {
    let result = [...shots];
    
    // Sort by seq_code and then shot_code or sl_no
    result.sort((a, b) => {
      const seqCompare = (a.seq_code || '').localeCompare(b.seq_code || '');
      if (seqCompare !== 0) return seqCompare;
      
      return (a.shot_code || '').localeCompare(b.shot_code || '');
    });

    // Filter by selected sequence
    if (selectedSeq !== 'all') {
      result = result.filter(s => s.seq_code === selectedSeq);
    }
    
    return result;
  }, [shots, selectedSeq]);

  useEffect(() => {
    setSelectedSeq('all');
  }, [projectId]);

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

  const handleThumbnailUpload = async (shotId: number, file: File) => {
    if (!file.type.startsWith('image/')) {
      setSnackbar({ open: true, message: '画像ファイルのみアップロード可能です', severity: 'error' });
      return;
    }
    setUploadingShotId(shotId);
    try {
      const { url } = await uploadShotThumbnail(file);
      await updateShot(shotId, { thumbnail_url: url });
      setSnackbar({ open: true, message: 'サムネイルを更新しました', severity: 'success' });
      load();
    } catch (e: any) {
      setSnackbar({ open: true, message: e.response?.data?.detail || 'アップロードに失敗しました', severity: 'error' });
    } finally {
      setUploadingShotId(null);
      setDragOverShotId(null);
    }
  };

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
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel id="seq-filter-label">シーケンス</InputLabel>
          <Select
            labelId="seq-filter-label"
            value={selectedSeq}
            label="シーケンス"
            onChange={(e) => setSelectedSeq(e.target.value)}
          >
            <MenuItem value="all">すべて表示</MenuItem>
            {seqCodes.map(code => (
              <MenuItem key={code} value={code}>{code}</MenuItem>
            ))}
          </Select>
        </FormControl>
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
                  <TableCell sx={thSx}>No.</TableCell>
                  <TableCell sx={thSx}>サムネイル</TableCell>
                  <TableCell sx={thSx}>SEQ</TableCell>
                  <TableCell sx={thSx}>SHOT</TableCell>
                  <TableCell sx={thSx}>カット</TableCell>
                  <TableCell sx={thSx}>フレームイン</TableCell>
                  <TableCell sx={thSx}>フレームアウト</TableCell>
                  <TableCell sx={thSx}>デュレーション</TableCell>
                  <TableCell sx={thSx}>秒数</TableCell>
                  <TableCell sx={thSx}>余りフレーム</TableCell>
                  <TableCell sx={thSx}>説明</TableCell>
                  <TableCell sx={thSx}>アクション</TableCell>
                  <TableCell sx={thSx}>セリフ</TableCell>
                  <TableCell sx={thSx}>BG</TableCell>
                  <TableCell sx={thSx}>CH</TableCell>
                  <TableCell sx={thSx}>PROP</TableCell>
                  <TableCell sx={thSx}>レイアウト</TableCell>
                  <TableCell sx={thSx}>アニメーション</TableCell>
                  <TableCell sx={thSx}>エフェクト</TableCell>
                  <TableCell sx={thSx}>ライティング</TableCell>
                  <TableCell sx={thSx}>コンポジット</TableCell>
                  <TableCell sx={thSx}>ノート</TableCell>
                  <TableCell sx={thSx}>編集</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedAndFilteredShots.map((shot) => {
                  const sc = STATUS_CONFIG[shot.status] ?? { label: shot.status, color: 'default' as StatusColor };
                  return (
                    <TableRow key={shot.id} hover>
                      <TableCell sx={{ fontSize: '0.8rem' }}>{shot.sl_no ?? '—'}</TableCell>
                      <TableCell sx={{ width: 64, py: 0.5 }}>
                        <Tooltip title="画像をここにドラッグ＆ドロップしてサムネイルを即時更新">
                          <Box
                            onDragOver={(e) => { e.preventDefault(); }}
                            onDragEnter={(e) => { e.preventDefault(); setDragOverShotId(shot.id); }}
                            onDragLeave={(e) => { e.preventDefault(); setDragOverShotId(null); }}
                            onDrop={async (e) => {
                              e.preventDefault();
                              const file = e.dataTransfer.files?.[0];
                              if (file) {
                                await handleThumbnailUpload(shot.id, file);
                              }
                            }}
                            onClick={() => shot.thumbnail_url && setLightboxUrl(shot.thumbnail_url)}
                            sx={{
                              position: 'relative',
                              width: 48,
                              height: 27,
                              borderRadius: 1,
                              overflow: 'hidden',
                              border: dragOverShotId === shot.id ? '2px dashed #1976d2' : '1px solid transparent',
                              backgroundColor: dragOverShotId === shot.id ? 'action.hover' : 'transparent',
                              transition: 'all 0.2s',
                              cursor: shot.thumbnail_url ? 'zoom-in' : 'pointer',
                              '&:hover': {
                                border: '1px solid',
                                borderColor: 'primary.main',
                              }
                            }}
                          >
                            {shot.thumbnail_url ? (
                              <Avatar
                                variant="rounded"
                                src={shot.thumbnail_url}
                                sx={{ width: '100%', height: '100%' }}
                              />
                            ) : (
                              <Avatar
                                variant="rounded"
                                sx={{
                                  width: '100%',
                                  height: '100%',
                                  fontSize: '0.6rem',
                                  bgcolor: 'action.disabledBackground',
                                  color: 'text.secondary',
                                }}
                              >
                                {shot.shot_code.slice(0, 4)}
                              </Avatar>
                            )}
                            {uploadingShotId === shot.id && (
                              <Box
                                sx={{
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  bgcolor: 'rgba(0,0,0,0.5)',
                                }}
                              >
                                <CircularProgress size={16} sx={{ color: '#fff' }} />
                              </Box>
                            )}
                          </Box>
                        </Tooltip>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{shot.seq_code}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.8rem', fontWeight: 600 }}>{shot.shot_code}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem' }}>{shot.cut ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem' }}>{shot.frame_in ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem' }}>{shot.frame_out ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem' }}>{shot.duration ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem' }}>{shot.second ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem' }}>{shot.frame_rem ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minWidth: 120 }}>{shot.description ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minWidth: 120 }}>{shot.action ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minWidth: 120 }}>{shot.dialogue ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minWidth: 100 }}>{shot.bg ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minWidth: 100 }}>{shot.ch ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minWidth: 100 }}>{shot.prop ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minWidth: 100 }}>{shot.task_lay ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minWidth: 100 }}>{shot.task_anim ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minWidth: 100 }}>{shot.task_fx ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minWidth: 100 }}>{shot.task_lighting ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minWidth: 100 }}>{shot.task_comp ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minWidth: 150 }}>{shot.note ?? '—'}</TableCell>
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
            {EDIT_FIELDS.map(({ key, label, multiline, numeric }) => {
              if (key === 'thumbnail_url') {
                return (
                  <Grid item xs={12} key={key as string}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 1 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                        サムネイル画像 (ドラッグ＆ドロップ / ファイル選択)
                      </Typography>
                      <Box
                        onDragOver={(e) => { e.preventDefault(); }}
                        onDragEnter={(e) => { e.preventDefault(); setDialogDragOver(true); }}
                        onDragLeave={(e) => { e.preventDefault(); setDialogDragOver(false); }}
                        onDrop={async (e) => {
                          e.preventDefault();
                          setDialogDragOver(false);
                          const file = e.dataTransfer.files?.[0];
                          if (file) {
                            if (!file.type.startsWith('image/')) {
                              setSnackbar({ open: true, message: '画像ファイルのみアップロード可能です', severity: 'error' });
                              return;
                            }
                            setUploadingShotId(editShot?.id ?? null);
                            try {
                              const { url } = await uploadShotThumbnail(file);
                              setEditValues(prev => ({ ...prev, thumbnail_url: url }));
                              setSnackbar({ open: true, message: '画像をアップロードしました', severity: 'success' });
                            } catch (uploadErr) {
                              setSnackbar({ open: true, message: 'アップロードに失敗しました', severity: 'error' });
                            } finally {
                              setUploadingShotId(null);
                            }
                          }
                        }}
                        sx={{
                          border: dialogDragOver ? '2px dashed #1976d2' : '1px dashed #ccc',
                          borderRadius: 2,
                          p: 2,
                          textAlign: 'center',
                          backgroundColor: dialogDragOver ? 'rgba(25, 118, 210, 0.05)' : 'action.hover',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          position: 'relative',
                          minHeight: 100,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 1,
                          '&:hover': {
                            borderColor: 'primary.main',
                            backgroundColor: 'action.selected',
                          }
                        }}
                        component="label"
                      >
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              if (!file.type.startsWith('image/')) {
                                setSnackbar({ open: true, message: '画像ファイルのみアップロード可能です', severity: 'error' });
                                return;
                              }
                              setUploadingShotId(editShot?.id ?? null);
                              try {
                                const { url } = await uploadShotThumbnail(file);
                                setEditValues(prev => ({ ...prev, thumbnail_url: url }));
                                setSnackbar({ open: true, message: '画像をアップロードしました', severity: 'success' });
                              } catch (uploadErr) {
                                setSnackbar({ open: true, message: 'アップロードに失敗しました', severity: 'error' });
                              } finally {
                                setUploadingShotId(null);
                              }
                            }
                          }}
                        />
                        {uploadingShotId === editShot?.id ? (
                          <CircularProgress size={24} />
                        ) : editValues.thumbnail_url ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
                            <Box
                              component="img"
                              src={editValues.thumbnail_url}
                              alt="thumbnail preview"
                              sx={{ width: 120, height: 68, borderRadius: 1, objectFit: 'cover', border: '1px solid #ccc' }}
                            />
                            <Typography variant="body2" color="text.secondary">
                              画像をドラッグ＆ドロップするか、クリックして変更
                            </Typography>
                          </Box>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            画像をドラッグ＆ドロップするか、クリックして選択
                          </Typography>
                        )}
                      </Box>
                      <TextField
                        label="サムネイルURL (手動入力)"
                        fullWidth
                        size="small"
                        value={editValues.thumbnail_url ?? ''}
                        onChange={(e) =>
                          setEditValues((prev) => ({ ...prev, thumbnail_url: e.target.value }))
                        }
                      />
                    </Box>
                  </Grid>
                );
              }
              return (
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
              );
            })}
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

      {/* サムネイル拡大表示 (Lightbox) */}
      <Dialog
        open={!!lightboxUrl}
        onClose={() => setLightboxUrl(null)}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { bgcolor: 'grey.900', m: 1 } }}
      >
        <DialogContent sx={{ p: 0, position: 'relative' }}>
          <IconButton
            onClick={() => setLightboxUrl(null)}
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              color: 'white',
              bgcolor: 'rgba(0, 0, 0, 0.5)',
              zIndex: 1,
              '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.7)' },
            }}
          >
            <CloseIcon />
          </IconButton>
          {lightboxUrl && (
            <Box
              component="img"
              src={lightboxUrl}
              alt="サムネイル拡大"
              sx={{
                width: '100%',
                height: 'auto',
                maxHeight: '90vh',
                objectFit: 'contain',
                display: 'block',
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default ShotListPage;
