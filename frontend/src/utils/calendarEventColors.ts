/**
 * カレンダーイベントの色計算ユーティリティ
 * CalendarPage.tsx から分離
 */

export const normalizeEventType = (type: string | undefined | null): string => {
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

export const getEventColor = (
    type?: string,
    _projectStatus?: string,
    _eventDate?: string | Date | null
): string => {
    const t = type?.toLowerCase();
    switch (t) {
        case 'meeting': return '#1976d2';
        case 'review':
        case 'workshop': return '#00897b';
        case 'deadline': return '#d32f2f';
        case 'milestone': return '#d32f2f';
        default: return '#2196f3';
    }
};

export const getProjectColor = (
    project?: { status?: string | null; color?: string | null; display_status?: string | null } | string
): string => {
    if (typeof project === 'object' && project) {
        if (project.display_status === 'offline') return '#9E9E9E';
        const status = project.status;
        switch (status) {
            case 'planning': return '#FF9800';
            case 'in-progress': return '#4CAF50';
            case 'completed': return '#9E9E9E';
            default: return '#757575';
        }
    }
    const status = typeof project === 'string' ? project : undefined;
    switch (status) {
        case 'planning': return '#FF9800';
        case 'in-progress': return '#4CAF50';
        case 'completed': return '#9E9E9E';
        default: return '#757575';
    }
};

export const getTaskColor = (
    status?: string,
    _projectStatus?: string,
    _dueDate?: string | Date | null
): string => {
    switch (status?.toLowerCase()) {
        case 'todo': return '#2196F3';
        case 'in-progress': return '#FF9800';
        case 'review': return '#9C27B0';
        case 'delayed': return '#F44336';
        case 'completed': return '#9E9E9E';
        default: return '#BDBDBD';
    }
};
