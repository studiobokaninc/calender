import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { TaskLabel } from '@/components/common/TaskLabel';
import { useNavigate } from 'react-router-dom';
import {
    Box, Typography, CircularProgress, Paper, Chip, Select, MenuItem, FormControl, InputLabel, Grid,
    Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Stack,
    Snackbar, Alert, SelectChangeEvent, Tooltip, Divider, useTheme, Drawer, useMediaQuery,
    Card, CardContent, CardActionArea, Avatar, Breadcrumbs, Link
} from '@mui/material';
import {
    Edit as EditIcon, Delete as DeleteIcon, History as HistoryIcon, EditNote as BulkEditIcon,
    FilterList as FilterListIcon, Close as CloseIcon,
    CalendarToday as CalendarIcon, Folder as FolderIcon, PriorityHigh as PriorityIcon,
    Add as AddIcon, Task as TaskIcon
} from '@mui/icons-material';
import { IconButton, Fab } from '@mui/material';
import api, { mockDataApi } from '../services/api';

import { Task, Project, User } from '../types'; // Import User type as well
import { format, parseISO, isValid, isBefore, startOfDay } from 'date-fns';
import { ja } from 'date-fns/locale';
import { DataGrid, GridColDef, GridRenderCellParams, GridSortModel } from '@mui/x-data-grid';
import { useTasksPageState, usePageState } from '../contexts/PageStateContext';
import { useAuth } from '../contexts/AuthContext';
import { TaskEditDialog } from '../components/SearchEditDialogs';
import { TaskQuickDetail } from '../components/TaskQuickDetail';




// Helper function to format dates (similar to other pages)
const formatDate = (dateInput: string | Date | null | undefined): string => {
    if (!dateInput) return '-';
    try {
        const dateObj = typeof dateInput === 'string' ? parseISO(dateInput) : dateInput;
        if (isValid(dateObj)) {
            return format(dateObj, 'yyyy/MM/dd', { locale: ja });
        } else {
            return '-';
        }
    } catch (error) {
        return '-';
    }
};




// Helper function to get task status color (similar to EventDetailsPanel)
const getTaskStatusColor = (status?: string | null): string => {
    switch (status) {
        case 'todo': return '#2196F3';
        case 'in-progress': return '#FF9800';
        case 'review': return '#9C27B0';
        case 'delayed': return '#F44336';
        case 'completed': return '#9E9E9E';
        default: return '#BDBDBD';
    }
};

const getTaskStatusLabel = (status?: string | null): string => {
    switch (status) {
        case 'todo': return '未着手';
        case 'in-progress': return '進行中';
        case 'review': return 'レビュー中';
        case 'delayed': return '遅延';
        case 'completed': return '完了';
        default: return status || '未定';
    }
};

const isDatePast = (dateStr: string | null | undefined): boolean => {
    if (!dateStr) return false;
    const date = parseISO(dateStr);
    if (!isValid(date)) return false;
    return isBefore(startOfDay(date), startOfDay(new Date()));
};










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
    shot_id: number | null;
}








interface StatusHistory {
    id: number;
    task_id: number;
    status: string;
    changed_at: string;
    changed_by: number;
}




const TasksPage: React.FC = () => {
    const navigate = useNavigate();
    const { user: currentUser } = useAuth();
    const isAdmin = currentUser?.role === 'admin';

    const theme = useTheme();
    const isDark = theme.palette.mode === 'dark';
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const [tasks, setTasks] = useState<Task[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

    // ページ状態管理の使用
    const { tasksState, updateTasksState, isInitialLoad, globalData, updateGlobalData } = useTasksPageState();
    const { refreshGlobalData } = usePageState();

    // 状態を分離（初期化時はページ状態から取得）
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [projectFilter, setProjectFilter] = useState<string>('');
    const [assigneeFilter, setAssigneeFilter] = useState<string>('');
    const [paginationModel, setPaginationModel] = useState({
        page: 0,
        pageSize: 15,
    });
    const [sortModel, setSortModel] = useState<GridSortModel>([]);
    const [stateRestored, setStateRestored] = useState(false);

    // フィルターの前回値を記憶するためのref
    const prevFiltersRef = useRef({
        statusFilter: '',
        projectFilter: '',
        assigneeFilter: ''
    });

    // DataGridコンテナへの参照（マウスホイール横スクロール用）
    const dataGridContainerRef = useRef<HTMLDivElement>(null);

    // ページ状態が復元されたらローカル状態を更新
    useEffect(() => {
        if (!isInitialLoad) {
            setStatusFilter(tasksState.statusFilter);
            setProjectFilter(tasksState.projectFilter);
            setAssigneeFilter(tasksState.assigneeFilter);
            setPaginationModel(tasksState.paginationModel);
            setSortModel(tasksState.sortModel);
            // 状態復元時は前回値も更新（ページリセットを防ぐため）
            prevFiltersRef.current = {
                statusFilter: tasksState.statusFilter,
                projectFilter: tasksState.projectFilter,
                assigneeFilter: tasksState.assigneeFilter
            };
            setStateRestored(true);
        }
    }, [tasksState, isInitialLoad]);




    const [dependencySelectOpen, setDependencySelectOpen] = useState(false);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false); // Drawer state
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [openDialog, setOpenDialog] = useState(false); // 従来のモーダルも残す（ダブルクリック時など）
    const [editTaskId, setEditTaskId] = useState<number | null>(null);
    const [currentTask, setCurrentTask] = useState<TaskFormData>({
        id: null,
        name: '',
        description: '',
        status: 'todo',
        priority: 'low',
        assigned_to: null,
        project_id: null,
        start_date: format(new Date(), 'yyyy-MM-dd'),
        due_date: format(new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
        cost: 0,
        type: '',
        seqID: '',
        shotID: '',
        dependsOn: [],
        shot_id: null
    });
    const [shots, setShots] = useState<{ id: number; shotID: string; seqID: string }[]>([]);

    useEffect(() => {
        if (!currentTask.project_id) {
            setShots([]);
            return;
        }
        mockDataApi.getProductionTracker(currentTask.project_id)
            .then((data: any) => {
                const allShots: { id: number; shotID: string; seqID: string }[] = [];
                if (data && data.sequences) {
                    data.sequences.forEach((seqData: any) => {
                        if (seqData.shots) {
                            seqData.shots.forEach((s: any) => {
                                allShots.push({ id: s.id, shotID: s.shotID, seqID: seqData.seqID });
                            });
                        }
                    });
                }
                setShots(allShots);
            })


            .catch(() => console.error('Failed to fetch shots'));
    }, [currentTask.project_id]);


    const [snackbar, setSnackbar] = useState<{

        open: boolean;
        message: string;
        severity: 'success' | 'error' | 'info' | 'warning';
    }>({
        open: false,
        message: '',
        severity: 'info'
    });




    // ステータス履歴表示用の状態
    const [statusHistory, setStatusHistory] = useState<StatusHistory[]>([]);
    const [historyDialogOpen, setHistoryDialogOpen] = useState(false);

    // 一括編集（選択された行IDの配列）
    const [selectionModel, setSelectionModel] = useState<number[]>([]);
    const [bulkEditOpen, setBulkEditOpen] = useState(false);
    const [bulkEditSaving, setBulkEditSaving] = useState(false);
    const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
    const [bulkConfirmCount, setBulkConfirmCount] = useState(0);
    const [bulkEditForm, setBulkEditForm] = useState<{ status: string; assigned_to: number | ''; due_date: string; priority: string }>({
        status: '', assigned_to: '', due_date: '', priority: ''
    });

    const handleBulkEditApply = () => {
        if (selectionModel.length === 0) return;
        setBulkConfirmCount(selectionModel.length);
        setBulkConfirmOpen(true);
    };

    const handleBulkEditApplyConfirmed = async () => {
        setBulkConfirmOpen(false);
        const taskIds = selectionModel;
        if (taskIds.length === 0) return;
        const payload: { task_ids: number[]; status?: string; assigned_to?: number; due_date?: string; priority?: string } = { task_ids: taskIds };
        if (bulkEditForm.status) payload.status = bulkEditForm.status;
        if (bulkEditForm.assigned_to !== '') payload.assigned_to = bulkEditForm.assigned_to as number;
        if (bulkEditForm.due_date) payload.due_date = bulkEditForm.due_date + 'T00:00:00+09:00';
        if (bulkEditForm.priority) payload.priority = bulkEditForm.priority;
        if (Object.keys(payload).length <= 1) {
            setSnackbar({ open: true, message: '更新する項目を1つ以上選択してください', severity: 'warning' });
            return;
        }
        setBulkEditSaving(true);
        try {
            const res = await api.post<{ updated: number; message: string }>('/tasks/bulk-update', payload);
            setSnackbar({ open: true, message: res.data.message, severity: 'success' });
            setBulkEditOpen(false);
            setSelectionModel([] as number[]);
            setBulkEditForm({ status: '', assigned_to: '', due_date: '', priority: '' });
            if (refreshGlobalData) await refreshGlobalData({ force: true });
            fetchData();
        } catch (err: any) {
            setSnackbar({ open: true, message: err?.response?.data?.detail || '一括更新に失敗しました', severity: 'error' });
        } finally {
            setBulkEditSaving(false);
        }
    };




    // タスク一覧を取得する関数
    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const [tasksResponse, projectsResponse, usersResponse] = await Promise.all([
                api.get('/tasks'),
                api.get('/projects'),
                api.get('/api/users')
            ]);
            const tasksData = tasksResponse.data;
            const projectsData = projectsResponse.data;
            const usersData = usersResponse.data;

            setTasks(tasksData);
            setProjects(projectsData);
            setUsers(usersData);

            // グローバルデータも更新
            if (updateGlobalData) {
                updateGlobalData({
                    tasks: tasksData,
                    projects: projectsData,
                    users: usersData,
                });
            }

            setError(null);
        } catch (err) {
            console.error('データの取得に失敗しました:', err);
            setError('データの取得に失敗しました');
        } finally {
            setLoading(false);
        }
    }, []); // 依存関係を空にして無限ループを防ぐ




    // 初回マウント時のみデータを取得
    useEffect(() => {
        // グローバルデータが既に存在する場合は、それを使用
        if (globalData && globalData.tasks.length > 0 && globalData.projects.length > 0) {
            setTasks(globalData.tasks);
            setProjects(globalData.projects);
            setUsers(globalData.users);
            setLoading(false);
            return;
        }

        // グローバルデータが空または存在しない場合は、データを取得
        if (!globalData || globalData.tasks.length === 0 || globalData.projects.length === 0) {
            fetchData();
        }
    }, []); // 初回マウント時のみ実行

    // globalDataRefreshedイベントをリッスンしてデータを強制更新
    useEffect(() => {
        const handleGlobalDataRefresh = (event: CustomEvent) => {
            const { tasks, projects, users } = event.detail;
            if (tasks) setTasks(tasks);
            if (projects) setProjects(projects);
            if (users) setUsers(users);
        };

        const handleCsvImportCompleted = async () => {
            // CSVインポート完了時はグローバルデータの更新を待つ
            if (refreshGlobalData) {
                await refreshGlobalData({ force: true });
            }
        };

        window.addEventListener('globalDataRefreshed', handleGlobalDataRefresh as unknown as EventListener);
        window.addEventListener('csvImportCompleted', handleCsvImportCompleted as unknown as EventListener);

        return () => {
            window.removeEventListener('globalDataRefreshed', handleGlobalDataRefresh as unknown as EventListener);
            window.removeEventListener('csvImportCompleted', handleCsvImportCompleted as unknown as EventListener);
        };
    }, [refreshGlobalData]);

    // プロジェクト変更イベントをリッスンしてタスクデータを強制更新
    useEffect(() => {
        const handleProjectDeleted = async () => {
            // プロジェクト削除時はタスクも削除されるため、グローバルデータの更新を待つ
            if (refreshGlobalData) {
                await refreshGlobalData({ force: true });
            }
        };

        const handleProjectUpdated = async () => {
            // プロジェクト更新時はタスクデータも再取得
            if (refreshGlobalData) {
                await refreshGlobalData({ force: true });
            }
        };

        const handleProjectStatusUpdated = async () => {
            // プロジェクト表示ステータス更新時はタスクデータも再取得
            if (refreshGlobalData) {
                await refreshGlobalData({ force: true });
            }
        };

        window.addEventListener('projectDeleted', handleProjectDeleted as unknown as EventListener);
        window.addEventListener('projectUpdated', handleProjectUpdated as unknown as EventListener);
        window.addEventListener('projectStatusUpdated', handleProjectStatusUpdated as unknown as EventListener);

        return () => {
            window.removeEventListener('projectDeleted', handleProjectDeleted as unknown as EventListener);
            window.removeEventListener('projectUpdated', handleProjectUpdated as unknown as EventListener);
            window.removeEventListener('projectStatusUpdated', handleProjectStatusUpdated as unknown as EventListener);
        };
    }, [refreshGlobalData]);

    // マウスホイールで横スクロールを実現
    useEffect(() => {
        const container = dataGridContainerRef.current;
        if (!container) return;

        const handleWheel = (e: WheelEvent) => {
            // 横スクロールが可能な場合のみ処理
            const scrollableElement = container.querySelector('.MuiDataGrid-virtualScroller');
            if (!scrollableElement) return;

            // 既に横スクロールしている場合は通常の動作
            if (e.deltaX !== 0) return;

            // スクロール可能な範囲をチェック
            const hasHorizontalScroll = scrollableElement.scrollWidth > scrollableElement.clientWidth;

            // 横スクロールバーが出ている場合は、マウスホイールで横スクロール
            if (hasHorizontalScroll && e.deltaY !== 0) {
                e.preventDefault();
                scrollableElement.scrollLeft += e.deltaY;
            }
        };

        // より互換性の高いイベントリスナーの設定
        // passive: false を明示的に設定（一部のブラウザで必要）
        try {
            container.addEventListener('wheel', handleWheel, { passive: false });
        } catch (e) {
            // 古いブラウザの場合はフォールバック
            container.addEventListener('wheel', handleWheel as EventListener);
        }

        return () => {
            container.removeEventListener('wheel', handleWheel as EventListener);
        };
    }, []);

    // フィルター変更時にページをリセット（実際に値が変わった時のみ）
    useEffect(() => {
        if (stateRestored) {
            const hasFilterChanged =
                prevFiltersRef.current.statusFilter !== statusFilter ||
                prevFiltersRef.current.projectFilter !== projectFilter ||
                prevFiltersRef.current.assigneeFilter !== assigneeFilter;

            if (hasFilterChanged) {
                // ページをリセットした状態で状態を保存
                const resetPaginationModel = {
                    ...paginationModel,
                    page: 0
                };

                // 先に状態保存してから、UIを更新
                updateTasksState({
                    statusFilter,
                    projectFilter,
                    assigneeFilter,
                    paginationModel: resetPaginationModel,
                    sortModel,
                });

                setPaginationModel(resetPaginationModel);

                // 前回値を更新
                prevFiltersRef.current = {
                    statusFilter,
                    projectFilter,
                    assigneeFilter
                };
            }
        }
    }, [statusFilter, projectFilter, assigneeFilter, stateRestored, paginationModel.pageSize, sortModel, updateTasksState]);

    // ページネーションとソートの変更をページ状態に反映（フィルター変更以外）
    useEffect(() => {
        if (stateRestored) {
            // フィルター変更中でないことを確認
            const hasFilterChanged =
                prevFiltersRef.current.statusFilter !== statusFilter ||
                prevFiltersRef.current.projectFilter !== projectFilter ||
                prevFiltersRef.current.assigneeFilter !== assigneeFilter;

            if (!hasFilterChanged) {
                updateTasksState({
                    statusFilter,
                    projectFilter,
                    assigneeFilter,
                    paginationModel,
                    sortModel,
                });
            }
        }
        // paginationModelとsortModelのみを監視（フィルターは監視しない）
    }, [paginationModel.page, paginationModel.pageSize, sortModel, stateRestored]);




    const projectMap = useMemo(() =>
        new Map(projects.map(p => [p.id, p.name]))
        , [projects]);

    // 表示ステータスがオンラインのプロジェクトのみ（カレンダーと同じ要領）
    const onlineProjects = useMemo(() =>
        projects.filter((p: Project) => (p.display_status ?? 'online') === 'online'),
        [projects]
    );

    const userMap = useMemo(() =>
        new Map(users.map(u => [u.id, u.username || u.name || u.email]))
        , [users]);




    const taskMap = useMemo(() =>
        new Map(tasks.map(t => [t.id, t.name]))
        , [tasks]);




    // タスクステータスの定義（編集モーダルと一致）
    const statusOptions = ['todo', 'in-progress', 'review', 'completed', 'delayed'];




    const handleUpdateTaskQuick = async (taskId: number, updates: Partial<Task>) => {
        console.log(`[TasksPage] Updating task ${taskId}:`, updates);
        try {
            await api.put(`/tasks/${taskId}`, updates);
            setHasUnsavedChanges(false);
            // ローカルステータスを更新して再フェッチなしで反映
            setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
            if (selectedTask && selectedTask.id === taskId) {
                const updatedTask = { ...selectedTask, ...updates };
                setSelectedTask(updatedTask);
                console.log(`[TasksPage] Updated selectedTask:`, updatedTask);
            }
        } catch (error) {
            console.error("Failed to update task:", error);
            setSnackbar({ open: true, message: 'タスクの更新に失敗しました', severity: 'error' });
        }
    };

    const filteredTasks = useMemo(() => {
        return tasks.filter(task => {
            const statusMatch = statusFilter === '' || task.status === statusFilter;

            // プロジェクトフィルター: 「プロジェクト未設定」の場合は project_id が null のタスクのみ
            let projectMatch: boolean;
            if (projectFilter === 'no-project') {
                projectMatch = task.project_id == null;
            } else {
                // 通常時は表示ステータスがオンラインのプロジェクトのタスクのみ表示
                const project = task.project_id != null ? projects.find(p => p.id === task.project_id) : null;
                const isOnlineProject = task.project_id == null
                    ? false
                    : (project && (project.display_status ?? 'online') === 'online');
                if (!isOnlineProject) return false;
                projectMatch = projectFilter === '' || String(task.project_id) === projectFilter;
            }
            let assigneeMatch = false;
            if (assigneeFilter === '') {
                assigneeMatch = true;
            } else if (assigneeFilter === 'unassigned') {
                assigneeMatch = !task.assigned_to;
            } else {
                assigneeMatch = String(task.assigned_to) === assigneeFilter;
            }
            return statusMatch && projectMatch && assigneeMatch;
        });
    }, [tasks, projects, statusFilter, projectFilter, assigneeFilter]);









    const handleEditTask = (task: Task) => {
        setEditTaskId(task.id);
    };

    const handleDeleteTask = async (taskId: number) => {
        try {
            await api.delete(`/tasks/${taskId}`);

            // ローカルの状態を更新
            setTasks(prevTasks => prevTasks.filter(task => task.id !== taskId));

            // グローバルデータを更新して他のページにも反映
            if (refreshGlobalData) {
                await refreshGlobalData({ force: true });
            }

            setSnackbar({
                open: true,
                message: 'タスクを削除しました',
                severity: 'success'
            });
        } catch (error) {
            setSnackbar({
                open: true,
                message: 'タスクの削除に失敗しました',
                severity: 'error'
            });
        }
    };




    const handleCloseDialog = () => {
        setOpenDialog(false);
    };




    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        if (name) {
            setCurrentTask(prev => ({
                ...prev,
                [name]: value
            }));
        }
    };




    const handleSelectChange = (e: SelectChangeEvent<string | number>) => {
        const { name, value } = e.target;
        if (!name) return;
        const isIdField = name === 'project_id' || name === 'assigned_to' || name === 'shot_id';
        const normalized = (value === '' || value == null)
            ? null
            : (isIdField && typeof value === 'string' && /^\d+$/.test(value) ? parseInt(value, 10) : value);
        setCurrentTask(prev => {
            const next = { ...prev, [name]: isIdField ? normalized : value } as TaskFormData;
            if (name === 'project_id' && prev.project_id !== normalized) {
                next.dependsOn = [];
            }
            if (name === 'shot_id') {
                const selectedShot = shots.find(s => s.id === normalized);
                if (selectedShot) {
                    next.seqID = selectedShot.seqID;
                    next.shotID = selectedShot.shotID;
                } else {
                    next.seqID = '';
                    next.shotID = '';
                }
            }
            return next;
        });
    };



    const handleMultiSelectChange = (e: SelectChangeEvent<string[]>) => {
        const { name, value } = e.target;
        if (name) {
            setCurrentTask(prev => ({
                ...prev,
                [name]: typeof value === 'string' ? value.split(',') : value
            }));
        }
    };




    const handleSubmit = async () => {
        if (!currentTask.name?.trim()) {
            setSnackbar({ open: true, message: 'タスク名を入力してください', severity: 'warning' });
            return;
        }
        if (!currentTask.project_id) {
            setSnackbar({ open: true, message: 'プロジェクトを選択してください', severity: 'warning' });
            return;
        }
        if (!currentTask.due_date) {
            setSnackbar({ open: true, message: '期日を入力してください', severity: 'warning' });
            return;
        }
        try {
            const taskData = {
                name: currentTask.name,
                description: currentTask.description || '',
                status: currentTask.status,
                priority: currentTask.priority?.toUpperCase() || 'LOW',
                assigned_to: currentTask.assigned_to || null,
                project_id: currentTask.project_id || null,
                start_date: currentTask.start_date,
                due_date: currentTask.due_date,
                cost: currentTask.cost || 0,
                type: currentTask.type?.toLowerCase() || '',
                shot_id: currentTask.shot_id,
                seqID: currentTask.seqID,
                shotID: currentTask.shotID,


                dependsOn: currentTask.dependsOn || [],
                display_status: 'online'
            };




            await api.post('/tasks', taskData);
            setSnackbar({
                open: true,
                message: 'タスクが作成されました',
                severity: 'success'
            });

            setOpenDialog(false);

            // グローバルデータを更新して他のページにも反映
            if (refreshGlobalData) {
                await refreshGlobalData({ force: true });
            }
        } catch (err: any) {

            let errorMessage = 'タスクの保存に失敗しました';

            if (err.response?.data?.detail) {
                if (Array.isArray(err.response.data.detail)) {
                    errorMessage = err.response.data.detail
                        .map((error: any) => `${error.loc.join('.')}: ${error.msg}`)
                        .join('\n');
                } else {
                    errorMessage = err.response.data.detail;
                }
            } else if (err.message) {
                errorMessage = err.message;
            }




            setSnackbar({
                open: true,
                message: errorMessage,
                severity: 'error'
            });
        }
    };




    const handleCloseSnackbar = () => {
        setSnackbar({ ...snackbar, open: false });
    };



    // 並び替え用の素の値を各行に前計算して埋める
    const rows = useMemo(() => {
        const nameByProjectId = new Map(projects.map(p => [p.id, p.name ?? '']));
        const nameByTaskId = new Map(tasks.map(t => [t.id, t.name ?? '']));

        const dependsText = (row: Task) => {
            if (!row.dependsOn?.length) return '';
            return row.dependsOn
                .map((id) => {
                    const n = parseInt(String(id).replace('task-', ''), 10);
                    return nameByTaskId.get(n) ?? '';
                })
                .filter(Boolean)
                .join(', ');
        };

        const toTs = (v: unknown) => {
            if (!v) return 0;
            try {
                const d = typeof v === 'string' ? parseISO(v) : new Date(v as any);
                return isValid(d) ? d.getTime() : 0;
            } catch { return 0; }
        };

        return (filteredTasks ?? []).map(t => ({
            ...t,
            _projectName: nameByProjectId.get(t.project_id as any) ?? '',
            _startTs: toTs(t.start_date),
            _dueTs: toTs(t.due_date),
            _dependsText: dependsText(t),
            _actionsSortKey: t.id ?? 0,
        }));
    }, [filteredTasks, projects, tasks]);


    // DataGrid用のカラム定義
    const columns: GridColDef[] = useMemo(() => [
        {
            field: 'name', headerName: 'タスク名', minWidth: 80, flex: 1, hideable: false, renderCell: (params: GridRenderCellParams) => {
                const row = params.row;
                return <TaskLabel shotId={row.shotID} title={row.name || '-'} />;
            }
        },
        {
            field: 'description', headerName: '説明', minWidth: 100, flex: 1, renderCell: (params: GridRenderCellParams) => {
                const row = params.row;
                const text = row.description || '-';
                return (
                    <Tooltip title={text} followCursor>
                        <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {text}
                        </Box>
                    </Tooltip>
                );
            }
        },
        {
            field: 'status', headerName: 'ステータス', minWidth: 80, width: 120, renderCell: (params: GridRenderCellParams) => {
                const row = params.row;
                const statuses = ['todo', 'in-progress', 'review', 'completed', 'delayed'];
                return (
                    <Chip
                        label={row.status || '未設定'}
                        size="small"
                        onClick={(e) => {
                            e.stopPropagation();
                            const current = row.status || 'todo';
                            const nextIdx = (statuses.indexOf(current) + 1) % statuses.length;
                            handleUpdateTaskQuick(row.id, { status: statuses[nextIdx] });
                        }}
                        sx={{
                            backgroundColor: getTaskStatusColor(row.status),
                            color: 'white',
                            cursor: 'pointer',
                            '& .MuiChip-label': { px: 1 }
                        }}
                    />
                );
            }
        },
        {
            field: '_projectName',
            headerName: 'プロジェクト',
            minWidth: 100,
            width: 150,
            sortable: true,
            renderCell: (params) => String(params.value ?? '-'),
            sortComparator: (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'ja'),
        },
        {
            field: 'priority', headerName: '優先度', minWidth: 80, width: 100, renderCell: (params: GridRenderCellParams) => {
                const row = params.row;
                const priorityColors = {
                    'high': '#f44336',
                    'medium': '#ff9800',
                    'low': '#4caf50'
                };
                return (
                    <Chip
                        label={row.priority || '未設定'}
                        size="small"
                        sx={{
                            backgroundColor: priorityColors[row.priority as keyof typeof priorityColors] || '#9e9e9e',
                            color: 'white',
                            '& .MuiChip-label': { px: 1 }
                        }}
                    />
                );
            }
        },
        {
            field: 'seqID', headerName: 'seq', minWidth: 60, width: 80, renderCell: (params: GridRenderCellParams) => {
                const row = params.row;
                return row.seqID || '-';
            }
        },
        {
            field: 'shotID', headerName: 'shot', minWidth: 60, width: 80, renderCell: (params: GridRenderCellParams) => {
                const row = params.row;
                const text = row.shotID || '-';
                return (
                    <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {text}
                    </Box>
                );
            }
        },
        {
            field: 'type', headerName: 'type', minWidth: 80, width: 100, renderCell: (params: GridRenderCellParams) => {
                const row = params.row;
                // データベースに保存されているタスクタイプを小文字化して表示
                return row.type ? row.type.toLowerCase() : '-';
            }
        },
        {
            field: 'assigned_to', headerName: '担当者', minWidth: 80, width: 120,
            sortable: true,
            sortComparator: (a, b) => {
                const userA = users.find(u => u.id === a);
                const userB = users.find(u => u.id === b);
                const nameA = userA ? userA.username || userA.full_name || userA.name || '' : '';
                const nameB = userB ? userB.username || userB.full_name || userB.name || '' : '';
                return nameA.localeCompare(nameB, 'ja');
            },
            renderCell: (params: GridRenderCellParams) => {
                const row = params.row;
                const user = users.find(u => u.id === row.assigned_to);
                const text = user ? user.username : '-';
                return (
                    <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {text}
                    </Box>
                );
            }
        },
        {
            field: '_startTs',
            headerName: '開始日',
            minWidth: 80,
            width: 110,
            sortable: true,
            renderCell: (params) => formatDate((params.row as any).start_date),
            sortComparator: (a, b) => Number(a ?? 0) - Number(b ?? 0),
        },
        {
            field: '_dueTs',
            headerName: '期日',
            minWidth: 80,
            width: 110,
            sortable: true,
            renderCell: (params) => formatDate((params.row as any).due_date),
            sortComparator: (a, b) => Number(a ?? 0) - Number(b ?? 0),
        },
        {
            field: '_dependsText',
            headerName: '依存元タスク',
            minWidth: 80,
            width: 150,
            sortable: true,
            renderCell: (params) => {
                const text = String(params.value ?? '-');
                return (
                    <Tooltip title={text} followCursor>
                        <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {text}
                        </Box>
                    </Tooltip>
                );
            },
            sortComparator: (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'ja'),
        },
        {
            field: 'cost', headerName: 'コスト', minWidth: 60, width: 90, renderCell: (params: GridRenderCellParams) => {
                const row = params.row;
                return row.cost ?? '-';
            }
        },
        {
            field: '_actionsSortKey',
            headerName: '操作',
            width: 150,
            sortable: true,
            sortComparator: (a, b) => Number(a ?? 0) - Number(b ?? 0),
            pinned: 'right',
            headerAlign: 'center',
            align: 'center',
            hideable: false,
            renderCell: (params) => {
                const row = params.row as Task;
                return (
                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                        <Tooltip title="履歴">
                            <IconButton
                                size="small"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleViewHistory(row);
                                }}
                                sx={{
                                    color: 'primary.main',
                                    '&:hover': { backgroundColor: 'primary.light', color: 'white' }
                                }}
                            >
                                <HistoryIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="編集">
                            <IconButton
                                size="small"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleEditTask(row);
                                }}
                                sx={{
                                    color: 'primary.main',
                                    '&:hover': { backgroundColor: 'primary.light', color: 'white' }
                                }}
                            >
                                <EditIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="削除">
                            <IconButton
                                size="small"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteTask(row.id);
                                }}
                                sx={{
                                    color: 'error.main',
                                    '&:hover': { backgroundColor: 'error.light', color: 'white' }
                                }}
                            >
                                <DeleteIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Box>
                );
            },
        },
    ], [users, projects, taskMap]);




    // ステータス履歴を表示する関数
    const handleViewHistory = async (task: Task) => {
        try {
            const response = await api.get<StatusHistory[]>(`/tasks/${task.id}/status-history`);
            // IDでソート
            const sortedHistory = response.data.sort((a, b) => a.id - b.id);
            setStatusHistory(sortedHistory);
            setSelectedTask(task);
            setHistoryDialogOpen(true);
        } catch (err) {
            setSnackbar({
                open: true,
                message: 'ステータス履歴の取得に失敗しました',
                severity: 'error'
            });
        }
    };




    // ステータス履歴ダイアログを閉じる関数
    const handleCloseHistoryDialog = () => {
        setHistoryDialogOpen(false);
        setStatusHistory([]);
        setSelectedTask(null);
    };








    if (loading) return <CircularProgress />;
    if (error) return <Typography color="error">{error}</Typography>;




    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                minHeight: 0,
                overflow: 'hidden',
                p: { xs: 1, sm: 1.5, md: 2 },
                maxWidth: 1600,
                mx: 'auto',
                width: '100%',
            }}
        >
            <Box sx={{ mb: 4 }}>
                <Breadcrumbs sx={{ mb: 1.5 }}>
                    <Link color="inherit" onClick={() => navigate('/dashboard')} sx={{ cursor: 'pointer', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                        App
                    </Link>
                    <Typography color="text.primary" sx={{ fontWeight: 500 }}>Tasks</Typography>
                </Breadcrumbs>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <TaskIcon sx={{ fontSize: '2rem', color: '#2196F3' }} />
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
                        Tasks
                    </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.95rem' }}>
                    プロジェクトの個別タスクと担当者、期日を一元管理します。
                </Typography>
            </Box>
            <Paper
                elevation={0}
                sx={{
                    flexShrink: 0,
                    mb: { xs: 1, sm: 1.5 },
                    p: { xs: 1.5, sm: 2 },
                    borderRadius: { xs: 1.5, sm: 2 },
                    border: '1px solid',
                    borderColor: 'divider',
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', mb: { xs: 1, sm: 0 } }}>
                    {isMobile && (
                        <IconButton
                            onClick={() => setMobileFilterOpen(true)}
                            sx={{ minWidth: 48, minHeight: 48 }}
                            color="primary"
                        >
                            <FilterListIcon />
                        </IconButton>
                    )}
                </Box>
                {/* PC用フィルター */}
                {!isMobile && (
                    <Grid container spacing={2} alignItems="center">
                        <Grid item xs={12} sm={4}>
                            <FormControl fullWidth variant="outlined" size="small">
                                <InputLabel id="status-filter-label" shrink>ステータス</InputLabel>
                                <Select
                                    labelId="status-filter-label"
                                    label="ステータス"
                                    displayEmpty
                                    value={statusFilter || 'all'}
                                    onChange={(e) => setStatusFilter(e.target.value === 'all' ? '' : e.target.value as string)}
                                    renderValue={(selected) => {
                                        if (!selected || selected === 'all' || selected === '') {
                                            return '全て';
                                        }
                                        return selected;
                                    }}
                                >
                                    <MenuItem value="all">全て</MenuItem>
                                    {statusOptions.map(status => (
                                        <MenuItem key={status} value={status}>{status}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <FormControl fullWidth variant="outlined" size="small">
                                <InputLabel id="project-filter-label" shrink>プロジェクト</InputLabel>
                                <Select
                                    labelId="project-filter-label"
                                    label="プロジェクト"
                                    displayEmpty
                                    value={projectFilter === '' ? 'all' : projectFilter}
                                    onChange={(e) => {
                                        const v = e.target.value as string;
                                        setProjectFilter(v === 'all' ? '' : v);
                                    }}
                                    renderValue={(selected) => {
                                        if (!selected || selected === 'all' || selected === '') {
                                            return '全て';
                                        }
                                        if (selected === 'no-project') {
                                            return 'プロジェクト未設定';
                                        }
                                        const project = projects.find(p => String(p.id) === selected);
                                        if (!project) return selected;
                                        return (
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <Box
                                                    sx={{
                                                        width: 8,
                                                        height: 8,
                                                        borderRadius: '50%',
                                                        backgroundColor: '#4CAF50',
                                                        flexShrink: 0,
                                                    }}
                                                />
                                                <span>{project.name}</span>
                                            </Box>
                                        );
                                    }}
                                >
                                    <MenuItem value="all">全て</MenuItem>
                                    <MenuItem value="no-project">プロジェクト未設定</MenuItem>
                                    {onlineProjects.map(project => (
                                        <MenuItem
                                            key={project.id}
                                            value={String(project.id)}
                                            sx={{
                                                '&::before': {
                                                    content: '""',
                                                    display: 'inline-block',
                                                    width: 8,
                                                    height: 8,
                                                    borderRadius: '50%',
                                                    backgroundColor: '#4CAF50',
                                                    marginRight: 1,
                                                    verticalAlign: 'middle',
                                                },
                                            }}
                                        >
                                            {project.name}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <FormControl fullWidth variant="outlined" size="small">
                                <InputLabel id="assignee-filter-label" shrink>担当者</InputLabel>
                                <Select
                                    labelId="assignee-filter-label"
                                    label="担当者"
                                    displayEmpty
                                    value={assigneeFilter || 'all'}
                                    onChange={(e) => setAssigneeFilter(e.target.value === 'all' ? '' : e.target.value as string)}
                                    renderValue={(selected) => {
                                        if (!selected || selected === 'all' || selected === '') {
                                            return '全て';
                                        }
                                        if (selected === 'unassigned') {
                                            return '未割当';
                                        }
                                        const user = users.find(u => String(u.id) === selected);
                                        return user ? (user.username || user.email) : selected;
                                    }}
                                >
                                    <MenuItem value="all">全て</MenuItem>
                                    <MenuItem value="unassigned">未割当</MenuItem>
                                    {users.map(user => (
                                        <MenuItem key={user.id} value={String(user.id)}>{user.username || user.email}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                    </Grid>
                )}
            </Paper>

            <Paper
                elevation={0}
                sx={{
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    overflow: 'hidden',
                    bgcolor: isMobile ? 'transparent' : 'background.paper', // モバイル時は背景透過（カードの影を活かすため）または背景色調整
                }}
            >


                {selectionModel.length > 0 && (
                    <Paper
                        elevation={6}
                        sx={{
                            position: 'sticky',
                            top: 0,
                            zIndex: 10,
                            p: 2,
                            mb: 2,
                            bgcolor: theme.palette.mode === 'dark' ? 'rgba(30, 30, 45, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                            backdropFilter: 'blur(8px)',
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            borderRadius: 2
                        }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'primary.main' }}>
                                {selectionModel.length}件 選択中
                            </Typography>
                            <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
                            <Stack direction="row" spacing={1}>
                                <Button
                                    size="small"
                                    variant="contained"
                                    startIcon={<BulkEditIcon />}
                                    onClick={() => setBulkEditOpen(true)}
                                    sx={{ textTransform: 'none', borderRadius: 2 }}
                                >
                                    一括編集
                                </Button>
                            </Stack>
                        </Box>
                        <IconButton
                            size="small"
                            onClick={() => setSelectionModel([])}
                        >
                            <CloseIcon />
                        </IconButton>
                    </Paper>
                )}

                {isMobile ? (
                    // モバイル用カードリスト表示
                    <Box
                        sx={{
                            flex: 1,
                            overflowY: 'auto',
                            p: 1,
                            pb: 10, // FABや下部メニュー用スペース
                            WebkitOverflowScrolling: 'touch',
                        }}
                    >
                        {rows.map((row) => (
                            <Card
                                key={row.id}
                                variant="outlined"
                                sx={{
                                    mb: 1.5,
                                    borderRadius: 3,
                                    bgcolor: 'background.paper',
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    overflow: 'hidden',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                                    '&:active': { transform: 'scale(0.98)', transition: 'transform 0.1s' }
                                }}
                            >
                                <CardActionArea onClick={() => {
                                    setHasUnsavedChanges(false);
                                    setSelectedTask(row as Task);
                                    setIsDrawerOpen(true);
                                }}>
                                    <Box sx={{ height: 4, bgcolor: getTaskStatusColor(row.status) }} />
                                    <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
                                            <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.3, mr: 1, wordBreak: 'break-word', color: 'text.primary' }}>
                                                {row.name}
                                            </Typography>
                                            <Chip
                                                label={getTaskStatusLabel(row.status)}
                                                size="small"
                                                sx={{
                                                    backgroundColor: getTaskStatusColor(row.status),
                                                    color: 'white',
                                                    height: 22,
                                                    fontSize: '0.7rem',
                                                    fontWeight: 800,
                                                    flexShrink: 0,
                                                    borderRadius: 1
                                                }}
                                            />
                                        </Box>

                                        <Stack spacing={1} sx={{ mb: 1.5 }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                                                <FolderIcon sx={{ fontSize: '1rem', color: 'primary.main', opacity: 0.7 }} />
                                                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                                    {projectMap.get(row.project_id || 0) || 'プロジェクト未設定'}
                                                </Typography>
                                            </Box>
                                            {row.due_date && (
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: isDatePast(row.due_date) && row.status !== 'completed' ? 'error.main' : 'text.secondary' }}>
                                                    <CalendarIcon sx={{ fontSize: '1rem', opacity: 0.7 }} />
                                                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                                        {formatDate(row.due_date)} {isDatePast(row.due_date) && row.status !== 'completed' ? '(遅延)' : ''}
                                                    </Typography>
                                                </Box>
                                            )}
                                        </Stack>

                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                {row.assigned_to ? (
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                        <Avatar
                                                            sx={{
                                                                width: 24,
                                                                height: 24,
                                                                fontSize: '0.7rem',
                                                                bgcolor: 'primary.light',
                                                                fontWeight: 700
                                                            }}
                                                        >
                                                            {(userMap.get(row.assigned_to) || '')[0]?.toUpperCase()}
                                                        </Avatar>
                                                        <Typography variant="caption" sx={{ fontWeight: 500 }}>
                                                            {userMap.get(row.assigned_to)}
                                                        </Typography>
                                                    </Box>
                                                ) : (
                                                    <Typography variant="caption" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                                                        未割り当て
                                                    </Typography>
                                                )}
                                            </Box>

                                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                                                {row.priority && row.priority !== 'low' && (
                                                    <Chip
                                                        icon={<PriorityIcon sx={{ fontSize: '0.9rem !important', color: 'inherit !important' }} />}
                                                        label={row.priority.toUpperCase()}
                                                        size="small"
                                                        variant="filled"
                                                        color={row.priority === 'high' ? 'error' : 'warning'}
                                                        sx={{ height: 20, fontSize: '0.6rem', fontWeight: 900, '& .MuiChip-label': { px: 0.5 } }}
                                                    />
                                                )}
                                            </Box>
                                        </Box>
                                    </CardContent>
                                </CardActionArea>
                            </Card>
                        ))}
                        {rows.length === 0 && (
                            <Typography sx={{ textAlign: 'center', mt: 4, color: 'text.secondary' }}>
                                タスクがありません
                            </Typography>
                        )}
                    </Box>
                ) : (
                    // PC用 DataGrid表示
                    <Box
                        ref={dataGridContainerRef}
                        sx={{
                            flex: 1,
                            minHeight: 0,
                            width: '100%',
                            WebkitOverflowScrolling: 'touch',
                            '&::-webkit-scrollbar': { height: '8px' },
                            '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '4px' },
                            '&::-webkit-scrollbar-thumb:hover': { backgroundColor: 'rgba(0,0,0,0.3)' },
                        }}
                    >
                        <DataGrid
                            rows={rows}
                            columns={columns}
                            getRowId={(row) => row.id}
                            checkboxSelection
                            disableRowSelectionOnClick
                            rowSelectionModel={{ type: 'include' as const, ids: new Set(selectionModel) }}
                            onRowSelectionModelChange={(newSelection) => {
                                // MUI DataGrid のバージョンや設定により、配列またはオブジェクトで返ってくる可能性があるため柔軟に処理
                                let ids: number[] = [];
                                if (Array.isArray(newSelection)) {
                                    ids = newSelection
                                        .map(id => typeof id === 'number' ? id : Number(id))
                                        .filter(id => !isNaN(id));
                                } else if (newSelection && typeof newSelection === 'object' && 'ids' in newSelection) {
                                    // 独自拡張や特定のモデル定義（Setなど）の場合
                                    ids = Array.from((newSelection as any).ids)
                                        .map((id: any) => typeof id === 'number' ? id : Number(id))
                                        .filter(id => !isNaN(id));
                                }
                                setSelectionModel(ids);
                            }}
                            sortingMode="client"
                            sortingOrder={['asc', 'desc']}
                            sortModel={sortModel}
                            onSortModelChange={setSortModel}
                            paginationModel={paginationModel}
                            onPaginationModelChange={setPaginationModel}
                            pageSizeOptions={[5, 10, 15, 20, 50]}
                            rowHeight={40}
                            onRowDoubleClick={(params) => {
                                handleEditTask(params.row as Task);
                            }}
                            onRowClick={(params) => {
                                setHasUnsavedChanges(false);
                                setSelectedTask(params.row as Task);
                                setIsDrawerOpen(true);
                            }}
                            disableColumnMenu={false}
                            disableColumnSelector={false}
                            sx={{
                                height: '100%',
                                '& .MuiDataGrid-columnHeaders': {
                                    background: isDark ? theme.palette.action.hover : '#f5f5f5',
                                    fontSize: '0.8rem'
                                },
                                '& .MuiDataGrid-cell': {
                                    alignItems: 'center',
                                    fontSize: '0.8rem',
                                    cursor: 'pointer'
                                },
                                '& .MuiDataGrid-row:hover': {
                                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)'
                                },
                                '& .MuiDataGrid-footerContainer': {
                                    fontSize: '0.8rem'
                                },
                                '& .MuiDataGrid-virtualScroller': {
                                    overflowX: 'auto !important',
                                    overflowY: 'auto',
                                    scrollbarWidth: 'none',
                                    msOverflowStyle: 'none',
                                    '&::-webkit-scrollbar': { width: 0, display: 'none' }
                                },
                                '& .MuiDataGrid-pinnedColumns': {
                                    backgroundColor: 'background.paper',
                                    boxShadow: isDark ? '-2px 0 4px rgba(0,0,0,0.3)' : '-2px 0 4px rgba(0,0,0,0.1)'
                                }
                            }}
                        />
                    </Box>
                )}
            </Paper>




            {/* タスク詳細ドロワー (クイック更新用) */}
            <Drawer
                anchor="right"
                open={isDrawerOpen}
                onClose={() => {
                    if (hasUnsavedChanges && !window.confirm('未保存の変更があります。閉じてもよろしいですか？')) return;
                    setHasUnsavedChanges(false);
                    setIsDrawerOpen(false);
                }}
                PaperProps={{
                    sx: { width: { xs: '100%', sm: 400 }, maxWidth: '100%' }
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>タスク詳細</Typography>
                    <IconButton onClick={() => {
                        if (hasUnsavedChanges && !window.confirm('未保存の変更があります。閉じてもよろしいですか？')) return;
                        setHasUnsavedChanges(false);
                        setIsDrawerOpen(false);
                    }}>
                        <CloseIcon />
                    </IconButton>
                </Box>
                {selectedTask && (
                    <TaskQuickDetail
                        task={selectedTask}
                        projects={projects}
                        users={users}
                        onUpdate={handleUpdateTaskQuick}
                        onEdit={() => setHasUnsavedChanges(true)}
                    />
                )}
                <Box sx={{ p: 2, mt: 'auto', display: 'flex', gap: 1 }}>
                    <Button
                        fullWidth
                        variant="outlined"
                        startIcon={<EditIcon />}
                        onClick={() => {
                            setHasUnsavedChanges(false);
                            setIsDrawerOpen(false);
                            handleEditTask(selectedTask!);
                        }}
                    >
                        詳細編集
                    </Button>
                </Box>
            </Drawer>

            {/* 一括編集ダイアログ */}
            <Dialog open={bulkEditOpen} onClose={() => setBulkEditOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>一括編集（{selectionModel.length}件）</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <FormControl fullWidth size="small">
                            <InputLabel>ステータス</InputLabel>
                            <Select
                                value={bulkEditForm.status}
                                label="ステータス"
                                onChange={(e) => setBulkEditForm(f => ({ ...f, status: e.target.value }))}
                            >
                                <MenuItem value="">変更しない</MenuItem>
                                <MenuItem value="todo">未着手</MenuItem>
                                <MenuItem value="in-progress">進行中</MenuItem>
                                <MenuItem value="review">レビュー中</MenuItem>
                                <MenuItem value="completed">完了</MenuItem>
                                <MenuItem value="delayed">遅延</MenuItem>
                            </Select>
                        </FormControl>
                        <FormControl fullWidth size="small">
                            <InputLabel>担当者</InputLabel>
                            <Select
                                value={bulkEditForm.assigned_to}
                                label="担当者"
                                onChange={(e) => setBulkEditForm(f => ({ ...f, assigned_to: e.target.value === '' ? '' : Number(e.target.value) }))}
                            >
                                <MenuItem value="">変更しない</MenuItem>
                                {users.map(user => (
                                    <MenuItem key={user.id} value={user.id}>{user.username || user.name || user.email}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <TextField
                            label="期日"
                            type="date"
                            value={bulkEditForm.due_date}
                            onChange={(e) => setBulkEditForm(f => ({ ...f, due_date: e.target.value }))}
                            fullWidth
                            size="small"
                            InputLabelProps={{ shrink: true }}
                        />
                        <FormControl fullWidth size="small">
                            <InputLabel>優先度</InputLabel>
                            <Select
                                value={bulkEditForm.priority}
                                label="優先度"
                                onChange={(e) => setBulkEditForm(f => ({ ...f, priority: e.target.value }))}
                            >
                                <MenuItem value="">変更しない</MenuItem>
                                <MenuItem value="low">low</MenuItem>
                                <MenuItem value="medium">medium</MenuItem>
                                <MenuItem value="high">high</MenuItem>
                            </Select>
                        </FormControl>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setBulkEditOpen(false)}>キャンセル</Button>
                    <Button variant="contained" onClick={handleBulkEditApply} disabled={bulkEditSaving}>
                        {bulkEditSaving ? '適用中...' : '適用'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* 一括編集確認ダイアログ */}
            <Dialog open={bulkConfirmOpen} onClose={() => setBulkConfirmOpen(false)} maxWidth="xs">
                <DialogTitle>確認</DialogTitle>
                <DialogContent>
                    <Typography>{bulkConfirmCount}件のタスクを一括更新しますか？</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setBulkConfirmOpen(false)}>キャンセル</Button>
                    <Button variant="contained" onClick={handleBulkEditApplyConfirmed}>更新</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ fontSize: '1rem' }}>新規タスク</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 2 }}>
                        <TextField
                            name="name"
                            label="タスク名"
                            value={currentTask.name}
                            onChange={handleInputChange}
                            fullWidth
                            required
                            size="small"
                        />
                        <TextField
                            name="description"
                            label="説明"
                            value={currentTask.description}
                            onChange={handleInputChange}
                            fullWidth
                            multiline
                            rows={3}
                            size="small"
                        />
                        <FormControl fullWidth size="small" required>
                            <InputLabel>プロジェクト</InputLabel>
                            <Select
                                name="project_id"
                                value={currentTask.project_id ?? ''}
                                label="プロジェクト"
                                onChange={handleSelectChange}
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
                            value={currentTask.due_date}
                            onChange={handleInputChange}
                            fullWidth
                            required
                            InputLabelProps={{ shrink: true }}
                            size="small"
                        />
                        <TextField
                            name="start_date"
                            label="開始日"
                            type="date"
                            value={currentTask.start_date}
                            onChange={handleInputChange}
                            fullWidth
                            InputLabelProps={{ shrink: true }}
                            size="small"
                        />
                        <FormControl fullWidth size="small">
                            <InputLabel>担当者</InputLabel>
                            <Select
                                name="assigned_to"
                                value={currentTask.assigned_to || ''}
                                label="担当者"
                                onChange={handleSelectChange}
                            >
                                <MenuItem value="">未割り当て</MenuItem>
                                {users.map(user => (
                                    <MenuItem key={user.id} value={user.id}>{user.username || user.name || user.email}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl fullWidth size="small">
                            <InputLabel>ステータス</InputLabel>
                            <Select
                                name="status"
                                value={currentTask.status}
                                label="ステータス"
                                onChange={handleSelectChange}
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
                                value={currentTask.priority}
                                label="優先度"
                                onChange={handleSelectChange}
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
                            value={currentTask.cost}
                            onChange={handleInputChange}
                            fullWidth
                            size="small"
                            inputProps={{ step: '0.1' }}
                        />
                        <FormControl fullWidth size="small" disabled={!currentTask.project_id}>
                            <InputLabel>ショット（Scoreプロジェクト）</InputLabel>
                            <Select
                                name="shot_id"
                                value={currentTask.shot_id ?? ''}
                                label="ショット（Scoreプロジェクト）"
                                onChange={handleSelectChange}
                            >
                                {!currentTask.project_id ? (
                                    <MenuItem value="" disabled>プロジェクトを先に選択してください</MenuItem>
                                ) : shots.length === 0 ? (
                                    <MenuItem value="" disabled>このプロジェクトにはショットがありません</MenuItem>
                                ) : (
                                    <MenuItem value="">（なし）</MenuItem>
                                )}
                                {shots.map((s) => (
                                    <MenuItem key={s.id} value={s.id}>{s.seqID} / {s.shotID}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <TextField
                                name="seqID"
                                label="シーケンスID"
                                value={currentTask.seqID}
                                onChange={handleInputChange}
                                fullWidth
                                size="small"
                                InputProps={{ readOnly: !!currentTask.shot_id }}
                                helperText={currentTask.shot_id ? '自動入力' : '手動入力（レガシー用）'}
                                sx={{ bgcolor: currentTask.shot_id ? 'action.hover' : 'inherit' }}
                            />
                            <TextField
                                name="shotID"
                                label="ショットID"
                                value={currentTask.shotID}
                                onChange={handleInputChange}
                                fullWidth
                                size="small"
                                InputProps={{ readOnly: !!currentTask.shot_id }}
                                helperText={currentTask.shot_id ? '自動入力' : ''}
                                sx={{ bgcolor: currentTask.shot_id ? 'action.hover' : 'inherit' }}
                            />
                        </Box>




                        <FormControl fullWidth size="small">
                            <InputLabel>Type</InputLabel>
                            <Select
                                name="type"
                                value={currentTask.type}
                                label="Type"
                                onChange={handleSelectChange}
                            >
                                <MenuItem value="animation">animation</MenuItem>
                                <MenuItem value="layout">layout</MenuItem>
                                <MenuItem value="comp">comp</MenuItem>
                                <MenuItem value="fx">fx</MenuItem>
                                <MenuItem value="lighting">lighting</MenuItem>
                                <MenuItem value="asset">asset</MenuItem>
                                <MenuItem value="programming">programming</MenuItem>
                                <MenuItem value="design">design</MenuItem>
                                <MenuItem value="testing">testing</MenuItem>
                                <MenuItem value="documentation">documentation</MenuItem>
                                <MenuItem value="shoot">shoot</MenuItem>
                                <MenuItem value="gs">gs</MenuItem>
                                <MenuItem value="report">report</MenuItem>
                                <MenuItem value="other">other</MenuItem>

                            </Select>
                        </FormControl>
                        <FormControl fullWidth size="small">
                            <InputLabel>依存元タスク</InputLabel>
                            <Select
                                multiple
                                name="dependsOn"
                                value={currentTask.dependsOn || []}
                                label="依存元タスク"
                                open={dependencySelectOpen}
                                onOpen={() => setDependencySelectOpen(true)}
                                onClose={() => setDependencySelectOpen(false)}
                                onChange={handleMultiSelectChange}
                                renderValue={(selected) => (
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                        {selected.map((value) => {
                                            const id = parseInt(value.replace('task-', ''), 10);
                                            const name = taskMap.get(id);
                                            return (
                                                <Chip key={value} label={name || value} size="small" />
                                            );
                                        })}
                                    </Box>
                                )}
                            >
                                {tasks
                                    .filter(t => t.id !== currentTask.id && t.project_id === currentTask.project_id)
                                    .map((task) => (
                                        <MenuItem
                                            key={task.id}
                                            value={`task-${task.id}`}
                                            sx={{
                                                '&.Mui-selected': {
                                                    backgroundColor: 'rgba(25, 118, 210, 0.2) !important',
                                                    '&:hover': {
                                                        backgroundColor: 'rgba(25, 118, 210, 0.3) !important',
                                                    }
                                                },
                                                '&.Mui-selected.Mui-focusVisible': {
                                                    backgroundColor: 'rgba(25, 118, 210, 0.3) !important',
                                                }
                                            }}
                                        >
                                            {task.name}
                                        </MenuItem>
                                    ))}
                                <Divider />
                                <Box
                                    sx={{
                                        position: 'sticky',
                                        bottom: 0,
                                        bgcolor: 'background.paper',
                                        zIndex: 1,
                                        width: '100%',
                                        display: 'flex',
                                        justifyContent: 'flex-end',
                                        py: 1,
                                        px: 1
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <Button
                                        onClick={() => setDependencySelectOpen(false)}
                                        size="small"
                                        variant="contained"
                                    >
                                        完了
                                    </Button>
                                </Box>
                            </Select>
                        </FormControl>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseDialog} size="small">キャンセル</Button>
                    <Button onClick={handleSubmit} variant="contained" color="primary" size="small">
                        作成
                    </Button>
                </DialogActions>
            </Dialog>

            {/* 共通タスク編集ダイアログ（編集・ダブルクリックで表示） */}
            <TaskEditDialog
                open={editTaskId != null}
                taskId={editTaskId}
                onClose={() => setEditTaskId(null)}
                onSaved={() => {
                    setEditTaskId(null);
                    if (refreshGlobalData) refreshGlobalData({ force: true });
                    setSnackbar({ open: true, message: 'タスクが更新されました', severity: 'success' });
                }}
            />

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




            {/* ステータス履歴ダイアログ */}
            <Dialog
                open={historyDialogOpen}
                onClose={handleCloseHistoryDialog}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>
                    ステータス履歴 - {selectedTask?.name}
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ mt: 2 }}>
                        {statusHistory.map((history) => (
                            <Box key={history.id} sx={{ mb: 2, p: 1, border: '1px solid #eee', borderRadius: 1 }}>
                                <Typography variant="body2">
                                    ステータス: {history.status}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    変更日時: {format(new Date(history.changed_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
                                </Typography>
                            </Box>
                        ))}
                        {statusHistory.length === 0 && (
                            <Typography variant="body2" color="text.secondary">
                                履歴がありません
                            </Typography>
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseHistoryDialog}>閉じる</Button>
                </DialogActions>
            </Dialog>

            {/* モバイル用フィルタードロワー */}
            <Drawer
                anchor="bottom"
                open={mobileFilterOpen}
                onClose={() => setMobileFilterOpen(false)}
                PaperProps={{
                    sx: {
                        borderTopLeftRadius: 16,
                        borderTopRightRadius: 16,
                        maxHeight: '80vh',
                        p: 2,
                    }
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
                        フィルター
                    </Typography>
                    <IconButton onClick={() => setMobileFilterOpen(false)} sx={{ minWidth: 48, minHeight: 48 }}>
                        <CloseIcon />
                    </IconButton>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <FormControl size="medium" fullWidth>
                        <InputLabel id="mobile-status-filter-label" shrink>ステータス</InputLabel>
                        <Select
                            labelId="mobile-status-filter-label"
                            label="ステータス"
                            displayEmpty
                            value={statusFilter || 'all'}
                            onChange={(e) => setStatusFilter(e.target.value === 'all' ? '' : e.target.value as string)}
                            renderValue={(selected) => {
                                if (!selected || selected === 'all' || selected === '') {
                                    return '全て';
                                }
                                return selected;
                            }}
                        >
                            <MenuItem value="all">全て</MenuItem>
                            {statusOptions.map(status => (
                                <MenuItem key={status} value={status}>{status}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl size="medium" fullWidth>
                        <InputLabel id="mobile-project-filter-label" shrink>プロジェクト</InputLabel>
                        <Select
                            labelId="mobile-project-filter-label"
                            label="プロジェクト"
                            displayEmpty
                            value={projectFilter === '' ? 'all' : projectFilter}
                            onChange={(e) => {
                                const v = e.target.value as string;
                                setProjectFilter(v === 'all' ? '' : v);
                            }}
                            renderValue={(selected) => {
                                if (!selected || selected === 'all' || selected === '') {
                                    return '全て';
                                }
                                if (selected === 'no-project') {
                                    return 'プロジェクト未設定';
                                }
                                const project = projects.find(p => String(p.id) === selected);
                                if (!project) return selected;
                                return project.name;
                            }}
                        >
                            <MenuItem value="all">全て</MenuItem>
                            <MenuItem value="no-project">プロジェクト未設定</MenuItem>
                            {onlineProjects.map(project => (
                                <MenuItem key={project.id} value={String(project.id)}>
                                    {project.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl size="medium" fullWidth>
                        <InputLabel id="mobile-assignee-filter-label" shrink>担当者</InputLabel>
                        <Select
                            labelId="mobile-assignee-filter-label"
                            label="担当者"
                            displayEmpty
                            value={assigneeFilter || 'all'}
                            onChange={(e) => setAssigneeFilter(e.target.value === 'all' ? '' : e.target.value as string)}
                            renderValue={(selected) => {
                                if (!selected || selected === 'all' || selected === '') {
                                    return '全て';
                                }
                                if (selected === 'unassigned') {
                                    return '未割当';
                                }
                                const user = users.find(u => String(u.id) === selected);
                                return user ? (user.username || user.email) : selected;
                            }}
                        >
                            <MenuItem value="all">全て</MenuItem>
                            <MenuItem value="unassigned">未割当</MenuItem>
                            {users.map(user => (
                                <MenuItem key={user.id} value={String(user.id)}>{user.username || user.email}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Button
                        variant="contained"
                        onClick={() => {
                            setStatusFilter('');
                            setProjectFilter('');
                            setAssigneeFilter('');
                            setMobileFilterOpen(false);
                        }}
                        sx={{ mt: 1, minHeight: 48 }}
                    >
                        フィルターをクリア
                    </Button>
                </Box>
            </Drawer>
            {/* モバイル用: フローティングアクションボタン */}
            {isMobile && (
                <Box
                    sx={{
                        position: 'fixed',
                        bottom: 88,
                        right: 16,
                        zIndex: 1000,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2
                    }}
                >
                    <Fab
                        size="medium"
                        color="secondary"
                        aria-label="filter"
                        onClick={() => setMobileFilterOpen(true)}
                        sx={{
                            bgcolor: 'background.paper',
                            color: 'text.secondary',
                            boxShadow: 3
                        }}
                    >
                        <FilterListIcon />
                    </Fab>
                    {isAdmin && (
                        <Fab
                            color="primary"
                            aria-label="add"
                            onClick={() => {
                                setCurrentTask({
                                    id: null,
                                    name: '',
                                    description: '',
                                    project_id: null,
                                    due_date: format(new Date(), 'yyyy-MM-dd'),
                                    start_date: format(new Date(), 'yyyy-MM-dd'),
                                    assigned_to: null,
                                    status: 'todo',
                                    priority: 'medium',
                                    cost: 0,
                                    seqID: '',
                                    shotID: '',
                                    type: 'development',
                                    dependsOn: []
                                } as any);
                                setOpenDialog(true);
                            }}
                        >
                            <AddIcon />
                        </Fab>
                    )}
                </Box>
            )}
        </Box >
    );
};

export default TasksPage;





