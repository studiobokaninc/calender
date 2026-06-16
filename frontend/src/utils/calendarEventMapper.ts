/**
 * カレンダーイベントのソートとマッピングユーティリティ
 * CalendarPage.tsx から分離
 */
import { parseISO, addDays, isSameDay, setHours, setMinutes } from 'date-fns';
import { CalendarEvent, Task, Project, Group, BackendEvent, User } from '../types';
import { getTaskColor, getProjectColor, getEventColor, normalizeEventType } from './calendarEventColors';

// ────────────────────────────────────────────────────────────────────────────
// Sort
// ────────────────────────────────────────────────────────────────────────────

export const getEventRank = (event: CalendarEvent): number => {
    if (event.extendedProps?.isPhase) {
        return 6; // 段階目標
    }
    const type = (event.extendedProps?.type || '').toLowerCase();
    switch (type) {
        case 'project':
            return 1; // プロジェクト
        case 'milestone':
            return 2; // マイルストーン
        case 'deadline':
            return 3; // 締切
        case 'generic':
        case 'event':
            return 4; // 通常イベント
        case 'meeting':
            return 5; // 会議
        case 'workshop':
            return 7; // ワークショップ
        case 'task':
            return 8; // タスク
        default:
            return 9; // その他
    }
};

export const sortEventsForDisplay = (eventsToSort: CalendarEvent[]): CalendarEvent[] => {
    return [...eventsToSort].sort((a, b) => {
        const rankA = getEventRank(a);
        const rankB = getEventRank(b);

        if (rankA !== rankB) {
            return rankA - rankB;
        }

        const typeLower = (a.extendedProps?.type || '').toLowerCase();

        if (typeLower === 'project') {
            const aProjectStart = a.extendedProps.projectStartDate ? new Date(a.extendedProps.projectStartDate).getTime() : 0;
            const bProjectStart = b.extendedProps.projectStartDate ? new Date(b.extendedProps.projectStartDate).getTime() : 0;
            return aProjectStart - bProjectStart || (a.title || '').localeCompare(b.title || '');
        }

        if (typeLower === 'task' || a.extendedProps?.isPhase) {
            const aDueDate = a.extendedProps.taskDueDate ? new Date(a.extendedProps.taskDueDate).getTime() : 0;
            const bDueDate = b.extendedProps.taskDueDate ? new Date(b.extendedProps.taskDueDate).getTime() : 0;
            return aDueDate - bDueDate || (a.title || '').localeCompare(b.title || '');
        }

        const aStart = a.start ? new Date(a.start).getTime() : 0;
        const bStart = b.start ? new Date(b.start).getTime() : 0;
        const aIsAllDay = a.allDay;
        const bIsAllDay = b.allDay;

        if (aIsAllDay && !bIsAllDay) return -1;
        if (!aIsAllDay && bIsAllDay) return 1;
        return aStart - bStart || (a.title || '').localeCompare(b.title || '');
    });
};

// ────────────────────────────────────────────────────────────────────────────
// Task → CalendarEvent
// ────────────────────────────────────────────────────────────────────────────

export const taskToCalendarEvents = (
    task: Task,
    project: Project | undefined,
    isAdmin: boolean
): CalendarEvent[] => {
    const events: CalendarEvent[] = [];

    if (task.due_date) {
        const taskColor = getTaskColor(task.status ?? 'todo', project?.status ?? undefined, task.due_date);
        events.push({
            id: `task-${task.id}`,
            title: task.name || 'Untitled Task',
            start: parseISO(task.due_date),
            end: undefined,
            allDay: true,
            backgroundColor: taskColor,
            borderColor: taskColor,
            editable: isAdmin,
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
                deliverables: (task as any).deliverables,
                check_items: (task as any).check_items,
                taskProgress: task.progress,
                shotID: task.shotID ?? undefined,
                seqID: task.seqID ?? undefined,
                shot_id: task.shot_id ?? undefined,
            },
        });
    }

    if (task.phases && Array.isArray(task.phases)) {
        task.phases.forEach((phase: any, index: number) => {
            if (!phase.date) return;
            const isDelayed = !phase.is_completed && new Date(phase.date) < startOfToday();
            const phaseColor = phase.is_completed ? '#9E9E9E' : isDelayed ? '#D32F2F' : '#FFA000';
            events.push({
                id: `task-${task.id}-phase-${index}`,
                title: `${task.name}: ${phase.name}`,
                start: parseISO(phase.date),
                allDay: true,
                backgroundColor: phaseColor,
                borderColor: phaseColor,
                textColor: '#ffffff',
                editable: isAdmin,
                extendedProps: {
                    type: 'task',
                    isPhase: true,
                    isCompleted: phase.is_completed,
                    isDelayed: isDelayed,
                    taskId: task.id,
                    description: `Phase: ${phase.name}`,
                    projectId: task.project_id ? String(task.project_id) : undefined,
                    taskDueDate: phase.date,
                    taskStatus: task.status,
                    displayStatus: project?.display_status as 'online' | 'offline' | 'archived' | undefined,
                    check_items: (task as any).check_items ?? [],
                    deliverables: (task as any).deliverables ?? '',
                    phases: task.phases ?? [],
                    shotID: task.shotID ?? undefined,
                },
            });
        });
    }

    return events;
};

// ────────────────────────────────────────────────────────────────────────────
// Project → CalendarEvent
// ────────────────────────────────────────────────────────────────────────────

export const projectToCalendarEvent = (project: Project, isAdmin: boolean): CalendarEvent | null => {
    if (!project.start_date) return null;
    return {
        id: `proj-${project.id}`,
        title: project.name || 'Untitled Project',
        start: parseISO(project.start_date),
        end: project.end_date ? addDays(parseISO(project.end_date), 1) : undefined,
        allDay: true,
        backgroundColor: getProjectColor(project),
        borderColor: getProjectColor(project),
        editable: isAdmin,
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
    };
};

// ────────────────────────────────────────────────────────────────────────────
// Group → CalendarEvent
// ────────────────────────────────────────────────────────────────────────────

export const groupToCalendarEvent = (group: Group, isAdmin: boolean): CalendarEvent | null => {
    if (!group.start_date) return null;
    return {
        id: `group-${group.id}`,
        title: group.name || 'Untitled Group',
        start: parseISO(group.start_date as string),
        end: group.end_date ? addDays(parseISO(group.end_date as string), 1) : undefined,
        allDay: true,
        backgroundColor: '#9C27B0',
        borderColor: '#9C27B0',
        editable: isAdmin,
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
        },
    };
};

// ────────────────────────────────────────────────────────────────────────────
// BackendEvent → CalendarEvent
// ────────────────────────────────────────────────────────────────────────────

interface BackendEventMapOptions {
    user: User | null;
    projects: Project[];
    /** 時間ゼロの会議イベントを5:00-28:59に変換するか */
    convertMeetingAllDay?: boolean;
}

export const backendEventToCalendarEvent = (
    be: BackendEvent,
    { user, projects, convertMeetingAllDay = true }: BackendEventMapOptions
): CalendarEvent | null => {
    // 一般ユーザーフィルタリング
    if (user && user.role !== 'admin') {
        const isParticipant = be.participants?.some((p: any) => String(p.id) === String(user.id));
        const isMyProjectEvent = be.project_id && projects.some(p => p.id === be.project_id);
        if (!isParticipant && !isMyProjectEvent) return null;
    }

    let startStr = be.start_time as string;
    let endStr = be.end_time as string;
    if (!startStr) return null;

    const eventType = be.type;
    if (eventType === 'Task' || eventType === 'Project') return null;

    // Task/Project は別途処理するので除外
    const normalizedType = normalizeEventType(be.type);

    // 会議の00:00~00:00 → 5:00~28:59 変換
    if (convertMeetingAllDay && normalizedType === 'Meeting' && startStr && endStr) {
        const s = parseISO(startStr);
        const e = parseISO(endStr);
        if (isSameDay(s, e) && s.getHours() === 0 && s.getMinutes() === 0 && e.getHours() === 0 && e.getMinutes() === 0) {
            startStr = setHours(setMinutes(s, 0), 5).toISOString();
            endStr = addDays(setHours(setMinutes(s, 59), 4), 1).toISOString();
            be.allDay = false;
        }
    }

    const project = be.project_id ? projects.find(p => p.id === be.project_id) : undefined;
    const eventDate = (normalizedType === 'Meeting' || normalizedType === 'Workshop')
        ? parseISO(startStr)
        : (endStr ? ((be.allDay ?? false) ? addDays(parseISO(endStr), -1) : parseISO(endStr)) : parseISO(startStr));

    const eventColor = getEventColor(normalizedType, project?.status ?? undefined, eventDate);

    return {
        id: `event-${be.id}`,
        title: be.title,
        start: parseISO(startStr),
        end: endStr ? parseISO(endStr) : undefined,
        allDay: be.allDay ?? false,
        backgroundColor: eventColor,
        borderColor: eventColor,
        editable: user?.role === 'admin',
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
};

// ────────────────────────────────────────────────────────────────────────────
// Helper
// ────────────────────────────────────────────────────────────────────────────

const startOfToday = (): Date => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
};
