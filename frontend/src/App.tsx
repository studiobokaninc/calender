import React, { useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Box, CssBaseline, CircularProgress } from '@mui/material';
import { useAuth } from './contexts/AuthContext'; // Import useAuth
import { PageStateProvider } from './contexts/PageStateContext'; // Import PageStateProvider
import Layout from './components/Layout'; // ★ Layout をインポート
import UserManagementPage from './pages/UserManagementPage'; // ★★★ Import UserManagementPage ★★★
import ProjectsPage from './pages/ProjectsPage'; // ★★★ Import ProjectsPage ★★★
import TasksPage from './pages/TasksPage';
import GroupManagementPage from './pages/GroupManagementPage';
import MetricsPage from './pages/MetricsPage'; // ★★★ MetricsPageをインポート ★★★
import Login from './pages/Login'; // Import Login page
const CalendarPage = lazy(() => import('./pages/CalendarPage')); // ★ Calendar -> CalendarPage に修正
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
import MockDataConsole from './components/MockDataConsole';
import UserActivityPage from './pages/UserActivityPage';
import MeetingMinutesPage from './pages/MeetingMinutesPage';
import ProductionTrackerPage from './pages/ProductionTrackerPage';
import ScoreDataAdminPage from './pages/ScoreDataAdminPage';
import GoogleAdminSettingsPage from './pages/GoogleAdminSettingsPage';
import ShotListPage from './pages/ShotListPage';
import BugReportPage from './pages/BugReportPage';
import { initOpLogListeners } from './utils/opLog';

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

/** デフォルトリダイレクト（全ロール共通でカレンダー） */
const DefaultRedirect: React.FC = () => {
  return <Navigate to="/calendar" replace />;
};



const App: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => { initOpLogListeners(); }, []);

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

          {/* Routes requiring authentication wrapped by PrivateRoute */}
          <Route
            path="/"
            element={
              <PrivateRoute>
                <Layout>
                  <Outlet />
                </Layout>
              </PrivateRoute>
            }
          >
            {/* デフォルト: カレンダー */}
            <Route index element={<DefaultRedirect />} />
            {/* 以下は管理者のみへのガードが必要なページ、または共通ページ */}
            <Route path="calendar" element={
              <Suspense fallback={<div style={{display:'flex',justifyContent:'center',padding:'2rem'}}>読み込み中...</div>}>
                <CalendarPage />
              </Suspense>
            } />
            <Route path="dashboard" element={<AdminRoute><Dashboard /></AdminRoute>} />
            <Route path="projects" element={<AdminRoute><ProjectsPage /></AdminRoute>} />
            <Route path="tasks" element={<AdminRoute><TasksPage /></AdminRoute>} />
            <Route path="notes" element={<NotesPage />} />
            <Route path="bug_report" element={<BugReportPage />} />
            <Route path="meetings" element={<AdminRoute><MeetingMinutesPage /></AdminRoute>} />
            {/* /eventsは/event-managementに統一（MetricsのEventsタブは/metrics?tab=eventsで直接アクセス可能） */}
            <Route path="events" element={<AdminRoute><Navigate to="/event-management" replace /></AdminRoute>} />
            <Route path="projects/:projectId" element={<AdminRoute><ProjectDetailPage /></AdminRoute>} />
            <Route path="projects/:projectId/shotlist" element={<AdminRoute><ShotListPage /></AdminRoute>} />
            <Route path="production-tracker" element={<AdminRoute><ProductionTrackerPage /></AdminRoute>} />
            <Route path="admin/users" element={<AdminRoute><UserManagementPage /></AdminRoute>} />

            {/* Admin Block contents merged here */}
            <Route path="event-management" element={<AdminRoute><EventManagementPage /></AdminRoute>} />
            <Route path="metrics" element={<AdminRoute><MetricsPage /></AdminRoute>} />
            <Route path="admin/groups" element={<AdminRoute><GroupManagementPage /></AdminRoute>} />
            <Route path="admin/data" element={<AdminRoute><MockDataConsole /></AdminRoute>} />
            <Route path="admin/user-activities" element={<AdminRoute><UserActivityPage /></AdminRoute>} />
            <Route path="admin/score-data" element={<AdminRoute><ScoreDataAdminPage /></AdminRoute>} />
            <Route path="admin/google" element={<AdminRoute><GoogleAdminSettingsPage /></AdminRoute>} />
            <Route path="admin/*" element={<AdminRoute><Navigate to="/metrics" replace /></AdminRoute>} />

            <Route path="*" element={<DefaultRedirect />} />
          </Route>
        </Routes>
      </Box>
    </PageStateProvider>
  );
};

export default App;
