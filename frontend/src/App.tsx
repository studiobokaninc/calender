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
import MockDataConsole from './components/MockDataConsole'; // ★★★ インポート ★★★

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

// Wrapper components (can add later if needed)
// const PrivateRoute = ...
// const AdminRoute = ...

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
        <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/calendar" replace />} />

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
          {/* Default route redirects to calendar */} 
          <Route index element={<Navigate to="/calendar" replace />} /> 
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="notes" element={<NotesPage />} />
          {/* イベント管理ページをメトリクスページの該当タブにリダイレクト */}
          <Route path="events" element={<Navigate to="/metrics?tab=events" replace />} />
          {/* ★ プロジェクト詳細ページのルートを追加 ★ */}
          <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          {/* ユーザーページは認証済みなら誰でも閲覧可能（編集は管理者のみ・ページ内で制御） */}
          <Route path="admin/users" element={<UserManagementPage />} />
          {/* Catch-all for non-admin authenticated routes */}
          <Route path="*" element={<Navigate to="/calendar" replace />} />
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
