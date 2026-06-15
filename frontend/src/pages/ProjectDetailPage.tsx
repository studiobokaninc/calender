import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Typography, Paper, Grid, CircularProgress, Alert, Breadcrumbs, Link, Chip, List, ListItem, ListItemText, Avatar, Divider, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Snackbar } from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom'; // 名前衝突を避ける
import api from '../services/api';
import { Project, Task, User, Group } from '../types'; // 必要な型をインポート

// ステータスごとの進捗率マップ
const progressMap: { [key: string]: number } = {
  todo: 0,
  'in-progress': 40,
  review: 70,
  completed: 100,
};

const ProjectDetailPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]); // ★ 全ユーザーリスト用の state
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // ★ グループ作成ダイアログ用の state を追加
  const [isGroupCreateDialogOpen, setIsGroupCreateDialogOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  // ★ Snackbar 用の state を追加 (フィードバック用)
  const [snackbar, setSnackbar] = useState<{ open: boolean, message: string, severity: 'success' | 'error' | 'info' | 'warning' }>({
    open: false,
    message: '',
    severity: 'info',
  });

  useEffect(() => {
    const fetchProjectData = async () => {
      if (!projectId) {
        setError('プロジェクトIDが見つかりません。');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        console.log(`Fetching data for project ID: ${projectId}`);
        // ★ 全ユーザーリストも並行して取得
        const [projectRes, tasksRes, usersRes] = await Promise.all([
          api.get<Project>(`/projects/${projectId}`),
          api.get<Task[]>(`/tasks?project_id=${projectId}`),
          api.get<User[]>('/users'), // Fix: /api/users -> /users (baseURL is /api)
        ]);
        console.log("Fetched Project:", projectRes.data);
        console.log("Fetched Tasks:", tasksRes.data);
        console.log("Fetched Users:", usersRes.data); // ★ ログ追加
        setProject(projectRes.data);
        setTasks(tasksRes.data);
        setAllUsers(usersRes.data); // ★ state を更新
      } catch (err: any) {
        console.error(`Failed to fetch data for project ${projectId}: `, err);
        setError('プロジェクトデータの取得に失敗しました。' + (err.response?.data?.detail || err.message || ''));
      } finally {
        setLoading(false);
      }
    };

    fetchProjectData();
  }, [projectId]); // projectId が変更されたら再取得

  // --- メトリクス計算 (useMemoで効率化) ---
  const totalTasks = useMemo(() => tasks.length, [tasks]);

  const totalCost = useMemo(() => {
    return tasks.reduce((sum, task) => sum + (Number(task.cost) || 0), 0);
  }, [tasks]);

  const progressPercentage = useMemo(() => {
    if (totalCost === 0) return 0; // 0除算を防ぐ

    const weightedCompletedCost = tasks.reduce((sum, task) => {
      const cost = Number(task.cost) || 0;
      // status が null や undefined の場合のデフォルト値を 'todo' とする
      const statusKey = task.status || 'todo';
      const progress = progressMap[statusKey] || 0; // ステータスに対応する進捗率を取得 (存在しないキーの場合は0)
      return sum + cost * (progress / 100); // コストに進捗率を掛けて加算
    }, 0);

    return Math.round((weightedCompletedCost / totalCost) * 100); // パーセンテージ計算
  }, [tasks, totalCost]);

  // ★★★ プロジェクトに関与するユーザーリストを計算 ★★★
  const involvedUsers = useMemo(() => {
    const assigneeIds = new Set<number>();
    tasks.forEach(task => {
      // ★ null と undefined をチェック
      if (task.assigned_to !== null && task.assigned_to !== undefined) {
        assigneeIds.add(Number(task.assigned_to)); // Number に変換
      }
    });
    // Set から配列に変換
    const uniqueAssigneeIds = Array.from(assigneeIds);
    // allUsers から該当するユーザーをフィルタリング
    return allUsers.filter(user => uniqueAssigneeIds.includes(user.id));
  }, [tasks, allUsers]);

  // ★★★ ダイアログ開閉ハンドラ ★★★
  const handleOpenGroupCreateDialog = () => {
    setNewGroupName(''); // 名前をリセット
    setIsGroupCreateDialogOpen(true);
  };

  const handleCloseGroupCreateDialog = () => {
    setIsGroupCreateDialogOpen(false);
  };

  // ★★★ グループ名入力ハンドラ ★★★
  const handleNewGroupNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setNewGroupName(event.target.value);
  };

  // ★★★ Snackbar クローズハンドラ ★★★
  const handleCloseSnackbar = (_event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return;
    }
    setSnackbar({ ...snackbar, open: false });
  };

  // ★★★ グループ作成処理 API ロジック実装 ★★★
  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      setSnackbar({ open: true, message: 'グループ名を入力してください', severity: 'warning' });
      return;
    }
    if (involvedUsers.length === 0) {
      setSnackbar({ open: true, message: 'グループに追加するメンバーがいません', severity: 'warning' });
      return;
    }

    console.log(`Creating group "${newGroupName}" with users: `, involvedUsers.map(u => u.id));

    try {
      setLoading(true);

      // 1. グループ作成 API 呼び出し
      const groupCreateData = { name: newGroupName.trim() };
      const groupResponse = await api.post<Group>('/groups', groupCreateData); // Fix: /api/groups -> /groups
      const newGroupId = groupResponse.data.id;
      console.log("Group created successfully, ID:", newGroupId);

      // 2. ユーザーをグループに追加 API 呼び出し (Promise.all で並行処理)
      const addUserPromises = involvedUsers.map(user => {
        // ★ 文字列変換 String() を削除し、整数で送信 ★
        const userGroupData = { user_id: user.id, group_id: newGroupId };
        return api.post('/user_groups', userGroupData); // Fix: /api/user_groups -> /user_groups
      });

      await Promise.all(addUserPromises);
      console.log("Users added to group successfully.");

      setSnackbar({ open: true, message: `グループ「${newGroupName}」が作成されました`, severity: 'success' });
      handleCloseGroupCreateDialog();

    } catch (err: any) {
      console.error("Failed to create group or add users:", err);
      const errorDetail = err.response?.data?.detail || err.message || '不明なエラーが発生しました';
      setSnackbar({ open: true, message: `グループ作成に失敗しました: ${errorDetail} `, severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // --- レンダリング ---
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!project) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">プロジェクトデータが見つかりません。</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* パンくずリスト */}
      <Breadcrumbs aria-label="breadcrumb" sx={{ mb: 2 }}>
        <Link component={RouterLink} to="/" color="inherit">
          ホーム
        </Link>
        <Link component={RouterLink} to="/projects" color="inherit">
          プロジェクト一覧
        </Link>
        <Typography color="text.primary">{project.name}</Typography>
      </Breadcrumbs>

      {/* プロジェクト情報 */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Typography variant="h5" gutterBottom>
              {project.name}
            </Typography>
            <Typography variant="body1" color="text.secondary" paragraph>
              {project.description}
            </Typography>
          </Grid>

          {/* プロジェクトの日付情報を追加 */}
          <Grid item xs={12} sm={6}>
            <Typography variant="subtitle2" color="text.secondary">
              開始日
            </Typography>
            <Typography variant="body1">
              {project.start_date ? new Date(project.start_date).toLocaleDateString('ja-JP') : '未設定'}
            </Typography>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Typography variant="subtitle2" color="text.secondary">
              終了日
            </Typography>
            <Typography variant="body1">
              {project.end_date ? new Date(project.end_date).toLocaleDateString('ja-JP') : '未設定'}
            </Typography>
          </Grid>

          <Grid item xs={12}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <Chip
                label={`進捗: ${progressPercentage}% `}
                color={progressPercentage === 100 ? 'success' : 'primary'}
              />
              <Chip label={`タスク数: ${totalTasks} `} />
              <Chip label={`総コスト: ${totalCost.toLocaleString()} 円`} />
              <Button
                variant="outlined"
                size="small"
                onClick={() => navigate(`/projects/${projectId}/shotlist`)}
              >
                ショットリスト
              </Button>
            </Box>
          </Grid>
        </Grid>
      </Paper>

      {/* メトリクス表示 */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h6">{totalTasks}</Typography>
            <Typography variant="body2" color="text.secondary">総タスク数</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            {/* toLocaleString で桁区切りと小数点表示を調整 */}
            <Typography variant="h6">{totalCost.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</Typography>
            <Typography variant="body2" color="text.secondary">総コスト</Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="h6">{progressPercentage}%</Typography>
            <Typography variant="body2" color="text.secondary">進捗率 (コストベース)</Typography>
            {/* ここに進捗バー (LinearProgress) を追加すると視覚的に分かりやすい */}
          </Paper>
        </Grid>
      </Grid>

      {/* ★★★ 詳細情報エリア (タスクリストとユーザーリスト) ★★★ */}
      <Grid container spacing={3}>
        {/* 左側: タスクリスト (将来) */}
        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" gutterBottom>タスク詳細 (実装予定)</Typography>
            {/* <TaskList tasks={tasks} /> など */}
          </Paper>
        </Grid>

        {/* 右側: 関連メンバーリスト */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, height: '100%' }}>
            <Typography variant="h6" gutterBottom>
              関連メンバー ({involvedUsers.length})
            </Typography>
            <Divider sx={{ mb: 1 }} />
            {involvedUsers.length > 0 ? (
              <List dense disablePadding>
                {involvedUsers.map(user => (
                  <ListItem key={user.id} disableGutters>
                    <Avatar sx={{ width: 24, height: 24, mr: 1, fontSize: '0.8rem' }}>
                      {/* ★ user.name が存在するかチェック */}
                      {user.name ? user.name.charAt(0).toUpperCase() : '-'}
                    </Avatar>
                    <ListItemText
                      // ★ user.name がなければ email を表示
                      primary={user.name || user.email}
                      primaryTypographyProps={{ variant: 'body2' }}
                    />
                  </ListItem>
                ))}
              </List>
            ) : (
              <Typography variant="body2" color="text.secondary">
                関連するメンバーはいません。
              </Typography>
            )}
            {/* ★ グループ作成ボタンを追加 (メンバーがいる場合のみ表示) ★ */}
            {involvedUsers.length > 0 && (
              <Button
                variant="outlined"
                size="small"
                sx={{ mt: 2 }}
                onClick={handleOpenGroupCreateDialog} // ★ ハンドラを設定
              >
                このメンバーでグループ作成
              </Button>
            )}
          </Paper>
        </Grid>
      </Grid>

      {/* ★★★ グループ作成ダイアログ ★★★ */}
      <Dialog open={isGroupCreateDialogOpen} onClose={handleCloseGroupCreateDialog} maxWidth="xs" fullWidth>
        <DialogTitle>新規グループ作成</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            id="group-name"
            label="グループ名"
            type="text"
            fullWidth
            variant="standard"
            value={newGroupName}
            onChange={handleNewGroupNameChange}
            sx={{ mb: 2 }}
          />
          <Typography variant="body2" gutterBottom>
            以下のメンバーが含まれます ({involvedUsers.length}名):
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {involvedUsers.map(user => (
              <Chip key={user.id} label={user.name || user.email} size="small" />
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseGroupCreateDialog}>キャンセル</Button>
          {/* ★ 作成処理ハンドラを設定 */}
          <Button onClick={handleCreateGroup} variant="contained">作成</Button>
        </DialogActions>
      </Dialog>

      {/* 議事録管理ページへのリンク（オプション）を入れても良いが、一旦削除 */}

      {/* ★★★ Snackbar (フィードバック用) ★★★ */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>

    </Box>
  );
};

export default ProjectDetailPage; 