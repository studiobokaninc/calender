import React from 'react';
import { Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';

/**
 * 管理者のみ子要素を表示。一般ユーザーは /chat にリダイレクト。
 */
const AdminOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, isLoading } = useAuth();

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <CircularProgress />
            </Box>
        );
    }

    if (user?.role !== 'admin') {
        return <Navigate to="/chat" replace />;
    }

    return <>{children}</>;
};

export default AdminOnlyRoute;
