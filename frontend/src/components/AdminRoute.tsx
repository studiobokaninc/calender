import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Box, CircularProgress, Typography } from '@mui/material';
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

  // ★★★ 管理者チェックを追加 ★★★
  if (user?.role !== 'admin') { 
    // 管理者でない場合は、カレンダーなどにリダイレクトするか、アクセス拒否ページを表示
    console.warn('AdminRoute: Non-admin user tried to access:', window.location.pathname);
    // 例: カレンダーにリダイレクト
    return <Navigate to="/calendar" replace />;
    // あるいはアクセス拒否メッセージを表示
    // return <Typography color="error">アクセス権限がありません。</Typography>;
  }

  // 認証済みで管理者権限があれば子要素を表示 (Outlet または children)
  // Use Outlet if routes are nested within AdminRoute, children otherwise
  return children ? <>{children}</> : <Outlet />;
};

export default AdminRoute; 