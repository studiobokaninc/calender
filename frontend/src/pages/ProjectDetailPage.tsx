import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Grid,
  CircularProgress,
  Alert,
  Breadcrumbs,
  Link,
  Chip,
  Avatar,
  Divider,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Snackbar,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
  useTheme,
  LinearProgress,
  InputAdornment,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Stack,
  Card,
  CardContent,
  alpha,
  Drawer
} from '@mui/material';
import {
  Search as SearchIcon,
  Add as AddIcon,
  Refresh as RefreshIcon,
  Person as PersonIcon,
  CalendarToday as CalendarIcon,
  FormatListBulleted as ShotListIcon,
  Edit as EditIcon,
  Group as GroupIcon,
  Warning as WarningIcon,
  AssignmentTurnedIn as CompletedIcon,
  ArrowBack as ArrowBackIcon,
  AccessTime as TimeIcon,
  AttachMoney as CostIcon,
  Close as CloseIcon
} from '@mui/icons-material';
import api, { fetchUsers, fetchProjectRoles, createScoreUserRole, updateScoreUserRole, deleteScoreUserRole } from '../services/api';
import { Project, Task, User, Group } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { usePageState } from '../contexts/PageStateContext';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { TaskQuickDetail } from '../components/TaskQuickDetail';
import { TaskEditDialog } from '../components/SearchEditDialogs';
import { TaskLabel } from '../components/common/TaskLabel';
import { getTaskColor } from '../utils/calendarEventColors';
import { TASK_STATUS_OPTIONS } from '../utils/taskStatus';

const progressMap: { [key: string]: number } = {
  todo: 0,
  'in-progress': 40,
  review: 70,
  completed: 100,
  approved: 100,
  delayed: 40,
  retake: 40,
};

const ProjectDetailPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { refreshGlobalData } = usePageState();

  // Data States
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [director, setDirector] = useState<User | null>(null);
  const [pm, setPm] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Tab State
  const [tabValue, setTabValue] = useState<number>(0);

  // Filter & Search States
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');

  // Task Action States
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<Task | null>(null);
  const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false);
  const [editTaskId, setEditTaskId] = useState<number | null>(null);

  // Group Dialog States
  const [isGroupCreateDialogOpen, setIsGroupCreateDialogOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  // Feedback State
  const [snackbar, setSnackbar] = useState<{ open: boolean, message: string, severity: 'success' | 'error' | 'info' | 'warning' }>({
    open: false,
    message: '',
    severity: 'info',
  });

  const fetchProjectData = useCallback(async () => {
    if (!projectId) {
      setError('プロジェクトIDが見つかりません。');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const pId = Number(projectId);
      const [projectRes, tasksRes, usersRes, rolesRes] = await Promise.all([
        api.get<Project>(`/projects/${projectId}`),
        api.get<Task[]>(`/tasks?project_id=${projectId}`),
        api.get<User[]>('/users'),
        fetchProjectRoles(pId).catch(() => []),
      ]);

      setProject(projectRes.data);
      setTasks(tasksRes.data);

      const allUsersData = usersRes.data || usersRes;
      setAllUsers(allUsersData);

      const roles = rolesRes || [];
      const dirRole = roles.find((r: any) => r.role === 'director');
      const pmRole = roles.find((r: any) => r.role === 'pm');

      if (dirRole) {
        const u = allUsersData.find((x: any) => x.id === dirRole.user_id);
        setDirector(u || null);
      } else {
        setDirector(null);
      }
      if (pmRole) {
        const u = allUsersData.find((x: any) => x.id === pmRole.user_id);
        setPm(u || null);
      } else {
        setPm(null);
      }
    } catch (err: any) {
      console.error(`Failed to fetch data for project ${projectId}: `, err);
      setError('プロジェクトデータの取得に失敗しました。' + (err.response?.data?.detail || err.message || ''));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProjectData();
  }, [fetchProjectData]);

  // Calculations
  const totalTasks = useMemo(() => tasks.length, [tasks]);

  const totalCost = useMemo(() => {
    return tasks.reduce((sum, task) => sum + (Number(task.cost) || 0), 0);
  }, [tasks]);

  const progressPercentage = useMemo(() => {
    if (totalCost === 0) return 0;
    const weightedCompletedCost = tasks.reduce((sum, task) => {
      const cost = Number(task.cost) || 0;
      const statusKey = (task.status || 'todo').toLowerCase();
      const progress = progressMap[statusKey] || 0;
      return sum + cost * (progress / 100);
    }, 0);
    return Math.round((weightedCompletedCost / totalCost) * 100);
  }, [tasks, totalCost]);

  const taskCounts = useMemo(() => {
    let todo = 0;
    let inProgress = 0;
    let delayed = 0;
    let completed = 0;

    tasks.forEach(task => {
      const status = (task.status || 'todo').toLowerCase();
      if (status === 'completed' || status === 'approved') {
        completed++;
      } else if (status === 'delayed') {
        delayed++;
      } else if (status === 'in-progress' || status === 'review' || status === 'retake') {
        inProgress++;
      } else {
        todo++;
      }
    });

    return { todo, inProgress, delayed, completed };
  }, [tasks]);

  const involvedUsers = useMemo(() => {
    const memberIds = new Set<number>();
    tasks.forEach(task => {
      if (task.assigned_to != null) {
        memberIds.add(Number(task.assigned_to));
      }
    });
    if (director) memberIds.add(director.id);
    if (pm) memberIds.add(pm.id);
    const uniqueMemberIds = Array.from(memberIds);
    return allUsers.filter(user => uniqueMemberIds.includes(user.id));
  }, [tasks, allUsers, director, pm]);

  // Filters
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      const matchSearch = searchQuery === '' ||
        task.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (task.shotID && task.shotID.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (task.seqID && task.seqID.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchStatus = statusFilter === 'all' ||
        (task.status || 'todo').toLowerCase() === statusFilter.toLowerCase();

      const matchAssignee = assigneeFilter === 'all' ||
        String(task.assigned_to) === assigneeFilter;

      return matchSearch && matchStatus && matchAssignee;
    });
  }, [tasks, searchQuery, statusFilter, assigneeFilter]);

  // Handlers
  const handleUpdateTaskQuick = async (taskId: number, updates: any) => {
    try {
      await api.put(`/tasks/${taskId}`, updates);
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
      setSelectedTaskDetail(prev => prev && prev.id === taskId ? { ...prev, ...updates } : prev);
      if (refreshGlobalData) refreshGlobalData();
    } catch (err) {
      console.error('Failed to update task:', err);
      setSnackbar({ open: true, message: 'タスクの更新に失敗しました', severity: 'error' });
    }
  };

  const handleTaskEditSuccess = async () => {
    setEditTaskId(null);
    try {
      const tasksRes = await api.get<Task[]>(`/tasks?project_id=${projectId}`);
      setTasks(tasksRes.data);
      if (refreshGlobalData) refreshGlobalData();
      setSnackbar({ open: true, message: 'タスクを更新しました', severity: 'success' });
    } catch (err) {
      console.error('Failed to reload tasks:', err);
    }
  };

  const handleOpenGroupCreateDialog = () => {
    setNewGroupName('');
    setIsGroupCreateDialogOpen(true);
  };

  const handleCloseGroupCreateDialog = () => {
    setIsGroupCreateDialogOpen(false);
  };

  const handleNewGroupNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setNewGroupName(event.target.value);
  };

  const handleCloseSnackbar = () => {
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      setSnackbar({ open: true, message: 'グループ名を入力してください', severity: 'warning' });
      return;
    }
    if (involvedUsers.length === 0) {
      setSnackbar({ open: true, message: 'グループに追加するメンバーがいません', severity: 'warning' });
      return;
    }

    try {
      setLoading(true);
      const groupResponse = await api.post<Group>('/groups', { name: newGroupName.trim() });
      const newGroupId = groupResponse.data.id;

      const addUserPromises = involvedUsers.map(user => {
        return api.post('/user_groups', { user_id: user.id, group_id: newGroupId });
      });

      await Promise.all(addUserPromises);
      setSnackbar({ open: true, message: `グループ「${newGroupName}」が作成されました`, severity: 'success' });
      setIsGroupCreateDialogOpen(false);
    } catch (err: any) {
      console.error("Failed to create group:", err);
      const errorDetail = err.response?.data?.detail || err.message || '不明なエラーが発生しました';
      setSnackbar({ open: true, message: `グループ作成に失敗しました: ${errorDetail}`, severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const getUserName = (userId: number | null | undefined): string => {
    if (userId == null) return '';
    const u = allUsers.find(x => x.id === userId);
    return u?.username || u?.full_name || u?.name || u?.email || `User ${userId}`;
  };

  const getUserAvatar = (userId: number | null | undefined) => {
    if (userId == null) return undefined;
    const u = allUsers.find(x => x.id === userId);
    if (!u) return undefined;
    return u.avatar_url || `/api/users/${u.id}/avatar`;
  };

  if (loading && !project) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!project) {
    return (
      <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
        <Alert severity="warning">プロジェクトデータが見つかりません。</Alert>
      </Box>
    );
  }

  const projectColor = project.color || theme.palette.divider;

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2, md: 3 }, maxWidth: 1600, mx: 'auto', width: '100%' }}>
      {/* Breadcrumbs */}
      <Breadcrumbs sx={{ mb: 2.5 }}>
        <Link component={RouterLink} to="/dashboard" color="inherit" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, textDecoration: 'none' }}>
          App
        </Link>
        <Link component={RouterLink} to="/projects" color="inherit" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, textDecoration: 'none' }}>
          Projects
        </Link>
        <Typography color="text.primary" sx={{ fontWeight: 600 }}>{project.name}</Typography>
      </Breadcrumbs>

      {/* Hero Header Card */}
      <Card
        elevation={2}
        sx={{
          borderRadius: 3,
          borderLeft: `6px solid ${projectColor}`,
          mb: 3,
          background: isDark
            ? `linear-gradient(135deg, ${alpha(projectColor, 0.15)} 0%, ${theme.palette.background.paper} 100%)`
            : `linear-gradient(135deg, ${alpha(projectColor, 0.08)} 0%, ${theme.palette.background.paper} 100%)`,
        }}
      >
        <CardContent sx={{ p: { xs: 2, md: 3 } }}>
          <Grid container spacing={3} alignItems="center">
            {/* Title / Description */}
            <Grid item xs={12} md={7}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
                <Typography variant="h4" sx={{ fontWeight: 800 }}>
                  {project.name}
                </Typography>
                <Chip label={project.status || 'planning'} color="primary" sx={{ fontWeight: 700, textTransform: 'uppercase' }} />
                {project.priority && (
                  <Chip label={project.priority} variant="outlined" color={project.priority === 'high' ? 'error' : 'default'} sx={{ fontWeight: 700 }} />
                )}
              </Box>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 2, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {project.description || '説明はありません。'}
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <CalendarIcon fontSize="small" color="action" />
                  <Typography variant="caption" color="text.secondary">
                    {project.start_date ? format(new Date(project.start_date), 'yyyy/MM/dd') : '-'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">～</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {project.end_date ? format(new Date(project.end_date), 'yyyy/MM/dd') : '-'}
                  </Typography>
                </Box>
              </Stack>
            </Grid>

            {/* Dir & PM Cards */}
            <Grid item xs={12} md={5}>
              <Paper elevation={0} sx={{ p: 2, borderRadius: 2, bgcolor: alpha(theme.palette.background.paper, 0.6), border: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, color: 'text.secondary' }}>プロジェクト責任者</Typography>
                <Stack spacing={1.5}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Avatar src={director ? (director.avatar_url || `/api/users/${director.id}/avatar`) : undefined} sx={{ width: 36, height: 36, bgcolor: 'primary.light' }}>
                      {!director && <PersonIcon />}
                    </Avatar>
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600, lineHeight: 1.1 }}>Director</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {director ? (director.full_name || director.username) : '未割り当て'}
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Avatar src={pm ? (pm.avatar_url || `/api/users/${pm.id}/avatar`) : undefined} sx={{ width: 36, height: 36, bgcolor: 'secondary.light' }}>
                      {!pm && <PersonIcon />}
                    </Avatar>
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600, lineHeight: 1.1 }}>Project Manager (PM)</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {pm ? (pm.full_name || pm.username) : '未割り当て'}
                      </Typography>
                    </Box>
                  </Box>
                </Stack>
              </Paper>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Metrics Row */}
      <Grid container spacing={2.5} sx={{ mb: 4 }}>
        <Grid item xs={12} md={4}>
          <Paper elevation={2} sx={{ p: 2.5, borderRadius: 2.5, display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', borderLeft: `4px solid ${theme.palette.primary.main}` }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 700 }}>コストベース進捗率</Typography>
              <Typography variant="h5" sx={{ fontWeight: 800, color: theme.palette.primary.main }}>{progressPercentage}%</Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={progressPercentage}
              sx={{
                height: 10,
                borderRadius: 5,
                backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                '& .MuiLinearProgress-bar': {
                  borderRadius: 5,
                  background: `linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.primary.light})`
                }
              }}
            />
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper elevation={2} sx={{ p: 2.5, borderRadius: 2.5, display: 'flex', alignItems: 'center', gap: 2, height: '100%' }}>
            <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: alpha(theme.palette.info.main, 0.1), color: 'info.main' }}>
              <TimeIcon sx={{ fontSize: 28 }} />
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 700 }}>総コスト（時間）</Typography>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                {totalCost.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} <span style={{ fontSize: '1rem', fontWeight: 600 }}>時間</span>
              </Typography>
            </Box>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper elevation={2} sx={{ p: 2, borderRadius: 2.5, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 700, mb: 1 }}>タスク状況内訳 ({totalTasks}件)</Typography>
            <Stack direction="row" spacing={1}>
              <Box sx={{ px: 1, py: 0.5, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', flex: 1, textAlign: 'center', bgcolor: taskCounts.todo > 0 ? (isDark ? 'rgba(156, 39, 176, 0.15)' : 'rgba(156, 39, 176, 0.05)') : 'transparent' }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'secondary.main', display: 'block', fontSize: '0.7rem' }}>未着手</Typography>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>{taskCounts.todo}</Typography>
              </Box>
              <Box sx={{ px: 1, py: 0.5, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', flex: 1, textAlign: 'center', bgcolor: taskCounts.inProgress > 0 ? (isDark ? 'rgba(33, 150, 243, 0.15)' : 'rgba(33, 150, 243, 0.05)') : 'transparent' }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.main', display: 'block', fontSize: '0.7rem' }}>進行中</Typography>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>{taskCounts.inProgress}</Typography>
              </Box>
              <Box sx={{ px: 1, py: 0.5, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', flex: 1, textAlign: 'center', bgcolor: taskCounts.delayed > 0 ? (isDark ? 'rgba(244, 67, 54, 0.15)' : 'rgba(244, 67, 54, 0.05)') : 'transparent' }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'error.main', display: 'block', fontSize: '0.7rem' }}>遅延中</Typography>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>{taskCounts.delayed}</Typography>
              </Box>
              <Box sx={{ px: 1, py: 0.5, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', flex: 1, textAlign: 'center', bgcolor: taskCounts.completed > 0 ? (isDark ? 'rgba(76, 175, 80, 0.15)' : 'rgba(76, 175, 80, 0.05)') : 'transparent' }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'success.main', display: 'block', fontSize: '0.7rem' }}>完了</Typography>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>{taskCounts.completed}</Typography>
              </Box>
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tabValue} onChange={(_, val) => setTabValue(val)} sx={{ '& .MuiTab-root': { fontWeight: 700, fontSize: '0.95rem', textTransform: 'none' } }}>
          <Tab icon={<ShotListIcon />} iconPosition="start" label={`タスク一覧 (${filteredTasks.length})`} />
          <Tab icon={<GroupIcon />} iconPosition="start" label={`メンバー・グループ (${involvedUsers.length})`} />
        </Tabs>
      </Box>

      {/* Tab Panel 0: Tasks List */}
      {tabValue === 0 && (
        <Box>
          {/* Filters Bar */}
          <Paper elevation={1} sx={{ p: 2, mb: 3, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="タスク名、SHOT ID、SEQ IDで検索..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon color="action" fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>ステータス</InputLabel>
                  <Select
                    value={statusFilter}
                    label="ステータス"
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <MenuItem value="all">すべてのステータス</MenuItem>
                    {TASK_STATUS_OPTIONS.map(opt => (
                      <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={6} sm={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>担当者</InputLabel>
                  <Select
                    value={assigneeFilter}
                    label="担当者"
                    onChange={(e) => setAssigneeFilter(e.target.value)}
                  >
                    <MenuItem value="all">すべての担当者</MenuItem>
                    {involvedUsers.map(u => (
                      <MenuItem key={u.id} value={String(u.id)}>
                        {u.full_name || u.username}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={2} sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => navigate(`/projects/${projectId}/shotlist`)}
                  startIcon={<ShotListIcon />}
                  sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
                >
                  ショット
                </Button>
              </Grid>
            </Grid>
          </Paper>

          {/* Tasks Table */}
          <TableContainer component={Paper} elevation={1} sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
            <Table size="medium">
              <TableHead sx={{ bgcolor: 'action.hover' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 800 }}>タスク名</TableCell>
                  <TableCell sx={{ fontWeight: 800 }} width="120">ステータス</TableCell>
                  <TableCell sx={{ fontWeight: 800 }} width="100" align="right">コスト</TableCell>
                  <TableCell sx={{ fontWeight: 800 }} width="180">担当者</TableCell>
                  <TableCell sx={{ fontWeight: 800 }} width="150">期日</TableCell>
                  {isAdmin && <TableCell sx={{ fontWeight: 800 }} width="100" align="right">操作</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredTasks.map((task) => {
                  const taskColor = getTaskColor((task.status || 'todo').toLowerCase(), project.status || undefined, task.due_date);
                  const isDelayed = (task.status || '').toLowerCase() === 'delayed';

                  return (
                    <TableRow
                      key={task.id}
                      hover
                      onClick={() => {
                        setSelectedTaskDetail(task);
                        setIsTaskDetailOpen(true);
                      }}
                      sx={{
                        cursor: 'pointer',
                        bgcolor: isDelayed ? (isDark ? 'rgba(244, 67, 54, 0.03)' : 'rgba(244, 67, 54, 0.01)') : 'inherit',
                        borderLeft: `4px solid ${taskColor}`
                      }}
                    >
                      {/* Name with ShotLabel */}
                      <TableCell sx={{ py: 1.75 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <TaskLabel shotId={task.shotID || ''} title={task.name} />
                          {task.seqID && (
                            <Typography variant="caption" sx={{ px: 0.75, py: 0.1, borderRadius: 0.5, bgcolor: 'action.selected', color: 'text.secondary', fontWeight: 600, fontSize: '0.7rem' }}>
                              {task.seqID}
                            </Typography>
                          )}
                        </Box>
                      </TableCell>

                      {/* Status */}
                      <TableCell>
                        <Chip
                          label={task.status || 'TODO'}
                          size="small"
                          sx={{
                            bgcolor: taskColor,
                            color: theme.palette.getContrastText(taskColor),
                            fontWeight: 700,
                            fontSize: '0.75rem',
                            textTransform: 'uppercase'
                          }}
                        />
                      </TableCell>

                      {/* Cost */}
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {Number(task.cost || 0).toLocaleString()}
                      </TableCell>

                      {/* Assignee */}
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Avatar
                            src={getUserAvatar(task.assigned_to)}
                            sx={{ width: 24, height: 24, fontSize: '0.75rem', bgcolor: 'primary.light' }}
                          >
                            {!task.assigned_to && <PersonIcon sx={{ fontSize: 14 }} />}
                          </Avatar>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {getUserName(task.assigned_to) || '-'}
                          </Typography>
                        </Box>
                      </TableCell>

                      {/* Due Date */}
                      <TableCell sx={{ color: isDelayed ? 'error.main' : 'text.primary', fontWeight: isDelayed ? 700 : 500 }}>
                        {task.due_date ? format(new Date(task.due_date), 'yyyy/MM/dd', { locale: ja }) : '-'}
                      </TableCell>

                      {/* Action */}
                      {isAdmin && (
                        <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                          <Tooltip title="タスク編集">
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => setEditTaskId(task.id)}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {filteredTasks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={isAdmin ? 6 : 5} align="center" sx={{ py: 6 }}>
                      <Typography color="text.secondary">タスクが見つかりませんでした。</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* Tab Panel 1: Members & Group */}
      {tabValue === 1 && (
        <Box>
          <Grid container spacing={3}>
            {/* Involved Members List */}
            <Grid item xs={12} md={8}>
              <Paper elevation={1} sx={{ p: 3, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>関連メンバー ({involvedUsers.length})</Typography>
                  {involvedUsers.length > 0 && (
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<GroupIcon />}
                      onClick={handleOpenGroupCreateDialog}
                      sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
                    >
                      このメンバーでグループ作成
                    </Button>
                  )}
                </Box>
                <Divider sx={{ mb: 2 }} />
                {involvedUsers.length > 0 ? (
                  <Grid container spacing={2}>
                    {involvedUsers.map(user => (
                      <Grid item xs={12} sm={6} key={user.id}>
                        <Paper
                          elevation={0}
                          sx={{
                            p: 2,
                            borderRadius: 2,
                            border: '1px solid',
                            borderColor: 'divider',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            bgcolor: isDark ? 'rgba(255,255,255,0.01)' : 'rgba(0,0,0,0.01)'
                          }}
                        >
                          <Avatar
                            src={user.avatar_url || `/api/users/${user.id}/avatar`}
                            sx={{ width: 40, height: 40, bgcolor: 'primary.light' }}
                          />
                          <Box>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              {user.full_name || user.username || user.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {user.email}
                            </Typography>
                          </Box>
                        </Paper>
                      </Grid>
                    ))}
                  </Grid>
                ) : (
                  <Box sx={{ py: 6, textAlign: 'center' }}>
                    <Typography color="text.secondary">関連メンバーはいません。</Typography>
                  </Box>
                )}
              </Paper>
            </Grid>

            {/* Sidebar info */}
            <Grid item xs={12} md={4}>
              <Paper elevation={1} sx={{ p: 3, borderRadius: 2.5, border: '1px solid', borderColor: 'divider' }}>
                <Typography variant="h6" sx={{ fontWeight: 800, mb: 1.5 }}>リソースサマリー</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, lineHeight: 1.5 }}>
                  このプロジェクトには、{involvedUsers.length}名のメンバーがアサインされています。
                  タスク別の割り当てコストを最適化し、リソースの空き状況を確認してください。
                </Typography>
                <Button
                  fullWidth
                  variant="outlined"
                  onClick={() => navigate('/metrics?tab=resources')}
                  sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
                >
                  リソース分析画面へ
                </Button>
              </Paper>
            </Grid>
          </Grid>
        </Box>
      )}

      {/* Group Create Dialog */}
      <Dialog open={isGroupCreateDialogOpen} onClose={handleCloseGroupCreateDialog} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>新規グループ作成</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="グループ名"
            type="text"
            fullWidth
            variant="outlined"
            value={newGroupName}
            onChange={handleNewGroupNameChange}
            sx={{ mb: 2, mt: 1 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            以下のメンバー ({involvedUsers.length}名) が自動的に新しいグループに追加されます。
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {involvedUsers.map(user => (
              <Chip key={user.id} size="small" avatar={<Avatar src={user.avatar_url || `/api/users/${user.id}/avatar`} />} label={user.full_name || user.username} />
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={handleCloseGroupCreateDialog} color="inherit">キャンセル</Button>
          <Button onClick={handleCreateGroup} variant="contained" disabled={!newGroupName.trim()}>作成</Button>
        </DialogActions>
      </Dialog>

      {/* Quick Task Detail Drawer */}
      <Drawer
        anchor="right"
        open={isTaskDetailOpen}
        onClose={() => setIsTaskDetailOpen(false)}
        PaperProps={{
          sx: { width: { xs: '100%', sm: 480 }, maxWidth: '100%' }
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>タスク詳細</Typography>
          <IconButton onClick={() => setIsTaskDetailOpen(false)}>
            <CloseIcon />
          </IconButton>
        </Box>
        <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
          {selectedTaskDetail && (
            <TaskQuickDetail
              task={selectedTaskDetail}
              projects={project ? [project] : []}
              users={allUsers}
              onUpdate={handleUpdateTaskQuick}
              tasks={tasks}
            />
          )}
        </Box>
      </Drawer>

      {/* Task Edit Dialog */}
      {editTaskId !== null && (
        <TaskEditDialog
          open={editTaskId !== null}
          taskId={editTaskId}
          onClose={() => setEditTaskId(null)}
          onSaved={handleTaskEditSuccess}
        />
      )}

      {/* Snackbar feedback */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%', borderRadius: 2 }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default ProjectDetailPage;