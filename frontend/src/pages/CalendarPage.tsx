import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { EventClickArg, DayCellMountArg, DateSelectArg, EventDropArg } from '@fullcalendar/core';
import { DateClickArg, EventResizeDoneArg } from '@fullcalendar/interaction';
import api from '../services/api';
import { Project, Task, BackendEvent, CalendarEvent, User, Group } from '../types';
import EventDetailsPanel from '../components/EventDetailsPanel';
import EventAddModal from '../components/EventAddModal';
import { useAuth } from '../contexts/AuthContext';
import { useCalendarPageState, usePageState } from '../contexts/PageStateContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { format as formatDateFnsOriginal, parseISO, isSameDay, isValid as isValidDateFns, addDays, startOfDay, setHours, setMinutes } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Box, CircularProgress, Typography, useMediaQuery, useTheme, Theme, SelectChangeEvent, Button, Snackbar, Alert, Fab, Drawer, IconButton, Chip, FormControl, InputLabel, Select, MenuItem, Checkbox, FormControlLabel, FormGroup } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import FilterListIcon from '@mui/icons-material/FilterList';
import CloseIcon from '@mui/icons-material/Close';
import { debounce } from 'lodash';


// ★★★ バックアップ版から getEventColor, getProjectColor, getTaskColor を移植 ★★★
const getEventColor = (
    type?: string,
    projectStatus?: string,
    eventDate?: string | Date | null
): string => {
    // プロジェクトステータスを文字列に変換（Enum型の場合も考慮）
    const projectStatusStr = projectStatus ? String(projectStatus).toLowerCase() : undefined;

    // プロジェクトが完了またはキャンセルの場合は、イベントの種類に関わらずグレーにする
    if (projectStatusStr === 'completed' || projectStatusStr === 'cancelled') {
        return '#9E9E9E';
    }

    // 日付が過ぎている場合はグレーにする
    if (eventDate) {
        const isPast = isDatePast(eventDate);
        if (isPast) {
            return '#9E9E9E';
        }
    }

    const t = type?.toLowerCase();
    switch (t) {
        case 'meeting': return '#1976d2';
        case 'review': case 'workshop': return '#00897b';   // ティール（青背景と調和）
        case 'deadline': return '#d32f2f';
        case 'milestone': return '#9C27B0';
        default: return '#2196f3'; // Default blue for generic events
    }
};

const getProjectColor = (project?: { status?: string | null; color?: string | null; display_status?: string | null } | string): string => {
    // プロジェクトオブジェクトの場合、display_statusがofflineの場合はグレーを返す
    if (typeof project === 'object' && project) {
        if (project.display_status === 'offline') {
            return '#9E9E9E'; // オフラインはグレー
        }
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

// 日付が過ぎているかどうかを判定するヘルパー関数
// 2/5の時に2/4 00:00~00:00のイベントもグレーになるように、日付のみで比較（時刻は無視）
const isDatePast = (dateStr: string | Date | null | undefined): boolean => {
    if (!dateStr) return false;
    try {
        const date = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
        if (!isValidDateFns(date)) return false;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const eventDate = new Date(date);
        eventDate.setHours(0, 0, 0, 0);

        // 日付のみで比較（2/4のイベントは2/5の時点で「過ぎている」と判定）
        // eventDate < today ではなく、eventDate <= today - 1日 で判定
        // つまり、今日より前の日付のイベントは「過ぎている」
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        // イベント日付が昨日以前なら「過ぎている」
        return eventDate <= yesterday;
    } catch {
        return false;
    }
};

const getTaskColor = (
    status?: string,
    projectStatus?: string,
    _dueDate?: string | Date | null
): string => {
    // プロジェクトステータスを文字列に変換（Enum型の場合も考慮）
    const projectStatusStr = projectStatus ? String(projectStatus).toLowerCase() : undefined;

    // プロジェクトが完了またはキャンセルの場合は、タスクのステータスに関わらずグレーにする
    if (projectStatusStr === 'completed' || projectStatusStr === 'cancelled') {
        return '#9E9E9E';
    }

    // タスクは日付が過ぎただけではグレーにしない（プロジェクトステータスのみで判定）

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
    const theme = useTheme();
    const isDark = theme.palette.mode === 'dark';
    const [rawEvents, setRawEvents] = useState<CalendarEvent[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const isSmallScreen = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
    const isMobile = useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'));
    const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
    const [mobileEventDetailsOpen, setMobileEventDetailsOpen] = useState(false);
    const [isPanelMinimized, setIsPanelMinimized] = useState(false);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    /** モーダルで編集するイベント。null のときは新規作成。作成ボタンでは常に null にする */
    const [modalEventToEdit, setModalEventToEdit] = useState<CalendarEvent | null>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const { user } = useAuth();
    const [dateClickArg, setDateClickArg] = useState<DateClickArg | null>(null);

    // ページ状態管理の使用
    const { calendarState, updateCalendarState, isInitialLoad, globalData, updateGlobalData } = useCalendarPageState();
    const { refreshGlobalData } = usePageState();

    // デフォルトの種類フィルター（永続化のマージ用）
    // ※ 'event' はバックエンドが返す「通常」イベントの type に合わせる
    const DEFAULT_EVENT_TYPE_FILTER: Record<string, boolean> = {
        project: false, // プロジェクトはデフォルトでオフ（グループと同様）
        task: true,
        milestone: true,
        deadline: true,
        meeting: true,
        workshop: true,
        generic: true,
        event: true, // 通常イベント（API が type: "Event" で返す場合）
        group: false, // グループはデフォルトでオフ
    };
    // 状態を分離（初期化時はページ状態から取得、context 復元後に上書き）
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [selectedEventDetails, setSelectedEventDetails] = useState<{ event: CalendarEvent | null; totalCost?: number; }>({ event: null });
    const [eventStatusFilter, setEventStatusFilter] = useState<string>('all'); // 'all' または プロジェクトID
    const [eventTypeFilter, setEventTypeFilter] = useState<Record<string, boolean>>(DEFAULT_EVENT_TYPE_FILTER);
    const [stateRestored, setStateRestored] = useState(false);
    const [googleSnackbar, setGoogleSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

    const location = useLocation();
    const navigate = useNavigate();
    const calendarRef = useRef<FullCalendar>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    // ★★★ ダブルクリック判定用の Ref と閾値を追加 ★★★
    const lastClickTimeRef = useRef<number>(0);
    const lastClickedEventIdRef = useRef<string | null>(null);
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

    // Google カレンダー連携コールバック後のメッセージ表示
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const google = params.get('google');
        if (google === 'connected' || google === 'error') {
            if (google === 'connected') {
                setGoogleSnackbar({ open: true, message: 'Google カレンダーと連携しました。タスクページで「Googleに表示」をONにすると、タスクが個人のカレンダーに追加されます。', severity: 'success' });
            } else {
                const reason = params.get('reason');
                let errorMessage = 'Google カレンダーとの連携に失敗しました。';
                if (reason) {
                    const reasonMessages: Record<string, string> = {
                        'missing_params': '認証パラメータが不足しています。',
                        'invalid_state': '認証状態が無効です。再度お試しください。',
                        'token_exchange_failed': 'トークンの交換に失敗しました。',
                        'token_exchange_exception': 'トークンの交換中にエラーが発生しました。',
                        'save_failed': 'トークンの保存に失敗しました。',
                    };
                    errorMessage += ` ${reasonMessages[reason] || `理由: ${reason}`}`;
                }
                setGoogleSnackbar({ open: true, message: errorMessage, severity: 'error' });
            }
            // クエリパラメータを削除してクリーンなURLにリダイレクト
            navigate('/calendar', { replace: true });
        }
    }, [location.search, navigate]);

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
            const taskEvents: CalendarEvent[] = tasksData.flatMap((task) => {
                const events: CalendarEvent[] = [];
                const project = projectsData.find(p => p.id === task.project_id);

                if (task.due_date) {
                    const taskColor = getTaskColor(
                        task.status ?? 'todo',
                        project?.status ?? undefined,
                        task.due_date
                    );
                    events.push({
                        id: `task-${task.id}`,
                        title: task.name,
                        start: task.due_date ? parseISO(task.due_date) : new Date(),
                        end: undefined,
                        allDay: true,
                        backgroundColor: taskColor,
                        borderColor: taskColor,
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
                    });
                }

                if (task.phases && Array.isArray(task.phases)) {
                    if (task.phases.length > 0) console.log(`[CalendarPage:fetchData] Task ${task.id} (${task.name}) has phases:`, task.phases);
                    task.phases.forEach((phase: any, index: number) => {
                        if (phase.date) {
                            events.push({
                                id: `task-${task.id}-phase-${index}`,
                                title: `${task.name}: ${phase.name}`,
                                start: parseISO(phase.date),
                                allDay: true,
                                backgroundColor: '#E91E63', // Pink for phases
                                borderColor: '#E91E63',
                                extendedProps: {
                                    type: 'milestone',
                                    taskId: task.id,
                                    description: `Phase: ${phase.name}`,
                                    projectId: task.project_id ? String(task.project_id) : undefined,
                                    displayStatus: project?.display_status as 'online' | 'offline' | 'archived' | undefined,
                                }
                            });
                        }
                    });
                }
                return events;
            });

            // 3. Process BackendEvents (regular events from /calendar/events) into CalendarEvents
            const processedBackendEvents: CalendarEvent[] = backendEventsData
                .map((be): CalendarEvent | null => {
                    const eventType = be.type;
                    let originalStartTimeStr = be.start_time as string;
                    let originalEndTimeStr = be.end_time as string;

                    if (!originalStartTimeStr) {
                        console.warn("Event without start_time skipped:", be);
                        return null;
                    }

                    // 会議のみ00:00~00:00の予定を5:00~28:59に変換（会議以外は終日として扱う）
                    const normalizedTypeForConversion = (be.type && be.type.trim() !== '' && be.type.toLowerCase() !== 'event')
                        ? be.type
                        : 'Generic';

                    if (normalizedTypeForConversion === 'Meeting' && originalStartTimeStr && originalEndTimeStr) {
                        const startDate = parseISO(originalStartTimeStr);
                        const endDate = parseISO(originalEndTimeStr);

                        // 同じ日付で、両方が00:00:00の場合
                        if (isSameDay(startDate, endDate) &&
                            startDate.getHours() === 0 && startDate.getMinutes() === 0 &&
                            endDate.getHours() === 0 && endDate.getMinutes() === 0) {
                            // start_timeをその日の5:00:00に変換
                            const newStartDate = setHours(setMinutes(startDate, 0), 5);
                            // end_timeを翌日の4:59:00に変換（28:59:00を意味する）
                            const newEndDate = addDays(setHours(setMinutes(startDate, 59), 4), 1);

                            originalStartTimeStr = newStartDate.toISOString();
                            originalEndTimeStr = newEndDate.toISOString();

                            // allDayフラグをfalseに変更（時間指定イベントになるため）
                            be.allDay = false;

                            console.log(`[fetchData] Converted 00:00~00:00 Meeting event to 5:00~28:59: ${be.title}`, {
                                original: { start: be.start_time, end: be.end_time },
                                converted: { start: originalStartTimeStr, end: originalEndTimeStr }
                            });
                        }
                    } else if (normalizedTypeForConversion !== 'Meeting' && originalStartTimeStr && originalEndTimeStr) {
                        // 会議以外は終日として扱う（allDay=trueに設定）
                        const startDate = parseISO(originalStartTimeStr);
                        const endDate = parseISO(originalEndTimeStr);

                        // 同じ日付で、両方が00:00:00の場合、終日として扱う
                        if (isSameDay(startDate, endDate) &&
                            startDate.getHours() === 0 && startDate.getMinutes() === 0 &&
                            endDate.getHours() === 0 && endDate.getMinutes() === 0) {
                            be.allDay = true;
                        }
                    }

                    if (eventType === 'Task') {
                        console.warn("[fetchData] Task type event found in backendEventsData, should be handled by taskEvents. Skipping in processedBackendEvents:", be);
                        return null;
                    } else if (eventType === 'Project') {
                        console.warn("[fetchData] Project type event found in backendEventsData, should be handled by projectEvents. Skipping in processedBackendEvents:", be);
                        return null;
                    } else {
                        const project = be.project_id ? projectsData.find(p => p.id === be.project_id) : undefined;
                        // バックエンドの type を正規化（Event / 未設定 → Generic として表示）
                        const normalizedType = (be.type && be.type.trim() !== '' && be.type.toLowerCase() !== 'event')
                            ? be.type
                            : 'Generic';
                        // 会議・ワークショップは実施日（start_time）で過去/色判定。終日はAPIが翌日00:00で返すため end の前日で判定
                        const eventDate = (normalizedType === 'Meeting' || normalizedType === 'Workshop')
                            ? parseISO(originalStartTimeStr)
                            : (originalEndTimeStr ? ((be.allDay ?? false) ? addDays(parseISO(originalEndTimeStr), -1) : parseISO(originalEndTimeStr)) : parseISO(originalStartTimeStr));
                        const eventColor = getEventColor(
                            normalizedType ?? 'Generic',
                            project?.status ?? undefined,
                            eventDate
                        );

                        return {
                            id: `event-${be.id}`,
                            title: be.title,
                            start: parseISO(originalStartTimeStr),
                            end: originalEndTimeStr ? parseISO(originalEndTimeStr) : undefined,
                            allDay: be.allDay ?? false,
                            backgroundColor: eventColor,
                            borderColor: eventColor,
                            extendedProps: {
                                type: normalizedType,
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

            setRawEvents(allCalendarEvents);

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
                            const normalizedType = (be.type && be.type.trim() !== '' && be.type.toLowerCase() !== 'event')
                                ? be.type
                                : 'Generic';
                            // 会議・ワークショップは実施日（start_time）で過去/色判定。終日はAPIが翌日00:00で返すため end の前日で判定
                            const eventDate = (normalizedType === 'Meeting' || normalizedType === 'Workshop')
                                ? parseISO(originalStartTimeStr)
                                : (originalEndTimeStr ? ((be.allDay ?? false) ? addDays(parseISO(originalEndTimeStr), -1) : parseISO(originalEndTimeStr)) : parseISO(originalStartTimeStr));
                            const eventColor = getEventColor(
                                normalizedType ?? 'Generic',
                                project?.status ?? undefined,
                                eventDate
                            );

                            return {
                                id: `event-${be.id}`,
                                title: be.title,
                                start: parseISO(originalStartTimeStr),
                                end: originalEndTimeStr ? parseISO(originalEndTimeStr) : undefined,
                                allDay: be.allDay ?? false,
                                backgroundColor: eventColor,
                                borderColor: eventColor,
                                extendedProps: {
                                    type: normalizedType,
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
        if ((tasks.length > 0 || projects.length > 0 || groups.length > 0) && !loading) {
            console.log("[CalendarPage] Regenerating events from tasks, projects, and groups");

            const taskEvents = tasks.flatMap(task => {
                const events: CalendarEvent[] = [];
                const project = projects.find(p => p.id === task.project_id);

                if (task.due_date) {
                    const taskColor = getTaskColor(
                        task.status ?? 'todo',
                        project?.status ?? undefined,
                        task.due_date
                    );
                    events.push({
                        id: `task-${task.id}`,
                        title: task.name || 'Untitled Task',
                        start: task.due_date ? parseISO(task.due_date) : new Date(),
                        end: undefined,
                        allDay: true,
                        backgroundColor: taskColor,
                        borderColor: taskColor,
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
                    });
                }

                if (task.phases && Array.isArray(task.phases)) {
                    if (task.phases.length > 0) console.log(`[CalendarPage:useEffect] Task ${task.id} (${task.name}) has phases:`, task.phases);
                    task.phases.forEach((phase: any, index: number) => {
                        if (phase.date) {
                            events.push({
                                id: `task-${task.id}-phase-${index}`,
                                title: `${task.name}: ${phase.name}`,
                                start: parseISO(phase.date),
                                allDay: true,
                                backgroundColor: '#E91E63', // Pink for phases
                                borderColor: '#E91E63',
                                extendedProps: {
                                    type: 'milestone',
                                    taskId: task.id,
                                    description: `Phase: ${phase.name}`,
                                    projectId: task.project_id ? String(task.project_id) : undefined,
                                    displayStatus: project?.display_status as 'online' | 'offline' | 'archived' | undefined,
                                }
                            });
                        }
                    });
                }
                return events;
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

            // グループイベントを生成（プロジェクトと同じ要領）
            const groupEvents = groups
                .filter(group => group.start_date) // 開始日がないグループは除外
                .map(group => ({
                    id: `group-${group.id}`,
                    title: group.name || 'Untitled Group',
                    start: group.start_date ? parseISO(group.start_date) : new Date(),
                    end: group.end_date ? addDays(parseISO(group.end_date), 1) : undefined, // FullCalendarの終日イベントは排他的なので+1日
                    allDay: true,
                    backgroundColor: '#9C27B0', // グループ用の色（紫）
                    borderColor: '#9C27B0',
                    extendedProps: {
                        type: 'group',
                        groupId: String(group.id),
                        groupDescription: group.description,
                        groupStartDate: group.start_date,
                        groupEndDate: group.end_date,
                        description: group.description,
                        location: undefined,
                        participants: undefined,
                        taskDueDate: undefined,
                        taskAssigneeId: undefined,
                        taskCost: undefined,
                        taskStatus: undefined,
                        status: undefined,
                        displayStatus: undefined,
                        dependsOn: undefined,
                    }
                }));

            // バックエンドイベントの色を再計算（プロジェクトステータスが変更された場合に備えて）
            // プロジェクトの検索を最適化するためのMapを作成
            const projectsMapForRecalc = new Map<string, Project>();
            projects.forEach(project => {
                projectsMapForRecalc.set(String(project.id), project);
            });

            const recalculatedBackendEvents = backendEvents.map(event => {
                const projectId = event.extendedProps?.projectId;
                const project = projectId ? projectsMapForRecalc.get(String(projectId)) : undefined;

                // 会議・ワークショップは実施日（start）で過去/色判定。終日は排他的終了日のため end の前日で判定
                const eventType = event.extendedProps?.type;
                let eventDate: string | Date | null = null;
                if (eventType === 'Meeting' || eventType === 'Workshop') {
                    eventDate = event.start ? (typeof event.start === 'string' ? event.start : event.start) : null;
                } else if (event.end) {
                    const endVal = typeof event.end === 'string' ? parseISO(event.end) : event.end;
                    eventDate = event.allDay ? addDays(endVal, -1) : endVal;
                } else if (event.start) {
                    eventDate = typeof event.start === 'string' ? event.start : event.start;
                }

                const eventColor = getEventColor(
                    eventType ?? 'Generic',
                    project?.status ?? undefined,
                    eventDate
                );

                return {
                    ...event,
                    backgroundColor: eventColor,
                    borderColor: eventColor,
                };
            });

            // バックエンドイベントと統合
            const allCalendarEvents = sortEventsForDisplay([
                ...projectEvents,
                ...taskEvents,
                ...groupEvents,
                ...recalculatedBackendEvents
            ]);

            console.log("[CalendarPage] Setting rawEvents with", allCalendarEvents.length, "events");
            setRawEvents(allCalendarEvents);
        }
    }, [tasks, projects, groups, backendEvents, loading]);

    // projectsが更新された時に、backendEventsの色を再計算して更新
    useEffect(() => {
        if (backendEvents.length > 0 && projects.length > 0) {
            // プロジェクトの検索を最適化するためのMapを作成
            const projectsMapForUpdate = new Map<string, Project>();
            projects.forEach(project => {
                projectsMapForUpdate.set(String(project.id), project);
            });

            const updatedBackendEvents = backendEvents.map(event => {
                const projectId = event.extendedProps?.projectId;
                const project = projectId ? projectsMapForUpdate.get(String(projectId)) : undefined;
                const eventType = event.extendedProps?.type;
                // 会議・ワークショップは実施日（start）で過去/色判定。終日は排他的終了日のため end の前日で判定
                let eventDate: string | Date | null = null;
                if (eventType === 'Meeting' || eventType === 'Workshop') {
                    eventDate = event.start ? (typeof event.start === 'string' ? event.start : event.start) : null;
                } else if (event.end) {
                    const endVal = typeof event.end === 'string' ? parseISO(event.end) : event.end;
                    eventDate = event.allDay ? addDays(endVal, -1) : endVal;
                } else if (event.start) {
                    eventDate = typeof event.start === 'string' ? event.start : event.start;
                }

                const eventColor = getEventColor(
                    eventType ?? 'Generic',
                    project?.status ?? undefined,
                    eventDate
                );

                return {
                    ...event,
                    backgroundColor: eventColor,
                    borderColor: eventColor,
                };
            });

            // 必ず更新して、rawEventsの再生成をトリガーする
            setBackendEvents(updatedBackendEvents);
        }
    }, [projects]); // projectsのみを依存関係に設定（backendEventsはクロージャで参照）

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
                                const normalizedType = (be.type && be.type.trim() !== '' && be.type.toLowerCase() !== 'event')
                                    ? be.type
                                    : 'Generic';
                                // 会議・ワークショップは実施日（start_time）で過去/色判定。終日はAPIが翌日00:00で返すため end の前日で判定
                                const eventDate = (normalizedType === 'Meeting' || normalizedType === 'Workshop')
                                    ? parseISO(originalStartTimeStr)
                                    : (originalEndTimeStr ? ((be.allDay ?? false) ? addDays(parseISO(originalEndTimeStr), -1) : parseISO(originalEndTimeStr)) : parseISO(originalStartTimeStr));
                                const eventColor = getEventColor(
                                    normalizedType ?? 'Generic',
                                    project?.status ?? undefined,
                                    eventDate
                                );

                                return {
                                    id: `event-${be.id}`,
                                    title: be.title,
                                    start: parseISO(originalStartTimeStr),
                                    end: originalEndTimeStr ? parseISO(originalEndTimeStr) : undefined,
                                    allDay: be.allDay ?? false,
                                    backgroundColor: eventColor,
                                    borderColor: eventColor,
                                    extendedProps: {
                                        type: normalizedType,
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

    // プロジェクトの検索を最適化するためのMapを作成（O(1)の検索を可能にする）
    const projectsMap = useMemo(() => {
        const map = new Map<string, Project>();
        projects.forEach(project => {
            map.set(String(project.id), project);
        });
        return map;
    }, [projects]);

    const filterEvents = useCallback((events: CalendarEvent[]) => {
        return events.filter(event => {
            const eventProjectId = event.extendedProps?.projectId;
            const eventType = event.extendedProps?.type?.toLowerCase();
            const eventId = event.id;

            // プロジェクトのdisplay_statusがofflineの場合は、そのプロジェクトに関連するすべてのイベントを非表示にする（Mapを使用してO(1)検索）
            if (eventType === 'project') {
                // プロジェクト自体の場合
                const projectId = eventId.replace(/^proj-/, '');
                const project = projectsMap.get(String(projectId));
                if (project && project.display_status === 'offline') {
                    return false; // オフラインのプロジェクトは非表示
                }
            } else if (eventProjectId) {
                // プロジェクトに紐づくイベント（タスク、会議、ワークショップ、マイルストーン、締切など）の場合
                const project = projectsMap.get(String(eventProjectId));
                if (project && project.display_status === 'offline') {
                    return false; // オフラインのプロジェクトに関連するイベントは非表示
                }
            }

            // プロジェクトフィルターのチェック
            let projectFilterPass = true;
            if (eventStatusFilter === 'no-project') {
                // プロジェクト未設定のタスク・イベントを表示（プロジェクト本体は除く）
                projectFilterPass = eventType !== 'project' && !eventProjectId;
            } else if (eventStatusFilter !== 'all') {
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
            // 「通常」イベント: type が event / generic のどちらでも generic フィルターで判定
            const typeKeyForFilter = (typeKey === 'event' || typeKey === 'generic') ? 'generic' : typeKey;
            const typeFilterPass = eventTypeFilter[typeKeyForFilter] !== false;

            // 両方のフィルターを通過したイベントのみ表示
            return projectFilterPass && typeFilterPass;
        });
    }, [eventStatusFilter, eventTypeFilter, projectsMap]);

    const filteredEvents = useMemo(() => {
        return filterEvents(rawEvents);
    }, [rawEvents, filterEvents]);

    // FullCalendarに渡す前に、endがnullのイベントをundefinedに変換し、色を再計算
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

            // バックエンドイベント（会議、マイルストーン、締切、ワークショップなど）の色を再計算
            let backgroundColor = event.backgroundColor;
            let borderColor = event.borderColor;

            const eventType = event.extendedProps?.type?.toLowerCase();
            if (eventType && eventType !== 'project' && eventType !== 'task' && eventType !== 'group') {
                // バックエンドイベントの場合、色を再計算（Mapを使用してO(1)検索）
                const projectId = event.extendedProps?.projectId;
                const project = projectId ? projectsMap.get(String(projectId)) : undefined;
                const typeForColor = event.extendedProps?.type;
                // 会議・ワークショップは実施日（start）で過去/色判定。終日は排他的終了日のため end の前日で判定
                let eventDate: string | Date | null = null;
                if (typeForColor === 'Meeting' || typeForColor === 'Workshop') {
                    eventDate = event.start ? (typeof event.start === 'string' ? event.start : event.start) : null;
                } else if (event.end) {
                    const endVal = typeof event.end === 'string' ? parseISO(event.end) : event.end;
                    eventDate = event.allDay ? addDays(endVal, -1) : endVal;
                } else if (event.start) {
                    eventDate = typeof event.start === 'string' ? event.start : event.start;
                }

                const recalculatedColor = getEventColor(
                    typeForColor ?? 'Generic',
                    project?.status ?? undefined,
                    eventDate
                );

                backgroundColor = recalculatedColor;
                borderColor = recalculatedColor;
            } else if (eventType === 'task') {
                // タスクの場合も色を再計算（Mapを使用してO(1)検索）
                const projectId = event.extendedProps?.projectId;
                const project = projectId ? projectsMap.get(String(projectId)) : undefined;
                const taskDueDate = event.extendedProps?.taskDueDate;

                const recalculatedColor = getTaskColor(
                    event.extendedProps?.taskStatus ?? 'todo',
                    project?.status ?? undefined,
                    taskDueDate
                );

                backgroundColor = recalculatedColor;
                borderColor = recalculatedColor;
            }

            return {
                ...event,
                start: startStr,
                end: endStr,
                backgroundColor,
                borderColor,
                color: backgroundColor, // FullCalendarでもcolorプロパティを設定
            };
        });
    }, [filteredEvents, projectsMap]);

    // eventsForFullCalendarが変更されたときに、FullCalendarのイベントを更新
    // 注意: FullCalendarは自動的に再レンダリングするため、render()の呼び出しは不要
    // タスクの色のみ、必要に応じて更新（パフォーマンス最適化のため最小限の処理）
    useEffect(() => {
        if (calendarRef.current && eventsForFullCalendar.length > 0) {
            // タスクの色のみ更新（他のイベントはCSSクラスで制御されるため不要）
            const timeoutId = setTimeout(() => {
                const calendarApi = calendarRef.current?.getApi();
                if (!calendarApi) return;

                // タスクの色のみ更新（最小限の処理）
                eventsForFullCalendar.forEach(event => {
                    const eventType = event.extendedProps?.type?.toLowerCase();
                    if (eventType === 'task') {
                        const existingEvent = calendarApi.getEventById(event.id);
                        if (existingEvent && existingEvent.backgroundColor !== event.backgroundColor) {
                            // 色が変更された場合のみ更新
                            existingEvent.setProp('backgroundColor', event.backgroundColor);
                            existingEvent.setProp('borderColor', event.borderColor);
                            existingEvent.setProp('color', event.color);

                            // DOM要素の色も更新
                            const eventEl = (existingEvent as any).el;
                            if (eventEl) {
                                eventEl.style.setProperty('background-color', event.backgroundColor, 'important');
                                eventEl.style.setProperty('border-color', event.borderColor || event.backgroundColor, 'important');
                            }
                        }
                    }
                });
                // render()は呼ばない（FullCalendarが自動的に再レンダリングする）
            }, 0);

            return () => clearTimeout(timeoutId);
        }
    }, [eventsForFullCalendar]);

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

    // ★★★ handleDateClick をダブルクリック対応に修正（モバイルではシングルタップで日付選択） ★★★
    const handleDateClick = (arg: DateClickArg) => {
        // モバイルではシングルタップで日付を選択してイベント詳細ボトムシートを開く
        if (isMobile) {
            console.log("[CalendarPage] Mobile: Single tap on date to show events:", arg.date);
            const newSelectedDate = arg.date;
            setSelectedDate(newSelectedDate);
            setSelectedEventDetails({ event: null });
            setMobileEventDetailsOpen(true);
            return;
        }

        // PCではダブルクリックで作成
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
        const clickedEvent = rawEvents.find(event => event.id === clickInfo.event.id);
        if (!clickedEvent) {
            setSelectedEventDetails({ event: null });
            return;
        }

        // モバイルではシングルタップでイベント詳細ボトムシートを開く
        if (isMobile) {
            console.log("[CalendarPage] Mobile: Single tap on event to show details:", clickedEvent);
            let totalCost: number | undefined = undefined;
            if (clickedEvent.extendedProps.type === 'Task') {
                totalCost = clickedEvent.extendedProps.taskCost ?? 0;
            } else if (clickedEvent.start) {
                const dayEvents = rawEvents.filter(event => event.start && isSameDay(parseISO(event.start as string), parseISO(clickedEvent.start as string)));
                totalCost = calculateTotalCost(dayEvents);
            }
            if (clickedEvent.start) {
                setSelectedDate(clickedEvent.start instanceof Date ? clickedEvent.start : parseISO(clickedEvent.start as string));
            }
            setSelectedEventDetails({ event: clickedEvent, totalCost });
            setMobileEventDetailsOpen(true);
            return;
        }

        // PCではダブルクリックで編集、シングルクリックで詳細パネル表示
        const now = Date.now();
        const isDoubleClick = (now - lastClickTimeRef.current < DOUBLE_CLICK_THRESHOLD) && lastClickedEventIdRef.current === clickInfo.event.id;
        lastClickTimeRef.current = now;
        lastClickedEventIdRef.current = clickInfo.event.id;

        // ダブルクリックと判定した場合は編集モーダルを開く
        if (isDoubleClick) {
            handleOpenEditModal(clickedEvent);
            return;
        }
        // シングルクリック: 詳細パネルに表示
        let totalCost: number | undefined = undefined;
        if (clickedEvent.extendedProps.type === 'Task') {
            totalCost = clickedEvent.extendedProps.taskCost ?? 0;
        } else if (clickedEvent.start) {
            const dayEvents = rawEvents.filter(event => event.start && isSameDay(parseISO(event.start as string), parseISO(clickedEvent.start as string)));
            totalCost = calculateTotalCost(dayEvents);
        }
        if (clickedEvent.start) {
            setSelectedDate(clickedEvent.start instanceof Date ? clickedEvent.start : parseISO(clickedEvent.start as string));
        }
        setSelectedEventDetails({ event: clickedEvent, totalCost });
        setIsPanelMinimized(false);
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
        setModalEventToEdit(null); // 作成ボタン・日付クリックは常に新規
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
        setModalEventToEdit(event); // 編集時のみモーダルに渡す
        setIsAddModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsAddModalOpen(false);
    };

    // 編集モーダル表示中は小窓（fc-popover）を背面に回し、モーダルが前面に表示されるようにする
    useEffect(() => {
        if (isAddModalOpen) document.body.classList.add('calendar-modal-open');
        else document.body.classList.remove('calendar-modal-open');
        return () => document.body.classList.remove('calendar-modal-open');
    }, [isAddModalOpen]);

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
        const editingEventId = modalEventToEdit?.id;
        const eventId = modalId ? String(modalId) : editingEventId;
        console.log(`Determining eventId: modalData.id=${modalId}, modalEventToEdit?.id=${editingEventId}, final eventId=${eventId}`);

        try {
            let response;
            const numericIdForApi = eventId ? eventId.replace(/^(proj-|task-|event-)/, '') : null;

            const typeForSave = modalData.type || modalEventToEdit?.extendedProps?.type || 'Generic';
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
                        project_id: md.project_id != null && md.project_id !== '' ? parseInt(String(md.project_id)) : null,
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
                        project_id: md.project_id != null && md.project_id !== '' ? parseInt(String(md.project_id)) : null,
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
                            const normalizedType = (be.type && be.type.trim() !== '' && be.type.toLowerCase() !== 'event')
                                ? be.type
                                : 'Generic';
                            // 会議・ワークショップは実施日（start_time）で過去/色判定。終日はAPIが翌日00:00で返すため end の前日で判定
                            const eventDate = (normalizedType === 'Meeting' || normalizedType === 'Workshop')
                                ? parseISO(originalStartTimeStr)
                                : (originalEndTimeStr ? ((be.allDay ?? false) ? addDays(parseISO(originalEndTimeStr), -1) : parseISO(originalEndTimeStr)) : parseISO(originalStartTimeStr));
                            const eventColor = getEventColor(
                                normalizedType ?? 'Generic',
                                project?.status ?? undefined,
                                eventDate
                            );

                            return {
                                id: `event-${be.id}`,
                                title: be.title,
                                start: parseISO(originalStartTimeStr),
                                end: originalEndTimeStr ? parseISO(originalEndTimeStr) : undefined,
                                allDay: be.allDay ?? false,
                                backgroundColor: eventColor,
                                borderColor: eventColor,
                                extendedProps: {
                                    type: normalizedType,
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
                                const normalizedType = (be.type && be.type.trim() !== '' && be.type.toLowerCase() !== 'event')
                                    ? be.type
                                    : 'Generic';
                                // 会議・ワークショップは実施日（start_time）で過去/色判定。終日はAPIが翌日00:00で返すため end の前日で判定
                                const eventDate = (normalizedType === 'Meeting' || normalizedType === 'Workshop')
                                    ? parseISO(originalStartTimeStr)
                                    : (originalEndTimeStr ? ((be.allDay ?? false) ? addDays(parseISO(originalEndTimeStr), -1) : parseISO(originalEndTimeStr)) : parseISO(originalStartTimeStr));
                                const eventColor = getEventColor(
                                    normalizedType ?? 'Generic',
                                    project?.status ?? undefined,
                                    eventDate
                                );

                                return {
                                    id: `event-${be.id}`,
                                    title: be.title,
                                    start: parseISO(originalStartTimeStr),
                                    end: originalEndTimeStr ? parseISO(originalEndTimeStr) : undefined,
                                    allDay: be.allDay ?? false,
                                    backgroundColor: eventColor,
                                    borderColor: eventColor,
                                    extendedProps: {
                                        type: normalizedType,
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

    const formatForApi = (d: Date | null, allDay: boolean): string | undefined => {
        if (!d) return undefined;
        return allDay
            ? formatDateFnsOriginal(startOfDay(d), 'yyyy-MM-dd')
            : formatDateFnsOriginal(d, "yyyy-MM-dd'T'HH:mm:ssXXX");
    };

    const handleEventDrop = useCallback(async (arg: EventDropArg) => {
        const ev = arg.event;
        const idStr = ev.id;
        const numericMatch = idStr.match(/\d+$/);
        if (!numericMatch) {
            arg.revert();
            return;
        }
        const numericId = numericMatch[0];
        const start = ev.start ? new Date(ev.start) : null;
        const end = ev.end ? new Date(ev.end) : null;
        const allDay = ev.allDay ?? false;
        const type = (ev.extendedProps?.type as string)?.toLowerCase?.();

        try {
            if (type === 'task') {
                const dueDate = formatForApi(start, true);
                if (!dueDate) {
                    arg.revert();
                    return;
                }
                await api.put(`/tasks/${numericId}`, { due_date: `${dueDate}T00:00:00+09:00` });
            } else if (type === 'project' || idStr.startsWith('proj-')) {
                const startDate = formatForApi(start, true);
                const endDate = end && allDay ? formatForApi(addDays(end, -1), true) : formatForApi(end, true);
                if (!startDate) {
                    arg.revert();
                    return;
                }
                await api.put(`/projects/${numericId}`, {
                    start_date: `${startDate}T00:00:00+09:00`,
                    end_date: endDate ? `${endDate}T00:00:00+09:00` : undefined,
                });
            } else {
                const startTime = formatForApi(start, allDay);
                const endTime = formatForApi(end ?? start, allDay);
                if (!startTime || !endTime) {
                    arg.revert();
                    return;
                }
                await api.put(`/calendar/events/${numericId}`, {
                    start_time: allDay ? `${startTime}T00:00:00+09:00` : startTime,
                    end_time: allDay ? `${endTime}T00:00:00+09:00` : endTime,
                });
            }
            if (refreshGlobalData) await refreshGlobalData();
        } catch (err) {
            console.error('Event drop update failed:', err);
            arg.revert();
        }
    }, [refreshGlobalData]);

    const handleEventResize = useCallback(async (arg: EventResizeDoneArg) => {
        const ev = arg.event;
        const idStr = ev.id;
        const numericMatch = idStr.match(/\d+$/);
        if (!numericMatch) {
            arg.revert();
            return;
        }
        const numericId = numericMatch[0];
        const start = ev.start ? new Date(ev.start) : null;
        const end = ev.end ? new Date(ev.end) : null;
        const allDay = ev.allDay ?? false;
        const type = (ev.extendedProps?.type as string)?.toLowerCase?.();

        if (type === 'task') {
            arg.revert();
            return;
        }
        try {
            if (type === 'project' || idStr.startsWith('proj-')) {
                const startDate = formatForApi(start, true);
                const endDate = end && allDay ? formatForApi(addDays(end, -1), true) : formatForApi(end, true);
                if (!startDate) {
                    arg.revert();
                    return;
                }
                await api.put(`/projects/${numericId}`, {
                    start_date: `${startDate}T00:00:00+09:00`,
                    end_date: endDate ? `${endDate}T00:00:00+09:00` : undefined,
                });
            } else {
                const startTime = formatForApi(start, allDay);
                const endTime = formatForApi(end ?? start, allDay);
                if (!startTime || !endTime) {
                    arg.revert();
                    return;
                }
                await api.put(`/calendar/events/${numericId}`, {
                    start_time: allDay ? `${startTime}T00:00:00+09:00` : startTime,
                    end_time: allDay ? `${endTime}T00:00:00+09:00` : endTime,
                });
            }
            if (refreshGlobalData) await refreshGlobalData();
        } catch (err) {
            console.error('Event resize update failed:', err);
            arg.revert();
        }
    }, [refreshGlobalData]);

    if (loading && rawEvents.length === 0) {
        return <CircularProgress />;
    }

    console.log("Events being passed to FullCalendar:", eventsForFullCalendar); // ★ このログを追加

    const handleDayCellMount = (mountArg: DayCellMountArg) => {
        if (mountArg.isWeekend) {
            mountArg.el.setAttribute('data-weekend', 'true');
        }
    };

    // イベント種別の表示ラベル（直感的にわかる日本語）
    const getEventTypeLabel = (type: string | undefined): string => {
        if (!type) return '予定';
        const t = type.toLowerCase();
        if (t === 'project') return 'プロジェクト';
        if (t === 'task') return 'タスク';
        if (t === 'milestone') return 'マイルストーン';
        if (t === 'deadline') return '締切';
        if (t === 'meeting') return '会議';
        if (t === 'workshop') return 'ワークショップ';
        if (t === 'generic' || t === 'event') return '通常';
        return type;
    };

    // ★★★ FullCalendar の eventContent を追加して表示をカスタマイズ ★★★
    const renderEventContent = (eventInfo: any) => {
        const { type } = eventInfo.event.extendedProps;
        const title = eventInfo.event.title || '';
        const typeLabel = getEventTypeLabel(type);

        // 複数日にまたがるイベント判定
        const isMultiDay = eventInfo.event.allDay &&
            eventInfo.event.start &&
            eventInfo.event.end &&
            eventInfo.event.start.getTime() !== eventInfo.event.end.getTime();

        // プロジェクトまたは複数日にまたがる通常イベント
        if (type === 'project' || isMultiDay) {
            return (
                <div className="calendar-event-inner" style={{ width: '100%', overflow: 'hidden', display: 'block' }}>
                    <span className="calendar-event-type-badge calendar-event-type-project" title={typeLabel}>
                        {type === 'project' ? 'P' : '予定'}
                    </span>
                    <span className="calendar-event-title" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={title}>
                        {title}
                    </span>
                </div>
            );
        }

        // マイルストーン（Milestone）
        if (type === 'Milestone') {
            return (
                <div className="calendar-event-inner milestone-event-content" style={{ width: '100%', overflow: 'hidden' }}>
                    <span className="calendar-event-type-badge" title={typeLabel}>MS</span>
                    <span className="calendar-event-title" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={title}>{title}</span>
                </div>
            );
        }

        // 締切（Deadline）
        if (type === 'Deadline') {
            return (
                <div className="calendar-event-inner deadline-event-content" style={{ width: '100%', overflow: 'hidden' }}>
                    <span className="calendar-event-type-badge calendar-event-type-deadline" title={typeLabel}>締切</span>
                    <span className="calendar-event-title" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={title}>{title}</span>
                </div>
            );
        }

        // 会議（Meeting）・ワークショップ（Workshop）- 時間を表示
        if (type === 'Meeting' || type === 'Workshop') {
            const timeText = eventInfo.timeText || '';
            const displayTitle = timeText ? `${timeText} ${title}` : title;
            const badge = type === 'Meeting' ? '会議' : 'WS';
            return (
                <div className="calendar-event-inner" style={{ width: '100%', overflow: 'hidden' }}>
                    <span className={`calendar-event-type-badge calendar-event-type-${type === 'Meeting' ? 'meeting' : 'workshop'}`} title={typeLabel}>{badge}</span>
                    {timeText && <span className="calendar-event-time" style={{ fontWeight: 600 }}>{timeText}</span>}
                    <span className="calendar-event-title" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={displayTitle}>
                        {timeText && ' '}{title}
                    </span>
                </div>
            );
        }

        // 通常イベント（Generic / Event）- 時間指定の場合は時間を表示
        if (type === 'Generic' || (type && type.toLowerCase() === 'generic') || (type && type.toLowerCase() === 'event')) {
            const isTimedEvent = !eventInfo.event.allDay && eventInfo.timeText;
            const timeText = eventInfo.timeText || '';
            const displayTitle = timeText ? `${timeText} ${title}` : title;
            return (
                <div className="calendar-event-inner calendar-event-generic" style={{ width: '100%', overflow: 'hidden' }}>
                    <span className="calendar-event-type-badge calendar-event-type-generic" title={typeLabel}>予定</span>
                    {isTimedEvent && <span className="calendar-event-time" style={{ fontWeight: 600 }}>{timeText}</span>}
                    <span className="calendar-event-title" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={displayTitle}>
                        {isTimedEvent && ' '}{title}
                    </span>
                </div>
            );
        }

        // タスク
        if (type === 'task') {
            return (
                <div className="calendar-event-inner" style={{ width: '100%', overflow: 'hidden' }}>
                    <span className="calendar-event-type-badge calendar-event-type-task" title={typeLabel}>T</span>
                    <span className="calendar-event-title" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={title}>{title}</span>
                </div>
            );
        }

        // その他（ラベル＋タイトル）
        return (
            <div className="calendar-event-inner" style={{ width: '100%', overflow: 'hidden' }}>
                <span className="calendar-event-type-badge" title={typeLabel}>{typeLabel.slice(0, 2)}</span>
                <span className="calendar-event-title" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={title}>{title}</span>
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
                eventToEdit={modalEventToEdit}
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
            ref={containerRef}
            sx={(theme) => ({
                display: 'flex',
                flexDirection: 'column',
                height: { xs: 'calc(100vh - 56px)', sm: 'calc(100vh - 64px)' },
                overflow: { xs: 'auto', sm: 'hidden' },
                p: { xs: 1, sm: 2 },
                bgcolor: theme.palette.mode === 'dark'
                    ? theme.palette.background.default
                    : 'grey.50',
            })}
        >
            {/* Google風トップバー: 作成ボタン（PCのみ） */}
            {!isMobile && (
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        minHeight: 48,
                        px: { xs: 1, sm: 2 },
                        mb: 1,
                        flexShrink: 0,
                        flexWrap: 'wrap',
                        gap: 1,
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 }, flexWrap: 'wrap' }}>
                        <Button
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={() => handleOpenAddModal()}
                            size={isSmallScreen ? "small" : "medium"}
                            sx={{
                                textTransform: 'none',
                                fontWeight: 600,
                                borderRadius: 2,
                                boxShadow: 0,
                                fontSize: { xs: '0.8rem', sm: '0.875rem' },
                                '&:hover': { boxShadow: 1 },
                            }}
                        >
                            作成
                        </Button>
                        <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.7rem', sm: '0.875rem' }, display: { xs: 'none', md: 'block' } }}>
                            予定はドラッグ&ドロップで移動できます。タスクは期日が更新されます。ダブルクリックで編集できます。
                        </Typography>
                    </Box>
                </Box>
            )}

            {/* モバイル用: フィルターボタンと作成ボタン */}
            {isMobile && (
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        px: { xs: 1, sm: 2 },
                        py: { xs: 1, sm: 1 },
                        mb: { xs: 1, sm: 1 },
                        gap: 1,
                        flexWrap: 'wrap',
                    }}
                >
                    <IconButton
                        onClick={() => setMobileFilterOpen(true)}
                        sx={{
                            color: 'text.primary',
                            minWidth: 48,
                            minHeight: 48,
                        }}
                    >
                        <FilterListIcon />
                    </IconButton>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => handleOpenAddModal()}
                        size="medium"
                        sx={{
                            textTransform: 'none',
                            fontWeight: 600,
                            borderRadius: 2,
                            fontSize: '0.875rem',
                            minHeight: 48,
                            px: 2,
                        }}
                    >
                        作成
                    </Button>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', flex: 1, justifyContent: 'flex-end', minWidth: 0 }}>
                        {Object.entries(eventTypeFilter).filter(([_, enabled]) => enabled).map(([type, _]) => (
                            <Chip
                                key={type}
                                label={type === 'task' ? 'タスク' : type === 'meeting' ? '会議' : type === 'deadline' ? '締切' : type === 'milestone' ? 'マイルストーン' : type === 'workshop' ? 'ワークショップ' : type === 'generic' ? '通常' : type}
                                size="small"
                                sx={{ fontSize: '0.7rem', height: 28, minHeight: 28 }}
                            />
                        ))}
                    </Box>
                </Box>
            )}

            {/* メイン: カレンダー + 右パネル */}
            <Box
                sx={{
                    display: 'flex',
                    flex: { xs: '0 1 auto', sm: 1 },
                    minHeight: { xs: 'auto', sm: 0 },
                    gap: 0,
                    borderRadius: 2,
                    overflow: { xs: 'visible', sm: 'hidden' },
                    bgcolor: 'background.paper',
                    boxShadow: 0,
                    border: '1px solid',
                    borderColor: 'divider',
                    mb: { xs: 2, sm: 0 },
                }}
            >
                <Box
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: { xs: 'visible', sm: 'hidden' },
                        p: { xs: 0.5, sm: 1, md: 2 },
                        position: 'relative',
                        minHeight: { xs: 'auto', sm: 'auto' },
                        width: '100%',
                    }}
                >
                    <style>{`
                /* Google風: ツールバーをフラットに */
                .fc .fc-header-toolbar,
                .fc .fc-toolbar {
                    background-color: ${isDark ? '#202124' : '#ffffff'} !important;
                    border-bottom: 1px solid ${isDark ? '#3c4043' : '#e8eaed'} !important;
                    padding: ${isMobile ? '8px 4px' : '12px 8px'} !important;
                }
                .fc .fc-toolbar-chunk { display: flex; align-items: center; gap: 4px; }
                .fc .fc-toolbar-title { font-size: ${isMobile ? '1rem' : '1.25rem'} !important; font-weight: 500 !important; color: ${isDark ? '#e8eaed' : '#202124'} !important; }
                .fc .fc-button-primary {
                    background: transparent !important;
                    color: ${isDark ? '#9aa0a6' : '#5f6368'} !important;
                    border: none !important;
                    box-shadow: none !important;
                    text-transform: none;
                    font-weight: 500;
                }
                .fc .fc-button-primary:hover {
                    background: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)'} !important;
                    color: ${isDark ? '#e8eaed' : '#202124'} !important;
                }
                .fc .fc-button-primary:not(:disabled).fc-button-active,
                .fc .fc-button-primary:not(:disabled):active {
                    background: ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'} !important;
                    color: ${isDark ? '#e8eaed' : '#202124'} !important;
                }
                .fc .fc-scrollgrid { border-color: ${isDark ? '#3c4043' : '#e8eaed'} !important; }
                .fc .fc-col-header-cell-cushion { color: ${isDark ? '#9aa0a6' : '#5f6368'}; font-weight: 500; font-size: 0.7rem; padding: 8px; }
                .fc .fc-daygrid-day-number { color: ${isDark ? '#9aa0a6' : '#5f6368'}; font-size: 0.75rem; padding: 4px; }
                .fc .fc-daygrid-day.fc-day-today {
                    background-color: ${isDark ? '#1a73e8' : '#e8f0fe'};
                }
                .fc .fc-daygrid-day.fc-day-selected {
                    background-color: ${isDark ? '#174ea6' : '#90caf9'} !important;
                }
                .fc .fc-daygrid-day[data-weekend="true"] {
                    background-color: ${isDark ? '#292a2d' : '#fafafa'};
                }
                /* 月曜日から金曜日の文字色（ダークモードでは明るい色に） */
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
                    color: ${isDark ? '#e8eaed' : '#000000'} !important;
                }
                /* 土曜日: 青系（ダークモードではやや明るめの青） */
                .fc .fc-col-header-cell.fc-day-sat,
                .fc .fc-col-header-cell.fc-day-sat a,
                .fc .fc-col-header-cell.fc-day-sat .fc-scrollgrid-sync-inner,
                .fc .fc-daygrid-day.fc-day-sat .fc-daygrid-day-number {
                    color: ${isDark ? '#8ab4f8' : '#1a73e8'} !important;
                }
                /* 日曜日: 赤系（ダークモードではやや明るめの赤） */
                .fc .fc-col-header-cell.fc-day-sun,
                .fc .fc-col-header-cell.fc-day-sun a,
                .fc .fc-col-header-cell.fc-day-sun .fc-scrollgrid-sync-inner,
                .fc .fc-daygrid-day.fc-day-sun .fc-daygrid-day-number {
                    color: ${isDark ? '#f28b82' : '#d93025'} !important;
                }
                .fc                 .fc-list-event-dot {
                    border-color: var(--fc-event-border-color, #3788d8);
                    background-color: var(--fc-event-bg-color, #3788d8);
                }
                /* リストビュー全体のスタイル（ダークモード対応） */
                .fc-list-view {
                    background-color: ${isDark ? '#121212' : '#ffffff'} !important;
                    ${isMobile ? 'overflow-y: auto !important; max-height: none !important;' : ''}
                }
                .fc-scroller {
                    ${isMobile ? 'overflow-y: auto !important; overflow-x: hidden !important; height: auto !important;' : ''}
                }
                .fc-scroller-liquid-absolute {
                    ${isMobile ? 'position: relative !important;' : ''}
                }
                .fc-list-table {
                    background-color: ${isDark ? '#121212' : '#ffffff'} !important;
                }
                .fc-list-table td {
                    background-color: ${isDark ? '#121212' : '#ffffff'} !important;
                    border-color: ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'} !important;
                }
                .fc-list-day {
                    background-color: ${isDark ? '#1e1e1e' : '#fafafa'} !important;
                }
                .fc-list-day-cushion {
                    background-color: ${isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'} !important;
                    color: ${isDark ? '#9aa0a6' : '#5f6368'} !important;
                    border-bottom: 1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'} !important;
                }
                .fc-list-day-cushion a {
                    color: ${isDark ? '#9aa0a6' : '#5f6368'} !important;
                }
                .fc-list-event {
                    background-color: ${isDark ? '#1e1e1e' : '#ffffff'} !important;
                    color: ${isDark ? '#e8eaed' : '#202124'} !important;
                }
                .fc-list-event-title {
                    color: ${isDark ? '#e8eaed' : '#202124'} !important;
                }
                .fc-list-event-time {
                    color: ${isDark ? '#9aa0a6' : '#5f6368'} !important;
                }
                /* モバイル用: リストビューのスタイル改善 */
                ${isMobile ? `
                    .fc-list-event {
                        padding: ${isMobile ? '12px 8px' : '16px'} !important;
                        margin-bottom: 8px !important;
                        border-radius: 8px !important;
                        cursor: pointer !important;
                        transition: background-color 0.2s ease !important;
                        overflow: hidden !important;
                    }
                    .fc-list-event:hover {
                        background-color: ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)'} !important;
                    }
                    .fc-list-event-title {
                        font-size: 0.9rem !important;
                        font-weight: 500 !important;
                        margin-bottom: 4px !important;
                        overflow: hidden !important;
                        text-overflow: ellipsis !important;
                        white-space: nowrap !important;
                        max-width: 100% !important;
                        display: block !important;
                    }
                    .fc-list-event-title-wrapper {
                        overflow: hidden !important;
                        text-overflow: ellipsis !important;
                        white-space: nowrap !important;
                        max-width: 100% !important;
                        min-width: 0 !important;
                    }
                    .fc-list-event-time {
                        font-size: 0.8rem !important;
                        color: ${isDark ? '#9aa0a6' : '#5f6368'} !important;
                        margin-bottom: 4px !important;
                        overflow: hidden !important;
                        text-overflow: ellipsis !important;
                        white-space: nowrap !important;
                    }
                    .fc-list-event-dot {
                        width: 12px !important;
                        height: 12px !important;
                        margin-right: 12px !important;
                        margin-top: 4px !important;
                        flex-shrink: 0 !important;
                    }
                    .fc-list-day-cushion {
                        padding: 12px 8px !important;
                        font-weight: 600 !important;
                        font-size: 0.85rem !important;
                        background-color: ${isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'} !important;
                        color: ${isDark ? '#9aa0a6' : '#5f6368'} !important;
                        border-bottom: 1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'} !important;
                        margin-bottom: 4px !important;
                    }
                    .fc-list-day-cushion a {
                        color: ${isDark ? '#9aa0a6' : '#5f6368'} !important;
                    }
                    .fc-list-table {
                        width: 100% !important;
                        table-layout: fixed !important;
                    }
                    .fc-list-table td {
                        overflow: hidden !important;
                        text-overflow: ellipsis !important;
                        white-space: nowrap !important;
                    }
                    .fc-list-event-frame {
                        display: flex !important;
                        align-items: center !important;
                        min-width: 0 !important;
                        overflow: hidden !important;
                    }
                    .fc-list-event-graphic {
                        flex-shrink: 0 !important;
                    }
                    .fc-list-event-content {
                        flex: 1 !important;
                        min-width: 0 !important;
                        overflow: hidden !important;
                    }
                ` : ''}
                .fc-daygrid-event:not(.fc-event-bg) {
                    cursor: pointer;
                }
                .fc {
                    font-size: ${isSmallScreen ? '0.7rem' : '0.8rem'};
                }
                /* 日付セル（日付コマ）の高さを全ての週で統一 */
                .fc-daygrid-day-frame {
                    min-height: ${isSmallScreen ? '80px' : '120px'} !important;
                    height: ${isSmallScreen ? '80px' : '120px'} !important;
                }
                /* 週の行の高さも統一 */
                .fc-daygrid-body tr {
                    height: ${isSmallScreen ? '80px' : '120px'} !important;
                }
                /* イベントエリアの高さも統一（重要） */
                .fc-daygrid-day-events {
                    height: ${isSmallScreen ? '80px' : '120px'} !important;
                    min-height: ${isSmallScreen ? '80px' : '120px'} !important;
                    max-height: ${isSmallScreen ? '80px' : '120px'} !important;
                }
                /* 日付セルのトップ部分（日付番号）の高さを固定 */
                .fc-daygrid-day-top {
                    height: ${isSmallScreen ? '16px' : '20px'} !important;
                    min-height: ${isSmallScreen ? '16px' : '20px'} !important;
                    max-height: ${isSmallScreen ? '16px' : '20px'} !important;
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
                /* グレーイベント（完了/キャンセルプロジェクトまたは日付が過ぎたイベント） */
                .fc-event.grey-event.deadline-event-wrapper .deadline-event-content {
                    color: #9E9E9E !important;
                }
                .fc-event.grey-event.deadline-event-wrapper .calendar-event-type-deadline {
                    background-color: #9E9E9E !important;
                }
                .fc-event.grey-event.milestone-event-wrapper .milestone-event-content {
                    background-color: #9E9E9E !important;
                    color: #ffffff !important;
                }
                .fc-event.grey-event.meeting-event,
                .fc-daygrid-event.grey-event.meeting-event,
                .fc-event.grey-event.workshop-event,
                .fc-daygrid-event.grey-event.workshop-event {
                    background: none !important;
                    border: none !important;
                    box-shadow: none !important;
                }
                .fc-event.grey-event.meeting-event *,
                .fc-daygrid-event.grey-event.meeting-event *,
                .fc-event.grey-event.workshop-event *,
                .fc-daygrid-event.grey-event.workshop-event * {
                    color: #9E9E9E !important;
                }
                .fc-event.grey-event.custom-event {
                    background-color: #9E9E9E !important;
                    border-color: #9E9E9E !important;
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
                /* 「+N件」リンクのスタイル（クリックで折りたたみ分を小窓表示） */
                .fc-more-link {
                    display: block;
                    padding: 2px 4px;
                    font-size: 0.75rem;
                    color: #1976d2;
                    cursor: pointer;
                    text-align: left;
                    white-space: nowrap;
                    text-decoration: none;
                }
                .fc-more-link:hover {
                    text-decoration: underline;
                }
                /* ポップオーバー（+N件クリック時の小窓）を前面に表示 */
                .fc-popover {
                    z-index: 1100;
                }
                /* 編集モーダル表示中は小窓を背面に回す（モーダルが前面に） */
                body.calendar-modal-open .fc-popover {
                    z-index: 0;
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
                /* カレンダー予定の種別バッジ・直感的表示 */
                .calendar-event-inner {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    width: 100%;
                    min-height: 1.2em;
                    padding: 0 2px;
                }
                .calendar-event-type-badge {
                    flex-shrink: 0;
                    font-size: ${isSmallScreen ? '0.55rem' : '0.65rem'};
                    font-weight: 700;
                    padding: ${isSmallScreen ? '0.5px 3px' : '1px 4px'};
                    border-radius: 3px;
                    line-height: 1.2;
                }
                .calendar-event-type-generic {
                    background: #2196f3;
                    color: #fff;
                }
                .calendar-event-type-project {
                    background: #757575;
                    color: #fff;
                }
                .calendar-event-type-task {
                    background: #4caf50;
                    color: #fff;
                }
                .calendar-event-type-deadline {
                    background: #d32f2f;
                    color: #fff;
                }
                .milestone-event-content .calendar-event-type-badge {
                    background: #d32f2f;
                    color: #fff;
                }
                .calendar-event-type-meeting,
                .fc-event.meeting-event .calendar-event-type-badge {
                    background: #1976d2;
                    color: #fff;
                }
                .calendar-event-type-workshop,
                .fc-event.workshop-event .calendar-event-type-badge {
                    background: #00897b;
                    color: #fff;
                }
                .calendar-event-title {
                    flex: 1;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .calendar-event-time {
                    flex-shrink: 0;
                    font-size: 0.7rem;
                }
                .fc-event.generic-event .fc-event-main,
                .fc-event.generic-event .fc-event-main * {
                    color: #fff !important;
                }
            `}</style>

                    {error && <Typography color="error" sx={{ px: 1 }}>{error}</Typography>}
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
                        initialView={isMobile ? "listWeek" : "dayGridMonth"}
                        headerToolbar={isMobile ? {
                            left: 'prev,next',
                            center: 'title',
                            right: 'listWeek'
                        } : {
                            left: 'prev,next today',
                            center: 'title',
                            right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
                        }}
                        events={eventsForFullCalendar}
                        locale={'ja'}
                        timeZone={'Asia/Tokyo'}
                        slotMinTime="05:00:00"
                        slotMaxTime="29:00:00"
                        eventTimeFormat={{
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false
                        }}
                        height={isMobile ? "auto" : "100%"}
                        contentHeight={isMobile ? "auto" : "auto"}
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

                            // プロジェクトのステータスを確認（Mapを使用してO(1)検索）
                            const project = projectId ? projectsMap.get(String(projectId)) : undefined;
                            const projectStatusStr = project?.status ? String(project.status).toLowerCase() : undefined;
                            const isCompletedProject = projectStatusStr === 'completed';
                            const isCancelledProject = projectStatusStr === 'cancelled';

                            // イベントの日付を確認（過去判定用）
                            // 会議・ワークショップは実施日（start）で判定。
                            // 終日イベントは FullCalendar が排他的終了日（翌日00:00）で持つため、実質の最終日は end の前日で判定する
                            let eventDate: string | Date | null = null;
                            if (type === 'Meeting' || type === 'Workshop') {
                                // 会議・ワークショップは実施日（start）で判定。FullCalendarのDateオブジェクトを確実に処理
                                if (arg.event.start) {
                                    eventDate = typeof arg.event.start === 'string' ? parseISO(arg.event.start) : arg.event.start;
                                } else {
                                    eventDate = null;
                                }
                            } else if (arg.event.end) {
                                if (arg.event.allDay) {
                                    const endVal = arg.event.end;
                                    const endDate = typeof endVal === 'string' ? parseISO(endVal) : endVal;
                                    eventDate = addDays(endDate, -1); // 排他的終了日のため前日が実質の最終日
                                } else {
                                    eventDate = typeof arg.event.end === 'string' ? parseISO(arg.event.end) : arg.event.end;
                                }
                            } else if (arg.event.start) {
                                eventDate = typeof arg.event.start === 'string' ? parseISO(arg.event.start) : arg.event.start;
                            }
                            const isPastEvent = eventDate ? isDatePast(eventDate) : false;

                            // プロジェクトが完了またはキャンセル、または日付が過ぎた場合は特別なクラスを追加
                            if (isCompletedProject || isCancelledProject || isPastEvent) {
                                classes.push('grey-event');
                            }

                            // 完了プロジェクトの場合は特別なクラスを追加（後方互換性のため）
                            if (isCompletedProject) {
                                classes.push('completed-project-event');
                            }

                            // 既存のクラス設定
                            if (type === 'project') {
                                classes.push('project-event');
                            } else if (type === 'task' || type === 'Task') {
                                // タスクの場合は特別な処理は不要（eventDidMountで色を設定）
                                // ただし、プロジェクトが完了/キャンセルまたは日付が過ぎた場合はgrey-eventクラスを追加
                                if (isCompletedProject || isCancelledProject || isPastEvent) {
                                    classes.push('grey-task');
                                }
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
                            } else if (type === 'Generic' || (type && type.toLowerCase() === 'generic') || (type && type.toLowerCase() === 'event')) {
                                classes.push('custom-event');
                                classes.push('generic-event');
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

                            // タスクの色を設定（タスクはeventClassNamesで処理されないため、ここで設定が必要）
                            const eventType = type?.toLowerCase();
                            if (eventType === 'task') {
                                const projectId = arg.event.extendedProps?.projectId;
                                const project = projectId ? projectsMap.get(String(projectId)) : undefined;
                                const taskDueDate = arg.event.extendedProps?.taskDueDate;

                                const recalculatedColor = getTaskColor(
                                    arg.event.extendedProps?.taskStatus ?? 'todo',
                                    project?.status ?? undefined,
                                    taskDueDate
                                );

                                // タスクの色を設定
                                arg.el.style.setProperty('background-color', recalculatedColor, 'important');
                                arg.el.style.setProperty('border-color', recalculatedColor, 'important');

                                // イベントオブジェクトの色も更新
                                arg.event.setProp('backgroundColor', recalculatedColor);
                                arg.event.setProp('borderColor', recalculatedColor);
                                arg.event.setProp('color', recalculatedColor);
                            }
                            // バックエンドイベント（会議、マイルストーン、締切、ワークショップなど）の色は
                            // CSSクラス（grey-event）で制御されるため、eventDidMountでの処理は不要
                        }}
                        dayMaxEventRows={5}
                        dayMaxEvents={5}
                        moreLinkClick="popover"
                        moreLinkContent={(arg) => `+${arg.num}件`}
                        dayCellDidMount={handleDayCellMount}
                        selectable={false}
                        editable={true}
                        eventStartEditable={true}
                        eventDurationEditable={true}
                        selectMirror={true}
                        unselectAuto={false}
                        nowIndicator={true}
                        datesSet={handleDatesSet}
                        viewDidMount={handleViewChange}
                        eventDrop={handleEventDrop}
                        eventResize={handleEventResize}
                    />
                </Box>

                {!isSmallScreen && (
                    <Box
                        sx={{
                            width: isPanelMinimized ? 56 : 360,
                            flexShrink: 0,
                            borderLeft: '1px solid',
                            borderColor: 'divider',
                            overflowY: 'auto',
                            transition: 'width 0.2s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            bgcolor: 'background.paper',
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

            </Box>

            {renderEventModal()}

            {/* モバイル用: フィルターダロワー */}
            {isMobile && (
                <Drawer
                    anchor="bottom"
                    open={mobileFilterOpen}
                    onClose={() => setMobileFilterOpen(false)}
                    PaperProps={{
                        sx: {
                            borderTopLeftRadius: 16,
                            borderTopRightRadius: 16,
                            maxHeight: '80vh',
                        }
                    }}
                >
                    <Box sx={{ p: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                            <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
                                フィルター
                            </Typography>
                            <IconButton onClick={() => setMobileFilterOpen(false)}>
                                <CloseIcon />
                            </IconButton>
                        </Box>

                        {/* プロジェクトフィルター */}
                        <FormControl fullWidth sx={{ mb: 2 }}>
                            <InputLabel>プロジェクト</InputLabel>
                            <Select
                                value={eventStatusFilter}
                                label="プロジェクト"
                                onChange={handleEventStatusFilterChange}
                            >
                                <MenuItem value="all">すべて</MenuItem>
                                {projects.map((p) => (
                                    <MenuItem key={p.id} value={String(p.id)}>
                                        {p.name}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        {/* イベントタイプフィルター */}
                        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                            イベントタイプ
                        </Typography>
                        <FormGroup>
                            {Object.entries(eventTypeFilter).map(([type, enabled]) => (
                                <FormControlLabel
                                    key={type}
                                    control={
                                        <Checkbox
                                            checked={enabled}
                                            onChange={(e) => handleEventTypeFilterChange(type, e.target.checked)}
                                            size="small"
                                        />
                                    }
                                    label={
                                        type === 'task' ? 'タスク' :
                                            type === 'meeting' ? '会議' :
                                                type === 'deadline' ? '締切' :
                                                    type === 'milestone' ? 'マイルストーン' :
                                                        type === 'workshop' ? 'ワークショップ' :
                                                            type === 'generic' ? '通常イベント' :
                                                                type === 'project' ? 'プロジェクト' :
                                                                    type === 'group' ? 'グループ' :
                                                                        type
                                    }
                                    sx={{ fontSize: '0.875rem' }}
                                />
                            ))}
                        </FormGroup>
                    </Box>
                </Drawer>
            )}

            {/* モバイル用: イベント詳細ボトムシート */}
            {isMobile && (
                <Drawer
                    anchor="bottom"
                    open={mobileEventDetailsOpen}
                    onClose={() => setMobileEventDetailsOpen(false)}
                    PaperProps={{
                        sx: {
                            borderTopLeftRadius: 16,
                            borderTopRightRadius: 16,
                            maxHeight: '85vh',
                            display: 'flex',
                            flexDirection: 'column',
                        }
                    }}
                >
                    <Box sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        p: 2,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        flexShrink: 0,
                    }}>
                        <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
                            {selectedEventDetails.event ? 'イベント詳細' : selectedDate ? formatDateFnsOriginal(selectedDate, 'yyyy年M月d日', { locale: ja }) : 'イベント'}
                        </Typography>
                        <IconButton onClick={() => setMobileEventDetailsOpen(false)}>
                            <CloseIcon />
                        </IconButton>
                    </Box>
                    <Box sx={{
                        flex: 1,
                        overflowY: 'auto',
                        p: 2,
                    }}>
                        <EventDetailsPanel
                            selectedDate={selectedDate}
                            selectedEvent={selectedEventDetails.event}
                            totalCost={selectedEventDetails.totalCost}
                            events={filteredEvents}
                            onEventSelect={(event) => {
                                setSelectedEventDetails({ event, totalCost: event.extendedProps.taskCost ?? undefined });
                                setMobileEventDetailsOpen(true);
                            }}
                            isMinimized={false}
                            onToggleMinimize={() => { }}
                            onOpenAddModal={() => {
                                setMobileEventDetailsOpen(false);
                                handleOpenAddModal();
                            }}
                            users={users}
                            groups={groups}
                            onEdit={(event) => {
                                setMobileEventDetailsOpen(false);
                                handleOpenEditModal(event);
                            }}
                            onDelete={handleDeleteEvent as (event: import('../types').CalendarEvent) => void}
                            eventStatusFilter={eventStatusFilter}
                            onEventStatusFilterChange={handleEventStatusFilterChange}
                            eventTypeFilter={eventTypeFilter}
                            onEventTypeFilterChange={handleEventTypeFilterChange}
                            projects={projects}
                        />
                    </Box>
                </Drawer>
            )}

            {/* モバイル用: フローティングアクションボタン */}
            {isMobile && (
                <Fab
                    color="primary"
                    aria-label="add"
                    onClick={() => handleOpenAddModal()}
                    sx={{
                        position: 'fixed',
                        bottom: 24,
                        right: 24,
                        zIndex: 1000,
                    }}
                >
                    <AddIcon />
                </Fab>
            )}

            <Snackbar
                open={googleSnackbar.open}
                autoHideDuration={6000}
                onClose={() => setGoogleSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert severity={googleSnackbar.severity} onClose={() => setGoogleSnackbar((s) => ({ ...s, open: false }))}>
                    {googleSnackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default CalendarPage; 