import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Paper,
  Typography,
  Button,
  Alert,
  CircularProgress,
  TextField,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Breadcrumbs,
  Link,
} from '@mui/material';
import {
  FileDownload as FileDownloadIcon,
  FileUpload as FileUploadIcon,
  Storage as StorageIcon,
  ErrorOutline as ErrorIcon,
  CheckCircleOutline as SuccessIcon,
  People as PeopleIcon,
  Folder as ProjectIcon,
  TaskAlt as TaskIcon,
  Event as EventIcon,
  Group as GroupIcon,
  Link as LinkIcon,
  Backup as BackupIcon,
} from '@mui/icons-material';
import api, { exportMockData, importMockData } from '../services/api'; // API関数をインポート
import { MockDataImport } from '../types'; // 型をインポート
import CsvParser from './CsvParser';
import ShotlistImporter from './ShotlistImporter';
import { transformImportData } from '../utils/transformImportData';

const MockDataConsole: React.FC = () => {
  const navigate = useNavigate();
  // 状態管理
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportedData, setExportedData] = useState<MockDataImport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<any>(null); // インポート結果サマリ
  const [importErrors, setImportErrors] = useState<string[]>([]); // インポートエラー詳細

  // ファイル入力用のref
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);

  // メッセージを一定時間後に消すヘルパー
  const showTemporaryMessage = (
    setMessage: React.Dispatch<React.SetStateAction<string | null>>,
    message: string,
    duration: number = 5000
  ) => {
    setMessage(message);
    setTimeout(() => setMessage(null), duration);
  };

  // 全データのエクスポート
  const handleExport = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setExportedData(null);

    try {
      const data = await exportMockData();
      setExportedData(data);
      setIsExportDialogOpen(true);
      showTemporaryMessage(setSuccessMessage, '全データを正常にエクスポートしました');
    } catch (error: any) {
      console.error('Export error:', error);
      showTemporaryMessage(setErrorMessage, `データのエクスポートに失敗しました: ${error.message || '不明なエラー'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // エクスポートしたデータのダウンロード
  const handleDownloadExportedData = () => {
    if (!exportedData) return;

    try {
      const dataStr = JSON.stringify(exportedData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);

      const link = document.createElement('a');
      link.href = url;
      const filename = `mock_data_export_${new Date().toISOString().split('T')[0]}.json`;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url); // メモリ解放

      setIsExportDialogOpen(false);
    } catch (error) {
      console.error("Download error:", error);
      showTemporaryMessage(setErrorMessage, "ダウンロード用ファイルの生成に失敗しました。");
    }
  };

  // インポート - ファイル選択ダイアログを開く
  const handleOpenImportDialog = () => {
    // 以前のエラーやサマリをクリア
    setErrorMessage(null);
    setSuccessMessage(null);
    setImportSummary(null);
    setImportErrors([]);
    fileInputRef.current?.click();
  };

  // インポート - ファイル読み込みとAPI呼び出し
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const fileContent = e.target?.result as string;
        const rawData = JSON.parse(fileContent);
        const jsonData = transformImportData(rawData); // ← 変換を適用

        // 簡単なバリデーション (各キーが存在するか)
        if (!jsonData || typeof jsonData !== 'object' ||
          !jsonData.users || !jsonData.projects || !jsonData.tasks || !jsonData.events) {
          throw new Error('ファイル形式が無効です。必要なキー (users, projects, tasks, events) が含まれていません。');
        }

        setIsLoading(true);
        setErrorMessage(null);
        setSuccessMessage(null);
        setImportSummary(null);
        setImportErrors([]);

        const response = await importMockData(jsonData);
        console.log('Import response:', response);

        // レスポンスのフォールバック処理を追加
        const summary = response?.summary || {
          users: response?.users_added_count || 0,
          projects: response?.projects_added_count || 0,
          tasks: response?.tasks_added_count || 0,
          events: response?.events_added_count || 0,
          groups: response?.groups_added_count || 0,
          user_groups: response?.user_groups_added_count || 0
        };

        setImportSummary(summary);
        setImportErrors(response?.errors || []);

        if (response?.errors && response.errors.length > 0) {
          showTemporaryMessage(setErrorMessage, `インポート中に${response.errors.length}件のエラーが発生しました。詳細はリストを確認してください。`, 10000);
        } else {
          showTemporaryMessage(setSuccessMessage, 'データのインポートが完了しました。');
        }

      } catch (error: any) {
        console.error('Import processing error:', error);
        let errMsg = 'データのインポート処理に失敗しました。';
        if (error instanceof SyntaxError) {
          errMsg += ' JSON形式が無効です。';
        } else if (error.message) {
          errMsg += ` ${error.message}`;
        }
        showTemporaryMessage(setErrorMessage, errMsg);
      } finally {
        setIsLoading(false);
        // ファイル選択をリセット
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    };
    reader.onerror = () => {
      showTemporaryMessage(setErrorMessage, 'ファイルの読み込みに失敗しました');
      setIsLoading(false);
    };
    reader.readAsText(file);
  };


  const handleOpenRestoreDialog = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setImportSummary(null);
    setImportErrors([]);
    restoreFileInputRef.current?.click();
  };

  const handleRestoreFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const confirmRestore = window.confirm(
      "【警告】データベースを丸ごと復元します。現在のデータベースにある全19テーブルの情報はすべて削除され、選択したJSONファイルの内容に置き換わります。\n\n本当に実行しますか？"
    );
    if (!confirmRestore) {
      if (restoreFileInputRef.current) {
        restoreFileInputRef.current.value = '';
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const fileContent = e.target?.result as string;
        const jsonData = JSON.parse(fileContent);

        setIsLoading(true);
        setErrorMessage(null);
        setSuccessMessage(null);
        setImportSummary(null);
        setImportErrors([]);

        const response = await api.post('/admin/database/import-json', jsonData);
        console.log('Restore response:', response);

        const summary = response.data?.imported_records || {};
        setImportSummary(summary);
        showTemporaryMessage(setSuccessMessage, 'データベースを丸ごと正常に復元しました。');
      } catch (error: any) {
        console.error('Restore processing error:', error);
        let errMsg = 'データベースの復元処理に失敗しました。';
        if (error instanceof SyntaxError) {
          errMsg += ' JSON形式が無効です。';
        } else if (error.response?.data?.detail) {
          errMsg += ` ${error.response.data.detail}`;
        } else if (error.message) {
          errMsg += ` ${error.message}`;
        }
        showTemporaryMessage(setErrorMessage, errMsg);
      } finally {
        setIsLoading(false);
        if (restoreFileInputRef.current) {
          restoreFileInputRef.current.value = '';
        }
      }
    };
    reader.onerror = () => {
      showTemporaryMessage(setErrorMessage, 'ファイルの読み込みに失敗しました');
      setIsLoading(false);
    };
    reader.readAsText(file);
  };


  // アイコンを返すヘルパー
  const getIconForDataType = (type: string) => {
    switch (type) {
      case 'users': return <PeopleIcon />;
      case 'projects': return <ProjectIcon />;
      case 'tasks': return <TaskIcon />;
      case 'events': return <EventIcon />;
      case 'groups': return <GroupIcon />;
      case 'user_groups': return <LinkIcon />;
      default: return <StorageIcon />;
    }
  }

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 }, height: '100%', display: 'flex', flexDirection: 'column', gap: 3, overflow: 'auto' }}>
      {/* タイトル */}
      <Box sx={{ mb: 1 }}>
        <Breadcrumbs sx={{ mb: 1.5 }}>
          <Link color="inherit" onClick={() => navigate('/dashboard')} sx={{ cursor: 'pointer', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
            App
          </Link>
          <Typography color="text.primary" sx={{ fontWeight: 500 }}>Data</Typography>
        </Breadcrumbs>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <StorageIcon sx={{ fontSize: '2rem', color: '#00BCD4' }} />
          <Typography
            variant="h4"
            sx={{
              fontWeight: 800,
              background: 'linear-gradient(45deg, #00BCD4 30%, #3F51B5 90%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontSize: { xs: '1.75rem', sm: '2.25rem' }
            }}
          >
            Data Management
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontSize: '0.95rem' }}>
          データベースのバックアップ、エクスポート、およびインポートを管理します。
        </Typography>
      </Box>

      {/* 通知メッセージ */}
      {successMessage && (
        <Alert severity="success" onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      )}
      {errorMessage && (
        <Alert severity="error" onClose={() => setErrorMessage(null)}>
          {errorMessage}
        </Alert>
      )}

      {/* ローディングインジケーター */}
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 3 }}>
          <CircularProgress size={32} sx={{ mr: 2 }} />
          <Typography variant="body1">処理中...</Typography>
        </Box>
      )}

      {/* CSVパーサー */}
      <CsvParser />

      {/* ショットリスト Excel インポート */}
      <ShotlistImporter />

      {/* バックアップセクション */}
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <BackupIcon sx={{ mr: 1.5, color: 'primary.main' }} />
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
            バックアップ
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, ml: 4.5 }}>
          データベースのバックアップをダウンロードします。JSON形式またはデータベースファイル（.db）形式を選択できます。
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ ml: 4.5 }}>
          <Button
            variant="contained"
            color="success"
            startIcon={<BackupIcon />}
            onClick={async () => {
              setIsLoading(true);
              setErrorMessage(null);
              setSuccessMessage(null);
              try {
                // 1. トークン取得
                const tokenResponse = await api.post<{ token: string }>('/admin/backup-db/token');
                const token = tokenResponse.data.token;
                if (!token) throw new Error('トークンの取得に失敗しました');

                // 2. ダウンロード
                window.location.href = `/api/admin/full-backup/download?token=${token}`;
                showTemporaryMessage(setSuccessMessage, 'フルバックアップ(ZIP)の生成とダウンロードを開始しました');
              } catch (err: any) {
                showTemporaryMessage(setErrorMessage, `バックアップに失敗しました: ${err?.response?.data?.detail || err?.message}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            sx={{ minWidth: 200 }}
          >
            フルバックアップ（ZIP一括形式）
          </Button>
          <Button
            variant="outlined"
            color="secondary"
            startIcon={<BackupIcon />}
            onClick={async () => {
              setIsLoading(true);
              setErrorMessage(null);
              setSuccessMessage(null);
              try {
                console.log('Requesting backup download token...');

                // 1. 一時的なダウンロードトークンを取得 (これは通常の認証が必要)
                const tokenResponse = await api.post<{ token: string }>('/admin/backup-db/token');
                const token = tokenResponse.data.token;

                if (!token) {
                  throw new Error('ダウンロードトークンの取得に失敗しました');
                }

                console.log('Download token received, triggering direct download...');

                // 2. ブラウザの標準ダウンロード機能を使用
                // これにより Axios/Blob 処理によるメモリ不足やCORSのバイナリ制限を完全に回避できる
                const downloadUrl = `/api/admin/backup-db?token=${token}`;

                // 直接リンクへ遷移（ブラウザがストリームとして処理する）
                window.location.href = downloadUrl;

                showTemporaryMessage(setSuccessMessage, 'データベースファイルのダウンロードを開始しました');
              } catch (err: any) {
                console.error('Database backup error:', err);
                const detail = err?.response?.data?.detail || err?.message || '不明なエラー';
                showTemporaryMessage(setErrorMessage, `ダウンロードの準備に失敗しました: ${detail}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            sx={{ minWidth: 200 }}
          >
            DBファイルのみ (.db)
          </Button>
          <Button
            variant="outlined"
            onClick={async () => {
              setIsLoading(true);
              setErrorMessage(null);
              setSuccessMessage(null);
              try {
                const res = await api.get<Record<string, unknown>>('/admin/backup');
                const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `backup_${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
                showTemporaryMessage(setSuccessMessage, 'JSONバックアップをダウンロードしました');
              } catch (err: any) {
                showTemporaryMessage(setErrorMessage, `バックアップの取得に失敗しました: ${err?.response?.data?.detail || err?.message || '不明なエラー'}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            sx={{ minWidth: 200 }}
          >
            JSON形式 (テキストデータのみ)
          </Button>
        </Stack>
      </Paper>

      {/* データのエクスポートセクション */}
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <FileDownloadIcon sx={{ mr: 1.5, color: 'primary.main' }} />
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
            データのエクスポート
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, ml: 4.5 }}>
          現在のデータベース内の全データ（ユーザー、プロジェクト、タスク、イベント等）をJSONファイルとしてエクスポートします。
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ ml: 4.5 }}>
          <Button
            variant="outlined"
            startIcon={<FileDownloadIcon />}
            onClick={handleExport}
            disabled={isLoading}
            sx={{ minWidth: 200 }}
          >
            マックデータ形式エクスポート
          </Button>
          <Button
            variant="contained"
            color="primary"
            startIcon={<FileDownloadIcon />}
            onClick={async () => {
              setIsLoading(true);
              setErrorMessage(null);
              setSuccessMessage(null);
              try {
                const res = await api.get('/admin/database/export-json');
                const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `database_full_export_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.json`;
                a.click();
                URL.revokeObjectURL(url);
                showTemporaryMessage(setSuccessMessage, 'データベースの丸ごとJSONエクスポートに成功しました');
              } catch (err: any) {
                showTemporaryMessage(setErrorMessage, `エクスポートに失敗しました: ${err?.response?.data?.detail || err?.message}`);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
            sx={{ minWidth: 200 }}
          >
            データベースを丸ごとエクスポート (JSON)
          </Button>
        </Stack>
      </Paper>

      {/* データのインポートセクション */}
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <FileUploadIcon sx={{ mr: 1.5, color: 'primary.main' }} />
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
            データのインポート
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, ml: 4.5 }}>
          エクスポートされた形式のJSONファイルを選択して、データをデータベースに追加します。既存のデータと重複する場合（例：同じメールアドレスのユーザー）はスキップされます。
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ ml: 4.5 }}>
          <Button
            variant="outlined"
            startIcon={<FileUploadIcon />}
            onClick={handleOpenImportDialog}
            disabled={isLoading}
            sx={{ minWidth: 200 }}
          >
            マックデータ形式インポート
          </Button>
          <Button
            variant="contained"
            color="warning"
            startIcon={<FileUploadIcon />}
            onClick={handleOpenRestoreDialog}
            disabled={isLoading}
            sx={{ minWidth: 200 }}
          >
            データベースを丸ごと復元 (.json)
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".json"
            style={{ display: 'none' }}
          />
          <input
            type="file"
            ref={restoreFileInputRef}
            onChange={handleRestoreFileChange}
            accept=".json"
            style={{ display: 'none' }}
          />
        </Stack>
      </Paper>

      {/* インポート結果表示 */}
      {importSummary && !isLoading && (
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <SuccessIcon sx={{ mr: 1.5, color: 'success.main' }} />
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
              インポート結果
            </Typography>
          </Box>
          <List dense sx={{ ml: 4.5 }}>
            {Object.entries(importSummary).map(([key, value]) => (
              typeof value === 'number' && // サマリの数値のみ表示
              <ListItem key={key} sx={{ pl: 0 }}>
                <ListItemIcon sx={{ minWidth: '40px' }}>
                  {getIconForDataType(key)}
                </ListItemIcon>
                <ListItemText
                  primary={`${key.charAt(0).toUpperCase() + key.slice(1)}: ${value} 件`}
                  primaryTypographyProps={{ variant: 'body1' }}
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      )}

      {/* インポートエラー表示 */}
      {importErrors.length > 0 && !isLoading && (
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <ErrorIcon sx={{ mr: 1.5, color: 'error.main' }} />
            <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'error.main' }}>
              インポートエラー詳細 ({importErrors.length}件)
            </Typography>
          </Box>
          <List
            dense
            sx={{
              ml: 4.5,
              maxHeight: 300,
              overflow: 'auto',
              border: '1px solid',
              borderColor: 'error.light',
              borderRadius: 1,
              p: 1,
              backgroundColor: 'rgba(211, 47, 47, 0.08)'
            }}
          >
            {importErrors.map((errorMsg, index) => (
              <ListItem key={index} sx={{ pl: 1 }}>
                <ListItemIcon sx={{ minWidth: '30px', color: 'error.main' }}>
                  <ErrorIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={errorMsg}
                  primaryTypographyProps={{ variant: 'body2', color: 'text.primary' }}
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      )}


      {/* エクスポートデータ表示ダイアログ */}
      <Dialog open={isExportDialogOpen} onClose={() => setIsExportDialogOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>エクスポートされたデータ</DialogTitle>
        <DialogContent>
          <TextField
            multiline
            fullWidth
            rows={15}
            value={exportedData ? JSON.stringify(exportedData, null, 2) : 'データがありません'}
            variant="outlined"
            InputProps={{
              readOnly: true,
              sx: { '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: '0.8rem' } }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsExportDialogOpen(false)}>閉じる</Button>
          <Button
            variant="contained"
            onClick={handleDownloadExportedData}
            startIcon={<FileDownloadIcon />}
            disabled={!exportedData}
          >
            ダウンロード
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default MockDataConsole; 