import React, { useState, useEffect } from 'react';
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
    Stack
} from '@mui/material';
import {
    Refresh as RefreshIcon,
    Error as ErrorIcon,
    ViewModule as ViewModuleIcon,
} from '@mui/icons-material';
import { mockDataApi, fetchProjects } from '../services/api';
import { Project } from '../types';

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
    const [selectedProjectId, setSelectedProjectId] = useState<number | ''>('');
    const [trackerData, setTrackerData] = useState<{ sequences: SequenceData[]; types: string[] } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadProjects = async () => {
            try {
                const data = await fetchProjects();
                const onlineProjects = data.filter((p: Project) => (p.display_status ?? 'online') === 'online');
                setProjects(onlineProjects);
                if (onlineProjects.length > 0) {
                    setSelectedProjectId(onlineProjects[0].id);
                }
            } catch (err) {
                console.error('Failed to fetch projects', err);
                setError('プロジェクト一覧の取得に失敗しました');
            }
        };
        loadProjects();
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
                                    '&:hover': {
                                        backgroundColor: alpha(color, 0.1),
                                        transform: 'scale(1.02)',
                                        zIndex: 1,
                                        boxShadow: 2,
                                        cursor: 'pointer'
                                    }
                                }}
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
                                                    </TableCell>
                                                )}
                                                <TableCell sx={{
                                                    fontWeight: 800,
                                                    fontSize: '1.1rem',
                                                    borderRight: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                                                    bgcolor: alpha(theme.palette.background.paper, 0.3)
                                                }}>
                                                    {shot.shotID}
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
        </Box>
    );
};

export default ProductionTrackerPage;
