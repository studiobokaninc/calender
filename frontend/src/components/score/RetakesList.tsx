import React from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Typography,
    Chip,
    Box,
    alpha,
    useTheme,
    Stack
} from '@mui/material';
import { Retake } from '../../types';
import { History as HistoryIcon } from '@mui/icons-material';

interface RetakesListProps {
    retakes: Retake[];
    loading?: boolean;
    compact?: boolean;
}

export const RetakesList: React.FC<RetakesListProps> = ({ retakes, loading, compact }) => {
    const theme = useTheme();

    if (retakes.length === 0 && !loading) {
        return (
            <Box sx={{ p: 5, textAlign: 'center', bgcolor: alpha(theme.palette.background.paper, 0.5), borderRadius: 3 }}>
                <HistoryIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
                <Typography color="text.secondary">リテイク指示はありません。</Typography>
            </Box>
        );
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'open': return 'error';
            case 'in_progress': return 'warning';
            case 'closed': return 'success';
            default: return 'default';
        }
    };

    if (compact) {
        return (
            <Stack spacing={2}>
                {retakes.map((retake) => (
                    <Paper key={retake.id} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, bgcolor: alpha(theme.palette.background.paper, 0.8) }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary' }}>#{retake.id}</Typography>
                                <Chip 
                                    label={retake.priority || 'NORMAL'} 
                                    size="small" 
                                    color={retake.priority === 'HIGH' ? 'error' : 'default'} 
                                    sx={{ fontWeight: 700, height: 20, fontSize: '0.65rem' }}
                                />
                            </Box>
                            <Chip 
                                label={retake.status.toUpperCase()} 
                                size="small" 
                                color={getStatusColor(retake.status)}
                                variant="outlined"
                                sx={{ fontWeight: 800, height: 20 }}
                            />
                        </Box>
                        <Typography variant="body2" sx={{ mb: 1, whiteSpace: 'pre-wrap', fontWeight: 600, color: 'text.primary' }}>
                            {retake.overall_comment || 'コメントなし'}
                        </Typography>
                        {retake.timecodes.length > 0 && (
                            <Stack spacing={0.5} sx={{ mb: 1, pl: 1, borderLeft: `2px solid ${alpha(theme.palette.primary.main, 0.2)}` }}>
                                {retake.timecodes.map((tc, idx) => (
                                    <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <Chip label={tc.timecode} size="small" variant="outlined" sx={{ fontSize: '0.7rem', height: 18 }} />
                                        {tc.comment && (
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                                                {tc.comment}
                                            </Typography>
                                        )}
                                    </Box>
                                ))}
                            </Stack>
                        )}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1, mt: 1, pt: 1, borderTop: `1px dashed ${theme.palette.divider}` }}>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2 }}>
                                <Typography variant="caption" color="text.secondary">
                                    指示者: {retake.creator_name || `ユーザー #${retake.created_by}`}
                                </Typography>
                                {retake.assignee_name && (
                                    <Typography variant="caption" color="text.secondary">
                                        担当者: {retake.assignee_name}
                                    </Typography>
                                )}
                            </Box>
                            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.2 }}>
                                <Typography variant="caption" color="text.secondary">
                                    締切: {retake.deadline ? new Date(retake.deadline).toLocaleDateString() : '-'}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    作成: {new Date(retake.created_at).toLocaleDateString()}
                                </Typography>
                            </Box>
                        </Box>
                    </Paper>
                ))}
            </Stack>
        );
    }

    return (
        <TableContainer component={Paper} sx={{ borderRadius: 3, boxShadow: 2 }}>
            <Table>
                <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                        <TableCell sx={{ fontWeight: 800 }}>ID</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>ショットID</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>内容・指示</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>指示者</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>担当者</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>優先度</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>ステータス</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>締切</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>作成日</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {retakes.map((retake) => (
                        <TableRow key={retake.id} hover>
                            <TableCell>#{retake.id}</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>{retake.shot_id}</TableCell>
                            <TableCell sx={{ maxWidth: 350 }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    {retake.overall_comment || '-'}
                                </Typography>
                                {retake.timecodes.length > 0 && (
                                    <Stack spacing={0.5} sx={{ mt: 1, pl: 1, borderLeft: `2px solid ${alpha(theme.palette.primary.main, 0.2)}` }}>
                                        {retake.timecodes.map((tc, idx) => (
                                            <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                                                <Chip label={tc.timecode} size="small" variant="outlined" sx={{ fontSize: '0.7rem', height: 18 }} />
                                                {tc.comment && (
                                                    <Typography variant="caption" color="text.secondary">
                                                        {tc.comment}
                                                    </Typography>
                                                )}
                                            </Box>
                                        ))}
                                    </Stack>
                                )}
                            </TableCell>
                            <TableCell>
                                {retake.creator_name || `ユーザー #${retake.created_by}`}
                            </TableCell>
                            <TableCell>
                                {retake.assignee_name || '-'}
                            </TableCell>
                            <TableCell>
                                <Chip 
                                    label={retake.priority || 'NORMAL'} 
                                    size="small" 
                                    color={retake.priority === 'HIGH' ? 'error' : 'default'} 
                                    sx={{ fontWeight: 700 }}
                                />
                            </TableCell>
                            <TableCell>
                                <Chip 
                                    label={retake.status.toUpperCase()} 
                                    size="small" 
                                    color={getStatusColor(retake.status)}
                                    variant="outlined"
                                    sx={{ fontWeight: 800 }}
                                />
                            </TableCell>
                            <TableCell>{retake.deadline ? new Date(retake.deadline).toLocaleDateString() : '-'}</TableCell>
                            <TableCell>{new Date(retake.created_at).toLocaleDateString()}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
};

