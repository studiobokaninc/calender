import React, { useState, useEffect, useMemo, useCallback } from 'react'; //Reactとは、フロントエンドのUIを作成するためのライブラリです。
import { Box, Typography, Paper, CircularProgress, Alert, FormControl, InputLabel, Select, MenuItem, SelectChangeEvent, Tab, Tabs, Button, TextField, Autocomplete, FormControlLabel, Checkbox, Table, TableBody, TableCell, TableHead, TableRow, TableContainer, Tooltip, Snackbar, Alert as MuiAlert, IconButton, useMediaQuery, useTheme, Card, CardContent, Chip, Divider, Grid, Drawer } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import FilterListIcon from '@mui/icons-material/FilterList';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import TodayIcon from '@mui/icons-material/Today';
import api from '../services/api'; //apiとは、バックエンドのAPIを呼び出すためのライブラリです。
import { Project, Task, User } from '../types'; //Projectとは、プロジェクトの情報を管理する型です。Taskとは、タスクの情報を管理する型です。Userとは、ユーザーの情報を管理する型です。
import ProjectProgressChart from '../components/ProjectProgressChart'; //ProjectProgressChartとは、プロジェクトの進捗を表示するコンポーネントです。
import AssigneeLoadChart from '../components/AssigneeLoadChart'; //AssigneeLoadChartとは、メンバーの負荷を表示するコンポーネントです。
import DelayedTaskList from '../components/DelayedTaskList'; //DelayedTaskListとは、遅れているタスクを表示するコンポーネントです。
import UserProgressChart from '../components/UserProgressChart'; //UserProgressChartとは、ユーザーの進捗を表示するコンポーネントです。
import GanttView from '../components/GanttView'; //GanttViewとは、ガントチャートを表示するコンポーネントです。
import ErrorBoundary from '../components/ErrorBoundary'; //ErrorBoundaryとは、エラーを表示するコンポーネントです。
import ResourceStackBar from '../components/ResourceStackBar';
import { TaskEditDialog } from '../components/SearchEditDialogs';
import { useLocation, useNavigate } from 'react-router-dom'; //useLocationとは、現在のURLを取得するための関数です。useNavigateとは、ページを遷移するための関数です。
import { useMetricsPageState } from '../contexts/PageStateContext'; //PageStateContextとは、ページの状態を管理するコンテキストです。
//コンポーネントとは、フロントエンドのUIを作成するための部品です。他のコードで作成した関数を呼び出して、UIを作成します。
const MetricsPage: React.FC = () => { //MetricsPageとは、メトリクスページを表示するコンポーネントです。
  console.log("--- Rendering MetricsPage Component ---");

  const location = useLocation(); //locationとは、現在のURLを取得するための関数です。
  const navigate = useNavigate(); //navigateとは、ページを遷移するための関数です。
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // ページ状態管理の使用、ユーザーはアプリ内のページ遷移で状態がリセットされないようにするために使用します。
  const { metricsState, updateMetricsState, isInitialLoad, globalData, updateGlobalData } = useMetricsPageState();

  // グローバルデータが既に存在する場合は、loading=falseで開始
  const hasInitialData = globalData && globalData.tasks.length > 0 && globalData.projects.length > 0;

  const [projects, setProjects] = useState<Project[]>(hasInitialData ? globalData.projects : []);
  const [tasks, setTasks] = useState<Task[]>(hasInitialData ? globalData.tasks : []);
  const [users, setUsers] = useState<User[]>(hasInitialData ? globalData.users : []);
  const [loading, setLoading] = useState<boolean>(!hasInitialData);
  const [error, setError] = useState<string | null>(null);

  // 状態を分離（初期化時はデフォルト値）
  const [selectedTab, setSelectedTab] = useState<number>(0);
  const [dateRange, setDateRange] = useState<string>('all');
  const [projectNameFilter, setProjectNameFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedDisplayStatuses, setSelectedDisplayStatuses] = useState<string[]>([]);
  const [laborReportGroupBy, setLaborReportGroupBy] = useState<'user' | 'project'>('user');
  const [laborReportFrom, setLaborReportFrom] = useState('');
  const [laborReportTo, setLaborReportTo] = useState('');
  const [laborReportIncludeOffline, setLaborReportIncludeOffline] = useState(false);
  const [laborReportIncludeCompleted, setLaborReportIncludeCompleted] = useState(false);
  const [laborReportData, setLaborReportData] = useState<Array<{ group_id: number; group_name: string; total_cost: number; task_count: number }>>([]);
  const [laborReportLoading, setLaborReportLoading] = useState(false);
  const laborReportSummary = useMemo(() => {
    if (!laborReportData || laborReportData.length === 0) {
      return { totalHours: 0, totalDays: 0, totalTasks: 0, groupCount: 0, avgHoursPerGroup: 0 };
    }
    const totalHours = laborReportData.reduce((sum, row) => sum + row.total_cost, 0);
    const totalTasks = laborReportData.reduce((sum, row) => sum + row.task_count, 0);
    const groupCount = laborReportData.length;
    const totalDays = totalHours / 8;
    const avgHoursPerGroup = groupCount > 0 ? totalHours / groupCount : 0;
    return { totalHours, totalDays, totalTasks, groupCount, avgHoursPerGroup };
  }, [laborReportData]);
  // 週次余裕時間（その週に暇なユーザー）
  const [weeklyAvailability, setWeeklyAvailability] = useState<{
    week_start: string;
    users: Array<{
      user_id: number;
      user_name: string;
      total_cost_hours?: number;
      assigned_hours: number;
      free_hours: number;
      base_load_hours_per_week?: number;
      task_assigned_hours?: number;
      labor_hours_passed?: number;
      remaining_cost_hours?: number;
      weekdays_passed?: number;
      tasks?: Array<{
        task_id: number;
        task_name: string;
        cost: number;
        start_date: string | null;
        due_date: string | null;
        total_weekdays?: number;
        hours_per_weekday?: number;
        overlaps_week?: boolean;
        weekdays_passed: number;
        labor_hours_passed: number;
        remaining_cost_hours: number;
      }>;
      daily_breakdown?: Array<{ date: string; assigned_hours: number; free_hours: number }>;
    }>;
  } | null>(null);
  const [weeklyAvailabilityLoading, setWeeklyAvailabilityLoading] = useState(false);
  // 今週の割当の基準日（デフォルトは今日）
  const [weeklyBaseDate, setWeeklyBaseDate] = useState(new Date());
  // 今週の割当に完了タスクを含めるかどうか
  const [weeklyIncludeCompleted, setWeeklyIncludeCompleted] = useState(true);
  // 日次余裕時間（その日に暇なユーザー）
  // 「今週のタスク内訳」編集用（共通 TaskEditDialog で開く）
  const [editWeeklyTaskId, setEditWeeklyTaskId] = useState<number | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info' | 'warning';
  }>({
    open: false,
    message: '',
    severity: 'info',
  });
  // 定常業務編集用
  const [editingBaseLoad, setEditingBaseLoad] = useState<Record<number, number>>({});
  const [savingBaseLoad, setSavingBaseLoad] = useState<Record<number, boolean>>({});
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  // ページ状態が復元されたらローカル状態を更新（初回のみ）
  useEffect(() => {
    if (!isInitialLoad) {
      setSelectedTab(metricsState.selectedTab);
      setDateRange(metricsState.dateRange);
      setProjectNameFilter(metricsState.projectNameFilter);
      setStatusFilter(metricsState.statusFilter);
      setSelectedDisplayStatuses(metricsState.selectedDisplayStatuses);
    }

  }, [isInitialLoad]); // isInitialLoadが変わった時のみ実行

  // データ取得関数
  const fetchData = useCallback(async () => { //fetchDataとは、データを取得するための関数です。constとは、Reactの定数を宣言するためのキーワードです。
    console.log("MetricsPage: useEffect - Fetching data...");
    setLoading(true); //loadingをtrueにする
    setError(null); //errorをnullにする
    try {
      const [projRes, taskRes, userRes] = await Promise.all([ //projResとは、プロジェクトのデータを取得するための関数です。taskResとは、タスクのデータを取得するための関数です。userResとは、ユーザーのデータを取得するための関数です。
        api.get<Project[]>('/projects'), //api.getとは、バックエンドのAPIを呼び出すための関数です。
        api.get<Task[]>('/tasks'), //api.getとは、バックエンドのAPIを呼び出すための関数です。
        api.get<User[]>('/api/users'), //api.getとは、バックエンドのAPIを呼び出すための関数です。
      ]);

      const projectsData = projRes.data; //projectsDataとは、プロジェクトのデータを取得するための関数です。
      const tasksData = taskRes.data; //このdataは、バックエンドのAPIから取得したデータを格納するための変数です。tasksDataという変数名で格納します。
      const usersData = userRes.data;

      setProjects(projectsData);
      setTasks(tasksData);
      setUsers(usersData);

      // グローバルデータも更新
      updateGlobalData({
        tasks: tasksData,
        projects: projectsData,
        users: usersData,
      });

    } catch (err: any) {
      console.error("Failed to fetch metrics data:", err);
      setError('データの取得に失敗しました。' + (err.message || ''));
    } finally {
      setLoading(false);
    }
  }, [updateGlobalData]);

  // マウント時のデータ取得（データがない場合のみ）
  useEffect(() => {
    // グローバルデータが存在しない場合のみデータを取得
    if (!hasInitialData) {
      console.log("[MetricsPage] No initial data, fetching...");
      fetchData();
    } else {
      console.log("[MetricsPage] Using existing global data (already set in useState)");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 初回マウント時のみ実行

  // グローバルデータ更新イベントとCSVインポートイベントをリッスン
  useEffect(() => {
    const handleGlobalDataRefresh = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log("[MetricsPage] Global data refreshed event received");
      const { tasks, projects, users } = customEvent.detail;
      if (tasks) setTasks(tasks);
      if (projects) setProjects(projects);
      if (users) setUsers(users);
    };

    const handleCsvImportCompleted = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log("[MetricsPage] CSV import completed event received:", customEvent.detail);
    };

    const handleProjectDeleted = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log("[MetricsPage] Project deleted event received:", customEvent.detail);
    };

    const handleProjectUpdated = (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log("[MetricsPage] Project updated event received:", customEvent.detail);
    };

    console.log("[MetricsPage] Adding event listeners");
    window.addEventListener('globalDataRefreshed', handleGlobalDataRefresh);
    window.addEventListener('csvImportCompleted', handleCsvImportCompleted);
    window.addEventListener('projectDeleted', handleProjectDeleted);
    window.addEventListener('projectUpdated', handleProjectUpdated);

    return () => {
      console.log("[MetricsPage] Removing event listeners");
      window.removeEventListener('globalDataRefreshed', handleGlobalDataRefresh);
      window.removeEventListener('csvImportCompleted', handleCsvImportCompleted);
      window.removeEventListener('projectDeleted', handleProjectDeleted);
      window.removeEventListener('projectUpdated', handleProjectUpdated);
    };
  }, []);

  // フィルター状態の変更をページ状態に反映（初期化完了後のみ）
  useEffect(() => {
    if (!isInitialLoad) {
      updateMetricsState({
        selectedTab,
        dateRange,
        projectNameFilter,
        statusFilter,
        selectedDisplayStatuses,
      });
    }
  }, [selectedTab, dateRange, projectNameFilter, statusFilter, selectedDisplayStatuses, isInitialLoad, updateMetricsState]);

  // URLクエリパラメータに基づいて初期タブを設定（ブラウザ更新時のみ）
  useEffect(() => {
    if (isInitialLoad) {
      const params = new URLSearchParams(location.search);
      const tabParam = params.get('tab');
      if (tabParam === 'progress') setSelectedTab(0);
      else if (tabParam === 'load') setSelectedTab(1);
      else if (tabParam === 'delayed') setSelectedTab(2);
      else if (tabParam === 'member_progress') setSelectedTab(3);
      else if (tabParam === 'gantt') setSelectedTab(4);
      else if (tabParam === 'weekly_assign') setSelectedTab(5);
      else if (tabParam === 'labor') setSelectedTab(6);
    }
  }, [location.search, isInitialLoad]);

  // プロジェクト名フィルター用（オフラインは選択肢に含めない・緑丸表示用にオブジェクトで保持）
  const projectFilterOptions = useMemo(() => {
    return projects.filter(project => project.display_status !== 'offline');
  }, [projects]);

  // プロジェクトステータスオプションの準備
  const projectStatusOptions = useMemo(() => {
    const statuses = new Set<string>();
    projects.forEach(project => {
      if (project.status) {
        statuses.add(project.status);
      }
    });
    return Array.from(statuses);
  }, [projects]);


  // データのフィルタリング（デフォルトでオフラインのプロジェクトは除外）
  const filteredTasks = useMemo(() => {
    console.log(`[MetricsPage] Filtering tasks - Total tasks: ${tasks.length}, Total projects: ${projects.length}`);
    console.log(`[MetricsPage] Filters - projectName: ${projectNameFilter}, status: ${statusFilter}, displayStatuses: ${selectedDisplayStatuses.join(',')}, dateRange: ${dateRange}`);

    let result = tasks;
    // デフォルトでオフラインを除く（全タブ共通）
    let tempProjects = projects.filter(project => project.display_status !== 'offline');

    // プロジェクト名でフィルタリング (プロジェクトリストを先に絞る)
    if (projectNameFilter) {
      tempProjects = tempProjects.filter(project => project.name === projectNameFilter);
      console.log(`[MetricsPage] After project name filter: ${tempProjects.length} projects`);
    }

    // プロジェクトの status でフィルタリング (プロジェクトリストを絞る)
    if (statusFilter !== 'all') {
      tempProjects = tempProjects.filter(project => project.status === statusFilter);
    }


    const filteredProjectIds = tempProjects.map(project => String(project.id));

    // 絞り込まれたプロジェクトIDに基づいてタスクをフィルタリング（オフライン除外を含むため常に適用）
    result = result.filter(task => task.project_id && filteredProjectIds.includes(String(task.project_id)));

    // 日付でフィルタリング (最後に適用)
    if (dateRange !== 'all') {
      const now = new Date();
      let startDate: Date;

      switch (dateRange) {
        case 'week':
          startDate = new Date(now);
          startDate.setDate(now.getDate() - 7);
          break;
        case 'month':
          startDate = new Date(now);
          startDate.setMonth(now.getMonth() - 1);
          break;
        case 'quarter':
          startDate = new Date(now);
          startDate.setMonth(now.getMonth() - 3);
          break;
        default:
          startDate = new Date(0); // Unix epoch
      }

      result = result.filter(task => {
        // task.due_date が null や undefined の場合、または無効な日付文字列の場合を考慮
        const dueDate = task.due_date ? new Date(task.due_date) : null;
        if (dueDate && !isNaN(dueDate.getTime())) {
          return dueDate >= startDate && dueDate <= now;
        }
        // due_date がない、または無効なタスクは期間フィルタでは除外しない (または要件に応じて除外)
        return true; // ここでは除外しない
      });
    }

    console.log(`[MetricsPage] Filtered tasks result: ${result.length} tasks`);
    if (result.length > 0) {
      console.log(`[MetricsPage] Project IDs in filtered tasks:`, [...new Set(result.map(t => t.project_id))]);
    }

    return result;
  }, [tasks, projects, dateRange, projectNameFilter, statusFilter, selectedDisplayStatuses]);

  // フィルタリングされたプロジェクト（デフォルトでオフラインを除く）
  const filteredProjects = useMemo(() => {
    let result = projects.filter(project => project.display_status !== 'offline');

    if (projectNameFilter) {
      result = result.filter(project => project.name === projectNameFilter);
    }
    if (statusFilter !== 'all') {
      result = result.filter(project => project.status === statusFilter);
    }

    console.log(`[MetricsPage] Filtered projects result: ${result.length} projects`, result.map(p => ({ id: p.id, name: p.name })));

    return result;
  }, [projects, projectNameFilter, statusFilter, selectedDisplayStatuses]);

  const totalProjects = useMemo(() => filteredProjects.length, [filteredProjects]);
  const totalTasks = useMemo(() => filteredTasks.length, [filteredTasks]);
  const totalUsers = useMemo(() => users.filter(u => u.role !== 'admin').length, [users]);

  const completedTasks = useMemo(() =>
    filteredTasks.filter(task => task.status === 'completed').length,
    [filteredTasks]
  );

  const inProgressTasks = useMemo(() =>
    filteredTasks.filter(task => task.status === 'in-progress').length,
    [filteredTasks]
  );

  const delayedTasks = useMemo(() =>
    filteredTasks.filter(task => task.status === 'delayed').length,
    [filteredTasks]
  );

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setSelectedTab(newValue);
    let tabName = '';
    if (newValue === 0) tabName = 'progress';
    else if (newValue === 1) tabName = 'load';
    else if (newValue === 2) tabName = 'delayed';
    else if (newValue === 3) tabName = 'member_progress';
    else if (newValue === 4) tabName = 'gantt';
    else if (newValue === 5) tabName = 'weekly_assign';
    else if (newValue === 6) tabName = 'labor';
    navigate(`${location.pathname}?tab=${tabName}`);
  };

  const fetchLaborReport = useCallback(async () => {
    setLaborReportLoading(true);
    try {
      const params: Record<string, string | boolean> = { group_by: laborReportGroupBy };
      if (laborReportFrom) params.from_date = laborReportFrom;
      if (laborReportTo) params.to_date = laborReportTo;
      // include_offlineパラメータを追加（担当者別・プロジェクト別の両方で使用）
      params.include_offline = laborReportIncludeOffline;
      // include_completedパラメータを追加
      params.include_completed = laborReportIncludeCompleted;
      const res = await api.get<Array<{ group_id: number; group_name: string; total_cost: number; task_count: number }>>('/metrics/labor-report', { params });
      setLaborReportData(res.data || []);
    } catch {
      setLaborReportData([]);
    } finally {
      setLaborReportLoading(false);
    }
  }, [laborReportGroupBy, laborReportFrom, laborReportTo, laborReportIncludeOffline, laborReportIncludeCompleted]);

  const fetchWeeklyAvailability = useCallback(async () => {
    setWeeklyAvailabilityLoading(true);
    try {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const day = now.getDate();
      const localToday = `${y}-${m}-${String(day).padStart(2, '0')}`;

      // weeklyBaseDate を基準に月曜日を計算
      const base = new Date(weeklyBaseDate);
      const baseDay = base.getDay();
      const monOffset = baseDay === 0 ? -6 : 1 - baseDay; // 月曜始まり
      const monday = new Date(base);
      monday.setDate(base.getDate() + monOffset);

      const localMonday = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;

      const params: Record<string, string | boolean> = {
        reference_date: localToday, // Today is always "Real Today" for calculating passed time
        week_start: localMonday,
        only_free: false,
        include_offline: false,
        include_completed: weeklyIncludeCompleted,
        consider_dependencies: true,
      };
      const res = await api.get<{
        week_start: string;
        hours_per_day: number;
        max_hours_per_week: number;
        users: Array<{
          user_id: number;
          user_name: string;
          total_cost_hours?: number;
          assigned_hours: number;
          free_hours: number;
          labor_hours_passed?: number;
          remaining_cost_hours?: number;
          weekdays_passed?: number;
          tasks?: Array<{
            task_id: number;
            task_name: string;
            cost: number;
            start_date: string | null;
            due_date: string | null;
            total_weekdays?: number;
            hours_per_weekday?: number;
            overlaps_week?: boolean;
            weekdays_passed: number;
            labor_hours_passed: number;
            remaining_cost_hours: number;
          }>;
          daily_breakdown?: Array<{ date: string; assigned_hours: number; free_hours: number }>;
        }>;
      }>('/metrics/weekly-availability', { params });
      setWeeklyAvailability({ week_start: res.data.week_start, users: res.data.users });
    } catch {
      setWeeklyAvailability(null);
    } finally {
      setWeeklyAvailabilityLoading(false);
    }
  }, [weeklyIncludeCompleted, weeklyBaseDate]);

  const handlePrevWeek = () => {
    const newDate = new Date(weeklyBaseDate);
    newDate.setDate(newDate.getDate() - 7);
    setWeeklyBaseDate(newDate);
  };

  const handleNextWeek = () => {
    const newDate = new Date(weeklyBaseDate);
    newDate.setDate(newDate.getDate() + 7);
    setWeeklyBaseDate(newDate);
  };

  const handleThisWeek = () => {
    setWeeklyBaseDate(new Date());
  };

  // タスクの開始日〜期日までの平日日数を計算（バックエンドから total_weekdays が来ていない場合のフォールバック）
  const calculateWeekdaysInRange = (startDateStr: string | null, endDateStr: string | null): number | null => {
    if (!startDateStr || !endDateStr) return null;
    const start = new Date(startDateStr + 'T00:00:00');
    const end = new Date(endDateStr + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return null;

    let count = 0;
    const current = new Date(start);
    while (current <= end) {
      const day = current.getDay();
      // 0: 日曜, 6: 土曜 は平日から除外
      if (day !== 0 && day !== 6) {
        count += 1;
      }
      current.setDate(current.getDate() + 1);
    }
    return count;
  };

  // 今週の割当タブを開いたときに今週の割り当てを自動取得
  useEffect(() => {
    if (selectedTab === 5) {
      fetchWeeklyAvailability();
    }
  }, [selectedTab, fetchWeeklyAvailability]);

  // 「今週のタスク内訳」行ダブルクリック時の編集開始
  const handleWeeklyTaskRowDoubleClick = (task: { task_id: number; task_name?: string; cost?: number; start_date?: string | null; due_date?: string | null }) => {
    setEditWeeklyTaskId(task.task_id);
  };

  const handleSnackbarClose = () => {
    setSnackbar((prev) => ({ ...prev, open: false }));
  };

  const handleDateRangeChange = (event: SelectChangeEvent) => {
    setDateRange(event.target.value);
  };

  const handleStatusFilterChange = (event: SelectChangeEvent) => {
    setStatusFilter(event.target.value);
  };

  const handleClearFilters = () => {
    setDateRange('all');
    setProjectNameFilter(null);
    setStatusFilter('all');
    setSelectedDisplayStatuses([]);
  };
  //ここから下は、ローディング中、エラー、データが取得できた場合の表示を行うためのコードです。

  if (loading) {
    console.log("MetricsPage: Rendering Loading state");
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 'calc(100vh - 112px)' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    console.log("MetricsPage: Rendering Error state");
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  console.log("MetricsPage: Rendering main content with data:", { projects, tasks, users });
  return (
    <Box
      sx={{
        p: { xs: 1, sm: 2 },
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        overflowX: selectedTab === 4 ? 'hidden' : 'visible',
        ...(selectedTab === 4 && {
          '&::-webkit-scrollbar': { display: 'none' },
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
        })
      }}
    >
      <Box sx={{ flexShrink: 0, width: '100%', mb: { xs: 1, sm: 1.5 } }}>
        <Paper sx={{ p: { xs: 1, sm: 1.5, md: 2 }, borderRadius: { xs: 1, sm: 2 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'center', sm: 'center' }, mb: { xs: 1, sm: 1.5 }, flexDirection: { xs: 'row', sm: 'row' }, gap: { xs: 1, sm: 0 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
              <Typography variant="h6" sx={{ fontSize: { xs: '1rem', sm: '1rem' }, fontWeight: 600 }}>プロジェクトメトリクス</Typography>
              {isMobile && (
                <IconButton
                  onClick={() => setMobileFilterOpen(true)}
                  sx={{ minWidth: 48, minHeight: 48 }}
                  color="primary"
                >
                  <FilterListIcon />
                </IconButton>
              )}
            </Box>
            <Button variant="outlined" size="small" onClick={handleClearFilters} sx={{ alignSelf: 'auto', minHeight: { xs: 32, sm: 36 }, fontSize: { xs: '0.75rem', sm: '0.875rem' }, py: 0.5 }}>{isMobile ? "クリア" : "フィルターをクリア"}</Button>
          </Box>
          {/* PC用フィルター */}
          {!isMobile && (
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, flexWrap: 'wrap', alignItems: { xs: 'stretch', sm: 'center' }, gap: { xs: 1.5, sm: 3 }, borderBottom: 1, borderColor: 'divider', pb: { xs: 1.5, sm: 1.5 }, mb: { xs: 1.5, sm: 1.5 }, width: '100%' }}>
              <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, flexWrap: 'wrap', alignItems: 'stretch', gap: { xs: 1.5, sm: 2 }, flex: 1, minWidth: 0, width: { xs: '100%', sm: 'auto' } }}>
                <FormControl size="small" sx={{ minWidth: 180, flex: '1 1 160px' }}>
                  <InputLabel id="date-range-label">期間</InputLabel>
                  <Select labelId="date-range-label" value={dateRange} label="期間" onChange={handleDateRangeChange}>
                    <MenuItem value="all">全期間</MenuItem>
                    <MenuItem value="week">直近1週間</MenuItem>
                    <MenuItem value="month">直近1ヶ月</MenuItem>
                    <MenuItem value="quarter">直近3ヶ月</MenuItem>
                  </Select>
                </FormControl>
                <Autocomplete
                  size="small"
                  options={projectFilterOptions}
                  getOptionLabel={(p) => p.name}
                  value={projectFilterOptions.find(p => p.name === projectNameFilter) ?? null}
                  onChange={(_e, newValue) => setProjectNameFilter(newValue?.name ?? null)}
                  sx={{ minWidth: 220, flex: '2 1 200px' }}
                  renderInput={(params) => <TextField {...params} label="プロジェクト名" />}
                  renderOption={(props, project) => (
                    <li {...props} key={project.id}>
                      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                        <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: project.display_status === 'online' ? '#4CAF50' : '#9E9E9E', flexShrink: 0 }} />
                        {project.name}
                      </Box>
                    </li>
                  )}
                />
                <FormControl size="small" sx={{ minWidth: 180, flex: '1 1 160px' }}>
                  <InputLabel id="project-status-label">プロジェクト状態</InputLabel>
                  <Select labelId="project-status-label" value={statusFilter} label="プロジェクト状態" onChange={handleStatusFilterChange}>
                    <MenuItem value="all">すべて</MenuItem>
                    {projectStatusOptions.map(status => (<MenuItem key={status} value={status}>{status}</MenuItem>))}
                  </Select>
                </FormControl>
              </Box>
            </Box>
          )}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(6, 1fr)' }, gap: { xs: 1, sm: 3 }, width: '100%' }}>
            {[
              { val: totalProjects, label: 'プロジェクト', color: '#1976d2' },
              { val: totalTasks, label: 'タスク総数', color: '#1976d2' },
              { val: completedTasks, label: '完了タスク', color: '#9e9e9e' },
              { val: inProgressTasks, label: '進行中タスク', color: '#ff9800' },
              { val: delayedTasks, label: '遅延タスク', color: '#f44336' },
              { val: totalUsers, label: 'メンバー', color: '#9e9e9e' }
            ].map(({ val, label, color }) => (
              <Box key={label} sx={{ textAlign: 'center', minWidth: 0 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color, fontSize: { xs: '1rem', sm: '1.375rem' }, lineHeight: 1.2 }}>{val}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.65rem', sm: '0.75rem' }, whiteSpace: 'nowrap', display: 'block' }}>{label}</Typography>
              </Box>
            ))}
          </Box>
        </Paper>
      </Box>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: selectedTab === 4 ? 'hidden' : 'visible',
          overflowX: selectedTab === 4 ? 'hidden' : 'auto',
          ...(selectedTab === 4 && {
            '&::-webkit-scrollbar': { display: 'none' },
            msOverflowStyle: 'none',
            scrollbarWidth: 'none',
          })
        }}
      >
        <Paper
          sx={{
            p: { xs: 0.75, sm: 1.5 },
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            borderRadius: { xs: 1, sm: 2 },
            overflow: selectedTab === 4 ? 'hidden' : 'visible',
            overflowX: selectedTab === 4 ? 'hidden' : 'auto',
            ...(selectedTab === 4 && {
              '&::-webkit-scrollbar': { display: 'none' },
              msOverflowStyle: 'none',
              scrollbarWidth: 'none',
            })
          }}
        >
          <Tabs
            value={selectedTab}
            onChange={handleTabChange}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{
              borderBottom: 1,
              borderColor: 'divider',
              mb: 1,
              minHeight: { xs: 48, sm: 40 },
              '& .MuiTabs-scrollButtons': {
                minWidth: { xs: 48, sm: 40 },
                minHeight: { xs: 48, sm: 40 },
              },
              '& .MuiTab-root': {
                minHeight: { xs: 48, sm: 40 },
                py: { xs: 1, sm: 0.5 },
                fontSize: { xs: '0.8rem', sm: '0.875rem' },
                px: { xs: 1.5, sm: 1.5 },
                minWidth: { xs: 90, sm: 100 },
                textTransform: 'none',
                fontWeight: { xs: 500, sm: 400 }
              }
            }}
          >
            <Tab label={isMobile ? "進捗" : "プロジェクト進捗"} />
            <Tab label={isMobile ? "負荷" : "メンバー負荷"} />
            <Tab label={isMobile ? "遅延" : "遅延タスク"} />
            <Tab label={isMobile ? "進捗" : "メンバー進捗"} />
            <Tab label={isMobile ? "ガント" : "ガントチャート"} />
            <Tab label={isMobile ? "割当" : "今週の割当"} />
            <Tab label={isMobile ? "工数" : "工数集計"} />
          </Tabs>
          <Box sx={{ flex: 1, minHeight: 0, overflow: selectedTab === 4 ? 'hidden' : 'auto', overflowX: selectedTab === 4 ? 'hidden' : 'auto' }}>
            {selectedTab === 0 && <ProjectProgressChart projects={filteredProjects} tasks={filteredTasks} />}
            {selectedTab === 1 && <AssigneeLoadChart tasks={filteredTasks} users={users} projects={filteredProjects} />}
            {selectedTab === 2 && <DelayedTaskList tasks={filteredTasks} users={users} projects={filteredProjects} />}
            {selectedTab === 3 && <UserProgressChart tasks={filteredTasks} users={users} projects={filteredProjects} />}
            {selectedTab === 4 && (
              filteredTasks.length > 0 ? (
                <ErrorBoundary componentName="GanttChart">
                  <Box sx={{ height: '100%', width: '100%', overflow: 'hidden' }}>
                    <GanttView key={`gantt-${filteredProjects.map(p => p.id).join('-')}`} tasks={filteredTasks} projects={filteredProjects} users={users} />
                  </Box>
                </ErrorBoundary>
              ) : (
                <Box sx={{ p: 2, textAlign: 'center' }}><Typography>タスクデータが見つかりません。タスクを追加するか、フィルターを調整してください。</Typography></Box>
              )
            )}
            {/* タブ5: 今週の割当 — 割り当てテーブルとタスク内訳のみ */}
            {selectedTab === 5 && (
              <Box sx={{ p: { xs: 1, sm: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600, fontSize: { xs: '1rem', sm: '1.25rem' } }}>割り当て状況</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', bgcolor: 'background.paper', borderRadius: 1, border: 1, borderColor: 'divider' }}>
                      <IconButton size="small" onClick={handlePrevWeek} disabled={weeklyAvailabilityLoading}>
                        <NavigateBeforeIcon />
                      </IconButton>
                      <Typography variant="body2" sx={{ mx: 1, fontWeight: 500, minWidth: 140, textAlign: 'center' }}>
                        {(() => {
                          const d = new Date(weeklyAvailability?.week_start || (() => {
                            const base = new Date(weeklyBaseDate);
                            const day = base.getDay();
                            const diff = base.getDate() - day + (day === 0 ? -6 : 1);
                            base.setDate(diff);
                            return base;
                          })());
                          const end = new Date(d);
                          end.setDate(d.getDate() + 6);
                          return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
                        })()}
                      </Typography>
                      <IconButton size="small" onClick={handleNextWeek} disabled={weeklyAvailabilityLoading}>
                        <NavigateNextIcon />
                      </IconButton>
                    </Box>
                    <Tooltip title="今週に戻る">
                      <IconButton size="small" onClick={handleThisWeek} sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                        <TodayIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={weeklyIncludeCompleted}
                          onChange={(e) => setWeeklyIncludeCompleted(e.target.checked)}
                          size="small"
                        />
                      }
                      label={<Typography variant="body2">完了タスクを含める</Typography>}
                    />
                    <Button variant="contained" size={isMobile ? "small" : "medium"} onClick={fetchWeeklyAvailability} disabled={weeklyAvailabilityLoading}>
                      {weeklyAvailabilityLoading ? '更新中...' : '更新'}
                    </Button>
                  </Box>
                </Box>
                {weeklyAvailabilityLoading && !weeklyAvailability && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
                )}
                {!weeklyAvailabilityLoading && !weeklyAvailability && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>「更新」をクリックして今週の工数データを取得してください。</Typography>
                )}

                <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, mb: 3 }}>
                  <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, fontSize: { xs: '1rem', sm: '1.25rem' } }}>週内日別・割当時間</Typography>
                  {weeklyAvailabilityLoading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
                  )}
                  {!weeklyAvailabilityLoading && weeklyAvailability && (() => {
                    const allMembers = users.filter(u => u.role !== 'admin');
                    const byId = new Map(weeklyAvailability.users.map(u => [u.user_id, u]));
                    const maxHoursPerWeek = 40;
                    const hoursPerDay = 8;
                    const allRows = allMembers.map(m => {
                      const w = byId.get(m.id);
                      const baseLoad = w?.base_load_hours_per_week ?? m.base_load_hours_per_week ?? 0;
                      return w
                        ? { user_id: w.user_id, user_name: w.user_name || `User ${w.user_id}`, assigned_hours: w.assigned_hours, free_hours: w.free_hours, daily_breakdown: w.daily_breakdown ?? [], labor_hours_passed: w.labor_hours_passed, weekdays_passed: w.weekdays_passed, tasks: w.tasks, base_load_hours_per_week: baseLoad }
                        : { user_id: m.id, user_name: m.full_name || m.username || `User ${m.id}`, assigned_hours: 0, free_hours: 40, daily_breakdown: [], labor_hours_passed: undefined, weekdays_passed: 0, tasks: [], base_load_hours_per_week: baseLoad };
                    });
                    // 全ユーザーを表示（今週のタスクの有無に関わらず）
                    const rows = allRows;
                    return (
                      <>
                        {rows.length === 0 ? (
                          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>ユーザーが登録されていません。</Typography>
                        ) : isMobile ? (
                          // モバイル: カード形式で表示
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {rows.map((row) => {
                              const todayIso = new Date().toISOString().slice(0, 10);
                              const utilization = maxHoursPerWeek > 0 ? (row.assigned_hours / maxHoursPerWeek) * 100 : 0;
                              const isEditingBaseLoad = editingBaseLoad.hasOwnProperty(row.user_id);
                              const currentBaseLoad = isEditingBaseLoad ? editingBaseLoad[row.user_id] : (row.base_load_hours_per_week ?? 0);
                              const isSaving = savingBaseLoad[row.user_id] || false;

                              const handleBaseLoadEdit = async (userId: number) => {
                                if (isEditingBaseLoad) {
                                  setSavingBaseLoad(prev => ({ ...prev, [userId]: true }));
                                  try {
                                    await api.put(`/api/users/${userId}`, {
                                      base_load_hours_per_week: currentBaseLoad
                                    });
                                    setEditingBaseLoad(prev => {
                                      const newState = { ...prev };
                                      delete newState[userId];
                                      return newState;
                                    });
                                    setSnackbar({
                                      open: true,
                                      message: '定常業務を更新しました',
                                      severity: 'success'
                                    });
                                    await fetchWeeklyAvailability();
                                  } catch (error: any) {
                                    console.error('Failed to update base load:', error);
                                    setSnackbar({
                                      open: true,
                                      message: '定常業務の更新に失敗しました',
                                      severity: 'error'
                                    });
                                  } finally {
                                    setSavingBaseLoad(prev => {
                                      const newState = { ...prev };
                                      delete newState[userId];
                                      return newState;
                                    });
                                  }
                                } else {
                                  setEditingBaseLoad(prev => ({
                                    ...prev,
                                    [userId]: row.base_load_hours_per_week ?? 0
                                  }));
                                }
                              };

                              const handleBaseLoadCancel = (userId: number) => {
                                setEditingBaseLoad(prev => {
                                  const newState = { ...prev };
                                  delete newState[userId];
                                  return newState;
                                });
                              };

                              return (
                                <Card
                                  key={row.user_id}
                                  variant="outlined"
                                  sx={{
                                    borderLeft: utilization >= 100 ? '4px solid' : utilization >= 80 ? '4px solid' : 'none',
                                    borderLeftColor: utilization >= 100 ? 'error.main' : utilization >= 80 ? 'warning.main' : 'transparent'
                                  }}
                                >
                                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                                    {/* ヘッダー: ユーザー名と稼働率 */}
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                                      <Box>
                                        <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '1rem', mb: 0.5 }}>
                                          {row.user_name}
                                        </Typography>
                                        <Chip
                                          label={`稼働率 ${utilization.toFixed(1)}%`}
                                          size="small"
                                          sx={{
                                            bgcolor: utilization >= 100 ? 'error.light' : utilization >= 80 ? 'warning.light' : 'success.light',
                                            color: utilization >= 100 ? 'error.dark' : utilization >= 80 ? 'warning.dark' : 'success.dark',
                                            fontWeight: 600,
                                            fontSize: '0.75rem',
                                            height: 24
                                          }}
                                        />
                                      </Box>
                                      <Box sx={{ textAlign: 'right' }}>
                                        <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1.25rem', color: row.free_hours > 0 ? 'success.main' : 'text.secondary' }}>
                                          {row.free_hours.toFixed(1)}h
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                          残り
                                        </Typography>
                                      </Box>
                                    </Box>

                                    <Divider sx={{ my: 1.5 }} />

                                    {/* 主要情報: 割当時間と定常業務 */}
                                    <Grid container spacing={2} sx={{ mb: 2 }}>
                                      <Grid item xs={6}>
                                        <Box>
                                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', mb: 0.5 }}>
                                            今週の割当
                                          </Typography>
                                          <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
                                            {row.assigned_hours.toFixed(1)}h
                                          </Typography>
                                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                                            / {maxHoursPerWeek}h
                                          </Typography>
                                        </Box>
                                      </Grid>
                                      <Grid item xs={6}>
                                        <Box>
                                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', mb: 0.5 }}>
                                            定常業務
                                          </Typography>
                                          {isEditingBaseLoad ? (
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                              <TextField
                                                type="number"
                                                value={currentBaseLoad}
                                                onChange={(e) => {
                                                  const value = parseFloat(e.target.value) || 0;
                                                  setEditingBaseLoad(prev => ({
                                                    ...prev,
                                                    [row.user_id]: Math.max(0, Math.min(40, value))
                                                  }));
                                                }}
                                                size="small"
                                                inputProps={{ step: 0.5, min: 0, max: 40 }}
                                                sx={{ width: 70 }}
                                                disabled={isSaving}
                                              />
                                              <IconButton
                                                size="small"
                                                onClick={() => handleBaseLoadEdit(row.user_id)}
                                                disabled={isSaving}
                                                color="primary"
                                              >
                                                <CheckIcon fontSize="small" />
                                              </IconButton>
                                              <IconButton
                                                size="small"
                                                onClick={() => handleBaseLoadCancel(row.user_id)}
                                                disabled={isSaving}
                                              >
                                                <CloseIcon fontSize="small" />
                                              </IconButton>
                                            </Box>
                                          ) : (
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                              <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
                                                {currentBaseLoad.toFixed(1)}h
                                              </Typography>
                                              <IconButton
                                                size="small"
                                                onClick={() => handleBaseLoadEdit(row.user_id)}
                                              >
                                                <EditIcon fontSize="small" />
                                              </IconButton>
                                            </Box>
                                          )}
                                        </Box>
                                      </Grid>
                                    </Grid>

                                    {/* 週内日別 */}
                                    {row.daily_breakdown && row.daily_breakdown.length > 0 && (
                                      <>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', mb: 1 }}>
                                          週内日別
                                        </Typography>
                                        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, mb: 1 }}>
                                          {row.daily_breakdown.map((day: { date: string; assigned_hours: number; free_hours: number }) => {
                                            const a = day.assigned_hours;
                                            const f = day.free_hours;
                                            const isToday = day.date === todayIso;
                                            const d = new Date(day.date + 'T12:00:00');
                                            const weekDayNames = ['日', '月', '火', '水', '木', '金', '土'];
                                            const label = weekDayNames[d.getDay()];
                                            const busyRatio = Math.min(1, a / hoursPerDay);
                                            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                                            const bgColor = isWeekend ? 'grey.100' : busyRatio >= 0.9 ? 'error.light' : busyRatio >= 0.5 ? 'warning.light' : 'success.light';
                                            const barHeight = `${Math.max(10, busyRatio * 100)}%`;
                                            return (
                                              <Box key={day.date} sx={{ px: 0.3, py: 0.5, borderRadius: 1, textAlign: 'center', fontVariantNumeric: 'tabular-nums', bgcolor: 'background.paper', border: '1px solid', borderColor: isToday ? 'primary.main' : 'divider', boxShadow: isToday ? 1 : 0 }} title={`${day.date}（${label}）割当 ${a.toFixed(1)}h / 空き ${f.toFixed(1)}h`}>
                                                <Typography variant="caption" sx={{ fontSize: '0.65rem', fontWeight: isToday ? 700 : 500, color: isWeekend ? 'text.disabled' : 'text.secondary', display: 'block' }}>{label}</Typography>
                                                <Box sx={{ mt: 0.3, mb: 0.3, height: 20, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                                                  <Box sx={{ width: '70%', borderRadius: 0.5, bgcolor: bgColor, height: barHeight, transition: 'height 0.2s ease' }} />
                                                </Box>
                                                <Typography variant="caption" sx={{ display: 'block', fontSize: '0.6rem', color: 'text.secondary' }}>{a.toFixed(1)}h</Typography>
                                              </Box>
                                            );
                                          })}
                                        </Box>
                                      </>
                                    )}
                                  </CardContent>
                                </Card>
                              );
                            })}
                          </Box>
                        ) : (
                          // PC: テーブル形式で表示
                          <TableContainer sx={{ overflowX: 'auto', maxWidth: '100%' }}>
                            <Table size="small" stickyHeader>
                              <TableHead>
                                <TableRow>
                                  <TableCell sx={{ fontWeight: 600, backgroundColor: 'background.paper', fontSize: '0.875rem', px: 2 }}>ユーザー</TableCell>
                                  <TableCell align="right" sx={{ fontWeight: 600, backgroundColor: 'background.paper', fontSize: '0.875rem', px: 2 }}>今週のコスト割当</TableCell>
                                  <TableCell align="right" sx={{ fontWeight: 600, backgroundColor: 'background.paper', whiteSpace: 'nowrap', width: 180, fontSize: '0.875rem', px: 2 }}>定常業務</TableCell>
                                  <TableCell sx={{ fontWeight: 600, backgroundColor: 'background.paper', minWidth: 300, fontSize: '0.875rem', px: 2 }}>週内日別</TableCell>
                                  <TableCell align="right" sx={{ fontWeight: 600, backgroundColor: 'background.paper', whiteSpace: 'nowrap', fontSize: '0.875rem', px: 2 }}>稼働率</TableCell>
                                  <TableCell align="right" sx={{ fontWeight: 600, backgroundColor: 'background.paper', whiteSpace: 'nowrap', fontSize: '0.875rem', px: 2 }}>残キャパシティ</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {rows.map((row) => {
                                  const todayIso = new Date().toISOString().slice(0, 10);
                                  const utilization = maxHoursPerWeek > 0 ? (row.assigned_hours / maxHoursPerWeek) * 100 : 0;
                                  const isEditingBaseLoad = editingBaseLoad.hasOwnProperty(row.user_id);
                                  const currentBaseLoad = isEditingBaseLoad ? editingBaseLoad[row.user_id] : (row.base_load_hours_per_week ?? 0);
                                  const isSaving = savingBaseLoad[row.user_id] || false;

                                  const handleBaseLoadEdit = async (userId: number) => {
                                    if (isEditingBaseLoad) {
                                      setSavingBaseLoad(prev => ({ ...prev, [userId]: true }));
                                      try {
                                        await api.put(`/api/users/${userId}`, {
                                          base_load_hours_per_week: currentBaseLoad
                                        });
                                        setEditingBaseLoad(prev => {
                                          const newState = { ...prev };
                                          delete newState[userId];
                                          return newState;
                                        });
                                        setSnackbar({
                                          open: true,
                                          message: '定常業務を更新しました',
                                          severity: 'success'
                                        });
                                        await fetchWeeklyAvailability();
                                      } catch (error: any) {
                                        console.error('Failed to update base load:', error);
                                        setSnackbar({
                                          open: true,
                                          message: '定常業務の更新に失敗しました',
                                          severity: 'error'
                                        });
                                      } finally {
                                        setSavingBaseLoad(prev => {
                                          const newState = { ...prev };
                                          delete newState[userId];
                                          return newState;
                                        });
                                      }
                                    } else {
                                      setEditingBaseLoad(prev => ({
                                        ...prev,
                                        [userId]: row.base_load_hours_per_week ?? 0
                                      }));
                                    }
                                  };

                                  const handleBaseLoadCancel = (userId: number) => {
                                    setEditingBaseLoad(prev => {
                                      const newState = { ...prev };
                                      delete newState[userId];
                                      return newState;
                                    });
                                  };

                                  return (
                                    <TableRow key={row.user_id} hover sx={{ '& > td': { verticalAlign: 'middle' } }}>
                                      <TableCell component="th" scope="row" sx={{ fontWeight: 500, fontSize: '0.875rem', px: 2 }}>{row.user_name}</TableCell>
                                      <TableCell align="right" sx={{ fontSize: '0.875rem', px: 2 }}>{row.assigned_hours.toFixed(1)}</TableCell>
                                      <TableCell align="right" sx={{ whiteSpace: 'nowrap', width: 180, px: 2 }}>
                                        {isEditingBaseLoad ? (
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'flex-end' }}>
                                            <TextField
                                              type="number"
                                              value={currentBaseLoad}
                                              onChange={(e) => {
                                                const value = parseFloat(e.target.value) || 0;
                                                setEditingBaseLoad(prev => ({
                                                  ...prev,
                                                  [row.user_id]: Math.max(0, Math.min(40, value))
                                                }));
                                              }}
                                              size="small"
                                              inputProps={{ step: 0.5, min: 0, max: 40 }}
                                              sx={{ width: 80 }}
                                              disabled={isSaving}
                                            />
                                            <IconButton
                                              size="small"
                                              onClick={() => handleBaseLoadEdit(row.user_id)}
                                              disabled={isSaving}
                                              color="primary"
                                            >
                                              <CheckIcon fontSize="small" />
                                            </IconButton>
                                            <IconButton
                                              size="small"
                                              onClick={() => handleBaseLoadCancel(row.user_id)}
                                              disabled={isSaving}
                                            >
                                              <CloseIcon fontSize="small" />
                                            </IconButton>
                                          </Box>
                                        ) : (
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'flex-end' }}>
                                            <Typography variant="body2">{currentBaseLoad.toFixed(1)}h</Typography>
                                            <IconButton
                                              size="small"
                                              onClick={() => handleBaseLoadEdit(row.user_id)}
                                            >
                                              <EditIcon fontSize="small" />
                                            </IconButton>
                                          </Box>
                                        )}
                                      </TableCell>
                                      <TableCell sx={{ py: 0.75, px: 2 }}>
                                        {row.daily_breakdown && row.daily_breakdown.length > 0 ? (
                                          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 68px)', gap: 0.6, alignItems: 'stretch', justifyContent: 'start' }}>
                                            {row.daily_breakdown.map((day: { date: string; assigned_hours: number; free_hours: number }) => {
                                              const a = day.assigned_hours;
                                              const f = day.free_hours;
                                              const isToday = day.date === todayIso;
                                              const d = new Date(day.date + 'T12:00:00');
                                              const weekDayNames = ['日', '月', '火', '水', '木', '金', '土'];
                                              const label = weekDayNames[d.getDay()];
                                              const busyRatio = Math.min(1, a / hoursPerDay);
                                              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                                              const bgColor = isWeekend ? 'grey.100' : busyRatio >= 0.9 ? 'error.light' : busyRatio >= 0.5 ? 'warning.light' : 'success.light';
                                              const barHeight = `${Math.max(10, busyRatio * 100)}%`;
                                              return (
                                                <Box key={day.date} sx={{ px: 0.4, py: 0.4, borderRadius: 1, minWidth: 68, textAlign: 'center', fontVariantNumeric: 'tabular-nums', bgcolor: 'background.paper', border: '1px solid', borderColor: isToday ? 'primary.main' : 'divider', boxShadow: isToday ? 1 : 0 }} title={`${day.date}（${label}）割当 ${a.toFixed(1)}h / 空き ${f.toFixed(1)}h`}>
                                                  <Typography variant="caption" sx={{ fontSize: '0.7rem', fontWeight: isToday ? 700 : 500, color: isWeekend ? 'text.disabled' : 'text.secondary' }}>{label}</Typography>
                                                  <Box sx={{ mt: 0.3, mb: 0.3, height: 24, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                                                    <Box sx={{ width: '65%', borderRadius: 0.5, bgcolor: bgColor, height: barHeight, transition: 'height 0.2s ease' }} />
                                                  </Box>
                                                  <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem', color: 'text.secondary' }}>{a.toFixed(1)}h</Typography>
                                                </Box>
                                              );
                                            })}
                                          </Box>
                                        ) : (
                                          <Typography variant="caption" color="text.secondary">—</Typography>
                                        )}
                                      </TableCell>
                                      <TableCell align="right" sx={{ px: 2 }}>
                                        <Typography variant="body2" sx={{ color: utilization >= 100 ? 'error.main' : utilization >= 80 ? 'warning.main' : 'text.primary', fontSize: '0.875rem' }}>{utilization.toFixed(1)}%</Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>{row.assigned_hours.toFixed(1)}h / {maxHoursPerWeek}h</Typography>
                                      </TableCell>
                                      <TableCell align="right" sx={{ px: 2 }}>
                                        <Typography variant="body2" sx={{ color: row.free_hours > 0 ? 'success.main' : 'text.secondary', fontSize: '0.875rem' }}>{row.free_hours.toFixed(1)} h</Typography>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        )}
                      </>
                    );
                  })()}
                  {!weeklyAvailabilityLoading && !weeklyAvailability && (
                    <Typography variant="body2" color="text.secondary">データを取得できませんでした。「更新」を押して再試行してください。</Typography>
                  )}
                  {!weeklyAvailabilityLoading && weeklyAvailability && (
                    <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 14, height: 10, borderRadius: 0.5, bgcolor: 'error.light', border: '1px solid', borderColor: 'error.main' }} />
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                          ほぼフル稼働（8h 近く割当）
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 14, height: 10, borderRadius: 0.5, bgcolor: 'warning.light', border: '1px solid', borderColor: 'warning.main' }} />
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                          普通の稼働
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 14, height: 10, borderRadius: 0.5, bgcolor: 'success.light', border: '1px solid', borderColor: 'success.main' }} />
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                          余裕あり
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 14, height: 10, borderRadius: 0.5, bgcolor: 'background.paper', border: '2px solid', borderColor: 'primary.main' }} />
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                          本日
                        </Typography>
                      </Box>
                    </Box>
                  )}
                </Paper>

                {/* タスク内訳（今週が期間内のタスクのみ） */}
                <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, mb: 3 }}>
                  <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, fontSize: { xs: '1rem', sm: '1.25rem' } }}>今週のタスク内訳</Typography>
                  {weeklyAvailabilityLoading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
                  )}
                  {!weeklyAvailabilityLoading && weeklyAvailability && (
                    (() => {
                      const taskRows = weeklyAvailability.users.flatMap((u) =>
                        (u.tasks ?? [])
                          .filter((t) => t.overlaps_week)
                          .map((t) => ({ ...t, user_id: u.user_id, user_name: u.user_name }))
                      );
                      if (taskRows.length === 0) {
                        return <Typography color="text.secondary" variant="body2">今週が期間内のタスクはありません。</Typography>;
                      }
                      return isMobile ? (
                        // モバイル: カード形式で表示
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                          {taskRows.map((t) => {
                            const weekdays = t.total_weekdays != null ? t.total_weekdays : calculateWeekdaysInRange(t.start_date, t.due_date);
                            return (
                              <Card
                                key={`${t.user_id}-${t.task_id}`}
                                variant="outlined"
                                onClick={() => handleWeeklyTaskRowDoubleClick({
                                  task_id: t.task_id,
                                  task_name: t.task_name,
                                  cost: t.cost,
                                  start_date: t.start_date,
                                  due_date: t.due_date,
                                })}
                                sx={{ cursor: 'pointer', '&:hover': { boxShadow: 2 } }}
                              >
                                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                      <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: '0.9rem', mb: 0.5, overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.task_name}>
                                        {t.task_name || '—'}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                                        {t.user_name || `User ${t.user_id}`}
                                      </Typography>
                                    </Box>
                                    <Chip
                                      label={`${t.cost.toFixed(1)}h`}
                                      size="small"
                                      color="primary"
                                      sx={{ fontWeight: 600, fontSize: '0.75rem', height: 24, ml: 1 }}
                                    />
                                  </Box>
                                  <Divider sx={{ my: 1 }} />
                                  <Grid container spacing={1.5}>
                                    <Grid item xs={6}>
                                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', mb: 0.25 }}>
                                        期日
                                      </Typography>
                                      <Typography variant="body2" sx={{ fontSize: '0.85rem', fontWeight: 500 }}>
                                        {t.due_date ? new Date(t.due_date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) : '—'}
                                      </Typography>
                                    </Grid>
                                    {t.start_date && (
                                      <Grid item xs={6}>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', mb: 0.25 }}>
                                          開始
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.85rem', fontWeight: 500 }}>
                                          {new Date(t.start_date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                                        </Typography>
                                      </Grid>
                                    )}
                                    {weekdays != null && (
                                      <Grid item xs={6}>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', mb: 0.25 }}>
                                          平日日数
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.85rem', fontWeight: 500 }}>
                                          {weekdays.toLocaleString()}日
                                        </Typography>
                                      </Grid>
                                    )}
                                    {t.hours_per_weekday != null && (
                                      <Grid item xs={6}>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', mb: 0.25 }}>
                                          1日あたり
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.85rem', fontWeight: 500 }}>
                                          {t.hours_per_weekday.toFixed(1)}h
                                        </Typography>
                                      </Grid>
                                    )}
                                  </Grid>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </Box>
                      ) : (
                        // PC: テーブル形式で表示
                        <TableContainer sx={{ overflowX: 'auto', maxWidth: '100%' }}>
                          <Table size="small" stickyHeader>
                            <TableHead>
                              <TableRow>
                                <TableCell sx={{ fontWeight: 600, backgroundColor: 'background.paper', fontSize: '0.875rem', px: 2 }}>ユーザー</TableCell>
                                <TableCell sx={{ fontWeight: 600, backgroundColor: 'background.paper', fontSize: '0.875rem', px: 2 }}>タスク名</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 600, backgroundColor: 'background.paper', fontSize: '0.875rem', px: 2 }}>コスト</TableCell>
                                <TableCell sx={{ fontWeight: 600, backgroundColor: 'background.paper', fontSize: '0.875rem', px: 2 }}>開始</TableCell>
                                <TableCell sx={{ fontWeight: 600, backgroundColor: 'background.paper', fontSize: '0.875rem', px: 2 }}>期日</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 600, backgroundColor: 'background.paper', fontSize: '0.875rem', px: 2 }}>期間内平日日数</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 600, backgroundColor: 'background.paper', fontSize: '0.875rem', px: 2 }}>1日あたりのコスト</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {taskRows.map((t) => (
                                <TableRow
                                  key={`${t.user_id}-${t.task_id}`}
                                  hover
                                  onDoubleClick={() =>
                                    handleWeeklyTaskRowDoubleClick({
                                      task_id: t.task_id,
                                      task_name: t.task_name,
                                      cost: t.cost,
                                      start_date: t.start_date,
                                      due_date: t.due_date,
                                    })
                                  }
                                  sx={{ cursor: 'pointer' }}
                                >
                                  <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.875rem', px: 2 }}>{t.user_name || `User ${t.user_id}`}</TableCell>
                                  <TableCell sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.875rem', px: 2 }} title={t.task_name}>{t.task_name || '—'}</TableCell>
                                  <TableCell align="right" sx={{ fontSize: '0.875rem', px: 2 }}>{t.cost.toFixed(1)}</TableCell>
                                  <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.875rem', px: 2 }}>{t.start_date ?? '—'}</TableCell>
                                  <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.875rem', px: 2 }}>{t.due_date ?? '—'}</TableCell>
                                  <TableCell align="right" sx={{ fontSize: '0.875rem', px: 2 }}>
                                    {(() => {
                                      const weekdays =
                                        t.total_weekdays != null
                                          ? t.total_weekdays
                                          : calculateWeekdaysInRange(t.start_date, t.due_date);
                                      return weekdays != null ? weekdays.toLocaleString() : '—';
                                    })()}
                                  </TableCell>
                                  <TableCell align="right" sx={{ fontSize: '0.875rem', px: 2 }}>{t.hours_per_weekday != null ? t.hours_per_weekday.toFixed(1) : '—'}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      );
                    })()
                  )}
                  {!weeklyAvailabilityLoading && !weeklyAvailability && (
                    <Typography variant="body2" color="text.secondary">データを取得できませんでした。「更新」を押して再試行してください。</Typography>
                  )}
                </Paper>

                {/* 今週の合計工数（リソース・スタックバー）— 全員を表示、棒クリックでタスク内訳 */}
                {!weeklyAvailabilityLoading && weeklyAvailability && (() => {
                  const allMembers = users.filter(u => u.role !== 'admin');
                  const byId = new Map(weeklyAvailability.users.map(u => [u.user_id, u]));
                  const reportUsers = allMembers.map(m => {
                    const w = byId.get(m.id);
                    return w
                      ? { user_id: w.user_id, user_name: w.user_name, assigned_hours: w.assigned_hours, free_hours: w.free_hours, tasks: w.tasks ?? [] }
                      : { user_id: m.id, user_name: m.full_name || m.username || `User ${m.id}`, assigned_hours: 0, free_hours: 40, tasks: [] };
                  });

                  const d = new Date(weeklyAvailability.week_start);
                  const end = new Date(d);
                  end.setDate(d.getDate() + 6);
                  const dateRangeStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;

                  return (
                    <Box sx={{ mt: 2 }}>
                      <ResourceStackBar
                        users={reportUsers}
                        maxHoursPerWeek={40}
                        title={`リソース・スタックバー（週合計工数: ${dateRangeStr}）`}
                      />
                    </Box>
                  );
                })()}
              </Box>
            )}

            {/* タブ6: 工数集計 — 期間指定の集計レポート */}
            {selectedTab === 6 && (
              <Box sx={{ p: { xs: 1, sm: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600, fontSize: { xs: '0.95rem', sm: '1rem' } }}>工数集計レポート</Typography>
                    <Tooltip title="1日8時間基準。時間・日単位で表示。" placement="top" arrow>
                      <HelpOutlineIcon sx={{ fontSize: { xs: 16, sm: 18 }, color: 'text.secondary' }} />
                    </Tooltip>
                  </Box>
                  {!laborReportLoading && laborReportData.length > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>
                      対象{laborReportGroupBy === 'user' ? '担当者' : 'プロジェクト'} {laborReportSummary.groupCount.toLocaleString()} 件 / 工数 {laborReportSummary.totalHours.toLocaleString(undefined, { maximumFractionDigits: 1 })} h
                    </Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, flexWrap: 'wrap', gap: { xs: 1.5, sm: 2 }, mb: 1.5 }}>
                  <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 140 } }}>
                    <InputLabel>集計単位</InputLabel>
                    <Select value={laborReportGroupBy} label="集計単位" onChange={(e) => setLaborReportGroupBy(e.target.value as 'user' | 'project')}>
                      <MenuItem value="user">担当者別</MenuItem>
                      <MenuItem value="project">プロジェクト別</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField size="small" label="開始日" type="date" value={laborReportFrom} onChange={(e) => setLaborReportFrom(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: { xs: '100%', sm: 160 } }} />
                  <TextField size="small" label="終了日" type="date" value={laborReportTo} onChange={(e) => setLaborReportTo(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: { xs: '100%', sm: 160 } }} />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={laborReportIncludeOffline}
                        onChange={(e) => setLaborReportIncludeOffline(e.target.checked)}
                        size="small"
                      />
                    }
                    label={isMobile ? "オフライン含む" : "オフラインのプロジェクトを含める"}
                    sx={{ fontSize: { xs: '0.8rem', sm: '0.875rem' } }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={laborReportIncludeCompleted}
                        onChange={(e) => setLaborReportIncludeCompleted(e.target.checked)}
                        size="small"
                      />
                    }
                    label={isMobile ? "完了含む" : "完了タスクを含める"}
                    sx={{ fontSize: { xs: '0.8rem', sm: '0.875rem' } }}
                  />
                  <Button variant="contained" onClick={fetchLaborReport} disabled={laborReportLoading} size={isMobile ? "small" : "medium"} sx={{ width: { xs: '100%', sm: 'auto' } }}>{laborReportLoading ? '取得中...' : '取得'}</Button>
                </Box>
                {!laborReportLoading && laborReportData.length > 0 && (
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
                      gap: 1.5,
                      mb: 2,
                    }}
                  >
                    <Paper variant="outlined" sx={{ px: 1.5, py: 0.75, borderRadius: 1.5, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>総工数（時間）</Typography>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700, fontSize: '0.95rem' }}>{laborReportSummary.totalHours.toLocaleString(undefined, { maximumFractionDigits: 1 })} h</Typography>
                    </Paper>
                    <Paper variant="outlined" sx={{ px: 1.5, py: 0.75, borderRadius: 1.5, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>総工数（日換算）</Typography>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700, fontSize: '0.95rem' }}>{laborReportSummary.totalDays.toLocaleString(undefined, { maximumFractionDigits: 2 })} 日</Typography>
                    </Paper>
                    <Paper variant="outlined" sx={{ px: 1.5, py: 0.75, borderRadius: 1.5, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>対象{laborReportGroupBy === 'user' ? '担当者数' : 'プロジェクト数'}</Typography>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700, fontSize: '0.95rem' }}>{laborReportSummary.groupCount.toLocaleString()}</Typography>
                    </Paper>
                    <Paper variant="outlined" sx={{ px: 1.5, py: 0.75, borderRadius: 1.5, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>1{laborReportGroupBy === 'user' ? '人' : '件'}あたり平均工数</Typography>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700, fontSize: '0.95rem' }}>{laborReportSummary.avgHoursPerGroup.toLocaleString(undefined, { maximumFractionDigits: 1 })} h</Typography>
                    </Paper>
                  </Box>
                )}
                {laborReportLoading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={24} /></Box>}
                {!laborReportLoading && laborReportData.length > 0 && (
                  isMobile ? (
                    // モバイル: カード形式で表示
                    <>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        {laborReportData.map((row) => {
                          const totalCostHours = row.total_cost;
                          const totalCostDays = totalCostHours / 8;
                          return (
                            <Card key={row.group_id} variant="outlined">
                              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: '0.9rem', mb: 1.5 }}>
                                  {row.group_name}
                                </Typography>
                                <Divider sx={{ my: 1 }} />
                                <Grid container spacing={1.5}>
                                  <Grid item xs={6}>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', mb: 0.25 }}>
                                      工数（時間）
                                    </Typography>
                                    <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1rem' }}>
                                      {totalCostHours.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                                    </Typography>
                                  </Grid>
                                  <Grid item xs={6}>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', mb: 0.25 }}>
                                      工数（日）
                                    </Typography>
                                    <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1rem' }}>
                                      {totalCostDays.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                    </Typography>
                                  </Grid>
                                  <Grid item xs={12}>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', mb: 0.25 }}>
                                      タスク数
                                    </Typography>
                                    <Chip
                                      label={row.task_count}
                                      size="small"
                                      sx={{ fontWeight: 600, fontSize: '0.75rem' }}
                                    />
                                  </Grid>
                                </Grid>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </Box>
                      {/* 合計カード */}
                      <Card variant="outlined" sx={{ mt: 1.5, bgcolor: 'action.hover' }}>
                        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.9rem', mb: 1.5 }}>
                            合計
                          </Typography>
                          <Divider sx={{ my: 1 }} />
                          <Grid container spacing={1.5}>
                            <Grid item xs={6}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', mb: 0.25 }}>
                                工数（時間）
                              </Typography>
                              <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1rem' }}>
                                {laborReportData.reduce((sum, row) => sum + row.total_cost, 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                              </Typography>
                            </Grid>
                            <Grid item xs={6}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', mb: 0.25 }}>
                                工数（日）
                              </Typography>
                              <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1rem' }}>
                                {(laborReportData.reduce((sum, row) => sum + row.total_cost, 0) / 8).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </Typography>
                            </Grid>
                            <Grid item xs={12}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', mb: 0.25 }}>
                                タスク数
                              </Typography>
                              <Chip
                                label={laborReportData.reduce((sum, row) => sum + row.task_count, 0)}
                                size="small"
                                sx={{ fontWeight: 700, fontSize: '0.75rem' }}
                              />
                            </Grid>
                          </Grid>
                        </CardContent>
                      </Card>
                    </>
                  ) : (
                    // PC: テーブル形式で表示
                    <TableContainer
                      component={Paper}
                      variant="outlined"
                      sx={{
                        maxWidth: '100%',
                        overflowX: 'auto',
                        '& .MuiTableCell-root': {
                          fontSize: '0.78rem',
                          py: 0.7,
                          px: 2
                        },
                        '& .MuiTableHead-root .MuiTableCell-root': {
                          fontWeight: 600,
                          bgcolor: (theme) => theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[100],
                          fontSize: '0.78rem',
                        },
                      }}
                    >
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell>{laborReportGroupBy === 'user' ? '担当者' : 'プロジェクト'}</TableCell>
                            <TableCell align="right">工数合計（時間）</TableCell>
                            <TableCell align="right">工数合計（日）</TableCell>
                            <TableCell align="right">タスク数</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {laborReportData.map((row) => {
                            const totalCostHours = row.total_cost;
                            const totalCostDays = totalCostHours / 8;
                            return (
                              <TableRow key={row.group_id}>
                                <TableCell sx={{ fontSize: '0.78rem' }}>{row.group_name}</TableCell>
                                <TableCell align="right">{totalCostHours.toLocaleString(undefined, { maximumFractionDigits: 1 })}</TableCell>
                                <TableCell align="right">{totalCostDays.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                                <TableCell align="right">{row.task_count}</TableCell>
                              </TableRow>
                            );
                          })}
                          {laborReportData.length > 0 && (
                            <TableRow sx={{ backgroundColor: 'action.hover', fontWeight: 'bold' }}>
                              <TableCell sx={{ fontWeight: 'bold', fontSize: '0.78rem' }}>合計</TableCell>
                              <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '0.78rem' }}>{laborReportData.reduce((sum, row) => sum + row.total_cost, 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</TableCell>
                              <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '0.78rem' }}>{(laborReportData.reduce((sum, row) => sum + row.total_cost, 0) / 8).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                              <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '0.78rem' }}>{laborReportData.reduce((sum, row) => sum + row.task_count, 0)}</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )
                )}
                {!laborReportLoading && laborReportData.length === 0 && laborReportFrom === '' && laborReportTo === '' && (
                  <Typography color="text.secondary">「取得」をクリックして工数集計を表示します。</Typography>
                )}
                {!laborReportLoading && laborReportData.length === 0 && (laborReportFrom !== '' || laborReportTo !== '') && (
                  <Typography color="text.secondary">該当データがありません。</Typography>
                )}
              </Box>
            )}
          </Box>
        </Paper>
      </Box>

      {/* 今週のタスク内訳 編集（共通タスク編集ダイアログ） */}
      <TaskEditDialog
        open={editWeeklyTaskId != null}
        taskId={editWeeklyTaskId}
        onClose={() => setEditWeeklyTaskId(null)}
        onSaved={() => {
          setEditWeeklyTaskId(null);
          setSnackbar({ open: true, message: 'タスクを更新しました。', severity: 'success' });
          fetchWeeklyAvailability();
        }}
      />

      {/* 共通スナックバー */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <MuiAlert
          onClose={handleSnackbarClose}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
          elevation={6}
          variant="filled"
        >
          {snackbar.message}
        </MuiAlert>
      </Snackbar>

      {/* モバイル用フィルタードロワー */}
      <Drawer
        anchor="bottom"
        open={mobileFilterOpen}
        onClose={() => setMobileFilterOpen(false)}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: '80vh',
            p: 2,
          }
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
            フィルター
          </Typography>
          <IconButton onClick={() => setMobileFilterOpen(false)} sx={{ minWidth: 48, minHeight: 48 }}>
            <CloseIcon />
          </IconButton>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <FormControl size="medium" fullWidth>
            <InputLabel id="mobile-date-range-label">期間</InputLabel>
            <Select labelId="mobile-date-range-label" value={dateRange} label="期間" onChange={handleDateRangeChange}>
              <MenuItem value="all">全期間</MenuItem>
              <MenuItem value="week">直近1週間</MenuItem>
              <MenuItem value="month">直近1ヶ月</MenuItem>
              <MenuItem value="quarter">直近3ヶ月</MenuItem>
            </Select>
          </FormControl>
          <Autocomplete
            size="medium"
            options={projectFilterOptions}
            getOptionLabel={(p) => p.name}
            value={projectFilterOptions.find(p => p.name === projectNameFilter) ?? null}
            onChange={(_e, newValue) => setProjectNameFilter(newValue?.name ?? null)}
            fullWidth
            renderInput={(params) => <TextField {...params} label="プロジェクト名" />}
            renderOption={(props, project) => (
              <li {...props} key={project.id} style={{ minHeight: 44 }}>
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                  <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: project.display_status === 'online' ? '#4CAF50' : '#9E9E9E', flexShrink: 0 }} />
                  {project.name}
                </Box>
              </li>
            )}
          />
          <FormControl size="medium" fullWidth>
            <InputLabel id="mobile-project-status-label">プロジェクト状態</InputLabel>
            <Select labelId="mobile-project-status-label" value={statusFilter} label="プロジェクト状態" onChange={handleStatusFilterChange}>
              <MenuItem value="all">すべて</MenuItem>
              {projectStatusOptions.map(status => (<MenuItem key={status} value={status}>{status}</MenuItem>))}
            </Select>
          </FormControl>
          <Button
            variant="contained"
            onClick={() => {
              handleClearFilters();
              setMobileFilterOpen(false);
            }}
            sx={{ mt: 1, minHeight: 48 }}
          >
            フィルターをクリア
          </Button>
        </Box>
      </Drawer>
    </Box>
  );
};

export default MetricsPage;