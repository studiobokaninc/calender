import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Chip,
} from '@mui/material';
import {
  TableChart as TableChartIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
} from '@mui/icons-material';
import { usePageState } from '../contexts/PageStateContext';
import { importShotlist } from '../services/api';

interface ShotImportWarning {
  row: number;
  field: string;
  level: string;
  message: string;
}

interface ShotImportPreview {
  total: number;
  to_insert: number;
  to_update: number;
  to_delete_candidates: number;
  unchanged: number;
  warnings: ShotImportWarning[];
  preview_rows: Record<string, any>[];
}

interface ShotImportResult {
  inserted: number;
  updated: number;
  deleted_candidates: number;
  skipped: number;
  warnings: ShotImportWarning[];
}

const ShotlistImporter: React.FC = () => {
  const { globalData, refreshGlobalData } = usePageState();
  const [projectId, setProjectId] = useState<number | ''>('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ShotImportPreview | null>(null);
  const [result, setResult] = useState<ShotImportResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projects: { id: number; name: string; display_status?: string }[] = (globalData as any).projects ?? [];
  const onlineProjects = projects.filter((p) => p.display_status === 'online');

  useEffect(() => {
    refreshGlobalData();
  }, [refreshGlobalData]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview(null);
    setResult(null);
    setError(null);
    if (e.target) e.target.value = '';
  };

  const handlePreview = async () => {
    if (!projectId || !file) {
      setError('プロジェクトとファイルを選択してください');
      return;
    }
    setLoading(true);
    setError(null);
    setPreview(null);
    setResult(null);
    try {
      const data = await importShotlist(projectId as number, file, true);
      setPreview(data as ShotImportPreview);
    } catch (err: any) {
      const detail = err?.response?.data?.detail ?? err?.message ?? '不明なエラー';
      setError(`プレビュー失敗: ${detail}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    setConfirmOpen(false);
    if (!projectId || !file) return;
    setLoading(true);
    setError(null);
    try {
      const data = await importShotlist(projectId as number, file, false);
      setResult(data as ShotImportResult);
      setPreview(null);
      await refreshGlobalData({ force: true });
    } catch (err: any) {
      const detail = err?.response?.data?.detail ?? err?.message ?? '不明なエラー';
      setError(`本適用失敗: ${detail}`);
    } finally {
      setLoading(false);
    }
  };

  const previewColumns = preview?.preview_rows?.[0]
    ? Object.keys(preview.preview_rows[0])
    : [];

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <TableChartIcon sx={{ mr: 1.5, color: 'secondary.main' }} />
        <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
          ショットリスト Excel インポート
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3, ml: 4.5, fontSize: '0.875rem' }}>
        .xlsx ファイルからショットリストを一括インポートします。プレビューで差分を確認してから本適用してください。
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* 入力エリア */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, ml: 4.5, mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel id="shotlist-project-label">プロジェクト</InputLabel>
          <Select
            labelId="shotlist-project-label"
            value={projectId}
            label="プロジェクト"
            onChange={(e) => {
              setProjectId(e.target.value as number);
              setPreview(null);
              setResult(null);
            }}
          >
            {onlineProjects.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                <Typography
                  noWrap
                  title={p.name}
                  sx={{ fontSize: '0.875rem', maxWidth: 200 }}
                >
                  {p.name}
                </Typography>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          onChange={handleFileChange}
          style={{ display: 'none' }}
          id="shotlist-file-input"
        />
        <label htmlFor="shotlist-file-input">
          <Button variant="outlined" component="span" disabled={loading} size="small">
            .xlsx ファイル選択
          </Button>
        </label>

        {file && (
          <Typography
            variant="body2"
            sx={{ alignSelf: 'center', fontSize: '0.875rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={file.name}
          >
            {file.name}
          </Typography>
        )}

        <Button
          variant="contained"
          color="primary"
          size="small"
          onClick={handlePreview}
          disabled={loading || !projectId || !file}
        >
          {loading && !confirmOpen ? <CircularProgress size={18} sx={{ mr: 1 }} /> : null}
          プレビュー
        </Button>
      </Box>

      {/* プレビュー結果 */}
      {preview && (
        <Box sx={{ ml: 4.5, mt: 2 }}>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1.5, fontSize: '0.95rem' }}>
            プレビュー結果
          </Typography>

          {/* 差分サマリ */}
          <Table size="small" sx={{ mb: 2, maxWidth: 480 }}>
            <TableHead>
              <TableRow>
                {['追加', '更新', '論理削除候補', '変更なし', '合計'].map((h) => (
                  <TableCell key={h} sx={{ fontWeight: 'bold', fontSize: '0.8rem', py: 0.75 }}>
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                {[preview.to_insert, preview.to_update, preview.to_delete_candidates, preview.unchanged, preview.total].map((v, i) => (
                  <TableCell key={i} sx={{ fontSize: '0.875rem', py: 0.75 }}>
                    {v}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>

          {/* WARNING一覧 */}
          {preview.warnings.length > 0 && (
            <Alert
              severity="warning"
              icon={<WarningIcon />}
              sx={{ mb: 2, fontSize: '0.875rem' }}
            >
              <Typography variant="subtitle2" sx={{ mb: 0.5, fontSize: '0.875rem' }}>
                警告 ({preview.warnings.length}件)
              </Typography>
              <Box sx={{ maxHeight: 180, overflow: 'auto' }}>
                {preview.warnings.map((w, i) => (
                  <Typography key={i} variant="body2" sx={{ fontSize: '0.8rem', mt: 0.5 }}>
                    行{w.row} [{w.field}] {w.message}
                    {w.level !== 'warning' && (
                      <Chip label={w.level} size="small" sx={{ ml: 0.5, height: 16, fontSize: '0.75rem' }} />
                    )}
                  </Typography>
                ))}
              </Box>
            </Alert>
          )}

          {/* プレビュー行テーブル */}
          {preview.preview_rows.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1, fontSize: '0.875rem' }}>
                先頭 {preview.preview_rows.length} 行プレビュー
              </Typography>
              <Box sx={{ overflowX: 'auto', maxHeight: 240, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      {previewColumns.map((col) => (
                        <TableCell key={col} sx={{ fontWeight: 'bold', fontSize: '0.78rem', whiteSpace: 'nowrap', py: 0.75 }}>
                          <Box title={col} sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {col}
                          </Box>
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {preview.preview_rows.map((row, ri) => (
                      <TableRow key={ri}>
                        {previewColumns.map((col) => {
                          const val = row[col] != null ? String(row[col]) : '';
                          return (
                            <TableCell key={col} sx={{ fontSize: '0.8rem', py: 0.75 }}>
                              <Box title={val} sx={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {val}
                              </Box>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Box>
          )}

          <Box sx={{ mt: 2 }}>
            <Button
              variant="contained"
              color="warning"
              size="small"
              onClick={() => setConfirmOpen(true)}
              disabled={loading}
            >
              本適用 (commit)
            </Button>
          </Box>
        </Box>
      )}

      {/* 本適用結果 */}
      {result && (
        <Box sx={{ ml: 4.5, mt: 2 }}>
          <Divider sx={{ mb: 2 }} />
          <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 1.5, fontSize: '0.875rem' }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5, fontSize: '0.875rem' }}>
              本適用完了
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
              挿入: {result.inserted}件 / 更新: {result.updated}件 / 論理削除: {result.deleted_candidates}件 / スキップ: {result.skipped}件
            </Typography>
          </Alert>
          {result.warnings.length > 0 && (
            <Alert severity="warning" sx={{ fontSize: '0.875rem' }}>
              <Typography variant="subtitle2" sx={{ fontSize: '0.875rem' }}>
                警告 ({result.warnings.length}件)
              </Typography>
              <Box sx={{ maxHeight: 160, overflow: 'auto', mt: 0.5 }}>
                {result.warnings.map((w, i) => (
                  <Typography key={i} variant="body2" sx={{ fontSize: '0.8rem', mt: 0.5 }}>
                    行{w.row} [{w.field}] {w.message}
                  </Typography>
                ))}
              </Box>
            </Alert>
          )}
        </Box>
      )}

      {/* 確認ダイアログ */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>本適用の確認</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: '0.875rem' }}>
            プレビューの内容をデータベースに反映します。この操作は取り消せません。実行しますか？
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>キャンセル</Button>
          <Button variant="contained" color="warning" onClick={handleCommit} disabled={loading}>
            {loading ? <CircularProgress size={18} sx={{ mr: 1 }} /> : null}
            本適用する
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default ShotlistImporter;
