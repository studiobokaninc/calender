import React, { useState, useEffect, useMemo, useCallback } from 'react'; //Reactとは、フロントエンドのUIを作成するためのライブラリです。
import { Box, Typography, Paper, CircularProgress, Alert, FormControl, InputLabel, Select, MenuItem, SelectChangeEvent, Tab, Tabs, Button, TextField, Autocomplete, FormGroup, FormControlLabel, Checkbox, Table, TableBody, TableCell, TableHead, TableRow, TableContainer, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Snackbar, Alert as MuiAlert } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import api from '../services/api'; //apiとは、バックエンドのAPIを呼び出すためのライブラリです。
import { Project, Task, User } from '../types'; //Projectとは、プロジェクトの情報を管理する型です。Taskとは、タスクの情報を管理する型です。Userとは、ユーザーの情報を管理する型です。
import ProjectProgressChart from '../components/ProjectProgressChart'; //ProjectProgressChartとは、プロジェクトの進捗を表示するコンポーネントです。
import AssigneeLoadChart from '../components/AssigneeLoadChart'; //AssigneeLoadChartとは、メンバーの負荷を表示するコンポーネントです。
import DelayedTaskList from '../components/DelayedTaskList'; //DelayedTaskListとは、遅れているタスクを表示するコンポーネントです。
import UserProgressChart from '../components/UserProgressChart'; //UserProgressChartとは、ユーザーの進捗を表示するコンポーネントです。
import GanttView from '../components/GanttView'; //GanttViewとは、ガントチャートを表示するコンポーネントです。
import ErrorBoundary from '../components/ErrorBoundary'; //ErrorBoundaryとは、エラーを表示するコンポーネントです。
import ResourceStackBar from '../components/ResourceStackBar';
import { useLocation, useNavigate } from 'react-router-dom'; //useLocationとは、現在のURLを取得するための関数です。useNavigateとは、ページを遷移するための関数です。
import { useMetricsPageState } from '../contexts/PageStateContext'; //PageStateContextとは、ページの状態を管理するコンテキストです。
//コンポーネントとは、フロントエンドのUIを作成するための部品です。他のコードで作成した関数を呼び出して、UIを作成します。
const MetricsPage: React.FC = () => { //MetricsPageとは、メトリクスページを表示するコンポーネントです。
  console.log("--- Rendering MetricsPage Component ---");

  const location = useLocation(); //locationとは、現在のURLを取得するための関数です。
  const navigate = useNavigate(); //navigateとは、ページを遷移するための関数です。

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
  // 日次余裕時間（その日に暇なユーザー）
  // 「今週のタスク内訳」編集用
  const [editWeeklyTaskDialogOpen, setEditWeeklyTaskDialogOpen] = useState(false);
  const [editWeeklyTaskSaving, setEditWeeklyTaskSaving] = useState(false);
  const [editWeeklyTaskError, setEditWeeklyTaskError] = useState<string | null>(null);
  const [editWeeklyTaskForm, setEditWeeklyTaskForm] = useState<{
    task_id: number;
    task_name: string;
    cost: number;
    start_date: string | null;
    due_date: string | null;
  } | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info' | 'warning';
  }>({
    open: false,
    message: '',
    severity: 'info',
  });

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

  // display_status オプションの準備（オフラインは選択不可のため一覧から除外）
  const projectDisplayStatusOptions = useMemo(() => {
    const displayStatuses = new Set<string>();
    projects.forEach(project => {
      if (project.display_status && project.display_status !== 'offline') {
        displayStatuses.add(project.display_status);
      }
    });
    return Array.from(displayStatuses);
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

    // プロジェクトの display_status でフィルタリング (プロジェクトリストを絞る)
    if (selectedDisplayStatuses.length > 0) {
      tempProjects = tempProjects.filter(project => 
        project.display_status && selectedDisplayStatuses.includes(project.display_status)
      );
    }
    
    const filteredProjectIds = tempProjects.map(project => String(project.id));

    // 絞り込まれたプロジェクトIDに基づいてタスクをフィルタリング（オフライン除外を含むため常に適用）
    result = result.filter(task => task.project_id && filteredProjectIds.includes(String(task.project_id)));
    
    // 日付でフィルタリング (最後に適用)
    if (dateRange !== 'all') {
      const now = new Date();
      let startDate: Date;
      
      switch(dateRange) {
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
    // プロジェクトの display_status でフィルタリング
    if (selectedDisplayStatuses.length > 0) {
      result = result.filter(project => 
        project.display_status && selectedDisplayStatuses.includes(project.display_status)
      );
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
      const weekday = now.getDay();
      const monOffset = weekday === 0 ? -6 : 1 - weekday;
      const monday = new Date(now);
      monday.setDate(now.getDate() + monOffset);
      const localMonday = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
      const params: Record<string, string | boolean> = {
        reference_date: localToday,
        week_start: localMonday,
        only_free: false,
        include_offline: false,
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
  }, []);

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
  const handleWeeklyTaskRowDoubleClick = (task: {
    task_id: number;
    task_name: string;
    cost: number;
    start_date: string | null;
    due_date: string | null;
  }) => {
    setEditWeeklyTaskForm({
      task_id: task.task_id,
      task_name: task.task_name,
      cost: task.cost,
      start_date: task.start_date,
      due_date: task.due_date,
    });
    setEditWeeklyTaskError(null);
    setEditWeeklyTaskDialogOpen(true);
  };

  const handleWeeklyTaskInputChange = (field: 'task_name' | 'cost' | 'start_date' | 'due_date', value: string) => {
    setEditWeeklyTaskForm((prev) => {
      if (!prev) return prev;
      if (field === 'cost') {
        const num = Number(value);
        return { ...prev, cost: isNaN(num) ? prev.cost : num };
      }
      if (field === 'start_date' || field === 'due_date') {
        return { ...prev, [field]: value || null };
      }
      return { ...prev, [field]: value };
    });
  };

  const handleWeeklyTaskDialogClose = () => {
    if (editWeeklyTaskSaving) return;
    setEditWeeklyTaskDialogOpen(false);
    setEditWeeklyTaskForm(null);
    setEditWeeklyTaskError(null);
  };

  const handleSnackbarClose = () => {
    setSnackbar((prev) => ({ ...prev, open: false }));
  };

  // 「今週のタスク内訳」編集内容を保存
  const handleWeeklyTaskSave = async () => {
    if (!editWeeklyTaskForm) return;
    const { task_id, task_name, cost, start_date, due_date } = editWeeklyTaskForm;
    if (!task_name.trim()) {
      setEditWeeklyTaskError('タスク名を入力してください。');
      return;
    }
    if (!start_date || !due_date) {
      setEditWeeklyTaskError('開始日と期日を入力してください。');
      return;
    }
    setEditWeeklyTaskSaving(true);
    setEditWeeklyTaskError(null);
    try {
      await api.put(`/tasks/${task_id}`, {
        name: task_name,
        cost,
        start_date,
        due_date,
      });
      setSnackbar({
        open: true,
        message: 'タスクを更新しました。',
        severity: 'success',
      });
      setEditWeeklyTaskDialogOpen(false);
      setEditWeeklyTaskForm(null);
      // 更新後に今週の割り当てを再取得して反映
      await fetchWeeklyAvailability();
    } catch (err: any) {
      const message =
        err?.response?.data?.detail ||
        err?.message ||
        'タスクの更新に失敗しました。';
      setEditWeeklyTaskError(message);
      setSnackbar({
        open: true,
        message,
        severity: 'error',
      });
    } finally {
      setEditWeeklyTaskSaving(false);
    }
  };

  const handleDateRangeChange = (event: SelectChangeEvent) => {
    setDateRange(event.target.value);
  };

  const handleStatusFilterChange = (event: SelectChangeEvent) => {
    setStatusFilter(event.target.value);
  };

  const handleDisplayStatusChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = event.target;
    setSelectedDisplayStatuses(prev => 
      checked ? [...prev, name] : prev.filter(status => status !== name)
    );
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
        p: 2, 
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
      <Box sx={{ flexShrink: 0, width: '100%', mb: 1.5 }}>
            <Paper sx={{ p: 2 }}>
               <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                 <Typography variant="h6" sx={{ fontSize: '1rem' }}>プロジェクトメトリクス</Typography>
                 <Button variant="outlined" size="small" onClick={handleClearFilters}>フィルターをクリア</Button>
               </Box>
               <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 3, borderBottom: 1, borderColor: 'divider', pb: 1.5, mb: 1.5, width: '100%' }}>
                 <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, flexShrink: 0 }}>
                   <Typography variant="subtitle2" sx={{ fontWeight: 'medium' }}>表示状態</Typography>
                   <FormGroup row>
                     {projectDisplayStatusOptions.map(statusKey => {
                       const isOnline = statusKey === 'online';
                       const dotColor = isOnline ? '#4CAF50' : '#9E9E9E';
                       const label = isOnline ? 'オンライン' : statusKey === 'archived' ? 'アーカイブ' : statusKey;
                       return (
                         <FormControlLabel
                           key={statusKey}
                           control={<Checkbox checked={selectedDisplayStatuses.includes(statusKey)} onChange={handleDisplayStatusChange} name={statusKey} size="small" />}
                           label={
                             <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                               <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: dotColor, flexShrink: 0 }} />
                               <span>{label}</span>
                             </Box>
                           }
                           sx={{ '& .MuiTypography-root': { fontSize: '0.8125rem' } }}
                         />
                       );
                     })}
                   </FormGroup>
                 </Box>
                 <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, flex: 1, minWidth: 0 }}>
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
               <Box sx={{ display: 'flex', justifyContent: 'space-evenly', flexWrap: 'wrap', gap: 3, width: '100%' }}>
                 {[
                   { val: totalProjects, label: 'プロジェクト', color: '#1976d2' },
                   { val: totalTasks, label: 'タスク総数', color: '#1976d2' },
                   { val: completedTasks, label: '完了タスク', color: '#9e9e9e' },
                   { val: inProgressTasks, label: '進行中タスク', color: '#ff9800' },
                   { val: delayedTasks, label: '遅延タスク', color: '#f44336' },
                   { val: totalUsers, label: 'メンバー', color: '#9e9e9e' }
                 ].map(({ val, label, color }) => (
                   <Box key={label} sx={{ textAlign: 'center', minWidth: 80, flex: '1 1 0', maxWidth: 140 }}>
                     <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color, fontSize: '1.375rem' }}>{val}</Typography>
                     <Typography variant="caption" color="text.secondary">{label}</Typography>
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
              p: 1.5, 
              flex: 1, 
              minHeight: 0, 
              display: 'flex', 
              flexDirection: 'column', 
              width: '100%', 
              overflow: selectedTab === 4 ? 'hidden' : 'visible',
              overflowX: selectedTab === 4 ? 'hidden' : 'auto',
              ...(selectedTab === 4 && {
                '&::-webkit-scrollbar': { display: 'none' },
                msOverflowStyle: 'none',
                scrollbarWidth: 'none',
              })
            }}
          >
             <Tabs value={selectedTab} onChange={handleTabChange} variant="scrollable" scrollButtons="auto" sx={{ borderBottom: 1, borderColor: 'divider', mb: 1, minHeight: 40, '& .MuiTab-root': { minHeight: 40, py: 0.5 } }}>
               <Tab label="プロジェクト進捗" />
               <Tab label="メンバー負荷" />
               <Tab label="遅延タスク" />
               <Tab label="メンバー進捗" />
               <Tab label="ガントチャート" />
               <Tab label="今週の割当" />
               <Tab label="工数集計" />
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
              <Box sx={{ p: 2 }}>
                 <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                   <Typography variant="h6" sx={{ fontWeight: 600 }}>今週の割り当て</Typography>
                   <Button variant="contained" size="medium" onClick={fetchWeeklyAvailability} disabled={weeklyAvailabilityLoading}>
                     {weeklyAvailabilityLoading ? '更新中...' : '更新'}
                   </Button>
                 </Box>
                 {weeklyAvailabilityLoading && !weeklyAvailability && (
                   <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
                 )}
                 {!weeklyAvailabilityLoading && !weeklyAvailability && (
                   <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>「更新」をクリックして今週の工数データを取得してください。</Typography>
                 )}

                 <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
                   <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>週内日別・割当時間</Typography>
                   {weeklyAvailabilityLoading && (
                     <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
                   )}
                   {!weeklyAvailabilityLoading && weeklyAvailability && (() => {
                     const allMembers = users.filter(u => u.role !== 'admin');
                     const byId = new Map(weeklyAvailability.users.map(u => [u.user_id, u]));
                     const maxHoursPerWeek = 40;
                     const hoursPerDay = 8;
                     const rows = allMembers.map(m => {
                       const w = byId.get(m.id);
                       return w
                         ? { user_id: w.user_id, user_name: w.user_name || `User ${w.user_id}`, assigned_hours: w.assigned_hours, free_hours: w.free_hours, daily_breakdown: w.daily_breakdown ?? [], labor_hours_passed: w.labor_hours_passed, weekdays_passed: w.weekdays_passed }
                         : { user_id: m.id, user_name: m.full_name || m.username || `User ${m.id}`, assigned_hours: 0, free_hours: 40, daily_breakdown: [], labor_hours_passed: undefined, weekdays_passed: 0 };
                     });
                     if (rows.length === 0) {
                       return <Typography color="text.secondary" variant="body2">該当ユーザーはいません。</Typography>;
                     }
                     return (
                       <TableContainer sx={{ overflowX: 'auto' }}>
                         <Table size="small" stickyHeader>
                           <TableHead>
                             <TableRow>
                               <TableCell sx={{ fontWeight: 600, backgroundColor: 'background.paper' }}>ユーザー</TableCell>
                               <TableCell align="right" sx={{ fontWeight: 600, backgroundColor: 'background.paper' }}>今週のコスト割当</TableCell>
                               <TableCell sx={{ fontWeight: 600, backgroundColor: 'background.paper', minWidth: 300 }}>週内日別</TableCell>
                               <TableCell align="right" sx={{ fontWeight: 600, backgroundColor: 'background.paper', whiteSpace: 'nowrap' }}>稼働率</TableCell>
                               <TableCell align="right" sx={{ fontWeight: 600, backgroundColor: 'background.paper', whiteSpace: 'nowrap' }}>残キャパシティ</TableCell>
                               <TableCell align="right" sx={{ fontWeight: 600, backgroundColor: 'background.paper', whiteSpace: 'nowrap' }}>消化効率</TableCell>
                             </TableRow>
                           </TableHead>
                           <TableBody>
                             {rows.map((row) => {
                               const todayIso = new Date().toISOString().slice(0, 10);
                               const utilization = maxHoursPerWeek > 0 ? (row.assigned_hours / maxHoursPerWeek) * 100 : 0;
                               const expectedPassed = (row.weekdays_passed ?? 0) * hoursPerDay;
                               const digestionRatio = expectedPassed > 0 && row.labor_hours_passed != null ? (row.labor_hours_passed / expectedPassed) * 100 : null;
                               return (
                                 <TableRow key={row.user_id} hover sx={{ '& > td': { verticalAlign: 'middle' } }}>
                                   <TableCell component="th" scope="row" sx={{ fontWeight: 500 }}>{row.user_name}</TableCell>
                                   <TableCell align="right">{row.assigned_hours.toFixed(1)}</TableCell>
                                   <TableCell sx={{ py: 0.75 }}>
                                     {row.daily_breakdown && row.daily_breakdown.length > 0 ? (
                                       <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 68px)', gap: 0.6, alignItems: 'stretch', justifyContent: 'start' }}>
                                         {row.daily_breakdown.map((day: { date: string; assigned_hours: number; free_hours: number }) => {
                                           const a = day.assigned_hours;
                                           const f = day.free_hours;
                                           const isToday = day.date === todayIso;
                                           const d = new Date(day.date + 'T12:00:00');
                                           const weekDayNames = ['日','月','火','水','木','金','土'];
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
                                   <TableCell align="right">
                                     <Typography variant="body2" sx={{ color: utilization >= 100 ? 'error.main' : utilization >= 80 ? 'warning.main' : 'text.primary' }}>{utilization.toFixed(1)}%</Typography>
                                     <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>{row.assigned_hours.toFixed(1)}h / {maxHoursPerWeek}h</Typography>
                                   </TableCell>
                                   <TableCell align="right">
                                     <Typography variant="body2" sx={{ color: row.free_hours > 0 ? 'success.main' : 'text.secondary' }}>{row.free_hours.toFixed(1)} h</Typography>
                                   </TableCell>
                                   <TableCell align="right">
                                     {digestionRatio != null ? <Typography variant="body2">{digestionRatio.toFixed(1)}%</Typography> : <Typography variant="caption" color="text.secondary">—</Typography>}
                                   </TableCell>
                                 </TableRow>
                               );
                             })}
                           </TableBody>
                         </Table>
                       </TableContainer>
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
                <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
                  <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>今週のタスク内訳</Typography>
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
                      return (
                        <TableContainer sx={{ overflowX: 'auto' }}>
                          <Table size="small" stickyHeader>
                            <TableHead>
                              <TableRow>
                                <TableCell sx={{ fontWeight: 600, backgroundColor: 'background.paper' }}>ユーザー</TableCell>
                                <TableCell sx={{ fontWeight: 600, backgroundColor: 'background.paper' }}>タスク名</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 600, backgroundColor: 'background.paper' }}>コスト</TableCell>
                                <TableCell sx={{ fontWeight: 600, backgroundColor: 'background.paper' }}>開始</TableCell>
                                <TableCell sx={{ fontWeight: 600, backgroundColor: 'background.paper' }}>期日</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 600, backgroundColor: 'background.paper' }}>期間内平日日数</TableCell>
                                <TableCell align="right" sx={{ fontWeight: 600, backgroundColor: 'background.paper' }}>1日あたりのコスト</TableCell>
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
                                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{t.user_name || `User ${t.user_id}`}</TableCell>
                                  <TableCell sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.task_name}>{t.task_name || '—'}</TableCell>
                                  <TableCell align="right">{t.cost.toFixed(1)}</TableCell>
                                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{t.start_date ?? '—'}</TableCell>
                                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{t.due_date ?? '—'}</TableCell>
                                  <TableCell align="right">
                                    {(() => {
                                      const weekdays =
                                        t.total_weekdays != null
                                          ? t.total_weekdays
                                          : calculateWeekdaysInRange(t.start_date, t.due_date);
                                      return weekdays != null ? weekdays.toLocaleString() : '—';
                                    })()}
                                  </TableCell>
                                  <TableCell align="right">{t.hours_per_weekday != null ? t.hours_per_weekday.toFixed(1) : '—'}</TableCell>
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

                {/* 今週の合計工数（リソース・スタックバー）— 全員を表示（0h の人も縦軸に含める） */}
                {!weeklyAvailabilityLoading && weeklyAvailability && (() => {
                  const allMembers = users.filter(u => u.role !== 'admin');
                  const byId = new Map(weeklyAvailability.users.map(u => [u.user_id, u]));
                  const reportUsers = allMembers.map(m => {
                    const w = byId.get(m.id);
                    return w
                      ? { user_id: w.user_id, user_name: w.user_name, assigned_hours: w.assigned_hours, free_hours: w.free_hours }
                      : { user_id: m.id, user_name: m.full_name || m.username || `User ${m.id}`, assigned_hours: 0, free_hours: 40 };
                  });
                  return (
                    <Box sx={{ mt: 2 }}>
                      <ResourceStackBar users={reportUsers} maxHoursPerWeek={40} />
                    </Box>
                  );
                })()}
              </Box>
            )}

            {/* タブ6: 工数集計 — 期間指定の集計レポート */}
            {selectedTab === 6 && (
              <Box sx={{ p: 2 }}>
                 <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
                   <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                     <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1rem' }}>工数集計レポート</Typography>
                     <Tooltip title="1日8時間基準。時間・日単位で表示。" placement="top" arrow>
                       <HelpOutlineIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                     </Tooltip>
                   </Box>
                   {!laborReportLoading && laborReportData.length > 0 && (
                     <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                       対象{laborReportGroupBy === 'user' ? '担当者' : 'プロジェクト'} {laborReportSummary.groupCount.toLocaleString()} 件 / 工数 {laborReportSummary.totalHours.toLocaleString(undefined, { maximumFractionDigits: 1 })} h
                     </Typography>
                   )}
                 </Box>
                 <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 1.5 }}>
                   <FormControl size="small" sx={{ minWidth: 140 }}>
                     <InputLabel>集計単位</InputLabel>
                     <Select value={laborReportGroupBy} label="集計単位" onChange={(e) => setLaborReportGroupBy(e.target.value as 'user' | 'project')}>
                       <MenuItem value="user">担当者別</MenuItem>
                       <MenuItem value="project">プロジェクト別</MenuItem>
                     </Select>
                   </FormControl>
                   <TextField size="small" label="開始日" type="date" value={laborReportFrom} onChange={(e) => setLaborReportFrom(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 160 }} />
                   <TextField size="small" label="終了日" type="date" value={laborReportTo} onChange={(e) => setLaborReportTo(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 160 }} />
                   <FormControlLabel
                     control={
                       <Checkbox
                         checked={laborReportIncludeOffline}
                         onChange={(e) => setLaborReportIncludeOffline(e.target.checked)}
                         size="small"
                       />
                     }
                     label="オフラインのプロジェクトを含める"
                   />
                   <FormControlLabel
                     control={
                       <Checkbox
                         checked={laborReportIncludeCompleted}
                         onChange={(e) => setLaborReportIncludeCompleted(e.target.checked)}
                         size="small"
                       />
                     }
                     label="完了タスクを含める"
                   />
                   <Button variant="contained" onClick={fetchLaborReport} disabled={laborReportLoading}>{laborReportLoading ? '取得中...' : '取得'}</Button>
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
                   <TableContainer
                     component={Paper}
                     variant="outlined"
                     sx={{
                       maxWidth: '100%',
                       '& .MuiTableCell-root': { fontSize: '0.78rem', py: 0.7 },
                       '& .MuiTableHead-root .MuiTableCell-root': { fontWeight: 600, bgcolor: 'grey.100' },
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
                               <TableCell>{row.group_name}</TableCell>
                               <TableCell align="right">{totalCostHours.toLocaleString(undefined, { maximumFractionDigits: 1 })}</TableCell>
                               <TableCell align="right">{totalCostDays.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                               <TableCell align="right">{row.task_count}</TableCell>
                             </TableRow>
                           );
                         })}
                         {laborReportData.length > 0 && (
                           <TableRow sx={{ backgroundColor: 'action.hover', fontWeight: 'bold' }}>
                             <TableCell sx={{ fontWeight: 'bold' }}>合計</TableCell>
                             <TableCell align="right" sx={{ fontWeight: 'bold' }}>{laborReportData.reduce((sum, row) => sum + row.total_cost, 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</TableCell>
                             <TableCell align="right" sx={{ fontWeight: 'bold' }}>{(laborReportData.reduce((sum, row) => sum + row.total_cost, 0) / 8).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                             <TableCell align="right" sx={{ fontWeight: 'bold' }}>{laborReportData.reduce((sum, row) => sum + row.task_count, 0)}</TableCell>
                           </TableRow>
                         )}
                       </TableBody>
                     </Table>
                   </TableContainer>
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

      {/* 今週のタスク内訳 編集ダイアログ */}
      <Dialog
        open={editWeeklyTaskDialogOpen}
        onClose={handleWeeklyTaskDialogClose}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: '1rem' }}>今週のタスク編集</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {editWeeklyTaskError && (
            <Box sx={{ mb: 2 }}>
              <Alert severity="error" sx={{ fontSize: '0.8rem' }}>
                {editWeeklyTaskError}
              </Alert>
            </Box>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="タスク名"
              size="small"
              value={editWeeklyTaskForm?.task_name ?? ''}
              onChange={(e) => handleWeeklyTaskInputChange('task_name', e.target.value)}
              fullWidth
            />
            <TextField
              label="コスト（時間）"
              size="small"
              type="number"
              inputProps={{ step: '0.1', min: 0 }}
              value={editWeeklyTaskForm?.cost ?? 0}
              onChange={(e) => handleWeeklyTaskInputChange('cost', e.target.value)}
              fullWidth
            />
            <TextField
              label="開始日"
              size="small"
              type="date"
              InputLabelProps={{ shrink: true }}
              value={editWeeklyTaskForm?.start_date ?? ''}
              onChange={(e) => handleWeeklyTaskInputChange('start_date', e.target.value)}
              fullWidth
            />
            <TextField
              label="期日"
              size="small"
              type="date"
              InputLabelProps={{ shrink: true }}
              value={editWeeklyTaskForm?.due_date ?? ''}
              onChange={(e) => handleWeeklyTaskInputChange('due_date', e.target.value)}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleWeeklyTaskDialogClose} size="small">
            キャンセル
          </Button>
          <Button
            onClick={handleWeeklyTaskSave}
            variant="contained"
            color="primary"
            size="small"
            disabled={editWeeklyTaskSaving}
          >
            {editWeeklyTaskSaving ? '保存中...' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

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
    </Box>
  );
};

export default MetricsPage;