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
import { ChangeRequest } from '../../types';
import { SwapHoriz as ChangeIcon } from '@mui/icons-material';

interface ChangeRequestsListProps {
    requests: ChangeRequest[];
    loading?: boolean;
}

export const ChangeRequestsList: React.FC<ChangeRequestsListProps> = ({ requests, loading }) => {
    const theme = useTheme();

    if (requests.length === 0 && !loading) {
        return (
            <Box sx={{ p: 5, textAlign: 'center', bgcolor: alpha(theme.palette.background.paper, 0.5), borderRadius: 3 }}>
                <ChangeIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
                <Typography color="text.secondary">変更申請はありません。</Typography>
            </Box>
        );
    }

    const getStatusColor = (status: string) => {
        switch (status.toLowerCase()) {
            case 'pending': return 'warning';
            case 'approved': return 'success';
            case 'rejected': return 'error';
            default: return 'default';
        }
    };

    return (
        <TableContainer component={Paper} sx={{ borderRadius: 3, boxShadow: 2 }}>
            <Table>
                <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.secondary.main, 0.05) }}>
                        <TableCell sx={{ fontWeight: 800 }}>ID</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>タイプ</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>変更内容</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>理由</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>ステータス</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>申請日</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {requests.map((request) => (
                        <TableRow key={request.id} hover>
                            <TableCell>#{request.id}</TableCell>
                            <TableCell>
                                <Chip label={request.type.replace(/_/g, ' ')} size="small" variant="outlined" sx={{ textTransform: 'uppercase' }} />
                            </TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>{request.proposed_value || '-'}</TableCell>
                            <TableCell sx={{ maxWidth: 300 }}>
                                <Typography variant="body2">{request.reason || '-'}</Typography>
                            </TableCell>
                            <TableCell>
                                <Chip 
                                    label={request.status.toUpperCase()} 
                                    size="small" 
                                    color={getStatusColor(request.status)}
                                    sx={{ fontWeight: 800 }}
                                />
                            </TableCell>
                            <TableCell>{new Date(request.created_at).toLocaleDateString()}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
};
