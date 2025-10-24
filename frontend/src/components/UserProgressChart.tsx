import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Task, User, Project, StatusHistoryEntry } from '../types';
import {
    Box, Typography, Paper, FormControl, InputLabel, Select, MenuItem, Tooltip as MuiTooltip, IconButton, CircularProgress, Grid,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow, List, ListItem, ListItemIcon, ListItemText, LinearProgress
} from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import { 
    parseISO, 
    format, 
    eachDayOfInterval, 
    min, 
    max, 
    isValid, 
    startOfDay, 
    differenceInDays, 
    isBefore, 
    isEqual 
} from 'date-fns';

// Propsの型定義
interface UserProgressChartProps {
    tasks: Task[];
    users: User[];
    projects: Project[];
}

// グラフ用データポイントの型定義 (仮)
interface ProgressDataPoint {
    date: string; // YYYY-MM-DD
    plan: number | null; // 0-100 (単一ユーザー時のみ)
    actual: number | null; // 0-100 (単一ユーザー時のみ)
    // ★★★ 全ユーザー表示用に、ユーザーIDをキーとする実績値を追加 ★★★
    [userId: string]: number | null | string; // date, plan, actual 以外は userId: progress
}

// ★★★ ステータス別カウントの型 ★★★
interface StatusCounts {
    todo: number;
    inProgress: number;
    delayed: number;
    done: number;
}

// ★★★ データ計算ロジックを実装 ★★★
const calculateUserProgressData = (
    tasks: Task[],
    selectedUserId: string,
): ProgressDataPoint[] => {
    console.log(`Calculating single user progress data for user: ${selectedUserId}`);
    console.log('All tasks:', tasks.map(t => ({ id: t.id, name: t.name, assigned_to: t.assigned_to })));
    
    const userTasks = tasks.filter(task => {
        const taskUserId = task.assigned_to?.toString();
        const selectedId = selectedUserId.toString();
        console.log(`Task ${task.id} assigned_to: ${taskUserId}, selectedUserId: ${selectedId}, match: ${taskUserId === selectedId}`);
        return taskUserId === selectedId;
    });
    
    console.log(`Found ${userTasks.length} tasks for user ${selectedUserId}`);
    console.log('User tasks:', userTasks.map(t => ({ id: t.id, name: t.name, status: t.status })));

    if (userTasks.length === 0) {
        console.log("No tasks found for this user.");
        return [];
    }

    const allDates: Date[] = [];
    userTasks.forEach(task => {
        if (task.status_history && task.status_history.length > 0) {
            task.status_history.forEach((history: StatusHistoryEntry) => {
                const date = parseISO(history.changed_at);
                if (isValid(date)) {
                    allDates.push(startOfDay(date));
                }
            });
        }
        if (task.start_date) {
            const startDate = parseISO(task.start_date);
            if (isValid(startDate)) allDates.push(startOfDay(startDate));
        }
        if (task.due_date) {
            const dueDate = parseISO(task.due_date);
            if (isValid(dueDate)) allDates.push(startOfDay(dueDate));
        }
    });

    console.log('All dates:', allDates.map(d => format(d, 'yyyy-MM-dd')));

    if (allDates.length === 0) {
        console.log("No valid dates found in tasks for this user.");
        return [];
    }

    const minDate = min(allDates);
    const maxDate = max(allDates);

    console.log('Date range:', {
        min: format(minDate, 'yyyy-MM-dd'),
        max: format(maxDate, 'yyyy-MM-dd')
    });

    if (!isValid(minDate) || !isValid(maxDate) || isEqual(minDate, maxDate)) {
        console.log("Invalid or single-point date range.");
        return [];
    }

    const intervalDays = eachDayOfInterval({ start: minDate, end: maxDate });
    const todayDateStr = format(startOfDay(new Date()), 'yyyy-MM-dd');

    console.log('Today:', todayDateStr);

    const progressData: ProgressDataPoint[] = intervalDays.map((currentDate): ProgressDataPoint => {
        const formattedDate = format(currentDate, 'yyyy-MM-dd');

        // 計画値の計算を修正
        let planValue: number | null = null;
        const tasksDueOnOrBeforeDate = userTasks.filter(task => {
            if (!task.due_date) return false;
            const dueDate = startOfDay(parseISO(task.due_date));
            return isValid(dueDate) && (isBefore(dueDate, currentDate) || isEqual(dueDate, currentDate));
        });

        if (userTasks.length > 0) {
            planValue = (tasksDueOnOrBeforeDate.length / userTasks.length) * 100;
            planValue = Math.round(planValue);
        }

        let doneCount = 0;
        let inProgressCount = 0;
        const totalUserTasksCount = userTasks.length;

        userTasks.forEach(task => {
            let statusOnDate: string | undefined = undefined;
            let latestHistoryDateTime: Date | null = null;

            if (task.status_history && task.status_history.length > 0) {
                task.status_history.forEach((history: StatusHistoryEntry) => {
                    const historyDate = parseISO(history.changed_at);
                    const historyDay = isValid(historyDate) ? startOfDay(historyDate) : null;
                    if (historyDay && (isBefore(historyDay, currentDate) || isEqual(historyDay, currentDate))) {
                        if (latestHistoryDateTime === null || isBefore(latestHistoryDateTime, historyDate)) {
                            latestHistoryDateTime = historyDate;
                            statusOnDate = history.status;
                        } else if (isEqual(latestHistoryDateTime, historyDate) && history.status === 'completed') {
                            statusOnDate = history.status;
                        }
                    }
                });
            }

            if (!statusOnDate) {
                statusOnDate = task.status || undefined;
            }

            if (statusOnDate === 'completed') doneCount++;
            else if (statusOnDate === 'in-progress') inProgressCount++;
        });

        let actualValue: number | null = null;
        if (totalUserTasksCount > 0) {
            actualValue = ((doneCount * 1.0) + (inProgressCount * 0.5)) / totalUserTasksCount * 100;
            actualValue = Math.max(0, Math.min(100, Math.round(actualValue)));
        }
        
        if (formattedDate > todayDateStr) {
            actualValue = null;
        }

        console.log(`Date ${formattedDate}:`, {
            doneCount,
            inProgressCount,
            totalUserTasksCount,
            actualValue,
            planValue,
            tasksDueOnOrBeforeDate: tasksDueOnOrBeforeDate.length
        });

        return {
            date: formattedDate,
            plan: planValue,
            actual: actualValue,
        };
    }); 

    console.log("Calculated progress data points:", progressData.length);
    return progressData;
};

// ★★★ 全ユーザーの進捗データ計算関数 ★★★
const calculateAllUsersProgressData = (
    tasks: Task[],
    users: User[]
): ProgressDataPoint[] => {
    console.log("Calculating all users progress data");
    const relevantUsers = users.filter(u => u.role !== 'admin');
    if (relevantUsers.length === 0) return [];

    const allDates: Date[] = [];
    tasks.forEach(task => {
        if (relevantUsers.some(u => u.id === task.assigned_to)) {
            task.status_history?.forEach((history: StatusHistoryEntry) => {
                const date = parseISO(history.changed_at);
                if (isValid(date)) allDates.push(startOfDay(date));
            });
             if (task.start_date) {
                 const startDate = parseISO(task.start_date);
                 if (isValid(startDate)) allDates.push(startOfDay(startDate));
             }
             if (task.due_date) {
                 const dueDate = parseISO(task.due_date);
                 if (isValid(dueDate)) allDates.push(startOfDay(dueDate));
             }
        }
    });

    if (allDates.length === 0) {
        console.log("No valid dates found in tasks for any relevant user.");
        return [];
    }

    const minDate = min(allDates);
    const maxDate = max(allDates);

    if (!isValid(minDate) || !isValid(maxDate) || isEqual(minDate, maxDate)) {
        console.log("Invalid or single-point date range for all users.");
        return [];
    }

    const intervalDays = eachDayOfInterval({ start: minDate, end: maxDate });
    const todayDateStr = format(startOfDay(new Date()), 'yyyy-MM-dd'); // 今日の日付

    // 各日付の各ユーザーの実績値を計算
    const progressData: ProgressDataPoint[] = intervalDays.map((currentDate): ProgressDataPoint => {
        const formattedDate = format(currentDate, 'yyyy-MM-dd');
        const dataPoint: ProgressDataPoint = { date: formattedDate, plan: null, actual: null };

        relevantUsers.forEach(user => {
            const userId = user.id;
            const userTasks = tasks.filter(task => 
                task.assigned_to === userId && 
                task.status_history &&
                task.status_history.length > 0
            );
            const totalUserTasksCount = userTasks.length;
            let doneCount = 0;
            let inProgressCount = 0;

            if (totalUserTasksCount > 0) {
                userTasks.forEach(task => {
                    let statusOnDate: string | undefined = undefined;
                    let latestHistoryDateTime: Date | null = null;
                    task.status_history?.forEach((history: StatusHistoryEntry) => {
                        const historyDate = parseISO(history.changed_at);
                        const historyDay = isValid(historyDate) ? startOfDay(historyDate) : null;
                        if (historyDay && (isBefore(historyDay, currentDate) || isEqual(historyDay, currentDate))) {
                            if (latestHistoryDateTime === null || isBefore(latestHistoryDateTime, historyDate)) {
                                latestHistoryDateTime = historyDate;
                                statusOnDate = history.status;
                            } else if (isEqual(latestHistoryDateTime, historyDate) && history.status === 'completed') {
                                statusOnDate = history.status;
                            }
                        }
                    });
                    // 正規化: 履歴は 'completed' を返すため 'done' 相当として扱う
                    const normalizedStatus = statusOnDate === 'completed' ? 'done' : statusOnDate;
                    if (normalizedStatus === 'done') doneCount++;
                    else if (normalizedStatus === 'in-progress') inProgressCount++;
                });
                 const actualValue = ((doneCount * 1.0) + (inProgressCount * 0.5)) / totalUserTasksCount * 100;
                 dataPoint[userId] = Math.max(0, Math.min(100, Math.round(actualValue))); 
            } else {
                dataPoint[userId] = null;
            }

            // ★★★ 今日より後の実績は null にする ★★★
            if (formattedDate > todayDateStr) {
                dataPoint[userId] = null;
            }
        });
        return dataPoint;
    });

    console.log("Calculated all users progress data points:", progressData.length);
    return progressData;
};

// ★★★ 特定日付のステータス別タスク数を計算する関数 (all users 対応) ★★★
const getStatusCountsOnDate = (
    tasks: Task[],
    selectedUserId: string | 'all',
    users: User[],
    targetDateStr: string | null
): StatusCounts => {
    const initialCounts: StatusCounts = { todo: 0, inProgress: 0, delayed: 0, done: 0 };
    if (!targetDateStr || !selectedUserId) return initialCounts;

    const targetDate = startOfDay(parseISO(targetDateStr));
    if (!isValid(targetDate)) return initialCounts;

    const targetUsers = selectedUserId === 'all'
        ? users.filter(u => u.role !== 'admin')
        : users.filter(u => u.id.toString() === selectedUserId.toString());
    
    if (targetUsers.length === 0) return initialCounts;

    const targetTasks = selectedUserId === 'all'
        ? tasks
        : tasks.filter(task => task.assigned_to?.toString() === selectedUserId.toString());

    // ★★★ ユーザーごとではなく、全対象タスクに対して処理 ★★★
    targetTasks.forEach(task => {
        // このタスクが対象ユーザーの誰かに割り当てられているか確認 (selectedUserId === 'all' の場合)
        if (selectedUserId === 'all' && !targetUsers.some(u => u.id === task.assigned_to)) {
            return; // 関係ないタスクはスキップ
        }

        let statusOnDate: string | undefined = undefined;
        let latestHistoryDate: Date | null = null;

        if (task.status_history && task.status_history.length > 0) {
            task.status_history.forEach((history: StatusHistoryEntry) => {
                const historyDate = parseISO(history.changed_at);
                const historyDay = isValid(historyDate) ? startOfDay(historyDate) : null;
                if (historyDay && (isBefore(historyDay, targetDate) || isEqual(historyDay, targetDate))) {
                    if (latestHistoryDate === null || isBefore(latestHistoryDate, historyDate)) {
                        latestHistoryDate = historyDate;
                        statusOnDate = history.status;
                    } else if (isEqual(latestHistoryDate, historyDate) && history.status === 'completed') {
                        statusOnDate = history.status;
                    }
                }
            });
        }

        let finalStatus: string | undefined = statusOnDate;
        if (finalStatus === 'completed') finalStatus = 'done';
        if (finalStatus === 'in-progress') finalStatus = 'inProgress';
        if (task.due_date) {
            const dueDate = startOfDay(parseISO(task.due_date));
            if (isValid(dueDate) && isBefore(dueDate, targetDate) && finalStatus !== 'done') {
                 finalStatus = 'delayed';
            }
        }

        if (finalStatus === 'todo') initialCounts.todo++;
        else if (finalStatus === 'inProgress') initialCounts.inProgress++;
        else if (finalStatus === 'delayed') initialCounts.delayed++;
        else if (finalStatus === 'done') initialCounts.done++;
    });

    return initialCounts;
};

// ★★★ ユーザーごとの色を定義 (適宜追加・変更) ★★★
const USER_COLORS = [
    '#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#00C49F', 
    '#FFBB28', '#FF8042', '#0088FE', '#A4DE6C', '#D0ED57'
];

const STATUS_COLORS: { [key: string]: string } = {
    todo: '#2196F3',
    inProgress: '#4CAF50',
    delayed: '#F44336',
    done: '#9E9E9E',
};

// ★★★ 特定日付・特定ステータスのタスクリストを取得する関数 (types.ts に合わせて camelCase に修正) ★★★
const getTasksByStatusOnDate = (
    tasks: Task[],
    selectedUserId: string | 'all',
    users: User[],
    targetDateStr: string | null,
    targetStatus: string | null
): Task[] => {
    if (!targetDateStr || !selectedUserId || !targetStatus) return [];

    const targetDate = startOfDay(parseISO(targetDateStr));
    if (!isValid(targetDate)) return [];

    const targetUsers = selectedUserId === 'all'
        ? users.filter(u => u.role !== 'admin')
        : users.filter(u => u.id.toString() === selectedUserId.toString());
    
    if (targetUsers.length === 0) return [];

    const targetUserIds = new Set(targetUsers.map(u => u.id.toString()));

    const filteredTasks: Task[] = [];

    tasks.forEach(task => {
        const taskUserId = task.assigned_to?.toString();
        if (!taskUserId || !targetUserIds.has(taskUserId)) {
            return;
        }

        let statusOnDate: string | undefined = undefined;
        let latestHistoryDate: Date | null = null;

        if (task.status_history && task.status_history.length > 0) {
            task.status_history.forEach((history: StatusHistoryEntry) => {
                const historyDate = parseISO(history.changed_at);
                const historyDay = isValid(historyDate) ? startOfDay(historyDate) : null;
                if (historyDay && (isBefore(historyDay, targetDate) || isEqual(historyDay, targetDate))) {
                    if (latestHistoryDate === null || isBefore(latestHistoryDate, historyDate)) {
                        latestHistoryDate = historyDate;
                        statusOnDate = history.status;
                    } else if (isEqual(latestHistoryDate, historyDate) && history.status === 'completed') {
                        statusOnDate = history.status;
                    }
                }
            });
        }
        
        // ★★★ types.ts に合わせて taskStartDate ★★★
        if (!statusOnDate && task.start_date) {
            const startDate = startOfDay(parseISO(task.start_date));
            if (isValid(startDate) && (isBefore(startDate, targetDate) || isEqual(startDate, targetDate))) {
                statusOnDate = 'todo'; 
            }
        }
        
        if (!statusOnDate) return;

        let finalStatus: string | undefined = statusOnDate;
        if (finalStatus === 'completed') finalStatus = 'done';
        if (finalStatus === 'in-progress') finalStatus = 'inProgress';

        // ★★★ types.ts に合わせて taskDueDate ★★★
        if (task.due_date) {
            const dueDate = startOfDay(parseISO(task.due_date));
            if (isValid(dueDate) && isBefore(dueDate, targetDate) && finalStatus !== 'done') {
                 finalStatus = 'delayed';
            }
        }
        
        if (finalStatus === targetStatus) {
            filteredTasks.push(task);
        }
    });

    return filteredTasks;
};

// メトリクスの計算
const calculateMetrics = (tasks: Task[]) => {
    console.log('メトリクス計算開始:', { tasks });

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(task => task.status === 'completed').length;
    const inProgressTasks = tasks.filter(task => task.status === 'in-progress').length;
    const delayedTasks = tasks.filter(task => task.status === 'delayed').length;

    console.log('基本メトリクス:', {
        totalTasks,
        completedTasks,
        inProgressTasks,
        delayedTasks
    });

    // プロジェクト進捗の計算（完了タスク数 / 総タスク数）
    const progress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    console.log('最終メトリクス:', {
        totalTasks,
        completedTasks,
        inProgressTasks,
        delayedTasks,
        progress: Math.round(progress)
    });

    return {
        totalTasks,
        completedTasks,
        inProgressTasks,
        delayedTasks,
        progress
    };
};

const UserProgressChart: React.FC<UserProgressChartProps> = ({ tasks, users, projects }) => {
    const [selectedUserId, setSelectedUserId] = useState<string | 'all'>('all');
    const [hoveredDate, setHoveredDate] = useState<string | null>(null);
    const [statusCountsAtHoveredDate, setStatusCountsAtHoveredDate] = useState<StatusCounts>({ todo: 0, inProgress: 0, delayed: 0, done: 0 });
    const todayDateStr = useMemo(() => format(startOfDay(new Date()), 'yyyy-MM-dd'), []);
    const [todayStatusCounts, setTodayStatusCounts] = useState<StatusCounts>({ todo: 0, inProgress: 0, delayed: 0, done: 0 });
    const [selectedStatusForList, setSelectedStatusForList] = useState<string | null>(null);
    const [filteredTasksForList, setFilteredTasksForList] = useState<Task[]>([]);

    const userOptions = useMemo(() => {
        console.log('Available users:', users.map(u => ({ id: u.id, name: u.full_name || u.username })));
        return users
            .filter(u => u.role !== 'admin')
            .sort((a, b) => {
                const nameA = a.full_name || a.username || '';
                const nameB = b.full_name || b.username || '';
                return nameA.localeCompare(nameB);
            });
    }, [users]);

    useEffect(() => {
        console.log('Selected user ID:', selectedUserId);
        console.log('Available tasks:', tasks.map(t => ({ id: t.id, assigned_to: t.assigned_to })));
        
        if (selectedUserId) { 
            const counts = getStatusCountsOnDate(tasks, selectedUserId, users, todayDateStr);
            setTodayStatusCounts(counts);
            setHoveredDate(null); 
            setStatusCountsAtHoveredDate({ todo: 0, inProgress: 0, delayed: 0, done: 0 });
            setSelectedStatusForList(null); 
            setFilteredTasksForList([]); 
        } else {
            setTodayStatusCounts({ todo: 0, inProgress: 0, delayed: 0, done: 0 });
        }
    }, [selectedUserId, tasks, users, todayDateStr]);

    const chartData = useMemo(() => {
        console.log('Calculating chart data for user:', selectedUserId);
        if (!selectedUserId) {
            return [];
        } else if (selectedUserId === 'all') {
            return calculateAllUsersProgressData(tasks, users);
        } else {
            return calculateUserProgressData(tasks, selectedUserId);
        }
    }, [selectedUserId, tasks, users]);

    const handleLineChartMouseMove = useCallback((e: any) => {
        if (e && e.activePayload && e.activePayload.length > 0) {
            const currentHoveredDate = e.activePayload[0].payload.date;
            if (currentHoveredDate !== hoveredDate) {
                setHoveredDate(currentHoveredDate);
                const counts = getStatusCountsOnDate(tasks, selectedUserId, users, currentHoveredDate);
                setStatusCountsAtHoveredDate(counts);
            }
        } 
    }, [hoveredDate, tasks, selectedUserId, users]);

    const handleLineChartMouseLeave = useCallback(() => {
        setHoveredDate(null);
    }, []);

    const displayDate = hoveredDate ?? todayDateStr; 
    const displayStatusCounts = hoveredDate ? statusCountsAtHoveredDate : todayStatusCounts;
    const pieChartData = useMemo(() => {
        return Object.entries(displayStatusCounts)
            .map(([status, count]) => ({ name: status, value: count }))
            .filter(entry => entry.value > 0);
    }, [displayStatusCounts]);
    const totalPieCount = useMemo(() => pieChartData.reduce((sum, entry) => sum + entry.value, 0), [pieChartData]);

    const yAxisFormatter = (value: number) => `${value}%`;

    const CustomTooltip = ({ active, payload, label, users, selectedUserId }: any) => {
        if (active && payload && payload.length) {
            return (
                <> 
                    <Typography variant="caption" display="block" sx={{ fontWeight: 'bold', mb: 0.5, color: 'text.primary' }}> 
                        {label}
                    </Typography>
                    {payload.map((pld: any) => {
                        let name = pld.name;
                        let valueText = pld.value !== null ? yAxisFormatter(pld.value) : '-';
                        
                        if (selectedUserId === 'all') {
                            if (pld.dataKey === 'plan' || pld.dataKey === 'actual' || pld.value === null) {
                                return null;
                            }
                            const user = users.find((u: User) => u.id === pld.dataKey);
                            name = user?.full_name || user?.username || pld.dataKey;
                        } else {
                            if (pld.dataKey === 'actual') {
                                name = '実績 (完了+進行中*0.5)';
                            } else if (pld.dataKey === 'plan') {
                                name = '計画';
                            } else {
                                 return null;
                            }
                        }
                        
                        return (
                            <Typography key={pld.dataKey} variant="caption" display="block" sx={{ color: pld.color || 'text.primary' }}>
                                {`${name}: ${valueText}`}
                            </Typography>
                        )
                    })}
                </>
            );
          }
          return null;
        };

    const PieCustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <>
                    <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 'bold' }}>
                        {`${data.name}: ${data.value} 件`}
                    </Typography>
                </>
            );
        }
        return null;
    };

    useEffect(() => {
        if (selectedStatusForList && displayDate) {
            console.log(`Fetching tasks for status: ${selectedStatusForList} on date: ${displayDate}`);
            const filtered = getTasksByStatusOnDate(
                tasks,
                selectedUserId,
                users,
                displayDate,
                selectedStatusForList
            );
            setFilteredTasksForList(filtered);
        } else {
            setFilteredTasksForList([]);
        }
    }, [selectedStatusForList, displayDate, tasks, selectedUserId, users]);

    // メトリクスの表示部分
    const renderMetrics = () => {
        const metrics = calculateMetrics(tasks);
        
        return (
            <Box sx={{ mb: 3 }}>
                <Typography variant="h6" gutterBottom>
                    プロジェクトメトリクス
                </Typography>
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={6} md={3}>
                        <Paper sx={{ p: 2, textAlign: 'center' }}>
                            <Typography variant="subtitle2" color="text.secondary">
                                総タスク数
                            </Typography>
                            <Typography variant="h4">
                                {metrics.totalTasks}
                            </Typography>
                        </Paper>
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                        <Paper sx={{ p: 2, textAlign: 'center' }}>
                            <Typography variant="subtitle2" color="text.secondary">
                                完了タスク
                            </Typography>
                            <Typography variant="h4" color="success.main">
                                {metrics.completedTasks}
                            </Typography>
                        </Paper>
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                        <Paper sx={{ p: 2, textAlign: 'center' }}>
                            <Typography variant="subtitle2" color="text.secondary">
                                進行中タスク
                            </Typography>
                            <Typography variant="h4" color="info.main">
                                {metrics.inProgressTasks}
                            </Typography>
                        </Paper>
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                        <Paper sx={{ p: 2, textAlign: 'center' }}>
                            <Typography variant="subtitle2" color="text.secondary">
                                遅延タスク
                            </Typography>
                            <Typography variant="h4" color="error.main">
                                {metrics.delayedTasks}
                            </Typography>
                        </Paper>
                    </Grid>
                </Grid>
                <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        プロジェクト進捗
                    </Typography>
                    <LinearProgress 
                        variant="determinate" 
                        value={metrics.progress} 
                        sx={{ height: 10, borderRadius: 5 }}
                    />
                    <Typography variant="body2" color="text.secondary" align="right" sx={{ mt: 1 }}>
                        {Math.round(metrics.progress)}%
                    </Typography>
                </Box>
            </Box>
        );
    };

    return (
        <Paper sx={{ p: 2, height: '450px' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                 <Typography variant="h6" component="h2" sx={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                    ユーザー進捗グラフ
                 </Typography>
                 <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <FormControl size="small" sx={{ minWidth: 180, mr: 1 }}>
                        <InputLabel sx={{fontSize: '0.8rem'}}>ユーザー</InputLabel>
                        <Select
                            value={selectedUserId} 
                            label="ユーザー"
                            onChange={(e) => setSelectedUserId(e.target.value as string)}
                            sx={{fontSize: '0.8rem'}}
                            disabled={userOptions.length === 0}
                        >
                             <MenuItem value="all"><em>すべてのユーザー</em></MenuItem> 
                            {userOptions.map((user) => (
                                <MenuItem key={user.id} value={user.id}>
                                    {user.full_name || user.username}
                                </MenuItem>
                            ))}
                            {userOptions.length === 0 && <MenuItem disabled>ユーザーがいません</MenuItem>}
                        </Select>
                    </FormControl>
                    <MuiTooltip
                        title={
                            <Box sx={{ fontSize: '0.75rem' }}>
                                選択したユーザーの担当タスク進捗を表示します。<br/>
                                実績は完了(100%)と進行中(50%)を合算して評価します。<br/>
                                計画は担当タスクが期間内に均等に進む場合の理想線です。
                            </Box>
                        }
                        placement="top-start"
                    >
                        <IconButton size="small">
                            <HelpOutlineIcon fontSize="small" />
                        </IconButton>
                    </MuiTooltip>
                 </Box>
            </Box>

            <Grid container spacing={2} sx={{ height: 'calc(100% - 48px)', minHeight: '280px' }}>
                <Grid item xs={6} sx={{ height: '100%' }}>
                     {!selectedUserId && (
                         <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'text.secondary' }}>
                             <Typography variant="body2">{userOptions.length > 0 ? 'ユーザーを選択してください' : '表示可能なユーザーがいません'}</Typography>
                         </Box>
                    )}
                     {selectedUserId && chartData.length === 0 && (
                         <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'text.secondary' }}>
                             <Typography variant="body2">{selectedUserId === 'all' ? '全ユーザーの' : '選択されたユーザーの'}進捗データがありません</Typography>
                         </Box>
                    )}
                     {selectedUserId && chartData.length > 0 && (
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart 
                                data={chartData} 
                                margin={{ top: 5, right: 10, left: -20, bottom: 0 }} 
                                onMouseMove={handleLineChartMouseMove}
                                onMouseLeave={handleLineChartMouseLeave}
                            >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="date" fontSize={10} tick={{ dy: 5 }} />
                                <YAxis fontSize={10} tickFormatter={yAxisFormatter} domain={[0, 100]} />
                                <Tooltip content={<CustomTooltip users={users} selectedUserId={selectedUserId} />} />
                                <Legend wrapperStyle={{ fontSize: '0.75rem', paddingTop: '5px' }} verticalAlign="top" align="right"/>
                                
                                {selectedUserId === 'all' ? (
                                     userOptions.map((user, index) => (
                                         <Line 
                                             key={user.id} 
                                             type="monotone" 
                                             dataKey={user.id} 
                                             stroke={USER_COLORS[index % USER_COLORS.length]} 
                                             strokeWidth={1.5} 
                                             dot={false} 
                                             name={user.full_name || user.username} 
                                             connectNulls 
                                        />
                                    ))
                                ) : (
                                    <>
                                        <Line type="monotone" dataKey="plan" stroke="#8884d8" strokeWidth={2} dot={false} name="計画" connectNulls />
                                        <Line type="monotone" dataKey="actual" stroke="#82ca9d" strokeWidth={2} dot={false} name="実績 (完了+進行中*0.5)" connectNulls />
                                    </>
                                )}
                            </LineChart>
                        </ResponsiveContainer>
                     )}
                </Grid>
                <Grid item xs={6} sx={{ height: '100%' }}>
                    <Box sx={{ display: 'flex', flexDirection: 'row', height: '100%', width: '100%', gap: 1 }}>
                        
                        <Box sx={{ width: '40%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                            {selectedUserId && (
                               <Box sx={{ mb: 0, textAlign: 'center', flexShrink: 0 }}>
                                   <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                                        {displayDate}
                                   </Typography>
                                   <Typography variant="caption" display="block" sx={{ fontSize: '0.7rem' }}>
                                       {selectedUserId === 'all' ? '全ユーザー' : users.find(u => u.id.toString() === selectedUserId)?.full_name || users.find(u => u.id.toString() === selectedUserId)?.username || ''}
                                   </Typography>
                               </Box>
                           )}
                            {selectedUserId && pieChartData.length > 0 ? (
                                 <Box sx={{ width: '100%', flexGrow: 1, position: 'relative' }}> 
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart> 
                                            <Pie
                                                data={pieChartData}
                                                cx="50%"
                                                cy="45%"
                                                innerRadius="35%"
                                                outerRadius="65%" 
                                                paddingAngle={3}
                                                dataKey="value"
                                                labelLine={false}
                                                onClick={(data) => setSelectedStatusForList(data.name)}
                                            >
                                                {pieChartData.map((entry, index) => (
                                                    <Cell 
                                                        key={`cell-${index}`} 
                                                        fill={STATUS_COLORS[entry.name] || '#CCCCCC'} 
                                                        stroke={selectedStatusForList === entry.name ? '#333' : 'none'}
                                                        strokeWidth={2}
                                                        style={{ cursor: 'pointer', outline: 'none' }} 
                                                    />
                                                ))}
                                            </Pie>
                                            <Tooltip content={<PieCustomTooltip />} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                    <Typography 
                                        variant="h6"
                                        sx={{
                                            position: 'absolute',
                                            top: '45%',
                                            left: '50%',
                                            transform: 'translate(-50%, -50%)',
                                            pointerEvents: 'none',
                                            color: 'text.secondary'
                                        }}
                                    >
                                        {totalPieCount}
                                    </Typography>
                                </Box>
                            ) : (
                                <Box sx={{ flexGrow: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'text.secondary' }}> 
                                    <Typography variant="caption">
                                        {selectedUserId ? '該当データなし' : 'ユーザー未選択'}
                                   </Typography>
                                </Box>
                           )}
                           {selectedUserId && pieChartData.length > 0 && (
                                <Box sx={{ flexShrink: 0, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 8px', mt: 'auto', pb: 1, width: '100%' }}>
                                    {Object.entries(STATUS_COLORS).map(([status, color]) => {
                                         const count = displayStatusCounts[status as keyof StatusCounts] ?? 0;
                                         if (count === 0 && !pieChartData.some(d => d.name === status)) return null;
                                         return (
                                             <Box 
                                                 key={status} 
                                                 onClick={() => setSelectedStatusForList(status)} 
                                                 sx={{
                                                     display: 'flex', 
                                                     alignItems: 'center', 
                                                     cursor: 'pointer',
                                                     p: '2px 5px',
                                                     borderRadius: '4px',
                                                     backgroundColor: selectedStatusForList === status ? 'action.hover' : 'transparent',
                                                     '&:hover': {
                                                         backgroundColor: 'action.hover',
                                                     },
                                                     outline: 'none',
                                                 }}
                                                 tabIndex={0} 
                                                 onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedStatusForList(status); }}
                                             >
                                                 <Box sx={{ width: 10, height: 10, bgcolor: color, mr: 0.5 }} />
                                                 <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>
                                                     {`${status} (${count})`}
                                                </Typography>
                                            </Box>
                                        )
                                    })}
                                </Box>
                            )}
                        </Box>

                        <Box sx={{ width: '60%', height: '100%', display: 'flex', flexDirection: 'column' }}>
                             <Typography variant="caption" sx={{ fontWeight: 'bold', mb: 0.5, flexShrink: 0 }}>
                                 {selectedStatusForList ? `タスクリスト (${selectedStatusForList})` : 'タスクリスト'}
                             </Typography>
                             {selectedStatusForList ? (
                                 filteredTasksForList.length > 0 ? (
                                     <TableContainer component={Paper} sx={{ flexGrow: 1, overflowY: 'auto', overflowX: 'auto' }}>
                                         <Table stickyHeader size="small">
                                             <TableHead>
                                                 <TableRow>
                                                     <TableCell sx={{ fontSize: '0.75rem' }}>タスク名</TableCell>
                                                     {selectedUserId === 'all' && <TableCell sx={{ fontSize: '0.75rem' }}>担当</TableCell>}
                                                     <TableCell sx={{ fontSize: '0.75rem' }}>期日</TableCell>
                                                 </TableRow>
                                             </TableHead>
                                             <TableBody>
                                                 {filteredTasksForList.map((task) => (
                                                     <TableRow key={task.id}>
                                                         <TableCell sx={{ fontSize: '0.75rem' }}>{task.name}</TableCell>
                                                         {selectedUserId === 'all' && (
                                                             <TableCell sx={{ fontSize: '0.75rem' }}>
                                                                 {users.find(u => u.id === task.assigned_to)?.username || '-'}
                                                             </TableCell>
                                                         )}
                                                         <TableCell sx={{ fontSize: '0.75rem' }}>
                                                             {task.due_date ? format(parseISO(task.due_date), 'yyyy/MM/dd') : '-'}
                                                         </TableCell>
                                                     </TableRow>
                                                 ))}
                                             </TableBody>
                                         </Table>
                                     </TableContainer>
                                 ) : (
                                     <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1, color: 'text.secondary' }}>
                                         <Typography variant="caption">
                                             該当するタスクはありません。
                                         </Typography>
                                     </Box>
                                 )
                             ) : (
                                 <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1, color: 'text.secondary' }}>
                                     <Typography variant="caption" sx={{ textAlign: 'center' }}>
                                         円グラフまたは凡例をクリックすると<br/>該当タスクリストを表示します。
                                     </Typography>
                                 </Box>
                             )}
                        </Box>
                    </Box>
                </Grid>
            </Grid>

            {renderMetrics()}
        </Paper>
    );
};

export default UserProgressChart; 