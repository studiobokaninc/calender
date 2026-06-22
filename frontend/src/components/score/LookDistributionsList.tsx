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
    useTheme
} from '@mui/material';
import { LookDistribution } from '../../types';
import { Palette as LookIcon } from '@mui/icons-material';

interface LookDistributionsListProps {
    distributions: LookDistribution[];
    loading?: boolean;
}

export const LookDistributionsList: React.FC<LookDistributionsListProps> = ({ distributions, loading }) => {
    const theme = useTheme();

    if (distributions.length === 0 && !loading) {
        return (
            <Box sx={{ p: 5, textAlign: 'center', bgcolor: alpha(theme.palette.background.paper, 0.5), borderRadius: 3 }}>
                <LookIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
                <Typography color="text.secondary">ルック配信情報はありません。</Typography>
            </Box>
        );
    }

    return (
        <TableContainer component={Paper} sx={{ borderRadius: 3, boxShadow: 2 }}>
            <Table>
                <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.info.main, 0.05) }}>
                        <TableCell sx={{ fontWeight: 800 }}>ID</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>ルックDevID</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>対象ショット</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>ステータス</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>担当者</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>配信日</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {distributions.map((dist) => (
                        <TableRow key={dist.id} hover>
                            <TableCell>#{dist.id}</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>DEV-{dist.look_dev_id}</TableCell>
                            <TableCell>
                                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                    {dist.shot_ids.map((sid) => (
                                        <Chip key={sid} label={`SHOT-${sid}`} size="small" variant="outlined" />
                                    ))}
                                </Box>
                            </TableCell>
                            <TableCell>
                                <Chip 
                                    label={dist.status.toUpperCase()} 
                                    size="small" 
                                    color={dist.status === 'completed' ? 'success' : 'info'}
                                    sx={{ fontWeight: 800 }}
                                />
                            </TableCell>
                            <TableCell>{dist.assignee_name || '未割当'}</TableCell>
                            <TableCell>{new Date(dist.created_at).toLocaleDateString()}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
};
