import React, { useState } from 'react';
import { Box, Button, Typography, Paper, Alert, CircularProgress } from '@mui/material';
import { Upload as UploadIcon, Download as DownloadIcon } from '@mui/icons-material';
import { mockDataApi } from '../services/api';
import { useNavigate } from 'react-router-dom';

interface ParsedData {
  users: Array<{
    email: string;
    full_name: string;
    role: string;
  }>;
  projects: Array<{
    name: string;
    description: string;
    status: string;
    startDate: string;
    endDate: string;
    budget?: number;
    priority?: string;
    display_status?: string;
    color?: string;
  }>;
  tasks: Array<{
    name: string;
    description: string;
    project_id: number;
    due_date: string;
    assigned_to?: number;
    cost: number;
    status: string;
    priority?: string;
    type?: string;
    start_date?: string;
    progress?: number;
    shotID?: string;
    seqID?: string;
    display_status?: string;
    dependsOn: string[];
  }>;
  events?: Array<{
    title: string;
    description?: string;
    start_time: string;
    end_time: string;
    location?: string;
    type: string;
    allDay?: boolean;
    participants?: Array<{ email: string; role: string }>;
  }>;
}

interface CsvParserProps {
  onImportComplete?: () => void;
}

const CsvParser: React.FC<CsvParserProps> = ({ onImportComplete }) => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setFile(event.target.files[0]);
      setError(null);
      setSuccess(null);
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

    try {
      const formData = new FormData();
      formData.append('file', file);

      const result = await mockDataApi.importCsvData(formData);
      setSuccess(result.message);
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
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:8001/api/admin/csv-template', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
      });
      const blob = await response.blob();
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
        CSVファイルをアップロードして、プロジェクトとタスクのデータを解析します。
        テンプレートをダウンロードして、正しい形式でデータを作成できます。
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