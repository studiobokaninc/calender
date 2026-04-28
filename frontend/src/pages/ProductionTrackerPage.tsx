import React, { useState, useEffect, useMemo } from 'react';
import {
    Box,
    Typography,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    CircularProgress,
    Tooltip,
    IconButton,
    Breadcrumbs,
    Link,
    useTheme,
    alpha,
    Stack,
    Drawer,
    LinearProgress
} from '@mui/material';
import {
    Refresh as RefreshIcon,
    Error as ErrorIcon,
    ViewModule as ViewModuleIcon,
    Close as CloseIcon,
} from '@mui/icons-material';
import api, { mockDataApi, fetchProjects, fetchUsers } from '../services/api';
import { Project, Task, User } from '../types';
import { TaskQuickDetail } from '../components/TaskQuickDetail';
import { TaskEditDialog } from '../components/SearchEditDialogs';

interface TaskInfo {
    id: number;
    status: string;
    name: string;
    assignee: string | null;
    due_date: string | null;
}

interface ShotData {
    shotID: string;
    tasks: { [type: string]: TaskInfo[] };
}

interface SequenceData {
    seqID: string;
    shots: ShotData[];
}

const ProductionTrackerPage: React.FC = () => {
    const theme = useTheme();
    const [projects, setProjects] = useState<Project[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<number | ''>('');
    const [trackerData, setTrackerData] = useState<{ sequences: SequenceData[]; types: string[] } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // タスク詳細用State
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [isTaskLoading, setIsTaskLoading] = useState(false);
    const [editTaskId, setEditTaskId] = useState<number | null>(null);

    const stats = useMemo(() => {
        if (!trackerData) return null;
        let totalTasks = 0;
        let completedTasks = 0;
        let delayedTasks = 0;

        const seqStats: Record<string, { total: number, completed: number, delayed: number }> = {};
        const shotStats: Record<string, { total: number, completed: number, delayed: number }> = {};

        trackerData.sequences.forEach(seq => {
            seqStats[seq.seqID] = { total: 0, completed: 0, delayed: 0 };
            seq.shots.forEach(shot => {
                const shotKey = `${seq.seqID}-${shot.shotID}`;
                shotStats[shotKey] = { total: 0, completed: 0, delayed: 0 };
                Object.values(shot.tasks).forEach(tasks => {
                    tasks.forEach(t => {
                        totalTasks++;
                        seqStats[seq.seqID].total++;
                        shotStats[shotKey].total++;
                        if (t.status === 'completed') {
                            completedTasks++;
                            seqStats[seq.seqID].completed++;
                            shotStats[shotKey].completed++;
                        }
                        if (t.status === 'delayed') {
                            delayedTasks++;
                            seqStats[seq.seqID].delayed++;
                            shotStats[shotKey].delayed++;
                        }
                    });
                });
            });
        });

        return { totalTasks, completedTasks, delayedTasks, seqStats, shotStats };
    }, [trackerData]);

    useEffect(() => {
        const loadInitialData = async () => {
            try {
                // プロジェクトとユーザーを同時に取得
                const [projectsData, usersData] = await Promise.all([
                    fetchProjects(),
                    fetchUsers()
                ]);

                const onlineProjects = projectsData.filter((p: Project) => (p.display_status ?? 'online') === 'online');
                setProjects(onlineProjects);
                setUsers(usersData);

                if (onlineProjects.length > 0) {
                    setSelectedProjectId(onlineProjects[0].id);
                }
            } catch (err) {
                console.error('Failed to fetch initial data', err);
                setError('データの取得に失敗しました');
            }
        };
        loadInitialData();
    }, []);

    useEffect(() => {
        if (selectedProjectId !== '') {
            loadTrackerData(selectedProjectId as number);
        }
    }, [selectedProjectId]);

    const loadTrackerData = async (projectId: number) => {
        setLoading(true);
        setError(null);
        try {
            const data = await mockDataApi.getProductionTracker(projectId);
            setTrackerData(data);
        } catch (err: any) {
            console.error('Failed to fetch tracker data', err);
            setError('進捗データの取得に失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'todo': return '#2196F3';
            case 'in-progress': return '#FF9800';
            case 'review': return '#9C27B0';
            case 'delayed': return '#F44336';
            case 'completed': return '#9E9E9E';
            default: return '#BDBDBD';
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'todo': return 'TODO';
            case 'in-progress': return 'WIP';
            case 'review': return 'REVI';
            case 'delayed': return 'DELAY';
            case 'completed': return 'DONE';
            default: return status.toUpperCase().slice(0, 4);
        }
    };

    const handleTaskClick = async (taskId: number) => {
        setIsTaskLoading(true);
        try {
            // フルタスク情報を取得
            const response = await api.get<Task>(`/tasks/${taskId}`);
            setSelectedTask(response.data);
            setIsDrawerOpen(true);
        } catch (err) {
            console.error('Failed to fetch task details', err);
        } finally {
            setIsTaskLoading(false);
        }
    };

    const handleUpdateTaskQuick = async (taskId: number, updates: Partial<Task>) => {
        try {
            await api.put(`/tasks/${taskId}`, updates);
            // 選択中のタスクを更新
            if (selectedTask && selectedTask.id === taskId) {
                setSelectedTask({ ...selectedTask, ...updates });
            }
            // トラッカーデータを再読込して反映（効率は落ちるが確実）
            if (selectedProjectId !== '') {
                const data = await mockDataApi.getProductionTracker(selectedProjectId as number);
                setTrackerData(data);
            }
        } catch (err) {
            console.error('Failed to update task:', err);
        }
    };

    const handleEditTaskFull = (task: Task) => {
        setEditTaskId(task.id);
        setIsDrawerOpen(false);
    };

    const handleTaskDialogSaved = () => {
        setEditTaskId(null);
        if (selectedProjectId !== '') {
            loadTrackerData(selectedProjectId as number);
        }
    };

    const renderTaskCell = (tasks: TaskInfo[] | undefined) => {
        if (!tasks || tasks.length === 0) return <Box sx={{ opacity: 0.1, py: 1 }}>-</Box>;

        return (
            <Stack spacing={0.5} sx={{ py: 0.5 }}>
                {tasks.map((task) => {
                    const color = getStatusColor(task.status);
                    const label = getStatusLabel(task.status);

                    return (
                        <Tooltip key={task.id} title={`${task.name}${task.assignee ? ` (担当: ${task.assignee})` : ''}${task.due_date ? ` [〆: ${task.due_date}]` : ''}`} arrow>
                            <Box
                                sx={{
                                    p: 1,
                                    borderRadius: 1.5,
                                    border: `1px solid ${alpha(color, 0.3)}`,
                                    borderLeft: `5px solid ${color}`,
                                    backgroundColor: alpha(color, 0.05),
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 0.5,
                                    minWidth: 180,
                                    transition: 'all 0.15s',
                                    cursor: 'pointer',
                                    '&:hover': {
                                        backgroundColor: alpha(color, 0.1),
                                        transform: 'scale(1.02)',
                                        zIndex: 1,
                                        boxShadow: 2,
                                    }
                                }}
                                onClick={() => handleTaskClick(task.id)}
                            >
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, color: color, letterSpacing: 0.5 }}>
                                        {label}
                                    </Typography>
                                    {task.assignee && (
                                        <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: 'text.secondary', opacity: 0.8 }}>
                                            {task.assignee}
                                        </Typography>
                                    )}
                                </Box>
                                <Typography variant="caption" noWrap sx={{ fontWeight: 700, fontSize: '0.95rem' }}>
                                    {task.name}
                                </Typography>
                            </Box>
                        </Tooltip>
                    );
                })}
            </Stack>
        );
    };

    return (
        <Box sx={{ p: 4, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                    <Breadcrumbs sx={{ mb: 1 }}>
                        <Link color="inherit" href="/dashboard" sx={{ cursor: 'pointer' }}>Dashboard</Link>
                        <Typography color="text.primary">Production Tracker</Typography>
                    </Breadcrumbs>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <ViewModuleIcon sx={{ fontSize: '2rem', color: '#2196F3' }} />
                        <Typography variant="h4" sx={{ fontWeight: 800, background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                            Production Tracker
                        </Typography>
                    </Box>
                    <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 500 }}>
                        ショット・シーケンス進捗管理
                    </Typography>
                </Box>

                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <FormControl variant="outlined" size="medium" sx={{ minWidth: 300 }}>
                        <InputLabel>プロジェクト選択</InputLabel>
                        <Select
                            value={selectedProjectId}
                            onChange={(e) => setSelectedProjectId(e.target.value as number)}
                            label="プロジェクト選択"
                            sx={{ borderRadius: 2, bgcolor: alpha(theme.palette.background.paper, 0.8) }}
                        >
                            {projects.map((p) => (
                                <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <IconButton onClick={() => selectedProjectId && loadTrackerData(selectedProjectId as number)} color="primary">
                        <RefreshIcon />
                    </IconButton>
                </Box>
            </Box>

            {stats && (
                <Box sx={{ mb: 3, display: 'flex', gap: 2 }}>
                    <Paper sx={{ p: 2.5, flex: 1, borderRadius: 3, display: 'flex', flexDirection: 'column', bgcolor: alpha(theme.palette.background.paper, 0.8), boxShadow: 2 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 700 }}>プロジェクト全体進捗</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mt: 1.5 }}>
                            <Box sx={{ flexGrow: 1 }}>
                                <LinearProgress
                                    variant="determinate"
                                    value={stats.totalTasks > 0 ? (stats.completedTasks / stats.totalTasks) * 100 : 0}
                                    sx={{ height: 12, borderRadius: 6, bgcolor: alpha(theme.palette.primary.main, 0.1) }}
                                />
                            </Box>
                            <Typography variant="h5" sx={{ fontWeight: 900, color: theme.palette.primary.main }}>
                                {stats.totalTasks > 0 ? Math.round((stats.completedTasks / stats.totalTasks) * 100) : 0}%
                            </Typography>
                        </Box>
                    </Paper>
                    <Paper sx={{ p: 2.5, minWidth: 160, borderRadius: 3, display: 'flex', flexDirection: 'column', bgcolor: alpha(theme.palette.background.paper, 0.8), boxShadow: 2 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 700 }}>完了タスク</Typography>
                        <Typography variant="h5" sx={{ fontWeight: 900, mt: 1 }}>
                            {stats.completedTasks} <Typography component="span" variant="body1" color="text.secondary">/ {stats.totalTasks}</Typography>
                        </Typography>
                    </Paper>
                    <Paper sx={{ p: 2.5, minWidth: 160, borderRadius: 3, display: 'flex', flexDirection: 'column', bgcolor: alpha(theme.palette.error.main, 0.05), border: `1px solid ${alpha(theme.palette.error.main, 0.2)}`, boxShadow: 2 }}>
                        <Typography variant="subtitle2" color="error" sx={{ fontWeight: 700 }}>遅延タスク</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                            <ErrorIcon color="error" />
                            <Typography variant="h5" sx={{ fontWeight: 900, color: theme.palette.error.main }}>
                                {stats.delayedTasks}
                            </Typography>
                        </Box>
                    </Paper>
                </Box>
            )}

            <TableContainer
                component={Paper}
                sx={{
                    flexGrow: 1,
                    borderRadius: 3,
                    boxShadow: 3,
                    bgcolor: alpha(theme.palette.background.paper, 0.8),
                    position: 'relative',
                    overflow: 'auto',
                }}
            >
                {loading && (
                    <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10, bgcolor: alpha(theme.palette.background.paper, 0.3) }}>
                        <CircularProgress />
                    </Box>
                )}

                {error && (
                    <Box sx={{ p: 5, textAlign: 'center' }}>
                        <ErrorIcon color="error" sx={{ fontSize: 48, mb: 2 }} />
                        <Typography variant="h6" gutterBottom>{error}</Typography>
                    </Box>
                )}

                {!loading && !error && trackerData && (
                    <Table stickyHeader size="medium" sx={{ minWidth: 1500 }}>
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ fontWeight: 900, fontSize: '1rem', width: 140, bgcolor: alpha(theme.palette.background.paper, 0.95), zIndex: 12 }}>SEQ</TableCell>
                                <TableCell sx={{ fontWeight: 900, fontSize: '1rem', width: 140, bgcolor: alpha(theme.palette.background.paper, 0.95), zIndex: 12 }}>SHOT</TableCell>
                                {(trackerData?.types ?? []).map((t) => (
                                    <TableCell key={t} sx={{
                                        fontWeight: 900,
                                        textTransform: 'uppercase',
                                        fontSize: '0.95rem',
                                        letterSpacing: 1,
                                        bgcolor: alpha(theme.palette.background.paper, 0.95),
                                        textAlign: 'center'
                                    }}>
                                        {t}
                                    </TableCell>
                                ))}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {trackerData.sequences.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={trackerData.types.length + 2} align="center" sx={{ py: 10 }}>
                                        <Typography color="text.secondary">データが見つかりませんでした。</Typography>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                trackerData.sequences.map((seq) => (
                                    <React.Fragment key={seq.seqID}>
                                        {seq.shots.map((shot, shotIdx) => (
                                            <TableRow key={`${seq.seqID}-${shot.shotID}`} hover>
                                                {shotIdx === 0 && (
                                                    <TableCell
                                                        rowSpan={seq.shots.length}
                                                        sx={{
                                                            fontWeight: 900,
                                                            color: theme.palette.primary.main,
                                                            bgcolor: alpha(theme.palette.primary.main, 0.05),
                                                            borderRight: `1px solid ${theme.palette.divider}`,
                                                            fontSize: '1.2rem',
                                                            textAlign: 'center',
                                                            verticalAlign: 'top',
                                                            pt: 3
                                                        }}
                                                    >
                                                        {seq.seqID}
                                                        {stats && stats.seqStats[seq.seqID].total > 0 && (
                                                            <Box sx={{ mt: 2, px: 2, textAlign: 'center' }}>
                                                                <LinearProgress
                                                                    variant="determinate"
                                                                    value={(stats.seqStats[seq.seqID].completed / stats.seqStats[seq.seqID].total) * 100}
                                                                    sx={{ height: 8, borderRadius: 4 }}
                                                                />
                                                                <Typography variant="caption" sx={{ mt: 1, display: 'block', fontWeight: 800, opacity: 0.8 }}>
                                                                    {Math.round((stats.seqStats[seq.seqID].completed / stats.seqStats[seq.seqID].total) * 100)}%
                                                                </Typography>
                                                            </Box>
                                                        )}
                                                    </TableCell>
                                                )}
                                                <TableCell sx={{
                                                    verticalAlign: 'top',
                                                    pt: 3,
                                                    borderRight: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                                                    bgcolor: alpha(theme.palette.background.paper, 0.3)
                                                }}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                                                        <Typography sx={{ fontWeight: 800, fontSize: '1.1rem' }}>{shot.shotID}</Typography>
                                                        {stats && stats.shotStats[`${seq.seqID}-${shot.shotID}`].delayed > 0 && (
                                                            <Tooltip title={`${stats.shotStats[`${seq.seqID}-${shot.shotID}`].delayed}件の遅延タスクがあります`}>
                                                                <ErrorIcon color="error" fontSize="small" />
                                                            </Tooltip>
                                                        )}
                                                    </Box>
                                                    {stats && stats.shotStats[`${seq.seqID}-${shot.shotID}`].total > 0 && (
                                                        <Box sx={{ width: '100%', mt: 1 }}>
                                                            <LinearProgress
                                                                variant="determinate"
                                                                value={(stats.shotStats[`${seq.seqID}-${shot.shotID}`].completed / stats.shotStats[`${seq.seqID}-${shot.shotID}`].total) * 100}
                                                                sx={{ height: 6, borderRadius: 3, bgcolor: alpha(theme.palette.primary.main, 0.1) }}
                                                            />
                                                            <Typography variant="caption" sx={{ mt: 0.5, display: 'block', textAlign: 'right', fontWeight: 700, opacity: 0.7 }}>
                                                                {Math.round((stats.shotStats[`${seq.seqID}-${shot.shotID}`].completed / stats.shotStats[`${seq.seqID}-${shot.shotID}`].total) * 100)}%
                                                            </Typography>
                                                        </Box>
                                                    )}
                                                </TableCell>
                                                {trackerData.types.map((type) => (
                                                    <TableCell key={type} sx={{ verticalAlign: 'top', minWidth: 200, borderRight: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
                                                        {renderTaskCell(shot.tasks[type])}
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        ))}
                                    </React.Fragment>
                                ))
                            )}
                        </TableBody>
                    </Table>
                )}
            </TableContainer>

            <Box sx={{ mt: 2, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {[
                    { key: 'todo', label: '未着手' },
                    { key: 'in-progress', label: '進行中' },
                    { key: 'review', label: 'レビュー' },
                    { key: 'delayed', label: '遅延' },
                    { key: 'completed', label: '完了' }
                ].map((s) => (
                    <Typography key={s.key} variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700 }}>
                        <Box sx={{ width: 16, height: 16, borderRadius: '4px', bgcolor: getStatusColor(s.key) }} />
                        {s.label}
                    </Typography>
                ))}
            </Box>

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
                {selectedTask ? (
                    <TaskQuickDetail
                        task={selectedTask}
                        projects={projects}
                        users={users}
                        onUpdate={handleUpdateTaskQuick}
                        onEditFull={handleEditTaskFull}
                    />
                ) : (
                    isTaskLoading && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}>
                            <CircularProgress />
                        </Box>
                    )
                )}
            </Drawer>

            {/* 詳細編集用ダイアログ */}
            <TaskEditDialog
                open={editTaskId !== null}
                taskId={editTaskId}
                onClose={() => setEditTaskId(null)}
                onSaved={handleTaskDialogSaved}
            />
        </Box>
    );
};

export default ProductionTrackerPage;
