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
import { Trouble } from '../../types';
import { ReportProblem as TroubleIcon } from '@mui/icons-material';

interface TroublesListProps {
    troubles: Trouble[];
    loading?: boolean;
    compact?: boolean;
}

export const TroublesList: React.FC<TroublesListProps> = ({ troubles, loading, compact }) => {
    const theme = useTheme();

    if (troubles.length === 0 && !loading) {
        return (
            <Box sx={{ p: 5, textAlign: 'center', bgcolor: alpha(theme.palette.background.paper, 0.5), borderRadius: 3 }}>
                <TroubleIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
                <Typography color="text.secondary">トラブル報告はありません。</Typography>
            </Box>
        );
    }

    const getSeverityColor = (severity: string | null | undefined) => {
        switch (severity?.toUpperCase()) {
            case 'CRITICAL': return 'error';
            case 'HIGH': return 'error';
            case 'MEDIUM': return 'warning';
            case 'LOW': return 'info';
            default: return 'default';
        }
    };

    if (compact) {
        return (
            <Stack spacing={2}>
                {troubles.map((trouble) => (
                    <Paper key={trouble.id} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, bgcolor: alpha(theme.palette.background.paper, 0.8) }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary' }}>#{trouble.id}</Typography>
                                <Chip label={trouble.category} size="small" variant="outlined" sx={{ height: 20 }} />
                                <Chip 
                                    label={trouble.severity?.toUpperCase() || 'NORMAL'} 
                                    size="small" 
                                    color={getSeverityColor(trouble.severity)} 
                                    sx={{ fontWeight: 700, height: 20, fontSize: '0.65rem' }}
                                />
                            </Box>
                            <Chip 
                                label={trouble.status.toUpperCase()} 
                                size="small" 
                                color={trouble.status === 'open' ? 'error' : 'success'}
                                sx={{ fontWeight: 800, height: 20 }}
                            />
                        </Box>
                        <Typography variant="body2" sx={{ mb: 1, whiteSpace: 'pre-wrap', fontWeight: 500, color: 'text.primary' }}>
                            {trouble.description}
                        </Typography>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mt: 1, pt: 1, borderTop: `1px dashed ${theme.palette.divider}` }}>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2 }}>
                                <Typography variant="caption" color="text.secondary">
                                    報告者: {trouble.reporter_name || `ユーザー #${trouble.created_by}`}
                                </Typography>
                                {trouble.assigned_to_name && (
                                    <Typography variant="caption" color="text.secondary">
                                        担当者: {trouble.assigned_to_name}
                                    </Typography>
                                )}
                            </Box>
                            <Typography variant="caption" color="text.secondary">
                                {new Date(trouble.created_at).toLocaleDateString()}
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
                    <TableRow sx={{ bgcolor: alpha(theme.palette.warning.main, 0.05) }}>
                        <TableCell sx={{ fontWeight: 800 }}>ID</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>ショットID</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>カテゴリ</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>内容</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>報告者</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>担当者</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>重要度</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>ステータス</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>発生日</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {troubles.map((trouble) => (
                        <TableRow key={trouble.id} hover>
                            <TableCell>#{trouble.id}</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>{trouble.shot_code || trouble.shot_id}</TableCell>
                            <TableCell>
                                <Chip label={trouble.category} size="small" variant="outlined" />
                            </TableCell>
                            <TableCell sx={{ maxWidth: 400 }}>
                                <Typography variant="body2">{trouble.description}</Typography>
                            </TableCell>
                            <TableCell>
                                {trouble.reporter_name || `ユーザー #${trouble.created_by}`}
                            </TableCell>
                            <TableCell>
                                {trouble.assigned_to_name || '-'}
                            </TableCell>
                            <TableCell>
                                <Chip 
                                    label={trouble.severity?.toUpperCase() || 'NORMAL'} 
                                    size="small" 
                                    color={getSeverityColor(trouble.severity)} 
                                    sx={{ fontWeight: 700 }}
                                />
                            </TableCell>
                            <TableCell>
                                <Chip 
                                    label={trouble.status.toUpperCase()} 
                                    size="small" 
                                    color={trouble.status === 'open' ? 'error' : 'success'}
                                    sx={{ fontWeight: 800 }}
                                />
                            </TableCell>
                            <TableCell>{new Date(trouble.created_at).toLocaleDateString()}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
};

