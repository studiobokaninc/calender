import React, { useState, useEffect, useMemo, useCallback } from 'react'; //Reactとは、フロントエンドのUIを作成するためのライブラリです。
import { Box, Typography, Paper, CircularProgress, Alert, FormControl, InputLabel, Select, MenuItem, SelectChangeEvent, Tab, Tabs, Button, TextField, Autocomplete, FormGroup, FormControlLabel, Checkbox } from '@mui/material';
import api from '../services/api'; //apiとは、バックエンドのAPIを呼び出すためのライブラリです。
import { Project, Task, User } from '../types'; //Projectとは、プロジェクトの情報を管理する型です。Taskとは、タスクの情報を管理する型です。Userとは、ユーザーの情報を管理する型です。
import ProjectProgressChart from '../components/ProjectProgressChart'; //ProjectProgressChartとは、プロジェクトの進捗を表示するコンポーネントです。
import AssigneeLoadChart from '../components/AssigneeLoadChart'; //AssigneeLoadChartとは、メンバーの負荷を表示するコンポーネントです。
import DelayedTaskList from '../components/DelayedTaskList'; //DelayedTaskListとは、遅れているタスクを表示するコンポーネントです。
import UserProgressChart from '../components/UserProgressChart'; //UserProgressChartとは、ユーザーの進捗を表示するコンポーネントです。
import GanttView from '../components/GanttView'; //GanttViewとは、ガントチャートを表示するコンポーネントです。
import ErrorBoundary from '../components/ErrorBoundary'; //ErrorBoundaryとは、エラーを表示するコンポーネントです。
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
    }
  }, [location.search, isInitialLoad]);

  // プロジェクト名オプションの準備
  const projectNameOptions = useMemo(() => {
    return projects.map(project => project.name);
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

  // display_status オプションの準備 (プロジェクトデータから動的に生成する場合)
  const projectDisplayStatusOptions = useMemo(() => {
    const displayStatuses = new Set<string>();
    projects.forEach(project => {
      if (project.display_status) { 
        displayStatuses.add(project.display_status);
      }
    });
    return Array.from(displayStatuses);
  }, [projects]);

  // データのフィルタリング
  const filteredTasks = useMemo(() => {
    console.log(`[MetricsPage] Filtering tasks - Total tasks: ${tasks.length}, Total projects: ${projects.length}`);
    console.log(`[MetricsPage] Filters - projectName: ${projectNameFilter}, status: ${statusFilter}, displayStatuses: ${selectedDisplayStatuses.join(',')}, dateRange: ${dateRange}`);
    
    let result = tasks;
    let tempProjects = projects;

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

    // 絞り込まれたプロジェクトIDに基づいてタスクをフィルタリング
    if (projectNameFilter || statusFilter !== 'all' || selectedDisplayStatuses.length > 0) {
        result = result.filter(task => task.project_id && filteredProjectIds.includes(String(task.project_id)));
    }
    
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

  // フィルタリングされたプロジェクト
  const filteredProjects = useMemo(() => {
    let result = projects;
    
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
    // URLも更新する
    let tabName = '';
    if (newValue === 0) tabName = 'progress';
    else if (newValue === 1) tabName = 'load';
    else if (newValue === 2) tabName = 'delayed';
    else if (newValue === 3) tabName = 'member_progress';
    else if (newValue === 4) tabName = 'gantt';
    navigate(`${location.pathname}?tab=${tabName}`);
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

  const handleProjectNameChange = (_event: React.SyntheticEvent, newValue: string | null) => {
    setProjectNameFilter(newValue);
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
    <Box sx={{ p: 2, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%' }}>
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
                     {projectDisplayStatusOptions.map(statusKey => (
                       <FormControlLabel
                         key={statusKey}
                         control={<Checkbox checked={selectedDisplayStatuses.includes(statusKey)} onChange={handleDisplayStatusChange} name={statusKey} size="small" />}
                         label={statusKey.charAt(0).toUpperCase() + statusKey.slice(1)}
                         sx={{ '& .MuiTypography-root': { fontSize: '0.8125rem' } }}
                       />
                     ))}
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
                   <Autocomplete size="small" options={projectNameOptions} value={projectNameFilter} onChange={handleProjectNameChange} sx={{ minWidth: 220, flex: '2 1 200px' }}
                     renderInput={(params) => <TextField {...params} label="プロジェクト名" />}
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
                   { val: completedTasks, label: '完了タスク', color: '#4caf50' },
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
      <Box sx={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column' }}>
          <Paper sx={{ p: 1.5, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%' }}>
             <Tabs value={selectedTab} onChange={handleTabChange} variant="scrollable" scrollButtons="auto" sx={{ borderBottom: 1, borderColor: 'divider', mb: 1, minHeight: 40, '& .MuiTab-root': { minHeight: 40, py: 0.5 } }}>
               <Tab label="プロジェクト進捗" />
               <Tab label="メンバー負荷" />
               <Tab label="遅延タスク" />
               <Tab label="メンバー進捗" />
               <Tab label="ガントチャート" />
             </Tabs>
             <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
             {selectedTab === 0 && <ProjectProgressChart projects={filteredProjects} tasks={filteredTasks} />}
             {selectedTab === 1 && <AssigneeLoadChart tasks={filteredTasks} users={users} projects={filteredProjects} />}
             {selectedTab === 2 && <DelayedTaskList tasks={filteredTasks} users={users} projects={filteredProjects} />}
             {selectedTab === 3 && <UserProgressChart tasks={filteredTasks} users={users} projects={filteredProjects} />}
             {selectedTab === 4 && (
               filteredTasks.length > 0 ? (
                 <ErrorBoundary componentName="GanttChart">
                   <GanttView key={`gantt-${filteredProjects.map(p => p.id).join('-')}`} tasks={filteredTasks} projects={filteredProjects} users={users} />
                 </ErrorBoundary>
               ) : (
                 <Box sx={{ p: 2, textAlign: 'center' }}><Typography>タスクデータが見つかりません。タスクを追加するか、フィルターを調整してください。</Typography></Box>
               )
             )}
             </Box>
          </Paper>
      </Box>
    </Box>
  );
};

export default MetricsPage; 