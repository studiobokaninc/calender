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
import { Trouble } from '../../types';
import { ReportProblem as TroubleIcon } from '@mui/icons-material';

interface TroublesListProps {
    troubles: Trouble[];
    loading?: boolean;
}

export const TroublesList: React.FC<TroublesListProps> = ({ troubles, loading }) => {
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

    return (
        <TableContainer component={Paper} sx={{ borderRadius: 3, boxShadow: 2 }}>
            <Table>
                <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.warning.main, 0.05) }}>
                        <TableCell sx={{ fontWeight: 800 }}>ID</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>ショットID</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>カテゴリ</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>内容</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>重要度</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>ステータス</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>発生日</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {troubles.map((trouble) => (
                        <TableRow key={trouble.id} hover>
                            <TableCell>#{trouble.id}</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>{trouble.shot_id}</TableCell>
                            <TableCell>
                                <Chip label={trouble.category} size="small" variant="outlined" />
                            </TableCell>
                            <TableCell sx={{ maxWidth: 400 }}>
                                <Typography variant="body2">{trouble.description}</Typography>
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
