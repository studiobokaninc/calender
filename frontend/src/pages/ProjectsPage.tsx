import React, { useState, useEffect, useMemo } from 'react';
import { Box, Typography, CircularProgress, Paper, LinearProgress, Chip, Select, MenuItem, FormControl, Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, Snackbar, Alert, InputLabel, SelectChangeEvent, Tooltip, useTheme } from '@mui/material';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
import api from '../services/api';
import { Project, Task } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { usePageState } from '../contexts/PageStateContext';
import { format, parseISO, isValid } from 'date-fns';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import ProjectDeleteDialog from '../components/ProjectDeleteDialog';
import CsvParser from '../components/CsvParser';

// Helper function to get project status color
const getProjectStatusColor = (status?: string): string => {
    switch (status) {
        case 'planning': return '#FF9800'; // Orange
        case 'in-progress': return '#4CAF50'; // Green
        case 'completed': return '#9E9E9E'; // Grey
        case 'delayed': return '#f44336'; // Red
        case 'on-hold': return '#2196f3'; // Blue
        default: return '#757575';
    }
};

// Helper function to get priority color
const getPriorityColor = (priority?: string): string => {
    switch (priority) {
        case 'high': return '#f44336'; // Red
        case 'medium': return '#FF9800'; // Orange
        case 'low': return '#4CAF50'; // Green
        default: return '#757575'; // Grey
    }
};

// Helper function to get display status color
const getDisplayStatusColor = (status?: string): string => {
    switch (status) {
        case 'online': return '#4CAF50'; // Green
        case 'offline': return '#9E9E9E'; // Grey
        default: return '#757575'; // Default grey
    }
};

interface ProjectWithProgress extends Project {
    totalCost: number;
    completedCost: number;
    progress: number;
}

interface ProjectFormData {
    id: string | number | null;
    name: string;
    description: string;
    status: string;
    priority: string;
    startDate: string;
    endDate: string;
    color: string;
    display_status: string;
}

const displayStatusOptions = [
    { value: 'online', label: 'オンライン' },
    { value: 'offline', label: 'オフライン' },
];

const ProjectsPage: React.FC = () => {
    const theme = useTheme();
    const isDark = theme.palette.mode === 'dark';
    const [projects, setProjects] = useState<ProjectWithProgress[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [projectStatusFilter] = useState<string>('');
    const [openDialog, setOpenDialog] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [currentProject, setCurrentProject] = useState<ProjectFormData>({
        id: null,
        name: '',
        description: '',
        status: 'planning',
        priority: '',
        startDate: format(new Date(), 'yyyy-MM-dd'),
        endDate: format(new Date(new Date().getTime() + 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
        color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
        display_status: 'online'
    });
    const [snackbar, setSnackbar] = useState<{ open: boolean, message: string, severity: 'success' | 'error' }>({
        open: false,
        message: '',
        severity: 'success'
    });
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const { refreshGlobalData } = usePageState();
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [selectedProject, setSelectedProject] = useState<ProjectWithProgress | null>(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const [projectsResponse, tasksResponse] = await Promise.all([
                api.get<Project[]>('/projects'),
                api.get<Task[]>('/tasks')
            ]);

            const projectsData = projectsResponse.data;
            const tasksData = tasksResponse.data;

            const tasksByProjectId = tasksData.reduce((acc, task) => {
                const projId = task.project_id;
                if (projId === undefined || projId === null) return acc;
                const key = String(projId);
                if (!acc[key]) {
                    acc[key] = [];
                }
                acc[key].push(task);
                return acc;
            }, {} as Record<string, Task[]>);

            const projectsWithProgress = projectsData.map((project): ProjectWithProgress => {
                const relatedTasks = tasksByProjectId[String(project.id)] || [];
                const totalCost = relatedTasks.reduce((sum, task) => sum + (Number(task.cost) || 0), 0);
                const completedCost = relatedTasks.reduce((sum, task) => {
                    const cost = Number(task.cost) || 0;
                    const status = task.status || 'todo';
                    switch (status) {
                        case 'completed':
                            return sum + cost * 1.0;
                        case 'in-progress':
                            return sum + cost * 0.4;
                        case 'review':
                            return sum + cost * 0.7;
                        case 'todo':
                        default:
                            return sum + cost * 0.0;
                    }
                }, 0);

                const progress = totalCost > 0 ? Math.round((completedCost / totalCost) * 100) : 0;

                return {
                    ...project,
                    totalCost,
                    completedCost,
                    progress,
                };
            });

            setProjects(projectsWithProgress);

        } catch (err) {
            console.error("Failed to fetch projects or tasks:", err);
            setError('プロジェクトまたはタスクの取得に失敗しました。');
        } finally {
            setLoading(false);
        }
    };


    const filteredProjects: ProjectWithProgress[] = useMemo(() => {
        const filtered = projects.filter(project => {
            const statusMatch = projectStatusFilter === '' || project.status === projectStatusFilter;
            return statusMatch;
        });
        // 新しいものが先に表示されるようソート（created_at 降順、なければ id 降順）
        return [...filtered].sort((a, b) => {
            const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
            const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
            if (bTime !== aTime) return bTime - aTime;
            return (b.id ?? 0) - (a.id ?? 0);
        });
    }, [projects, projectStatusFilter]);

    const handleAddProject = () => {
        setIsEditMode(false);
        setCurrentProject({
            id: null,
            name: '',
            description: '',
            status: 'planning',
            priority: '',
            startDate: format(new Date(), 'yyyy-MM-dd'),
            endDate: format(new Date(new Date().getTime() + 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
            color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
            display_status: 'online'
        });
        setOpenDialog(true);
    };

    const handleEditProject = (project: Project) => {
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

        const startDateParsed = safeParseDate(project.start_date);
        const endDateParsed = safeParseDate(project.end_date);

        setCurrentProject({
            id: project.id,
            name: project.name,
            description: project.description || '',
            status: project.status || 'planning',
            priority: project.priority || '',
            startDate: startDateParsed ? format(startDateParsed, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
            endDate: endDateParsed ? format(endDateParsed, 'yyyy-MM-dd') : format(new Date(new Date().getTime() + 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
            color: project.color || '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
            display_status: project.display_status || 'online'
        });
        setOpenDialog(true);
    };

    const handleDeleteProject = async (projectId: string | number) => {
        try {
            await api.delete(`/projects/${projectId}`);
            setSnackbar({
                open: true,
                message: 'プロジェクトが削除されました',
                severity: 'success'
            });
            await fetchData();
            // グローバルデータを更新して他のページにも反映
            if (refreshGlobalData) {
                console.log('[ProjectsPage] Refreshing global data after project deletion...');
                await refreshGlobalData();
                console.log('[ProjectsPage] Global data refresh completed for project deletion');
                // プロジェクト削除完了を通知するカスタムイベントを発火
                console.log('[ProjectsPage] Dispatching projectDeleted event...');
                window.dispatchEvent(new CustomEvent('projectDeleted', {
                    detail: { projectId: projectId }
                }));
            }
        } catch (err: any) {
            console.error('プロジェクトの削除に失敗しました:', err);
            const errorMessage = err.response?.data?.detail || 'プロジェクトの削除に失敗しました';
            setSnackbar({
                open: true,
                message: errorMessage,
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
            setCurrentProject(prev => ({
                ...prev,
                [name]: value
            }));
        }
    };

    const handleSelectChange = (e: SelectChangeEvent<string>) => {
        const { name, value } = e.target;
        if (name) {
            setCurrentProject(prev => ({
                ...prev,
                [name]: value
            }));
        }
    };

    const handleSubmit = async () => {
        try {
            const projectData = {
                name: currentProject.name,
                description: currentProject.description,
                status: currentProject.status,
                priority: currentProject.priority,
                start_date: currentProject.startDate,
                end_date: currentProject.endDate,
                color: currentProject.color,
                display_status: currentProject.display_status
            };

            if (isEditMode && currentProject.id !== null) {
                await api.put(`/projects/${currentProject.id}`, projectData);
                setSnackbar({
                    open: true,
                    message: 'プロジェクトが更新されました',
                    severity: 'success'
                });
            } else {
                await api.post('/projects', projectData);
                setSnackbar({
                    open: true,
                    message: 'プロジェクトが作成されました',
                    severity: 'success'
                });
            }

            setOpenDialog(false);
            await fetchData();
            // グローバルデータを更新して他のページにも反映
            if (refreshGlobalData) {
                console.log('[ProjectsPage] Refreshing global data after project save/update...');
                await refreshGlobalData();
                console.log('[ProjectsPage] Global data refresh completed for project save/update');
                // プロジェクト更新完了を通知するカスタムイベントを発火
                console.log('[ProjectsPage] Dispatching projectUpdated event...');
                window.dispatchEvent(new CustomEvent('projectUpdated', {
                    detail: { projectId: currentProject.id }
                }));
            }
        } catch (err) {
            console.error('プロジェクトの保存に失敗しました:', err);
            setSnackbar({
                open: true,
                message: 'プロジェクトの保存に失敗しました',
                severity: 'error'
            });
        }
    };

    const handleCloseSnackbar = () => {
        setSnackbar({ ...snackbar, open: false });
    };

    const handleDeleteClick = (project: ProjectWithProgress) => {
        setSelectedProject(project);
        setDeleteDialogOpen(true);
    };

    const handleDeleteConfirm = async () => {
        if (selectedProject) {
            await handleDeleteProject(selectedProject.id);
            setDeleteDialogOpen(false);
            setSelectedProject(null);
        }
    };

    // DataGrid用のカラム定義
    const columns: GridColDef[] = [
        { field: 'id', headerName: 'ID', width: 80, hideable: true },
        { field: 'name', headerName: 'プロジェクト名', minWidth: 120, flex: 1, hideable: false },
        { field: 'description', headerName: '説明', width: 200, flex: 1 },
        {
            field: 'status', headerName: '進捗', width: 120, renderCell: (params) => (
                <Chip label={params.value as string} style={{ background: getProjectStatusColor(params.value as string), color: '#fff' }} />
            )
        },
        {
            field: 'priority', headerName: '優先度', width: 120, renderCell: (params) => (
                <Chip label={params.value || '未設定'} style={{ background: getPriorityColor(params.value as string), color: '#fff' }} />
            )
        },
        {
            field: 'start_date', headerName: '開始日', width: 120, renderCell: (params: GridRenderCellParams<any, ProjectWithProgress>) => {
                const row = params.row;
                if (!row || !row.start_date) return '-';
                try {
                    const date = new Date(row.start_date);
                    return date.toLocaleDateString('ja-JP', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit'
                    });
                } catch {
                    return '-';
                }
            }
        },
        {
            field: 'end_date', headerName: '終了日', width: 120, renderCell: (params: GridRenderCellParams<any, ProjectWithProgress>) => {
                const row = params.row;
                if (!row || !row.end_date) return '-';
                try {
                    const date = new Date(row.end_date);
                    return date.toLocaleDateString('ja-JP', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit'
                    });
                } catch {
                    return '-';
                }
            }
        },
        {
            field: 'progress', headerName: '進捗率(%)', width: 140, renderCell: (params: GridRenderCellParams<any, ProjectWithProgress>) => {
                const value = Number(params.value) || 0;
                return (
                    <Box sx={{ position: 'relative', width: '100%', height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <LinearProgress variant="determinate" value={value} sx={{ height: 20, borderRadius: 4, width: '100%' }} />
                        <Typography variant="body2" sx={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: value > 50 ? '#fff' : '#333', fontSize: '0.8rem' }}>
                            {value}%
                        </Typography>
                    </Box>
                );
            }
        },
        {
            field: 'display_status',
            headerName: '表示ステータス',
            width: 140,
            renderCell: (params: GridRenderCellParams<any, ProjectWithProgress>) => {
                const row = params.row;
                const value = typeof params.value === 'string' ? params.value : 'online';
                const label = displayStatusOptions.find(opt => opt.value === value)?.label ?? value;
                const statusColor = getDisplayStatusColor(value);
                if (!isAdmin) {
                    return (
                        <Chip 
                            label={label} 
                            size="small"
                            sx={{ 
                                backgroundColor: statusColor, 
                                color: '#fff',
                                fontSize: '0.75rem',
                                height: 24,
                                fontWeight: 500
                            }} 
                        />
                    );
                }
                return (
                    <Select
                        size="small"
                        value={value}
                        onChange={async (e: SelectChangeEvent) => {
                            const newStatus = e.target.value as string;
                            try {
                                await api.put(`/projects/${row.id}`, { display_status: newStatus });
                                setProjects((prev) => prev.map(p => p.id === row.id ? { ...p, display_status: newStatus } : p));
                                setSnackbar({ open: true, message: '表示ステータスを更新しました', severity: 'success' });
                                // グローバルデータを更新して他のページにも反映
                                if (refreshGlobalData) {
                                    console.log('[ProjectsPage] Refreshing global data after display status update...');
                                    await refreshGlobalData();
                                    console.log('[ProjectsPage] Global data refresh completed for display status update');
                                    // プロジェクト表示ステータス更新完了を通知するカスタムイベントを発火
                                    console.log('[ProjectsPage] Dispatching projectStatusUpdated event...');
                                    window.dispatchEvent(new CustomEvent('projectStatusUpdated', {
                                        detail: { projectId: row.id, newStatus }
                                    }));
                                }
                            } catch (err) {
                                setSnackbar({ open: true, message: '表示ステータスの更新に失敗しました', severity: 'error' });
                            }
                        }}
                        sx={{ 
                            minWidth: 100, 
                            fontSize: '0.75rem',
                            backgroundColor: statusColor,
                            color: '#fff',
                            '& .MuiSelect-select': {
                                color: '#fff',
                                fontWeight: 500
                            },
                            '& .MuiOutlinedInput-notchedOutline': {
                                borderColor: statusColor
                            },
                            '&:hover .MuiOutlinedInput-notchedOutline': {
                                borderColor: statusColor
                            },
                            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                                borderColor: statusColor
                            }
                        }}
                        MenuProps={{
                            PaperProps: {
                                sx: { fontSize: '0.75rem' }
                            }
                        }}
                    >
                        {displayStatusOptions.map(opt => (
                            <MenuItem 
                                key={opt.value} 
                                value={opt.value} 
                                sx={{ 
                                    fontSize: '0.75rem',
                                    backgroundColor: opt.value === value ? statusColor : 'transparent',
                                    color: opt.value === value ? '#fff' : 'inherit',
                                    '&:hover': {
                                        backgroundColor: opt.value === value ? statusColor : 'rgba(0, 0, 0, 0.04)'
                                    }
                                }}
                            >
                                {opt.label}
                            </MenuItem>
                        ))}
                    </Select>
                );
            },
        },
        ...(isAdmin ? [{
            field: 'actions',
            headerName: '操作',
            width: 120,
            sortable: false,
            filterable: false,
            headerAlign: 'center' as const,
            align: 'center' as const,
            hideable: false,
            renderCell: (params: GridRenderCellParams<any, ProjectWithProgress>) => {
                const row = params.row;
                return (
                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                        <Tooltip title="編集">
                            <IconButton
                                size="small"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleEditProject(row);
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
                                    handleDeleteClick(row);
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
        } as GridColDef] : []),
    ];

    if (loading && projects.length === 0) {
        return <CircularProgress />;
    }

    if (error) {
        return <Typography color="error">{error}</Typography>;
    }

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                maxHeight: 'calc(100vh - 120px)',
                minHeight: 0,
                overflow: 'hidden',
                p: { xs: 1.5, sm: 2 },
                maxWidth: 1600,
                mx: 'auto',
                width: '100%',
            }}
        >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, mb: 2 }}>
                <Typography variant="h5" sx={{ fontWeight: 600, color: 'text.primary' }}>
                    プロジェクト
                </Typography>
                {isAdmin && (
                    <Button
                        variant="contained"
                        size="medium"
                        startIcon={<AddIcon />}
                        onClick={handleAddProject}
                        sx={{ textTransform: 'none', borderRadius: 2 }}
                    >
                        新規プロジェクト
                    </Button>
                )}
            </Box>

            {isAdmin && (
                <Box sx={{ flexShrink: 0, mb: 1.5 }}>
                    <CsvParser onImportComplete={async () => {
                        await fetchData();
                        if (refreshGlobalData) {
                            await refreshGlobalData();
                        }
                    }} />
                </Box>
            )}

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
                }}
            >
                <Box sx={{ flex: 1, minHeight: 0, width: '100%' }}>
                    <DataGrid<ProjectWithProgress>
                        rows={filteredProjects}
                        columns={columns}
                        initialState={{
                            pagination: { paginationModel: { pageSize: 10, page: 0 } },
                        }}
                        pageSizeOptions={[10, 20, 50]}
                        checkboxSelection={false}
                        disableRowSelectionOnClick
                        getRowId={(row) => row.id}
                        rowHeight={40}
                        onRowDoubleClick={isAdmin ? (params) => {
                            handleEditProject(params.row);
                        } : undefined}
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
                            '& .MuiDataGrid-pinnedColumns': {
                                backgroundColor: 'background.paper',
                                boxShadow: isDark ? '-2px 0 4px rgba(0,0,0,0.3)' : '-2px 0 4px rgba(0,0,0,0.1)'
                            }
                        }}
                    />
                </Box>
            </Paper>

            <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
                <DialogTitle>{isEditMode ? 'プロジェクト編集' : '新規プロジェクト'}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 2 }}>
                        <TextField
                            name="name"
                            label="プロジェクト名"
                            value={currentProject.name}
                            onChange={handleInputChange}
                            fullWidth
                            required
                        />
                        <TextField
                            name="description"
                            label="説明"
                            value={currentProject.description}
                            onChange={handleInputChange}
                            fullWidth
                            multiline
                            rows={3}
                        />
                        <FormControl fullWidth>
                            <InputLabel>進捗</InputLabel>
                            <Select
                                name="status"
                                value={currentProject.status}
                                label="進捗"
                                onChange={handleSelectChange}
                            >
                                <MenuItem value="planning">計画中</MenuItem>
                                <MenuItem value="in-progress">進行中</MenuItem>
                                <MenuItem value="completed">完了</MenuItem>
                                <MenuItem value="on-hold">保留中</MenuItem>
                                <MenuItem value="cancelled">キャンセル</MenuItem>
                                <MenuItem value="delayed">遅延</MenuItem>
                            </Select>
                        </FormControl>
                        <FormControl fullWidth>
                            <InputLabel>優先度</InputLabel>
                            <Select
                                name="priority"
                                value={currentProject.priority}
                                label="優先度"
                                onChange={handleSelectChange}
                            >
                                <MenuItem value="high">高</MenuItem>
                                <MenuItem value="medium">中</MenuItem>
                                <MenuItem value="low">低</MenuItem>
                            </Select>
                        </FormControl>
                        <FormControl fullWidth>
                            <InputLabel>表示ステータス</InputLabel>
                            <Select
                                name="display_status"
                                value={currentProject.display_status}
                                label="表示ステータス"
                                onChange={handleSelectChange}
                            >
                                {displayStatusOptions.map(opt => (
                                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <TextField
                            name="startDate"
                            label="開始日"
                            type="date"
                            value={currentProject.startDate}
                            onChange={handleInputChange}
                            fullWidth
                            InputLabelProps={{ shrink: true }}
                        />
                        <TextField
                            name="endDate"
                            label="終了日"
                            type="date"
                            value={currentProject.endDate}
                            onChange={handleInputChange}
                            fullWidth
                            InputLabelProps={{ shrink: true }}
                        />
                        <TextField
                            name="color"
                            label="色"
                            type="color"
                            value={currentProject.color}
                            onChange={handleInputChange}
                            fullWidth
                            InputLabelProps={{ shrink: true }}
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseDialog}>キャンセル</Button>
                    <Button onClick={handleSubmit} variant="contained" color="primary">
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

            {selectedProject && (
                <ProjectDeleteDialog
                    open={deleteDialogOpen}
                    projectId={selectedProject.id}
                    projectName={selectedProject.name}
                    onClose={() => setDeleteDialogOpen(false)}
                    onDelete={handleDeleteConfirm}
                />
            )}
        </Box>
    );
};

export default ProjectsPage; 