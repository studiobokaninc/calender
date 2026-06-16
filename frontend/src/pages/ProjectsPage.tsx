import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, CircularProgress, Paper, LinearProgress, Chip, Select, MenuItem, FormControl, Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Stack, Snackbar, Alert, InputLabel, SelectChangeEvent, Tooltip, useTheme, Card, CardContent, useMediaQuery, Breadcrumbs, Link, Grid, Divider } from '@mui/material';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon, Folder as FolderIcon, FormatListBulleted as ShotListIcon, Person as PersonIcon, CalendarToday as CalendarIcon, Movie as MovieIcon, Replay as ReplayIcon, Warning as WarningIcon } from '@mui/icons-material';
import api, { fetchUsers, fetchProjectRoles, createScoreUserRole, updateScoreUserRole, deleteScoreUserRole } from '../services/api';
import { Project, Task, User } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { usePageState } from '../contexts/PageStateContext';
import { format, parseISO, isValid } from 'date-fns';
import ProjectDeleteDialog from '../components/ProjectDeleteDialog';
import CsvParser from '../components/CsvParser';

// Helper function to determine sort priority by display status (online first)
const displayStatusOrder = (s: string): number => {
    if (s === 'online') return 0;
    if (s === 'offline') return 1;
    return 2;
};

// Helper function to determine sort priority by status (delayed first, completed last)
const statusOrder = (s: string): number => {
    switch (s) {
        case 'delayed': return 0;
        case 'in-progress': return 1;
        case 'planning': return 2;
        case 'on-hold': return 3;
        case 'cancelled': return 4;
        case 'completed': return 5;
        default: return 6;
    }
};

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
    directorName?: string;
    pmName?: string;
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
    const [snackbar, setSnackbar] = useState<{ open: boolean, message: string, severity: 'success' | 'error' | 'warning' }>({
        open: false,
        message: '',
        severity: 'success'
    });
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const { refreshGlobalData } = usePageState();
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [selectedProject, setSelectedProject] = useState<ProjectWithProgress | null>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [directorId, setDirectorId] = useState<number | ''>('');
    const [pmId, setPmId] = useState<number | ''>('');

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [projectsResponse, tasksResponse, summaryResponse, usersData, rolesData] = await Promise.all([
                api.get<Project[]>('/projects'),
                api.get<Task[]>('/tasks'),
                api.get<Record<string, { shots: number, retakes: number, troubles: number }>>('/api/projects/summary').catch(() => ({ data: {} })),
                fetchUsers().catch(() => [] as User[]),
                api.get<{ id: number; user_id: number; project_id: number; role: string }[]>('/api/score_user_roles').catch(() => ({ data: [] })),
            ]);

            const projectsData = projectsResponse.data;
            const tasksData = tasksResponse.data;
            const scoreSummary = (summaryResponse as any).data || {};
            const allUsers: User[] = usersData as User[];
            const allRoles: { id: number; user_id: number; project_id: number; role: string }[] = (rolesData as any).data || [];

            const userNameById = allUsers.reduce((acc, u) => {
                acc[u.id] = u.full_name || u.username || (u as any).name || u.email || String(u.id);
                return acc;
            }, {} as Record<number, string>);

            const rolesByProject = allRoles.reduce((acc, r) => {
                if (!acc[r.project_id]) acc[r.project_id] = {};
                acc[r.project_id][r.role] = r.user_id;
                return acc;
            }, {} as Record<number, Record<string, number>>);

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
                const projRoles = rolesByProject[project.id as number] || {};

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
                    directorName: projRoles['director'] ? userNameById[projRoles['director']] : undefined,
                    pmName: projRoles['pm'] ? userNameById[projRoles['pm']] : undefined,
                };
            });

            setProjects(projectsWithProgress);

        } catch (err) {
            console.error("Failed to fetch projects or tasks:", err);
            setError('プロジェクトまたはタスクの取得に失敗しました。');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        fetchUsers().then(setUsers).catch(() => { });
    }, []);

    useEffect(() => {
        if (!openDialog) return;
        if (isEditMode && currentProject.id !== null) {
            fetchProjectRoles(currentProject.id as number).then((roles: any[]) => {
                const director = roles.find((r: any) => r.role === 'director');
                const pm = roles.find((r: any) => r.role === 'pm');
                setDirectorId(director ? director.user_id : '');
                setPmId(pm ? pm.user_id : '');
            }).catch(() => { });
        } else {
            setDirectorId('');
            setPmId('');
        }
    }, [openDialog, isEditMode, currentProject.id]);

    const filteredProjects: ProjectWithProgress[] = useMemo(() => {
        const filtered = projects.filter(project => {
            const statusMatch = projectStatusFilter === '' || project.status === projectStatusFilter;
            return statusMatch;
        });
        // オンライン優先、進捗ステータス順。同一ステータス内は created_at 降順・id 降順
        return [...filtered].sort((a, b) => {
            const aDisp = a.display_status || 'online';
            const bDisp = b.display_status || 'online';
            const dispDiff = displayStatusOrder(aDisp) - displayStatusOrder(bDisp);
            if (dispDiff !== 0) return dispDiff;

            const sd = statusOrder(a.status || '') - statusOrder(b.status || '');
            if (sd !== 0) return sd;

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
        if (directorId === '' || pmId === '') {
            setSnackbar({ open: true, message: 'DirectorとPMは必須です', severity: 'error' });
            return;
        }
        if (directorId === pmId) {
            setSnackbar({ open: true, message: 'DirectorとPMには異なるユーザーを指定してください', severity: 'error' });
            return;
        }
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

            const saveRoles = async (projectId: number) => {
                const roles = await fetchProjectRoles(projectId);
                const toDelete = roles.filter((r: any) => r.role === 'director' || r.role === 'pm');
                const toKeep = roles.filter((r: any) => r.role !== 'director' && r.role !== 'pm');
                for (const r of toDelete) {
                    await deleteScoreUserRole(r.id);
                }
                // upsert: 他ロールが残存している場合はPATCH、なければPOST
                const upsertRole = async (userId: number, role: string) => {
                    const existing = toKeep.find((r: any) => r.user_id === userId);
                    if (existing) {
                        await updateScoreUserRole(existing.id, { role });
                    } else {
                        await createScoreUserRole({ user_id: userId, project_id: projectId, role });
                    }
                };
                if (directorId) await upsertRole(directorId as number, 'director');
                if (pmId) await upsertRole(pmId as number, 'pm');
            };

            if (isEditMode && currentProject.id !== null) {
                await api.put(`/projects/${currentProject.id}`, projectData);
                try {
                    await saveRoles(currentProject.id as number);
                } catch (roleErr) {
                    console.error('Director/PMロール保存失敗:', roleErr);
                    setSnackbar({ open: true, message: 'プロジェクトは更新されましたがDirector/PMロールの設定に失敗しました', severity: 'warning' });
                    setOpenDialog(false);
                    await fetchData();
                    return;
                }
                setSnackbar({
                    open: true,
                    message: 'プロジェクトが更新されました',
                    severity: 'success'
                });
            } else {
                const response = await api.post('/projects', projectData);
                const newProjectId = response.data.id;
                try {
                    await saveRoles(newProjectId);
                } catch (roleErr) {
                    console.error('Director/PMロール保存失敗:', roleErr);
                    setSnackbar({ open: true, message: 'プロジェクトは作成されましたがDirector/PMロールの設定に失敗しました', severity: 'warning' });
                    setOpenDialog(false);
                    await fetchData();
                    return;
                }
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

            {/* テーブルのように縦にスタックされたカードリスト */}
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', pr: 0.5 }}>
                <Grid container spacing={2}>
                    {filteredProjects.map((project) => {
                        const dispStatus = typeof project.display_status === 'string' ? project.display_status : 'online';
                        const dispLabel = displayStatusOptions.find(opt => opt.value === dispStatus)?.label ?? dispStatus;
                        const dispColor = getDisplayStatusColor(dispStatus);
                        return (
                            <Grid item xs={12} key={project.id}>
                                <Card
                                    elevation={0}
                                    sx={{
                                        borderRadius: 3,
                                        border: '1px solid',
                                        borderColor: 'divider',
                                        borderLeft: `5px solid ${project.color || theme.palette.divider}`,
                                        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                                        '&:hover': {
                                            transform: 'translateY(-2px)',
                                            boxShadow: 2
                                        },
                                        cursor: isAdmin ? 'pointer' : 'default',
                                    }}
                                    onClick={isAdmin ? () => handleEditProject(project) : undefined}
                                >
                                    <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                                        <Grid container spacing={2} alignItems="center">
                                            {/* 左エリア: 名前、ステータス、説明 */}
                                            <Grid item xs={12} md={5}>
                                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                        <Typography variant="h6" sx={{ fontWeight: 800, fontSize: '1.25rem', mr: 1, wordBreak: 'break-word' }}>
                                                            {project.name}
                                                        </Typography>
                                                        {isAdmin && (
                                                            <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                                                                <Tooltip title="編集">
                                                                    <IconButton size="small" onClick={() => handleEditProject(project)} sx={{ color: 'primary.main', p: 0.5 }}>
                                                                        <EditIcon fontSize="small" />
                                                                    </IconButton>
                                                                </Tooltip>
                                                                <Tooltip title="削除">
                                                                    <IconButton size="small" onClick={() => handleDeleteClick(project)} sx={{ color: 'error.main', p: 0.5 }}>
                                                                        <DeleteIcon fontSize="small" />
                                                                    </IconButton>
                                                                </Tooltip>
                                                            </Box>
                                                        )}
                                                    </Box>

                                                    {/* ステータスバッジ群 */}
                                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
                                                        <Chip label={project.status || '-'} size="small" sx={{ backgroundColor: getProjectStatusColor(project.status ?? undefined), color: '#fff', fontSize: '0.8rem', height: 26, fontWeight: 700 }} />
                                                        <Chip label={project.priority || '未設定'} size="small" variant="outlined" sx={{ fontSize: '0.8rem', height: 26, borderColor: getPriorityColor(project.priority ?? undefined), color: getPriorityColor(project.priority ?? undefined), fontWeight: 700 }} />
                                                        {isAdmin ? (
                                                            <Select
                                                                size="small"
                                                                value={dispStatus}
                                                                onClick={(e) => e.stopPropagation()}
                                                                onChange={async (e: SelectChangeEvent) => {
                                                                    const newStatus = e.target.value as string;
                                                                    try {
                                                                        await api.put(`/projects/${project.id}`, { display_status: newStatus });
                                                                        setProjects((prev) => prev.map(p => p.id === project.id ? { ...p, display_status: newStatus } : p));
                                                                        setSnackbar({ open: true, message: '表示ステータスを更新しました', severity: 'success' });
                                                                        if (refreshGlobalData) {
                                                                            await refreshGlobalData();
                                                                            window.dispatchEvent(new CustomEvent('projectStatusUpdated', { detail: { projectId: project.id, newStatus } }));
                                                                        }
                                                                    } catch {
                                                                        setSnackbar({ open: true, message: '表示ステータスの更新に失敗しました', severity: 'error' });
                                                                    }
                                                                }}
                                                                sx={{ height: 26, fontSize: '0.8rem', fontWeight: 700, backgroundColor: dispColor, color: '#fff', '& .MuiSelect-select': { color: '#fff', py: 0, px: 1 }, '& .MuiOutlinedInput-notchedOutline': { borderColor: dispColor }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: dispColor }, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: dispColor } }}
                                                            >
                                                                {displayStatusOptions.map(opt => (
                                                                    <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: '0.8rem' }}>{opt.label}</MenuItem>
                                                                ))}
                                                            </Select>
                                                        ) : (
                                                            <Chip label={dispLabel} size="small" sx={{ backgroundColor: dispColor, color: '#fff', fontSize: '0.8rem', height: 26, fontWeight: 700 }} />
                                                        )}
                                                    </Box>

                                                    {/* 説明 */}
                                                    {project.description && (
                                                        <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.9rem', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
                                                            {project.description}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            </Grid>

                                            {/* 中央エリア: 担当者、期間 */}
                                            <Grid item xs={12} md={3}>
                                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, borderLeft: { md: '1px solid' }, borderRight: { md: '1px solid' }, borderColor: { md: 'divider' }, pl: { md: 3 }, pr: { md: 2 } }}>
                                                    {/* Director / PM */}
                                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                                            <PersonIcon sx={{ color: 'text.secondary', fontSize: '1.1rem' }} />
                                                            <Box>
                                                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', fontWeight: 600, lineHeight: 1.1 }}>Director</Typography>
                                                                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.9rem', color: 'text.primary' }}>{project.directorName || '-'}</Typography>
                                                            </Box>
                                                        </Box>
                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                                            <PersonIcon sx={{ color: 'text.secondary', fontSize: '1.1rem' }} />
                                                            <Box>
                                                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', fontWeight: 600, lineHeight: 1.1 }}>PM</Typography>
                                                                <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.9rem', color: 'text.primary' }}>{project.pmName || '-'}</Typography>
                                                            </Box>
                                                        </Box>
                                                    </Box>

                                                    {/* 期間 */}
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                                        <CalendarIcon sx={{ color: 'text.secondary', fontSize: '1.1rem' }} />
                                                        <Box>
                                                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', fontWeight: 600, lineHeight: 1.1 }}>期間</Typography>
                                                            <Typography variant="body2" sx={{ fontSize: '0.9rem', fontWeight: 700, color: 'text.primary' }}>
                                                                {project.start_date ? new Date(project.start_date).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '-'}
                                                                ～
                                                                {project.end_date ? new Date(project.end_date).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '-'}
                                                            </Typography>
                                                        </Box>
                                                    </Box>
                                                </Box>
                                            </Grid>

                                            {/* 右エリア: 進捗、数値、ボタン */}
                                            <Grid item xs={12} md={4}>
                                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pl: { md: 2 } }}>
                                                    {/* Shots / Retakes / Troubles (ミニダッシュボード) と進捗率を横並びに */}
                                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                                                        {/* 統計ボックス */}
                                                        <Box sx={{ display: 'flex', gap: 0.75, flex: 1 }}>
                                                            <Box sx={{ px: 1, py: 0.5, borderRadius: 1.5, bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', border: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                                                                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', fontSize: '0.65rem' }}>Shots</Typography>
                                                                <Typography variant="body2" sx={{ fontWeight: 800, fontSize: '1rem' }}>{project.shots || 0}</Typography>
                                                            </Box>
                                                            <Box sx={{ px: 1, py: 0.5, borderRadius: 1.5, bgcolor: (project.retakes || 0) > 0 ? (isDark ? 'rgba(255, 152, 0, 0.15)' : 'rgba(255, 152, 0, 0.05)') : (isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'), border: '1px solid', borderColor: (project.retakes || 0) > 0 ? 'warning.main' : 'divider', display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                                                                <Typography variant="caption" sx={{ fontWeight: 700, color: (project.retakes || 0) > 0 ? 'warning.main' : 'text.secondary', fontSize: '0.65rem' }}>Retakes</Typography>
                                                                <Typography variant="body2" sx={{ fontWeight: 800, fontSize: '1rem', color: (project.retakes || 0) > 0 ? 'warning.main' : 'inherit' }}>{project.retakes || 0}</Typography>
                                                            </Box>
                                                            <Box sx={{ px: 1, py: 0.5, borderRadius: 1.5, bgcolor: (project.troubles || 0) > 0 ? (isDark ? 'rgba(244, 67, 54, 0.15)' : 'rgba(244, 67, 54, 0.05)') : (isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'), border: '1px solid', borderColor: (project.troubles || 0) > 0 ? 'error.main' : 'divider', display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                                                                <Typography variant="caption" sx={{ fontWeight: 700, color: (project.troubles || 0) > 0 ? 'error.main' : 'text.secondary', fontSize: '0.65rem' }}>Troubles</Typography>
                                                                <Typography variant="body2" sx={{ fontWeight: 800, fontSize: '1rem', color: (project.troubles || 0) > 0 ? 'error.main' : 'inherit' }}>{project.troubles || 0}</Typography>
                                                            </Box>
                                                        </Box>

                                                        {/* 進捗率テキスト */}
                                                        <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                                                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', display: 'block', fontWeight: 600 }}>進捗率</Typography>
                                                            <Typography variant="body2" sx={{ fontWeight: 800, fontSize: '1.1rem', color: theme.palette.primary.main }}>{project.progress}%</Typography>
                                                        </Box>
                                                    </Box>

                                                    {/* 進捗バーとショットリストボタンを横に並べる */}
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                                        <Box sx={{ flex: 1 }}>
                                                            <LinearProgress
                                                                variant="determinate"
                                                                value={project.progress}
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
                                                        </Box>
                                                        <Button
                                                            size="small"
                                                            variant="outlined"
                                                            startIcon={<ShotListIcon sx={{ fontSize: '0.9rem' }} />}
                                                            onClick={(e) => { e.stopPropagation(); navigate(`/projects/${project.id}/shotlist`); }}
                                                            sx={{
                                                                textTransform: 'none',
                                                                fontSize: '0.8rem',
                                                                fontWeight: 600,
                                                                borderRadius: 2,
                                                                py: 0.5,
                                                                px: 1.5,
                                                                whiteSpace: 'nowrap',
                                                                flexShrink: 0
                                                            }}
                                                        >
                                                            ショットリスト
                                                        </Button>
                                                    </Box>
                                                </Box>
                                            </Grid>
                                        </Grid>
                                    </CardContent>
                                </Card>
                            </Grid>
                        );
                    })}
                    {filteredProjects.length === 0 && (
                        <Grid item xs={12}>
                            <Box sx={{ textAlign: 'center', py: 5 }}>
                                <Typography color="text.secondary">プロジェクトがありません</Typography>
                            </Box>
                        </Grid>
                    )}
                </Grid>
            </Box>

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
                        <FormControl fullWidth required>
                            <InputLabel>Director *</InputLabel>
                            <Select
                                value={directorId}
                                label="Director *"
                                onChange={(e) => setDirectorId(e.target.value as number)}
                            >
                                {users.map(u => (
                                    <MenuItem key={u.id} value={u.id}>
                                        {u.full_name || u.username || u.name || u.email}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl fullWidth required>
                            <InputLabel>PM *</InputLabel>
                            <Select
                                value={pmId}
                                label="PM *"
                                onChange={(e) => setPmId(e.target.value as number)}
                            >
                                {users.map(u => (
                                    <MenuItem key={u.id} value={u.id}>
                                        {u.full_name || u.username || u.name || u.email}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
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
                    <Button
                        onClick={handleSubmit}
                        variant="contained"
                        color="primary"
                        disabled={directorId === '' || pmId === ''}
                    >
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
                    projectName={selectedProject.name}
                    onClose={() => setDeleteDialogOpen(false)}
                    onDelete={handleDeleteConfirm}
                />
            )}
        </Box>
    );
};

export default ProjectsPage; 