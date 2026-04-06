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
    Card,
    Stack,
    Avatar
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
    shotID: string | null;
    assignee: string | null;
    due_date: string | null;
}

interface SequenceData {
    seqID: string;
    tasks: { [type: string]: TaskInfo[] };
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
                // 表示ステータスが 'online' のプロジェクトのみを抽出
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
            <Stack spacing={1.25} sx={{ py: 1 }}>
                {tasks.map((task) => {
                    const color = getStatusColor(task.status);
                    const label = getStatusLabel(task.status);

                    return (
                        <Tooltip key={task.id} title={`${task.name}${task.assignee ? ` (担当: ${task.assignee})` : ''}${task.due_date ? ` [〆: ${task.due_date}]` : ''}`} arrow>
                            <Card
                                variant="outlined"
                                sx={{
                                    p: 1.5,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 0.5,
                                    borderLeft: `5px solid ${color}`,
                                    backgroundColor: alpha(color, 0.06),
                                    transition: 'all 0.2s',
                                    minWidth: 180,
                                    '&:hover': {
                                        backgroundColor: alpha(color, 0.1),
                                        boxShadow: `0 6px 16px ${alpha(theme.palette.common.black, 0.15)}`,
                                        transform: 'translateY(-2px)',
                                        cursor: 'pointer'
                                    }
                                }}
                            >
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                    <Typography sx={{ fontSize: '0.75rem', fontWeight: 900, color: color, lineHeight: 1, letterSpacing: 0.5 }}>
                                        {label}
                                    </Typography>
                                    {task.shotID && (
                                        <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, px: 0.75, py: 0.1, borderRadius: 0.5, bgcolor: alpha(theme.palette.text.primary, 0.1), color: theme.palette.text.primary }}>
                                            {task.shotID}
                                        </Typography>
                                    )}
                                </Box>

                                <Typography variant="body2" sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.3, color: theme.palette.text.primary, mb: 0.75 }}>
                                    {task.name}
                                </Typography>

                                {task.assignee && (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, pt: 0.5, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
                                        <Avatar sx={{ width: 20, height: 20, fontSize: '0.7rem', fontWeight: 800, bgcolor: theme.palette.primary.main }}>
                                            {task.assignee.charAt(0).toUpperCase()}
                                        </Avatar>
                                        <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: theme.palette.text.secondary }}>
                                            {task.assignee}
                                        </Typography>
                                    </Box>
                                )}
                            </Card>
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
                    <Typography variant="body2" color="text.secondary">
                        シーケンス・ショット進捗管理
                    </Typography>
                </Box>

                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <FormControl variant="outlined" size="small" sx={{ minWidth: 250 }}>
                        <InputLabel>プロジェクト選択</InputLabel>
                        <Select
                            value={selectedProjectId}
                            onChange={(e) => setSelectedProjectId(e.target.value as number)}
                            label="プロジェクト選択"
                            sx={{ borderRadius: 2, bgcolor: alpha(theme.palette.background.paper, 0.8), backdropFilter: 'blur(8px)' }}
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
                    borderRadius: 4,
                    boxShadow: `0 8px 32px 0 ${alpha(theme.palette.common.black, 0.15)}`,
                    bgcolor: alpha(theme.palette.background.paper, 0.6),
                    backdropFilter: 'blur(16px)',
                    border: `1px solid ${alpha(theme.palette.common.white, 0.1)}`,
                    position: 'relative',
                    overflow: 'auto',
                    '&::-webkit-scrollbar': { width: 10, height: 10 },
                    '&::-webkit-scrollbar-thumb': { bgcolor: alpha(theme.palette.primary.main, 0.3), borderRadius: 5 },
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
                    <Table stickyHeader size="medium" sx={{ minWidth: 1400, tableLayout: 'auto' }}>
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{
                                    fontWeight: 900,
                                    width: 220,
                                    bgcolor: alpha(theme.palette.background.paper, 0.98),
                                    zIndex: 11,
                                    fontSize: '0.95rem',
                                    letterSpacing: 2,
                                    borderRight: `2px solid ${alpha(theme.palette.divider, 0.1)}`,
                                    textTransform: 'uppercase'
                                }}>
                                    SEQUENCE
                                </TableCell>
                                {(trackerData?.types ?? []).map((t) => (
                                    <TableCell key={t} sx={{
                                        fontWeight: 900,
                                        textTransform: 'uppercase',
                                        fontSize: '0.85rem',
                                        letterSpacing: 2,
                                        bgcolor: alpha(theme.palette.background.paper, 0.98),
                                        textAlign: 'center'
                                    }}>
                                        {t}
                                    </TableCell>
                                ))}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {(trackerData?.sequences?.length ?? 0) === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={(trackerData?.types?.length ?? 0) + 1} align="center" sx={{ py: 10 }}>
                                        <Typography variant="h6" color="text.secondary">データが見つかりませんでした。</Typography>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                trackerData?.sequences?.map((seq, idx) => (
                                    <TableRow key={idx} sx={{ '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.04) } }}>
                                        <TableCell sx={{
                                            fontWeight: 900,
                                            color: theme.palette.primary.main,
                                            borderRight: `2px solid ${alpha(theme.palette.divider, 0.1)}`,
                                            bgcolor: alpha(theme.palette.background.paper, 0.15),
                                            fontSize: '1.2rem',
                                            py: 3,
                                            px: 2
                                        }}>
                                            {seq.seqID}
                                        </TableCell>
                                        {(trackerData?.types ?? []).map((type) => (
                                            <TableCell key={type} sx={{
                                                verticalAlign: 'top',
                                                borderRight: `1px solid ${alpha(theme.palette.divider, 0.05)}`,
                                                px: 2
                                            }}>
                                                {renderTaskCell(seq.tasks[type])}
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                )}
            </TableContainer>

            <Box sx={{ mt: 2, display: 'flex', gap: 3, flexWrap: 'wrap', opacity: 0.9 }}>
                {[
                    { key: 'todo', label: '未着手' },
                    { key: 'in-progress', label: '進行中' },
                    { key: 'review', label: 'レビュー中' },
                    { key: 'delayed', label: '遅延' },
                    { key: 'completed', label: '完了' }
                ].map((s) => (
                    <Typography key={s.key} variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.6, fontWeight: 600 }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: getStatusColor(s.key) }} />
                        {s.label}
                    </Typography>
                ))}
            </Box>
        </Box>
    );
};

export default ProductionTrackerPage;
