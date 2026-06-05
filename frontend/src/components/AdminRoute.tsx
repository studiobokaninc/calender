import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';

const AdminRoute: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    // Should not happen if wrapped by PrivateRoute first, but good practice
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== 'admin') {
    return <Navigate to="/chat" replace />;
    // あるいはアクセス拒否メッセージを表示
    // return <Typography color="error">アクセス権限がありません。</Typography>;
  }

  // 認証済みで管理者権限があれば子要素を表示 (Outlet または children)
  // Use Outlet if routes are nested within AdminRoute, children otherwise
  return children ? <>{children}</> : <Outlet />;
};

export default AdminRoute; 