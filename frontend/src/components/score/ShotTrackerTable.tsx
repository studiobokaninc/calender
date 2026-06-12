import React from 'react';
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
    CircularProgress,
    Tooltip,
    alpha,
    useTheme,
    Stack,
    LinearProgress,
    Avatar,
    Badge
} from '@mui/material';
import {
    Error as ErrorIcon,
    History as HistoryIcon,
    ReportProblem as TroubleIcon,
} from '@mui/icons-material';
import { User } from '../../types';
import { formatTaskLabel } from '../../utils/taskLabel';

interface TaskInfo {
    id: number;
    status: string;
    name: string;
    assignee: string | null;
    due_date: string | null;
}

interface ShotData {
    id: number;
    shotID: string;
    status: string;
    thumbnail_url?: string | null;
    retakes_count: number;
    troubles_count: number;
    tasks: { [type: string]: TaskInfo[] };
}

interface SequenceData {
    seqID: string;
    shots: ShotData[];
}

interface ShotTrackerTableProps {
    data: { sequences: SequenceData[]; types: string[] } | null;
    loading: boolean;
    error: string | null;
    user: User | null;
    stats: any;
    onTaskClick: (taskId: number) => void;
    onShotClick: (shot: ShotData) => void;
}

export const ShotTrackerTable: React.FC<ShotTrackerTableProps> = ({
    data,
    loading,
    error,
    user,
    stats,
    onTaskClick,
    onShotClick
}) => {
    const theme = useTheme();

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'todo': return '#2196F3';
            case 'in-progress': return '#FF9800';
            case 'review': return '#9C27B0';
            case 'approved': return '#4CAF50';
            case 'delayed': return '#F44336';
            case 'completed': return '#9E9E9E';
            case 'retake': return '#E91E63';
            default: return '#BDBDBD';
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'todo': return 'TODO';
            case 'in-progress': return 'WIP';
            case 'review': return 'REVI';
            case 'approved': return 'APPR';
            case 'delayed': return 'DELAY';
            case 'completed': return 'DONE';
            case 'retake': return 'RETK';
            default: return status.toUpperCase().slice(0, 4);
        }
    };

    const renderTaskCell = (tasks: TaskInfo[] | undefined, shotID?: string) => {
        if (!tasks || tasks.length === 0) return <Box sx={{ opacity: 0.1, py: 1 }}>-</Box>;

        return (
            <Stack spacing={0.5} sx={{ py: 0.5 }}>
                {tasks.map((task) => {
                    const color = getStatusColor(task.status);
                    const label = getStatusLabel(task.status);

                    return (
                        <Tooltip key={task.id} title={`${formatTaskLabel(shotID, task.name)}${task.assignee ? ` (担当: ${task.assignee})` : ''}${task.due_date ? ` [〆: ${task.due_date}]` : ''}`} arrow>
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
                                onClick={(e) => { e.stopPropagation(); onTaskClick(task.id); }}
                            >
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: color, letterSpacing: 0.5 }}>
                                        {label}
                                    </Typography>
                                    {task.assignee && (
                                        <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: 'text.secondary', opacity: 0.8 }}>
                                            {task.assignee}
                                        </Typography>
                                    )}
                                </Box>
                                <Typography variant="caption" noWrap sx={{ fontWeight: 700, fontSize: '0.85rem' }}>
                                    {formatTaskLabel(shotID, task.name)}
                                </Typography>
                            </Box>
                        </Tooltip>
                    );
                })}
            </Stack>
        );
    };

    if (error) {
        return (
            <Box sx={{ p: 5, textAlign: 'center' }}>
                <ErrorIcon color="error" sx={{ fontSize: 48, mb: 2 }} />
                <Typography variant="h6" gutterBottom>{error}</Typography>
            </Box>
        );
    }

    if (!data && !loading) return null;

    return (
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

            <Table stickyHeader size="medium" sx={{ minWidth: 1500 }}>
                <TableHead>
                    <TableRow>
                        <TableCell sx={{ fontWeight: 900, fontSize: '1rem', width: 120, bgcolor: alpha(theme.palette.background.paper, 0.95), zIndex: 12 }}>SEQ</TableCell>
                        <TableCell sx={{ fontWeight: 900, fontSize: '1rem', width: 220, bgcolor: alpha(theme.palette.background.paper, 0.95), zIndex: 12 }}>SHOT / STATUS</TableCell>
                        {(data?.types ?? []).map((t) => (
                            <TableCell key={t} sx={{
                                fontWeight: 900,
                                textTransform: 'uppercase',
                                fontSize: '0.9rem',
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
                    {(!data || data.sequences.length === 0) ? (
                        !loading && (
                            <TableRow>
                                <TableCell colSpan={(data?.types.length || 0) + 2} align="center" sx={{ py: 10 }}>
                                    <Typography color="text.secondary">データが見つかりませんでした。</Typography>
                                </TableCell>
                            </TableRow>
                        )
                    ) : (
                        data.sequences.map((seq) => (
                            <React.Fragment key={seq.seqID}>
                                {seq.shots.map((shot, shotIdx) => {
                                    const isMyShot = user && Object.values(shot.tasks).some(tasks => 
                                        tasks.some(t => t.assignee === user.username || t.assignee === user.full_name)
                                    );
                                    return (
                                        <TableRow 
                                            key={`${seq.seqID}-${shot.shotID}`} 
                                            hover 
                                            sx={{ 
                                                cursor: 'pointer',
                                                backgroundColor: isMyShot ? alpha(theme.palette.secondary.main, 0.04) : 'inherit',
                                                borderLeft: isMyShot ? `4px solid ${theme.palette.secondary.main}` : 'none'
                                            }}
                                            onClick={() => onShotClick(shot)}
                                        >
                                        {shotIdx === 0 && (
                                            <TableCell
                                                rowSpan={seq.shots.length}
                                                sx={{
                                                    fontWeight: 900,
                                                    color: theme.palette.primary.main,
                                                    bgcolor: alpha(theme.palette.primary.main, 0.05),
                                                    borderRight: `1px solid ${theme.palette.divider}`,
                                                    fontSize: '1.1rem',
                                                    textAlign: 'center',
                                                    verticalAlign: 'top',
                                                    pt: 3
                                                }}
                                            >
                                                {seq.seqID}
                                                {stats?.seqStats?.[seq.seqID]?.total > 0 && (
                                                     <Box sx={{ mt: 2, px: 2, textAlign: 'center' }}>
                                                         <LinearProgress
                                                             variant="determinate"
                                                             value={(stats.seqStats[seq.seqID].completed / stats.seqStats[seq.seqID].total) * 100}
                                                             sx={{ height: 6, borderRadius: 3 }}
                                                         />
                                                         <Typography variant="caption" sx={{ mt: 0.5, display: 'block', fontWeight: 800, opacity: 0.7 }}>
                                                             {Math.round((stats.seqStats[seq.seqID].completed / stats.seqStats[seq.seqID].total) * 100)}%
                                                         </Typography>
                                                     </Box>
                                                 )}
                                            </TableCell>
                                        )}
                                        <TableCell sx={{
                                            verticalAlign: 'top',
                                            pt: 2,
                                            borderRight: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                                            bgcolor: alpha(theme.palette.background.paper, 0.3)
                                        }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                                                {shot.thumbnail_url ? (
                                                    <Avatar src={shot.thumbnail_url} variant="rounded" sx={{ width: 48, height: 27 }} />
                                                ) : (
                                                    <Box sx={{ width: 48, height: 27, bgcolor: 'divider', borderRadius: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <Typography variant="caption" sx={{ fontSize: 8 }}>NO IMG</Typography>
                                                    </Box>
                                                )}
                                                <Box sx={{ minWidth: 0, flex: 1 }}>
                                                    <Typography sx={{ fontWeight: 800, fontSize: '1rem' }}>{shot.shotID || 'Unknown'}</Typography>
                                                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{(shot.status || 'planning').toUpperCase()}</Typography>
                                                </Box>
                                            </Box>
                                            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                                                {shot.retakes_count > 0 && (
                                                    <Tooltip title={`${shot.retakes_count}件のリテイク指示があります`}>
                                                        <Badge badgeContent={shot.retakes_count} color="error">
                                                            <HistoryIcon sx={{ fontSize: 20, color: theme.palette.error.main }} />
                                                        </Badge>
                                                    </Tooltip>
                                                )}
                                                {shot.troubles_count > 0 && (
                                                    <Tooltip title={`${shot.troubles_count}件のトラブルが報告されています`}>
                                                        <Badge badgeContent={shot.troubles_count} color="warning">
                                                            <TroubleIcon sx={{ fontSize: 20, color: theme.palette.warning.main }} />
                                                        </Badge>
                                                    </Tooltip>
                                                )}
                                            </Box>
                                            {stats?.shotStats?.[`${seq.seqID}-${shot.shotID}`]?.total > 0 && (
                                                <Box sx={{ width: '100%', mt: 1.5 }}>
                                                    <LinearProgress
                                                        variant="determinate"
                                                        value={(stats.shotStats[`${seq.seqID}-${shot.shotID}`].completed / stats.shotStats[`${seq.seqID}-${shot.shotID}`].total) * 100}
                                                        sx={{ height: 4, borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, 0.1) }}
                                                    />
                                                </Box>
                                            )}
                                        </TableCell>
                                        {(data?.types ?? []).map((type) => (
                                            <TableCell key={type} sx={{ verticalAlign: 'top', minWidth: 200, borderRight: `1px solid ${alpha(theme.palette.divider, 0.05)}` }}>
                                                {renderTaskCell(shot.tasks[type], shot.shotID)}
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                )})}
                            </React.Fragment>
                        ))
                    )}
                </TableBody>
            </Table>
        </TableContainer>
    );
};
