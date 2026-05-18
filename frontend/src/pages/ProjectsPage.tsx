import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, CircularProgress, Paper, LinearProgress, Chip, Select, MenuItem, FormControl, Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, Snackbar, Alert, InputLabel, SelectChangeEvent, Tooltip, useTheme, Card, CardContent, useMediaQuery, Breadcrumbs, Link } from '@mui/material';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon, Folder as FolderIcon } from '@mui/icons-material';
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
    shots?: number;
    retakes?: number;
    troubles?: number;
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
    const navigate = useNavigate();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
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
            const [projectsResponse, tasksResponse, summaryResponse] = await Promise.all([
                api.get<Project[]>('/projects'),
                api.get<Task[]>('/tasks'),
                api.get<Record<string, {shots: number, retakes: number, troubles: number}>>('/api/projects/summary').catch(() => ({ data: {} }))
            ]);

            const projectsData = projectsResponse.data;
            const tasksData = tasksResponse.data;
            const scoreSummary = (summaryResponse as any).data || {};

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
                const summary = scoreSummary[String(project.id)] || { shots: 0, retakes: 0, troubles: 0 };
                
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
                    shots: summary.shots,
                    retakes: summary.retakes,
                    troubles: summary.troubles,
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
            field: 'shots', headerName: 'ショット数', width: 110, renderCell: (params) => (
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{params.value || 0}</Typography>
            )
        },
        {
            field: 'retakes', headerName: 'リテイク', width: 110, renderCell: (params) => (
                <Chip
                    label={params.value || 0}
                    size="small"
                    sx={{
                        bgcolor: (params.value as number) > 0 ? 'warning.light' : 'action.hover',
                        color: (params.value as number) > 0 ? 'warning.dark' : 'text.disabled',
                        fontWeight: 700
                    }}
                />
            )
        },
        {
            field: 'troubles', headerName: 'トラブル', width: 110, renderCell: (params) => (
                <Chip
                    label={params.value || 0}
                    size="small"
                    sx={{
                        bgcolor: (params.value as number) > 0 ? 'error.light' : 'action.hover',
                        color: (params.value as number) > 0 ? 'error.dark' : 'text.disabled',
                        fontWeight: 700
                    }}
                />
            )
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
                maxHeight: isMobile ? 'none' : 'calc(100vh - 120px)',
                minHeight: 0,
                overflow: isMobile ? 'visible' : 'hidden',
                p: { xs: 1.5, sm: 2 },
                maxWidth: 1600,
                mx: 'auto',
                width: '100%',
                pb: isMobile ? 10 : 2, // Bottom nav space
            }}
        >
            <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
                <Box>
                    <Breadcrumbs sx={{ mb: 1.5 }}>
                        <Link color="inherit" onClick={() => navigate('/dashboard')} sx={{ cursor: 'pointer', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                            App
                        </Link>
                        <Typography color="text.primary" sx={{ fontWeight: 500 }}>Projects</Typography>
                    </Breadcrumbs>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <FolderIcon sx={{ fontSize: '2rem', color: '#2196F3' }} />
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
                            Projects
                        </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.95rem' }}>
                        進行中のプロジェクトの状況とリソース配分を管理します。
                    </Typography>
                </Box>
                {isAdmin && (
                    <Button
                        variant="contained"
                        size={isMobile ? "small" : "medium"}
                        startIcon={<AddIcon />}
                        onClick={handleAddProject}
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
                        新規プロジェクト作成
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

            {!isMobile ? (
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
            ) : (
                <Stack spacing={2}>
                    {filteredProjects.map((project) => (
                        <Card
                            key={project.id}
                            elevation={0}
                            sx={{
                                borderRadius: 3,
                                border: '1px solid',
                                borderColor: 'divider',
                                position: 'relative',
                                overflow: 'visible'
                            }}
                        >
                            <CardContent sx={{ p: 2 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                                    <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1rem', flex: 1, mr: 1 }}>
                                        {project.name}
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                                        <Chip
                                            label={project.status}
                                            size="small"
                                            sx={{
                                                backgroundColor: getProjectStatusColor(project.status ?? undefined),
                                                color: '#fff',
                                                fontSize: '0.7rem',
                                                height: 20
                                            }}
                                        />
                                        {isAdmin && (
                                            <IconButton size="small" onClick={() => handleEditProject(project)} sx={{ ml: 0.5 }}>
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                        )}
                                    </Box>
                                </Box>

                                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: '0.85rem' }}>
                                    {project.description || '説明なし'}
                                </Typography>

                                <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                    <Box sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>Shots:</Typography>
                                        <Typography variant="caption" sx={{ fontWeight: 700 }}>{project.shots || 0}</Typography>
                                    </Box>
                                    <Box sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: (project.retakes || 0) > 0 ? 'warning.light' : 'action.hover', border: '1px solid', borderColor: (project.retakes || 0) > 0 ? 'warning.main' : 'divider', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Typography variant="caption" sx={{ fontWeight: 600, color: (project.retakes || 0) > 0 ? 'warning.dark' : 'text.secondary' }}>Retakes:</Typography>
                                        <Typography variant="caption" sx={{ fontWeight: 700, color: (project.retakes || 0) > 0 ? 'warning.dark' : 'inherit' }}>{project.retakes || 0}</Typography>
                                    </Box>
                                    <Box sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: (project.troubles || 0) > 0 ? 'error.light' : 'action.hover', border: '1px solid', borderColor: (project.troubles || 0) > 0 ? 'error.main' : 'divider', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Typography variant="caption" sx={{ fontWeight: 600, color: (project.troubles || 0) > 0 ? 'error.dark' : 'text.secondary' }}>Troubles:</Typography>
                                        <Typography variant="caption" sx={{ fontWeight: 700, color: (project.troubles || 0) > 0 ? 'error.dark' : 'inherit' }}>{project.troubles || 0}</Typography>
                                    </Box>
                                </Box>

                                <Box sx={{ mb: 1 }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                        <Typography variant="caption" color="text.secondary">進捗率</Typography>
                                        <Typography variant="caption" sx={{ fontWeight: 700 }}>{project.progress}%</Typography>
                                    </Box>
                                    <LinearProgress
                                        variant="determinate"
                                        value={project.progress}
                                        sx={{
                                            height: 8,
                                            borderRadius: 4,
                                            backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                                            '& .MuiLinearProgress-bar': {
                                                borderRadius: 4,
                                                background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.primary.light})`
                                            }
                                        }}
                                    />
                                </Box>

                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
                                    <Box>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem' }}>優先度</Typography>
                                        <Chip
                                            label={project.priority || '未設定'}
                                            size="small"
                                            variant="outlined"
                                            sx={{
                                                height: 20,
                                                fontSize: '0.7rem',
                                                borderColor: getPriorityColor(project.priority ?? undefined),
                                                color: getPriorityColor(project.priority ?? undefined),
                                                mt: 0.5
                                            }}
                                        />
                                    </Box>
                                    <Box sx={{ textAlign: 'right' }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem' }}>期間</Typography>
                                        <Typography variant="caption" sx={{ fontWeight: 500 }}>
                                            {project.start_date ? format(new Date(project.start_date), 'MM/dd') : '-'}
                                            ～
                                            {project.end_date ? format(new Date(project.end_date), 'MM/dd') : '-'}
                                        </Typography>
                                    </Box>
                                </Box>
                            </CardContent>
                        </Card>
                    ))}
                    {filteredProjects.length === 0 && (
                        <Box sx={{ textAlign: 'center', py: 5 }}>
                            <Typography color="text.secondary">プロジェクトがありません</Typography>
                        </Box>
                    )}
                </Stack>
            )}

            <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth fullScreen={isMobile}>
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