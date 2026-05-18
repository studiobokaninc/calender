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
                        <Typography variant="body2" sx={{ mb: 1, whiteSpace: 'pre-wrap', fontWeight: 500, color: 'text.primary' }}>
                            {retake.overall_comment || 'コメントなし'}
                        </Typography>
                        {retake.timecodes.length > 0 && (
                            <Box sx={{ mb: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                {retake.timecodes.map((tc, idx) => (
                                    <Chip key={idx} label={tc.timecode} size="small" variant="outlined" sx={{ fontSize: '0.7rem', height: 18 }} />
                                ))}
                            </Box>
                        )}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="caption" color="text.secondary">
                                締切: {retake.deadline ? new Date(retake.deadline).toLocaleDateString() : '-'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {new Date(retake.created_at).toLocaleDateString()}
                            </Typography>
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
                        <TableCell sx={{ fontWeight: 800 }}>コメント</TableCell>
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
                            <TableCell sx={{ maxWidth: 300 }}>
                                <Typography variant="body2" noWrap title={retake.overall_comment || ''}>
                                    {retake.overall_comment || '-'}
                                </Typography>
                                {retake.timecodes.length > 0 && (
                                    <Box sx={{ mt: 0.5, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                        {retake.timecodes.map((tc, idx) => (
                                            <Chip key={idx} label={tc.timecode} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                                        ))}
                                    </Box>
                                )}
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

