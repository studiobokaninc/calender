import React, { useState, useEffect, useMemo } from 'react';
import { Box, Typography, CircularProgress, Paper, TableContainer, Table, TableHead, TableBody, TableRow, TableCell, LinearProgress, Chip, Select, MenuItem, FormControl, Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, Snackbar, Alert, InputLabel, Link, SelectChangeEvent } from '@mui/material';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import api from '../services/api';
import { Project, Task } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { format, parseISO, isValid } from 'date-fns';
import { DataGrid, GridColDef, GridRenderCellParams, GridRowParams } from '@mui/x-data-grid';
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
    { value: 'archived', label: 'アーカイブ' },
];

const ProjectsPage: React.FC = () => {
    const [projects, setProjects] = useState<ProjectWithProgress[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [projectStatusFilter, setProjectStatusFilter] = useState<string>('');
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
    const [snackbar, setSnackbar] = useState<{open: boolean, message: string, severity: 'success' | 'error'}>({
        open: false,
        message: '',
        severity: 'success'
    });
    const { user } = useAuth();
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
            setTasks(tasksData);

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

    const uniqueProjectStatuses = useMemo(() =>
        [...new Set(projects.map(p => p.status).filter(Boolean))] as string[]
    , [projects]);

    const filteredProjects: ProjectWithProgress[] = useMemo(() => {
        return projects.filter(project => {
            const statusMatch = projectStatusFilter === '' || project.status === projectStatusFilter;
            return statusMatch;
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

    const handleDeleteProject = async (projectId: string | number, projectName: string) => {
        try {
            await api.delete(`/projects/${projectId}`);
            setSnackbar({
                open: true,
                message: 'プロジェクトが削除されました',
                severity: 'success'
            });
            await fetchData();
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
        setSnackbar({...snackbar, open: false});
    };

    const handleDeleteClick = (project: ProjectWithProgress) => {
        setSelectedProject(project);
        setDeleteDialogOpen(true);
    };

    const handleDeleteConfirm = async () => {
        if (selectedProject) {
            await handleDeleteProject(selectedProject.id, selectedProject.name);
            setDeleteDialogOpen(false);
            setSelectedProject(null);
        }
    };

    // DataGrid用のカラム定義
    const columns: GridColDef[] = [
        { field: 'id', headerName: 'ID', width: 80 },
        { field: 'name', headerName: 'プロジェクト名', width: 180, flex: 1 },
        { field: 'description', headerName: '説明', width: 200, flex: 1 },
        { field: 'status', headerName: '進捗', width: 120, renderCell: (params) => (
            <Chip label={params.value as string} style={{ background: getProjectStatusColor(params.value as string), color: '#fff' }} />
        )},
        { field: 'priority', headerName: '優先度', width: 120, renderCell: (params) => (
            <Chip label={params.value || '未設定'} style={{ background: getPriorityColor(params.value as string), color: '#fff' }} />
        )},
        { field: 'start_date', headerName: '開始日', width: 120, renderCell: (params: GridRenderCellParams<any, ProjectWithProgress>) => {
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
        } },
        { field: 'end_date', headerName: '終了日', width: 120, renderCell: (params: GridRenderCellParams<any, ProjectWithProgress>) => {
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
        } },
        { field: 'progress', headerName: '進捗率(%)', width: 140, renderCell: (params: GridRenderCellParams<any, ProjectWithProgress>) => {
            const value = Number(params.value) || 0;
            return (
                <Box sx={{ position: 'relative', width: '100%', height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <LinearProgress variant="determinate" value={value} sx={{ height: 20, borderRadius: 4, width: '100%' }} />
                    <Typography variant="body2" sx={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: value > 50 ? '#fff' : '#333', fontSize: '0.8rem' }}>
                        {value}%
                    </Typography>
                </Box>
            );
        } },
        {
            field: 'display_status',
            headerName: '表示ステータス',
            width: 140,
            renderCell: (params: GridRenderCellParams<any, ProjectWithProgress>) => {
                const row = params.row;
                return (
                    <Select
                        size="small"
                        value={typeof params.value === 'string' ? params.value : 'online'}
                        onChange={async (e: SelectChangeEvent) => {
                            const newStatus = e.target.value as string;
                            try {
                                await api.put(`/projects/${row.id}`, { display_status: newStatus });
                                setProjects((prev) => prev.map(p => p.id === row.id ? { ...p, display_status: newStatus } : p));
                                setSnackbar({ open: true, message: '表示ステータスを更新しました', severity: 'success' });
                            } catch (err) {
                                setSnackbar({ open: true, message: '表示ステータスの更新に失敗しました', severity: 'error' });
                            }
                        }}
                        sx={{ minWidth: 100, fontSize: '0.75rem' }}
                        MenuProps={{
                            PaperProps: {
                                sx: { fontSize: '0.75rem' }
                            }
                        }}
                    >
                        {displayStatusOptions.map(opt => (
                            <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: '0.75rem' }}>{opt.label}</MenuItem>
                        ))}
                    </Select>
                );
            },
        },
        {
            field: 'actions',
            headerName: '操作',
            width: 120,
            sortable: false,
            filterable: false,
            renderCell: (params: GridRenderCellParams<any, ProjectWithProgress>) => {
                const row = params.row;
                return (
                    <>
                        <IconButton size="small" onClick={() => handleEditProject(row)}><EditIcon /></IconButton>
                        <IconButton size="small" onClick={() => handleDeleteClick(row)}><DeleteIcon /></IconButton>
                    </>
                );
            },
        },
    ];

    if (loading && projects.length === 0) {
        return <CircularProgress />;
    }

    if (error) {
        return <Typography color="error">{error}</Typography>;
    }

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h4" component="h1">
                    プロジェクト管理
                </Typography>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={handleAddProject}
                >
                    新規プロジェクト
                </Button>
            </Box>

            <Box sx={{ mb: 3 }}>
                <CsvParser onImportComplete={fetchData} />
            </Box>

            <Paper>
                <Box sx={{ height: 600, width: '100%', mb: 2 }}>
                    <DataGrid<ProjectWithProgress>
                        rows={filteredProjects}
                        columns={columns}
                        initialState={{
                            pagination: { paginationModel: { pageSize: 10, page: 0 } },
                        }}
                        pageSizeOptions={[10, 20, 50]}
                        checkboxSelection={false}
                        disableRowSelectionOnClick
                        autoHeight
                        getRowId={(row) => row.id}
                        rowHeight={40}
                        sx={{
                            '& .MuiDataGrid-columnHeaders': { background: '#f5f5f5' },
                            '& .MuiDataGrid-cell': { alignItems: 'center' },
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