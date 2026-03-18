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
import PhaseEditModal from '../components/PhaseEditModal'; // Added import
import { useAuth } from '../contexts/AuthContext';
import { useCalendarPageState, usePageState } from '../contexts/PageStateContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { format as formatDateFnsOriginal, parseISO, isSameDay, isValid as isValidDateFns, addDays, startOfDay, setHours, setMinutes } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Box, CircularProgress, Typography, useMediaQuery, useTheme, Theme, SelectChangeEvent, Button, Snackbar, Alert, Fab, Drawer, IconButton, FormControl, InputLabel, Select, MenuItem, Checkbox, FormControlLabel, FormGroup, Tooltip, Chip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import FilterListIcon from '@mui/icons-material/FilterList';
import CloseIcon from '@mui/icons-material/Close';
import { debounce } from 'lodash';

const normalizeEventType = (type: string | undefined | null): string => {
    if (!type) return 'Generic';
    const t = type.trim();
    const lower = t.toLowerCase();
    if (lower === 'event' || lower === 'generic') return 'Generic';
    if (lower === 'milestone') return 'Milestone';
    if (lower === 'deadline') return 'Deadline';
    if (lower === 'meeting') return 'Meeting';
    if (lower === 'workshop') return 'Workshop';
    if (lower === 'task') return 'Task';
    if (lower === 'project') return 'Project';
    return t;
};

// ★★★ バックアップ版から getEventColor, getProjectColor, getTaskColor を移植 ★★★
const getEventColor = (
    type?: string,
    _projectStatus?: string,
    _eventDate?: string | Date | null
): string => {
    // 完了ステータス以外でグレーにする処理を削除（ユーザー要望：ステータスの色を反映させたい）

    const t = type?.toLowerCase();
    switch (t) {
        case 'meeting': return '#1976d2';
        case 'review': case 'workshop': return '#00897b';   // ティール（青背景と調和）
        case 'deadline': return '#d32f2f';
        case 'milestone': return '#d32f2f';
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



const getTaskColor = (
    status?: string,
    _projectStatus?: string,
    _dueDate?: string | Date | null
): string => {
    // プロジェクトステータスによる一律グレー化を削除
    // タスクは日付が過ぎただけではグレーにしない

    switch (status?.toLowerCase()) {
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
    const [isPhaseEditModalOpen, setIsPhaseEditModalOpen] = useState(false); // Added state
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
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

    // 選択中のイベントと合計コストを rawEvents から導出
    const selectedEvent = useMemo(() => {
        if (!selectedEventId) return null;
        return rawEvents.find(e => e.id === selectedEventId) || null;
    }, [rawEvents, selectedEventId]);

    const calculateTotalCost = useCallback((eventsToConsider: CalendarEvent[]) => {
        return eventsToConsider
            .filter(event => event.extendedProps.type?.toLowerCase() === 'task' && typeof event.extendedProps.taskCost === 'number')
            .reduce((sum, event) => sum + (event.extendedProps.taskCost || 0), 0);
    }, []);

    const totalCost = useMemo(() => {
        if (!selectedEvent) return undefined;
        if (selectedEvent.extendedProps.type?.toLowerCase() === 'task') {
            return selectedEvent.extendedProps.taskCost ?? 0;
        }
        if (selectedEvent.start) {
            const dateObj = selectedEvent.start instanceof Date ? selectedEvent.start : parseISO(selectedEvent.start as string);
            const dayEvents = rawEvents.filter(e => e.start && isSameDay(e.start instanceof Date ? e.start : parseISO(e.start as string), dateObj));
            return calculateTotalCost(dayEvents);
        }
        return undefined;
    }, [selectedEvent, rawEvents, calculateTotalCost]);

    const [eventStatusFilter, setEventStatusFilter] = useState<string>('all'); // 'all' または プロジェクトID
    const [eventTypeFilter, setEventTypeFilter] = useState<Record<string, boolean>>(DEFAULT_EVENT_TYPE_FILTER);
    const [stateRestored, setStateRestored] = useState(false);
    const [googleSnackbar, setGoogleSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
    const [googleStatus, setGoogleStatus] = useState<{ configured: boolean; connected: boolean; synced_task_ids: number[]; synced_event_ids: number[] }>({
        configured: false,
        connected: false,
        synced_task_ids: [],
        synced_event_ids: []
    });


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
                const isSyncDisabled = user?.role === 'admin';
                const msg = isSyncDisabled
                    ? 'Google カレンダーと連携しました。管理者はタスク一覧から個別に同期対象を選択できます。'
                    : 'Google カレンダーと連携しました。あなたに関連するタスク・プロジェクト・イベントが自動で同期されました！';
                setGoogleSnackbar({ open: true, message: msg, severity: 'success' });
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
    }, [location.search, navigate, user]);

    // Google カレンダー連携状態の取得
    const fetchGoogleStatus = useCallback(async () => {
        try {
            const res = await api.get<{ configured: boolean; connected: boolean; synced_task_ids: number[]; synced_event_ids: number[] }>('/google/status');
            setGoogleStatus({
                configured: res.data.configured,
                connected: res.data.connected,
                synced_task_ids: res.data.synced_task_ids ?? [],
                synced_event_ids: res.data.synced_event_ids ?? [],
            });
        } catch {
            setGoogleStatus({ configured: false, connected: false, synced_task_ids: [], synced_event_ids: [] });
        }
    }, []);
    useEffect(() => {
        fetchGoogleStatus();
    }, [fetchGoogleStatus]);

    const handleGoogleConnect = useCallback(async () => {
        try {
            const res = await api.get<{ url: string }>('/google/authorize');
            if (res.data?.url) {
                window.location.href = res.data.url;
            } else {
                console.error('Google authorize URL not found in response:', res.data);
                setGoogleSnackbar({ open: true, message: 'Google認証URLの取得に失敗しました', severity: 'error' });
            }
        } catch (err: any) {
            console.error('Google connect error:', err);
            const errorMessage = err?.response?.data?.detail || err?.message || 'Google 連携の開始に失敗しました';
            setGoogleSnackbar({ open: true, message: `Google連携エラー: ${errorMessage}`, severity: 'error' });
        }
    }, []);

    const handleGoogleSyncEventToggle = useCallback(async (eventId: number, currentSynced: boolean) => {
        try {
            await api.post(`/google/sync/event/${eventId}`, { sync: !currentSynced });
            await fetchGoogleStatus();
            setGoogleSnackbar({
                open: true,
                message: currentSynced ? 'Google カレンダーから解除しました' : 'Google カレンダーに追加しました',
                severity: 'success',
            });
        } catch (err: any) {
            console.error('Google sync toggle error:', err);
            const errorMessage = err?.response?.data?.detail || err?.message || '同期の更新に失敗しました';
            setGoogleSnackbar({ open: true, message: `Google同期エラー: ${errorMessage}`, severity: 'error' });
        }
    }, [fetchGoogleStatus]);

    const handleGoogleDisconnect = useCallback(async () => {
        try {
            await api.delete('/google/disconnect');
            await fetchGoogleStatus();
            setGoogleSnackbar({ open: true, message: 'Google 連携を解除しました', severity: 'success' });
        } catch (err: any) {
            console.error('Google disconnect error:', err);
            const errorMessage = err?.response?.data?.detail || err?.message || 'Google 連携の解除に失敗しました';
            setGoogleSnackbar({ open: true, message: `Google連携解除エラー: ${errorMessage}`, severity: 'error' });
        }
    }, [fetchGoogleStatus]);

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

            let projectsData = projectsResponse.data;
            let tasksData = tasksResponse.data;
            const backendEventsData = eventsResponse.data; // 通常イベント用
            const usersData = usersResponse.data;
            const groupsData = groupsResponse.data;

            // ★★★ 一般ユーザーの場合のフィルタリング ★★★
            if (user?.role !== 'admin') {
                if (!user) {
                    // ユーザー情報がない場合は空にして処理を中断
                    setProjects([]);
                    setTasks([]);
                    setLoading(false);
                    return;
                }
                console.log(`[CalendarPage] Filtering data for non-admin user: ${user.id}`);

                // 1. 自分の担当タスクのみ
                const myTasks = tasksData.filter(t => String(t.assigned_to) === String(user.id));
                const myProjectIds = new Set(myTasks.map(t => t.project_id).filter(pid => pid !== null));

                // 2. 自分のタスクが含まれるプロジェクトのみ
                const myProjects = projectsData.filter(p => myProjectIds.has(p.id));

                // 3. 自分が参加している、または自分のプロジェクトに関連するイベントのみ
                // (BackendEventsのフィルタリングは後続の map 処理内で行うか、ここで事前に行うか。ここではリスト自体はフィルタせず、表示時に弾くか...
                //  いや、processedBackendEvents生成時にフィルタするのが良い)

                // 上書き
                tasksData = myTasks;
                projectsData = myProjects;
            }

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
                    editable: user?.role === 'admin', // ★管理者のみ編集可能
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
                        editable: user?.role === 'admin', // ★管理者のみ編集可能
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
                            taskPriority: (task.priority as any) ?? undefined,
                            taskType: task.type ?? undefined,

                            status: undefined,
                            displayStatus: project?.display_status as 'online' | 'offline' | 'archived' | undefined,
                            dependsOn: task.dependsOn,
                            phases: task.phases ?? undefined,
                            deliverables: task.deliverables,
                            check_items: task.check_items,
                            taskProgress: task.progress,
                        },
                    });
                }

                if (task.phases && Array.isArray(task.phases)) {
                    // Phase processing... (omit logs for brevity in replacement if logically same)
                    if (task.phases.length > 0) console.log(`[CalendarPage:fetchData] Task ${task.id} (${task.name}) has phases:`, task.phases);
                    task.phases.forEach((phase: any, index: number) => {
                        if (phase.date) {
                            // Phaseの色設定
                            const isDelayed = !phase.is_completed && new Date(phase.date) < new Date(new Date().setHours(0, 0, 0, 0));
                            const phaseColor = phase.is_completed
                                ? '#9E9E9E' // 完了: グレー
                                : isDelayed
                                    ? '#D32F2F' // 遅延: 赤
                                    : '#FFA000'; // 未完了: アンバー（黄色系）

                            events.push({
                                id: `task-${task.id}-phase-${index}`,
                                title: `${task.name}: ${phase.name}`,
                                start: parseISO(phase.date),
                                allDay: true,
                                backgroundColor: phaseColor,
                                borderColor: phaseColor,
                                textColor: '#ffffff', // テキスト色: 白
                                editable: user?.role === 'admin', // ★管理者のみ編集可能
                                extendedProps: {
                                    type: 'task', // フィルターでタスクとして扱われるように 'task' に設定
                                    isPhase: true, // Phaseであることを識別するフラグ
                                    isCompleted: phase.is_completed, // 完了ステータス
                                    isDelayed: isDelayed, // 遅延ステータス
                                    taskId: task.id,
                                    description: `Phase: ${phase.name}`,
                                    projectId: task.project_id ? String(task.project_id) : undefined,
                                    taskDueDate: phase.date, // Phaseの日付を期日として扱う
                                    taskStatus: task.status, // 親タスクのステータスを継承
                                    displayStatus: project?.display_status as 'online' | 'offline' | 'archived' | undefined,
                                    check_items: task.check_items ?? [],
                                    deliverables: task.deliverables ?? "",
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

                    // ★★★ 一般ユーザーのフィルタリング (イベント) ★★★
                    if (user?.role !== 'admin') {
                        if (!user) return null; // ユーザー情報がない場合は非表示

                        // 1. 参加者リストに含まれているか
                        const isParticipant = be.participants && be.participants.some((p: any) => String(p.id) === String(user.id));

                        // 2. 自分のタスクが含まれるプロジェクトのイベントか
                        // projectsData は既にフィルタリング済みなので、そこに含まれる ID かどうかで判定
                        const isMyProjectEvent = be.project_id && projectsData.some(p => p.id === be.project_id);

                        if (!isParticipant && !isMyProjectEvent) {
                            return null; // 非表示
                        }
                    }

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
                        // バックエンドの type を正規化
                        const normalizedType = normalizeEventType(be.type);
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
                            editable: user?.role === 'admin', // ★管理者のみ編集可能
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
            // ... existing initialization ...
            try {
                console.log('[CalendarPage] Fetching backend events...');
                const eventsResponse = await api.get<BackendEvent[]>('/calendar/events');
                const backendEventsData = eventsResponse.data;

                const processedBackendEvents: CalendarEvent[] = backendEventsData
                    .map((be): CalendarEvent | null => {
                        // ... existing filtering ...
                        // ★★★ 一般ユーザーのフィルタリング (イベント) ★★★
                        if (user && user.role !== 'admin') {
                            const isParticipant = be.participants && be.participants.some((p: any) => String(p.id) === String(user.id));
                            const isMyProjectEvent = be.project_id && projects.some(p => p.id === be.project_id);

                            if (!isParticipant && !isMyProjectEvent) {
                                return null;
                            }
                        }

                        const eventType = be.type;
                        const originalStartTimeStr = be.start_time as string;
                        const originalEndTimeStr = be.end_time as string;

                        if (!originalStartTimeStr) {
                            // ... existing warning ...
                            console.warn("Event without start_time skipped:", be);
                            return null;
                        }

                        if (eventType === 'Task' || eventType === 'Project') {
                            return null;
                        } else {
                            const project = projects.find(p => p.id === be.project_id);
                            const normalizedType = normalizeEventType(be.type);

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
                                editable: user?.role === 'admin', // ★管理者のみ編集可能
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

    // ★★★ 一般ユーザー向けデータフィルタリング関数 ★★★
    const filterDataForNonAdmin = useCallback((rawTasks: Task[], rawProjects: Project[]) => {
        // 管理者でない限り、必ずフィルタリングを試みる
        if (user?.role === 'admin') {
            return { tasks: rawTasks, projects: rawProjects };
        }

        // ユーザー情報がない場合は安全のために空データを返す（フラッシュ防止）
        if (!user) {
            return { tasks: [], projects: [] };
        }
        // 1. 自分の担当タスクのみ
        const myTasks = rawTasks.filter(t => String(t.assigned_to) === String(user.id));
        const myProjectIds = new Set(myTasks.map(t => t.project_id).filter(pid => pid !== null));
        // 2. 自分のタスクが含まれるプロジェクトのみ
        const myProjects = rawProjects.filter(p => myProjectIds.has(p.id));
        return { tasks: myTasks, projects: myProjects };
    }, [user]);

    // グローバルデータの変更を直接監視（より確実な方法）
    useEffect(() => {
        if (globalData) {
            console.log("[CalendarPage] Global data updated, refreshing local state...");

            const rawTasks = globalData.tasks || [];
            const rawProjects = globalData.projects || [];

            // フィルタリング適用
            const { tasks: filteredTasks, projects: filteredProjects } = filterDataForNonAdmin(rawTasks, rawProjects);

            if (rawTasks.length > 0) {
                console.log("[CalendarPage] Tasks count (filtered):", filteredTasks.length);
                setTasks(filteredTasks);
            }
            if (rawProjects.length > 0) {
                console.log("[CalendarPage] Projects count (filtered):", filteredProjects.length);
                setProjects(filteredProjects);
            }
            if (globalData.users && globalData.users.length > 0) {
                setUsers(globalData.users);
            }
            if (globalData.groups && globalData.groups.length > 0) {
                setGroups(globalData.groups);
            }
        }
    }, [globalData.tasks, globalData.projects, globalData.users, globalData.groups, globalData.lastFetched, filterDataForNonAdmin]);

    // globalDataRefreshedイベントをリッスンしてデータを強制更新
    useEffect(() => {
        const handleGlobalDataRefresh = (event: CustomEvent) => {
            console.log("[CalendarPage] Global data refreshed event received, updating local state...");
            const { tasks: rawTasks, projects: rawProjects, users, groups } = event.detail;

            // フィルタリング適用
            const { tasks: filteredTasks, projects: filteredProjects } = filterDataForNonAdmin(rawTasks || [], rawProjects || []);

            setTasks(filteredTasks);
            setProjects(filteredProjects);
            setUsers(users || []);
            setGroups(groups || []);
        };
        // ... (rest of the listeners remain same, just referencing the updated handleGlobalDataRefresh)

        const handleCsvImportCompleted = async (event: CustomEvent) => {
            console.log("[CalendarPage] CSV import completed event received:", event.detail);
            if (refreshGlobalData) {
                await refreshGlobalData();
            }
        };

        window.addEventListener('globalDataRefreshed', handleGlobalDataRefresh as unknown as EventListener);
        window.addEventListener('csvImportCompleted', handleCsvImportCompleted as unknown as EventListener);

        return () => {
            window.removeEventListener('globalDataRefreshed', handleGlobalDataRefresh as unknown as EventListener);
            window.removeEventListener('csvImportCompleted', handleCsvImportCompleted as unknown as EventListener);
        };
    }, [refreshGlobalData, filterDataForNonAdmin]);

    // プロジェクト変更イベントをリッスンしてタスクデータを強制更新
    useEffect(() => {
        const handleProjectChange = async (event: CustomEvent) => {
            console.log("[CalendarPage] Project change event received:", event.type, event.detail);
            if (refreshGlobalData) {
                await refreshGlobalData();
            }
        };

        window.addEventListener('projectDeleted', handleProjectChange as unknown as EventListener);
        window.addEventListener('projectUpdated', handleProjectChange as unknown as EventListener);
        window.addEventListener('projectStatusUpdated', handleProjectChange as unknown as EventListener);

        return () => {
            window.removeEventListener('projectDeleted', handleProjectChange as unknown as EventListener);
            window.removeEventListener('projectUpdated', handleProjectChange as unknown as EventListener);
            window.removeEventListener('projectStatusUpdated', handleProjectChange as unknown as EventListener);
        };
    }, [refreshGlobalData]);

    // タスクとプロジェクトのデータが更新された時にイベントを再生成
    useEffect(() => {
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
                        editable: user?.role === 'admin', // ★管理者のみ編集可能
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
                            taskPriority: (task.priority as any) ?? undefined,
                            taskType: task.type ?? undefined,

                            status: undefined,
                            displayStatus: project?.display_status as 'online' | 'offline' | 'archived' | undefined,
                            dependsOn: task.dependsOn,
                            phases: task.phases ?? undefined,
                            check_items: (task as any).check_items ?? [],
                            deliverables: (task as any).deliverables ?? "",
                        }
                    });
                }

                if (task.phases && Array.isArray(task.phases)) {
                    if (task.phases.length > 0) console.log(`[CalendarPage:useEffect] Task ${task.id} (${task.name}) has phases:`, task.phases);
                    task.phases.forEach((phase: any, index: number) => {
                        if (phase.date) {
                            // Phaseの色設定
                            const isDelayed = !phase.is_completed && new Date(phase.date) < new Date(new Date().setHours(0, 0, 0, 0));
                            const phaseColor = phase.is_completed
                                ? '#9E9E9E' // 完了: グレー
                                : isDelayed
                                    ? '#D32F2F' // 遅延: 赤
                                    : '#FFA000'; // 未完了: アンバー（黄色系）

                            events.push({
                                id: `task-${task.id}-phase-${index}`,
                                title: `${task.name}: ${phase.name}`,
                                start: parseISO(phase.date),
                                allDay: true,
                                backgroundColor: phaseColor,
                                borderColor: phaseColor,
                                textColor: '#ffffff', // テキスト色: 白
                                editable: user?.role === 'admin', // ★管理者のみ編集可能
                                extendedProps: {
                                    type: 'task', // フィルター用
                                    isPhase: true, // 識別用
                                    isCompleted: phase.is_completed, // 完了ステータス
                                    isDelayed: isDelayed, // 遅延ステータス
                                    taskId: task.id,
                                    description: `Phase: ${phase.name}`,
                                    projectId: task.project_id ? String(task.project_id) : undefined,
                                    taskDueDate: phase.date,
                                    taskStatus: task.status,
                                    displayStatus: project?.display_status as 'online' | 'offline' | 'archived' | undefined,
                                    check_items: (task as any).check_items ?? [],
                                    deliverables: (task as any).deliverables ?? "",
                                    phases: task.phases ?? [],
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
                    editable: user?.role === 'admin', // ★管理者のみ編集可能
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
                    editable: user?.role === 'admin', // ★管理者のみ編集可能
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
                    editable: user?.role === 'admin', // ★管理者のみ編集可能
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

            let tasksData = [...globalData.tasks];
            let projectsData = [...globalData.projects];

            // ★★★ 一般ユーザーの場合のフィルタリング ★★★
            if (user?.role !== 'admin') {
                if (!user) {
                    // ユーザー情報がない場合は安全のために何もしない（次のレンダリングでuserが来るのを待つ）
                    return;
                }
                console.log(`[CalendarPage] Filtering global data for non-admin user: ${user.id}`);
                const myTasks = tasksData.filter(t => String(t.assigned_to) === String(user.id));
                const myProjectIds = new Set(myTasks.map(t => t.project_id).filter(pid => pid !== null));
                const myProjects = projectsData.filter(p => myProjectIds.has(p.id));
                tasksData = myTasks;
                projectsData = myProjects;
            }

            setTasks(tasksData);
            setProjects(projectsData);
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

                            // ★★★ 一般ユーザーのフィルタリング (イベント) ★★★
                            if (user?.role !== 'admin') {
                                if (!user) return null; // ユーザー情報がない場合は非表示

                                // 1. 参加者リストに含まれているか
                                const isParticipant = be.participants && be.participants.some((p: any) => String(p.id) === String(user.id));
                                // 2. 自分のプロジェクトに関連するイベントか
                                const isMyProjectEvent = be.project_id && projectsData.some(p => p.id === be.project_id);
                                if (!isParticipant && !isMyProjectEvent) return null;
                            }

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
                                const normalizedType = normalizeEventType(be.type);
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
                setSelectedEventId(calendarState.selectedEvent?.id || null);
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
                selectedEvent: selectedEvent,
                filterStatus: eventStatusFilter,
                eventTypeFilter,
            });
        }
    }, [selectedDate, selectedEvent, eventStatusFilter, eventTypeFilter, stateRestored, updateCalendarState]);

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

    // ★★★ handleDateClick をダブルクリック対応に修正（モバイルではシングルタップで日付選択） ★★★
    const handleDateClick = (arg: DateClickArg) => {
        // モバイルではシングルタップで日付を選択してイベント詳細ボトムシートを開く
        if (isMobile) {
            console.log("[CalendarPage] Mobile: Single tap on date to show events:", arg.date);
            const newSelectedDate = arg.date;
            setSelectedDate(newSelectedDate);
            // モバイルでは、その日のイベント一覧を表示するために、
            // 空のイベント詳細（またはその日の最初のイベント）ではなく、
            // 単に「その日」が選択された状態としてボトムシートを開く
            setSelectedEventId(null);

            // その日のイベントがあるか確認し、あれば合計コストを計算（オプション）
            // const dayEvents = rawEvents.filter(event => event.start && isSameDay(parseISO(event.start as string), newSelectedDate));
            // const totalCost = calculateTotalCost(dayEvents);
            // setSelectedEventDetails({ event: null, totalCost }); 

            setMobileEventDetailsOpen(true);
            return;
        }

        // PCではダブルクリックで作成
        const now = new Date().getTime();
        const clickTime = now;

        if (user?.role === 'admin' && clickTime - lastClickTimeRef.current < DOUBLE_CLICK_THRESHOLD) {
            console.log("[CalendarPage] Double clicked on date:", arg.date);
            handleOpenAddModal({ start: arg.date, allDay: arg.allDay } as DateSelectArg);
        } else {
            console.log("[CalendarPage] Single clicked on date:", arg.date);
            const newSelectedDate = arg.date;
            setSelectedDate(newSelectedDate);
            setSelectedEventId(null);
            console.log("[CalendarPage] After click - selectedDate:", newSelectedDate, "selectedEventId:", null);
        }
        lastClickTimeRef.current = clickTime;
    };

    const handleEventClick = (clickInfo: EventClickArg) => {
        const clickedEvent = rawEvents.find(event => event.id === clickInfo.event.id);
        if (!clickedEvent) {
            setSelectedEventId(null);
            return;
        }

        // モバイルではシングルタップでイベント詳細ボトムシートを開く
        if (isMobile) {
            console.log("[CalendarPage] Mobile: Single tap on event to show details:", clickedEvent);
            if (clickedEvent.start) {
                setSelectedDate(clickedEvent.start instanceof Date ? clickedEvent.start : parseISO(clickedEvent.start as string));
            }
            setSelectedEventId(clickedEvent.id);
            setMobileEventDetailsOpen(true);
            return;
        }

        // PCではダブルクリックで編集、シングルクリックで詳細パネル表示
        const now = Date.now();
        const isDoubleClick = (now - lastClickTimeRef.current < DOUBLE_CLICK_THRESHOLD) && lastClickedEventIdRef.current === clickInfo.event.id;
        lastClickTimeRef.current = now;
        lastClickedEventIdRef.current = clickInfo.event.id;

        // ダブルクリックと判定した場合は編集モーダルを開く（管理者のみ）
        if (isDoubleClick && user?.role === 'admin') {
            handleOpenEditModal(clickedEvent);
            return;
        }
        // シングルクリック: 詳細パネルに表示
        if (clickedEvent.start) {
            setSelectedDate(clickedEvent.start instanceof Date ? clickedEvent.start : parseISO(clickedEvent.start as string));
        }
        setSelectedEventId(clickedEvent.id);
        setIsPanelMinimized(false);
    };

    const handlePanelEventSelect = (event: CalendarEvent) => {
        console.log("[CalendarPage] handlePanelEventSelect called with event:", JSON.parse(JSON.stringify(event))); // ★★★ ログ追加 ★★★
        if (event.start) {
            setSelectedDate(event.start instanceof Date ? event.start : parseISO(event.start as string));
        }
        setSelectedEventId(event.id);
        setIsPanelMinimized(false); // ★パネルを開く
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
        setSelectedEventId(event.id);
        setModalEventToEdit(event); // 編集時のみモーダルに渡す
        if (event.extendedProps?.isPhase) {
            setIsPhaseEditModalOpen(true);
        } else {
            setIsAddModalOpen(true);
        }
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
                        phases: md.phases != null ? md.phases : undefined,
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
                        phases: md.phases != null ? md.phases : undefined,
                    };
                    console.log("[CalendarPage] Creating NEW TASK via POST /tasks with data:", JSON.stringify(taskData, null, 2));
                    response = await api.post('/tasks', taskData);
                } else if (normalizedType === 'Phase') {
                    const md: any = modalData;
                    const targetTaskId = md.phaseTargetTaskId;
                    if (!targetTaskId) {
                        throw new Error("Target task for phase not selected");
                    }
                    // find target task from current state to get existing phases
                    const targetTask = tasks.find(t => String(t.id) === String(targetTaskId));
                    if (!targetTask) {
                        // If not found in state, we might need to fetch it or fail. 
                        // For now, fail or try to proceed if we assume backend handles merge (backend usually replaces phases list).
                        // Backend REPLACE phases typically. So we NEED the existing phases.
                        throw new Error("Target task not found locally. Please refresh.");
                    }

                    const newPhase = {
                        name: md.title,
                        date: md.date,
                        is_completed: false
                    };
                    // Append new phase to existing phases
                    const updatedPhases = [...(targetTask.phases || []), newPhase];

                    const taskData = {
                        phases: updatedPhases
                    };
                    console.log(`[CalendarPage] Adding Phase to Task ${targetTaskId}:`, JSON.stringify(newPhase));
                    // Update the task with the new list of phases
                    response = await api.put(`/tasks/${targetTaskId}`, taskData);

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

                        // ★★★ 一般ユーザーのフィルタリング (イベント) ★★★
                        if (user?.role !== 'admin') {
                            if (!user) return null; // ユーザー情報がない場合は非表示

                            const isParticipant = be.participants && be.participants.some((p: any) => String(p.id) === String(user.id));
                            const isMyProjectEvent = be.project_id && projects.some(p => p.id === be.project_id);
                            if (!isParticipant && !isMyProjectEvent) return null;
                        }

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
                            const rawType = be.type?.trim() || 'Generic';
                            const normalizedType = (rawType.toLowerCase() === 'event' || rawType.toLowerCase() === 'generic')
                                ? 'Generic'
                                : rawType;

                            const eventDate = (normalizedType.toLowerCase() === 'meeting' || normalizedType.toLowerCase() === 'workshop')
                                ? parseISO(originalStartTimeStr)
                                : (originalEndTimeStr ? ((be.allDay ?? false) ? addDays(parseISO(originalEndTimeStr), -1) : parseISO(originalEndTimeStr)) : parseISO(originalStartTimeStr));
                            const eventColor = getEventColor(
                                normalizedType,
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
            setSelectedEventId(null);
            setLoading(false);
        }
    };

    const handleDeleteEvent = async (event: CalendarEvent) => {
        console.log(`--- handleDeleteEvent STARTED for id: ${event.id} ---`); // ログ追加
        console.log(`Event type: ${event.extendedProps.type}`); // イベントタイプをログ出力
        console.log(`Event extendedProps:`, event.extendedProps); // 拡張プロパティをログ出力

        if (event.extendedProps?.isPhase) {
            // Phase deletion logic
            if (!event.extendedProps?.taskId) return;

            try {
                const taskId = event.extendedProps.taskId;
                const phaseIndex = Number(event.id.split('-').pop());
                const task = tasks.find(t => t.id === Number(taskId));

                if (!task) return;

                const currentPhases = task.phases || [];
                if (phaseIndex >= 0 && phaseIndex < currentPhases.length) {
                    const updatedPhases = currentPhases.filter((_, index) => index !== phaseIndex);

                    await api.put(`/tasks/${taskId}`, {
                        ...task,
                        phases: updatedPhases
                    });

                    setSelectedEventId(null); // Close details panel
                    fetchData();
                    console.log("Phase deleted successfully.");
                }
            } catch (error) {
                console.error("Failed to delete phase:", error);
                alert("Phaseの削除に失敗しました。");
            }
            return; // Exit after handling phase
        }

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

            setSelectedEventId(null); // 詳細パネルをクリア

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

    const handleSavePhase = async (phaseUpdateData: any) => {
        try {
            // Fetch the parent task first to get current phases
            const taskId = phaseUpdateData.taskId;
            const task = tasks.find(t => t.id === Number(taskId));

            if (!task) {
                console.error("Parent task not found for phase update");
                return;
            }

            const currentPhases = task.phases || [];
            if (phaseUpdateData.phaseIndex >= 0 && phaseUpdateData.phaseIndex < currentPhases.length) {
                // Update the specific phase
                const updatedPhases = [...currentPhases];
                updatedPhases[phaseUpdateData.phaseIndex] = {
                    ...updatedPhases[phaseUpdateData.phaseIndex],
                    name: phaseUpdateData.newName,
                    date: phaseUpdateData.newDate,
                    is_completed: phaseUpdateData.isCompleted
                };

                // Update the task with new phases
                await api.put(`/tasks/${taskId}`, {
                    phases: updatedPhases
                });

                setIsPhaseEditModalOpen(false);
                fetchData(); // Refresh calendar
            }
        } catch (error) {
            console.error("Failed to save phase:", error);
            alert("Phaseの保存に失敗しました。");
        }
    };

    const handleUpdateTask = async (taskId: number, updates: any) => {
        try {
            await api.put(`/tasks/${taskId}`, updates);
            if (refreshGlobalData) await refreshGlobalData();
            // selectedEventId は保持されるため、rawEvents が更新されれば selectedEvent も自動で更新される
        } catch (error) {
            console.error("Failed to update task:", error);
            alert("タスクの更新に失敗しました。");
        }
    };

    const handleDeletePhase = async () => {
        if (!modalEventToEdit || !modalEventToEdit.extendedProps?.taskId) return;

        try {
            const taskId = modalEventToEdit.extendedProps.taskId;
            const phaseIndex = Number(modalEventToEdit.id.split('-').pop());
            const task = tasks.find(t => t.id === Number(taskId));

            if (!task) return;

            const currentPhases = task.phases || [];
            if (phaseIndex >= 0 && phaseIndex < currentPhases.length) {
                const updatedPhases = currentPhases.filter((_, index) => index !== phaseIndex);

                await api.put(`/tasks/${taskId}`, {
                    phases: updatedPhases
                });

                setIsPhaseEditModalOpen(false);
                setModalEventToEdit(null);
                setSelectedEventId(null); // Close details panel if open
                fetchData();
            }

        } catch (error) {
            console.error("Failed to delete phase:", error);
            alert("Phaseの削除に失敗しました。");
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

    // ドラッグ時はそのまま範囲をhandleSelectに渡すが、単一クリック（1日分）の場合はモーダルを開かない
    const handleSelect = (selectInfo: DateSelectArg) => {
        const start = selectInfo.start;
        const end = selectInfo.end;

        setSelectedDate(start instanceof Date ? start : parseISO(start as string));
        setSelectedEventId(null);
        setDateClickArg(null); // 選択時はdateClickArgをnullに

        // ユーザーが管理者であり、かつドラッグ（1日より長い範囲）の場合はモーダルを開く
        // 単一クリックの場合は handleDateClick のダブルクリック判定に任せる
        if (user?.role === 'admin') {
            const startMs = start.getTime();
            const endMs = end.getTime();
            const isRange = selectInfo.allDay
                ? (endMs - startMs > 24 * 60 * 60 * 1000) // 1日より長い
                : (endMs - startMs > 0); // timeGridの場合は選択があればドラッグとみなす（スロット単位）

            if (isRange) {
                handleOpenAddModal(selectInfo);
            }
        }
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

            if (ev.extendedProps?.isPhase) {
                // Phase drag and drop
                // ID format: task-{taskId}-phase-{index}
                // Try regex matching for robustness
                const match = idStr.match(/^task-(\d+)-phase-(\d+)$/);

                let tId = -1;
                let pIndex = -1;

                if (match) {
                    tId = parseInt(match[1], 10);
                    pIndex = parseInt(match[2], 10);
                } else {
                    // Fallback or explicit failure
                    console.warn('[CalendarPage] Phase drop reverted: ID format mismatch', idStr);
                    arg.revert();
                    return;
                }

                if (tId === -1 || pIndex === -1) {
                    console.warn('[CalendarPage] Phase drop reverted: Failed to parse ID', idStr);
                    arg.revert();
                    return;
                }

                const newDate = formatForApi(start, true); // Phase is date only
                if (!newDate) {
                    console.warn('[CalendarPage] Phase drop reverted: Invalid new date');
                    arg.revert();
                    return;
                }

                // Fetch current task to get latest phases state
                const task = tasks.find(t => t.id === tId);
                if (!task) {
                    console.warn('[CalendarPage] Phase drop reverted: Parent task not found', tId);
                    arg.revert();
                    return;
                }
                if (!task.phases) {
                    console.warn('[CalendarPage] Phase drop reverted: Task has no phases', tId);
                    arg.revert();
                    return;
                }

                const updatedPhases = [...task.phases];
                if (pIndex >= 0 && pIndex < updatedPhases.length) {
                    updatedPhases[pIndex] = {
                        ...updatedPhases[pIndex],
                        date: newDate
                    };

                    await api.put(`/tasks/${tId}`, { phases: updatedPhases });
                } else {
                    console.warn('[CalendarPage] Phase drop reverted: Invalid phase index', pIndex);
                    arg.revert();
                    return;
                }

            } else if (type === 'task') {
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
    }, [refreshGlobalData, tasks]); // Added tasks to dependency array

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
        if (t === 'generic' || t === 'event') return '通常';
        if (t === 'milestone') return 'マイルストーン';
        if (t === 'deadline') return '締切';
        if (t === 'meeting') return '会議';
        if (t === 'workshop') return 'ワークショップ';
        return type;
    };

    // ★★★ FullCalendar の eventContent を追加して表示をカスタマイズ ★★★
    const renderEventContent = (eventInfo: any) => {
        const { type } = eventInfo.event.extendedProps;
        const title = eventInfo.event.title || '';
        const typeLabel = getEventTypeLabel(type);
        const viewType = eventInfo.view.type;
        const isTimeGrid = viewType.includes('timeGrid');
        const isListView = viewType.includes('list');

        // 複数日にまたがるイベント判定（開始日と終了日が異なる場合）
        const isMultiDay = eventInfo.event.allDay &&
            eventInfo.event.start &&
            eventInfo.event.end &&
            Math.floor((eventInfo.event.end.getTime() - eventInfo.event.start.getTime()) / (1000 * 60 * 60 * 24)) > 1;

        // リストビュー（listWeek, listMonth）用のレンダリング
        if (isListView) {
            // プロジェクト（背景イベント）はリストでは極力シンプルに
            if (type === 'project') {
                return (
                    <div className="calendar-list-project-content" style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.7 }}>
                        <span className="calendar-event-type-badge calendar-event-type-project" style={{ fontSize: '0.6rem', padding: '1px 3px' }}>
                            P
                        </span>
                        <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{title}</span>
                    </div>
                );
            }

            return (
                <div className="calendar-list-event-content" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '1px 0' }}>
                    <span className={`calendar-event-type-badge calendar-event-type-${(type || 'generic').toLowerCase()}`} style={{
                        fontSize: '0.65rem',
                        padding: '1px 5px',
                        minWidth: '50px',
                        textAlign: 'center'
                    }}>
                        {typeLabel}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{title}</span>
                </div>
            );
        }

        // TimeGrid（Week/Day）ビュー用の詳細レンダリング
        if (isTimeGrid && !eventInfo.event.allDay) {
            // Note: timeText, description, and location are available in eventInfo.event.extendedProps if needed for more detailed view
            const timeText = eventInfo.timeText;

            return (
                <div className="calendar-timegrid-event-content" style={{
                    padding: '2px 4px',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: '2px',
                    overflow: 'hidden'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                        <span className={`calendar-event-type-badge calendar-event-type-${(type || 'generic').toLowerCase()}`} style={{
                            fontSize: '0.6rem',
                            padding: '1px 3px',
                            flexShrink: 0
                        }}>
                            {typeLabel}
                        </span>
                        <span style={{
                            fontWeight: 700,
                            fontSize: '0.8rem',
                            lineHeight: '1.2',
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                        }} title={title}>
                            {title}
                        </span>
                        <span style={{ fontSize: '0.6rem', fontWeight: 600, opacity: 0.8, flexShrink: 0 }}>
                            {timeText}
                        </span>
                    </div>
                </div>
            );
        }

        // プロジェクトまたは複数日にまたがる通常イベント（マイルストーン・締切は除く）
        const normalizedType = type?.toLowerCase();
        if (type === 'project' || (isMultiDay && normalizedType !== 'milestone' && normalizedType !== 'deadline')) {
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
        if (type?.toLowerCase() === 'milestone') {
            return (
                <div className="calendar-event-inner milestone-event-content" style={{ width: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
                    <span className="calendar-event-type-badge" style={{ marginRight: '4px', fontSize: '0.65rem', padding: '1px 4px', backgroundColor: '#FFD700', color: '#000' }}>マイルストーン</span>
                    <span className="calendar-event-title" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontWeight: 700 }} title={title}>{title}</span>
                </div>
            );
        }

        // Phase（Task の一部だがマイルストーン的に表示）
        if (eventInfo.event.extendedProps.isPhase) {
            const phaseTitle = title;
            const isCompleted = eventInfo.event.extendedProps.isCompleted;
            const isDelayed = eventInfo.event.extendedProps.isDelayed !== undefined
                ? eventInfo.event.extendedProps.isDelayed
                : (!isCompleted && eventInfo.event.start && new Date(eventInfo.event.start) < new Date(new Date().setHours(0, 0, 0, 0)));

            const bgColor = isCompleted
                ? '#9E9E9E' // 完了: グレー
                : isDelayed
                    ? '#D32F2F' // 遅延: 赤
                    : '#FFA000'; // 未完了: アンバー

            return (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    width: '100%',
                    height: '100%',
                    overflow: 'hidden',
                    backgroundColor: bgColor,
                    color: '#ffffff',
                    borderRadius: '4px',
                    padding: '0 4px',
                    boxSizing: 'border-box',
                    border: `1px solid ${bgColor}`, // 枠線を背景色と同じにして二重枠を防ぐ
                    boxShadow: 'none',
                    margin: 0
                }}>
                    <span style={{
                        backgroundColor: '#8E24AA', // 鮮やかな紫 (Purple 600)
                        color: 'white',
                        fontSize: '0.6rem',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        marginRight: '6px',
                        fontWeight: 'bold',
                        flexShrink: 0,
                        boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                    }}>段階目標</span>
                    <span style={{
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        fontWeight: 600,
                        fontSize: '0.85em',
                        textDecoration: isCompleted ? 'line-through' : 'none',
                        opacity: isCompleted ? 0.8 : 1
                    }}>{phaseTitle}</span>
                </div>
            );
        }

        // 締切（Deadline）
        if (type?.toLowerCase() === 'deadline') {
            return (
                <div className="calendar-event-inner deadline-event-content" style={{ width: '100%', overflow: 'hidden' }}>
                    <span className="calendar-event-type-badge calendar-event-type-deadline" title={typeLabel}>締切</span>
                    <span className="calendar-event-title" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={title}>{title}</span>
                </div>
            );
        }

        // 会議（Meeting）・ワークショップ（Workshop）- 時間を表示
        if (type?.toLowerCase() === 'meeting' || type?.toLowerCase() === 'workshop') {
            const timeText = eventInfo.timeText || '';
            const displayTitle = timeText ? `${timeText} ${title}` : title;
            const badge = type?.toLowerCase() === 'meeting' ? '会議' : 'WS';
            return (
                <div className="calendar-event-inner" style={{ width: '100%', overflow: 'hidden' }}>
                    <span className={`calendar-event-type-badge calendar-event-type-${type?.toLowerCase() === 'meeting' ? 'meeting' : 'workshop'}`} title={typeLabel}>{badge}</span>
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
                <div className="calendar-event-inner calendar-event-generic" style={{ width: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
                    <span className="calendar-event-type-badge calendar-event-type-generic" style={{ marginRight: '4px', fontSize: '0.65rem' }}>予定</span>
                    {isTimedEvent && <span className="calendar-event-time" style={{ fontWeight: 600, marginRight: '4px', color: 'rgba(0,0,0,0.6)' }}>{timeText}</span>}
                    <span className="calendar-event-title" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontWeight: 500 }} title={displayTitle}>
                        {title}
                    </span>
                </div>
            );
        }

        // タスク
        if (type === 'task') {
            const status = eventInfo.event.extendedProps.status;
            const isDelayed = status === 'delayed';

            return (
                <div className="calendar-event-inner" style={{ width: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
                    <span className="calendar-event-type-badge calendar-event-type-task" style={{ marginRight: '4px', fontSize: '0.65rem', padding: '1px 4px' }}>タスク</span>
                    {isDelayed && (
                        <span style={{
                            backgroundColor: '#D32F2F',
                            color: 'white',
                            fontSize: '0.6rem',
                            padding: '1px 4px',
                            borderRadius: '3px',
                            marginRight: '4px',
                            fontWeight: 'bold',
                            flexShrink: 0
                        }}>遅延</span>
                    )}
                    <span className="calendar-event-title" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontWeight: 600 }} title={title}>{title}</span>
                </div>
            );
        }

        // その他（ラベル＋タイトル）
        return (
            <div className="calendar-event-inner" style={{ width: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
                <span className="calendar-event-type-badge" style={{ marginRight: '4px', fontSize: '0.65rem' }}>{typeLabel.slice(0, 2)}</span>
                <span className="calendar-event-title" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={title}>{title}</span>
            </div>
        );
    };

    // モーダルのレンダリング
    const renderEventModal = () => {
        // PhaseEditModal render logic
        if (isPhaseEditModalOpen) {
            return (
                <PhaseEditModal
                    open={isPhaseEditModalOpen}
                    onClose={() => {
                        setIsPhaseEditModalOpen(false);
                        setModalEventToEdit(null);
                    }}
                    onSave={handleSavePhase}
                    onDelete={handleDeletePhase}
                    eventToEdit={modalEventToEdit}
                />
            );
        }

        if (!isAddModalOpen) return null;

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
                        {user?.role === 'admin' && (
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
                        )}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ml: 1, pl: 1, borderLeft: '1px solid', borderColor: 'divider' }}>
                            {!googleStatus.configured ? (
                                <Tooltip title="Google連携はバックエンドで設定されていません">
                                    <Chip size="small" label="Google連携未設定" variant="outlined" sx={{ color: 'text.secondary', cursor: 'default' }} />
                                </Tooltip>
                            ) : !googleStatus.connected ? (
                                <Tooltip title="Google連携するとタスク・イベントなどが自動でカレンダーに同期されます">
                                    <Button
                                        size="small"
                                        variant="contained"
                                        color="primary"
                                        onClick={handleGoogleConnect}
                                        sx={{ textTransform: 'none', fontWeight: 600 }}
                                    >
                                        Google カレンダー連携
                                    </Button>
                                </Tooltip>
                            ) : (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Tooltip title="Google連携済み（タスク・イベントなどは自動同期されます）">
                                        <Chip size="small" label="Google 連携済み" color="success" sx={{ fontWeight: 600, cursor: 'default' }} />
                                    </Tooltip>
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        color="error"
                                        onClick={handleGoogleDisconnect}
                                        sx={{ textTransform: 'none', minWidth: 'auto', px: 1 }}
                                    >
                                        解除
                                    </Button>
                                </Box>
                            )}
                        </Box>
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
                    {user?.role === 'admin' && (
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
                    )}

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
                .fc .fc-col-header-cell.fc-day-mon .fc-col-header-cell-cushion,
                .fc .fc-daygrid-day.fc-day-mon .fc-daygrid-day-number,
                .fc .fc-col-header-cell.fc-day-tue,
                .fc .fc-col-header-cell.fc-day-tue a,
                .fc .fc-col-header-cell.fc-day-tue .fc-scrollgrid-sync-inner,
                .fc .fc-col-header-cell.fc-day-tue .fc-col-header-cell-cushion,
                .fc .fc-daygrid-day.fc-day-tue .fc-daygrid-day-number,
                .fc .fc-col-header-cell.fc-day-wed,
                .fc .fc-col-header-cell.fc-day-wed a,
                .fc .fc-col-header-cell.fc-day-wed .fc-scrollgrid-sync-inner,
                .fc .fc-col-header-cell.fc-day-wed .fc-col-header-cell-cushion,
                .fc .fc-daygrid-day.fc-day-wed .fc-daygrid-day-number,
                .fc .fc-col-header-cell.fc-day-thu,
                .fc .fc-col-header-cell.fc-day-thu a,
                .fc .fc-col-header-cell.fc-day-thu .fc-scrollgrid-sync-inner,
                .fc .fc-col-header-cell.fc-day-thu .fc-col-header-cell-cushion,
                .fc .fc-daygrid-day.fc-day-thu .fc-daygrid-day-number,
                .fc .fc-col-header-cell.fc-day-fri,
                .fc .fc-col-header-cell.fc-day-fri a,
                .fc .fc-col-header-cell.fc-day-fri .fc-scrollgrid-sync-inner,
                .fc .fc-col-header-cell.fc-day-fri .fc-col-header-cell-cushion,
                .fc .fc-daygrid-day.fc-day-fri .fc-daygrid-day-number {
                    color: ${isDark ? '#e8eaed' : '#000000'} !important;
                    background-color: ${isDark ? '#202124' : '#ffffff'};
                }
                /* 土曜日: 青系（ダークモードではやや明るめの青） */
                .fc .fc-col-header-cell.fc-day-sat,
                .fc .fc-col-header-cell.fc-day-sat a,
                .fc .fc-col-header-cell.fc-day-sat .fc-scrollgrid-sync-inner,
                .fc .fc-col-header-cell.fc-day-sat .fc-col-header-cell-cushion,
                .fc .fc-daygrid-day.fc-day-sat .fc-daygrid-day-number {
                    color: ${isDark ? '#8ab4f8' : '#1a73e8'} !important;
                    background-color: ${isDark ? '#202124' : '#ffffff'};
                }
                /* 日曜日: 赤系（ダークモードではやや明るめの赤） */
                .fc .fc-col-header-cell.fc-day-sun,
                .fc .fc-col-header-cell.fc-day-sun a,
                .fc .fc-col-header-cell.fc-day-sun .fc-scrollgrid-sync-inner,
                .fc .fc-col-header-cell.fc-day-sun .fc-col-header-cell-cushion,
                .fc .fc-daygrid-day.fc-day-sun .fc-daygrid-day-number {
                    color: ${isDark ? '#f28b82' : '#d93025'} !important;
                    background-color: ${isDark ? '#202124' : '#ffffff'};
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
                /* モバイル用リストビュー改善（削除済み: 他のスタイルと競合するため） */
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
                    /* モバイル時はイベントのタップ判定を無効化（下のセルへのクリックを透過させる） */
                    ${isMobile ? 'pointer-events: none !important;' : ''}
                }
                /* モバイル時は個別のイベントもタップ判定を無効化 */
                ${isMobile ? `
                    .fc-event {
                        pointer-events: none !important;
                    }
                ` : ''}
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
                /* マイルストーンの赤バッジ＋赤文字（締切と統一） */
                .milestone-event-content {
                    background: none !important;
                    color: #d32f2f;
                    border: none;
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
                .fc-event.grey-event.deadline-event-wrapper .deadline-event-content {
                    color: ${isDark ? '#e0e0e0' : '#616161'} !important;
                }
                .fc-event.grey-event.milestone-event-wrapper .milestone-event-content {
                    background-color: #9E9E9E !important;
                    color: ${isDark ? '#fff' : '#000'} !important;
                }
                .fc-event.grey-event.milestone-event-wrapper .milestone-event-content * {
                    color: ${isDark ? '#fff' : '#000'} !important;
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
                /* 完了していないプロジェクトの会議・ワークショップ - 青文字（バッジ文字は白を維持） */
                .fc-event.meeting-event:not(.completed-project-event) .calendar-event-title,
                .fc-daygrid-event.meeting-event:not(.completed-project-event) .calendar-event-title,
                .fc-event.workshop-event:not(.completed-project-event) .calendar-event-title,
                .fc-daygrid-event.workshop-event:not(.completed-project-event) .calendar-event-title,
                .fc-event.meeting-event:not(.completed-project-event) .calendar-event-time,
                .fc-daygrid-event.meeting-event:not(.completed-project-event) .calendar-event-time,
                .fc-event.workshop-event:not(.completed-project-event) .calendar-event-time,
                .fc-daygrid-event.workshop-event:not(.completed-project-event) .calendar-event-time {
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
                    background-color: #d32f2f !important; /* Unified Red MS badge */
                    color: #fff !important;
                }
                .fc-event.grey-event.milestone-event-wrapper .milestone-event-content .calendar-event-type-badge {
                    background-color: #757575 !important;
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
                .fc-event.grey-event.generic-event .fc-event-main,
                .fc-event.grey-event.generic-event .fc-event-main * {
                    color: ${isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)'} !important;
                }
                /* ダークモード対策 */
                .fc-col-header-cell-cushion,
                .fc-daygrid-day-number {
                    color: ${theme.palette.text.primary} !important;
                    text-decoration: none !important;
                }
                .fc-theme-standard .fc-scrollgrid {
                    border-color: ${theme.palette.divider} !important;
                }
                .fc-theme-standard td, .fc-theme-standard th {
                    border-color: ${theme.palette.divider} !important;
                }

                /* リストビューのプレミアムスタイル */
                .fc-list {
                    border: none !important;
                }
                .fc-list-day-cushion {
                    padding: 6px 12px !important;
                    background-color: ${isDark ? '#2c2c2e' : '#f8f9fa'} !important;
                    border-bottom: 1px solid ${isDark ? '#3c4043' : '#e8eaed'} !important;
                }
                .fc-list-day-text {
                    font-weight: 700 !important;
                    font-size: 0.9rem !important;
                    color: ${theme.palette.primary.main} !important;
                }
                .fc-list-day-side-text {
                    font-weight: 500 !important;
                    font-size: 0.85rem !important;
                    opacity: 0.7;
                }
                .fc-list-event:hover td {
                    background-color: ${isDark ? '#3a3a3c' : '#f1f3f4'} !important;
                    cursor: pointer;
                }
                .fc-list-event-title {
                    padding: 4px 10px !important;
                }
                .fc-list-event-time {
                    padding-left: 12px !important;
                    font-size: 0.8rem !important;
                    font-weight: 500 !important;
                    color: ${isDark ? '#9aa0a6' : '#5f6368'} !important;
                }
                .fc-list-event-dot {
                    border-width: 4px !important;
                }
                /* リストビューではプロジェクトを非表示にしてスッキリさせる */
                .fc-list .project-event {
                    display: none !important;
                }
                
                /* TimeGrid（週・日）ビューのスタイル */
                .fc-timegrid-event {
                    border-radius: 4px !important;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
                    border: none !important;
                    border-left: 3px solid rgba(0,0,0,0.2) !important;
                    transition: none !important;
                    padding: 0 !important;
                }
                .fc-timegrid-event:hover {
                    z-index: 5 !important;
                    filter: brightness(1.05);
                }
                .fc-timegrid-slot {
                    height: 28px !important; /* スロットを28pxに増やして名前が見えるように調整 */
                }
                .fc-timegrid-slot-label {
                    font-size: 0.75rem !important;
                    font-weight: 500 !important;
                    color: ${isDark ? '#9aa0a6' : '#5f6368'} !important;
                    vertical-align: middle !important;
                    padding-right: 4px !important;
                }
                .fc-timegrid-axis-cushion {
                    padding: 8px 4px !important;
                }
                
                /* 今日の時間インジケーター */
                .fc-timegrid-now-indicator-line {
                    border-color: #ea4335 !important;
                    border-width: 2px !important;
                    z-index: 4 !important;
                }
                .fc-timegrid-now-indicator-arrow {
                    border-top-color: #ea4335 !important;
                    border-bottom-color: #ea4335 !important;
                    margin-top: -6px !important;
                    border-width: 6px !important;
                }

                /* 全日イベントセクション（TimeGrid） */
                .fc-timegrid-allday {
                    background-color: ${isDark ? '#1a1a1a' : '#fcfcfc'} !important;
                    border-bottom: 2px solid ${theme.palette.divider} !important;
                }
                .fc-timegrid-allday-label {
                    font-size: 0.75rem !important;
                    font-weight: 800 !important;
                    color: ${isDark ? '#9aa0a6' : '#5f6368'} !important;
                    text-transform: uppercase;
                }
                .fc-timegrid-col.fc-day-today {
                    background-color: ${isDark ? 'rgba(25, 118, 210, 0.05)' : 'rgba(25, 118, 210, 0.02)'} !important;
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
                        initialView={isMobile ? "dayGridMonth" : "dayGridMonth"}
                        headerToolbar={isMobile ? {
                            left: 'prev,next today',
                            center: 'title',
                            right: 'dayGridMonth,listMonth'
                        } : {
                            left: 'prev,next today',
                            center: 'title',
                            right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
                        }}
                        events={eventsForFullCalendar}
                        locale={'ja'}
                        timeZone={'Asia/Tokyo'}
                        slotMinTime="05:00:00"
                        slotMaxTime="28:00:00"
                        slotDuration="01:00:00"
                        slotLabelInterval="01:00"
                        scrollTime="08:00:00"
                        eventTimeFormat={{
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false
                        }}
                        height={isMobile ? "auto" : "100%"}
                        contentHeight={isMobile ? "auto" : "auto"}
                        fixedWeekCount={true}
                        showNonCurrentDates={true}
                        dayMaxEvents={5}
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


                            // タスクとイベントのステータスを取得
                            const taskStatusStr = arg.event.extendedProps.taskStatus ? String(arg.event.extendedProps.taskStatus).toLowerCase() : undefined;
                            const eventStatusStr = arg.event.extendedProps.status ? String(arg.event.extendedProps.status).toLowerCase() : undefined;

                            // 完了の場合はグレー表示にする
                            if (taskStatusStr === 'completed' || eventStatusStr === 'completed' || eventStatusStr === 'cancelled') {
                                classes.push('grey-event');
                            }

                            // 完了プロジェクトの場合は特別なクラスを追加（後方互換性のため）
                            if (isCompletedProject) {
                                classes.push('completed-project-event');
                            }

                            const normalizedType = type?.toLowerCase() || 'generic';

                            // 既存のクラス設定
                            if (normalizedType === 'project') {
                                classes.push('project-event');
                            } else if (normalizedType === 'task') {
                                // タスクの場合は特別な処理は不要（eventDidMountで色を設定）
                                // 完了の場合はgrey-taskクラスを追加
                                if (taskStatusStr === 'completed') {
                                    classes.push('grey-task');
                                }
                            } else if (normalizedType === 'deadline') {
                                classes.push('deadline-event-wrapper');
                            } else if (normalizedType === 'milestone') {
                                classes.push('milestone-event-wrapper');
                            }
                            if (normalizedType === 'meeting') {
                                classes.push('custom-event');
                                classes.push('meeting-event');
                            } else if (normalizedType === 'workshop') {
                                classes.push('custom-event');
                                classes.push('workshop-event');
                            } else if (normalizedType === 'generic' || normalizedType === 'event') {
                                classes.push('custom-event');
                                classes.push('generic-event');
                            } else {
                                classes.push('custom-event');
                            }

                            // 複数日にまたがる通常イベントにもproject-eventスタイルを適用
                            const isMultiDay = arg.event.allDay && arg.event.start && arg.event.end &&
                                Math.floor((arg.event.end.getTime() - arg.event.start.getTime()) / (1000 * 60 * 60 * 24)) > 1;

                            if (isMultiDay && type !== 'project' && normalizedType !== 'milestone' && normalizedType !== 'deadline') {
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
                        dayCellDidMount={handleDayCellMount}
                        selectable={user?.role === 'admin'}
                        editable={user?.role === 'admin'}
                        eventStartEditable={user?.role === 'admin'}
                        eventDurationEditable={user?.role === 'admin'}
                        selectMirror={user?.role === 'admin'}
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
                            selectedEvent={selectedEvent}
                            totalCost={totalCost}
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
                            googleStatus={googleStatus}
                            onGoogleSyncToggle={handleGoogleSyncEventToggle}
                            onUpdateTask={handleUpdateTask}
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
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                                イベントタイプ
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <Button size="small" variant="text" onClick={() => Object.keys(eventTypeFilter).forEach(k => handleEventTypeFilterChange(k, true))}>全オン</Button>
                                <Button size="small" variant="text" onClick={() => Object.keys(eventTypeFilter).forEach(k => handleEventTypeFilterChange(k, false))}>全オフ</Button>
                            </Box>
                        </Box>
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
                            // モバイルでの誤操作防止のため、ドロワー内はタップ有効
                            pointerEvents: 'auto',
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
                        <Typography variant="subtitle1" sx={{ fontWeight: 700, ml: 1, flexGrow: 1 }}>
                            {selectedEvent ? 'イベント詳細' : selectedDate ? formatDateFnsOriginal(selectedDate, 'yyyy年M月d日', { locale: ja }) : 'イベント'}
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
                            selectedEvent={selectedEvent}
                            totalCost={totalCost}
                            events={filteredEvents}
                            onEventSelect={(event) => {
                                setSelectedEventId(event.id);
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
                            onUpdateTask={handleUpdateTask}
                        />
                    </Box>
                </Drawer>
            )}

            {/* モバイル用: フローティングアクションボタン */}
            {isMobile && user?.role === 'admin' && (
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