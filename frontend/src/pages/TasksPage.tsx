import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    Box, Typography, CircularProgress, Paper, TableContainer, Table,
    TableBody, TableRow, TableCell, Chip, Select, MenuItem, FormControl, InputLabel, Grid,
    Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Stack,
    Snackbar, Alert, SelectChangeEvent, Tooltip
} from '@mui/material';
import { Edit as EditIcon, Delete as DeleteIcon, History as HistoryIcon } from '@mui/icons-material';
import api from '../services/api';
import { Task, Project, User } from '../types'; // Import User type as well
import { format, parseISO, isValid } from 'date-fns';
import { ja } from 'date-fns/locale';
import { DataGrid, GridColDef, GridRenderCellParams, GridSortModel } from '@mui/x-data-grid';
import { useTasksPageState, usePageState } from '../contexts/PageStateContext';




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
        case 'completed': return '#4CAF50';
        default: return '#BDBDBD';
    }
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
}








interface StatusHistory {
    id: number;
    task_id: number;
    status: string;
    changed_at: string;
    changed_by: number;
}




const TasksPage: React.FC = () => {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // ページ状態管理の使用
    const { tasksState, updateTasksState, isInitialLoad, globalData, updateGlobalData } = useTasksPageState();
    const { refreshGlobalData } = usePageState();
    
    // 状態を分離（初期化時はページ状態から取得）
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [projectFilter, setProjectFilter] = useState<string>('');
    const [assigneeFilter, setAssigneeFilter] = useState<string>('');
    const [paginationModel, setPaginationModel] = useState({
        page: 0,
        pageSize: 20,
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




    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [openDialog, setOpenDialog] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
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
        dependsOn: []
    });
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




    // グローバルデータから初期値を設定
    useEffect(() => {
        console.log("[TasksPage] Global data changed:", {
            tasks: globalData?.tasks?.length || 0,
            projects: globalData?.projects?.length || 0,
            users: globalData?.users?.length || 0,
            lastFetched: globalData?.lastFetched
        });
        
        if (globalData && globalData.tasks && globalData.tasks.length > 0) {
            console.log("[TasksPage] Updating tasks from global data");
            setTasks(globalData.tasks);
        }
        if (globalData && globalData.projects && globalData.projects.length > 0) {
            console.log("[TasksPage] Updating projects from global data");
            setProjects(globalData.projects);
        }
        if (globalData && globalData.users && globalData.users.length > 0) {
            console.log("[TasksPage] Updating users from global data");
            setUsers(globalData.users);
        }
        if (globalData) {
            setLoading(false);
        }
    }, [globalData]);

    // タブを開いた時に最新データを取得（バックグラウンド）
    useEffect(() => {
        // グローバルデータが既に存在する場合は、それを使いつつバックグラウンドで更新
        if (globalData && globalData.tasks.length > 0 && globalData.projects.length > 0) {
            console.log("[TasksPage] Using existing global data...");
            setTasks(globalData.tasks);
            setProjects(globalData.projects);
            setUsers(globalData.users);
            setLoading(false);
            
            // バックグラウンドで最新データを取得
            if (refreshGlobalData) {
                console.log("[TasksPage] Refreshing data in background...");
                refreshGlobalData().then(() => {
                    console.log("[TasksPage] Background refresh completed");
                });
            }
            return;
        }

        // 初回ロード時のみローディング表示してデータを取得
        if (isInitialLoad && (!globalData || globalData.tasks.length === 0)) {
            console.log("[TasksPage] Fetching data on initial load...");
            fetchData();
        }
    }, [isInitialLoad, refreshGlobalData]); // refreshGlobalDataを依存関係に追加

    // グローバルデータの変更を直接監視（より確実な方法）
    useEffect(() => {
        if (globalData && globalData.tasks && globalData.tasks.length > 0) {
            console.log("[TasksPage] Global data updated, refreshing local state...");
            console.log("[TasksPage] Tasks count:", globalData.tasks.length);
            setTasks(globalData.tasks);
        }
        if (globalData && globalData.projects && globalData.projects.length > 0) {
            console.log("[TasksPage] Projects count:", globalData.projects.length);
            setProjects(globalData.projects);
        }
        if (globalData && globalData.users && globalData.users.length > 0) {
            console.log("[TasksPage] Users count:", globalData.users.length);
            setUsers(globalData.users);
        }
    }, [globalData.tasks, globalData.projects, globalData.users, globalData.lastFetched]);

    // globalDataRefreshedイベントをリッスンしてデータを強制更新
    useEffect(() => {
        const handleGlobalDataRefresh = (event: CustomEvent) => {
            console.log("[TasksPage] Global data refreshed event received, updating local state...");
            console.log("[TasksPage] Received data:", {
                tasks: event.detail.tasks?.length || 0,
                projects: event.detail.projects?.length || 0,
                users: event.detail.users?.length || 0
            });
            const { tasks, projects, users } = event.detail;
            setTasks(tasks);
            setProjects(projects);
            setUsers(users);
        };

        const handleCsvImportCompleted = async (event: CustomEvent) => {
            console.log("[TasksPage] CSV import completed event received:", event.detail);
            // CSVインポート完了時はグローバルデータの更新を待つ
            if (refreshGlobalData) {
                console.log("[TasksPage] Refreshing global data after CSV import...");
                await refreshGlobalData();
            }
        };

        console.log("[TasksPage] Adding globalDataRefreshed and csvImportCompleted event listeners");
        window.addEventListener('globalDataRefreshed', handleGlobalDataRefresh as unknown as EventListener);
        window.addEventListener('csvImportCompleted', handleCsvImportCompleted as unknown as EventListener);
        
        return () => {
            console.log("[TasksPage] Removing globalDataRefreshed and csvImportCompleted event listeners");
            window.removeEventListener('globalDataRefreshed', handleGlobalDataRefresh as unknown as EventListener);
            window.removeEventListener('csvImportCompleted', handleCsvImportCompleted as unknown as EventListener);
        };
    }, [refreshGlobalData]);

    // プロジェクト変更イベントをリッスンしてタスクデータを強制更新
    useEffect(() => {
        const handleProjectDeleted = async (event: CustomEvent) => {
            console.log("[TasksPage] Project deleted event received:", event.detail);
            // プロジェクト削除時はタスクも削除されるため、グローバルデータの更新を待つ
            if (refreshGlobalData) {
                console.log("[TasksPage] Refreshing global data after project deletion...");
                await refreshGlobalData();
            }
        };

        const handleProjectUpdated = async (event: CustomEvent) => {
            console.log("[TasksPage] Project updated event received:", event.detail);
            // プロジェクト更新時はタスクデータも再取得
            if (refreshGlobalData) {
                console.log("[TasksPage] Refreshing global data after project update...");
                await refreshGlobalData();
            }
        };

        const handleProjectStatusUpdated = async (event: CustomEvent) => {
            console.log("[TasksPage] Project status updated event received:", event.detail);
            // プロジェクト表示ステータス更新時はタスクデータも再取得
            if (refreshGlobalData) {
                console.log("[TasksPage] Refreshing global data after project status update...");
                await refreshGlobalData();
            }
        };

        console.log("[TasksPage] Adding project change event listeners");
        window.addEventListener('projectDeleted', handleProjectDeleted as unknown as EventListener);
        window.addEventListener('projectUpdated', handleProjectUpdated as unknown as EventListener);
        window.addEventListener('projectStatusUpdated', handleProjectStatusUpdated as unknown as EventListener);
        
        return () => {
            console.log("[TasksPage] Removing project change event listeners");
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
   
    const userMap = useMemo(() =>
        new Map(users.map(u => [u.id, u.name || u.email]))
    , [users]);




    const taskMap = useMemo(() =>
        new Map(tasks.map(t => [t.id, t.name]))
    , [tasks]);




    const uniqueStatuses = useMemo(() =>
        [...new Set(tasks.map(task => task.status).filter(Boolean))] as string[]
    , [tasks]);




    const filteredTasks = useMemo(() => {
        return tasks.filter(task => {
            const statusMatch = statusFilter === '' || task.status === statusFilter;
            const projectMatch = projectFilter === '' || String(task.project_id) === projectFilter;
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
    }, [tasks, statusFilter, projectFilter, assigneeFilter]);




    const handleCloseModal = () => {
        setIsModalOpen(false);
        setSelectedTask(null);
    };




    const handleEditTask = (task: Task) => {
        setIsEditMode(true);
        const safeParseDate = (dateStr: string | null | undefined): Date | null => {
            if (!dateStr) return null;
            try {
                const parsed = parseISO(dateStr);
                return isValid(parsed) ? parsed : null;
            } catch {
                return null;
            }
        };




        const startDateParsed = safeParseDate(task.start_date);
        const dueDateParsed = safeParseDate(task.due_date);




        setCurrentTask({
            id: task.id,
            name: task.name,
            description: task.description || '',
            status: task.status || 'todo',
            priority: task.extendedProps?.priority?.toLowerCase() || 'low',  // extendedPropsから取得
            assigned_to: task.assigned_to || null,
            project_id: task.project_id || null,
            start_date: startDateParsed ? format(startDateParsed, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
            due_date: dueDateParsed ? format(dueDateParsed, 'yyyy-MM-dd') : format(new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
            cost: task.cost || 0,
            type: (task as any)?.type ?? task.extendedProps?.type?.toLowerCase() ?? '',
            seqID: (task as any)?.seqID ?? task.extendedProps?.seqID ?? '',
            shotID: (task as any)?.shotID ?? task.extendedProps?.shotID ?? '',
            dependsOn: task.dependsOn || []
        });
        setOpenDialog(true);
    };




    const handleDeleteTask = async (taskId: number) => {
        try {
            await api.delete(`/tasks/${taskId}`);
            
            // ローカルの状態を更新
            setTasks(prevTasks => prevTasks.filter(task => task.id !== taskId));
            
            // グローバルデータを更新して他のページにも反映
            if (refreshGlobalData) {
                console.log('[TasksPage] Refreshing global data after task deletion...');
                await refreshGlobalData();
                console.log('[TasksPage] Global data refresh completed for task deletion');
            }
            
            setSnackbar({
                open: true,
                message: 'タスクを削除しました',
                severity: 'success'
            });
        } catch (error) {
            console.error('タスクの削除に失敗しました:', error);
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
        if (name) {
            setCurrentTask(prev => ({
                ...prev,
                [name]: value
            }));
        }
    };




    const handleSubmit = async () => {
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
                seqID: currentTask.seqID || '',
                shotID: currentTask.shotID || '',
                dependsOn: currentTask.dependsOn || [],
                display_status: 'online'
            };




            console.log('送信するタスクデータ:', taskData);  // デバッグログを追加




            if (isEditMode && currentTask.id !== null) {
                const response = await api.put(`/tasks/${currentTask.id}`, taskData);
                console.log('更新レスポンス:', response.data);  // デバッグログを追加
                setSnackbar({
                    open: true,
                    message: 'タスクが更新されました',
                    severity: 'success'
                });
            } else {
                const response = await api.post('/tasks', taskData);
                console.log('作成レスポンス:', response.data);  // デバッグログを追加
                setSnackbar({
                    open: true,
                    message: 'タスクが作成されました',
                    severity: 'success'
                });
            }




            setOpenDialog(false);
            
            // グローバルデータを更新して他のページにも反映
            if (refreshGlobalData) {
                if (isEditMode) {
                    console.log('[TasksPage] Refreshing global data after task update...');
                } else {
                    console.log('[TasksPage] Refreshing global data after task creation...');
                }
                await refreshGlobalData();
                console.log('[TasksPage] Global data refresh completed');
            }
        } catch (err: any) {
            console.error('タスクの保存に失敗しました:', err);
            console.error('エラーの詳細:', {
                status: err.response?.status,
                data: err.response?.data,
                config: err.config
            });  // より詳細なエラー情報をログ出力
           
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
        setSnackbar({...snackbar, open: false});
    };



    // 並び替え用の素の値を各行に前計算して埋める
    const rows = useMemo(() => {
        const nameByProjectId = new Map(projects.map(p => [p.id, p.name ?? '']));
        const nameByTaskId = new Map(tasks.map(t => [t.id, t.name ?? '']));
    
        const dependsText = (row: Task) => {
        if (!row.dependsOn?.length) return '';
        return row.dependsOn
            .map((id) => {
            const n = parseInt(String(id).replace('task-',''), 10);
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
        { field: 'name', headerName: 'タスク名', minWidth: 80, flex: 1, renderCell: (params: GridRenderCellParams) => {
            const row = params.row;
            const text = row.name || '-';
            return (
                <Tooltip title={text} followCursor>
                    <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {text}
                    </Box>
                </Tooltip>
            );
        } },
        { field: 'description', headerName: '説明', minWidth: 100, flex: 1, renderCell: (params: GridRenderCellParams) => {
            const row = params.row;
            const text = row.description || '-';
            return (
                <Tooltip title={text} followCursor>
                    <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {text}
                    </Box>
                </Tooltip>
            );
        } },
        { field: 'status', headerName: 'ステータス', minWidth: 80, width: 120, renderCell: (params: GridRenderCellParams) => {
            const row = params.row;
            return (
                <Chip
                    label={row.status || '未設定'}
                    size="small"
                    sx={{
                        backgroundColor: getTaskStatusColor(row.status),
                        color: 'white',
                        '& .MuiChip-label': { px: 1 }
                    }}
                />
            );
        } },
        {
            field: '_projectName',
            headerName: 'プロジェクト',
            minWidth: 100,
            width: 150,
            sortable: true,
            renderCell: (params) => String(params.value ?? '-'),
            sortComparator: (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'ja'),
        },
        { field: 'priority', headerName: '優先度', minWidth: 80, width: 100, renderCell: (params: GridRenderCellParams) => {
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
        } },
        { field: 'seqID', headerName: 'seq', minWidth: 60, width: 80, renderCell: (params: GridRenderCellParams) => {
            const row = params.row;
            return row.seqID || '-';
        } },
        { field: 'shotID', headerName: 'shot', minWidth: 60, width: 80, renderCell: (params: GridRenderCellParams) => {
            const row = params.row;
            const text = row.shotID || '-';
            return (
                <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {text}
                </Box>
            );
        } },
        { field: 'type', headerName: 'type', minWidth: 80, width: 100, renderCell: (params: GridRenderCellParams) => {
            const row = params.row;
            // データベースに保存されているタスクタイプを小文字化して表示
            return row.type ? row.type.toLowerCase() : '-';
        } },
        { field: 'assigned_to', headerName: '担当者', minWidth: 80, width: 120, 
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
        { field: 'cost', headerName: 'コスト', minWidth: 60, width: 90, renderCell: (params: GridRenderCellParams) => {
            const row = params.row;
            return row.cost ?? '-';
        } },
        {
            field: '_actionsSortKey',
            headerName: '操作',
            width: 200,
            sortable: true,
            sortComparator: (a, b) => Number(a ?? 0) - Number(b ?? 0),
            renderCell: (params) => {
              const row = params.row as Task;
              return (
                <Box>
                  <Button size="small" onClick={() => handleViewHistory(row)} sx={{ mr: 1 }}>
                    <HistoryIcon />
                  </Button>
                  <Button size="small" onClick={() => handleEditTask(row)} sx={{ mr: 1 }}>
                    <EditIcon />
                  </Button>
                  <Button size="small" color="error" onClick={() => handleDeleteTask(row.id)}>
                    <DeleteIcon />
                  </Button>
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
            console.error('ステータス履歴の取得に失敗しました:', err);
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
        <Box sx={{ p: 2 }}>
            <Paper sx={{ mb: 2, p: 2 }}>
                <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} sm={4}>
                        <FormControl fullWidth variant="standard" size="small">
                            <InputLabel shrink>ステータス</InputLabel>
                            <Select displayEmpty value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as string)} sx={{ fontSize: '0.8rem' }}>
                                <MenuItem value=""><em>全て</em></MenuItem>
                                {uniqueStatuses.map(status => (
                                    <MenuItem key={status} value={status}>{status}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <FormControl fullWidth variant="standard" size="small">
                            <InputLabel shrink>プロジェクト</InputLabel>
                            <Select displayEmpty value={projectFilter} onChange={(e) => setProjectFilter(e.target.value as string)} sx={{ fontSize: '0.8rem' }}>
                                <MenuItem value=""><em>全て</em></MenuItem>
                                {projects.map(project => (
                                    <MenuItem key={project.id} value={String(project.id)}>{project.name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <FormControl fullWidth variant="standard" size="small">
                            <InputLabel shrink>担当者</InputLabel>
                            <Select displayEmpty value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value as string)} sx={{ fontSize: '0.8rem' }}>
                                <MenuItem value=""><em>全て</em></MenuItem>
                                <MenuItem value="unassigned">未割当</MenuItem>
                                {users.map(user => (
                                    <MenuItem key={user.id} value={String(user.id)}>{user.username || user.email}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                </Grid>
            </Paper>




            <Paper>
                <Box 
                    ref={dataGridContainerRef} 
                    sx={{ 
                        width: '100%',
                        // 横スクロールのサポートを強化
                        // タッチデバイスでの横スクロールをサポート
                        WebkitOverflowScrolling: 'touch',
                        // スクロールバーのスタイリング（横スクロールバーのみ）
                        '&::-webkit-scrollbar': {
                            height: '8px'
                        },
                        '&::-webkit-scrollbar-thumb': {
                            backgroundColor: 'rgba(0,0,0,0.2)',
                            borderRadius: '4px'
                        },
                        '&::-webkit-scrollbar-thumb:hover': {
                            backgroundColor: 'rgba(0,0,0,0.3)'
                        }
                    }}
                >
                    <DataGrid
                        rows={rows}
                        columns={columns}
                        getRowId={(row) => row.id}
                        sortingMode="client"
                        sortingOrder={['asc','desc']}
                        sortModel={sortModel}
                        onSortModelChange={setSortModel}
                        paginationModel={paginationModel}
                        onPaginationModelChange={setPaginationModel}
                        pageSizeOptions={[10, 20, 50]}
                        rowHeight={40}
                        autoHeight
                        sx={{
                            '& .MuiDataGrid-columnHeaders': {
                                background: '#f5f5f5',
                                fontSize: '0.8rem'
                            },
                            '& .MuiDataGrid-cell': {
                                alignItems: 'center',
                                fontSize: '0.8rem'
                            },
                            '& .MuiDataGrid-footerContainer': {
                                fontSize: '0.8rem'
                            },
                            // DataGrid内部の横スクロールサポート
                            '& .MuiDataGrid-virtualScroller': {
                                overflowX: 'auto !important'
                            }
                        }}
                    />
                </Box>
            </Paper>




            {/* タスク詳細モーダル */}
            {selectedTask && (
                <Dialog open={isModalOpen} onClose={handleCloseModal} maxWidth="md" fullWidth>
                    <DialogTitle>タスク詳細: {selectedTask.name}</DialogTitle>
                    <DialogContent dividers>
                        <TableContainer component={Paper} sx={{ boxShadow: 'none', border: 'none' }}>
                            <Table size="small" aria-label="task details table">
                                <TableBody>
                                    <TableRow>
                                        <TableCell component="th" scope="row" sx={{ width: '30%', fontWeight: 'bold', borderBottom: 'none', pl:0 }}>プロジェクト:</TableCell>
                                        <TableCell sx={{ borderBottom: 'none' }}>{projectMap.get(selectedTask.project_id || 0) || '-'}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell component="th" scope="row" sx={{ fontWeight: 'bold', borderBottom: 'none', pl:0 }}>担当者:</TableCell>
                                        <TableCell sx={{ borderBottom: 'none' }}>{userMap.get(selectedTask.assigned_to || 0) || '未割り当て'}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell component="th" scope="row" sx={{ fontWeight: 'bold', verticalAlign: 'top', borderBottom: 'none', pl:0 }}>説明:</TableCell>
                                        <TableCell sx={{ whiteSpace: 'pre-line', borderBottom: 'none' }}>
                                            {selectedTask.description || '-'}
                                        </TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell component="th" scope="row" sx={{ fontWeight: 'bold', borderBottom: 'none', pl:0 }}>ステータス:</TableCell>
                                        <TableCell sx={{ borderBottom: 'none' }}>
                                            <Chip
                                                label={selectedTask.status || '-'}
                                                size="small"
                                                sx={{ backgroundColor: getTaskStatusColor(selectedTask.status), color: '#fff' }}
                                            />
                                        </TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell component="th" scope="row" sx={{ fontWeight: 'bold', borderBottom: 'none', pl:0 }}>開始日:</TableCell>
                                        <TableCell sx={{ borderBottom: 'none' }}>{formatDate(selectedTask.start_date)}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell component="th" scope="row" sx={{ fontWeight: 'bold', borderBottom: 'none', pl:0 }}>期日:</TableCell>
                                        <TableCell sx={{ borderBottom: 'none' }}>{formatDate(selectedTask.due_date)}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell component="th" scope="row" sx={{ fontWeight: 'bold', verticalAlign: 'top', borderBottom: 'none', pl:0 }}>依存元タスク:</TableCell>
                                        <TableCell sx={{ borderBottom: 'none' }}>
                                            {selectedTask.dependsOn && selectedTask.dependsOn.length > 0
                                                ? selectedTask.dependsOn
                                                    .map(depIdStr => {
                                                        const numericId = parseInt(depIdStr.replace("task-", ""), 10);
                                                        if (!isNaN(numericId)) {
                                                            return taskMap.get(numericId) || `ID ${depIdStr}`;
                                                        }
                                                        return `Invalid ID ${depIdStr}`;
                                                    })
                                                    .join(', ')
                                                : '-'}
                                        </TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell component="th" scope="row" sx={{ fontWeight: 'bold', borderBottom: 'none', pl:0 }}>コスト:</TableCell>
                                        <TableCell sx={{ borderBottom: 'none' }}>{selectedTask.cost?.toLocaleString() ?? '-'}</TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={handleCloseModal}>閉じる</Button>
                    </DialogActions>
                </Dialog>
            )}




            <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ fontSize: '1rem' }}>{isEditMode ? 'タスク編集' : '新規タスク'}</DialogTitle>
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
                        <FormControl fullWidth size="small">
                            <InputLabel>担当者</InputLabel>
                            <Select
                                name="assigned_to"
                                value={currentTask.assigned_to || ''}
                                label="担当者"
                                onChange={handleSelectChange}
                            >
                                <MenuItem value="">未設定</MenuItem>
                                {users.map(user => (
                                    <MenuItem key={user.id} value={user.id}>{user.name || user.email}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
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
                        <TextField
                            name="due_date"
                            label="期日"
                            type="date"
                            value={currentTask.due_date}
                            onChange={handleInputChange}
                            fullWidth
                            InputLabelProps={{ shrink: true }}
                            size="small"
                        />
                        <TextField
                            name="cost"
                            label="コスト"
                            type="number"
                            value={currentTask.cost}
                            onChange={handleInputChange}
                            fullWidth
                            size="small"
                        />
                        <TextField
                            name="seqID"
                            label="シーケンスID"
                            value={currentTask.seqID}
                            onChange={handleInputChange}
                            fullWidth
                            size="small"
                        />
                        <TextField
                            name="shotID"
                            label="ショットID"
                            value={currentTask.shotID}
                            onChange={handleInputChange}
                            fullWidth
                            size="small"
                        />
                        <FormControl fullWidth size="small">
                            <InputLabel>Type</InputLabel>
                            <Select
                                name="type"
                                value={currentTask.type}
                                label="Type"
                                onChange={handleSelectChange}
                            >
                                <MenuItem value="development">Development</MenuItem>
                                <MenuItem value="design">Design</MenuItem>
                                <MenuItem value="documentation">Documentation</MenuItem>
                                <MenuItem value="testing">Testing</MenuItem>
                                <MenuItem value="maintenance">Maintenance</MenuItem>
                                <MenuItem value="fx">FX</MenuItem>
                                <MenuItem value="asset">Asset</MenuItem>
                                <MenuItem value="animation">Animation</MenuItem>
                                <MenuItem value="lighting">Lighting</MenuItem>
                                <MenuItem value="comp">Comp</MenuItem>
                            </Select>
                        </FormControl>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseDialog} size="small">キャンセル</Button>
                    <Button onClick={handleSubmit} variant="contained" color="primary" size="small">
                        {isEditMode ? '更新' : '作成'}
                    </Button>
                </DialogActions>
            </Dialog>




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
        </Box>
    );
};




export default TasksPage;





