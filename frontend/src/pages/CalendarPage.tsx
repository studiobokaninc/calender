import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { EventClickArg, EventApi, DayCellMountArg, DateSelectArg } from '@fullcalendar/core';
import { DateClickArg } from '@fullcalendar/interaction';
import api from '../services/api';
import { Project, Task, BackendEvent, CalendarEvent, User, Group, Participant } from '../types';
import EventDetailsPanel from '../components/EventDetailsPanel';
import EventAddModal from '../components/EventAddModal';
import EventAddModalMonthly from '../components/EventAddModalMonthly';
import { useAuth } from '../contexts/AuthContext';
import { format as formatDateFnsOriginal, parseISO, isSameDay, isValid as isValidDateFns, addDays, startOfDay, format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Box, CircularProgress, Typography, useMediaQuery, Theme, Button, Select, MenuItem, FormControl, InputLabel, SelectChangeEvent } from '@mui/material';
import { debounce } from 'lodash';
import { createRoot } from 'react-dom/client';

// date-fnsのformat関数をラップして、常にロケールjaを適用するエイリアスを作成
const formatDateFns = (date: Date | number, formatStr: string) => {
    return formatDateFnsOriginal(date, formatStr, { locale: ja });
};

// ★★★ バックアップ版から getEventColor, getProjectColor, getTaskColor を移植 ★★★
const getEventColor = (type?: string): string => {
  switch (type) {
    case 'meeting': return '#1976d2';
    case 'review': return '#9c27b0';
    case 'deadline': return '#d32f2f';
    default: return '#2196f3'; // Default blue for generic events
  }
};

const getProjectColor = (status?: string): string => { // ★ 引数を project -> status に変更 (データ構造による)
  // if (project.color) return project.color; // color プロパティがあれば使う
  switch (status) {
    case 'planning': return '#FF9800';
    case 'in-progress': return '#4CAF50';
    case 'completed': return '#9E9E9E';
    default: return '#757575';
  }
};

const getTaskColor = (status?: string): string => {
  switch (status) {
    case 'todo': return '#2196F3';
    case 'in-progress': return '#FF9800';
    case 'review': return '#9C27B0';
    case 'delayed': return '#F44336';
    case 'completed': return '#4CAF50';
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
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [selectedEventDetails, setSelectedEventDetails] = useState<{ event: CalendarEvent | null; totalCost?: number; }>({ event: null });
    const isSmallScreen = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
    const [isPanelMinimized, setIsPanelMinimized] = useState(false);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [users, setUsers] = useState<User[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const { user } = useAuth();
    const [eventStatusFilter, setEventStatusFilter] = useState<'all' | 'online' | 'offline' | 'archived'>(user?.role === 'admin' ? 'all' : 'online');
    const [calendarTitle, setCalendarTitle] = useState('');
    const [dateClickArg, setDateClickArg] = useState<DateClickArg | null>(null);
    const [isMonthlyView, setIsMonthlyView] = useState(false);

    const calendarRef = useRef<FullCalendar>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    // ★★★ ダブルクリック判定用の Ref と閾値を追加 ★★★
    const lastClickTimeRef = useRef<number>(0);
    const DOUBLE_CLICK_THRESHOLD = 300; // 300ms以内ならダブルクリック
    // 選択範囲にイベント追加ボタンを表示するためのref
    const addButtonRef = useRef<HTMLDivElement | null>(null);

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
                    end: project.end_date ? parseISO(project.end_date) : undefined, 
                    allDay: true, 
                    backgroundColor: getProjectColor(project.status ?? 'planning'),
                    borderColor: getProjectColor(project.status ?? 'planning'),
                    extendedProps: {
                        type: 'project',
                        projectId: String(project.id),
                        projectStatus: project.status,
                        projectDescription: project.description,
                        projectStartDate: project.start_date,
                        projectEndDate: project.end_date,
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
                        backgroundColor: getTaskColor(task.status ?? 'todo'),
                        borderColor: getTaskColor(task.status ?? 'todo'),
                    extendedProps: {
                            type: 'Task',
                            taskId: task.id,
                            description: task.description,
                        location: undefined,
                        participants: undefined,
                        projectId: task.project_id ? String(task.project_id) : undefined,
                        taskDueDate: task.due_date,
                        taskAssigneeId: task.assigned_to ? String(task.assigned_to) : undefined,
                        taskCost: task.cost,
                        taskStatus: task.status,
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
                        return {
                    id: `event-${be.id}`,
                            title: be.title,
                            start: parseISO(originalStartTimeStr),
                            end: originalEndTimeStr ? parseISO(originalEndTimeStr) : undefined,
                            allDay: be.allDay ?? false,
                            backgroundColor: getEventColor(be.type ?? 'Generic'),
                            borderColor: getEventColor(be.type ?? 'Generic'),
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

            const allCalendarEvents = sortEventsForDisplay([
                ...projectEvents, 
                ...taskEvents, 
                ...processedBackendEvents
            ]);
            console.log("[fetchData] Total events for calendar after merge and sort:", allCalendarEvents.length);
            setRawEvents(allCalendarEvents);

        } catch (err) {
            console.error("Failed to fetch and process calendar data:", err);
            setError('カレンダーデータの取得または処理に失敗しました。');
        } finally {
            setLoading(false);
        }
    }, []); // 依存配列は空でOK (初回ロードのみ)

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // ユーザーのロールが変わった時にフィルタの初期値を再設定
    useEffect(() => {
        setEventStatusFilter(user?.role === 'admin' ? 'all' : 'online');
    }, [user?.role]);

    const filterEvents = useCallback((events: CalendarEvent[]) => {
        return events.filter(event => {
            // プロジェクトのdisplay_statusに基づいてフィルタリング
            const displayStatus = event.extendedProps.displayStatus;
            if (!displayStatus) return true; // displayStatusが未設定の場合は表示

            // イベントステータスフィルターの適用
            if (eventStatusFilter !== 'all' && displayStatus !== eventStatusFilter) {
                return false;
            }

            // 一般ユーザーの場合は'online'のみ表示
            if (user?.role !== 'admin' && displayStatus !== 'online') {
                return false;
            }

            return true;
        });
    }, [eventStatusFilter, user?.role]);

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
                    startStr = formatDateFnsOriginal(startDateObj, "yyyy-MM-dd'T'HH:mm:ssXXX"); // 元のformatDateFnsOriginalを使用
                }
            }
            if (event.end) {
                const endDateObj = (typeof event.end === 'string') ? parseISO(event.end) : event.end;
                if (isValidDateFns(endDateObj)) {
                    endStr = formatDateFnsOriginal(endDateObj, "yyyy-MM-dd'T'HH:mm:ssXXX"); // 元のformatDateFnsOriginalを使用
                }
            }

            return {
                ...event,
                start: startStr,
                end: endStr,
            };
        });
    }, [filteredEvents]);

    const handleEventStatusFilterChange = (event: SelectChangeEvent<'all' | 'online' | 'offline' | 'archived'>) => {
        setEventStatusFilter(event.target.value as 'all' | 'online' | 'offline' | 'archived');
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

        let newEventId: string | null = null;
        try {
            let response;
            const numericIdForApi = eventId ? eventId.replace(/^(proj-|task-|event-)/, '') : null;

            const typeForSave = modalData.type || selectedEventDetails.event?.extendedProps?.type || 'Generic';
            const normalizedType = typeForSave.charAt(0).toUpperCase() + typeForSave.slice(1).toLowerCase();

            if (numericIdForApi) {
                if (normalizedType === 'Task') {
                    const md: any = modalData;
                    const taskData = {
                        name: md.title,
                        description: md.description || '',
                        status: md.status || 'todo',
                        due_date: md.due_date || md.taskDueDate || undefined,
                        project_id: md.project_id ? parseInt(String(md.project_id)) : undefined,
                        assigned_to: md.assigned_to ? parseInt(String(md.assigned_to)) : (md.taskAssigneeId ? parseInt(String(md.taskAssigneeId).replace('user-', '')) : undefined),
                        cost: md.cost ? Number(md.cost) : (md.taskCost ? Number(md.taskCost) : 0),
                        dependsOn: md.dependsOn || [],
                        start_date: md.start_time,
                    };
                    console.log(`Updating task (PUT) with numeric ID: ${numericIdForApi}`, taskData);
                    response = await api.put(`/tasks/${numericIdForApi}`, taskData);
                } else {
                    console.log(`Updating event (PUT) with numeric ID: ${numericIdForApi}`, apiData);
                    response = await api.put(`/calendar/events/${numericIdForApi}`, apiData);
                }
            } else {
                if (normalizedType === 'Task') {
                    const md: any = modalData; 
                    const taskData: any = {
                        name: md.title,
                        description: md.description || '',
                        status: md.status || 'todo',
                        due_date: md.due_date || md.taskDueDate || undefined,
                        project_id: md.project_id ? parseInt(String(md.project_id)) : undefined,
                        assigned_to: md.taskAssigneeId ? parseInt(String(md.taskAssigneeId).replace(/^user-|^group-/, '')) : undefined,
                        cost: md.taskCost ? Number(md.taskCost) : (md.cost ? Number(md.cost) : undefined),
                        dependsOn: md.dependsOn || [], 
                        start_date: md.start_time,
                    };
                    console.log("[CalendarPage] Creating NEW TASK via POST /tasks with data:", JSON.stringify(taskData, null, 2));
                    response = await api.post('/tasks', taskData);
                } else {
                    console.log("[CalendarPage] Creating NEW GENERIC EVENT via POST /calendar/events with data:", apiData);
                response = await api.post('/calendar/events', apiData); 
                }
            }
            console.log("Save/Update response:", response.data);

            if (response.data && response.data.id) {
                const savedEventData = response.data as (BackendEvent & Project & Task);
                const eventTypeRaw = savedEventData.type || modalData.type || 'Generic';
                const normalizedType = eventTypeRaw.charAt(0).toUpperCase() + eventTypeRaw.slice(1).toLowerCase();
                let idPrefix = 'event-';
                if (normalizedType === 'Project') {
                    idPrefix = 'proj-';
                } else if (normalizedType === 'Task') {
                    idPrefix = 'task-';
                }
                newEventId = `${idPrefix}${savedEventData.id}`;
            }

        } catch (err: any) {
            console.error("Failed to save event:", err);
            const errorMessage = err.response?.data?.detail || err.message || 'Unknown error';
            setError(`イベントの保存に失敗しました: ${errorMessage}`);
        } finally {
            await fetchData();
            // fetchData後、最新のrawEventsを取得して該当イベントをセット
            setTimeout(() => {
                if (newEventId) {
                    const found = rawEvents.find((ev: any) => ev.id === newEventId);
                    if (found) {
                        setSelectedEventDetails({ event: found, totalCost: found.extendedProps.type === 'Task' ? (found.extendedProps.taskCost ?? 0) : undefined });
                        setIsPanelMinimized(false);
                    }
                }
                handleCloseModal();
            setLoading(false);
            }, 0);
        }
    };

    const handleDeleteEvent = async (eventId: string) => {
        console.log(`--- handleDeleteEvent STARTED for id: ${eventId} ---`); // ログ追加

        // ★★★ ID 文字列から数値部分を抽出 ★★★
        const numericIdMatch = eventId.match(/\d+$/); // 末尾の数字部分を取得
        if (!numericIdMatch) {
            console.error("Invalid event ID format for deletion:", eventId);
            setError("無効なイベントIDのため削除できませんでした。");
            return; // 数値 ID がなければ処理中断
        }
        const numericId = numericIdMatch[0]; // 抽出した数値文字列
        console.log(`Extracted numeric ID: ${numericId}`); // 抽出結果をログ表示

        setLoading(true);
        setError(null);
        try {
            // ★★★ 抽出した数値 ID を使って API を呼び出す ★★★
            await api.delete(`/calendar/events/${numericId}`);
            console.log(`Event with numeric ID ${numericId} (original ID: ${eventId}) deleted successfully.`);

            // ★★★ フロントエンドの状態からも削除 ★★★
            setRawEvents(prevEvents => prevEvents.filter(event => event.id !== eventId));
            setSelectedEventDetails({ event: null }); // 詳細パネルをクリア
            // fetchData(); // DB から再取得する場合（今回はローカルで削除）

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

    // ★★★ eventsForDisplay でソート関数を適用 ★★★
    const eventsForDisplay = useMemo(() => {
        console.log('Sorting events for display using useMemo...');
        return sortEventsForDisplay(rawEvents); // rawEvents をソート
    }, [rawEvents]);

    // ★★★ panelEvents は rawEvents を使うように修正 ★★★
    const panelEvents = useMemo(() => {
        const dateToShow = selectedDate || (selectedEventDetails.event?.start ? parseISO(selectedEventDetails.event.start as string) : null);
        if (!dateToShow) return [];
        // ★★★ rawEvents を直接フィルタリング ★★★
        return rawEvents.filter(event => event.start && isSameDay(parseISO(event.start as string), dateToShow));
    }, [selectedDate, selectedEventDetails.event, rawEvents]);

    // FullCalendarのdatesSetでタイトルを更新
    const handleDatesSet = useCallback((arg: any) => {
      setCalendarTitle(arg.view.title);
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

    // FullCalendarのunselect時にボタンを消す
    const handleUnselect = () => {
      console.log('handleUnselect called');
      // if (addButtonRef.current) {
      //   addButtonRef.current.remove();
      //   addButtonRef.current = null;
      // }
    };

    // カレンダーのビュータイプが変更されたときの処理
    const handleViewChange = (view: any) => {
        setIsMonthlyView(view.type === 'dayGridMonth');
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
        
        // マイルストーン（Milestone）
        if (type === 'Milestone') {
            return (
                <div className="milestone-event-wrapper">
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
                <div className="deadline-event-wrapper">
                    <span
                        className="deadline-event-content"
                        title={`[締切] ${title}`}
                    >
                        [締切] {title}
                    </span>
                </div>
            );
        }
        
        // それ以外（デフォルト）
        return (
            <span style={{
                maxWidth: '100%',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
            }}>
                {title}
            </span>
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
                groups={groups} // ★ groups を props として渡す
            />
        );
    };

    return (
        <Box sx={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden' }} ref={containerRef}>
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
                /* 時間セルの高さを最低20pxに強制 */
                .fc-timegrid-slot-lane {
                    min-height: 20px !important;
                    height: 20px !important;
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
                    max-width: 100%;
                    overflow: hidden;
                    white-space: nowrap;
                    text-overflow: ellipsis;
                    display: inline-block;
                }
                /* マイルストーンの赤背景＋白文字 */
                .milestone-event-content {
                    background: #d32f2f;
                    color: #fff;
                    border: none;
                    border-radius: 4px;
                    padding: 2px 6px;
                    font-weight: bold;
                    display: inline-block;
                    max-width: 100%;
                    overflow: hidden;
                    white-space: nowrap;
                    text-overflow: ellipsis;
                    box-shadow: none;
                }
            `}</style>

                <Box sx={{ flexGrow: 1, p: 1, overflow: 'auto', position: 'relative' }}>
                {/* ... (Error/Loading display) ... */}
                    {error && <Typography color="error">{error}</Typography>}
                    {loading && rawEvents.length > 0 && (
                        <CircularProgress size={24} sx={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }} />
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
                        height="100%"
                        dateClick={handleDateClick}
                        select={handleSelect}
                        eventClick={handleEventClick}
                    eventContent={renderEventContent} 
                        eventClassNames={(arg) => {
                            const type = arg.event.extendedProps.type;
                            if (type === 'Deadline') return ['deadline-event-wrapper'];
                            if (type === 'Milestone') return ['milestone-event-wrapper'];
                            return [];
                        }}
                        dayMaxEventRows={true}
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
                            onDelete={handleDeleteEvent}
                        eventStatusFilter={eventStatusFilter}
                        onEventStatusFilterChange={handleEventStatusFilterChange}
                        projects={projects}
                        />
                    </Box>
                )}

            {renderEventModal()}
        </Box>
    );
};

export default CalendarPage; 