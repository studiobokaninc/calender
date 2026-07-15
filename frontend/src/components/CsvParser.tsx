import React, { useState } from 'react';
import {
  Box,
  Button,
  Typography,
  Paper,
  Alert,
  CircularProgress,
  Tooltip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
} from '@mui/material';
import {
  Download as DownloadIcon,
  HelpOutline as HelpOutlineIcon,
} from '@mui/icons-material';
import api, { mockDataApi } from '../services/api';
import { useNavigate } from 'react-router-dom';
import { usePageState } from '../contexts/PageStateContext';



interface CsvParserProps {
  onImportComplete?: () => void;
}

const CsvParser: React.FC<CsvParserProps> = ({ onImportComplete }) => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const navigate = useNavigate();
  const { refreshGlobalData } = usePageState();
  const [helpOpen, setHelpOpen] = useState(false);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setFile(event.target.files[0]);
      setError(null);
      setSuccess(null);
      setWarnings([]);
    }
  };

  const handleFileUpload = async () => {
    if (!file) {
      setError('ファイルを選択してください');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    setWarnings([]);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const result = await mockDataApi.importCsvData(formData);

      // インポート結果サマリを表示
      const projectsImported = result.projects?.imported || 0;
      const tasksImported = result.tasks?.imported || 0;
      const tasksUpdated = result.tasks?.updated || 0;
      const eventsImported = result.events?.imported || 0;
      setSuccess(`インポート完了: プロジェクト ${projectsImported}件、タスク 新規 ${tasksImported}件・更新 ${tasksUpdated}件、イベント ${eventsImported}件`);

      // 警告がある場合は表示
      if (result.warnings && result.warnings.length > 0) {
        setWarnings(result.warnings);
      }

      // グローバルデータを更新
      console.log('[CsvParser] Refreshing global data after CSV import...');
      await refreshGlobalData();
      console.log('[CsvParser] Global data refresh completed');

      // CSVインポート完了を通知するカスタムイベントを発火
      console.log('[CsvParser] Dispatching csvImportCompleted event...');
      window.dispatchEvent(new CustomEvent('csvImportCompleted', {
        detail: { message: result.message }
      }));

      if (onImportComplete) {
        onImportComplete();
      }
      // 成功後、プロジェクト一覧ページに遷移
      navigate('/projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'インポートに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleTemplateDownload = async () => {
    try {
      const response = await api.get<Blob>('/admin/csv-template', {
        responseType: 'blob',
      });
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'project_task_template.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError('テンプレートのダウンロードに失敗しました');
    }
  };

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 'bold', mr: 1 }}>
          CSVファイルをインポート
        </Typography>
        <Tooltip title="インポート可能な列とCSV構成を確認">
          <IconButton size="small" onClick={() => setHelpOpen(true)} color="primary">
            <HelpOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Typography variant="body2" color="text.secondary" paragraph>
        CSVファイルをアップロードして、プロジェクト・タスク・会議・ワークショップ・イベント・締切・マイルストーンを一括登録できます。
        テンプレートをダウンロードして、正しい形式でデータを作成してください。
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {warnings.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setWarnings([])}>
          <Typography variant="subtitle2" gutterBottom>
            警告 ({warnings.length}件)
          </Typography>
          <Box sx={{ maxHeight: 200, overflow: 'auto' }}>
            {warnings.map((warning, index) => (
              <Typography key={index} variant="body2" sx={{ mt: 0.5 }}>
                • {warning}
              </Typography>
            ))}
          </Box>
        </Alert>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Button
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={handleTemplateDownload}
          disabled={loading}
        >
          テンプレートをダウンロード
        </Button>
        <input
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          style={{ display: 'none' }}
          id="csv-file-input"
        />
        <label htmlFor="csv-file-input">
          <Button variant="contained" component="span" disabled={loading}>
            ファイルを選択
          </Button>
        </label>
        {file && (
          <Typography variant="body2" sx={{ mt: 1 }}>
            選択されたファイル: {file.name}
          </Typography>
        )}
      </Box>

      <Button
        variant="contained"
        color="primary"
        onClick={handleFileUpload}
        disabled={!file || loading}
        sx={{ mr: 1, mt: 2 }}
      >
        {loading ? <CircularProgress size={24} /> : 'インポート'}
      </Button>

      {/* CSVインポートヘルプダイアログ */}
      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>CSVインポートの仕様ヘルプ</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: '0.875rem', mb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span>
              CSVファイルは「プロジェクト情報」と「タスク情報」の2つのセクションで構成されます。
              各セクションの1行目はセクション名、2行目はヘッダー列、3行目以降がデータ行となります。
            </span>
            <span style={{ color: '#E53935', fontWeight: 'bold' }}>
              ※「必須」マーク以外の列は、CSV内に列自体が存在しない、またはセルが空欄であってもエラーにならず、インポートを実行できます（その場合、空欄またはデフォルト値として登録されます）。
            </span>
          </DialogContentText>

          <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>1. プロジェクト情報セクション</Typography>
          <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell sx={{ fontWeight: 'bold', fontSize: '0.8rem', width: '80px' }}>必須/任意</TableCell>
                  <TableCell sx={{ fontWeight: 'bold', fontSize: '0.8rem', width: '120px' }}>ヘッダー名</TableCell>
                  <TableCell sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}>説明 / 形式</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell><Chip label="必須" color="error" size="small" sx={{ height: 20, fontSize: '0.75rem', fontWeight: 'bold' }} /></TableCell>
                  <TableCell sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}>プロジェクト名</TableCell>
                  <TableCell sx={{ fontSize: '0.8rem' }}>プロジェクトの一意の名前。既存プロジェクトがある場合は上書き更新されます。</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><Chip label="任意" variant="outlined" size="small" sx={{ height: 20, fontSize: '0.75rem' }} /></TableCell>
                  <TableCell sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}>開始日 / 終了日</TableCell>
                  <TableCell sx={{ fontSize: '0.8rem' }}>形式: <code style={{ backgroundColor: 'rgba(0,0,0,0.05)', padding: '2px 4px', borderRadius: 3 }}>YYYY/MM/DD</code> または <code style={{ backgroundColor: 'rgba(0,0,0,0.05)', padding: '2px 4px', borderRadius: 3 }}>YYYY-MM-DD</code></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><Chip label="任意" variant="outlined" size="small" sx={{ height: 20, fontSize: '0.75rem' }} /></TableCell>
                  <TableCell sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}>説明</TableCell>
                  <TableCell sx={{ fontSize: '0.8rem' }}>プロジェクトの概要説明文</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Box>

          <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>2. タスク情報セクション</Typography>
          <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell sx={{ fontWeight: 'bold', fontSize: '0.8rem', width: '80px' }}>必須/任意</TableCell>
                  <TableCell sx={{ fontWeight: 'bold', fontSize: '0.8rem', width: '120px' }}>ヘッダー名</TableCell>
                  <TableCell sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}>説明 / 形式</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell><Chip label="必須" color="error" size="small" sx={{ height: 20, fontSize: '0.75rem', fontWeight: 'bold' }} /></TableCell>
                  <TableCell sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}>タスク名</TableCell>
                  <TableCell sx={{ fontSize: '0.8rem' }}>タスクの名前 (例: レイアウト、カラーなど)</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><Chip label="任意" variant="outlined" size="small" sx={{ height: 20, fontSize: '0.75rem' }} /></TableCell>
                  <TableCell sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}>期日</TableCell>
                  <TableCell sx={{ fontSize: '0.8rem' }}>完了目標日。形式: <code style={{ backgroundColor: 'rgba(0,0,0,0.05)', padding: '2px 4px', borderRadius: 3 }}>YYYY/MM/DD</code></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><Chip label="任意" variant="outlined" size="small" sx={{ height: 20, fontSize: '0.75rem' }} /></TableCell>
                  <TableCell sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}>説明</TableCell>
                  <TableCell sx={{ fontSize: '0.8rem' }}>タスクの具体的な指示や注意書き</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><Chip label="任意" variant="outlined" size="small" sx={{ height: 20, fontSize: '0.75rem' }} /></TableCell>
                  <TableCell sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}>担当者</TableCell>
                  <TableCell sx={{ fontSize: '0.8rem' }}>担当者の「ユーザー名」「フルネーム」「メールアドレス」のいずれか</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><Chip label="任意" variant="outlined" size="small" sx={{ height: 20, fontSize: '0.75rem' }} /></TableCell>
                  <TableCell sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}>コスト</TableCell>
                  <TableCell sx={{ fontSize: '0.8rem' }}>
                    タスクの工数（時間数）。8コスト＝1日と計算され、指定された期日および土日を除外した稼働日スケジュールから「開始日」が自動逆算されます。
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><Chip label="任意" variant="outlined" size="small" sx={{ height: 20, fontSize: '0.75rem' }} /></TableCell>
                  <TableCell sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}>タイプ</TableCell>
                  <TableCell sx={{ fontSize: '0.8rem' }}>
                    タスクの種類。推奨される値: <code style={{ backgroundColor: 'rgba(0,0,0,0.05)', padding: '2px 4px', borderRadius: 3 }}>layout</code>, <code style={{ backgroundColor: 'rgba(0,0,0,0.05)', padding: '2px 4px', borderRadius: 3 }}>animation</code>, <code style={{ backgroundColor: 'rgba(0,0,0,0.05)', padding: '2px 4px', borderRadius: 3 }}>comp</code>, <code style={{ backgroundColor: 'rgba(0,0,0,0.05)', padding: '2px 4px', borderRadius: 3 }}>fx</code>, <code style={{ backgroundColor: 'rgba(0,0,0,0.05)', padding: '2px 4px', borderRadius: 3 }}>lighting</code>, <code style={{ backgroundColor: 'rgba(0,0,0,0.05)', padding: '2px 4px', borderRadius: 3 }}>asset</code> 等
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><Chip label="任意" variant="outlined" size="small" sx={{ height: 20, fontSize: '0.75rem' }} /></TableCell>
                  <TableCell sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}>seqID / shotID</TableCell>
                  <TableCell sx={{ fontSize: '0.8rem' }}>シーケンスID / ショットID。指定すると自動的にそのショットに紐付けられます。</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><Chip label="任意" variant="outlined" size="small" sx={{ height: 20, fontSize: '0.75rem' }} /></TableCell>
                  <TableCell sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}>依存タスク</TableCell>
                  <TableCell sx={{ fontSize: '0.8rem' }}>このタスクの開始前に完了すべき他のタスク名。複数ある場合は「カンマ ( , )」区切りで記述します。</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHelpOpen(false)} variant="contained" color="primary">閉じる</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default CsvParser; 