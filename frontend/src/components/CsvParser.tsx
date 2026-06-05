import React, { useState } from 'react';
import { Box, Button, Typography, Paper, Alert, CircularProgress } from '@mui/material';
import { Download as DownloadIcon } from '@mui/icons-material';
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
      const eventsImported = result.events?.imported || 0;
      setSuccess(`インポート完了: プロジェクト ${projectsImported}件、タスク ${tasksImported}件、イベント ${eventsImported}件`);

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
      <Typography variant="h6" gutterBottom>
        CSVファイルをインポート
      </Typography>
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
    </Paper>
  );
};

export default CsvParser; 