import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Box, Typography, Paper, Grid, CircularProgress, Alert, FormControl, InputLabel, Select, MenuItem, SelectChangeEvent, Tab, Tabs, Button, TextField, Autocomplete, FormGroup, FormControlLabel, Checkbox } from '@mui/material';
import api from '../services/api';
import { Project, Task, User } from '../types';
import ProjectProgressChart from '../components/ProjectProgressChart';
import AssigneeLoadChart from '../components/AssigneeLoadChart';
import DelayedTaskList from '../components/DelayedTaskList';
import UserProgressChart from '../components/UserProgressChart';
import GanttView from '../components/GanttView';
import ErrorBoundary from '../components/ErrorBoundary';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMetricsPageState } from '../contexts/PageStateContext';

// Placeholder types - replace with your actual types if different
// type Project = { id: string; name: string; status: string; };
// type Task = { id: string; title: string; taskStatus: string; taskAssigneeId: string | null; taskDueDate: string; projectId: string; };
// type User = { id: string; full_name: string; };

const MetricsPage: React.FC = () => {
  console.log("--- Rendering MetricsPage Component ---");

  const location = useLocation();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProjectIdForProgress, setSelectedProjectIdForProgress] = useState<string | 'all'>('all');

  // ページ状態管理の使用
  const { metricsState, updateMetricsState, isInitialLoad, globalData, updateGlobalData } = useMetricsPageState();
  
  // 状態を分離（初期化時はデフォルト値）
  const [selectedTab, setSelectedTab] = useState<number>(0);
  const [dateRange, setDateRange] = useState<string>('all');
  const [projectNameFilter, setProjectNameFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedDisplayStatuses, setSelectedDisplayStatuses] = useState<string[]>([]);

  // ページ状態が復元されたらローカル状態を更新
  useEffect(() => {
    if (!isInitialLoad) {
      setSelectedTab(metricsState.selectedTab);
      setDateRange(metricsState.dateRange);
      setProjectNameFilter(metricsState.projectNameFilter);
      setStatusFilter(metricsState.statusFilter);
      setSelectedDisplayStatuses(metricsState.selectedDisplayStatuses);
    }
  }, [metricsState, isInitialLoad]);

  // グローバルデータから初期値を設定
  useEffect(() => {
    if (globalData.tasks.length > 0) {
      setTasks(globalData.tasks);
    }
    if (globalData.projects.length > 0) {
      setProjects(globalData.projects);
    }
    if (globalData.users.length > 0) {
      setUsers(globalData.users);
    }
    setLoading(false);
  }, [globalData]);

  // データ取得関数
  const fetchData = useCallback(async () => {
    console.log("MetricsPage: useEffect - Fetching data...");
      setLoading(true);
      setError(null);
      try {
        const [projRes, taskRes, userRes] = await Promise.all([
          api.get<Project[]>('/projects'),
          api.get<Task[]>('/tasks'),
          api.get<User[]>('/api/users'),
        ]);
        
        console.log("DEBUG: Fetched Projects (display_status check):", JSON.stringify(projRes.data.map(p => ({ id: p.id, name: p.name, display_status: p.display_status })), null, 2)); 
        
        console.log("Fetched Projects:", projRes.data.length);
        console.log("Fetched Tasks:", taskRes.data.length);
        console.log("Fetched Users:", userRes.data.length);
        console.log("Fetched Tasks Data:", taskRes.data);
        
        const projectsData = projRes.data;
        const tasksData = taskRes.data;
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
    }, []); // 依存関係を空にして無限ループを防ぐ

  // データ取得の統合（重複を防ぐ）
  useEffect(() => {
    // グローバルデータが既に存在する場合はスキップ
    if (globalData && globalData.tasks.length > 0 && globalData.projects.length > 0) {
      console.log("[MetricsPage] Using existing global data...");
      setTasks(globalData.tasks);
      setProjects(globalData.projects);
      setUsers(globalData.users);
      setLoading(false);
      return;
    }

    // 初回ロード時のみデータを取得（他のページが既に取得済みの場合はスキップ）
    if (isInitialLoad && (!globalData || globalData.tasks.length === 0)) {
      console.log("[MetricsPage] Fetching data on initial load...");
      fetchData();
    }
  }, [isInitialLoad, globalData]); // fetchDataを依存関係から除外

  // グローバルデータの変更を直接監視（より確実な方法）
  useEffect(() => {
    if (globalData && globalData.tasks && globalData.tasks.length > 0) {
      console.log("[MetricsPage] Global data updated, refreshing local state...");
      console.log("[MetricsPage] Tasks count:", globalData.tasks.length);
      setTasks(globalData.tasks);
    }
    if (globalData && globalData.projects && globalData.projects.length > 0) {
      console.log("[MetricsPage] Projects count:", globalData.projects.length);
      setProjects(globalData.projects);
    }
    if (globalData && globalData.users && globalData.users.length > 0) {
      console.log("[MetricsPage] Users count:", globalData.users.length);
      setUsers(globalData.users);
    }
  }, [globalData.tasks, globalData.projects, globalData.users, globalData.lastFetched]);

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
  }, [selectedTab, dateRange, projectNameFilter, statusFilter, selectedDisplayStatuses, isInitialLoad]);

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
    let result = tasks;
    let tempProjects = projects;

    // プロジェクト名でフィルタリング (プロジェクトリストを先に絞る)
    if (projectNameFilter) {
      tempProjects = tempProjects.filter(project => project.name === projectNameFilter);
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
    <Box sx={{ p: 3, flexGrow: 1 }}>
      <Grid container spacing={3}>
         <Grid item xs={12}>
            <Paper sx={{p: 2, mb: 2}}>
               <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                 <Typography variant="h6">プロジェクトメトリクス</Typography>
                 <Button 
                   variant="outlined" 
                   size="small" 
                   onClick={handleClearFilters}
                   sx={{ ml: 2 }}
                 >
                   フィルターをクリア
                 </Button>
               </Box>
               
               <Box sx={{ mb: 2, borderBottom: 1, borderColor: 'divider', pb: 1 }}>
                 <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 'medium' }}>表示状態</Typography>
                 <FormGroup row>
                   {projectDisplayStatusOptions.map(statusKey => (
                     <FormControlLabel
                       key={statusKey}
                       control={
                         <Checkbox 
                           checked={selectedDisplayStatuses.includes(statusKey)} 
                           onChange={handleDisplayStatusChange} 
                           name={statusKey} 
                           size="small"
                         />
                       }
                       label={statusKey.charAt(0).toUpperCase() + statusKey.slice(1)}
                       sx={{ '& .MuiTypography-root': { fontSize: '0.875rem' } }}
                     />
                   ))}
                 </FormGroup>
               </Box>
               
               <Grid container spacing={2} sx={{ mb: 3 }}>
                 <Grid item xs={12} sm={6} md={4}>
                   <FormControl fullWidth size="small">
                     <InputLabel id="date-range-label">期間</InputLabel>
                     <Select
                       labelId="date-range-label"
                       value={dateRange}
                       label="期間"
                       onChange={handleDateRangeChange}
                     >
                       <MenuItem value="all">全期間</MenuItem>
                       <MenuItem value="week">直近1週間</MenuItem>
                       <MenuItem value="month">直近1ヶ月</MenuItem>
                       <MenuItem value="quarter">直近3ヶ月</MenuItem>
                     </Select>
                   </FormControl>
                 </Grid>
                 
                 <Grid item xs={12} sm={6} md={4}>
                   <Autocomplete
                     size="small"
                     options={projectNameOptions}
                     value={projectNameFilter}
                     onChange={handleProjectNameChange}
                     renderInput={(params) => (
                       <TextField {...params} label="プロジェクト名" />
                     )}
                   />
                 </Grid>
                 
                 <Grid item xs={12} sm={12} md={4}>
                   <FormControl fullWidth size="small">
                     <InputLabel id="project-status-label">プロジェクト状態</InputLabel>
                     <Select
                       labelId="project-status-label"
                       value={statusFilter}
                       label="プロジェクト状態"
                       onChange={handleStatusFilterChange}
                     >
                       <MenuItem value="all">すべて</MenuItem>
                       {projectStatusOptions.map(status => (
                         <MenuItem key={status} value={status}>{status}</MenuItem>
                       ))}
                     </Select>
                   </FormControl>
                 </Grid>
               </Grid>
               
               <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                 <Box sx={{ textAlign: 'center', minWidth: 120 }}>
                   <Typography variant="h5" sx={{ fontWeight: 'bold', color: '#1976d2' }}>{totalProjects}</Typography>
                   <Typography variant="body2" color="text.secondary">プロジェクト</Typography>
                 </Box>
                 <Box sx={{ textAlign: 'center', minWidth: 120 }}>
                   <Typography variant="h5" sx={{ fontWeight: 'bold', color: '#1976d2' }}>{totalTasks}</Typography>
                   <Typography variant="body2" color="text.secondary">タスク総数</Typography>
                 </Box>
                 <Box sx={{ textAlign: 'center', minWidth: 120 }}>
                   <Typography variant="h5" sx={{ fontWeight: 'bold', color: '#4caf50' }}>{completedTasks}</Typography>
                   <Typography variant="body2" color="text.secondary">完了タスク</Typography>
                 </Box>
                 <Box sx={{ textAlign: 'center', minWidth: 120 }}>
                   <Typography variant="h5" sx={{ fontWeight: 'bold', color: '#ff9800' }}>{inProgressTasks}</Typography>
                   <Typography variant="body2" color="text.secondary">進行中タスク</Typography>
                 </Box>
                 <Box sx={{ textAlign: 'center', minWidth: 120 }}>
                   <Typography variant="h5" sx={{ fontWeight: 'bold', color: '#f44336' }}>{delayedTasks}</Typography>
                   <Typography variant="body2" color="text.secondary">遅延タスク</Typography>
                 </Box>
                 <Box sx={{ textAlign: 'center', minWidth: 120 }}>
                   <Typography variant="h5" sx={{ fontWeight: 'bold', color: '#9e9e9e' }}>{totalUsers}</Typography>
                   <Typography variant="body2" color="text.secondary">メンバー</Typography>
                 </Box>
               </Box>
            </Paper>
         </Grid>

         <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
             <Tabs 
               value={selectedTab} 
               onChange={handleTabChange} 
               variant="scrollable"
               scrollButtons="auto"
               sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
             >
               <Tab label="プロジェクト進捗" />
               <Tab label="メンバー負荷" />
               <Tab label="遅延タスク" />
               <Tab label="メンバー進捗" />
               <Tab label="ガントチャート" />
             </Tabs>
             
             {selectedTab === 0 && (
            <ProjectProgressChart
                 projects={filteredProjects}
                 tasks={filteredTasks}
                 selectedProjectId={String(selectedProjectIdForProgress)}
                 onProjectChange={setSelectedProjectIdForProgress}
            />
             )}
             
             {selectedTab === 1 && (
               <AssigneeLoadChart tasks={filteredTasks} users={users} projects={filteredProjects} />
             )}
             
             {selectedTab === 2 && (
               <DelayedTaskList tasks={filteredTasks} users={users} projects={filteredProjects} />
             )}
             
             {selectedTab === 3 && (
               <UserProgressChart tasks={filteredTasks} users={users} projects={filteredProjects} />
             )}
             
             {selectedTab === 4 && (
               <>
                {filteredTasks.length > 0 ? (
                  <ErrorBoundary componentName="GanttChart">
                    <GanttView tasks={filteredTasks} projects={filteredProjects} users={users} />
                  </ErrorBoundary>
                ) : (
                  <Box sx={{ p: 3, textAlign: 'center' }}>
                    <Typography>タスクデータが見つかりません。タスクを追加するか、フィルターを調整してください。</Typography>
                  </Box>
                )}
               </>
             )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default MetricsPage; 