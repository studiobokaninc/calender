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
import { Delivery } from '../../types';
import { LocalShipping as DeliveryIcon } from '@mui/icons-material';

interface DeliveriesListProps {
    deliveries: Delivery[];
    loading?: boolean;
}

export const DeliveriesList: React.FC<DeliveriesListProps> = ({ deliveries, loading }) => {
    const theme = useTheme();

    if (deliveries.length === 0 && !loading) {
        return (
            <Box sx={{ p: 5, textAlign: 'center', bgcolor: alpha(theme.palette.background.paper, 0.5), borderRadius: 3 }}>
                <DeliveryIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
                <Typography color="text.secondary">納品情報はありません。</Typography>
            </Box>
        );
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'received': return 'success';
            case 'pending': return 'warning';
            default: return 'default';
        }
    };

    const getQcColor = (qc: string | null | undefined) => {
        switch (qc) {
            case 'approved': return 'success';
            case 'rejected': return 'error';
            case 'pending': return 'warning';
            default: return 'default';
        }
    };

    return (
        <TableContainer component={Paper} sx={{ borderRadius: 3, boxShadow: 2 }}>
            <Table>
                <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.success.main, 0.05) }}>
                        <TableCell sx={{ fontWeight: 800 }}>ID</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>タスクID</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>ステータス</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>QC状態</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>メモ</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>納品日</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {deliveries.map((delivery) => (
                        <TableRow key={delivery.id} hover>
                            <TableCell>#{delivery.id}</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>#{delivery.task_id}</TableCell>
                            <TableCell>
                                <Chip
                                    label={delivery.status.toUpperCase()}
                                    size="small"
                                    color={getStatusColor(delivery.status)}
                                    sx={{ fontWeight: 800 }}
                                />
                            </TableCell>
                            <TableCell>
                                {delivery.qc_status ? (
                                    <Chip
                                        label={delivery.qc_status.toUpperCase()}
                                        size="small"
                                        color={getQcColor(delivery.qc_status)}
                                        variant="outlined"
                                        sx={{ fontWeight: 700 }}
                                    />
                                ) : (
                                    <Typography variant="body2" color="text.disabled">—</Typography>
                                )}
                            </TableCell>
                            <TableCell sx={{ maxWidth: 300 }}>
                                <Typography variant="body2" color={delivery.memo ? 'text.primary' : 'text.disabled'}>
                                    {delivery.memo || '—'}
                                </Typography>
                            </TableCell>
                            <TableCell>{new Date(delivery.created_at).toLocaleDateString()}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
};
