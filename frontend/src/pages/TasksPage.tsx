import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    Box, Typography, CircularProgress, Paper, TableContainer, Table, TableHead,
    TableBody, TableRow, TableCell, Chip, Select, MenuItem, FormControl, InputLabel, Grid,
    Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Stack,
    IconButton, Snackbar, Alert, SelectChangeEvent
} from '@mui/material';
import { Edit as EditIcon, Delete as DeleteIcon, History as HistoryIcon } from '@mui/icons-material';
import api from '../services/api';
import { Task, Project, User } from '../types'; // Import User type as well
import { format, parseISO, isValid } from 'date-fns';
import { ja } from 'date-fns/locale';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';

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

const columnDefs = [
  { key: 'name', label: 'タスク名', minWidth: 80, defaultWidth: 180 },
  { key: 'description', label: '説明', minWidth: 100, defaultWidth: 200 },
  { key: 'status', label: 'ステータス', minWidth: 80, defaultWidth: 120 },
  { key: 'project', label: 'プロジェクト', minWidth: 80, defaultWidth: 120 },
  { key: 'assignee', label: '担当者', minWidth: 80, defaultWidth: 120 },
  { key: 'start', label: '開始日', minWidth: 80, defaultWidth: 110 },
  { key: 'due', label: '期日', minWidth: 80, defaultWidth: 110 },
  { key: 'depends', label: '依存元タスク', minWidth: 80, defaultWidth: 150 },
  { key: 'cost', label: 'コスト', minWidth: 60, defaultWidth: 90 },
];

interface TaskFormData {
    id: number | null;
    name: string;
    description: string;
    status: string;
    priority: string;
    assigned_to: number | null;
    start_date: string;
    due_date: string;
    cost: number;
    type: string;
    seqID: string;
    shotID: string;
    dependsOn: string[];
}

// ステータス履歴表示用のインターフェース
interface StatusHistoryEntry {
    id: number;
    task_id: number;
    status: string;
    changed_at: string;
    changed_by: number;
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

    const [statusFilter, setStatusFilter] = useState<string>('');
    const [projectFilter, setProjectFilter] = useState<string>('');
    const [assigneeFilter, setAssigneeFilter] = useState<string>('');

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [colWidths, setColWidths] = useState(() =>
      Object.fromEntries(columnDefs.map(col => [col.key, col.defaultWidth]))
    );
    const resizing = useRef<{ key: string, startX: number, startWidth: number } | null>(null);
    const [openDialog, setOpenDialog] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [currentTask, setCurrentTask] = useState<TaskFormData>({
        id: null,
        name: '',
        description: '',
        status: 'todo',
        priority: '',
        assigned_to: null,
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
    const [statusHistoryDialog, setStatusHistoryDialog] = useState(false);
    const [statusHistory, setStatusHistory] = useState<StatusHistory[]>([]);
    const [selectedTaskForHistory, setSelectedTaskForHistory] = useState<Task | null>(null);
    const [historyDialogOpen, setHistoryDialogOpen] = useState(false);

    // タスク一覧を取得する関数
    const fetchData = async () => {
        try {
            setLoading(true);
            const [tasksResponse, projectsResponse, usersResponse] = await Promise.all([
                api.get('/tasks'),
                api.get('/projects'),
                api.get('/api/users')
            ]);
            setTasks(tasksResponse.data);
            setProjects(projectsResponse.data);
            setUsers(usersResponse.data);
            setError(null);
        } catch (err) {
            console.error('データの取得に失敗しました:', err);
            setError('データの取得に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    // 初回レンダリング時にデータを取得
    useEffect(() => {
        fetchData();
    }, []);

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

    const handleTaskRowClick = (task: Task) => {
        setSelectedTask(task);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setSelectedTask(null); 
    };

    // リサイズ用ハンドラ
    const handleResizeMouseDown = (colKey: string) => (e: React.MouseEvent<HTMLDivElement>) => {
      resizing.current = { key: colKey, startX: e.clientX, startWidth: colWidths[colKey] };
      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!resizing.current) return;
        const { key, startX, startWidth } = resizing.current;
        const def = columnDefs.find(c => c.key === key)!;
        const newWidth = Math.max(def.minWidth, startWidth + (moveEvent.clientX - startX));
        setColWidths(w => ({ ...w, [key]: newWidth }));
      };
      const onMouseUp = () => {
        resizing.current = null;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
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
            start_date: startDateParsed ? format(startDateParsed, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
            due_date: dueDateParsed ? format(dueDateParsed, 'yyyy-MM-dd') : format(new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
            cost: task.cost || 0,
            type: task.extendedProps?.type?.toLowerCase() || '',  // extendedPropsから取得
            seqID: task.extendedProps?.seqID || '',  // extendedPropsから取得
            shotID: task.extendedProps?.shotID || '',  // extendedPropsから取得
            dependsOn: task.dependsOn || []
        });
        setOpenDialog(true);
    };

    const handleDeleteTask = async (taskId: number) => {
        try {
            await api.delete(`/tasks/${taskId}`);
            setTasks(tasks.filter(task => task.id !== taskId));
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
            await fetchData();
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

    // DataGrid用のカラム定義
    const columns: GridColDef[] = useMemo(() => [
        { field: 'name', headerName: 'タスク名', minWidth: 80, flex: 1 },
        { field: 'description', headerName: '説明', minWidth: 100, flex: 1, renderCell: (params: GridRenderCellParams) => {
            const row = params.row;
            return row.description || '-';
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
        { field: 'project', headerName: 'プロジェクト', minWidth: 100, width: 150, renderCell: (params: GridRenderCellParams) => {
            const row = params.row;
            const project = projects.find(p => p.id === row.project_id);
            return project ? project.name : '-';
        } },
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
            return row.shotID || '-';
        } },
        { field: 'type', headerName: 'type', minWidth: 80, width: 100, renderCell: (params: GridRenderCellParams) => {
            const row = params.row;
            const typeLabels: { [key: string]: string } = {
                'development': 'Development',
                'design': 'Design',
                'documentation': 'Documentation',
                'testing': 'Testing',
                'maintenance': 'Maintenance',
                'fx': 'FX',
                'asset': 'Asset',
                'animation': 'Animation',
                'lighting': 'Lighting',
                'comp': 'Comp'
            };
            return typeLabels[row.type] || '-';
        } },
        { field: 'assigned_to', headerName: '担当者', minWidth: 80, width: 120, renderCell: (params: GridRenderCellParams) => {
            const row = params.row;
            const user = users.find(u => u.id === row.assigned_to);
            return user ? user.username : '-';
        } },
        { field: 'start', headerName: '開始日', minWidth: 80, width: 110, renderCell: (params: GridRenderCellParams) => {
            const row = params.row;
            return formatDate(row.start_date);
        } },
        { field: 'due', headerName: '期日', minWidth: 80, width: 110, renderCell: (params: GridRenderCellParams) => {
            const row = params.row;
            return formatDate(row.due_date);
        } },
        { field: 'depends', headerName: '依存元タスク', minWidth: 80, width: 150, renderCell: (params: GridRenderCellParams) => {
            const row = params.row;
            if (!row.dependsOn || row.dependsOn.length === 0) return '-';
            return row.dependsOn
                .map((id: string) => {
                    const numericId = parseInt(id.replace('task-', ''), 10);
                    return taskMap.get(numericId);
                })
                .filter(Boolean)
                .join(', ') || '-';
        } },
        { field: 'cost', headerName: 'コスト', minWidth: 60, width: 90, renderCell: (params: GridRenderCellParams) => {
            const row = params.row;
            return row.cost ?? '-';
        } },
        {
            field: 'actions',
            headerName: '操作',
            width: 200,
            renderCell: (params: GridRenderCellParams) => (
                <Box>
                    <Button
                        size="small"
                        onClick={() => handleViewHistory(params.row)}
                        sx={{ mr: 1 }}
                    >
                        <HistoryIcon />
                    </Button>
                    <Button
                        size="small"
                        onClick={() => handleEditTask(params.row)}
                        sx={{ mr: 1 }}
                    >
                        <EditIcon />
                    </Button>
                    <Button
                        size="small"
                        color="error"
                        onClick={() => handleDeleteTask(params.row.id)}
                    >
                        <DeleteIcon />
                    </Button>
                </Box>
            ),
        },
    ], [users, projects, taskMap]);

    // ステータス履歴を表示する関数
    const handleViewHistory = async (task: Task) => {
        try {
            const response = await api.get<StatusHistory[]>(`/tasks/${task.id}/status-history`);
            // 日付でソート
            const sortedHistory = response.data.sort((a, b) => 
                new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime()
            );
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

    const handleStatusChange = async (taskId: number, newStatus: string) => {
        try {
            // タスクを取得
            const task = tasks.find(t => t.id === taskId);
            if (!task) {
                throw new Error('タスクが見つかりません');
            }

            const now = new Date().toISOString();

            // タスクのステータスを更新
            await api.put(`/tasks/${taskId}`, { 
                status: newStatus.toLowerCase(),  // 小文字に変換
                priority: task.extendedProps?.priority?.toLowerCase() || 'low',
                type: task.extendedProps?.type || null,
                seqID: task.extendedProps?.seqID || null,
                shotID: task.extendedProps?.shotID || null,
                display_status: task.display_status || 'online'
            });
            
            // ステータス履歴を記録
            await api.post(`/tasks/${taskId}/status-history`, {
                status: newStatus.toLowerCase(),  // 小文字に変換
                changed_at: now  // 現在時刻を明示的に設定
            });
            
            // タスク一覧を更新
            await fetchData();
            
            setSnackbar({
                open: true,
                message: 'タスクのステータスを更新しました',
                severity: 'success'
            });
        } catch (err) {
            console.error('タスクのステータス更新に失敗しました:', err);
            setSnackbar({
                open: true,
                message: 'タスクのステータス更新に失敗しました',
                severity: 'error'
            });
        }
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
                <Box sx={{ height: 600, width: '100%' }}>
                    <DataGrid
                        rows={filteredTasks}
                        columns={columns}
                        getRowId={(row) => row.id}
                        initialState={{
                            pagination: { paginationModel: { pageSize: 20, page: 0 } },
                        }}
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