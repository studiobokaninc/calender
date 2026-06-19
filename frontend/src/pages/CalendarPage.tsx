import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { DateClickArg } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import { DateSelectArg, DayCellMountArg } from '@fullcalendar/core';
import {
    Box,
    Badge,
    Button,
    CircularProgress,
    IconButton,
    Typography,
    useMediaQuery,
    useTheme,
    Tooltip,
    Chip,
    Drawer,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    FormGroup,
    FormControlLabel,
    Checkbox,
    Fab,
    Snackbar,
    Alert,
    Popover,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import FilterListIcon from '@mui/icons-material/FilterList';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
    parseISO,
    addDays,
    format as formatDateFnsOriginal,
    isValid as isValidDateFns,
} from 'date-fns';
import { ja } from 'date-fns/locale';

import { usePageState, useCalendarPageState } from '../contexts/PageStateContext';
import { useAuth } from '../contexts/AuthContext';
import EventDetailsPanel from '../components/EventDetailsPanel';
import EventAddModal from '../components/EventAddModal';
import PhaseEditModal from '../components/PhaseEditModal';
import AIImportModal from '../components/AIImportModal';
import { CalendarEvent, Project } from '../types';

// hooks
import { useCalendarData } from '../hooks/useCalendarData';
import { useGoogleCalendar } from '../hooks/useGoogleCalendar';
import { useCalendarActions } from '../hooks/useCalendarActions';

// utils
import { getEventColor, getTaskColor } from '../utils/calendarEventColors';
import { getEventRank } from '../utils/calendarEventMapper';

const DOUBLE_CLICK_THRESHOLD = 400;

const DEFAULT_EVENT_TYPE_FILTER: Record<string, boolean> = {
    task: true, meeting: true, deadline: true, milestone: true,
    workshop: true, generic: true, project: false, group: true,
};

const EVENT_TYPE_ORDER = ['task', 'project', 'meeting', 'workshop', 'generic', 'deadline', 'milestone', 'group'];

const CalendarPage: React.FC = () => {
    const theme = useTheme();
    const navigate = useNavigate();
    const isDark = theme.palette.mode === 'dark';
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isSmallScreen = useMediaQuery(theme.breakpoints.down('md'));

    const { refreshGlobalData } = usePageState();
    const { calendarState, updateCalendarState } = useCalendarPageState();
    const { user } = useAuth();

    // ────────────────────────────────────────────────────────────────────────
    // 状態管理
    // ────────────────────────────────────────────────────────────────────────
    const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [eventStatusFilter, setEventStatusFilter] = useState<string>('all');
    
    // イベントタイプフィルタ
    const [eventTypeFilter, setEventTypeFilter] = useState<Record<string, boolean>>({
        task: true,
        meeting: true,
        deadline: true,
        milestone: true,
        workshop: true,
        generic: true,
        project: false,
        group: true,
    });

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isAIImportModalOpen, setIsAIImportModalOpen] = useState(false);
    const [isPhaseEditModalOpen, setIsPhaseEditModalOpen] = useState(false);
    const [modalEventToEdit, setModalEventToEdit] = useState<CalendarEvent | null>(null);
    const [dateClickArg, setDateClickArg] = useState<DateClickArg | null>(null);

    const [selectedUser, setSelectedUser] = useState<string>('all');

    const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
    const [mobileEventDetailsOpen, setMobileEventDetailsOpen] = useState(false);
    const [isPanelMinimized, setIsPanelMinimized] = useState(false);
    
    const [, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<{
        mouseX: number;
        mouseY: number;
        taskId?: number;
        eventId?: number;
    } | null>(null);

    const calendarRef = useRef<FullCalendar>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const lastClickTimeRef = useRef<number>(0);
    const lastClickedEventIdRef = useRef<string | null>(null);
    const stateRestored = useRef(false);
    const clickTimeoutRef = useRef<any>(null);

    // ────────────────────────────────────────────────────────────────────────
    // カスタムフックの適用
    // ────────────────────────────────────────────────────────────────────────
    
    // 1. カレンダーデータ取得・監視フック
    const {
        rawEvents,
        projects,
        tasks,
        users,
        groups,
        loading: dataLoading,
        error: dataError,
        scoreSummary,
        refetch,
    } = useCalendarData(eventStatusFilter);

    // 2. Googleカレンダー連携フック
    const {
        googleStatus,
        googleSnackbar,
        closeSnackbar,
        handleGoogleConnect,
        handleGoogleSyncEventToggle,
        handleGoogleDisconnect,
    } = useGoogleCalendar();

    // 3. カレンダーアクション（保存・削除・ドラッグ＆ドロップ）フック
    const {
        handleSaveEvent,
        handleDeleteEvent,
        handleSavePhase,
        handleUpdateTask,
        handleUpdateEvent,
        handleDeletePhase,
        handleEventDrop,
        handleEventResize,
        handleDuplicateTask,
        handleDuplicateEvent,
    } = useCalendarActions({
        user: user as any,
        tasks,
        projects,
        modalEventToEdit,
        setLoading,
        setError,
        setSelectedEventId,
        setModalEventToEdit,
        setIsAddModalOpen,
        setIsPhaseEditModalOpen,
        refetch,
        refreshGlobalData,
    });

    // ────────────────────────────────────────────────────────────────────────
    // 初期状態復旧 ＆ 状態の保存
    // ────────────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!stateRestored.current && calendarState) {
            if (calendarState.selectedDate) {
                setSelectedDate(new Date(calendarState.selectedDate));
            }
            if (calendarState.selectedEvent) {
                setSelectedEventId(calendarState.selectedEvent.id);
            }
            if (calendarState.filterStatus) {
                setEventStatusFilter(calendarState.filterStatus);
            }
            if (calendarState.eventTypeFilter) {
                setEventTypeFilter(calendarState.eventTypeFilter);
            }
            if (calendarState.filterAssignee) {
                setSelectedUser(calendarState.filterAssignee);
            }
            stateRestored.current = true;
        }
    }, [calendarState]);

    const selectedEvent = useMemo(() => {
        if (!selectedEventId) return null;
        return rawEvents.find((e) => e.id === selectedEventId) || null;
    }, [selectedEventId, rawEvents]);

    useEffect(() => {
        if (stateRestored.current && updateCalendarState) {
            updateCalendarState({
                selectedDate: selectedDate?.toISOString() || null,
                selectedEvent: selectedEvent,
                filterStatus: eventStatusFilter,
                eventTypeFilter,
                filterAssignee: selectedUser,
            });
        }
    }, [selectedDate, selectedEvent, eventStatusFilter, eventTypeFilter, selectedUser, updateCalendarState]);

    // ────────────────────────────────────────────────────────────────────────
    // イベントフィルタリング ＆ 色計算
    // ────────────────────────────────────────────────────────────────────────
    const projectsMap = useMemo(() => {
        const map = new Map<string, Project>();
        projects.forEach((project) => {
            map.set(String(project.id), project);
        });
        return map;
    }, [projects]);

    const filteredEvents = useMemo(() => {
        return rawEvents.filter((event) => {
            const eventProjectId = event.extendedProps?.projectId;
            const eventType = event.extendedProps?.type?.toLowerCase();
            const eventId = event.id;

            // オフラインプロジェクトの除外
            if (eventType === 'project') {
                const projectId = eventId.replace(/^proj-/, '');
                const project = projectsMap.get(String(projectId));
                if (project && project.display_status === 'offline') return false;
            } else if (eventProjectId) {
                const project = projectsMap.get(String(eventProjectId));
                if (project && project.display_status === 'offline') return false;
            }

            // プロジェクトフィルタ
            let projectFilterPass = true;
            if (eventStatusFilter === 'no-project') {
                projectFilterPass = eventType !== 'project' && !eventProjectId;
            } else if (eventStatusFilter !== 'all') {
                if (eventType === 'project' && String(eventId) === eventStatusFilter) {
                    projectFilterPass = true;
                } else if (eventProjectId && String(eventProjectId) === eventStatusFilter) {
                    projectFilterPass = true;
                } else {
                    projectFilterPass = false;
                }
            }

            // イベントタイプフィルタ
            const typeKey = (eventType || 'generic').toLowerCase();
            const typeKeyForFilter = (typeKey === 'event' || typeKey === 'generic') ? 'generic' : typeKey;
            const typeFilterPass = eventTypeFilter[typeKeyForFilter] !== false;

            // ユーザーフィルタ (OR合成: a担当タスク / b関与プロジェクト / c参加者)
            let userFilterPass = true;
            if (selectedUser !== 'all') {
                // (a) 担当タスク
                const isAssignedTask =
                    typeKey === 'task' &&
                    event.extendedProps?.taskAssigneeId != null &&
                    String(event.extendedProps.taskAssigneeId) === selectedUser;

                // (b) ユーザー関与プロジェクトのイベント
                const eventProjectId = event.extendedProps?.projectId;
                const isInUserProject =
                    eventProjectId != null &&
                    tasks.some(
                        (t) =>
                            t.project_id != null &&
                            String(t.project_id) === String(eventProjectId) &&
                            t.assigned_to != null &&
                            String(t.assigned_to) === selectedUser
                    );

                // (c) 参加者イベント
                const participants = event.extendedProps?.participants;
                const isParticipant =
                    participants != null &&
                    participants.length > 0 &&
                    participants.some(
                        (p) => p.type === 'user' && String(p.id) === selectedUser
                    );

                userFilterPass = typeKey === 'task'
                    ? isAssignedTask
                    : isInUserProject || isParticipant;
            }

            return projectFilterPass && typeFilterPass && userFilterPass;
        });
    }, [rawEvents, eventStatusFilter, eventTypeFilter, projectsMap, selectedUser, tasks]);

    const activeFilterCount = useMemo(() => {
        const statusActive = eventStatusFilter !== 'all' ? 1 : 0;
        const userActive = selectedUser !== 'all' ? 1 : 0;
        const typeHidden = Object.entries(eventTypeFilter).filter(([key, v]) => v !== (DEFAULT_EVENT_TYPE_FILTER[key] ?? true)).length;
        return statusActive + userActive + typeHidden;
    }, [eventStatusFilter, selectedUser, eventTypeFilter]);

    // FullCalendar に引き渡すためのイベントリスト構築
    const eventsForFullCalendar = useMemo(() => {
        return filteredEvents.map((event) => {
            let startStr: string | undefined = undefined;
            let endStr: string | undefined = undefined;

            if (event.start) {
                const startDateObj = typeof event.start === 'string' ? parseISO(event.start) : event.start;
                if (isValidDateFns(startDateObj)) {
                    startStr = event.allDay
                        ? formatDateFnsOriginal(startDateObj, 'yyyy-MM-dd')
                        : formatDateFnsOriginal(startDateObj, "yyyy-MM-dd'T'HH:mm:ssXXX");
                }
            }
            if (event.end) {
                const endDateObj = typeof event.end === 'string' ? parseISO(event.end) : event.end;
                if (isValidDateFns(endDateObj)) {
                    endStr = event.allDay
                        ? formatDateFnsOriginal(endDateObj, 'yyyy-MM-dd')
                        : formatDateFnsOriginal(endDateObj, "yyyy-MM-dd'T'HH:mm:ssXXX");
                }
            }

            // バックエンドイベントやタスクの動的カラー算出
            let backgroundColor = event.backgroundColor;
            let borderColor = event.borderColor;
            const eventType = event.extendedProps?.type?.toLowerCase();

            if (eventType && eventType !== 'project' && eventType !== 'task' && eventType !== 'group') {
                const projectId = event.extendedProps?.projectId;
                const project = projectId ? projectsMap.get(String(projectId)) : undefined;
                const typeForColor = event.extendedProps?.type;
                let eventDate: string | Date | null = null;
                if (typeForColor === 'Meeting' || typeForColor === 'Workshop') {
                    eventDate = event.start || null;
                } else if (event.end) {
                    const endVal = typeof event.end === 'string' ? parseISO(event.end) : event.end;
                    eventDate = event.allDay ? addDays(endVal, -1) : endVal;
                } else if (event.start) {
                    eventDate = event.start;
                }

                const recalculatedColor = getEventColor(
                    typeForColor ?? 'Generic',
                    project?.status ?? undefined,
                    eventDate
                );
                backgroundColor = recalculatedColor;
                borderColor = recalculatedColor;
            } else if (eventType === 'task') {
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
                color: backgroundColor,
            };
        });
    }, [filteredEvents, projectsMap]);

    // FullCalendar のタスクカラー最適化 (背景色のリアルタイム反映のみに制限し動作を軽量化)
    useEffect(() => {
        if (calendarRef.current && eventsForFullCalendar.length > 0) {
            const timeoutId = setTimeout(() => {
                const calendarApi = calendarRef.current?.getApi();
                if (!calendarApi) return;

                eventsForFullCalendar.forEach((event) => {
                    const eventType = event.extendedProps?.type?.toLowerCase();
                    if (eventType === 'task') {
                        const existingEvent = calendarApi.getEventById(event.id);
                        if (existingEvent && existingEvent.backgroundColor !== event.backgroundColor) {
                            existingEvent.setProp('backgroundColor', event.backgroundColor);
                            existingEvent.setProp('borderColor', event.borderColor);
                            existingEvent.setProp('color', event.color);

                            const eventEl = document.getElementsByClassName(`fc-event-id-${event.id}`)[0] as HTMLElement | undefined;
                            if (eventEl) {
                                eventEl.style.setProperty('background-color', event.backgroundColor ?? null, 'important');
                                eventEl.style.setProperty('border-color', (event.borderColor || event.backgroundColor) ?? null, 'important');
                            }
                        }
                    }
                });
            }, 0);
            return () => clearTimeout(timeoutId);
        }
    }, [eventsForFullCalendar]);

    // 選択中イベントの表示情報リアルタイム同期 (ステータス変更時のカラー・クラス即時反映用、O(1)で極めて軽量)
    useEffect(() => {
        if (calendarRef.current && selectedEvent) {
            const calendarApi = calendarRef.current.getApi();
            if (!calendarApi) return;

            const existingEvent = calendarApi.getEventById(selectedEvent.id);
            if (!existingEvent) return;

            const fullCalendarEvent = eventsForFullCalendar.find(e => e.id === selectedEvent.id);
            if (fullCalendarEvent) {
                // 1. 背景色・ボーダー色の同期 (eventDidMount の important スタイルを上書きするため手動で同期)
                existingEvent.setProp('backgroundColor', fullCalendarEvent.backgroundColor);
                existingEvent.setProp('borderColor', fullCalendarEvent.borderColor);
                existingEvent.setProp('color', fullCalendarEvent.color);

                const eventEl = document.getElementsByClassName(`fc-event-id-${selectedEvent.id}`)[0] as HTMLElement | undefined;
                if (eventEl) {
                    eventEl.style.setProperty('background-color', fullCalendarEvent.backgroundColor ?? null, 'important');
                    eventEl.style.setProperty('border-color', (fullCalendarEvent.borderColor || fullCalendarEvent.backgroundColor) ?? null, 'important');
                }

                // 2. 拡張プロパティ (extendedProps) の更新 (完了時の取り消し線クラス適用などに必要)
                if (fullCalendarEvent.extendedProps) {
                    const newProps = fullCalendarEvent.extendedProps as any;
                    Object.keys(newProps).forEach((key) => {
                        existingEvent.setExtendedProp(key, newProps[key]);
                    });
                }
            }
        }
    }, [selectedEvent, eventsForFullCalendar]);

    // ────────────────────────────────────────────────────────────────────────
    // イベントハンドラー群
    // ────────────────────────────────────────────────────────────────────────
    const handleEventStatusFilterChange = (event: any) => {
        setEventStatusFilter(event.target.value);
    };

    const handleUserFilterChange = (event: any) => {
        setSelectedUser(event.target.value);
    };

    const handleEventTypeFilterChange = (typeKey: string, checked: boolean) => {
        setEventTypeFilter((prev) => ({ ...prev, [typeKey]: checked }));
    };

    const handleAllEventTypeOn = useCallback(() => {
        setEventTypeFilter(prev => Object.fromEntries(Object.keys(prev).map(k => [k, true])));
    }, []);

    const handleAllEventTypeOff = useCallback(() => {
        setEventTypeFilter(prev => Object.fromEntries(Object.keys(prev).map(k => [k, false])));
    }, []);

    const handleClearAllFilters = useCallback(() => {
        setEventStatusFilter('all');
        setSelectedUser('all');
        setEventTypeFilter({ task: true, meeting: true, deadline: true, milestone: true, workshop: true, generic: true, project: false, group: true });
    }, []);

    const handleDateClick = (arg: DateClickArg) => {
        if (isMobile) {
            setSelectedDate(arg.date);
            setSelectedEventId(null);
            setMobileEventDetailsOpen(true);
            return;
        }

        if (user?.role !== 'admin') {
            setSelectedDate(arg.date);
            setSelectedEventId(null);
            return;
        }

        if (clickTimeoutRef.current) {
            clearTimeout(clickTimeoutRef.current);
            clickTimeoutRef.current = null;
            handleOpenAddModal({ start: arg.date, allDay: arg.allDay } as DateSelectArg);
        } else {
            clickTimeoutRef.current = setTimeout(() => {
                setSelectedDate(arg.date);
                setSelectedEventId(null);
                clickTimeoutRef.current = null;
            }, 400);
        }
    };

    const handleEventClick = (clickInfo: any) => {
        const clickedEvent = rawEvents.find((event) => event.id === clickInfo.event.id);
        if (!clickedEvent) {
            setSelectedEventId(null);
            return;
        }

        if (isMobile) {
            if (clickedEvent.start) {
                setSelectedDate(clickedEvent.start instanceof Date ? clickedEvent.start : parseISO(clickedEvent.start as string));
            }
            setSelectedEventId(clickedEvent.id);
            setMobileEventDetailsOpen(true);
            return;
        }

        const now = Date.now();
        const isDoubleClick = (now - lastClickTimeRef.current < DOUBLE_CLICK_THRESHOLD) && lastClickedEventIdRef.current === clickInfo.event.id;
        lastClickTimeRef.current = now;
        lastClickedEventIdRef.current = clickInfo.event.id;

        if (isDoubleClick && user?.role === 'admin') {
            handleOpenEditModal(clickedEvent);
            return;
        }

        if (clickedEvent.start) {
            setSelectedDate(clickedEvent.start instanceof Date ? clickedEvent.start : parseISO(clickedEvent.start as string));
        }
        setSelectedEventId(clickedEvent.id);
        setIsPanelMinimized(false);
    };

    const handlePanelEventSelect = (event: CalendarEvent) => {
        if (event.start) {
            setSelectedDate(event.start instanceof Date ? event.start : parseISO(event.start as string));
        }
        setSelectedEventId(event.id);
        setIsPanelMinimized(false);
    };

    const handleOpenAddModal = (selectInfo?: DateSelectArg) => {
        setModalEventToEdit(null);
        if (selectInfo) {
            setDateClickArg({
                date: selectInfo.start,
                dateStr: selectInfo.startStr,
                dayEl: document.createElement('div'),
                jsEvent: new MouseEvent('click'),
                view: selectInfo.view,
                allDay: selectInfo.allDay,
            } as DateClickArg);
        } else {
            setDateClickArg(null);
        }
        setIsAddModalOpen(true);
    };

    const handleOpenEditModal = (event: CalendarEvent) => {
        setSelectedEventId(event.id);
        setModalEventToEdit(event);
        if (event.extendedProps?.isPhase) {
            setIsPhaseEditModalOpen(true);
        } else {
            setIsAddModalOpen(true);
        }
    };

    const handleCloseModal = () => {
        setIsAddModalOpen(false);
    };

    const handleCloseContextMenu = () => {
        setContextMenu(null);
    };

    const handleDuplicate = async () => {
        if (contextMenu) {
            const { taskId, eventId } = contextMenu;
            setContextMenu(null);
            if (taskId) {
                await handleDuplicateTask(taskId);
            } else if (eventId) {
                await handleDuplicateEvent(eventId);
            }
        }
    };

    useEffect(() => {
        if (isAddModalOpen) document.body.classList.add('calendar-modal-open');
        else document.body.classList.remove('calendar-modal-open');
        return () => document.body.classList.remove('calendar-modal-open');
    }, [isAddModalOpen]);

    const handleTogglePanelMinimize = () => {
        setIsPanelMinimized(!isPanelMinimized);
    };

    const handleDatesSet = useCallback(() => {
        setTimeout(() => {
            if (calendarRef.current) {
                calendarRef.current.getApi().updateSize();
            }
        }, 0);
    }, []);

    const handleSelect = (selectInfo: DateSelectArg) => {
        const start = selectInfo.start;
        const end = selectInfo.end;

        setSelectedDate(start instanceof Date ? start : parseISO(start as string));
        setSelectedEventId(null);
        setDateClickArg(null);

        if (user?.role === 'admin') {
            const startMs = start.getTime();
            const endMs = end.getTime();
            const isRange = selectInfo.allDay
                ? endMs - startMs > 24 * 60 * 60 * 1000
                : endMs - startMs > 0;

            if (isRange) {
                handleOpenAddModal(selectInfo);
            }
        }
    };

    const handleDayCellMount = (mountArg: DayCellMountArg) => {
        if (mountArg.isWeekend) {
            mountArg.el.setAttribute('data-weekend', 'true');
        }
    };

    // ────────────────────────────────────────────────────────────────────────
    // レンダリング用ヘルパー
    // ────────────────────────────────────────────────────────────────────────
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

    const renderEventContent = useCallback((eventInfo: any) => {
        const { type } = eventInfo.event.extendedProps;
        const title = eventInfo.event.title || '';
        const typeLabel = getEventTypeLabel(type);
        const viewType = eventInfo.view.type;
        const isTimeGrid = viewType.includes('timeGrid');
        const isListView = viewType.includes('list');

        const isMultiDay = eventInfo.event.allDay &&
            eventInfo.event.start &&
            eventInfo.event.end &&
            Math.floor((eventInfo.event.end.getTime() - eventInfo.event.start.getTime()) / (1000 * 60 * 60 * 24)) > 1;

        if (isListView) {
            const projectIdRawList = eventInfo.event.extendedProps?.projectId;
            const projectNameList = projectIdRawList != null
                ? projectsMap.get(String(projectIdRawList))?.name
                : undefined;

            if (type === 'project') {
                return (
                    <div className="calendar-list-project-content" style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.8 }}>
                        <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{title}</span>
                    </div>
                );
            }

            const shotIDList = eventInfo.event.extendedProps?.shotID || null;

            return (
                <div className="calendar-list-event-content" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '1px 0', overflow: 'hidden' }}>
                    {projectNameList && (
                        <span style={{ fontSize: '0.9rem', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>{projectNameList}</span>
                    )}
                    {shotIDList && (
                        <span style={{ fontWeight: 600, fontSize: '0.9rem', opacity: 0.7, whiteSpace: 'nowrap', flexShrink: 0 }}>{shotIDList}_</span>
                    )}
                    <span style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={title}>{title}</span>
                </div>
            );
        }

        if (isTimeGrid && !eventInfo.event.allDay) {
            const timeText = eventInfo.timeText;
            const projectIdRawTG = eventInfo.event.extendedProps?.projectId;
            const projectNameTG = projectIdRawTG != null
                ? projectsMap.get(String(projectIdRawTG))?.name
                : undefined;
            const shotIDTG = eventInfo.event.extendedProps?.shotID;
            return (
                <div className="calendar-timegrid-event-content" style={{
                    padding: '2px 4px',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-start',
                    gap: '1px',
                    overflow: 'hidden'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, justifyContent: 'space-between' }}>
                        <span style={{
                            fontWeight: 700,
                            fontSize: '0.9rem',
                            lineHeight: '1.2',
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                        }} title={projectNameTG || title}>
                            {projectNameTG || title}
                        </span>
                        {timeText && (
                            <span style={{ fontSize: '0.7rem', fontWeight: 600, opacity: 0.85, flexShrink: 0, whiteSpace: 'nowrap' }}>
                                {timeText}
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', overflow: 'hidden', minWidth: 0 }}>
                        {shotIDTG && (
                            <span style={{ fontSize: '0.8rem', opacity: 0.7, flexShrink: 0, whiteSpace: 'nowrap' }}>
                                {shotIDTG}
                            </span>
                        )}
                        <span style={{
                            fontSize: '0.85rem',
                            lineHeight: '1.2',
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                        }} title={title}>
                            {title}
                        </span>
                    </div>
                </div>
            );
        }

        if (isTimeGrid && eventInfo.event.allDay) {
            const projectIdRawAD = eventInfo.event.extendedProps?.projectId;
            const projectNameAD = projectIdRawAD != null
                ? projectsMap.get(String(projectIdRawAD))?.name
                : undefined;
            const shotIDAD = eventInfo.event.extendedProps?.shotID || null;
            return (
                <div className="calendar-allday-event-content" style={{
                    display: 'flex', alignItems: 'center',
                    gap: '6px', padding: '0 4px',
                    overflow: 'hidden', width: '100%'
                }}>
                    {projectNameAD && (
                        <span style={{ fontWeight: 700, fontSize: '0.9rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {projectNameAD}
                        </span>
                    )}
                    {shotIDAD && (
                        <span style={{ fontWeight: 600, fontSize: '0.85rem', opacity: 0.7, whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {shotIDAD}_
                        </span>
                    )}
                    <span style={{
                        fontWeight: 600, fontSize: '0.9rem',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }} title={title}>
                        {title}
                    </span>
                </div>
            );
        }

        const isPhase = eventInfo.event.extendedProps.isPhase;
        if (!isListView && !isTimeGrid && !isPhase) {
            const projectIdRaw = eventInfo.event.extendedProps?.projectId;
            const projectName = projectIdRaw != null
                ? projectsMap.get(String(projectIdRaw))?.name
                : undefined;
            const shotID = eventInfo.event.extendedProps?.shotID;
            const isProjectEvent = type === 'project';
            return (
                <div className="calendar-event-inner" style={{ width: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '1px' }}>
                    <span style={{
                        fontSize: '0.9rem',
                        fontWeight: 700,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        lineHeight: '1.2'
                    }} title={projectName || typeLabel}>
                        {projectName || typeLabel}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', overflow: 'hidden', minWidth: 0, minHeight: '1.2em' }}>
                        {!isProjectEvent && shotID && (
                            <span style={{
                                fontSize: '0.85rem',
                                opacity: 0.7,
                                flexShrink: 0,
                                whiteSpace: 'nowrap'
                            }}>
                                {shotID}
                            </span>
                        )}
                        {!isProjectEvent && (
                            <span className="calendar-event-title" style={{
                                fontSize: '0.9rem',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                flexShrink: 1,
                                minWidth: 0
                            }} title={title}>
                                {title}
                            </span>
                        )}
                        {isProjectEvent && (
                            <span style={{ visibility: 'hidden' }}>&nbsp;</span>
                        )}
                    </div>
                </div>
            );
        }

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

        if (type?.toLowerCase() === 'milestone') {
            return (
                <div className="calendar-event-inner milestone-event-content" style={{ width: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
                    <span className="calendar-event-type-badge" style={{ marginRight: '4px', fontSize: '0.65rem', padding: '1px 4px' }}>マイルストーン</span>
                    <span className="calendar-event-title" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontWeight: 700 }} title={title}>{title}</span>
                </div>
            );
        }

        if (eventInfo.event.extendedProps.isPhase) {
            const phaseTitle = title;
            const isCompleted = eventInfo.event.extendedProps.isCompleted;
            const isDelayed = eventInfo.event.extendedProps.isDelayed !== undefined
                ? eventInfo.event.extendedProps.isDelayed
                : (!isCompleted && eventInfo.event.start && new Date(eventInfo.event.start) < new Date(new Date().setHours(0, 0, 0, 0)));

            const bgColor = isCompleted
                ? '#9E9E9E'
                : isDelayed
                    ? '#D32F2F'
                    : '#FFA000';

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
                    border: `1px solid ${bgColor}`,
                    boxShadow: 'none',
                    margin: 0
                }}>
                    <span style={{
                        backgroundColor: '#8E24AA',
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

        if (type?.toLowerCase() === 'deadline') {
            return (
                <div className="calendar-event-inner deadline-event-content" style={{ width: '100%', overflow: 'hidden' }}>
                    <span className="calendar-event-type-badge calendar-event-type-deadline" title={typeLabel}>締切</span>
                    <span className="calendar-event-title" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={title}>{title}</span>
                </div>
            );
        }

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

        if (type === 'Generic' || (type && type.toLowerCase() === 'generic') || (type && type.toLowerCase() === 'event')) {
            const isTimedEvent = !eventInfo.event.allDay && eventInfo.timeText;
            const timeText = eventInfo.timeText || '';
            const displayTitle = timeText ? `${timeText} ${title}` : title;
            return (
                <div className="calendar-event-inner calendar-event-generic" style={{ width: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
                    <span className="calendar-event-type-badge calendar-event-type-generic" style={{ marginRight: '4px', fontSize: '0.65rem' }}>予定</span>
                    {isTimedEvent && <span className="calendar-event-time" style={{ fontWeight: 600, marginRight: '4px', opacity: 0.8 }}>{timeText}</span>}
                    <span className="calendar-event-title" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontWeight: 500 }} title={displayTitle}>
                        {title}
                    </span>
                </div>
            );
        }

        if (type === 'task') {
            const status = eventInfo.event.extendedProps.status;
            const isDelayed = status === 'delayed';
            const shotID = eventInfo.event.extendedProps.shotID;

            return (
                <div className="calendar-event-inner" style={{ width: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
                    <span className="calendar-event-type-badge calendar-event-type-task" style={{ marginRight: '4px', fontSize: '0.65rem', padding: '1px 4px' }}>タスク</span>
                    {shotID && (
                        <span style={{
                            marginRight: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            flexShrink: 0
                        }}>{shotID}_</span>
                    )}
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
                    <span className="calendar-event-title" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontWeight: 600 }} title={shotID ? `${shotID}_${title}` : title}>{title}</span>
                </div>
            );
        }

        return (
            <div className="calendar-event-inner" style={{ width: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
                <span className="calendar-event-type-badge" style={{ marginRight: '4px', fontSize: '0.65rem' }}>{typeLabel.slice(0, 2)}</span>
                <span className="calendar-event-title" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={title}>{title}</span>
            </div>
        );
    }, [projectsMap]);

    const renderEventModal = () => {
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

    const totalCost = useMemo(() => {
        const dayEvents = filteredEvents.filter((event) => {
            if (!event.start || !selectedDate) return false;
            const eventDate = typeof event.start === 'string' ? parseISO(event.start) : event.start;
            return (
                eventDate.getFullYear() === selectedDate.getFullYear() &&
                eventDate.getMonth() === selectedDate.getMonth() &&
                eventDate.getDate() === selectedDate.getDate()
            );
        });
        
        return dayEvents.reduce((acc, event) => {
            if (event.extendedProps?.type === 'task') {
                return acc + (Number(event.extendedProps.taskCost) || 0);
            }
            return acc;
        }, 0);
    }, [filteredEvents, selectedDate]);

    if (dataLoading && rawEvents.length === 0) {
        return <CircularProgress />;
    }

    return (
        <Box
            ref={containerRef}
            sx={(theme) => ({
                display: 'flex',
                flexDirection: 'column',
                height: { xs: 'calc(100vh - 56px)', sm: 'calc(100vh - 64px)' },
                overflow: { xs: 'auto', sm: 'hidden' },
                p: { xs: 1, sm: 2 },
                bgcolor: theme.palette.mode === 'dark' ? theme.palette.background.default : 'grey.50',
            })}
        >
            {/* Google風トップバー */}
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
                        {user?.role === 'admin' && (
                            <Button
                                variant="outlined"
                                onClick={() => setIsAIImportModalOpen(true)}
                                size={isSmallScreen ? "small" : "medium"}
                                sx={{
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    borderRadius: 2,
                                    fontSize: { xs: '0.8rem', sm: '0.875rem' },
                                }}
                            >
                                AIで取り込み
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
                        <Badge badgeContent={activeFilterCount} color="primary" invisible={activeFilterCount === 0}>
                            <FilterListIcon />
                        </Badge>
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
                    {user?.role === 'admin' && (
                        <Button
                            variant="outlined"
                            onClick={() => setIsAIImportModalOpen(true)}
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
                            AIで取り込み
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
                        .fc .fc-daygrid-day.fc-day-today { background-color: ${isDark ? '#1a73e8' : '#e8f0fe'}; }
                        .fc .fc-daygrid-day.fc-day-selected { background-color: ${isDark ? '#174ea6' : '#90caf9'} !important; }
                        .fc .fc-daygrid-day[data-weekend="true"] { background-color: ${isDark ? '#292a2d' : '#fafafa'}; }
                        
                        .fc .fc-col-header-cell.fc-day-mon,
                        .fc .fc-col-header-cell.fc-day-mon a,
                        .fc .fc-col-header-cell.fc-day-mon .fc-col-header-cell-cushion,
                        .fc .fc-daygrid-day.fc-day-mon .fc-daygrid-day-number,
                        .fc .fc-col-header-cell.fc-day-tue,
                        .fc .fc-col-header-cell.fc-day-tue a,
                        .fc .fc-col-header-cell.fc-day-tue .fc-col-header-cell-cushion,
                        .fc .fc-daygrid-day.fc-day-tue .fc-daygrid-day-number,
                        .fc .fc-col-header-cell.fc-day-wed,
                        .fc .fc-col-header-cell.fc-day-wed a,
                        .fc .fc-col-header-cell.fc-day-wed .fc-col-header-cell-cushion,
                        .fc .fc-daygrid-day.fc-day-wed .fc-daygrid-day-number,
                        .fc .fc-col-header-cell.fc-day-thu,
                        .fc .fc-col-header-cell.fc-day-thu a,
                        .fc .fc-col-header-cell.fc-day-thu .fc-col-header-cell-cushion,
                        .fc .fc-daygrid-day.fc-day-thu .fc-daygrid-day-number,
                        .fc .fc-col-header-cell.fc-day-fri,
                        .fc .fc-col-header-cell.fc-day-fri a,
                        .fc .fc-col-header-cell.fc-day-fri .fc-col-header-cell-cushion,
                        .fc .fc-daygrid-day.fc-day-fri .fc-daygrid-day-number {
                            color: ${isDark ? '#e8eaed' : '#000000'} !important;
                            background-color: ${isDark ? '#202124' : '#ffffff'};
                        }
                        
                        .fc .fc-col-header-cell.fc-day-sat,
                        .fc .fc-col-header-cell.fc-day-sat a,
                        .fc .fc-col-header-cell.fc-day-sat .fc-col-header-cell-cushion,
                        .fc .fc-daygrid-day.fc-day-sat .fc-daygrid-day-number {
                            color: ${isDark ? '#8ab4f8' : '#1a73e8'} !important;
                            background-color: ${isDark ? '#202124' : '#ffffff'};
                        }
                        
                        .fc .fc-col-header-cell.fc-day-sun,
                        .fc .fc-col-header-cell.fc-day-sun a,
                        .fc .fc-col-header-cell.fc-day-sun .fc-col-header-cell-cushion,
                        .fc .fc-daygrid-day.fc-day-sun .fc-daygrid-day-number {
                            color: ${isDark ? '#f28b82' : '#d93025'} !important;
                            background-color: ${isDark ? '#202124' : '#ffffff'};
                        }

                        .fc-list-view { background-color: ${isDark ? '#121212' : '#ffffff'} !important; }
                        .fc-list-table { background-color: ${isDark ? '#121212' : '#ffffff'} !important; }
                        .fc-list-table td {
                            background-color: ${isDark ? '#121212' : '#ffffff'} !important;
                            border-color: ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'} !important;
                        }
                        .fc-list-day-cushion {
                            background-color: ${isDark ? '#2c2c2e' : '#f8f9fa'} !important;
                            border-bottom: 1px solid ${isDark ? '#3c4043' : '#e8eaed'} !important;
                        }
                        .fc-list-day-cushion a { color: ${isDark ? '#8ab4f8' : '#1a73e8'} !important; text-decoration: none !important; }
                        .fc-list-event { background-color: ${isDark ? '#1e1e1e' : '#ffffff'} !important; color: ${isDark ? '#e8eaed' : '#202124'} !important; }
                        .fc-list-event:hover td { background-color: ${isDark ? '#2c2c2e' : '#f1f3f4'} !important; }

                        .fc-daygrid-day-frame {
                            min-height: ${isSmallScreen ? '100px' : '160px'} !important;
                        }
                        .fc-daygrid-body tr { min-height: ${isSmallScreen ? '100px' : '160px'} !important; }
                        .fc-daygrid-day-events {
                            height: auto !important;
                            min-height: 0 !important;
                            margin-bottom: 2px !important;
                        }
                        .fc-daygrid-day-top {
                            height: ${isSmallScreen ? '16px' : '20px'} !important;
                            min-height: ${isSmallScreen ? '16px' : '20px'} !important;
                        }

                        /* Timed events (meetings, generic events, workshops, etc.) styled without background */
                        .fc-event.custom-event,
                        .fc-daygrid-event.custom-event,
                        .fc-timegrid-event.custom-event,
                        .fc-list-event.custom-event {
                            background: transparent !important;
                            background-color: transparent !important;
                            border: none !important;
                            box-shadow: none !important;
                        }
                        .fc-daygrid-event.custom-event {
                            padding: 2px 4px !important;
                            margin: 1px 2px !important;
                        }
                        .fc-event.custom-event:hover,
                        .fc-daygrid-event.custom-event:hover,
                        .fc-timegrid-event.custom-event:hover {
                            background-color: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)'} !important;
                        }

                        .fc-event.deadline-event-wrapper,
                        .fc-daygrid-event.deadline-event-wrapper,
                        .fc-event.milestone-event-wrapper,
                        .fc-daygrid-event.milestone-event-wrapper {
                            background: none !important;
                            border: none !important;
                            box-shadow: none !important;
                        }

                        .deadline-event-content,
                        .milestone-event-content {
                            color: #d32f2f !important;
                            background: none !important;
                            border: none !important;
                            font-weight: bold;
                            overflow: hidden;
                            white-space: nowrap;
                            text-overflow: ellipsis;
                        }

                        /* Badges inside custom and styled events (meetings, workshops, generic, deadlines, milestones) */
                        .fc-event.custom-event .calendar-event-type-badge,
                        .fc-daygrid-event.custom-event .calendar-event-type-badge,
                        .fc-timegrid-event.custom-event .calendar-event-type-badge,
                        .fc-list-event.custom-event .calendar-event-type-badge,
                        .deadline-event-content .calendar-event-type-badge,
                        .milestone-event-content .calendar-event-type-badge {
                            background: transparent !important;
                            border: 1px solid currentColor !important;
                            color: inherit !important;
                            padding: 0px 3px !important;
                            font-weight: 700 !important;
                        }

                        /* Ensure child text inside inherits custom colors */
                        .fc-event.custom-event,
                        .fc-event.custom-event *,
                        .fc-daygrid-event.custom-event,
                        .fc-daygrid-event.custom-event *,
                        .fc-timegrid-event.custom-event,
                        .fc-timegrid-event.custom-event *,
                        .fc-list-event.custom-event,
                        .fc-list-event.custom-event * {
                            color: inherit !important;
                        }

                        /* Category-specific color mapping for custom events */
                        .meeting-event {
                            color: #1976d2 !important;
                        }
                        .workshop-event {
                            color: #00897b !important;
                        }
                        .generic-event {
                            color: #2196f3 !important;
                        }

                        /* Status-specific grey styling for non-task events */
                        .fc-event.grey-event.custom-event,
                        .fc-event.grey-event.custom-event *,
                        .fc-event.grey-event.deadline-event-wrapper *,
                        .fc-event.grey-event.milestone-event-wrapper * {
                            color: ${isDark ? '#8a9096' : '#9e9e9e'} !important;
                            text-decoration: line-through !important;
                        }

                        /* Project-specific styles for solid bar rendering spanning cells */
                        .fc-event.project-event {
                            border-radius: 4px !important;
                            padding: 2px 6px !important;
                            margin: 1px 2px !important;
                            color: #ffffff !important;
                            box-shadow: 0 1px 3px rgba(0,0,0,0.15) !important;
                            border-style: solid !important;
                            border-width: 1px !important;
                        }
                        .fc-event.project-event .calendar-event-title,
                        .fc-event.project-event * {
                            color: #ffffff !important;
                        }
                        .fc-event.project-event:hover {
                            filter: brightness(0.95) !important;
                            box-shadow: 0 2px 5px rgba(0,0,0,0.2) !important;
                        }

                        .fc-event.completed-project-event { background-color: #9E9E9E !important; border-color: #9E9E9E !important; }
                        .fc-event.completed-project-event.deadline-event-wrapper { background: none !important; }
                        .fc-event.completed-project-event .deadline-event-content { color: #757575 !important; }

                        .fc-event.grey-event.deadline-event-wrapper .deadline-event-content { color: ${isDark ? '#e0e0e0' : '#616161'} !important; }
                        .fc-event.grey-event.milestone-event-wrapper .milestone-event-content { background-color: #9E9E9E !important; color: ${isDark ? '#fff' : '#000'} !important; }

                        .calendar-event-inner { display: flex; align-items: center; gap: 4px; width: 100%; min-height: 1.2em; }
                        .calendar-event-type-badge {
                            font-size: ${isSmallScreen ? '0.55rem' : '0.65rem'};
                            font-weight: 700;
                            padding: 1px 4px;
                            border-radius: 3px;
                        }
                        .calendar-event-type-generic { background: #2196f3; color: #fff; }
                        .calendar-event-type-project { background: #757575; color: #fff; }
                        .calendar-event-type-task { background: #4caf50; color: #fff; }
                        .calendar-event-type-deadline { background: #d32f2f; color: #fff; }
                        .calendar-event-type-meeting { background: #1976d2; color: #fff; }
                        .calendar-event-type-workshop { background: #00897b; color: #fff; }

                        .calendar-allday-event-content {
                            font-size: 0.9rem;
                            line-height: 1.2;
                        }

                        .fc-timegrid-event {
                            border-radius: 4px !important;
                            border: none !important;
                            border-left: 3px solid rgba(0,0,0,0.2) !important;
                        }
                        .fc-timegrid-slot { height: 40px !important; }
                        .fc-timegrid-slot-label { font-size: 0.75rem !important; color: ${isDark ? '#9aa0a6' : '#5f6368'} !important; }
                        .fc-list-event-title { font-size: 0.9rem !important; }
                        .fc-list-event-time { font-size: 0.85rem !important; color: ${isDark ? '#9aa0a6' : '#5f6368'} !important; }
                        .fc-list-day-cushion a { font-size: 0.85rem !important; }
                    `}</style>

                    {error && <Typography color="error" sx={{ px: 1 }}>{error}</Typography>}
                    {dataError && <Typography color="error" sx={{ px: 1 }}>{dataError}</Typography>}

                    <FullCalendar
                        ref={calendarRef}
                        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
                        initialView={isMobile ? "listMonth" : "dayGridMonth"}
                        eventDisplay="block"
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
                        eventOrder={(a: any, b: any) => {
                            const rankA = getEventRank(a);
                            const rankB = getEventRank(b);
                            if (rankA !== rankB) return rankA - rankB;

                            const aAllDay = a.allDay ? 1 : 0;
                            const bAllDay = b.allDay ? 1 : 0;
                            if (aAllDay !== bAllDay) return bAllDay - aAllDay;

                            const aStart = a.start ? new Date(a.start).getTime() : 0;
                            const bStart = b.start ? new Date(b.start).getTime() : 0;
                            if (aStart !== bStart) return aStart - bStart;

                            return (a.title || '').localeCompare(b.title || '');
                        }}
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
                        fixedWeekCount={true}
                        showNonCurrentDates={true}
                        dayMaxEvents={isMobile ? 2 : (isSmallScreen ? 3 : 4)}
                        dateClick={handleDateClick}
                        select={handleSelect}
                        eventClick={handleEventClick}
                        eventContent={renderEventContent}
                        eventClassNames={(arg) => {
                            const type = arg.event.extendedProps.type;
                            const projectId = arg.event.extendedProps.projectId;
                            const classes: string[] = [];
                            classes.push(`fc-event-id-${arg.event.id}`);

                            const project = projectId ? projectsMap.get(String(projectId)) : undefined;
                            const projectStatusStr = project?.status ? String(project.status).toLowerCase() : undefined;
                            const isCompletedProject = projectStatusStr === 'completed';

                            const taskStatusStr = arg.event.extendedProps.taskStatus ? String(arg.event.extendedProps.taskStatus).toLowerCase() : undefined;
                            const eventStatusStr = arg.event.extendedProps.status ? String(arg.event.extendedProps.status).toLowerCase() : undefined;

                            if (taskStatusStr === 'completed' || eventStatusStr === 'completed' || eventStatusStr === 'cancelled') {
                                classes.push('grey-event');
                            }

                            if (isCompletedProject) {
                                classes.push('completed-project-event');
                            }

                            const normalizedType = type?.toLowerCase() || 'generic';

                            if (normalizedType === 'project') {
                                classes.push('project-event');
                            } else if (normalizedType === 'task') {
                                if (taskStatusStr === 'completed') {
                                    classes.push('grey-task');
                                }
                            } else if (normalizedType === 'deadline') {
                                classes.push('deadline-event-wrapper');
                            } else if (normalizedType === 'milestone') {
                                classes.push('milestone-event-wrapper');
                            }

                            if (normalizedType === 'meeting') {
                                classes.push('custom-event', 'meeting-event');
                            } else if (normalizedType === 'workshop') {
                                classes.push('custom-event', 'workshop-event');
                            } else if (normalizedType === 'generic' || normalizedType === 'event') {
                                classes.push('custom-event', 'generic-event');
                            } else if (normalizedType !== 'task' && normalizedType !== 'project' && normalizedType !== 'deadline' && normalizedType !== 'milestone') {
                                classes.push('custom-event');
                            }

                            return classes;
                        }}
                        eventDidMount={(arg) => {
                            const type = arg.event.extendedProps.type;
                            // Apply transparent background and colored text for custom events (meetings, generic events, workshops)
                            if (arg.el.classList.contains('custom-event')) {
                                const bg = arg.event.backgroundColor || arg.event.borderColor;
                                if (bg) {
                                    arg.el.style.setProperty('background-color', 'transparent', 'important');
                                    arg.el.style.setProperty('border-color', 'transparent', 'important');
                                    arg.el.style.setProperty('box-shadow', 'none', 'important');
                                    arg.el.style.setProperty('color', bg, 'important');
                                }
                            }

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

                                arg.el.style.setProperty('background-color', recalculatedColor, 'important');
                                arg.el.style.setProperty('border-color', recalculatedColor, 'important');

                                arg.event.setProp('backgroundColor', recalculatedColor);
                                arg.event.setProp('borderColor', recalculatedColor);
                                arg.event.setProp('color', recalculatedColor);

                                // 右クリックでタスク複製メニューを表示
                                arg.el.addEventListener('contextmenu', (e: MouseEvent) => {
                                    if (user?.role !== 'admin') return;
                                    e.preventDefault();
                                    e.stopPropagation();

                                    const taskId = arg.event.extendedProps?.taskId;
                                    if (taskId) {
                                        setContextMenu({
                                            mouseX: e.clientX,
                                            mouseY: e.clientY,
                                            taskId: Number(taskId),
                                        });
                                    }
                                });
                            }

                            // 右クリックでイベント複製メニューを表示
                            if (arg.event.id.startsWith('event-')) {
                                arg.el.addEventListener('contextmenu', (e: MouseEvent) => {
                                    if (user?.role !== 'admin') return;
                                    e.preventDefault();
                                    e.stopPropagation();

                                    const eventIdStr = arg.event.id.replace('event-', '');
                                    const eventId = Number(eventIdStr);
                                    if (!isNaN(eventId)) {
                                        setContextMenu({
                                            mouseX: e.clientX,
                                            mouseY: e.clientY,
                                            eventId: eventId,
                                        });
                                    }
                                });
                            }
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
                            onDelete={handleDeleteEvent as any}
                            eventStatusFilter={eventStatusFilter}
                            onEventStatusFilterChange={handleEventStatusFilterChange}
                            eventTypeFilter={eventTypeFilter}
                            onEventTypeFilterChange={handleEventTypeFilterChange}
                            projects={projects}
                            googleStatus={googleStatus}
                            onGoogleSyncToggle={handleGoogleSyncEventToggle}
                            onUpdateTask={handleUpdateTask}
                            onUpdateEvent={handleUpdateEvent}
                            tasks={tasks}
                            userFilter={selectedUser}
                            onUserFilterChange={handleUserFilterChange}
                            onClearAllFilters={handleClearAllFilters}
                        />
                    </Box>
                )}
            </Box>

            {renderEventModal()}

            <AIImportModal
                open={isAIImportModalOpen}
                onClose={() => setIsAIImportModalOpen(false)}
                onSaved={() => { refetch(); refreshGlobalData(); }}
            />

            <Popover
                open={contextMenu !== null}
                anchorReference="anchorPosition"
                anchorPosition={
                    contextMenu !== null
                        ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
                        : undefined
                }
                onClose={handleCloseContextMenu}
                anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'center',
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'center',
                }}
                PaperProps={{
                    sx: {
                        p: 0.5,
                        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1.5,
                        bgcolor: 'background.paper',
                    }
                }}
            >
                <Button
                    size="small"
                    startIcon={<ContentCopyIcon sx={{ fontSize: '0.9rem' }} />}
                    onClick={handleDuplicate}
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        fontSize: '0.75rem',
                        color: 'primary.main',
                        px: 1.5,
                        py: 0.5,
                        borderRadius: 1,
                        '&:hover': {
                            bgcolor: 'action.hover',
                        }
                    }}
                >
                    {contextMenu?.taskId ? 'タスクを複製' : 'イベントを複製'}
                </Button>
            </Popover>

            {/* モバイル用: フィルタードロワー */}
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

                        <FormControl fullWidth sx={{ mb: 2 }}>
                            <InputLabel>ユーザー</InputLabel>
                            <Select
                                value={selectedUser}
                                label="ユーザー"
                                onChange={handleUserFilterChange}
                            >
                                <MenuItem value="all">すべて</MenuItem>
                                {users.map((u) => (
                                    <MenuItem key={u.id} value={String(u.id)}>
                                        {u.name || u.username || u.email}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                                イベントタイプ
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <Button size="small" variant="text" onClick={handleAllEventTypeOn}>全オン</Button>
                                <Button size="small" variant="text" onClick={handleAllEventTypeOff}>全オフ</Button>
                            </Box>
                        </Box>
                        <FormGroup>
                            {EVENT_TYPE_ORDER.map((type) => {
                                const enabled = eventTypeFilter[type] ?? DEFAULT_EVENT_TYPE_FILTER[type] ?? true;
                                return (
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
                                );
                            })}
                        </FormGroup>
                        <Button
                            fullWidth
                            variant="outlined"
                            color="secondary"
                            disabled={activeFilterCount === 0}
                            sx={{ mt: 2 }}
                            onClick={() => { handleClearAllFilters(); setMobileFilterOpen(false); }}
                        >
                            フィルタをすべてクリア ({activeFilterCount}件適用中)
                        </Button>
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
                            onDelete={handleDeleteEvent as any}
                            eventStatusFilter={eventStatusFilter}
                            onEventStatusFilterChange={handleEventStatusFilterChange}
                            eventTypeFilter={eventTypeFilter}
                            onEventTypeFilterChange={handleEventTypeFilterChange}
                            projects={projects}
                            onUpdateTask={handleUpdateTask}
                            onUpdateEvent={handleUpdateEvent}
                            tasks={tasks}
                            userFilter={selectedUser}
                            onUserFilterChange={handleUserFilterChange}
                            onClearAllFilters={handleClearAllFilters}
                        />
                    </Box>
                </Drawer>
            )}

            {/* モバイル用: フローティングアクションボタン */}
            {isMobile && (
                <Box
                    sx={{
                        position: 'fixed',
                        bottom: 88,
                        right: 16,
                        zIndex: 1000,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2
                    }}
                >
                    <Fab
                        size="medium"
                        color="secondary"
                        aria-label="filter"
                        onClick={() => setMobileFilterOpen(true)}
                        sx={{
                            bgcolor: 'background.paper',
                            color: 'text.secondary',
                            boxShadow: 3
                        }}
                    >
                        <FilterListIcon />
                    </Fab>
                    {user?.role === 'admin' && (
                        <Fab
                            color="primary"
                            aria-label="add"
                            onClick={() => handleOpenAddModal()}
                        >
                            <AddIcon />
                        </Fab>
                    )}
                </Box>
            )}

            <Snackbar
                open={googleSnackbar.open}
                autoHideDuration={6000}
                onClose={closeSnackbar}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert severity={googleSnackbar.severity} onClose={closeSnackbar}>
                    {googleSnackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default CalendarPage;