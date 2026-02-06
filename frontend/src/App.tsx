import React from 'react';
import { Routes, Route, BrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { Box, CssBaseline, CircularProgress, Typography } from '@mui/material';
import { useAuth } from './contexts/AuthContext'; // Import useAuth
import { PageStateProvider } from './contexts/PageStateContext'; // Import PageStateProvider
import Layout from './components/Layout'; // ★ Layout をインポート
import UserManagementPage from './pages/UserManagementPage'; // ★★★ Import UserManagementPage ★★★
import ProjectsPage from './pages/ProjectsPage'; // ★★★ Import ProjectsPage ★★★
import TasksPage from './pages/TasksPage';
import GroupManagementPage from './pages/GroupManagementPage';
import MetricsPage from './pages/MetricsPage'; // ★★★ MetricsPageをインポート ★★★
import Login from './pages/Login'; // Import Login page
import CalendarPage from './pages/CalendarPage'; // ★ Calendar -> CalendarPage に修正
// ★ コピーしたページコンポーネントをインポート
import Dashboard from './pages/Dashboard';
import ProjectDetailPage from './pages/ProjectDetailPage'; // ★ インポートを追加
import EventManagementPage from './pages/EventManagementPage'; // ← 追加
import NotesPage from './pages/NotesPage'; // ← メモページを追加
// import Projects from './pages/Projects'; // ProjectsPageを使うためコメントアウト
// import Tasks from './pages/Tasks'; // TasksPageを使うためコメントアウト
// import UserProfile from './pages/UserProfile'; // Import UserProfile
// ★★★ AdminRoute をインポート ★★★
import AdminRoute from './components/AdminRoute';
import AdminOnlyRoute from './components/AdminOnlyRoute';
import MockDataConsole from './components/MockDataConsole';
import ChatPage from './pages/ChatPage';
import UserActivityPage from './pages/UserActivityPage';

// ★★★ PrivateRoute component ★★★
const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    // Show a loading indicator while checking auth status
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
};

/** ロールに応じたデフォルトリダイレクト（管理者→カレンダー、一般→チャット） */
const DefaultRedirect: React.FC = () => {
  const { user } = useAuth();
  return <Navigate to={user?.role === 'admin' ? '/calendar' : '/chat'} replace />;
};

const App: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <PageStateProvider>
      <Box sx={{ display: 'flex', height: '100vh', width: '100%' }}>
        <CssBaseline /> {/* MUI base styles */} 
        <Routes>
        <Route path="/login" element={!isAuthenticated ? <Login /> : <DefaultRedirect />} />

        {/* ★★★ End of Restore Test Route ★★★ */}

        {/* Routes requiring authentication wrapped by PrivateRoute */}
        <Route 
          path="/" 
          element={ // Wrap the element containing protected routes
            <PrivateRoute>
              <Layout>
                <Outlet /> 
              </Layout>
            </PrivateRoute>
          }
        >
          {/* デフォルト: 管理者はカレンダー、一般ユーザーはチャット */}
          <Route index element={<DefaultRedirect />} />
          {/* 一般ユーザーもアクセス可能: 専用チャットページのみ */}
          <Route path="chat" element={<ChatPage />} />
          {/* 以下は管理者のみ（一般ユーザーは /chat にリダイレクト） */}
          <Route path="calendar" element={<AdminOnlyRoute><CalendarPage /></AdminOnlyRoute>} />
          <Route path="dashboard" element={<AdminOnlyRoute><Dashboard /></AdminOnlyRoute>} />
          <Route path="projects" element={<AdminOnlyRoute><ProjectsPage /></AdminOnlyRoute>} />
          <Route path="tasks" element={<AdminOnlyRoute><TasksPage /></AdminOnlyRoute>} />
          <Route path="notes" element={<AdminOnlyRoute><NotesPage /></AdminOnlyRoute>} />
          <Route path="events" element={<AdminOnlyRoute><Navigate to="/metrics?tab=events" replace /></AdminOnlyRoute>} />
          <Route path="projects/:projectId" element={<AdminOnlyRoute><ProjectDetailPage /></AdminOnlyRoute>} />
          <Route path="admin/users" element={<AdminOnlyRoute><UserManagementPage /></AdminOnlyRoute>} />
          <Route path="*" element={<DefaultRedirect />} />
        </Route>

        {/* --- Admin Routes --- */}
        <Route 
          path="/" 
          element={
            <AdminRoute>
              <Layout>
                <Outlet /> 
              </Layout>
            </AdminRoute>
          }
        >
          <Route path="event-management" element={<EventManagementPage />} />
          <Route path="metrics" element={<MetricsPage />} /> 
          <Route path="admin/groups" element={<GroupManagementPage />} />
          <Route path="admin/data" element={<MockDataConsole />} />
          <Route path="admin/user-activities" element={<UserActivityPage />} />
          {/* Optional: Catch-all for admin paths to redirect to metrics or dashboard */}
          <Route path="admin/*" element={<Navigate to="/metrics" replace />} /> 
        </Route>

        {/* Optional Catch-all for non-authenticated routes (if needed) */}
        {/* <Route path="*" element={<Navigate to="/login" replace />} /> */}
        </Routes>
      </Box>
    </PageStateProvider>
  );
};

export default App;
