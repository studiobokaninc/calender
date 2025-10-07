import React, { useState, useRef } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Divider,
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
  ListItemIcon
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
} from '@mui/icons-material';
import { exportMockData, importMockData } from '../services/api'; // API関数をインポート
import { MockDataImport } from '../types'; // 型をインポート
import CsvParser from './CsvParser';
import { transformImportData } from '../utils/transformImportData';
import { usePageState } from '../contexts/PageStateContext';

const MockDataConsole: React.FC = () => {
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
  
  // グローバルデータ更新用
  const { refreshGlobalData } = usePageState();

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

  const handleCsvDataParsed = async (parsedData: any) => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      setImportSummary(null);
      setImportErrors([]);

      // プロジェクトデータを整形
      const projects = parsedData.projects.map((project: any) => ({
        name: project.name,
        description: project.description,
        status: project.status || 'in-progress',
        startDate: project.startDate,
        endDate: project.endDate
      }));

      // タスクデータを整形
      const tasks = parsedData.tasks.map((task: any) => ({
        title: task.title,
        description: task.description,
        projectId: task.project_name,
        assigneeEmail: task.assigneeName ? `${task.assigneeName}@example.com` : undefined,
        taskDueDate: task.due_date,
        taskStatus: task.status,
        taskCost: task.cost,
        dependsOn: task.dependent_tasks ? task.dependent_tasks.split(',').map((s: string) => s.trim()).filter(Boolean) : []
      }));

      // インポートデータを作成
      const importData = {
        users: parsedData.users,
        projects,
        tasks,
        events: [],
        append_mode: true // 追加モードを明示的に指定
      };

      const response = await importMockData(importData);
      
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
        // グローバルデータを更新
        await refreshGlobalData();
      }
    } catch (error: any) {
      console.error('Import processing error:', error);
      showTemporaryMessage(setErrorMessage, `データのインポート処理に失敗しました: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
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
    <Paper sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* タイトル */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <StorageIcon sx={{ mr: 1 }} color="primary" />
        <Typography variant="h5" component="h1">
          データ管理コンソール
        </Typography>
      </Box>

      <Divider sx={{ mb: 3 }} />

      {/* CSVパーサー */}
      <CsvParser onDataParsed={handleCsvDataParsed} />

      {/* 通知メッセージ */}
      {successMessage && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      )}
      {errorMessage && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMessage(null)}>
          {errorMessage}
        </Alert>
      )}

      {/* ローディングインジケーター */}
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', my: 2 }}>
          <CircularProgress size={24} sx={{ mr: 1 }} />
          <Typography>処理中...</Typography>
        </Box>
      )}

      {/* 操作パネル */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          データのエクスポート
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          現在のデータベース内の全データ（ユーザー、プロジェクト、タスク、イベント等）をJSONファイルとしてエクスポートします。
        </Typography>
        <Button
          variant="contained"
          startIcon={<FileDownloadIcon />}
          onClick={handleExport}
          disabled={isLoading}
        >
          全データをエクスポート
        </Button>
      </Box>

      <Divider sx={{ my: 3 }} />

      <Box>
        <Typography variant="h6" gutterBottom>
          データのインポート
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          エクスポートされた形式のJSONファイルを選択して、データをデータベースに追加します。既存のデータと重複する場合（例：同じメールアドレスのユーザー）はスキップされます。
        </Typography>
        <Button
          variant="outlined"
          startIcon={<FileUploadIcon />}
          onClick={handleOpenImportDialog}
          disabled={isLoading}
        >
          ファイルを選択してインポート
        </Button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".json"
          style={{ display: 'none' }}
        />
      </Box>

       {/* インポート結果表示 */}
        {importSummary && !isLoading && (
            <Box sx={{ mt: 4 }}>
                <Typography variant="h6" gutterBottom>インポート結果</Typography>
                <List dense>
                    {Object.entries(importSummary).map(([key, value]) => (
                        typeof value === 'number' && // サマリの数値のみ表示
                        <ListItem key={key}>
                            <ListItemIcon sx={{minWidth: '40px'}}>
                                {getIconForDataType(key)}
                            </ListItemIcon>
                            <ListItemText primary={`${key.charAt(0).toUpperCase() + key.slice(1)}: ${value} 件`} />
                        </ListItem>
                    ))}
                </List>
            </Box>
        )}

        {importErrors.length > 0 && !isLoading && (
            <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle1" color="error" gutterBottom>インポートエラー詳細 ({importErrors.length}件)</Typography>
                <List dense sx={{ maxHeight: 200, overflow: 'auto', border: '1px solid #ccc', borderRadius: '4px', p:1, backgroundColor: '#f9f9f9' }}>
                    {importErrors.map((errorMsg, index) => (
                        <ListItem key={index}>
                            <ListItemIcon sx={{minWidth: '30px', color: 'error.main'}}>
                                <ErrorIcon fontSize="small" />
                            </ListItemIcon>
                            <ListItemText primary={errorMsg} primaryTypographyProps={{ variant: 'body2', color: 'text.secondary' }}/>
                        </ListItem>
                    ))}
                </List>
            </Box>
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
    </Paper>
  );
};

export default MockDataConsole; 