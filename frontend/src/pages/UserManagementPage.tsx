import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, CircularProgress, Paper,
  IconButton, Avatar, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, FormControl, InputLabel, Select, MenuItem, Snackbar, Alert, Card,
  CardContent, Chip, Grid, Tooltip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, useMediaQuery, useTheme,
  Breadcrumbs, Link, Drawer
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { User, Task, Project, UserGroup, Group, CalendarEvent } from '../types';
import api from '../services/api';
import {
  Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon,
  Assignment as AssignmentIcon,
  People as PeopleIcon,
  Person as PersonIcon,
  Today as TodayIcon, Warning as WarningIcon, Schedule as ScheduleIcon,
  Group as GroupIcon,
  Close as CloseIcon
} from '@mui/icons-material';
import UserAddModal, { NewUserData } from '../components/UserAddModal';
import { TaskEditDialog } from '../components/SearchEditDialogs';
import { TaskQuickDetail } from '../components/TaskQuickDetail';
import PhaseEditModal from '../components/PhaseEditModal';
import { SelectChangeEvent } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { startOfDay, parseISO, isBefore, addDays, isSameDay, isValid } from 'date-fns';

/** タスクの表示カテゴリ（今日 / 遅延 / 期限間近 / その他）。1タスク1カテゴリで重複表示しない */
export type TaskDisplayCategory = 'today' | 'delayed' | 'dueSoon' | 'other';

const DUE_SOON_DAYS = 7; // 期限「間近」の日数（1週間）

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

const UserManagementPage: React.FC = () => {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';

  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [scoreUserRoles, setScoreUserRoles] = useState<any[]>([]);
  const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
  const [userTaskInfo, setUserTaskInfo] = useState<Record<number, UserTaskInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedDeleteUserId, setSelectedDeleteUserId] = useState<string>('');
  const [currentEditUser, setCurrentEditUser] = useState<EditUserData | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [editConfirmPassword, setEditConfirmPassword] = useState('');
  const [editPasswordError, setEditPasswordError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean, message: string, severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success'
  });
  const [phaseEventToEdit, setPhaseEventToEdit] = useState<CalendarEvent | null>(null);
  const [taskEditId, setTaskEditId] = useState<number | null>(null);
  const [isPhaseEditModalOpen, setIsPhaseEditModalOpen] = useState(false);

  // タスク詳細ドロワー用
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedTaskForDetail, setSelectedTaskForDetail] = useState<Task | null>(null);

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
      const [usersResponse, tasksResponse, projectsResponse, groupsResponse, scoreRolesResponse] = await Promise.all([
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
        }),
        api.get('/score_user_roles').catch(() => ({ data: [] }))
      ]);
      setUsers(usersResponse.data);
      setTasks(tasksResponse.data);
      setProjects(projectsResponse.data);
      setGroups(groupsResponse.data || []);
      setScoreUserRoles(scoreRolesResponse.data || []);

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
    const projectObjMap = new Map<number, Project>();
    const completedProjectIds = new Set<number>();
    const offlineProjectIds = new Set<number>();
    projects.forEach(project => {
      projectMap.set(project.id, project.name);
      projectObjMap.set(project.id, project);
      const status = (project.status || '').toLowerCase();
      if (status === 'completed' || status === '完了') {
        completedProjectIds.add(project.id);
      }
      // オフラインのプロジェクトIDを記録
      if (project.display_status === 'offline') {
        offlineProjectIds.add(project.id);
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

    // タスクをユーザーごとにグループ化（完了タスク・完了プロジェクトのタスク・オフラインプロジェクトのタスクは含めない）
    tasks.forEach(task => {
      if (!task.assigned_to) return;

      // 完了タスクを除外
      if (isTaskCompleted(task)) return;

      const projectId = task.project_id ?? 0;

      // 完了プロジェクトのタスクを除外
      if (projectId !== 0 && completedProjectIds.has(projectId)) return;

      // オフラインのプロジェクトのタスクを除外
      if (projectId !== 0 && offlineProjectIds.has(projectId)) return;

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

      // メインタスクを追加
      infoMap[userId].tasks.push(task);
      infoMap[userId].totalTasks++;

      // コスト（所要時間）を集計（コストが設定されている場合のみ）
      if (task.cost && typeof task.cost === 'number' && task.cost > 0) {
        infoMap[userId].totalCost += task.cost;
      }

      // プロジェクト別タスクリストに追加
      if (!infoMap[userId].tasksByProject[projectId]) {
        infoMap[userId].tasksByProject[projectId] = [];
      }
      infoMap[userId].tasksByProject[projectId].push(task);

      // Phaseも個別のタスクとして追加（完了していない場合のみ）
      if (task.phases && Array.isArray(task.phases)) {
        task.phases.forEach((p: any, idx: number) => {
          if (p.date) {
            // Phase用の疑似タスクオブジェクトを作成
            const phaseTask: any = {
              ...task,
              id: -1 * (task.id * 100 + idx), // 一意なID
              originalId: task.id,
              _phaseIndex: idx,
              _isCompleted: !!p.is_completed,
              name: `${task.name}: ${p.name}`, // タスク名: 段階目標名
              due_date: p.date,
              isPhase: true, // Phaseであることを示すフラグ
              cost: 0 // Phase自体にはコストを持たせない（二重計上防止）
            };

            // Phaseをタスクリストに追加
            infoMap[userId].tasks.push(phaseTask);
            // プロジェクト別リストにも追加（必要なら）
            infoMap[userId].tasksByProject[projectId].push(phaseTask);
          }
        });
      }

      if (projectId && projectMap.has(projectId)) {
        infoMap[userId].projectNames[projectId] = projectMap.get(projectId)!;
      } else if (projectId === 0 || !projectId) {
        infoMap[userId].projectNames[0] = 'プロジェクト未設定';
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

  const handleOpenDeleteDialog = () => {
    setSelectedDeleteUserId('');
    setIsDeleteDialogOpen(true);
  };

  const handleCloseDeleteDialog = () => {
    setIsDeleteDialogOpen(false);
    setSelectedDeleteUserId('');
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
    setSnackbar({ ...snackbar, open: false });
  };

  const handleDeleteUserFromDialog = async () => {
    if (!selectedDeleteUserId) {
      setSnackbar({
        open: true,
        message: '削除するユーザーを選択してください',
        severity: 'error'
      });
      return;
    }
    const targetUser = users.find(u => String(u.id) === selectedDeleteUserId);
    await handleDeleteUserClick(
      selectedDeleteUserId,
      targetUser ? (targetUser.name || targetUser.username || '') : ''
    );
    setIsDeleteDialogOpen(false);
    setSelectedDeleteUserId('');
  };

  const handleTaskDoubleClick = (task: Task) => {
    // 段階目標の場合はカレンダーページと同じ PhaseEditModal を開く
    if ((task as any).isPhase && (task as any).originalId != null && (task as any)._phaseIndex != null) {
      const originalId = (task as any).originalId as number;
      const phaseIndex = (task as any)._phaseIndex as number;
      const eventToEdit: CalendarEvent = {
        id: `task-${originalId}-phase-${phaseIndex}`,
        title: task.name,
        start: task.due_date ? parseISO(task.due_date) : new Date(),
        allDay: true,
        extendedProps: {
          type: 'task',
          isPhase: true,
          taskId: originalId,
          isCompleted: !!(task as any)._isCompleted,
        },
      };
      setPhaseEventToEdit(eventToEdit);
      setIsPhaseEditModalOpen(true);
      return;
    }
    setTaskEditId(task.id);
  };

  const handleTaskClick = (task: Task) => {
    handleTaskDoubleClick(task);
  };

  const handleEditTaskFull = (task: Task) => {
    setTaskEditId(task.id);
    setIsDrawerOpen(false); // ドロワーを閉じてダイアログを見やすくする
  };

  const handleUpdateTaskQuick = async (taskId: number, updates: Partial<Task>) => {
    try {
      await api.put(`/tasks/${taskId}`, updates);
      // ローカルStateの更新
      if (selectedTaskForDetail && selectedTaskForDetail.id === taskId) {
        setSelectedTaskForDetail({ ...selectedTaskForDetail, ...updates });
      }
      // 全データを再取得して画面全体に反映
      await fetchAllData();
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  };

  const handleSavePhase = async (phaseUpdateData: { taskId: number; phaseIndex: number; newName: string; newDate: string | null; isCompleted: boolean }) => {
    try {
      const task = tasks.find(t => t.id === Number(phaseUpdateData.taskId));
      if (!task) return;
      const currentPhases = task.phases || [];
      if (phaseUpdateData.phaseIndex >= 0 && phaseUpdateData.phaseIndex < currentPhases.length) {
        const updatedPhases = [...currentPhases];
        updatedPhases[phaseUpdateData.phaseIndex] = {
          ...updatedPhases[phaseUpdateData.phaseIndex],
          name: phaseUpdateData.newName,
          date: phaseUpdateData.newDate || updatedPhases[phaseUpdateData.phaseIndex].date,
          is_completed: phaseUpdateData.isCompleted,
        };
        await api.put(`/tasks/${phaseUpdateData.taskId}`, { phases: updatedPhases });
        setIsPhaseEditModalOpen(false);
        setPhaseEventToEdit(null);
        setSnackbar({ open: true, message: '段階目標を更新しました', severity: 'success' });
        await fetchAllData();
      }
    } catch (error) {
      console.error('Failed to save phase:', error);
      setSnackbar({ open: true, message: '段階目標の保存に失敗しました', severity: 'error' });
    }
  };

  const handleDeletePhase = async () => {
    if (!phaseEventToEdit?.extendedProps?.taskId) return;
    try {
      const taskId = Number(phaseEventToEdit.extendedProps.taskId);
      const phaseIndex = Number(phaseEventToEdit.id.split('-').pop());
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;
      const currentPhases = task.phases || [];
      if (phaseIndex >= 0 && phaseIndex < currentPhases.length) {
        const updatedPhases = currentPhases.filter((_, index) => index !== phaseIndex);
        await api.put(`/tasks/${taskId}`, { phases: updatedPhases });
        setIsPhaseEditModalOpen(false);
        setPhaseEventToEdit(null);
        setSnackbar({ open: true, message: '段階目標を削除しました', severity: 'success' });
        await fetchAllData();
      }
    } catch (error) {
      console.error('Failed to delete phase:', error);
      setSnackbar({ open: true, message: '段階目標の削除に失敗しました', severity: 'error' });
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
  const isDarkMode = theme.palette.mode === 'dark';
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'));

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 } }}>
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Breadcrumbs sx={{ mb: 1.5 }}>
            <Link color="inherit" onClick={() => navigate('/dashboard')} sx={{ cursor: 'pointer', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
              App
            </Link>
            <Typography color="text.primary" sx={{ fontWeight: 500 }}>Users</Typography>
          </Breadcrumbs>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <PeopleIcon sx={{ fontSize: '2rem', color: '#2196F3' }} />
            <Typography
              variant="h4"
              sx={{
                fontWeight: 800,
                background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                fontSize: { xs: '1.75rem', sm: '2.25rem' }
              }}
            >
              User Management
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.95rem' }}>
            チームメンバーの権限設定、タスク負荷の状況、グループ所属を管理します。
          </Typography>
        </Box>
        {isAdmin && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleAddUserClick}
              sx={{
                textTransform: 'none',
                borderRadius: 2,
                px: 3,
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(33, 150, 243, 0.3)',
                '&:hover': {
                  boxShadow: '0 6px 16px rgba(33, 150, 243, 0.4)',
                }
              }}
            >
              ユーザー追加
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={handleOpenDeleteDialog}
              disabled={users.length === 0}
              sx={{
                textTransform: 'none',
                borderRadius: 2,
                fontWeight: 600
              }}
            >
              ユーザー削除
            </Button>
          </Box>
        )}
      </Box>

      {loading && <CircularProgress sx={{ display: 'block', margin: 'auto', my: 4 }} />}
      {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}

      {!loading && !error && (
        <Grid container spacing={3}>
          {/* ユーザー別タスクリスト */}
          {usersWithTasks.length > 0 && (
            <Grid item xs={12}>
              <Paper sx={{ p: { xs: 1.5, sm: 2 }, mb: 2, overflow: 'auto' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <AssignmentIcon sx={{ mr: 1, color: 'primary.main', fontSize: { xs: 20, sm: 24 } }} />
                  <Typography variant="h6" sx={{ fontWeight: 'bold', fontSize: { xs: '1rem', sm: '1.25rem' } }}>
                    {isNarrow ? `タスクリスト（${usersWithTasks.length}名）` : `ユーザー別タスクリスト（${usersWithTasks.length}名）`}
                  </Typography>
                </Box>
                {false ? (
                  /* 縦リスト: ユーザーごとにカード、中に今日/遅延/期限間近/その他とタスク名を並べる */
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {usersWithTasks.map((user) => {
                      const info = userTaskInfo[user.id];
                      const part = info ? partitionTasksByCategory(info.tasks) : { today: [], delayed: [], dueSoon: [], other: [] as Task[] };
                      return (
                        <Card key={user.id} variant="outlined" sx={{ borderLeft: part.today.length > 0 ? '4px solid #1565C0' : part.delayed.length > 0 ? '4px solid #C62828' : 'none', ...(userIdsInBoth.has(user.id) ? { bgcolor: isDarkMode ? 'rgba(156, 39, 176, 0.12)' : 'rgba(156, 39, 176, 0.07)' } : {}) }}>
                          <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Avatar src={user.iconUrl || undefined} sx={{ width: 36, height: 36 }}>
                                  {(user.name || user.username || '')?.[0]?.toUpperCase()}
                                </Avatar>
                                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>{user.name || user.username}</Typography>
                                {user.role === 'admin' && <Chip label="管理者" size="small" color="secondary" />}
                              </Box>
                              {isAdmin && (
                                <Box>
                                  <IconButton size="small" onClick={() => handleEditUserClick(user)} aria-label="edit"><EditIcon fontSize="small" /></IconButton>
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
                                    {part.delayed.map((t) => {
                                      const isPhase = (t as any).isPhase;
                                      return (
                                        <Tooltip key={t.id} title={`📁 ${info?.projectNames[t.project_id ?? 0] || '—'} / 期日: ${t.due_date ? new Date(t.due_date).toLocaleDateString('ja-JP') : '—'} — クリックで編集`} slotProps={taskTooltipSlotProps}>
                                          <Chip
                                            size="small"
                                            label={t.name}
                                            variant={isPhase ? "outlined" : "filled"}
                                            sx={{
                                              bgcolor: isPhase ? 'transparent' : (isDarkMode ? 'rgba(198, 40, 40, 0.22)' : '#FFEBEE'),
                                              color: isDarkMode ? '#EF9A9A' : '#C62828',
                                              borderColor: isPhase ? (isDarkMode ? '#EF9A9A' : '#C62828') : 'transparent',
                                              maxWidth: 200,
                                              cursor: 'pointer'
                                            }}
                                            onClick={(e) => { e.stopPropagation(); handleTaskDoubleClick(t); }}
                                          />
                                        </Tooltip>
                                      );
                                    })}
                                  </Box>
                                </Box>
                              )}
                              {part.today.length > 0 && (
                                <Box>
                                  <Typography variant="caption" sx={{ color: '#1565C0', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                                    <TodayIcon fontSize="small" /> 今日中
                                  </Typography>
                                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {part.today.map((t) => {
                                      const isPhase = (t as any).isPhase;
                                      return (
                                        <Tooltip key={t.id} title={`📁 ${info?.projectNames[t.project_id ?? 0] || '—'} / 期日: ${t.due_date ? new Date(t.due_date).toLocaleDateString('ja-JP') : '—'} — クリックで編集`} slotProps={taskTooltipSlotProps}>
                                          <Chip
                                            size="small"
                                            label={t.name}
                                            variant={isPhase ? "outlined" : "filled"}
                                            sx={{
                                              bgcolor: isPhase ? 'transparent' : (isDarkMode ? 'rgba(21, 101, 192, 0.22)' : '#E3F2FD'),
                                              color: isDarkMode ? '#90CAF9' : '#1565C0',
                                              borderColor: isPhase ? (isDarkMode ? '#90CAF9' : '#1565C0') : 'transparent',
                                              maxWidth: 200,
                                              cursor: 'pointer'
                                            }}
                                            onClick={(e) => { e.stopPropagation(); handleTaskDoubleClick(t); }}
                                          />
                                        </Tooltip>
                                      );
                                    })}
                                  </Box>
                                </Box>
                              )}
                              {part.dueSoon.length > 0 && (
                                <Box>
                                  <Typography variant="caption" sx={{ color: '#E65100', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                                    <ScheduleIcon fontSize="small" /> 期限が1週間以内
                                  </Typography>
                                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {part.dueSoon.map((t) => {
                                      const isPhase = (t as any).isPhase;
                                      return (
                                        <Tooltip key={t.id} title={`📁 ${info?.projectNames[t.project_id ?? 0] || '—'} / 期日: ${t.due_date ? new Date(t.due_date).toLocaleDateString('ja-JP') : '—'} — クリックで編集`} slotProps={taskTooltipSlotProps}>
                                          <Chip
                                            size="small"
                                            label={t.name}
                                            variant={isPhase ? "outlined" : "filled"}
                                            sx={{
                                              bgcolor: isPhase ? 'transparent' : (isDarkMode ? 'rgba(230, 81, 0, 0.22)' : '#FFF3E0'),
                                              color: isDarkMode ? '#FFB74D' : '#E65100',
                                              borderColor: isPhase ? (isDarkMode ? '#FFB74D' : '#E65100') : 'transparent',
                                              maxWidth: 200,
                                              cursor: 'pointer'
                                            }}
                                            onClick={(e) => { e.stopPropagation(); handleTaskDoubleClick(t); }}
                                          />
                                        </Tooltip>
                                      );
                                    })}
                                  </Box>
                                </Box>
                              )}
                              {part.other.length > 0 && (
                                <Box>
                                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold', mb: 0.5, display: 'block' }}>余裕をもって進める</Typography>
                                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {part.other.map((t) => {
                                      const isPhase = (t as any).isPhase;
                                      return (
                                        <Tooltip key={t.id} title={`📁 ${info?.projectNames[t.project_id ?? 0] || '—'}${t.due_date ? ` / 期日: ${new Date(t.due_date).toLocaleDateString('ja-JP')}` : ''} — クリックで編集`} slotProps={taskTooltipSlotProps}>
                                          <Chip
                                            size="small"
                                            label={t.name}
                                            variant="outlined"
                                            sx={{
                                              maxWidth: 200,
                                              cursor: 'pointer',
                                              ...(isPhase && { borderStyle: 'dashed' })
                                            }}
                                            onClick={(e) => { e.stopPropagation(); handleTaskDoubleClick(t); }}
                                          />
                                        </Tooltip>
                                      );
                                    })}
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
                  <TableContainer sx={{ overflowX: 'auto' }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 'bold', minWidth: 100, width: 100, bgcolor: 'background.paper', position: 'sticky', left: 0, zIndex: 10 }}>ユーザー</TableCell>
                          <TableCell sx={{ fontWeight: 'bold', minWidth: 180, bgcolor: isDarkMode ? 'rgba(198, 40, 40, 0.18)' : '#FFEBEE', color: isDarkMode ? '#EF9A9A' : '#C62828' }}><WarningIcon sx={{ fontSize: 18, verticalAlign: 'middle', mr: 0.5 }} />遅れている</TableCell>
                          <TableCell sx={{ fontWeight: 'bold', minWidth: 180, bgcolor: isDarkMode ? 'rgba(21, 101, 192, 0.18)' : '#E3F2FD', color: isDarkMode ? '#90CAF9' : '#1565C0' }}><TodayIcon sx={{ fontSize: 18, verticalAlign: 'middle', mr: 0.5 }} />今日中</TableCell>
                          <TableCell sx={{ fontWeight: 'bold', minWidth: 180, bgcolor: isDarkMode ? 'rgba(230, 81, 0, 0.18)' : '#FFF3E0', color: isDarkMode ? '#FFB74D' : '#E65100' }}><ScheduleIcon sx={{ fontSize: 18, verticalAlign: 'middle', mr: 0.5 }} />期限が1週間以内</TableCell>
                          <TableCell sx={{ fontWeight: 'bold', minWidth: 160, bgcolor: 'background.paper' }}>余裕をもって進める</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {usersWithTasks.map((user) => {
                          const info = userTaskInfo[user.id];
                          const part = info ? partitionTasksByCategory(info.tasks) : { today: [], delayed: [], dueSoon: [], other: [] as Task[] };
                          return (
                            <TableRow key={user.id} hover sx={{ ...(userIdsInBoth.has(user.id) ? { bgcolor: isDarkMode ? 'rgba(156, 39, 176, 0.12)' : 'rgba(156, 39, 176, 0.07)' } : {}) }}>
                              <TableCell
                                sx={{
                                  verticalAlign: 'top',
                                  minWidth: 100,
                                  width: 100,
                                  p: 1,
                                  position: 'sticky',
                                  left: 0,
                                  zIndex: 9,
                                  bgcolor: 'background.paper',
                                  borderLeft: part.today.length > 0 ? '4px solid #1565C0' : part.delayed.length > 0 ? '4px solid #C62828' : '4px solid transparent',
                                  backgroundImage: userIdsInBoth.has(user.id) ? (isDarkMode ? 'linear-gradient(rgba(156, 39, 176, 0.12), rgba(156, 39, 176, 0.12))' : 'linear-gradient(rgba(156, 39, 176, 0.07), rgba(156, 39, 176, 0.07))') : 'none'
                                }}
                              >
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Avatar src={user.iconUrl || undefined} sx={{ width: 28, height: 28, fontSize: '0.875rem' }}>{(user.name || user.username || '')?.[0]?.toUpperCase()}</Avatar>
                                    <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '0.8rem', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name || user.username}</Typography>
                                  </Box>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                                    {user.role === 'admin' && <Chip label="管理者" size="small" color="secondary" sx={{ height: 20, fontSize: '0.65rem' }} />}
                                    {scoreUserRoles.filter(sr => sr.user_id === user.id).map((sr, idx) => (
                                      <Tooltip key={idx} title={projects.find(p => p.id === sr.project_id)?.name || 'Project'}>
                                        <Chip
                                          label={sr.role.toUpperCase()}
                                          size="small"
                                          variant="outlined"
                                          sx={{ height: 20, fontSize: '0.6rem', borderColor: alpha(theme.palette.primary.main, 0.5), color: theme.palette.primary.main }}
                                        />
                                      </Tooltip>
                                    ))}
                                    {isAdmin && (
                                      <IconButton size="small" onClick={() => handleEditUserClick(user)} aria-label="edit" sx={{ p: 0.5, ml: 'auto' }}><EditIcon sx={{ fontSize: '1rem' }} /></IconButton>
                                    )}
                                  </Box>
                                </Box>
                              </TableCell>
                              <TableCell sx={{ verticalAlign: 'top', bgcolor: isDarkMode ? 'rgba(244, 67, 54, 0.1)' : 'rgba(244, 67, 54, 0.04)' }}>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                  {part.delayed.length === 0 ? '—' : part.delayed.map((t) => {
                                    const isPhase = (t as any).isPhase;
                                    return (
                                      <Tooltip key={t.id} title={`📁 ${info?.projectNames[t.project_id ?? 0] || '—'} / 期日: ${t.due_date ? new Date(t.due_date).toLocaleDateString('ja-JP') : '—'} — クリックで編集`} slotProps={taskTooltipSlotProps} enterTouchDelay={0} leaveTouchDelay={1500}>
                                        <Chip
                                          size="small"
                                          label={t.name}
                                          variant={isPhase ? "outlined" : "filled"}
                                          sx={{
                                            bgcolor: isPhase ? 'transparent' : (isDarkMode ? 'rgba(198, 40, 40, 0.22)' : '#FFEBEE'),
                                            color: isDarkMode ? '#EF9A9A' : '#C62828',
                                            borderColor: isPhase ? (isDarkMode ? '#EF9A9A' : '#C62828') : 'transparent',
                                            cursor: 'pointer',
                                            userSelect: 'none',
                                            WebkitUserSelect: 'none',
                                            WebkitTouchCallout: 'none',
                                            touchAction: 'manipulation',
                                          }}
                                          onClick={(e) => { e.stopPropagation(); handleTaskClick(t); }}
                                          onDoubleClick={(e) => { e.stopPropagation(); handleTaskDoubleClick(t); }}
                                        />
                                      </Tooltip>
                                    );
                                  })}
                                </Box>
                              </TableCell>
                              <TableCell sx={{ verticalAlign: 'top', bgcolor: isDarkMode ? 'rgba(33, 150, 243, 0.1)' : 'rgba(33, 150, 243, 0.04)' }}>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                  {part.today.length === 0 ? '—' : part.today.map((t) => {
                                    const isPhase = (t as any).isPhase;
                                    return (
                                      <Tooltip key={t.id} title={`📁 ${info?.projectNames[t.project_id ?? 0] || '—'} / 期日: ${t.due_date ? new Date(t.due_date).toLocaleDateString('ja-JP') : '—'} — クリックで編集`} slotProps={taskTooltipSlotProps} enterTouchDelay={0} leaveTouchDelay={1500}>
                                        <Chip
                                          size="small"
                                          label={t.name}
                                          variant={isPhase ? "outlined" : "filled"}
                                          sx={{
                                            bgcolor: isPhase ? 'transparent' : (isDarkMode ? 'rgba(21, 101, 192, 0.22)' : '#E3F2FD'),
                                            color: isDarkMode ? '#90CAF9' : '#1565C0',
                                            borderColor: isPhase ? (isDarkMode ? '#90CAF9' : '#1565C0') : 'transparent',
                                            cursor: 'pointer',
                                            userSelect: 'none',
                                            WebkitUserSelect: 'none',
                                            WebkitTouchCallout: 'none',
                                            touchAction: 'manipulation',
                                          }}
                                          onClick={(e) => { e.stopPropagation(); handleTaskClick(t); }}
                                          onDoubleClick={(e) => { e.stopPropagation(); handleTaskDoubleClick(t); }}
                                        />
                                      </Tooltip>
                                    );
                                  })}
                                </Box>
                              </TableCell>
                              <TableCell sx={{ verticalAlign: 'top', bgcolor: isDarkMode ? 'rgba(255, 152, 0, 0.1)' : 'rgba(255, 152, 0, 0.04)' }}>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                  {part.dueSoon.length === 0 ? '—' : part.dueSoon.map((t) => {
                                    const isPhase = (t as any).isPhase;
                                    return (
                                      <Tooltip key={t.id} title={`📁 ${info?.projectNames[t.project_id ?? 0] || '—'} / 期日: ${t.due_date ? new Date(t.due_date).toLocaleDateString('ja-JP') : '—'} — クリックで編集`} slotProps={taskTooltipSlotProps} enterTouchDelay={0} leaveTouchDelay={1500}>
                                        <Chip
                                          size="small"
                                          label={t.name}
                                          variant={isPhase ? "outlined" : "filled"}
                                          sx={{
                                            bgcolor: isPhase ? 'transparent' : (isDarkMode ? 'rgba(230, 81, 0, 0.22)' : '#FFF3E0'),
                                            color: isDarkMode ? '#FFB74D' : '#E65100',
                                            borderColor: isPhase ? (isDarkMode ? '#FFB74D' : '#E65100') : 'transparent',
                                            cursor: 'pointer',
                                            userSelect: 'none',
                                            WebkitUserSelect: 'none',
                                            WebkitTouchCallout: 'none',
                                            touchAction: 'manipulation',
                                          }}
                                          onClick={(e) => { e.stopPropagation(); handleTaskClick(t); }}
                                          onDoubleClick={(e) => { e.stopPropagation(); handleTaskDoubleClick(t); }}
                                        />
                                      </Tooltip>
                                    );
                                  })}
                                </Box>
                              </TableCell>
                              <TableCell sx={{ verticalAlign: 'top' }}>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                  {part.other.length === 0 ? '—' : part.other.map((t) => {
                                    const isPhase = (t as any).isPhase;
                                    return (
                                      <Tooltip key={t.id} title={`📁 ${info?.projectNames[t.project_id ?? 0] || '—'}${t.due_date ? ` / 期日: ${new Date(t.due_date).toLocaleDateString('ja-JP')}` : ''} — クリックで編集`} slotProps={taskTooltipSlotProps} enterTouchDelay={0} leaveTouchDelay={1500}>
                                        <Chip
                                          size="small"
                                          label={t.name}
                                          variant="outlined"
                                          sx={{
                                            cursor: 'pointer',
                                            ...(isPhase && { borderStyle: 'dashed' }),
                                            userSelect: 'none',
                                            WebkitUserSelect: 'none',
                                            WebkitTouchCallout: 'none',
                                            touchAction: 'manipulation',
                                          }}
                                          onClick={(e) => { e.stopPropagation(); handleTaskDoubleClick(t); }}
                                        />
                                      </Tooltip>
                                    );
                                  })}
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
              <Paper sx={{ p: { xs: 1.5, sm: 2 }, mb: 2, overflow: 'auto' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <GroupIcon sx={{ mr: 1, color: 'secondary.main', fontSize: { xs: 20, sm: 24 } }} />
                  <Typography variant="h6" sx={{ fontWeight: 'bold', fontSize: { xs: '1rem', sm: '1.25rem' } }}>
                    {isNarrow ? `グループ（${usersInGroupsList.length}名）` : `グループ所属ユーザー（${usersInGroupsList.length}名）`}
                  </Typography>
                </Box>
                {isNarrow ? (
                  /* 縦リスト: ユーザーごとにカード、中に所属グループを表示 */
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {usersInGroupsList.map((user) => {
                      const userGroupsList = userGroupMap.get(user.id) || [];
                      return (
                        <Card key={user.id} variant="outlined" sx={{ borderLeft: '4px solid #9C27B0', ...(userIdsInBoth.has(user.id) ? { bgcolor: isDarkMode ? 'rgba(156, 39, 176, 0.12)' : 'rgba(156, 39, 176, 0.07)' } : {}) }}>
                          <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Avatar src={user.iconUrl || undefined} sx={{ width: 36, height: 36 }}>
                                  {(user.name || user.username || '')?.[0]?.toUpperCase()}
                                </Avatar>
                                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>{user.name || user.username}</Typography>
                                {user.role === 'admin' && <Chip label="管理者" size="small" color="secondary" />}
                              </Box>
                              {isAdmin && (
                                <Box>
                                  <IconButton size="small" onClick={() => handleEditUserClick(user)} aria-label="edit"><EditIcon fontSize="small" /></IconButton>
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
                                        bgcolor: isDarkMode ? 'rgba(156, 39, 176, 0.28)' : '#E1BEE7',
                                        color: isDarkMode ? '#E1BEE7' : '#7B1FA2',
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
                          <TableCell sx={{ fontWeight: 'bold', minWidth: 300, bgcolor: isDarkMode ? 'rgba(156, 39, 176, 0.18)' : '#F3E5F5', color: isDarkMode ? '#E1BEE7' : '#9C27B0' }}>
                            <GroupIcon sx={{ fontSize: 18, verticalAlign: 'middle', mr: 0.5 }} />所属グループ
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {usersInGroupsList.map((user) => {
                          const userGroupsList = userGroupMap.get(user.id) || [];
                          return (
                            <TableRow key={user.id} hover sx={{ borderLeft: '4px solid #9C27B0', ...(userIdsInBoth.has(user.id) ? { bgcolor: isDarkMode ? 'rgba(156, 39, 176, 0.12)' : 'rgba(156, 39, 176, 0.07)' } : {}) }}>
                              <TableCell sx={{ verticalAlign: 'top', minWidth: 160 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                  <Avatar src={user.iconUrl || undefined} sx={{ width: 32, height: 32 }}>{(user.name || user.username || '')?.[0]?.toUpperCase()}</Avatar>
                                  <Box>
                                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{user.name || user.username}</Typography>
                                    {user.role === 'admin' && <Chip label="管理者" size="small" color="secondary" sx={{ mt: 0.25 }} />}
                                  </Box>
                                  {isAdmin && (
                                    <Box sx={{ ml: 'auto' }}>
                                      <IconButton size="small" onClick={() => handleEditUserClick(user)} aria-label="edit"><EditIcon fontSize="small" /></IconButton>
                                    </Box>
                                  )}
                                </Box>
                              </TableCell>
                              <TableCell sx={{ verticalAlign: 'top', bgcolor: isDarkMode ? 'rgba(156, 39, 176, 0.1)' : 'rgba(156, 39, 176, 0.04)' }}>
                                {userGroupsList.length > 0 ? (
                                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {userGroupsList.map((group) => (
                                      <Chip
                                        key={group.id}
                                        label={group.name}
                                        size="small"
                                        sx={{
                                          bgcolor: isDarkMode ? 'rgba(156, 39, 176, 0.28)' : '#E1BEE7',
                                          color: isDarkMode ? '#E1BEE7' : '#7B1FA2',
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
              <Paper
                sx={{
                  p: { xs: 1.5, sm: 2 },
                  bgcolor: isDarkMode ? 'background.default' : 'grey.50',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <PersonIcon sx={{ mr: 1, color: 'text.secondary', fontSize: { xs: 20, sm: 24 } }} />
                  <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'text.secondary', fontSize: { xs: '1rem', sm: '1.25rem' } }}>
                    {isNarrow ? `未担当 (${usersWithoutTasks.length}名)` : `タスク未担当 (${usersWithoutTasks.length}名)`}
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
                            <Avatar src={user.iconUrl || undefined} alt={user.name || user.username || ''}>
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
                                {scoreUserRoles.filter(sr => sr.user_id === user.id).map((sr, idx) => (
                                  <Chip
                                    key={idx}
                                    label={sr.role.toUpperCase()}
                                    size="small"
                                    variant="outlined"
                                    sx={{ fontSize: '0.65rem', height: 20 }}
                                  />
                                ))}
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

      {/* タスク編集ダイアログ（タスク部分ダブルクリックで表示・共通コンポーネント） */}
      <TaskEditDialog
        open={taskEditId != null}
        taskId={taskEditId}
        onClose={() => setTaskEditId(null)}
        onSaved={() => {
          setTaskEditId(null);
          setSnackbar({ open: true, message: 'タスクを更新しました', severity: 'success' });
          fetchAllData();
        }}
      />

      {/* 段階目標編集ダイアログ（段階目標ダブルクリックで表示・カレンダーページと同じ） */}
      <PhaseEditModal
        open={isPhaseEditModalOpen}
        onClose={() => {
          setIsPhaseEditModalOpen(false);
          setPhaseEventToEdit(null);
        }}
        onSave={handleSavePhase}
        onDelete={handleDeletePhase}
        eventToEdit={phaseEventToEdit}
      />

      {/* ユーザー削除ダイアログ（管理者のみ） */}
      {isAdmin && (
        <Dialog open={isDeleteDialogOpen} onClose={handleCloseDeleteDialog} maxWidth="xs" fullWidth>
          <DialogTitle>ユーザー削除</DialogTitle>
          <DialogContent>
            <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="body2" color="text.secondary">
                削除するユーザーを選択してください。関連するタスクや設定も影響を受ける可能性があります。
              </Typography>
              <FormControl fullWidth>
                <InputLabel id="delete-user-select-label">ユーザー</InputLabel>
                <Select
                  labelId="delete-user-select-label"
                  value={selectedDeleteUserId}
                  label="ユーザー"
                  onChange={(e) => setSelectedDeleteUserId(e.target.value as string)}
                >
                  {users.map((u) => (
                    <MenuItem key={u.id} value={String(u.id)}>
                      {u.name || u.username || u.email || `ID: ${u.id}`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDeleteDialog}>キャンセル</Button>
            <Button
              onClick={handleDeleteUserFromDialog}
              variant="contained"
              color="error"
              disabled={!selectedDeleteUserId}
            >
              削除実行
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {/* タスク詳細ドロワー */}
      <Drawer
        anchor="right"
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        PaperProps={{
          sx: { width: { xs: '100%', sm: 400 }, maxWidth: '100%' }
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>タスク詳細</Typography>
          <IconButton onClick={() => setIsDrawerOpen(false)}>
            <CloseIcon />
          </IconButton>
        </Box>
        {selectedTaskForDetail && (
          <TaskQuickDetail
            task={selectedTaskForDetail}
            projects={projects}
            users={users}
            onUpdate={handleUpdateTaskQuick}
            onEditFull={handleEditTaskFull}
          />
        )}
      </Drawer>

      {/* 操作結果の通知 */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default UserManagementPage;
