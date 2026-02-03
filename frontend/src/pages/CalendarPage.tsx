import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { EventClickArg, DayCellMountArg, DateSelectArg } from '@fullcalendar/core';
import { DateClickArg } from '@fullcalendar/interaction';
import api from '../services/api';
import { Project, Task, BackendEvent, CalendarEvent, User, Group } from '../types';
import EventDetailsPanel from '../components/EventDetailsPanel';
import EventAddModal from '../components/EventAddModal';
import { useAuth } from '../contexts/AuthContext';
import { useCalendarPageState, usePageState } from '../contexts/PageStateContext';
import { format as formatDateFnsOriginal, parseISO, isSameDay, isValid as isValidDateFns, addDays } from 'date-fns';
import { Box, CircularProgress, Typography, useMediaQuery, Theme, SelectChangeEvent } from '@mui/material';
import { debounce } from 'lodash';


// ★★★ バックアップ版から getEventColor, getProjectColor, getTaskColor を移植 ★★★
const getEventColor = (type?: string): string => {
  switch (type) {
    case 'meeting': return '#1976d2';
    case 'review': return '#9c27b0';
    case 'deadline': return '#d32f2f';
    default: return '#2196f3'; // Default blue for generic events
  }
};

const getProjectColor = (project?: { status?: string | null; color?: string | null } | string): string => {
  // プロジェクトオブジェクトの場合、ステータスに基づく色のみを使用（カスタム色は無視）
  if (typeof project === 'object' && project) {
    const status = project.status;
    switch (status) {
      case 'planning': return '#FF9800';
      case 'in-progress': return '#4CAF50';
      case 'completed': return '#9E9E9E';
      default: return '#757575';
    }
  }
  // ステータス文字列の場合（後方互換性）
  const status = typeof project === 'string' ? project : undefined;
  switch (status) {
    case 'planning': return '#FF9800';
    case 'in-progress': return '#4CAF50';
    case 'completed': return '#9E9E9E';
    default: return '#757575';
  }
};

const getTaskColor = (status?: string, projectStatus?: string): string => {
  // プロジェクトが完了している場合は、タスクのステータスに関わらずグレーにする
  if (projectStatus === 'completed') {
    return '#9E9E9E';
  }
  
  switch (status) {
    case 'todo': return '#2196F3';
    case 'in-progress': return '#FF9800';
    case 'review': return '#9C27B0';
    case 'delayed': return '#F44336';
    case 'completed': return '#9E9E9E';
    default: return '#BDBDBD';
  }
};

// ★★★ バックアップ版から sortEventsForDisplay を移植 (customEventSort ではなくシンプルな方を使用) ★★★
const sortEventsForDisplay = (eventsToSort: CalendarEvent[]): CalendarEvent[] => {
  console.log("Sorting events...");
  return eventsToSort.sort((a, b) => {
    const aStart = a.start ? new Date(a.start).getTime() : 0;
    const bStart = b.start ? new Date(b.start).getTime() : 0;
    const aIsAllDay = a.allDay;
    const bIsAllDay = b.allDay;
    const aType = a.extendedProps.type;
    const bType = b.extendedProps.type;
    // プロジェクトの開始日を取得 (extendedProps 内)
    const aProjectStart = a.extendedProps.projectStartDate ? new Date(a.extendedProps.projectStartDate).getTime() : 0;
    const bProjectStart = b.extendedProps.projectStartDate ? new Date(b.extendedProps.projectStartDate).getTime() : 0;

    // 1. Projects first (sort by their start date)
    if (aType === 'project' && bType !== 'project') return -1;
    if (aType !== 'project' && bType === 'project') return 1;
    if (aType === 'project' && bType === 'project') {
      return aProjectStart - bProjectStart || (a.title || '').localeCompare(b.title || ''); // null チェック追加
    }

    // 2. Then Tasks (sort by due date)
    if (aType === 'task' && bType !== 'task') return -1;
    if (aType !== 'task' && bType === 'task') return 1;
    if (aType === 'task' && bType === 'task') {
        const aDueDate = a.extendedProps.taskDueDate ? new Date(a.extendedProps.taskDueDate).getTime() : 0;
        const bDueDate = b.extendedProps.taskDueDate ? new Date(b.extendedProps.taskDueDate).getTime() : 0;
        // 期日でソート、同じならタイトルでソート
        return aDueDate - bDueDate || (a.title || '').localeCompare(b.title || ''); // null チェック追加
    }

    // 3. Then All-day timed events (sort by start date)
    if (aIsAllDay && !bIsAllDay) return -1;
    if (!aIsAllDay && bIsAllDay) return 1;
    if (aIsAllDay && bIsAllDay) {
      return aStart - bStart || (a.title || '').localeCompare(b.title || ''); // null チェック追加
    }

    // 4. Finally, non-all-day timed events (sort by start time)
    return aStart - bStart || (a.title || '').localeCompare(b.title || ''); // null チェック追加
  });
};

const CalendarPage: React.FC = () => {
    const [rawEvents, setRawEvents] = useState<CalendarEvent[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const isSmallScreen = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
    const [isPanelMinimized, setIsPanelMinimized] = useState(false);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [users, setUsers] = useState<User[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const { user } = useAuth();
    const [dateClickArg, setDateClickArg] = useState<DateClickArg | null>(null);

    // ページ状態管理の使用
    const { calendarState, updateCalendarState, isInitialLoad, globalData, updateGlobalData } = useCalendarPageState();
    const { refreshGlobalData } = usePageState();
    
    // デフォルトの種類フィルター（永続化のマージ用）
    const DEFAULT_EVENT_TYPE_FILTER: Record<string, boolean> = {
        project: true,
        task: true,
        milestone: true,
        deadline: true,
        meeting: true,
        workshop: true,
        generic: true,
    };
    // 状態を分離（初期化時はページ状態から取得、context 復元後に上書き）
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [selectedEventDetails, setSelectedEventDetails] = useState<{ event: CalendarEvent | null; totalCost?: number; }>({ event: null });
    const [eventStatusFilter, setEventStatusFilter] = useState<string>('all'); // 'all' または プロジェクトID
    const [eventTypeFilter, setEventTypeFilter] = useState<Record<string, boolean>>(DEFAULT_EVENT_TYPE_FILTER);
    const [stateRestored, setStateRestored] = useState(false);

    const calendarRef = useRef<FullCalendar>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    // ★★★ ダブルクリック判定用の Ref と閾値を追加 ★★★
    const lastClickTimeRef = useRef<number>(0);
    const DOUBLE_CLICK_THRESHOLD = 300; // 300ms以内ならダブルクリック

    const handleResize = useCallback(debounce(() => {
        // ★★★ バックアップ版と同様に updateSize はコメントアウト推奨 ★★★
        // if (calendarRef.current) {
        //     calendarRef.current.getApi().updateSize();
        // }
    }, 100), []);

    useEffect(() => {
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, [handleResize]);

    // ★★★ パネルのミニマイズ状態が変わったらカレンダーをリサイズ ★★★
    useEffect(() => {
        if (calendarRef.current) {
            calendarRef.current.getApi().updateSize();
            // パネルのアニメーション後にも再度リサイズ（300ms後）
            setTimeout(() => {
                if (calendarRef.current) {
                    calendarRef.current.getApi().updateSize();
                }
            }, 350); // transition: width 0.3s ease-in-out に合わせて少し余裕を持たせる
        }
    }, [isPanelMinimized]);

    // ★★★ fetchData をバックアップ版のロジックに置き換え ★★★
    const fetchData = useCallback(async () => {
        console.log('Fetching calendar data...');
        setLoading(true);
        setError(null);
        try {
            const [projectsResponse, tasksResponse, eventsResponse, usersResponse, groupsResponse] = await Promise.all([
                api.get<Project[]>('/projects'),
                api.get<Task[]>('/tasks'),
                api.get<BackendEvent[]>('/calendar/events'), // 通常のイベントも取得
                api.get<User[]>('/api/users'),
                api.get<Group[]>('/api/groups')
            ]);

            const projectsData = projectsResponse.data;
            const tasksData = tasksResponse.data;
            const backendEventsData = eventsResponse.data; // 通常イベント用
            const usersData = usersResponse.data;
            const groupsData = groupsResponse.data;

            // ★★★ デバッグログ: /tasks APIからの生データを表示 ★★★
            console.log("[fetchData] Raw tasksData from /tasks API:", JSON.stringify(tasksData, null, 2));

            setProjects(projectsData);
            setTasks(tasksData);
            setUsers(usersData);
            setGroups(groupsData);

            // ★★★ デバッグログ: APIからの生データを表示 ★★★
            console.log("[fetchData] Raw backendEventsData:", backendEventsData);

            // 1. Process Projects into CalendarEvents
            const projectEvents: CalendarEvent[] = projectsData
                .filter(project => project.start_date) // 開始日がないものは除外
                .map((project) => ({
                    id: `proj-${project.id}`,
                    title: project.name,
                    start: project.start_date ? parseISO(project.start_date) : new Date(),
                    end: project.end_date ? addDays(parseISO(project.end_date), 1) : undefined, // FullCalendarの終日イベントは排他的なので+1日
                    allDay: true, 
                    backgroundColor: getProjectColor(project),
                    borderColor: getProjectColor(project),
                    extendedProps: {
                        type: 'project',
                        projectId: String(project.id),
                        projectStatus: project.status,
                        projectDescription: project.description,
                        projectStartDate: project.start_date,
                        projectEndDate: project.end_date,
                        projectColor: project.color,
                        description: project.description,
                        location: undefined,
                        participants: undefined,
                        taskDueDate: undefined,
                        taskAssigneeId: undefined,
                        taskCost: undefined,
                        taskStatus: undefined,
                        status: undefined,
                        displayStatus: project.display_status as 'online' | 'offline' | 'archived' | undefined,
                        dependsOn: undefined,
                    },
                }));

            // 2. Process Tasks into CalendarEvents
            const taskEvents: CalendarEvent[] = tasksData
                .filter(task => task.due_date)
                .map((task) => {
                    const project = projectsData.find(p => p.id === task.project_id);
                    return {
                    id: `task-${task.id}`,
                    title: task.name,
                        start: task.due_date ? parseISO(task.due_date) : new Date(),
                        end: undefined,
                        allDay: true,
                        backgroundColor: getTaskColor(task.status ?? 'todo', project?.status ?? undefined),
                        borderColor: getTaskColor(task.status ?? 'todo', project?.status ?? undefined),
                    extendedProps: {
                            type: 'task',
                            taskId: task.id,
                            description: task.description,
                        location: undefined,
                        participants: undefined,
                        projectId: task.project_id ? String(task.project_id) : undefined,
                        taskDueDate: task.due_date,
                        taskStartDate: task.start_date ?? undefined,
                        taskAssigneeId: task.assigned_to ? String(task.assigned_to) : undefined,
                        taskCost: task.cost,
                        taskStatus: task.status,
                        taskPriority: task.priority ?? undefined,
                        taskType: task.type ?? undefined,
                        taskSeqID: task.seqID ?? undefined,
                        taskShotID: task.shotID ?? undefined,
                            status: undefined,
                            displayStatus: project?.display_status as 'online' | 'offline' | 'archived' | undefined,
                            dependsOn: task.dependsOn,
                        },
                    };
                });

            // 3. Process BackendEvents (regular events from /calendar/events) into CalendarEvents
            const processedBackendEvents: CalendarEvent[] = backendEventsData
                .map((be): CalendarEvent | null => {
                    const eventType = be.type;
                    const originalStartTimeStr = be.start_time as string;
                    const originalEndTimeStr = be.end_time as string;

                    if (!originalStartTimeStr) {
                        console.warn("Event without start_time skipped:", be);
                        return null;
                    }

                    if (eventType === 'Task') {
                        console.warn("[fetchData] Task type event found in backendEventsData, should be handled by taskEvents. Skipping in processedBackendEvents:", be);
                        return null;
                    } else if (eventType === 'Project') {
                        console.warn("[fetchData] Project type event found in backendEventsData, should be handled by projectEvents. Skipping in processedBackendEvents:", be);
                        return null;
                    } else {
                        const project = be.project_id ? projectsData.find(p => p.id === be.project_id) : undefined;
                        // プロジェクトが完了している場合はグレーにする
                        const isCompletedProject = project?.status === 'completed';
                        const eventColor = isCompletedProject ? '#9E9E9E' : getEventColor(be.type ?? 'Generic');
                        
                        return {
                    id: `event-${be.id}`,
                            title: be.title,
                            start: parseISO(originalStartTimeStr),
                            end: originalEndTimeStr ? parseISO(originalEndTimeStr) : undefined,
                            allDay: be.allDay ?? false,
                            backgroundColor: eventColor,
                            borderColor: eventColor,
                    extendedProps: {
                                type: be.type || 'Generic',
                        description: be.description ?? undefined,
                        location: be.location ?? undefined,
                        participants: be.participants ?? undefined,
                        projectId: be.project_id ? String(be.project_id) : undefined,
                                status: be.status ?? undefined,
                                displayStatus: project?.display_status as 'online' | 'offline' | 'archived' | undefined,
                            },
                        };
                    }
                })
                .filter((event): event is CalendarEvent => event !== null);
            
            console.log("[fetchData] Processed projectEvents:", projectEvents.length);
            console.log("[fetchData] Processed taskEvents:", taskEvents.length);
            console.log("[fetchData] Processed processedBackendEvents:", processedBackendEvents.length);

            // バックエンドイベントを保存
            setBackendEvents(processedBackendEvents);

            const allCalendarEvents = sortEventsForDisplay([
                ...projectEvents, 
                ...taskEvents, 
                ...processedBackendEvents
            ]);
            console.log("[fetchData] Total events for calendar after merge and sort:", allCalendarEvents.length);
            
            // ★★★ 重複を防ぐため、既存のイベントをクリアしてから新しいイベントを設定 ★★★
            setRawEvents([]); // まず空にする
            setTimeout(() => {
                setRawEvents(allCalendarEvents); // 新しいイベントを設定
            }, 0);
            
            // グローバルデータも更新（eventsは各ページで生成されるため含めない）
            if (updateGlobalData) {
                updateGlobalData({
                    tasks: tasksData,
                    projects: projectsData,
                    users: usersData,
                    groups: groupsData,
                });
            }

        } catch (err) {
            console.error("Failed to fetch and process calendar data:", err);
            setError('カレンダーデータの取得または処理に失敗しました。');
        } finally {
            setLoading(false);
        }
    }, []); // 依存関係を空にして無限ループを防ぐ

    // バックエンドイベント用の状態
    const [backendEvents, setBackendEvents] = useState<CalendarEvent[]>([]);

    // バックエンドイベントを取得する専用のuseEffect（タブ切り替え時も実行）
    useEffect(() => {
        const fetchBackendEventsOnMount = async () => {
            try {
                console.log('[CalendarPage] Fetching backend events...');
                const eventsResponse = await api.get<BackendEvent[]>('/calendar/events');
                const backendEventsData = eventsResponse.data;
                
                const processedBackendEvents: CalendarEvent[] = backendEventsData
                    .map((be): CalendarEvent | null => {
                        const eventType = be.type;
                        const originalStartTimeStr = be.start_time as string;
                        const originalEndTimeStr = be.end_time as string;

                        if (!originalStartTimeStr) {
                            console.warn("Event without start_time skipped:", be);
                            return null;
                        }

                        if (eventType === 'Task' || eventType === 'Project') {
                            return null;
                        } else {
                            const project = projects.find(p => p.id === be.project_id);
                            // プロジェクトが完了している場合はグレーにする
                            const isCompletedProject = project?.status === 'completed';
                            const eventColor = isCompletedProject ? '#9E9E9E' : getEventColor(be.type ?? 'Generic');
                            
                            return {
                                id: `event-${be.id}`,
                                title: be.title,
                                start: parseISO(originalStartTimeStr),
                                end: originalEndTimeStr ? parseISO(originalEndTimeStr) : undefined,
                                allDay: be.allDay ?? false,
                                backgroundColor: eventColor,
                                borderColor: eventColor,
                                extendedProps: {
                                    type: be.type || 'Generic',
                                    description: be.description ?? undefined,
                                    location: be.location ?? undefined,
                                    participants: be.participants ?? undefined,
                                    projectId: be.project_id ? String(be.project_id) : undefined,
                                    status: be.status ?? undefined,
                                    displayStatus: project?.display_status as 'online' | 'offline' | 'archived' | undefined,
                                },
                            };
                        }
                    })
                    .filter((event): event is CalendarEvent => event !== null);
                
                console.log('[CalendarPage] Backend events loaded:', processedBackendEvents.length);
                setBackendEvents(processedBackendEvents);
            } catch (err) {
                console.error('[CalendarPage] Failed to fetch backend events:', err);
            }
        };

        // データが存在する場合のみ取得（初期化完了後）
        if ((tasks.length > 0 || projects.length > 0) || !loading) {
            fetchBackendEventsOnMount();
        }
    }, [tasks.length, projects.length, loading, globalData.lastFetched]); // タスク・プロジェクトのデータ変更時にも実行

    // グローバルデータの変更を直接監視（より確実な方法）
    useEffect(() => {
        if (globalData && globalData.tasks && globalData.tasks.length > 0) {
            console.log("[CalendarPage] Global data updated, refreshing local state...");
            console.log("[CalendarPage] Tasks count:", globalData.tasks.length);
            setTasks(globalData.tasks);
        }
        if (globalData && globalData.projects && globalData.projects.length > 0) {
            console.log("[CalendarPage] Projects count:", globalData.projects.length);
            setProjects(globalData.projects);
        }
        if (globalData && globalData.users && globalData.users.length > 0) {
            console.log("[CalendarPage] Users count:", globalData.users.length);
            setUsers(globalData.users);
        }
        if (globalData && globalData.groups && globalData.groups.length > 0) {
            console.log("[CalendarPage] Groups count:", globalData.groups.length);
            setGroups(globalData.groups);
        }
        // イベントはtasksとprojectsから自動生成されるため、ここでは設定しない
    }, [globalData.tasks, globalData.projects, globalData.users, globalData.groups, globalData.lastFetched]);

    // globalDataRefreshedイベントをリッスンしてデータを強制更新
    useEffect(() => {
        const handleGlobalDataRefresh = (event: CustomEvent) => {
            console.log("[CalendarPage] Global data refreshed event received, updating local state...");
            console.log("[CalendarPage] Received data:", {
                tasks: event.detail.tasks?.length || 0,
                projects: event.detail.projects?.length || 0,
                users: event.detail.users?.length || 0,
                groups: event.detail.groups?.length || 0
            });
            const { tasks, projects, users, groups } = event.detail;
            setTasks(tasks || []);
            setProjects(projects || []);
            setUsers(users || []);
            setGroups(groups || []);
            // イベントはtasksとprojectsの更新時にuseEffectで自動的に再生成される
        };

        const handleCsvImportCompleted = async (event: CustomEvent) => {
            console.log("[CalendarPage] CSV import completed event received:", event.detail);
            // CSVインポート完了時はグローバルデータの更新を待つ
            if (refreshGlobalData) {
                console.log("[CalendarPage] Refreshing global data after CSV import...");
                await refreshGlobalData();
            }
        };

        console.log("[CalendarPage] Adding globalDataRefreshed and csvImportCompleted event listeners");
        window.addEventListener('globalDataRefreshed', handleGlobalDataRefresh as unknown as EventListener);
        window.addEventListener('csvImportCompleted', handleCsvImportCompleted as unknown as EventListener);
        
        return () => {
            console.log("[CalendarPage] Removing globalDataRefreshed and csvImportCompleted event listeners");
            window.removeEventListener('globalDataRefreshed', handleGlobalDataRefresh as unknown as EventListener);
            window.removeEventListener('csvImportCompleted', handleCsvImportCompleted as unknown as EventListener);
        };
    }, [refreshGlobalData]);

    // プロジェクト変更イベントをリッスンしてタスクデータを強制更新
    useEffect(() => {
        const handleProjectDeleted = async (event: CustomEvent) => {
            console.log("[CalendarPage] Project deleted event received:", event.detail);
            // プロジェクト削除時はタスクも削除されるため、グローバルデータの更新を待つ
            if (refreshGlobalData) {
                console.log("[CalendarPage] Refreshing global data after project deletion...");
                await refreshGlobalData();
            }
        };

        const handleProjectUpdated = async (event: CustomEvent) => {
            console.log("[CalendarPage] Project updated event received:", event.detail);
            // プロジェクト更新時はタスクデータも再取得
            if (refreshGlobalData) {
                console.log("[CalendarPage] Refreshing global data after project update...");
                await refreshGlobalData();
            }
        };

        const handleProjectStatusUpdated = async (event: CustomEvent) => {
            console.log("[CalendarPage] Project status updated event received:", event.detail);
            // プロジェクト表示ステータス更新時はタスクデータも再取得
            if (refreshGlobalData) {
                console.log("[CalendarPage] Refreshing global data after project status update...");
                await refreshGlobalData();
            }
        };

        console.log("[CalendarPage] Adding project change event listeners");
        window.addEventListener('projectDeleted', handleProjectDeleted as unknown as EventListener);
        window.addEventListener('projectUpdated', handleProjectUpdated as unknown as EventListener);
        window.addEventListener('projectStatusUpdated', handleProjectStatusUpdated as unknown as EventListener);
        
        return () => {
            console.log("[CalendarPage] Removing project change event listeners");
            window.removeEventListener('projectDeleted', handleProjectDeleted as unknown as EventListener);
            window.removeEventListener('projectUpdated', handleProjectUpdated as unknown as EventListener);
            window.removeEventListener('projectStatusUpdated', handleProjectStatusUpdated as unknown as EventListener);
        };
    }, [refreshGlobalData]);

    // タスクとプロジェクトのデータが更新された時にイベントを再生成
    // ★★★ ローカルのタスク・プロジェクトが変更された場合のみイベントを再生成 ★★★
    useEffect(() => {
        // タスクとプロジェクトが存在し、かつローディング中でない場合のみ実行
        if ((tasks.length > 0 || projects.length > 0) && !loading) {
            console.log("[CalendarPage] Regenerating events from tasks and projects");
            
            const taskEvents = tasks
                .filter(task => task.due_date) // 期日がないタスクは除外
                .map(task => {
                    const project = projects.find(p => p.id === task.project_id);
                    return {
                        id: `task-${task.id}`,
                        title: task.name || 'Untitled Task',
                        start: task.due_date ? parseISO(task.due_date) : new Date(),
                        end: undefined,
                        allDay: true,
                        backgroundColor: getTaskColor(task.status ?? 'todo', project?.status ?? undefined),
                        borderColor: getTaskColor(task.status ?? 'todo', project?.status ?? undefined),
                        extendedProps: {
                            type: 'task',
                            taskId: task.id,
                            description: task.description,
                            location: undefined,
                            participants: undefined,
                            projectId: task.project_id ? String(task.project_id) : undefined,
                            taskDueDate: task.due_date,
                            taskStartDate: task.start_date ?? undefined,
                            taskAssigneeId: task.assigned_to ? String(task.assigned_to) : undefined,
                            taskCost: task.cost,
                            taskStatus: task.status,
                            taskPriority: task.priority ?? undefined,
                            taskType: task.type ?? undefined,
                            taskSeqID: task.seqID ?? undefined,
                            taskShotID: task.shotID ?? undefined,
                            status: undefined,
                            displayStatus: project?.display_status as 'online' | 'offline' | 'archived' | undefined,
                            dependsOn: task.dependsOn,
                        }
                    };
                });

            const projectEvents = projects
                .filter(project => project.start_date) // 開始日がないプロジェクトは除外
                .map(project => ({
                    id: `proj-${project.id}`,
                    title: project.name || 'Untitled Project',
                    start: project.start_date ? parseISO(project.start_date) : new Date(),
                    end: project.end_date ? addDays(parseISO(project.end_date), 1) : undefined, // FullCalendarの終日イベントは排他的なので+1日
                    allDay: true,
                    backgroundColor: getProjectColor(project),
                    borderColor: getProjectColor(project),
                    extendedProps: {
                        type: 'project',
                        projectId: String(project.id),
                        projectStatus: project.status,
                        projectDescription: project.description,
                        projectStartDate: project.start_date,
                        projectEndDate: project.end_date,
                        projectColor: project.color,
                        description: project.description,
                        location: undefined,
                        participants: undefined,
                        taskDueDate: undefined,
                        taskAssigneeId: undefined,
                        taskCost: undefined,
                        taskStatus: undefined,
                        status: undefined,
                        displayStatus: project.display_status as 'online' | 'offline' | 'archived' | undefined,
                        dependsOn: undefined,
                    }
                }));

            // バックエンドイベントと統合
            const allCalendarEvents = sortEventsForDisplay([
                ...projectEvents, 
                ...taskEvents, 
                ...backendEvents
            ]);
            
            console.log("[CalendarPage] Setting rawEvents with", allCalendarEvents.length, "events");
            setRawEvents(allCalendarEvents);
        }
    }, [tasks, projects, backendEvents, loading]);

    // タブを開いた時に最新データを取得（バックグラウンド）
    useEffect(() => {
        // グローバルデータが既に存在する場合は使用
        if (globalData && globalData.tasks && globalData.tasks.length > 0 && globalData.projects && globalData.projects.length > 0) {
            console.log("[CalendarPage] Using existing global data...");
            setTasks(globalData.tasks);
            setProjects(globalData.projects);
            setUsers(globalData.users || []);
            setGroups(globalData.groups || []);
            
            // イベントはtasksとprojectsの更新時にuseEffectで自動的に再生成される
            setLoading(false);
            
            // バックエンドイベントも再取得（通常のイベント用）
            const fetchBackendEvents = async () => {
                try {
                    console.log('[CalendarPage] Fetching backend events...');
                    const eventsResponse = await api.get<BackendEvent[]>('/calendar/events');
                    const backendEventsData = eventsResponse.data;
                    
                    const processedBackendEvents: CalendarEvent[] = backendEventsData
                        .map((be): CalendarEvent | null => {
                            const eventType = be.type;
                            const originalStartTimeStr = be.start_time as string;
                            const originalEndTimeStr = be.end_time as string;

                            if (!originalStartTimeStr) {
                                console.warn("Event without start_time skipped:", be);
                                return null;
                            }

                            if (eventType === 'Task') {
                                console.warn("[CalendarPage] Task type event found in backendEventsData, should be handled by taskEvents. Skipping:", be);
                                return null;
                            } else if (eventType === 'Project') {
                                console.warn("[CalendarPage] Project type event found in backendEventsData, should be handled by projectEvents. Skipping:", be);
                                return null;
                            } else {
                                const project = be.project_id ? globalData.projects?.find(p => p.id === be.project_id) : undefined;
                                // プロジェクトが完了している場合はグレーにする
                                const isCompletedProject = project?.status === 'completed';
                                const eventColor = isCompletedProject ? '#9E9E9E' : getEventColor(be.type ?? 'Generic');
                                
                                return {
                                    id: `event-${be.id}`,
                                    title: be.title,
                                    start: parseISO(originalStartTimeStr),
                                    end: originalEndTimeStr ? parseISO(originalEndTimeStr) : undefined,
                                    allDay: be.allDay ?? false,
                                    backgroundColor: eventColor,
                                    borderColor: eventColor,
                                    extendedProps: {
                                        type: be.type || 'Generic',
                                        description: be.description ?? undefined,
                                        location: be.location ?? undefined,
                                        participants: be.participants ?? undefined,
                                        projectId: be.project_id ? String(be.project_id) : undefined,
                                        status: be.status ?? undefined,
                                        displayStatus: project?.display_status as 'online' | 'offline' | 'archived' | undefined,
                                    },
                                };
                            }
                        })
                        .filter((event): event is CalendarEvent => event !== null);
                    
                    console.log('[CalendarPage] Backend events loaded:', processedBackendEvents.length);
                    setBackendEvents(processedBackendEvents);
                } catch (err) {
                    console.error('[CalendarPage] Failed to fetch backend events:', err);
                }
            };
            
            fetchBackendEvents();
            
            // バックグラウンドで最新データを取得
            if (refreshGlobalData) {
                console.log("[CalendarPage] Refreshing data in background...");
                refreshGlobalData().then(() => {
                    console.log("[CalendarPage] Background refresh completed");
                });
            }
            return;
        }

        // 初回ロード時のみローディング表示してデータを取得
        if (isInitialLoad && (!globalData || !globalData.tasks || globalData.tasks.length === 0)) {
            console.log("[CalendarPage] Fetching data on initial load...");
            fetchData();
        } else if (!globalData || !globalData.tasks || globalData.tasks.length === 0) {
            // 初回ロードでない場合でもデータがない場合は取得
            console.log("[CalendarPage] No data available, fetching...");
            fetchData();
        }
    }, [isInitialLoad, refreshGlobalData]); // refreshGlobalDataを依存関係に追加

    // ページ状態が復元されたらローカル状態を更新（ページ切り替え・更新後もフィルターを維持）
    useEffect(() => {
        if (!isInitialLoad) {
            if (calendarState.selectedDate) {
                setSelectedDate(new Date(calendarState.selectedDate));
            }
            if (calendarState.selectedEvent) {
                setSelectedEventDetails({ event: calendarState.selectedEvent });
            }
            if (calendarState.filterStatus !== undefined && calendarState.filterStatus !== '') {
                setEventStatusFilter(calendarState.filterStatus);
            } else if (calendarState.filterStatus === '') {
                setEventStatusFilter('all');
            }
            if (calendarState.eventTypeFilter && typeof calendarState.eventTypeFilter === 'object') {
                setEventTypeFilter(prev => ({ ...DEFAULT_EVENT_TYPE_FILTER, ...prev, ...calendarState.eventTypeFilter } as Record<string, boolean>));
            }
            setStateRestored(true);
        }
    }, [calendarState, isInitialLoad]);

    // フィルター状態の変更をページ状態に反映（状態復元が完了した後のみ）→ sessionStorage で永続化
    useEffect(() => {
        if (stateRestored) {
            updateCalendarState({
                selectedDate: selectedDate?.toISOString() || null,
                selectedEvent: selectedEventDetails.event,
                filterStatus: eventStatusFilter,
                eventTypeFilter,
            });
        }
    }, [selectedDate, selectedEventDetails, eventStatusFilter, eventTypeFilter, stateRestored, updateCalendarState]);

    const filterEvents = useCallback((events: CalendarEvent[]) => {
        return events.filter(event => {
            const eventProjectId = event.extendedProps?.projectId;
            const eventType = event.extendedProps?.type?.toLowerCase();
            const eventId = event.id;

            // プロジェクトフィルターのチェック
            let projectFilterPass = true;
            if (eventStatusFilter !== 'all') {
                // プロジェクト自体の場合
                if (eventType === 'project' && String(eventId) === eventStatusFilter) {
                    projectFilterPass = true;
                }
                // プロジェクトに紐づくイベントの場合
                else if (eventProjectId && String(eventProjectId) === eventStatusFilter) {
                    projectFilterPass = true;
                } else {
                    projectFilterPass = false;
                }
            }

            // イベントタイプフィルターのチェック（チェックボックスでオンの種類のみ表示）
            const typeKey = (eventType || 'generic').toLowerCase();
            const typeFilterPass = eventTypeFilter[typeKey] !== false;

            // 両方のフィルターを通過したイベントのみ表示
            return projectFilterPass && typeFilterPass;
        });
    }, [eventStatusFilter, eventTypeFilter]);

    const filteredEvents = useMemo(() => {
        return filterEvents(rawEvents);
    }, [rawEvents, filterEvents]);

    // FullCalendarに渡す前に、endがnullのイベントをundefinedに変換
    const eventsForFullCalendar = useMemo(() => {
        return filteredEvents.map(event => {
            let startStr: string | undefined = undefined;
            let endStr: string | undefined = undefined;

            if (event.start) {
                const startDateObj = (typeof event.start === 'string') ? parseISO(event.start) : event.start;
                if (isValidDateFns(startDateObj)) {
                    if (event.allDay) {
                        startStr = formatDateFnsOriginal(startDateObj, "yyyy-MM-dd");
                    } else {
                        startStr = formatDateFnsOriginal(startDateObj, "yyyy-MM-dd'T'HH:mm:ssXXX");
                    }
                }
            }
            if (event.end) {
                const endDateObj = (typeof event.end === 'string') ? parseISO(event.end) : event.end;
                if (isValidDateFns(endDateObj)) {
                    if (event.allDay) {
                        endStr = formatDateFnsOriginal(endDateObj, "yyyy-MM-dd");
                    } else {
                        endStr = formatDateFnsOriginal(endDateObj, "yyyy-MM-dd'T'HH:mm:ssXXX");
                    }
                }
            }

            return {
                ...event,
                start: startStr,
                end: endStr,
            };
        });
    }, [filteredEvents]);

    const handleEventStatusFilterChange = (event: SelectChangeEvent<string>) => {
        setEventStatusFilter(event.target.value);
    };

    const handleEventTypeFilterChange = (typeKey: string, checked: boolean) => {
        setEventTypeFilter(prev => ({ ...prev, [typeKey]: checked }));
    };

    // ★★★ calculateTotalCost は rawEvents を使うように修正 ★★★
    const calculateTotalCost = useCallback((eventsToConsider: CalendarEvent[]) => {
        return eventsToConsider
            .filter(event => event.extendedProps.type === 'task' && typeof event.extendedProps.taskCost === 'number')
            .reduce((sum, event) => sum + (event.extendedProps.taskCost || 0), 0);
    }, []);

    // ★★★ handleDateClick をダブルクリック対応に修正 ★★★
    const handleDateClick = (arg: DateClickArg) => {
        const now = new Date().getTime();
        const clickTime = now;

        if (clickTime - lastClickTimeRef.current < DOUBLE_CLICK_THRESHOLD) {
            console.log("[CalendarPage] Double clicked on date:", arg.date);
            handleOpenAddModal({ start: arg.date, allDay: arg.allDay } as DateSelectArg);
        } else {
            console.log("[CalendarPage] Single clicked on date:", arg.date);
            const newSelectedDate = arg.date;
            setSelectedDate(newSelectedDate);
            setSelectedEventDetails({ event: null }); 
            console.log("[CalendarPage] After click - selectedDate:", newSelectedDate, "selectedEventDetails.event:", null);
        }
        lastClickTimeRef.current = clickTime;
    };

    const handleEventClick = (clickInfo: EventClickArg) => {
        // ★★★ 修正: rawEvents を直接参照 ★★★
        const clickedEvent = rawEvents.find(event => event.id === clickInfo.event.id);
        if (clickedEvent) {
            let totalCost: number | undefined = undefined;
            if (clickedEvent.extendedProps.type === 'Task') {
                totalCost = clickedEvent.extendedProps.taskCost ?? 0;
            } else if (clickedEvent.start) {
                // ★★★ 修正: rawEvents を直接参照 ★★★
                const dayEvents = rawEvents.filter(event => event.start && isSameDay(parseISO(event.start as string), parseISO(clickedEvent.start as string)));
                totalCost = calculateTotalCost(dayEvents);
            }
            if (clickedEvent.start) {
                setSelectedDate(clickedEvent.start instanceof Date ? clickedEvent.start : parseISO(clickedEvent.start as string));
            }
            // ★★★ デバッグログ追加: EventDetailsPanelに渡す直前のclickedEventの内容 ★★★
            console.log("[CalendarPage:handleEventClick] Event being set to EventDetailsPanel (clickedEvent):", JSON.stringify(clickedEvent, null, 2));
            setSelectedEventDetails({ event: clickedEvent, totalCost });
            setIsPanelMinimized(false);
        } else {
            setSelectedEventDetails({ event: null });
        }
    };

    const handlePanelEventSelect = (event: CalendarEvent) => {
        console.log("[CalendarPage] handlePanelEventSelect called with event:", JSON.parse(JSON.stringify(event))); // ★★★ ログ追加 ★★★
        const cost = event.extendedProps.type === 'Task' ? (event.extendedProps.taskCost ?? 0) : undefined;
        let totalCost = cost;
        if (event.start && !cost) {
            // ★★★ 修正: rawEvents を直接参照 ★★★
            const dayEvents = rawEvents.filter(e => e.start && isSameDay(parseISO(e.start as string), parseISO(event.start as string)));
            totalCost = calculateTotalCost(dayEvents);
        }
        if (event.start) {
            setSelectedDate(event.start instanceof Date ? event.start : parseISO(event.start as string));
        }
        setSelectedEventDetails({ event, totalCost });
        setIsPanelMinimized(false);
    };

    const handleOpenAddModal = (selectInfo?: DateSelectArg) => {
        if (selectInfo) {
            const dateClickArg: DateClickArg = {
                date: selectInfo.start,
                dateStr: selectInfo.startStr,
                dayEl: document.createElement('div'),
                jsEvent: new MouseEvent('click'),
                view: selectInfo.view,
                allDay: selectInfo.allDay
            };
            setDateClickArg(dateClickArg);
        } else {
            setDateClickArg(null);
        }
        setIsAddModalOpen(true);
    };

    const handleOpenEditModal = (event: CalendarEvent) => {
        console.log("Opening edit modal for:", event);
        const cost = event.extendedProps.type === 'task' ? (event.extendedProps.taskCost ?? 0) : undefined;
        setSelectedEventDetails({ event: event, totalCost: cost });
        setIsAddModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsAddModalOpen(false);
    };

    // ★★★ handleSaveEvent の API コール部分のコメントアウトを解除 ★★★
    const handleSaveEvent = async (
        modalData: Partial<BackendEvent & {
            display_status?: 'online' | 'offline' | 'archived' | string | null;
        }>
    ) => {
        console.log("--- handleSaveEvent STARTED ---");
        console.log("[CalendarPage] handleSaveEvent received:", modalData);

        setLoading(true);
        setError(null);

        const apiData = {
            title: modalData.title,
            description: modalData.description,
            type: modalData.type || 'Generic',
            location: modalData.location,
            allDay: modalData.allDay,
            start_time: modalData.start_time,
            end_time: modalData.end_time,
            status: modalData.status,
            project_id: modalData.project_id ? parseInt(String(modalData.project_id)) : undefined,
            participants: modalData.participants,
        };
        console.log('apiData before delete:', apiData);
        delete (apiData as any).id;
        delete (apiData as any).created_at;
        delete (apiData as any).updated_at;
        console.log("Constructed common apiData for save/update:", apiData); 

        const modalId = modalData.id;
        const selectedId = selectedEventDetails.event?.id;
        const eventId = modalId ? String(modalId) : selectedId;
        console.log(`Determining eventId: modalData.id=${modalId}, selectedEventDetails.event?.id=${selectedId}, final eventId=${eventId}`);

        try {
            let response;
            const numericIdForApi = eventId ? eventId.replace(/^(proj-|task-|event-)/, '') : null;

            const typeForSave = modalData.type || selectedEventDetails.event?.extendedProps?.type || 'Generic';
            const normalizedType = typeForSave.charAt(0).toUpperCase() + typeForSave.slice(1).toLowerCase();

            if (numericIdForApi) {
                if (normalizedType === 'Task') {
                    const md: any = modalData;
                    // assigned_toはEventAddModalから既に設定されているので、それを優先使用
                    let assignedToValue: number | undefined = undefined;
                    if (md.assigned_to !== null && md.assigned_to !== undefined) {
                        assignedToValue = typeof md.assigned_to === 'number' ? md.assigned_to : parseInt(String(md.assigned_to), 10);
                    } else if (md.taskAssigneeId) {
                        // フォールバック: taskAssigneeIdから値を取得
                        const taskAssigneeIdStr = String(md.taskAssigneeId);
                        const match = taskAssigneeIdStr.match(/^(user|group)-(\d+)$/);
                        if (match) {
                            assignedToValue = parseInt(match[2], 10);
                        }
                    }
                    
                    // due_dateのフォーマット処理（yyyy-MM-dd形式の場合はISO形式に変換）
                    let dueDateValue: string | undefined = undefined;
                    if (md.due_date) {
                        // 既にISO形式の場合はそのまま使用
                        if (typeof md.due_date === 'string' && md.due_date.includes('T')) {
                            dueDateValue = md.due_date;
                        } else if (typeof md.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(md.due_date)) {
                            dueDateValue = `${md.due_date}T00:00:00+09:00`;
                        } else {
                            dueDateValue = md.due_date;
                        }
                    } else if (md.taskDueDate) {
                        // yyyy-MM-dd形式の場合はISO形式に変換
                        if (typeof md.taskDueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(md.taskDueDate)) {
                            dueDateValue = `${md.taskDueDate}T00:00:00+09:00`;
                        } else {
                            dueDateValue = md.taskDueDate;
                        }
                    }
                    
                    // priorityの処理（小文字を大文字に変換、またはundefined）
                    let priorityValue: string | undefined = undefined;
                    if (md.priority) {
                        const priorityStr = String(md.priority).toLowerCase();
                        if (priorityStr === 'low') {
                            priorityValue = 'LOW';
                        } else if (priorityStr === 'medium') {
                            priorityValue = 'MEDIUM';
                        } else if (priorityStr === 'high') {
                            priorityValue = 'HIGH';
                        }
                    }
                    
                    // seqIDとshotIDの処理（空文字列の場合はundefined）
                    const seqIDValue = md.seqID && md.seqID.trim() !== '' ? md.seqID.trim() : undefined;
                    const shotIDValue = md.shotID && md.shotID.trim() !== '' ? md.shotID.trim() : undefined;
                    
                    const taskData = {
                        name: md.title,
                        description: md.description || '',
                        status: md.status || 'todo',
                        due_date: dueDateValue,
                        project_id: md.project_id ? parseInt(String(md.project_id)) : undefined,
                        assigned_to: assignedToValue,
                        cost: md.cost ? Number(md.cost) : (md.taskCost ? Number(md.taskCost) : 0),
                        dependsOn: md.dependsOn || [],
                        start_date: md.start_time,
                        priority: priorityValue,
                        type: md.taskType && md.taskType.trim() !== '' ? md.taskType.trim() : undefined,
                        seqID: seqIDValue,
                        shotID: shotIDValue,
                    };
                    console.log(`Updating task (PUT) with numeric ID: ${numericIdForApi}`, taskData);
                    response = await api.put(`/tasks/${numericIdForApi}`, taskData);
                } else if (normalizedType === 'Project') {
                    const md: any = modalData;
                    const projectData = {
                        name: md.title,
                        description: md.description || md.projectDescription || '',
                        status: md.status || md.projectStatus || 'planning',
                        start_date: md.projectStartDate || md.start_time,
                        end_date: md.projectEndDate || md.end_time,
                        display_status: md.display_status,
                        color: md.color,
                    };
                    console.log(`Updating project (PUT) with numeric ID: ${numericIdForApi}`, projectData);
                    response = await api.put(`/projects/${numericIdForApi}`, projectData);
                } else {
                    console.log(`Updating event (PUT) with numeric ID: ${numericIdForApi}`, apiData);
                    response = await api.put(`/calendar/events/${numericIdForApi}`, apiData);
                }
            } else {
                if (normalizedType === 'Task') {
                    const md: any = modalData; 
                    // assigned_toはEventAddModalから既に設定されているので、それを優先使用
                    let assignedToValue: number | undefined = undefined;
                    if (md.assigned_to !== null && md.assigned_to !== undefined) {
                        assignedToValue = typeof md.assigned_to === 'number' ? md.assigned_to : parseInt(String(md.assigned_to), 10);
                    } else if (md.taskAssigneeId) {
                        // フォールバック: taskAssigneeIdから値を取得
                        const taskAssigneeIdStr = String(md.taskAssigneeId);
                        const match = taskAssigneeIdStr.match(/^(user|group)-(\d+)$/);
                        if (match) {
                            assignedToValue = parseInt(match[2], 10);
                        }
                    }
                    
                    // due_dateのフォーマット処理（yyyy-MM-dd形式の場合はISO形式に変換）
                    let dueDateValue: string | undefined = undefined;
                    if (md.due_date) {
                        // 既にISO形式の場合はそのまま使用
                        if (typeof md.due_date === 'string' && md.due_date.includes('T')) {
                            dueDateValue = md.due_date;
                        } else if (typeof md.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(md.due_date)) {
                            dueDateValue = `${md.due_date}T00:00:00+09:00`;
                        } else {
                            dueDateValue = md.due_date;
                        }
                    } else if (md.taskDueDate) {
                        // yyyy-MM-dd形式の場合はISO形式に変換
                        if (typeof md.taskDueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(md.taskDueDate)) {
                            dueDateValue = `${md.taskDueDate}T00:00:00+09:00`;
                        } else {
                            dueDateValue = md.taskDueDate;
                        }
                    }
                    
                    // priorityの処理（小文字を大文字に変換、またはundefined）
                    let priorityValue: string | undefined = undefined;
                    if (md.priority) {
                        const priorityStr = String(md.priority).toLowerCase();
                        if (priorityStr === 'low') {
                            priorityValue = 'LOW';
                        } else if (priorityStr === 'medium') {
                            priorityValue = 'MEDIUM';
                        } else if (priorityStr === 'high') {
                            priorityValue = 'HIGH';
                        }
                    }
                    
                    // seqIDとshotIDの処理（空文字列の場合はundefined）
                    const seqIDValue = md.seqID && md.seqID.trim() !== '' ? md.seqID.trim() : undefined;
                    const shotIDValue = md.shotID && md.shotID.trim() !== '' ? md.shotID.trim() : undefined;
                    
                    const taskData: any = {
                        name: md.title,
                        description: md.description || '',
                        status: md.status || 'todo',
                        due_date: dueDateValue,
                        project_id: md.project_id ? parseInt(String(md.project_id)) : undefined,
                        assigned_to: assignedToValue,
                        cost: md.taskCost ? Number(md.taskCost) : (md.cost ? Number(md.cost) : undefined),
                        dependsOn: md.dependsOn || [], 
                        start_date: md.start_time,
                        priority: priorityValue,
                        type: md.taskType && md.taskType.trim() !== '' ? md.taskType.trim() : undefined,
                        seqID: seqIDValue,
                        shotID: shotIDValue,
                    };
                    console.log("[CalendarPage] Creating NEW TASK via POST /tasks with data:", JSON.stringify(taskData, null, 2));
                    response = await api.post('/tasks', taskData);
                } else if (normalizedType === 'Project') {
                    const md: any = modalData;
                    const projectData = {
                        name: md.title,
                        description: md.description || md.projectDescription || '',
                        status: md.status || md.projectStatus || 'planning',
                        start_date: md.projectStartDate || md.start_time,
                        end_date: md.projectEndDate || md.end_time,
                        display_status: md.display_status || 'online',
                        color: md.color,
                    };
                    console.log("[CalendarPage] Creating NEW PROJECT via POST /projects with data:", JSON.stringify(projectData, null, 2));
                    response = await api.post('/projects', projectData);
                } else {
                    console.log("[CalendarPage] Creating NEW GENERIC EVENT via POST /calendar/events with data:", apiData);
                response = await api.post('/calendar/events', apiData); 
                }
            }
            console.log("Save/Update response:", response.data);

        } catch (err: any) {
            console.error("Failed to save event:", err);
            console.error("Error response:", err.response);
            console.error("Error response data:", err.response?.data);
            
            let errorMessage = 'Unknown error';
            
            if (err.response?.data?.detail) {
                const detail = err.response.data.detail;
                if (Array.isArray(detail)) {
                    // バリデーションエラーの場合
                    errorMessage = detail
                        .map((error: any) => {
                            if (typeof error === 'string') {
                                return error;
                            }
                            return `${error.loc?.join('.') || 'unknown'}: ${error.msg || JSON.stringify(error)}`;
                        })
                        .join('\n');
                } else if (typeof detail === 'string') {
                    errorMessage = detail;
                } else if (typeof detail === 'object') {
                    // オブジェクトの場合はJSON文字列化
                    errorMessage = JSON.stringify(detail, null, 2);
                } else {
                    errorMessage = String(detail);
                }
            } else if (err.response?.data?.message) {
                errorMessage = err.response.data.message;
            } else if (err.message) {
                errorMessage = err.message;
            } else if (typeof err === 'string') {
                errorMessage = err;
            } else {
                errorMessage = JSON.stringify(err, null, 2);
            }
            
            console.error("Formatted error message:", errorMessage);
            setError(`イベントの保存に失敗しました: ${errorMessage}`);
            setLoading(false);
        } finally {
            // グローバルデータを更新して他のページにも反映
            if (refreshGlobalData) {
                console.log('[CalendarPage] Refreshing global data after event save/update...');
                await refreshGlobalData();
                console.log('[CalendarPage] Global data refresh completed for event save/update');
            }
            
            // 通常のイベント（Milestone、Deadlineなど）も再取得
            try {
                console.log('[CalendarPage] Fetching backend events after save/update...');
                const eventsResponse = await api.get<BackendEvent[]>('/calendar/events');
                const backendEventsData = eventsResponse.data;
                
                const processedBackendEvents: CalendarEvent[] = backendEventsData
                    .map((be): CalendarEvent | null => {
                        const eventType = be.type;
                        const originalStartTimeStr = be.start_time as string;
                        const originalEndTimeStr = be.end_time as string;

                        if (!originalStartTimeStr) {
                            console.warn("Event without start_time skipped:", be);
                            return null;
                        }

                        if (eventType === 'Task') {
                            console.warn("[CalendarPage] Task type event found in backendEventsData, should be handled by taskEvents. Skipping in processedBackendEvents:", be);
                            return null;
                        } else if (eventType === 'Project') {
                            console.warn("[CalendarPage] Project type event found in backendEventsData, should be handled by projectEvents. Skipping in processedBackendEvents:", be);
                            return null;
                        } else {
                            const project = be.project_id ? projects.find(p => p.id === be.project_id) : undefined;
                            // プロジェクトが完了している場合はグレーにする
                            const isCompletedProject = project?.status === 'completed';
                            const eventColor = isCompletedProject ? '#9E9E9E' : getEventColor(be.type ?? 'Generic');
                            
                            return {
                                id: `event-${be.id}`,
                                title: be.title,
                                start: parseISO(originalStartTimeStr),
                                end: originalEndTimeStr ? parseISO(originalEndTimeStr) : undefined,
                                allDay: be.allDay ?? false,
                                backgroundColor: eventColor,
                                borderColor: eventColor,
                                extendedProps: {
                                    type: be.type || 'Generic',
                                    description: be.description ?? undefined,
                                    location: be.location ?? undefined,
                                    participants: be.participants ?? undefined,
                                    projectId: be.project_id ? String(be.project_id) : undefined,
                                    status: be.status ?? undefined,
                                    displayStatus: project?.display_status as 'online' | 'offline' | 'archived' | undefined,
                                },
                            };
                        }
                    })
                    .filter((event): event is CalendarEvent => event !== null);
                
                console.log('[CalendarPage] Backend events refreshed:', processedBackendEvents.length);
                setBackendEvents(processedBackendEvents);
            } catch (err) {
                console.error('[CalendarPage] Failed to refresh backend events:', err);
            }
            
            // モーダルを閉じて選択をクリア
            handleCloseModal();
            setSelectedEventDetails({ event: null });
            setLoading(false);
        }
    };

    const handleDeleteEvent = async (event: CalendarEvent) => {
        console.log(`--- handleDeleteEvent STARTED for id: ${event.id} ---`); // ログ追加
        console.log(`Event type: ${event.extendedProps.type}`); // イベントタイプをログ出力
        console.log(`Event extendedProps:`, event.extendedProps); // 拡張プロパティをログ出力

        setLoading(true);
        setError(null);
        try {
            // ★★★ ID 文字列から数値部分を抽出 ★★★
            const numericIdMatch = event.id.match(/\d+$/); // 末尾の数字部分を取得
            if (!numericIdMatch) {
                console.error("Invalid event ID format for deletion:", event.id);
                setError("無効なイベントIDのため削除できませんでした。");
                return; // 数値 ID がなければ処理中断
            }
            const numericId = numericIdMatch[0]; // 抽出した数値文字列
            console.log(`Extracted numeric ID: ${numericId}`); // 抽出結果をログ表示

            if (event.extendedProps.type === 'task' || event.extendedProps.type === 'Task') {
                await api.delete(`/tasks/${numericId}`);
                console.log(`Task with numeric ID ${numericId} (original ID: ${event.id}) deleted successfully.`);
            } else if (event.extendedProps.type === 'project' || event.extendedProps.type === 'Project') {
                await api.delete(`/projects/${numericId}`);
                console.log(`Project with numeric ID ${numericId} (original ID: ${event.id}) deleted successfully.`);
            } else {
                await api.delete(`/calendar/events/${numericId}`);
                console.log(`Event with numeric ID ${numericId} (original ID: ${event.id}) deleted successfully.`);
            }

            setSelectedEventDetails({ event: null }); // 詳細パネルをクリア
            
            // グローバルデータを更新して他のページにも反映
            if (refreshGlobalData) {
                console.log('[CalendarPage] Refreshing global data after event deletion...');
                await refreshGlobalData();
                console.log('[CalendarPage] Global data refresh completed for event deletion');
            }
            
            // 通常のイベント（Milestone、Deadlineなど）も再取得
            if (event.extendedProps.type !== 'task' && event.extendedProps.type !== 'Task' && 
                event.extendedProps.type !== 'project' && event.extendedProps.type !== 'Project') {
                try {
                    console.log('[CalendarPage] Fetching backend events after deletion...');
                    const eventsResponse = await api.get<BackendEvent[]>('/calendar/events');
                    const backendEventsData = eventsResponse.data;
                    
                    const processedBackendEvents: CalendarEvent[] = backendEventsData
                        .map((be): CalendarEvent | null => {
                            const eventType = be.type;
                            const originalStartTimeStr = be.start_time as string;
                            const originalEndTimeStr = be.end_time as string;

                            if (!originalStartTimeStr) {
                                console.warn("Event without start_time skipped:", be);
                                return null;
                            }

                            if (eventType === 'Task') {
                                console.warn("[CalendarPage] Task type event found in backendEventsData, should be handled by taskEvents. Skipping in processedBackendEvents:", be);
                                return null;
                            } else if (eventType === 'Project') {
                                console.warn("[CalendarPage] Project type event found in backendEventsData, should be handled by projectEvents. Skipping in processedBackendEvents:", be);
                                return null;
                            } else {
                                const project = be.project_id ? projects.find(p => p.id === be.project_id) : undefined;
                                // プロジェクトが完了している場合はグレーにする
                                const isCompletedProject = project?.status === 'completed';
                                const eventColor = isCompletedProject ? '#9E9E9E' : getEventColor(be.type ?? 'Generic');
                                
                                return {
                                    id: `event-${be.id}`,
                                    title: be.title,
                                    start: parseISO(originalStartTimeStr),
                                    end: originalEndTimeStr ? parseISO(originalEndTimeStr) : undefined,
                                    allDay: be.allDay ?? false,
                                    backgroundColor: eventColor,
                                    borderColor: eventColor,
                                    extendedProps: {
                                        type: be.type || 'Generic',
                                        description: be.description ?? undefined,
                                        location: be.location ?? undefined,
                                        participants: be.participants ?? undefined,
                                        projectId: be.project_id ? String(be.project_id) : undefined,
                                        status: be.status ?? undefined,
                                        displayStatus: project?.display_status as 'online' | 'offline' | 'archived' | undefined,
                                    },
                                };
                            }
                        })
                        .filter((event): event is CalendarEvent => event !== null);
                    
                    console.log('[CalendarPage] Backend events refreshed after deletion:', processedBackendEvents.length);
                    setBackendEvents(processedBackendEvents);
                } catch (err) {
                    console.error('[CalendarPage] Failed to refresh backend events after deletion:', err);
                }
            }

        } catch (err) {
            console.error("Failed to delete event:", err); // エラーログは残す
            setError("イベントの削除に失敗しました。");
        } finally {
            setLoading(false);
        }
    };

    const handleTogglePanelMinimize = () => {
        setIsPanelMinimized(!isPanelMinimized);
    };


    // FullCalendarのdatesSetでタイトルを更新
    const handleDatesSet = useCallback((_arg: any) => {
      // サイズ更新を非同期で実行
      setTimeout(() => {
        if (calendarRef.current) {
          calendarRef.current.getApi().updateSize();
        }
      }, 0);
    }, []);

    // ドラッグ時はそのまま範囲をhandleSelectに渡す
    const handleSelect = (selectInfo: DateSelectArg) => {
        setSelectedDate(selectInfo.start instanceof Date ? selectInfo.start : parseISO(selectInfo.start as string));
        setSelectedEventDetails({ event: null });
        setDateClickArg(null); // 選択時はdateClickArgをnullに
        handleOpenAddModal(selectInfo);
    };


    // カレンダーのビュータイプが変更されたときの処理
    const handleViewChange = (_view: any) => {
        // サイズ更新を非同期で実行
        setTimeout(() => {
          if (calendarRef.current) {
            calendarRef.current.getApi().updateSize();
          }
        }, 0);
    };

    if (loading && rawEvents.length === 0) {
        return <CircularProgress />;
    }

    console.log("Events being passed to FullCalendar:", eventsForFullCalendar); // ★ このログを追加

    const handleDayCellMount = (mountArg: DayCellMountArg) => {
        if (mountArg.isWeekend) {
            mountArg.el.setAttribute('data-weekend', 'true');
        }
    };

    // ★★★ FullCalendar の eventContent を追加して表示をカスタマイズ ★★★
    const renderEventContent = (eventInfo: any) => {
        const { type } = eventInfo.event.extendedProps;
        const title = eventInfo.event.title || '';
        
        // 複数日にまたがるイベント判定
        const isMultiDay = eventInfo.event.allDay && 
                           eventInfo.event.start && 
                           eventInfo.event.end && 
                           eventInfo.event.start.getTime() !== eventInfo.event.end.getTime();
        
        // プロジェクトまたは複数日にまたがる通常イベント
        if (type === 'project' || isMultiDay) {
            return (
                <div style={{ 
                    width: '100%', 
                    overflow: 'hidden',
                    display: 'block'
                }}>
                    <span style={{
                        display: 'block',
                        width: '100%',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                    }} title={title}>
                        {title}
                    </span>
                </div>
            );
        }
        
        // マイルストーン（Milestone）
        if (type === 'Milestone') {
            return (
                <div style={{ 
                    width: '100%', 
                    overflow: 'hidden',
                    display: 'block'
                }}>
                    <span
                        className="milestone-event-content"
                        title={`[MS] ${title}`}
                    >
                        [MS] {title}
                    </span>
                </div>
            );
        }
        
        // 締切（Deadline）
        if (type === 'Deadline') {
            return (
                <div style={{ 
                    width: '100%', 
                    overflow: 'hidden',
                    display: 'block'
                }}>
                    <span
                        className="deadline-event-content"
                        title={`[締切] ${title}`}
                    >
                        [締切] {title}
                    </span>
                </div>
            );
        }
        
        // 会議（Meeting）・ワークショップ（Workshop）- 時間を表示
        if (type === 'Meeting' || type === 'Workshop') {
            // 時間を取得してフォーマット
            const timeText = eventInfo.timeText || '';
            const displayText = timeText ? `${timeText} ${title}` : title;
            
            return (
                <div style={{ 
                    width: '100%', 
                    overflow: 'hidden',
                    display: 'block'
                }}>
                    <span style={{
                        display: 'block',
                        width: '100%',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                    }} title={displayText}>
                        {timeText && <span style={{ fontWeight: 'bold' }}>{timeText}</span>}
                        {timeText && ' '}
                        {title}
                    </span>
                </div>
            );
        }
        
        // タスクなど、単一日のイベント
        return (
            <div style={{ 
                width: '100%', 
                overflow: 'hidden',
                display: 'block'
            }}>
                <span style={{
                    display: 'block',
                    width: '100%',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                }} title={title}>
                    {title}
                </span>
            </div>
        );
    };

    // モーダルのレンダリング
    const renderEventModal = () => {
        if (!isAddModalOpen) return null;

        // EventAddModalMonthly の部分はコメントアウトされているので、EventAddModal のみを考慮
        // 以前 commonProps を使っていたが、可読性のため直接propsを渡す形に戻しつつ groups を追加
        return (
            <EventAddModal
                open={isAddModalOpen}
                onClose={handleCloseModal}
                onSave={handleSaveEvent}
                initialDate={selectedDate}
                eventToEdit={selectedEventDetails.event}
                dateClickArg={dateClickArg}
                projects={projects}
                users={users}
                tasks={tasks}
                groups={groups}
                canCreateProject={user?.role === 'admin'}
            />
        );
    };

    return (
        <Box 
            sx={{ 
                display: 'flex', 
                height: 'calc(100vh - 64px)', 
                overflow: 'hidden',
                p: { xs: 2, sm: 3 },
            }} 
            ref={containerRef}
        >
            <style>{`
                .fc .fc-daygrid-day.fc-day-today {
                    background-color: #e3f2fd; /* 今日: 薄い青 */
                }
                .fc .fc-daygrid-day.fc-day-selected {
                    background-color: #90caf9 !important; /* 選択中: 濃い青 */
                }
                .fc .fc-daygrid-day[data-weekend="true"] {
                     background-color: #f8f8f8;
                }
                /* 月曜日から金曜日の文字色を黒に */
                .fc .fc-col-header-cell.fc-day-mon,
                .fc .fc-col-header-cell.fc-day-mon a,
                .fc .fc-col-header-cell.fc-day-mon .fc-scrollgrid-sync-inner,
                .fc .fc-daygrid-day.fc-day-mon .fc-daygrid-day-number,
                .fc .fc-col-header-cell.fc-day-tue,
                .fc .fc-col-header-cell.fc-day-tue a,
                .fc .fc-col-header-cell.fc-day-tue .fc-scrollgrid-sync-inner,
                .fc .fc-daygrid-day.fc-day-tue .fc-daygrid-day-number,
                .fc .fc-col-header-cell.fc-day-wed,
                .fc .fc-col-header-cell.fc-day-wed a,
                .fc .fc-col-header-cell.fc-day-wed .fc-scrollgrid-sync-inner,
                .fc .fc-daygrid-day.fc-day-wed .fc-daygrid-day-number,
                .fc .fc-col-header-cell.fc-day-thu,
                .fc .fc-col-header-cell.fc-day-thu a,
                .fc .fc-col-header-cell.fc-day-thu .fc-scrollgrid-sync-inner,
                .fc .fc-daygrid-day.fc-day-thu .fc-daygrid-day-number,
                .fc .fc-col-header-cell.fc-day-fri,
                .fc .fc-col-header-cell.fc-day-fri a,
                .fc .fc-col-header-cell.fc-day-fri .fc-scrollgrid-sync-inner,
                .fc .fc-daygrid-day.fc-day-fri .fc-daygrid-day-number {
                    color: #000000 !important;
                }
                /* 土曜日の文字色を青に */
                .fc .fc-col-header-cell.fc-day-sat,
                .fc .fc-col-header-cell.fc-day-sat a,
                .fc .fc-col-header-cell.fc-day-sat .fc-scrollgrid-sync-inner,
                .fc .fc-daygrid-day.fc-day-sat .fc-daygrid-day-number {
                    color: #1976d2 !important;
                }
                /* 日曜日の文字色を赤に */
                .fc .fc-col-header-cell.fc-day-sun,
                .fc .fc-col-header-cell.fc-day-sun a,
                .fc .fc-col-header-cell.fc-day-sun .fc-scrollgrid-sync-inner,
                .fc .fc-daygrid-day.fc-day-sun .fc-daygrid-day-number {
                    color: #d32f2f !important;
                }
                .fc .fc-button-primary {
                    background-color: #556cd6;
                    border-color: #556cd6;
                }
                .fc .fc-list-event-dot {
                    border-color: var(--fc-event-border-color, #3788d8);
                    background-color: var(--fc-event-bg-color, #3788d8);
                }
                .fc-daygrid-event:not(.fc-event-bg) {
                    cursor: pointer;
                }
                .fc {
                    font-size: 0.8rem;
                }
                /* 日付セル（日付コマ）の高さを全ての週で統一 */
                .fc-daygrid-day-frame {
                    min-height: 120px !important;
                    height: 120px !important;
                }
                /* 週の行の高さも統一 */
                .fc-daygrid-body tr {
                    height: 120px !important;
                }
                /* イベントエリアの高さも統一（重要） */
                .fc-daygrid-day-events {
                    height: 120px !important;
                    min-height: 120px !important;
                    max-height: 120px !important;
                }
                /* 日付セルのトップ部分（日付番号）の高さを固定 */
                .fc-daygrid-day-top {
                    height: 20px !important;
                    min-height: 20px !important;
                    max-height: 20px !important;
                }
                /* 時間セルの高さを最低20pxに強制 */
                .fc-timegrid-slot-lane {
                    min-height: 20px !important;
                    height: 20px !important;
                }
                /* イベントが日付セル内に収まるようにする（プロジェクト以外） */
                .fc-event.custom-event,
                .fc-event.deadline-event-wrapper,
                .fc-event.milestone-event-wrapper {
                    max-width: 100%;
                }
                .fc-event.custom-event .fc-event-main,
                .fc-event.deadline-event-wrapper .fc-event-main,
                .fc-event.milestone-event-wrapper .fc-event-main {
                    max-width: 100%;
                }
                .fc-event.custom-event .fc-event-title,
                .fc-event.deadline-event-wrapper .fc-event-title,
                .fc-event.milestone-event-wrapper .fc-event-title {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    display: block;
                }
                /* 全てのイベントハーネスに統一した間隔を追加（少し広げて余裕を確保） */
                .fc-daygrid-event-harness {
                    margin-bottom: 1px !important;
                }
                
                /* プロジェクトは細めに表示（名前が読める程度） */
                .fc-daygrid-event.project-event,
                .fc-event.project-event {
                    height: auto !important;
                    min-height: 1.15em !important;
                    max-height: 1.3em !important;
                    display: flex !important;
                    align-items: center !important;
                    margin-bottom: 1px !important;
                }
                .fc-event.project-event .fc-event-main {
                    padding: 0 3px !important;
                    display: flex !important;
                    align-items: center !important;
                    height: 100% !important;
                    width: 100% !important;
                }
                .fc-event.project-event .fc-event-title {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    line-height: 1.15em !important;
                    font-size: 0.72rem !important;
                    display: flex !important;
                    align-items: center !important;
                    height: 100% !important;
                }
                /* 締切・マイルストーン共通で背景・枠を消す（親要素にクラスが付与される想定） */
                .fc-event.deadline-event-wrapper,
                .fc-daygrid-event.deadline-event-wrapper,
                .fc-event.milestone-event-wrapper,
                .fc-daygrid-event.milestone-event-wrapper {
                    background: none !important;
                    border: none !important;
                    box-shadow: none !important;
                    outline: none !important;
                }
                /* 締切のテキストだけ色指定 */
                .deadline-event-content {
                    color: #d32f2f;
                    background: none !important;
                    border: none !important;
                    font-weight: bold;
                    width: 100%;
                    max-width: 100%;
                    overflow: hidden;
                    white-space: nowrap;
                    text-overflow: ellipsis;
                    display: block;
                }
                /* マイルストーンの赤背景＋白文字 */
                .milestone-event-content {
                    background: #d32f2f;
                    color: #fff;
                    border: none;
                    border-radius: 4px;
                    padding: 2px 6px;
                    font-weight: bold;
                    display: block;
                    width: 100%;
                    max-width: 100%;
                    overflow: hidden;
                    white-space: nowrap;
                    text-overflow: ellipsis;
                    box-shadow: none;
                }
                
                /* 完了プロジェクトのイベント - デフォルトはバーあり（タスク用） */
                .fc-event.completed-project-event {
                    background-color: #9E9E9E !important;
                    border-color: #9E9E9E !important;
                }
                .fc-event.completed-project-event .fc-event-main,
                .fc-event.completed-project-event .fc-event-title {
                    color: #fff !important;
                }
                /* 完了プロジェクトの締切 - バーなし、文字色のみグレーに */
                .fc-event.completed-project-event.deadline-event-wrapper {
                    background: none !important;
                    border: none !important;
                }
                .fc-event.completed-project-event .deadline-event-content {
                    color: #757575 !important;
                }
                /* 完了プロジェクトの会議・ワークショップ - バーなし、文字色のみグレーに */
                .fc-event.completed-project-event.meeting-event,
                .fc-daygrid-event.completed-project-event.meeting-event,
                .fc-event.completed-project-event.workshop-event,
                .fc-daygrid-event.completed-project-event.workshop-event {
                    background: none !important;
                    border: none !important;
                    box-shadow: none !important;
                    outline: none !important;
                }
                .fc-event.completed-project-event.meeting-event,
                .fc-daygrid-event.completed-project-event.meeting-event,
                .fc-event.completed-project-event.workshop-event,
                .fc-daygrid-event.completed-project-event.workshop-event,
                .fc-event.completed-project-event.meeting-event *,
                .fc-daygrid-event.completed-project-event.meeting-event *,
                .fc-event.completed-project-event.workshop-event *,
                .fc-daygrid-event.completed-project-event.workshop-event * {
                    color: #757575 !important;
                }
                /* 完了プロジェクトのマイルストーン - 背景をグレーに */
                .fc-event.completed-project-event .milestone-event-content {
                    background: #9E9E9E !important;
                    color: #fff !important;
                }
                /* 「+N件」リンクのスタイル（クリック不可、情報表示のみ） */
                .fc-more-link {
                    display: block;
                    padding: 2px 4px;
                    font-size: 0.75rem;
                    color: #1976d2;
                    cursor: default;
                    text-align: left;
                    white-space: nowrap;
                    pointer-events: none;
                    text-decoration: none;
                }
                /* 会議・ワークショップのデフォルト表示（完了していないプロジェクト用） - 締切と同じようにバーなし */
                .fc-event.meeting-event,
                .fc-daygrid-event.meeting-event,
                .fc-event.workshop-event,
                .fc-daygrid-event.workshop-event {
                    background: none !important;
                    border: none !important;
                    box-shadow: none !important;
                    outline: none !important;
                }
                /* 完了していないプロジェクトの会議・ワークショップ - 青文字 */
                .fc-event.meeting-event:not(.completed-project-event),
                .fc-daygrid-event.meeting-event:not(.completed-project-event),
                .fc-event.workshop-event:not(.completed-project-event),
                .fc-daygrid-event.workshop-event:not(.completed-project-event),
                .fc-event.meeting-event:not(.completed-project-event) *,
                .fc-daygrid-event.meeting-event:not(.completed-project-event) *,
                .fc-event.workshop-event:not(.completed-project-event) *,
                .fc-daygrid-event.workshop-event:not(.completed-project-event) * {
                    color: #1976d2 !important;
                }
            `}</style>

                <Box sx={{ 
                    flexGrow: 1, 
                    p: 2, 
                    overflow: 'auto', 
                    position: 'relative',
                    backgroundColor: 'background.paper',
                    borderRadius: 3,
                    boxShadow: 2,
                }}>
                {/* ... (Error/Loading display) ... */}
                    {error && <Typography color="error">{error}</Typography>}
                    {loading && (
                        <Box sx={{ 
                            position: 'absolute', 
                            top: 0, 
                            left: 0, 
                            right: 0, 
                            bottom: 0, 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            backgroundColor: 'rgba(255, 255, 255, 0.8)',
                            zIndex: 10 
                        }}>
                            <CircularProgress />
                        </Box>
                    )}
                    <FullCalendar
                        ref={calendarRef}
                        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
                        initialView="dayGridMonth"
                        headerToolbar={{
                            left: 'prev,next today',
                            center: 'title',
                            right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
                        }}
                        events={eventsForFullCalendar}
                    locale={'ja'}
                        timeZone={'Asia/Tokyo'}
                        eventTimeFormat={{
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false
                        }}
                        height="100%"
                        contentHeight="auto"
                        fixedWeekCount={true}
                        showNonCurrentDates={true}
                        dateClick={handleDateClick}
                        select={handleSelect}
                        eventClick={handleEventClick}
                        eventContent={renderEventContent} 
                        eventClassNames={(arg) => {
                            const type = arg.event.extendedProps.type;
                            const projectId = arg.event.extendedProps.projectId;
                            const classes: string[] = [];
                            
                            // プロジェクトのステータスを確認
                            const project = projectId ? projects.find(p => String(p.id) === String(projectId)) : undefined;
                            const isCompletedProject = project?.status === 'completed';
                            
                            // 完了プロジェクトの場合は特別なクラスを追加
                            if (isCompletedProject) {
                                classes.push('completed-project-event');
                            }
                            
                            // 既存のクラス設定
                            if (type === 'project') {
                                classes.push('project-event');
                            } else if (type === 'Deadline') {
                                classes.push('deadline-event-wrapper');
                            } else if (type === 'Milestone') {
                                classes.push('milestone-event-wrapper');
                            } else if (type === 'Meeting') {
                                classes.push('custom-event');
                                classes.push('meeting-event');
                            } else if (type === 'Workshop') {
                                classes.push('custom-event');
                                classes.push('workshop-event');
                            } else {
                                classes.push('custom-event');
                            }
                            
                            // 複数日にまたがる通常イベントにもproject-eventスタイルを適用
                            const isMultiDay = arg.event.allDay && arg.event.start && arg.event.end && 
                                               arg.event.start.getTime() !== arg.event.end.getTime();
                            
                            if (isMultiDay && type !== 'project') {
                                classes.push('project-event');
                            }
                            
                            return classes;
                        }}
                        eventDidMount={(arg) => {
                            // 複数日にまたがるイベントのクラスを動的に追加
                            const type = arg.event.extendedProps.type;
                            const isMultiDay = arg.event.allDay && arg.event.start && arg.event.end && 
                                               arg.event.start.getTime() !== arg.event.end.getTime();
                            
                            if (isMultiDay && type !== 'project') {
                                arg.el.classList.add('project-event');
                            }
                        }}
                        dayMaxEventRows={5}
                        dayMaxEvents={5}
                        moreLinkContent={(arg) => `+${arg.num}件`}
                        dayCellDidMount={handleDayCellMount}
                        selectable={false}
                        selectMirror={true}
                        unselectAuto={false}
                        nowIndicator={true}
                        datesSet={handleDatesSet}
                        viewDidMount={handleViewChange}
                    />
                </Box>

            {/* ... (EventDetailsPanel Box) ... */}
                {!isSmallScreen && (
                    <Box
                        sx={{
                            width: isPanelMinimized ? '65px' : '350px',
                            flexShrink: 0,
                            borderLeft: '1px solid',
                            borderColor: 'divider',
                            overflowY: 'auto',
                            transition: 'width 0.3s ease-in-out',
                            position: 'relative',
                            display: 'flex',
                            flexDirection: 'column',
                        }}
                    >
                        <EventDetailsPanel
                            selectedDate={selectedDate}
                            selectedEvent={selectedEventDetails.event}
                            totalCost={selectedEventDetails.totalCost}
                        events={filteredEvents}
                            onEventSelect={handlePanelEventSelect}
                            isMinimized={isPanelMinimized}
                            onToggleMinimize={handleTogglePanelMinimize}
                            onOpenAddModal={() => handleOpenAddModal()}
                            users={users}
                            groups={groups}
                            onEdit={handleOpenEditModal}
                            onDelete={handleDeleteEvent as (event: import('../types').CalendarEvent) => void}
                        eventStatusFilter={eventStatusFilter}
                        onEventStatusFilterChange={handleEventStatusFilterChange}
                        eventTypeFilter={eventTypeFilter}
                        onEventTypeFilterChange={handleEventTypeFilterChange}
                        projects={projects}
                        />
                    </Box>
                )}

            {renderEventModal()}
        </Box>
    );
};

export default CalendarPage; 