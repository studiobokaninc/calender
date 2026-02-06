import React, { useState, useEffect, useMemo } from 'react';
import { 
  Box, Typography, Button, CircularProgress, Paper, 
  IconButton, Avatar, Dialog, DialogTitle, DialogContent, DialogActions, 
  TextField, FormControl, InputLabel, Select, MenuItem, Snackbar, Alert, Card, 
  CardContent, Chip, Grid, Tooltip, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, useMediaQuery, useTheme
} from '@mui/material';
import { User, Task, Project, UserGroup, Group } from '../types';
import api from '../services/api';
import { 
  Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon, 
  Assignment as AssignmentIcon,
  Person as PersonIcon,
  Today as TodayIcon, Warning as WarningIcon, Schedule as ScheduleIcon,
  Group as GroupIcon
} from '@mui/icons-material';
import UserAddModal, { NewUserData } from '../components/UserAddModal';
import { SelectChangeEvent } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { startOfDay, parseISO, isBefore, addDays, isSameDay, isValid, format } from 'date-fns';

/** タスクの表示カテゴリ（今日 / 遅延 / 期限間近 / その他）。1タスク1カテゴリで重複表示しない */
export type TaskDisplayCategory = 'today' | 'delayed' | 'dueSoon' | 'other';

const DUE_SOON_DAYS = 3; // 期限「間近」の日数

/** タスクリストのツールチップを大きく表示するための slotProps */
const taskTooltipSlotProps = {
  tooltip: { sx: { fontSize: '0.95rem' } as const }
};

/** タスクがどのカテゴリに属するか（優先度: 今日 > 遅延 > 期限間近 > その他） */
function getTaskCategory(task: Task): TaskDisplayCategory {
  if (!task.due_date) return 'other';
  const due = parseISO(task.due_date);
  if (!isValid(due)) return 'other';
  const dueDate = startOfDay(due);
  const today = startOfDay(new Date());
  if (isSameDay(dueDate, today)) return 'today';
  if (isBefore(dueDate, today)) return 'delayed';
  const limit = addDays(today, DUE_SOON_DAYS);
  if (isBefore(dueDate, limit) || isSameDay(dueDate, limit)) return 'dueSoon';
  return 'other';
}

/** ユーザーごとのタスクを今日/遅延/期限間近/その他に分割（重複なし） */
function partitionTasksByCategory(tasks: Task[]): Record<TaskDisplayCategory, Task[]> {
  const result: Record<TaskDisplayCategory, Task[]> = {
    today: [],
    delayed: [],
    dueSoon: [],
    other: []
  };
  tasks.forEach(task => {
    const cat = getTaskCategory(task);
    result[cat].push(task);
  });
  return result;
}

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
  totalCost: number; // コスト合計（所要時間の目安）
}

/** タスク編集ダイアログ用フォームデータ */
interface TaskFormData {
  id: number | null;
  name: string;
  description: string;
  status: string;
  priority: string;
  assigned_to: number | null;
  project_id: number | null;
  start_date: string;
  due_date: string;
  cost: number;
  type: string;
  seqID: string;
  shotID: string;
  dependsOn: string[];
}

const UserManagementPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';

  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
  const [userTaskInfo, setUserTaskInfo] = useState<Record<number, UserTaskInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [currentEditUser, setCurrentEditUser] = useState<EditUserData | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [editConfirmPassword, setEditConfirmPassword] = useState('');
  const [editPasswordError, setEditPasswordError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{open: boolean, message: string, severity: 'success' | 'error'}>({
    open: false,
    message: '',
    severity: 'success'
  });
  const [taskEditDialogOpen, setTaskEditDialogOpen] = useState(false);
  const [currentEditTask, setCurrentEditTask] = useState<TaskFormData>({
    id: null,
    name: '',
    description: '',
    status: 'todo',
    priority: 'low',
    assigned_to: null,
    project_id: null,
    start_date: format(new Date(), 'yyyy-MM-dd'),
    due_date: format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
    cost: 0,
    type: '',
    seqID: '',
    shotID: '',
    dependsOn: []
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
      const [usersResponse, tasksResponse, projectsResponse, groupsResponse] = await Promise.all([
        api.get<User[]>('/users').catch(err => {
          console.error("Failed to fetch users:", err);
          throw new Error(`ユーザーデータの取得に失敗しました: ${err.response?.data?.detail || err.message}`);
        }),
        api.get<Task[]>('/tasks').catch(err => {
          console.error("Failed to fetch tasks:", err);
          throw new Error(`タスクデータの取得に失敗しました: ${err.response?.data?.detail || err.message}`);
        }),
        api.get<Project[]>('/projects').catch(err => {
          console.error("Failed to fetch projects:", err);
          throw new Error(`プロジェクトデータの取得に失敗しました: ${err.response?.data?.detail || err.message}`);
        }),
        api.get<Group[]>('/groups').catch(err => {
          console.error("Failed to fetch groups:", err);
          // グループデータの取得失敗は警告のみ（グループ機能が使えないだけ）
          console.warn("グループデータの取得に失敗しましたが、続行します");
          return { data: [] };
        })
      ]);
      setUsers(usersResponse.data);
      setTasks(tasksResponse.data);
      setProjects(projectsResponse.data);
      setGroups(groupsResponse.data || []);
      
      // 全ユーザーのグループ所属情報を取得
      if (usersResponse.data.length > 0) {
        try {
          const userGroupPromises = usersResponse.data.map(user => 
            api.get<UserGroup[]>(`/user_groups?user_id=${user.id}`).catch(err => {
              console.warn(`Failed to fetch user groups for user ${user.id}:`, err);
              return { data: [] };
            })
          );
          const userGroupResponses = await Promise.all(userGroupPromises);
          const allUserGroups: UserGroup[] = [];
          userGroupResponses.forEach(response => {
            if (response.data && Array.isArray(response.data)) {
              allUserGroups.push(...response.data);
            }
          });
          console.log('[UserManagementPage] Fetched user groups:', allUserGroups.length, 'memberships');
          setUserGroups(allUserGroups);
        } catch (err) {
          console.warn("Failed to fetch user groups, continuing without group data:", err);
          setUserGroups([]);
        }
      } else {
        setUserGroups([]);
      }
    } catch (err: any) {
      console.error("Error fetching data:", err);
      const errorMessage = err?.message || err?.response?.data?.detail || 'データの取得に失敗しました。';
      setError(errorMessage);
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
        totalTasks: 0,
        totalCost: 0
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
            totalTasks: 0,
            totalCost: 0
          };
        }

        infoMap[userId].tasks.push(task);
        infoMap[userId].totalTasks++;
        
        // コスト（所要時間）を集計（コストが設定されている場合のみ）
        if (task.cost && typeof task.cost === 'number' && task.cost > 0) {
          infoMap[userId].totalCost += task.cost;
        }

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
    setEditPassword('');
    setEditConfirmPassword('');
    setEditPasswordError(null);
    setIsEditModalOpen(true);
  };

  const handleCloseEditModal = () => {
    setIsEditModalOpen(false);
    setCurrentEditUser(null);
    setEditPassword('');
    setEditConfirmPassword('');
    setEditPasswordError(null);
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

    setEditPasswordError(null);
    if (editPassword || editConfirmPassword) {
      if (editPassword.length < 8) {
        setEditPasswordError('パスワードは8文字以上である必要があります。');
        return;
      }
      if (editPassword !== editConfirmPassword) {
        setEditPasswordError('パスワードが一致しません。');
        return;
      }
    }

    try {
      const payload: Record<string, string> = {
        username: currentEditUser.username,
        full_name: currentEditUser.full_name,
        email: currentEditUser.email,
        role: currentEditUser.role
      };
      if (editPassword) {
        payload.password = editPassword;
      }
      const response = await api.put<User>(`/api/users/${currentEditUser.id}`, payload);
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

  const safeParseDate = (dateStr: string | null | undefined): Date | null => {
    if (!dateStr) return null;
    try {
      const parsed = parseISO(dateStr);
      return isValid(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const handleTaskDoubleClick = (task: Task) => {
    const startDateParsed = safeParseDate(task.start_date);
    const dueDateParsed = safeParseDate(task.due_date);
    setCurrentEditTask({
      id: task.id,
      name: task.name,
      description: task.description || '',
      status: task.status || 'todo',
      priority: (task.extendedProps as any)?.priority?.toLowerCase() || 'low',
      assigned_to: task.assigned_to || null,
      project_id: task.project_id || null,
      start_date: startDateParsed ? format(startDateParsed, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
      due_date: dueDateParsed ? format(dueDateParsed, 'yyyy-MM-dd') : format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
      cost: task.cost || 0,
      type: (task as any)?.type ?? (task.extendedProps as any)?.type?.toLowerCase() ?? '',
      seqID: (task as any)?.seqID ?? (task.extendedProps as any)?.seqID ?? '',
      shotID: (task as any)?.shotID ?? (task.extendedProps as any)?.shotID ?? '',
      dependsOn: task.dependsOn || []
    });
    setTaskEditDialogOpen(true);
  };

  const handleCloseTaskEditDialog = () => {
    setTaskEditDialogOpen(false);
  };

  const handleTaskEditInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name) {
      setCurrentEditTask(prev => ({
        ...prev,
        [name]: name === 'cost' ? (value === '' ? 0 : Number(value)) : value
      }));
    }
  };

  const handleTaskEditSelectChange = (e: SelectChangeEvent<string | number>) => {
    const { name, value } = e.target;
    if (!name) return;
    const isIdField = name === 'project_id' || name === 'assigned_to';
    const normalized = (value === '' || value == null)
      ? null
      : (isIdField && typeof value === 'string' && /^\d+$/.test(value) ? parseInt(value, 10) : value);
    setCurrentEditTask(prev => ({
      ...prev,
      [name]: isIdField ? normalized : value
    } as TaskFormData));
  };

  const handleTaskEditSubmit = async () => {
    if (!currentEditTask.name?.trim()) {
      setSnackbar({ open: true, message: 'タスク名を入力してください', severity: 'error' });
      return;
    }
    if (!currentEditTask.project_id) {
      setSnackbar({ open: true, message: 'プロジェクトを選択してください', severity: 'error' });
      return;
    }
    if (!currentEditTask.due_date) {
      setSnackbar({ open: true, message: '期日を入力してください', severity: 'error' });
      return;
    }
    if (currentEditTask.id == null) return;
    try {
      await api.put(`/tasks/${currentEditTask.id}`, {
        name: currentEditTask.name,
        description: currentEditTask.description || '',
        status: currentEditTask.status,
        priority: (currentEditTask.priority || 'low').toUpperCase(),
        assigned_to: currentEditTask.assigned_to || null,
        project_id: currentEditTask.project_id || null,
        start_date: currentEditTask.start_date,
        due_date: currentEditTask.due_date,
        cost: currentEditTask.cost || 0,
        type: (currentEditTask.type || '').toLowerCase(),
        seqID: currentEditTask.seqID || '',
        shotID: currentEditTask.shotID || '',
        dependsOn: currentEditTask.dependsOn || [],
        display_status: 'online'
      });
      setSnackbar({ open: true, message: 'タスクを更新しました', severity: 'success' });
      setTaskEditDialogOpen(false);
      await fetchAllData();
    } catch (err: any) {
      const msg = err.response?.data?.detail
        ? (Array.isArray(err.response.data.detail)
          ? err.response.data.detail.map((e: any) => `${e.loc?.join?.('.')}: ${e.msg}`).join('\n')
          : err.response.data.detail)
        : 'タスクの更新に失敗しました';
      setSnackbar({ open: true, message: msg, severity: 'error' });
    }
  };

  const usersWithTasks = users.filter(user => {
    const info = userTaskInfo[user.id];
    return info && info.totalTasks > 0;
  });

  // グループに所属しているユーザーIDのセット
  const usersInGroups = useMemo(() => {
    const userIds = new Set<number>();
    userGroups.forEach(ug => {
      if (ug && ug.user_id) {
        userIds.add(ug.user_id);
      }
    });
    console.log('[UserManagementPage] usersInGroups calculated:', {
      userGroupsCount: userGroups.length,
      uniqueUserIds: Array.from(userIds),
      userGroups: userGroups
    });
    return userIds;
  }, [userGroups]);

  // ユーザーごとのグループ情報をマッピング
  const userGroupMap = useMemo(() => {
    const map = new Map<number, Group[]>();
    const groupMap = new Map<number, Group>();
    groups.forEach(g => groupMap.set(g.id, g));
    
    userGroups.forEach(ug => {
      const group = groupMap.get(ug.group_id);
      if (group) {
        if (!map.has(ug.user_id)) {
          map.set(ug.user_id, []);
        }
        map.get(ug.user_id)!.push(group);
      }
    });
    return map;
  }, [userGroups, groups]);

  // グループに所属しているユーザー（タスクを持っていないユーザーも含む）
  const usersInGroupsList = useMemo(() => {
    return users.filter(user => usersInGroups.has(user.id));
  }, [users, usersInGroups]);

  // ユーザー別タスクリストとグループ所属の両方に属するユーザーID（薄く色づけして表示する）
  const userIdsInBoth = useMemo(() => {
    const withTasks = new Set(usersWithTasks.map(u => u.id));
    return new Set([...withTasks].filter(id => usersInGroups.has(id)));
  }, [usersWithTasks, usersInGroups]);

  // タスク未担当ユーザー（グループ所属ユーザーは除外）
  const usersWithoutTasks = useMemo(() => {
    const filtered = users.filter(user => {
      const info = userTaskInfo[user.id];
      const hasTasks = info && info.totalTasks > 0;
      const isInGroup = usersInGroups.has(user.id);
      
      // グループに所属しているユーザーはタスク未担当リストから除外
      if (isInGroup) {
        return false;
      }
      
      // タスクを持っていないユーザーのみ
      return !hasTasks;
    });
    console.log('[UserManagementPage] usersWithoutTasks calculated:', filtered.length, 'users');
    return filtered;
  }, [users, userTaskInfo, usersInGroups]);

  const theme = useTheme();
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'));

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
          {/* ユーザー別タスクリスト */}
          {usersWithTasks.length > 0 && (
            <Grid item xs={12}>
              <Paper sx={{ p: 2, mb: 2, overflow: 'auto' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <AssignmentIcon sx={{ mr: 1, color: 'primary.main' }} />
                  <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                    ユーザー別タスクリスト（{usersWithTasks.length}名）
                  </Typography>
                </Box>
                {isNarrow ? (
                  /* 縦リスト: ユーザーごとにカード、中に今日/遅延/期限間近/その他とタスク名を並べる */
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {usersWithTasks.map((user) => {
                      const info = userTaskInfo[user.id];
                      const part = info ? partitionTasksByCategory(info.tasks) : { today: [], delayed: [], dueSoon: [], other: [] as Task[] };
                      return (
                        <Card key={user.id} variant="outlined" sx={{ borderLeft: part.today.length > 0 ? '4px solid #1565C0' : part.delayed.length > 0 ? '4px solid #C62828' : 'none', ...(userIdsInBoth.has(user.id) ? { bgcolor: 'rgba(156, 39, 176, 0.07)' } : {}) }}>
                          <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Avatar src={user.iconUrl} sx={{ width: 36, height: 36 }}>
                                  {(user.name || user.username || '')?.[0]?.toUpperCase()}
                                </Avatar>
                                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>{user.name || user.username}</Typography>
                                {user.role === 'admin' && <Chip label="管理者" size="small" color="secondary" />}
                              </Box>
                              {isAdmin && (
                                <Box>
                                  <IconButton size="small" onClick={() => handleEditUserClick(user)} aria-label="edit"><EditIcon fontSize="small" /></IconButton>
                                  <IconButton size="small" onClick={() => handleDeleteUserClick(String(user.id), user.name || user.username || '')} aria-label="delete"><DeleteIcon fontSize="small" /></IconButton>
                                </Box>
                              )}
                            </Box>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                              {part.delayed.length > 0 && (
                                <Box>
                                  <Typography variant="caption" sx={{ color: '#C62828', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                                    <WarningIcon fontSize="small" /> 遅れている
                                  </Typography>
                                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {part.delayed.map((t) => (
                                      <Tooltip key={t.id} title={`📁 ${info?.projectNames[t.project_id ?? 0] || '—'} / 期日: ${t.due_date ? new Date(t.due_date).toLocaleDateString('ja-JP') : '—'} — ダブルクリックで編集`} slotProps={taskTooltipSlotProps}>
                                        <Chip size="small" label={t.name} sx={{ bgcolor: '#FFEBEE', color: '#C62828', maxWidth: 200, cursor: 'pointer' }} onDoubleClick={(e) => { e.stopPropagation(); handleTaskDoubleClick(t); }} />
                                      </Tooltip>
                                    ))}
                                  </Box>
                                </Box>
                              )}
                              {part.today.length > 0 && (
                                <Box>
                                  <Typography variant="caption" sx={{ color: '#1565C0', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                                    <TodayIcon fontSize="small" /> 今日中
                                  </Typography>
                                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {part.today.map((t) => (
                                      <Tooltip key={t.id} title={`📁 ${info?.projectNames[t.project_id ?? 0] || '—'} / 期日: ${t.due_date ? new Date(t.due_date).toLocaleDateString('ja-JP') : '—'} — ダブルクリックで編集`} slotProps={taskTooltipSlotProps}>
                                        <Chip size="small" label={t.name} sx={{ bgcolor: '#E3F2FD', color: '#1565C0', maxWidth: 200, cursor: 'pointer' }} onDoubleClick={(e) => { e.stopPropagation(); handleTaskDoubleClick(t); }} />
                                      </Tooltip>
                                    ))}
                                  </Box>
                                </Box>
                              )}
                              {part.dueSoon.length > 0 && (
                                <Box>
                                  <Typography variant="caption" sx={{ color: '#E65100', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                                    <ScheduleIcon fontSize="small" /> 期限が近い
                                  </Typography>
                                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {part.dueSoon.map((t) => (
                                      <Tooltip key={t.id} title={`📁 ${info?.projectNames[t.project_id ?? 0] || '—'} / 期日: ${t.due_date ? new Date(t.due_date).toLocaleDateString('ja-JP') : '—'} — ダブルクリックで編集`} slotProps={taskTooltipSlotProps}>
                                        <Chip size="small" label={t.name} sx={{ bgcolor: '#FFF3E0', color: '#E65100', maxWidth: 200, cursor: 'pointer' }} onDoubleClick={(e) => { e.stopPropagation(); handleTaskDoubleClick(t); }} />
                                      </Tooltip>
                                    ))}
                                  </Box>
                                </Box>
                              )}
                              {part.other.length > 0 && (
                                <Box>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold', mb: 0.5, display: 'block' }}>余裕をもって進める</Typography>
                                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {part.other.map((t) => (
                                      <Tooltip key={t.id} title={`📁 ${info?.projectNames[t.project_id ?? 0] || '—'}${t.due_date ? ` / 期日: ${new Date(t.due_date).toLocaleDateString('ja-JP')}` : ''} — ダブルクリックで編集`} slotProps={taskTooltipSlotProps}>
                                        <Chip size="small" label={t.name} variant="outlined" sx={{ maxWidth: 200, cursor: 'pointer' }} onDoubleClick={(e) => { e.stopPropagation(); handleTaskDoubleClick(t); }} />
                                      </Tooltip>
                                    ))}
                                  </Box>
                                </Box>
                              )}
                            </Box>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </Box>
                ) : (
                  /* 横: テーブル 1行＝1ユーザー、列＝遅延/今日中にやるべき/期限間近/その他（タスク名を表示） */
                  <TableContainer>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 'bold', minWidth: 160, bgcolor: 'background.paper' }}>ユーザー</TableCell>
                          <TableCell sx={{ fontWeight: 'bold', minWidth: 180, bgcolor: '#FFEBEE', color: '#C62828' }}><WarningIcon sx={{ fontSize: 18, verticalAlign: 'middle', mr: 0.5 }} />遅れている</TableCell>
                          <TableCell sx={{ fontWeight: 'bold', minWidth: 180, bgcolor: '#E3F2FD', color: '#1565C0' }}><TodayIcon sx={{ fontSize: 18, verticalAlign: 'middle', mr: 0.5 }} />今日中</TableCell>
                          <TableCell sx={{ fontWeight: 'bold', minWidth: 180, bgcolor: '#FFF3E0', color: '#E65100' }}><ScheduleIcon sx={{ fontSize: 18, verticalAlign: 'middle', mr: 0.5 }} />期限が近い</TableCell>
                          <TableCell sx={{ fontWeight: 'bold', minWidth: 160, bgcolor: 'background.paper' }}>余裕をもって進める</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {usersWithTasks.map((user) => {
                          const info = userTaskInfo[user.id];
                          const part = info ? partitionTasksByCategory(info.tasks) : { today: [], delayed: [], dueSoon: [], other: [] as Task[] };
                          return (
                            <TableRow key={user.id} hover sx={{ borderLeft: part.today.length > 0 ? '4px solid #1565C0' : part.delayed.length > 0 ? '4px solid #C62828' : undefined, ...(userIdsInBoth.has(user.id) ? { bgcolor: 'rgba(156, 39, 176, 0.07)' } : {}) }}>
                              <TableCell sx={{ verticalAlign: 'top', minWidth: 160 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                  <Avatar src={user.iconUrl} sx={{ width: 32, height: 32 }}>{(user.name || user.username || '')?.[0]?.toUpperCase()}</Avatar>
                                  <Box>
                                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{user.name || user.username}</Typography>
                                    {user.role === 'admin' && <Chip label="管理者" size="small" color="secondary" sx={{ mt: 0.25 }} />}
                                  </Box>
                                  {isAdmin && (
                                    <Box sx={{ ml: 'auto' }}>
                                      <IconButton size="small" onClick={() => handleEditUserClick(user)} aria-label="edit"><EditIcon fontSize="small" /></IconButton>
                                      <IconButton size="small" onClick={() => handleDeleteUserClick(String(user.id), user.name || user.username || '')} aria-label="delete"><DeleteIcon fontSize="small" /></IconButton>
                                    </Box>
                                  )}
                                </Box>
                              </TableCell>
                              <TableCell sx={{ verticalAlign: 'top', bgcolor: 'rgba(244, 67, 54, 0.04)' }}>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                  {part.delayed.length === 0 ? '—' : part.delayed.map((t) => (
                                    <Tooltip key={t.id} title={`📁 ${info?.projectNames[t.project_id ?? 0] || '—'} / 期日: ${t.due_date ? new Date(t.due_date).toLocaleDateString('ja-JP') : '—'} — ダブルクリックで編集`} slotProps={taskTooltipSlotProps}>
                                      <Chip size="small" label={t.name} sx={{ bgcolor: '#FFEBEE', color: '#C62828', cursor: 'pointer' }} onDoubleClick={(e) => { e.stopPropagation(); handleTaskDoubleClick(t); }} />
                                    </Tooltip>
                                  ))}
                                </Box>
                              </TableCell>
                              <TableCell sx={{ verticalAlign: 'top', bgcolor: 'rgba(33, 150, 243, 0.04)' }}>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                  {part.today.length === 0 ? '—' : part.today.map((t) => (
                                    <Tooltip key={t.id} title={`📁 ${info?.projectNames[t.project_id ?? 0] || '—'} / 期日: ${t.due_date ? new Date(t.due_date).toLocaleDateString('ja-JP') : '—'} — ダブルクリックで編集`} slotProps={taskTooltipSlotProps}>
                                      <Chip size="small" label={t.name} sx={{ bgcolor: '#E3F2FD', color: '#1565C0', cursor: 'pointer' }} onDoubleClick={(e) => { e.stopPropagation(); handleTaskDoubleClick(t); }} />
                                    </Tooltip>
                                  ))}
                                </Box>
                              </TableCell>
                              <TableCell sx={{ verticalAlign: 'top', bgcolor: 'rgba(255, 152, 0, 0.04)' }}>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                  {part.dueSoon.length === 0 ? '—' : part.dueSoon.map((t) => (
                                    <Tooltip key={t.id} title={`📁 ${info?.projectNames[t.project_id ?? 0] || '—'} / 期日: ${t.due_date ? new Date(t.due_date).toLocaleDateString('ja-JP') : '—'} — ダブルクリックで編集`} slotProps={taskTooltipSlotProps}>
                                      <Chip size="small" label={t.name} sx={{ bgcolor: '#FFF3E0', color: '#E65100', cursor: 'pointer' }} onDoubleClick={(e) => { e.stopPropagation(); handleTaskDoubleClick(t); }} />
                                    </Tooltip>
                                  ))}
                                </Box>
                              </TableCell>
                              <TableCell sx={{ verticalAlign: 'top' }}>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                  {part.other.length === 0 ? '—' : part.other.map((t) => (
                                    <Tooltip key={t.id} title={`📁 ${info?.projectNames[t.project_id ?? 0] || '—'}${t.due_date ? ` / 期日: ${new Date(t.due_date).toLocaleDateString('ja-JP')}` : ''} — ダブルクリックで編集`} slotProps={taskTooltipSlotProps}>
                                      <Chip size="small" label={t.name} variant="outlined" sx={{ cursor: 'pointer' }} onDoubleClick={(e) => { e.stopPropagation(); handleTaskDoubleClick(t); }} />
                                    </Tooltip>
                                  ))}
                                </Box>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Paper>
            </Grid>
          )}

          {/* グループ所属ユーザーリスト */}
          {usersInGroupsList.length > 0 && (
            <Grid item xs={12}>
              <Paper sx={{ p: 2, mb: 2, overflow: 'auto' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <GroupIcon sx={{ mr: 1, color: 'secondary.main' }} />
                  <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                    グループ所属ユーザー（{usersInGroupsList.length}名）
                  </Typography>
                </Box>
                {isNarrow ? (
                  /* 縦リスト: ユーザーごとにカード、中に所属グループを表示 */
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {usersInGroupsList.map((user) => {
                      const userGroupsList = userGroupMap.get(user.id) || [];
                      return (
                        <Card key={user.id} variant="outlined" sx={{ borderLeft: '4px solid #9C27B0', ...(userIdsInBoth.has(user.id) ? { bgcolor: 'rgba(156, 39, 176, 0.07)' } : {}) }}>
                          <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Avatar src={user.iconUrl} sx={{ width: 36, height: 36 }}>
                                  {(user.name || user.username || '')?.[0]?.toUpperCase()}
                                </Avatar>
                                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>{user.name || user.username}</Typography>
                                {user.role === 'admin' && <Chip label="管理者" size="small" color="secondary" />}
                              </Box>
                              {isAdmin && (
                                <Box>
                                  <IconButton size="small" onClick={() => handleEditUserClick(user)} aria-label="edit"><EditIcon fontSize="small" /></IconButton>
                                  <IconButton size="small" onClick={() => handleDeleteUserClick(String(user.id), user.name || user.username || '')} aria-label="delete"><DeleteIcon fontSize="small" /></IconButton>
                                </Box>
                              )}
                            </Box>
                            <Box>
                              <Typography variant="caption" sx={{ color: '#9C27B0', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                                <GroupIcon fontSize="small" /> 所属グループ
                              </Typography>
                              {userGroupsList.length > 0 ? (
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                  {userGroupsList.map((group) => (
                                    <Chip 
                                      key={group.id} 
                                      label={group.name} 
                                      size="small" 
                                      sx={{ 
                                        bgcolor: '#E1BEE7', 
                                        color: '#7B1FA2', 
                                        fontWeight: 600,
                                        maxWidth: 200,
                                      }} 
                                    />
                                  ))}
                                </Box>
                              ) : (
                                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                  グループ未所属
                                </Typography>
                              )}
                            </Box>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </Box>
                ) : (
                  /* 横: テーブル 1行＝1ユーザー、列＝所属グループ */
                  <TableContainer>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 'bold', minWidth: 160, bgcolor: 'background.paper' }}>ユーザー</TableCell>
                          <TableCell sx={{ fontWeight: 'bold', minWidth: 300, bgcolor: '#F3E5F5', color: '#9C27B0' }}>
                            <GroupIcon sx={{ fontSize: 18, verticalAlign: 'middle', mr: 0.5 }} />所属グループ
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {usersInGroupsList.map((user) => {
                          const userGroupsList = userGroupMap.get(user.id) || [];
                          return (
                            <TableRow key={user.id} hover sx={{ borderLeft: '4px solid #9C27B0', ...(userIdsInBoth.has(user.id) ? { bgcolor: 'rgba(156, 39, 176, 0.07)' } : {}) }}>
                              <TableCell sx={{ verticalAlign: 'top', minWidth: 160 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                  <Avatar src={user.iconUrl} sx={{ width: 32, height: 32 }}>{(user.name || user.username || '')?.[0]?.toUpperCase()}</Avatar>
                                  <Box>
                                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{user.name || user.username}</Typography>
                                    {user.role === 'admin' && <Chip label="管理者" size="small" color="secondary" sx={{ mt: 0.25 }} />}
                                  </Box>
                                  {isAdmin && (
                                    <Box sx={{ ml: 'auto' }}>
                                      <IconButton size="small" onClick={() => handleEditUserClick(user)} aria-label="edit"><EditIcon fontSize="small" /></IconButton>
                                      <IconButton size="small" onClick={() => handleDeleteUserClick(String(user.id), user.name || user.username || '')} aria-label="delete"><DeleteIcon fontSize="small" /></IconButton>
                                    </Box>
                                  )}
                                </Box>
                              </TableCell>
                              <TableCell sx={{ verticalAlign: 'top', bgcolor: 'rgba(156, 39, 176, 0.04)' }}>
                                {userGroupsList.length > 0 ? (
                                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {userGroupsList.map((group) => (
                                      <Chip 
                                        key={group.id} 
                                        label={group.name} 
                                        size="small" 
                                        sx={{ 
                                          bgcolor: '#E1BEE7', 
                                          color: '#7B1FA2', 
                                          fontWeight: 600,
                                          cursor: 'default',
                                        }} 
                                      />
                                    ))}
                                  </Box>
                                ) : (
                                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                    グループ未所属
                                  </Typography>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
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
                      <Card 
                        variant="outlined" 
                        sx={{ 
                          bgcolor: 'background.paper',
                          transition: 'all 0.2s ease-in-out',
                          '&:hover': {
                            backgroundColor: 'action.hover',
                            boxShadow: 2,
                          }
                        }}
                      >
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
              label="ユーザー名"
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
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              パスワードを変更する場合のみ入力してください（空欄の場合は変更されません）
            </Typography>
            <TextField
              label="新しいパスワード"
              type="password"
              value={editPassword}
              onChange={(e) => setEditPassword(e.target.value)}
              fullWidth
              error={!!editPasswordError}
              helperText={editPasswordError}
              placeholder="8文字以上"
              inputProps={{ autoComplete: 'new-password' }}
            />
            <TextField
              label="新しいパスワード（確認）"
              type="password"
              value={editConfirmPassword}
              onChange={(e) => setEditConfirmPassword(e.target.value)}
              fullWidth
              error={!!editPasswordError}
              inputProps={{ autoComplete: 'new-password' }}
            />
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

      {/* タスク編集ダイアログ（タスク部分ダブルクリックで表示） */}
      <Dialog open={taskEditDialogOpen} onClose={handleCloseTaskEditDialog} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: '1rem' }}>タスク編集</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField
              name="name"
              label="タスク名"
              value={currentEditTask.name}
              onChange={handleTaskEditInputChange}
              fullWidth
              required
              size="small"
            />
            <TextField
              name="description"
              label="説明"
              value={currentEditTask.description}
              onChange={handleTaskEditInputChange}
              fullWidth
              multiline
              rows={3}
              size="small"
            />
            <FormControl fullWidth size="small" required>
              <InputLabel>プロジェクト</InputLabel>
              <Select
                name="project_id"
                value={currentEditTask.project_id ?? ''}
                label="プロジェクト"
                onChange={handleTaskEditSelectChange}
              >
                <MenuItem value="">選択してください</MenuItem>
                {projects.map((p) => (
                  <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              name="due_date"
              label="期日"
              type="date"
              value={currentEditTask.due_date}
              onChange={handleTaskEditInputChange}
              fullWidth
              required
              InputLabelProps={{ shrink: true }}
              size="small"
            />
            <TextField
              name="start_date"
              label="開始日"
              type="date"
              value={currentEditTask.start_date}
              onChange={handleTaskEditInputChange}
              fullWidth
              InputLabelProps={{ shrink: true }}
              size="small"
            />
            <FormControl fullWidth size="small">
              <InputLabel>担当者</InputLabel>
              <Select
                name="assigned_to"
                value={currentEditTask.assigned_to || ''}
                label="担当者"
                onChange={handleTaskEditSelectChange}
              >
                <MenuItem value="">未割り当て</MenuItem>
                {users.map((u) => (
                  <MenuItem key={u.id} value={u.id}>{u.username || u.name || u.email}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>ステータス</InputLabel>
              <Select
                name="status"
                value={currentEditTask.status}
                label="ステータス"
                onChange={handleTaskEditSelectChange}
              >
                <MenuItem value="todo">未着手</MenuItem>
                <MenuItem value="in-progress">進行中</MenuItem>
                <MenuItem value="review">レビュー中</MenuItem>
                <MenuItem value="completed">完了</MenuItem>
                <MenuItem value="delayed">遅延</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>優先度</InputLabel>
              <Select
                name="priority"
                value={currentEditTask.priority}
                label="優先度"
                onChange={handleTaskEditSelectChange}
              >
                <MenuItem value="high">高</MenuItem>
                <MenuItem value="medium">中</MenuItem>
                <MenuItem value="low">低</MenuItem>
              </Select>
            </FormControl>
            <TextField
              name="cost"
              label="コスト"
              type="number"
              value={currentEditTask.cost}
              onChange={handleTaskEditInputChange}
              fullWidth
              size="small"
              inputProps={{ step: '0.1' }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseTaskEditDialog}>キャンセル</Button>
          <Button onClick={handleTaskEditSubmit} variant="contained" color="primary">
            保存
          </Button>
        </DialogActions>
      </Dialog>

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
