import React, { useState, useEffect } from 'react';
import { 
  Box, Typography, Button, CircularProgress, Paper, 
  IconButton, Avatar, Dialog, DialogTitle, DialogContent, DialogActions, 
  TextField, FormControl, InputLabel, Select, MenuItem, Snackbar, Alert, Card, 
  CardContent, CardHeader, Collapse, Chip, Divider, Grid, Badge
} from '@mui/material';
import { User, Task, Project } from '../types';
import api from '../services/api';
import { 
  Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon, 
  ExpandMore as ExpandMoreIcon, Assignment as AssignmentIcon,
  Person as PersonIcon, Work as WorkIcon
} from '@mui/icons-material';
import UserAddModal, { NewUserData } from '../components/UserAddModal';
import { SelectChangeEvent } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';

interface EditUserData {
  id: string;
  username: string;
  full_name: string;
  email: string;
  role: string;
}

interface UserTaskInfo {
  userId: number;
  tasks: Task[];
  tasksByProject: Record<number, Task[]>;
  projectNames: Record<number, string>;
  totalTasks: number;
}

const UserManagementPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';

  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [userTaskInfo, setUserTaskInfo] = useState<Record<number, UserTaskInfo>>({});
  const [expandedUsers, setExpandedUsers] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [currentEditUser, setCurrentEditUser] = useState<EditUserData | null>(null);
  const [snackbar, setSnackbar] = useState<{open: boolean, message: string, severity: 'success' | 'error'}>({
    open: false,
    message: '',
    severity: 'success'
  });

  useEffect(() => {
    fetchAllData();
  }, []);

  useEffect(() => {
    if (users.length > 0 && tasks.length > 0 && projects.length > 0) {
      processUserTaskInfo();
    }
  }, [users, tasks, projects]);

  const fetchAllData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersResponse, tasksResponse, projectsResponse] = await Promise.all([
        api.get<User[]>('/api/users'),
        api.get<Task[]>('/tasks'),
        api.get<Project[]>('/projects')
      ]);
      setUsers(usersResponse.data);
      setTasks(tasksResponse.data);
      setProjects(projectsResponse.data);
    } catch (err) {
      console.error("Error fetching data:", err);
      setError('データの取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  const processUserTaskInfo = () => {
    const projectMap = new Map<number, string>();
    const completedProjectIds = new Set<number>();
    projects.forEach(project => {
      projectMap.set(project.id, project.name);
      const status = (project.status || '').toLowerCase();
      if (status === 'completed' || status === '完了') {
        completedProjectIds.add(project.id);
      }
    });

    const isTaskCompleted = (task: Task): boolean => {
      const status = (task.status || '').toLowerCase();
      return status === 'completed' || status === '完了';
    };

    const infoMap: Record<number, UserTaskInfo> = {};

    // 全ユーザーを初期化
    users.forEach(user => {
      infoMap[user.id] = {
        userId: user.id,
        tasks: [],
        tasksByProject: {},
        projectNames: {},
        totalTasks: 0
      };
    });

    // タスクをユーザーごとにグループ化（完了タスク・完了プロジェクトのタスクは含めない）
    tasks.forEach(task => {
      if (task.assigned_to && task.display_status === 'online') {
        if (isTaskCompleted(task)) return;
        const projectId = task.project_id ?? 0;
        if (projectId !== 0 && completedProjectIds.has(projectId)) return;

        const userId = task.assigned_to;
        if (!infoMap[userId]) {
          infoMap[userId] = {
            userId,
            tasks: [],
            tasksByProject: {},
            projectNames: {},
            totalTasks: 0
          };
        }

        infoMap[userId].tasks.push(task);
        infoMap[userId].totalTasks++;

        if (!infoMap[userId].tasksByProject[projectId]) {
          infoMap[userId].tasksByProject[projectId] = [];
        }
        infoMap[userId].tasksByProject[projectId].push(task);

        if (projectId && projectMap.has(projectId)) {
          infoMap[userId].projectNames[projectId] = projectMap.get(projectId)!;
        } else if (projectId === 0 || !projectId) {
          infoMap[userId].projectNames[0] = 'プロジェクト未設定';
        }
      }
    });

    setUserTaskInfo(infoMap);
  };

  const handleToggleUserExpansion = (userId: number) => {
    setExpandedUsers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };

  // カレンダー・タスクページと同一のタスクステータス色（ヘックス）
  const getTaskStatusColor = (status?: string | null): string => {
    const s = (status ?? '').toLowerCase();
    switch (s) {
      case 'todo':
      case '未着手':
        return '#2196F3';
      case 'in-progress':
      case 'in_progress':
      case '進行中':
        return '#FF9800';
      case 'review':
      case 'レビュー中':
        return '#9C27B0';
      case 'delayed':
      case '遅延':
        return '#F44336';
      case 'completed':
      case '完了':
        return '#4CAF50';
      default:
        return '#BDBDBD';
    }
  };

  const getPriorityColor = (priority?: string | null) => {
    switch (priority?.toLowerCase()) {
      case 'high':
      case '高':
        return 'error';
      case 'medium':
      case '中':
        return 'warning';
      case 'low':
      case '低':
        return 'info';
      default:
        return 'default';
    }
  };

  const handleAddUserClick = () => {
    setIsAddModalOpen(true);
  };

  const handleCloseAddModal = () => {
    setIsAddModalOpen(false);
  };

  const handleSaveNewUser = async (newUserData: NewUserData): Promise<void> => {
    console.log("Saving new user:", newUserData);
    try {
      const response = await api.post<User>('/api/users', newUserData);
      const createdUser = response.data;
      
      setUsers(prevUsers => [...prevUsers, createdUser]);
      setSnackbar({
        open: true,
        message: 'ユーザーが正常に追加されました',
        severity: 'success'
      });
      // データを再取得してタスク情報を更新
      await fetchAllData();
      
      return;
    } catch (error) {
      console.error("Failed to save new user:", error);
      setSnackbar({
        open: true,
        message: 'ユーザーの追加に失敗しました',
        severity: 'error'
      });
    }
  };

  const handleEditUserClick = (user: User) => {
    setCurrentEditUser({
      id: String(user.id),
      username: user.username || '',
      full_name: user.full_name || '',
      email: user.email || '',
      role: user.role || 'user'
    });
    setIsEditModalOpen(true);
  };

  const handleCloseEditModal = () => {
    setIsEditModalOpen(false);
    setCurrentEditUser(null);
  };

  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | { name?: string; value: unknown }> | SelectChangeEvent<string>) => {
    const { name, value } = e.target;
    if (currentEditUser && name) {
      setCurrentEditUser({
        ...currentEditUser,
        [name]: value
      });
    }
  };

  const handleSaveEditUser = async () => {
    if (!currentEditUser) return;
    
    try {
      const response = await api.put<User>(`/api/users/${currentEditUser.id}`, currentEditUser);
      const updatedUser = response.data;
      
      setUsers(prevUsers => 
        prevUsers.map(user => 
          user.id === updatedUser.id ? updatedUser : user
        )
      );
      // データを再取得してタスク情報を更新
      await fetchAllData();
      
      setSnackbar({
        open: true,
        message: 'ユーザー情報が正常に更新されました',
        severity: 'success'
      });
      
      handleCloseEditModal();
    } catch (error) {
      console.error("Failed to update user:", error);
      setSnackbar({
        open: true,
        message: 'ユーザー情報の更新に失敗しました',
        severity: 'error'
      });
    }
  };

  const handleDeleteUserClick = async (userId: string, userName: string = '') => {
    if (window.confirm(`${userName}さんを本当に削除しますか？`)) {
      try {
        await api.delete(`/api/users/${userId}`);
        setUsers(prevUsers => prevUsers.filter(user => String(user.id) !== userId));
        // データを再取得してタスク情報を更新
        await fetchAllData();
        setSnackbar({
          open: true,
          message: 'ユーザーが正常に削除されました',
          severity: 'success'
        });
      } catch (err) {
        console.error(`Error deleting user ${userId}:`, err);
        setSnackbar({
          open: true,
          message: 'ユーザーの削除に失敗しました',
          severity: 'error'
        });
      }
    }
  };

  const handleCloseSnackbar = () => {
    setSnackbar({...snackbar, open: false});
  };

  const usersWithTasks = users.filter(user => {
    const info = userTaskInfo[user.id];
    return info && info.totalTasks > 0;
  });

  const usersWithoutTasks = users.filter(user => {
    const info = userTaskInfo[user.id];
    return !info || info.totalTasks === 0;
  });

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" component="div" sx={{ fontWeight: 'bold' }}>
          ユーザー
        </Typography>
        {isAdmin && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAddUserClick}
          >
            ユーザー追加
          </Button>
        )}
      </Box>

      {loading && <CircularProgress sx={{ display: 'block', margin: 'auto', my: 4 }} />}
      {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}

      {!loading && !error && (
        <Grid container spacing={3}>
          {/* タスクを持っているユーザー */}
          {usersWithTasks.length > 0 && (
            <Grid item xs={12}>
              <Paper sx={{ p: 2, mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <AssignmentIcon sx={{ mr: 1, color: 'primary.main' }} />
                  <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                    タスク担当者 ({usersWithTasks.length}名)
                  </Typography>
                </Box>
                <Grid container spacing={2}>
                  {usersWithTasks.map((user) => {
                    const info = userTaskInfo[user.id];
                    const isExpanded = expandedUsers.has(user.id);
                    
                    return (
                      <Grid item xs={12} key={user.id}>
                        <Card variant="outlined">
                          <CardHeader
                            avatar={
                              <Badge 
                                badgeContent={info?.totalTasks || 0} 
                                color="primary"
                                overlap="circular"
                              >
                                <Avatar src={user.iconUrl} alt={user.name || user.username || ''}>
                                  {user.iconUrl ? null : (user.name || user.username || '')?.[0]?.toUpperCase()}
                                </Avatar>
                              </Badge>
                            }
                            title={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="h6">{user.name || user.username}</Typography>
                                {user.role === 'admin' && (
                                  <Chip label="管理者" size="small" color="secondary" />
                                )}
                              </Box>
                            }
                            subheader={
                              <Box sx={{ mt: 0.5 }}>
                                <Typography variant="body2" color="text.secondary">
                                  {user.email || 'メール未設定'}
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                                  <Chip 
                                    icon={<WorkIcon />} 
                                    label={`${info?.totalTasks || 0}件のタスク`} 
                                    size="small" 
                                    color="primary"
                                    variant="outlined"
                                  />
                                  <Chip 
                                    icon={<AssignmentIcon />} 
                                    label={`${Object.keys(info?.tasksByProject || {}).length}プロジェクト`} 
                                    size="small" 
                                    color="secondary"
                                    variant="outlined"
                                  />
                                </Box>
                              </Box>
                            }
                            action={
                              <Box>
                                <IconButton 
                                  onClick={() => handleToggleUserExpansion(user.id)}
                                  sx={{ mr: 1 }}
                                >
                                  <ExpandMoreIcon 
                                    sx={{ 
                                      transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                      transition: 'transform 0.3s'
                                    }} 
                                  />
                                </IconButton>
                                {isAdmin && (
                                  <>
                                    <IconButton 
                                      edge="end" 
                                      aria-label="edit" 
                                      onClick={() => handleEditUserClick(user)}
                                    >
                                      <EditIcon />
                                    </IconButton>
                                    <IconButton 
                                      edge="end" 
                                      aria-label="delete" 
                                      onClick={() => handleDeleteUserClick(String(user.id), user.name || user.username || '')}
                                    >
                                      <DeleteIcon />
                                    </IconButton>
                                  </>
                                )}
                              </Box>
                            }
                          />
                          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                            <CardContent>
                              <Divider sx={{ mb: 2 }} />
                              {info && Object.keys(info.tasksByProject).length > 0 ? (
                                Object.entries(info.tasksByProject).map(([projectId, projectTasks]) => (
                                  <Box key={projectId} sx={{ mb: 3 }}>
                                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1, color: 'primary.main' }}>
                                      📁 {info.projectNames[Number(projectId)] || `プロジェクトID: ${projectId}`}
                                      <Chip 
                                        label={`${projectTasks.length}件`} 
                                        size="small" 
                                        sx={{ ml: 1 }} 
                                      />
                                    </Typography>
                                    <Grid container spacing={1}>
                                      {projectTasks.map((task) => (
                                        <Grid item xs={12} sm={6} md={4} key={task.id}>
                                          <Card variant="outlined" sx={{ p: 1.5, height: '100%' }}>
                                            <Typography variant="body2" sx={{ fontWeight: 'medium', mb: 1 }}>
                                              {task.name}
                                            </Typography>
                                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                              {task.status && (
                                                <Chip
                                                  label={task.status}
                                                  size="small"
                                                  sx={{
                                                    backgroundColor: getTaskStatusColor(task.status),
                                                    color: '#fff',
                                                  }}
                                                />
                                              )}
                                              {task.priority && (
                                                <Chip 
                                                  label={`優先度: ${task.priority}`} 
                                                  size="small" 
                                                  color={getPriorityColor(task.priority) as any}
                                                  variant="outlined"
                                                />
                                              )}
                                              {task.due_date && (
                                                <Chip 
                                                  label={`期日: ${new Date(task.due_date).toLocaleDateString('ja-JP')}`} 
                                                  size="small" 
                                                  variant="outlined"
                                                />
                                              )}
                                            </Box>
                                          </Card>
                                        </Grid>
                                      ))}
                                    </Grid>
                                  </Box>
                                ))
                              ) : (
                                <Typography variant="body2" color="text.secondary">
                                  タスク情報がありません
                                </Typography>
                              )}
                            </CardContent>
                          </Collapse>
                        </Card>
                      </Grid>
                    );
                  })}
                </Grid>
              </Paper>
            </Grid>
          )}

          {/* タスクを持っていないユーザー */}
          {usersWithoutTasks.length > 0 && (
            <Grid item xs={12}>
              <Paper sx={{ p: 2, bgcolor: 'grey.50' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <PersonIcon sx={{ mr: 1, color: 'text.secondary' }} />
                  <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>
                    タスク未担当 ({usersWithoutTasks.length}名)
                  </Typography>
                </Box>
                <Grid container spacing={2}>
                  {usersWithoutTasks.map((user) => (
                    <Grid item xs={12} sm={6} md={4} key={user.id}>
                      <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
                        <CardContent>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Avatar src={user.iconUrl} alt={user.name || user.username || ''}>
                              {user.iconUrl ? null : (user.name || user.username || '')?.[0]?.toUpperCase()}
                            </Avatar>
                            <Box sx={{ flex: 1 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                                  {user.name || user.username}
                                </Typography>
                                {user.role === 'admin' && (
                                  <Chip label="管理者" size="small" color="secondary" />
                                )}
                              </Box>
                              <Typography variant="body2" color="text.secondary">
                                {user.email || 'メール未設定'}
                              </Typography>
                            </Box>
                            {isAdmin && (
                              <Box>
                                <IconButton 
                                  size="small"
                                  edge="end" 
                                  aria-label="edit" 
                                  onClick={() => handleEditUserClick(user)}
                                >
                                  <EditIcon fontSize="small" />
                                </IconButton>
                                <IconButton 
                                  size="small"
                                  edge="end" 
                                  aria-label="delete" 
                                  onClick={() => handleDeleteUserClick(String(user.id), user.name || user.username || '')}
                                >
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </Box>
                            )}
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              </Paper>
            </Grid>
          )}

          {users.length === 0 && (
            <Grid item xs={12}>
              <Paper sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="body1" color="text.secondary">
                  登録されているユーザーはいません。
                </Typography>
              </Paper>
            </Grid>
          )}
        </Grid>
      )}

      {isAdmin && (
        <UserAddModal 
          open={isAddModalOpen}
          onClose={handleCloseAddModal}
          onSave={handleSaveNewUser}
        />
      )}

      {/* ユーザー編集モーダル（管理者のみ） */}
      {isAdmin && (
      <Dialog open={isEditModalOpen} onClose={handleCloseEditModal} maxWidth="sm" fullWidth>
        <DialogTitle>ユーザー情報の編集</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="ユーザーID"
              name="username"
              value={currentEditUser?.username || ''}
              onChange={handleEditChange}
              fullWidth
            />
            <TextField
              label="氏名"
              name="full_name"
              value={currentEditUser?.full_name || ''}
              onChange={handleEditChange}
              fullWidth
            />
            <TextField
              label="メールアドレス"
              name="email"
              value={currentEditUser?.email || ''}
              onChange={handleEditChange}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>役割</InputLabel>
              <Select
                name="role"
                value={currentEditUser?.role || 'user'}
                onChange={handleEditChange}
                label="役割"
              >
                <MenuItem value="user">一般ユーザー</MenuItem>
                <MenuItem value="admin">管理者</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseEditModal}>キャンセル</Button>
          <Button onClick={handleSaveEditUser} variant="contained" color="primary">
            保存
          </Button>
        </DialogActions>
      </Dialog>
      )}

      {/* 操作結果の通知 */}
      <Snackbar 
        open={snackbar.open} 
        autoHideDuration={5000} 
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={handleCloseSnackbar} 
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default UserManagementPage;
