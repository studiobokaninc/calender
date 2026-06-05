import React from 'react';
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
import MockDataConsole from './components/MockDataConsole';
import ChatPage from './pages/ChatPage';
import UserActivityPage from './pages/UserActivityPage';
import MeetingMinutesPage from './pages/MeetingMinutesPage';
import KnowledgePage from './pages/KnowledgePage';
import ProductionTrackerPage from './pages/ProductionTrackerPage';
import AIRecommendedTasksPage from './pages/AIRecommendedTasksPage';
import GalaxyPage from './pages/GalaxyPage';

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
            {/* デフォルト: 管理者はカレンダー、一般ユーザーはチャット */}
            <Route index element={<DefaultRedirect />} />
            {/* 一般ユーザーのみアクセス可能: 管理者はカレンダーへリダイレクト */}
            <Route path="chat" element={<ChatPage />} />
            {/* 以下は管理者のみへのガードが必要なページ、または共通ページ */}
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="dashboard" element={<AdminRoute><Dashboard /></AdminRoute>} />
            <Route path="projects" element={<AdminRoute><ProjectsPage /></AdminRoute>} />
            <Route path="tasks" element={<AdminRoute><TasksPage /></AdminRoute>} />
            <Route path="notes" element={<NotesPage />} />
            <Route path="ai-tasks" element={<AdminRoute><AIRecommendedTasksPage /></AdminRoute>} />
            <Route path="meetings" element={<AdminRoute><MeetingMinutesPage /></AdminRoute>} />
            <Route path="galaxy" element={<AdminRoute><GalaxyPage /></AdminRoute>} />
            <Route path="knowledge" element={<AdminRoute><KnowledgePage /></AdminRoute>} />
            {/* /eventsは/event-managementに統一（MetricsのEventsタブは/metrics?tab=eventsで直接アクセス可能） */}
            <Route path="events" element={<AdminRoute><Navigate to="/event-management" replace /></AdminRoute>} />
            <Route path="projects/:projectId" element={<AdminRoute><ProjectDetailPage /></AdminRoute>} />
            <Route path="production-tracker" element={<AdminRoute><ProductionTrackerPage /></AdminRoute>} />
            <Route path="admin/users" element={<AdminRoute><UserManagementPage /></AdminRoute>} />

            {/* Admin Block contents merged here */}
            <Route path="event-management" element={<AdminRoute><EventManagementPage /></AdminRoute>} />
            <Route path="metrics" element={<AdminRoute><MetricsPage /></AdminRoute>} />
            <Route path="admin/groups" element={<AdminRoute><GroupManagementPage /></AdminRoute>} />
            <Route path="admin/data" element={<AdminRoute><MockDataConsole /></AdminRoute>} />
            <Route path="admin/user-activities" element={<AdminRoute><UserActivityPage /></AdminRoute>} />
            <Route path="admin/*" element={<AdminRoute><Navigate to="/metrics" replace /></AdminRoute>} />

            <Route path="*" element={<DefaultRedirect />} />
          </Route>
        </Routes>
      </Box>
    </PageStateProvider>
  );
};

export default App;
