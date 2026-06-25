/**
 * カレンダーの追加・更新・削除などのアクションを行うカスタムフック
 * CalendarPage.tsx から分離して可読性と保守性を向上
 */
import { useCallback } from 'react';
import { parseISO, addDays, startOfDay, format as formatDateFnsOriginal } from 'date-fns';
import api from '../services/api';
import { CalendarEvent, BackendEvent, Task, Project, User } from '../types';
import { usePageState } from '../contexts/PageStateContext';

interface UseCalendarActionsOptions {
    user: User | null;
    tasks: Task[];
    projects: Project[];
    modalEventToEdit: CalendarEvent | null;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    setSelectedEventId: (id: string | null) => void;
    setModalEventToEdit: (event: CalendarEvent | null) => void;
    setIsAddModalOpen: (open: boolean) => void;
    setIsPhaseEditModalOpen: (open: boolean) => void;
    refetch: () => void;
    refreshGlobalData?: (options?: { force?: boolean }) => Promise<void>;
}

export const useCalendarActions = ({
    user,
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
}: UseCalendarActionsOptions) => {
    const { globalData, updateGlobalData } = usePageState();

    const formatForApi = useCallback((d: Date | null, allDay: boolean): string | undefined => {
        if (!d) return undefined;
        return allDay
            ? formatDateFnsOriginal(startOfDay(d), 'yyyy-MM-dd')
            : formatDateFnsOriginal(d, "yyyy-MM-dd'T'HH:mm:ssXXX");
    }, []);

    // ────────────────────────────────────────────────────────────────────────
    // Event/Task/Project 保存 (新規/更新)
    // ────────────────────────────────────────────────────────────────────────
    const handleSaveEvent = useCallback(async (
        modalData: Partial<BackendEvent & {
            display_status?: 'online' | 'offline' | 'archived' | string | null;
            phaseTargetTaskId?: string;
            date?: string;
        }>
    ) => {
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

        const modalId = modalData.id;
        const editingEventId = modalEventToEdit?.id;
        const eventId = modalId ? String(modalId) : editingEventId;

        try {
            let response;
            const numericIdForApi = eventId ? eventId.replace(/^(proj-|task-|event-)/, '') : null;
            const typeForSave = modalData.type || modalEventToEdit?.extendedProps?.type || 'Generic';
            const normalizedType = typeForSave.charAt(0).toUpperCase() + typeForSave.slice(1).toLowerCase();

            if (numericIdForApi) {
                // 更新処理 (PUT)
                if (normalizedType === 'Task') {
                    const md = modalData as any;
                    let assignedToValue: number | undefined = undefined;
                    if (md.assigned_to !== null && md.assigned_to !== undefined) {
                        assignedToValue = typeof md.assigned_to === 'number' ? md.assigned_to : parseInt(String(md.assigned_to), 10);
                    } else if (md.taskAssigneeId) {
                        const match = String(md.taskAssigneeId).match(/^(user|group)-(\d+)$/);
                        if (match) assignedToValue = parseInt(match[2], 10);
                    }

                    let dueDateValue: string | undefined = undefined;
                    if (md.due_date) {
                        dueDateValue = String(md.due_date).includes('T') ? md.due_date : `${md.due_date}T00:00:00+09:00`;
                    } else if (md.taskDueDate) {
                        dueDateValue = /^\d{4}-\d{2}-\d{2}$/.test(md.taskDueDate) ? `${md.taskDueDate}T00:00:00+09:00` : md.taskDueDate;
                    }

                    let priorityValue: string | undefined = undefined;
                    if (md.priority) {
                        const p = String(md.priority).toUpperCase();
                        if (['LOW', 'MEDIUM', 'HIGH'].includes(p)) priorityValue = p;
                    }

                    const seqIDValue = md.seqID?.trim() || undefined;
                    const shotIDValue = md.shotID?.trim() || undefined;

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
                        type: md.taskType?.trim() || undefined,
                        seqID: seqIDValue,
                        shotID: shotIDValue,
                        phases: md.phases !== null ? md.phases : undefined,
                    };
                    response = await api.put(`/tasks/${numericIdForApi}`, taskData);
                } else if (normalizedType === 'Project') {
                    const md = modalData as any;
                    const projectData = {
                        name: md.title,
                        description: md.description || md.projectDescription || '',
                        status: md.status || md.projectStatus || 'planning',
                        start_date: md.start_time ?? md.projectStartDate,
                        end_date: md.end_time ?? md.projectEndDate,
                        display_status: md.display_status,
                        color: md.color,
                    };
                    response = await api.put(`/projects/${numericIdForApi}`, projectData);
                } else {
                    response = await api.put(`/calendar/events/${numericIdForApi}`, apiData);
                }
            } else {
                // 新規作成処理 (POST)
                if (normalizedType === 'Task') {
                    const md = modalData as any;
                    let assignedToValue: number | undefined = undefined;
                    if (md.assigned_to !== null && md.assigned_to !== undefined) {
                        assignedToValue = typeof md.assigned_to === 'number' ? md.assigned_to : parseInt(String(md.assigned_to), 10);
                    } else if (md.taskAssigneeId) {
                        const match = String(md.taskAssigneeId).match(/^(user|group)-(\d+)$/);
                        if (match) assignedToValue = parseInt(match[2], 10);
                    }

                    let dueDateValue: string | undefined = undefined;
                    if (md.due_date) {
                        dueDateValue = String(md.due_date).includes('T') ? md.due_date : `${md.due_date}T00:00:00+09:00`;
                    } else if (md.taskDueDate) {
                        dueDateValue = /^\d{4}-\d{2}-\d{2}$/.test(md.taskDueDate) ? `${md.taskDueDate}T00:00:00+09:00` : md.taskDueDate;
                    }

                    let priorityValue: string | undefined = undefined;
                    if (md.priority) {
                        const p = String(md.priority).toUpperCase();
                        if (['LOW', 'MEDIUM', 'HIGH'].includes(p)) priorityValue = p;
                    }

                    const seqIDValue = md.seqID?.trim() || undefined;
                    const shotIDValue = md.shotID?.trim() || undefined;

                    const taskData = {
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
                        type: md.taskType?.trim() || undefined,
                        seqID: seqIDValue,
                        shotID: shotIDValue,
                        phases: md.phases !== null ? md.phases : undefined,
                    };
                    response = await api.post('/tasks', taskData);
                } else if (normalizedType === 'Phase') {
                    const md = modalData as any;
                    const targetTaskId = md.phaseTargetTaskId;
                    if (!targetTaskId) throw new Error("Target task for phase not selected");

                    const targetTask = tasks.find(t => String(t.id) === String(targetTaskId));
                    if (!targetTask) throw new Error("Target task not found locally. Please refresh.");

                    const newPhase = {
                        name: md.title,
                        date: md.date,
                        is_completed: false
                    };
                    const updatedPhases = [...(targetTask.phases || []), newPhase];
                    response = await api.put(`/tasks/${targetTaskId}`, { phases: updatedPhases });
                } else if (normalizedType === 'Project') {
                    const md = modalData as any;
                    const projectData = {
                        name: md.title,
                        description: md.description || md.projectDescription || '',
                        status: md.status || md.projectStatus || 'planning',
                        start_date: md.projectStartDate || md.start_time,
                        end_date: md.projectEndDate || md.end_time,
                        display_status: md.display_status || 'online',
                        color: md.color,
                    };
                    response = await api.post('/projects', projectData);
                } else {
                    response = await api.post('/calendar/events', apiData);
                }
            }

            console.log("Save success:", response?.data);
            setIsAddModalOpen(false);
            setSelectedEventId(null);
            if (refreshGlobalData) await refreshGlobalData();
            refetch();
        } catch (err: any) {
            console.error("Failed to save event:", err);
            let errorMessage = 'Unknown error';
            if (err.response?.data?.detail) {
                const detail = err.response.data.detail;
                errorMessage = Array.isArray(detail)
                    ? detail.map((e: any) => `${e.loc?.join('.') || 'unknown'}: ${e.msg}`).join('\n')
                    : String(detail);
            } else if (err.message) {
                errorMessage = err.message;
            }
            setError(`イベントの保存に失敗しました: ${errorMessage}`);
        } finally {
            setLoading(false);
        }
    }, [modalEventToEdit, tasks, refetch, refreshGlobalData, setError, setIsAddModalOpen, setLoading, setSelectedEventId]);

    // ────────────────────────────────────────────────────────────────────────
    // Event/Task/Project 削除
    // ────────────────────────────────────────────────────────────────────────
    const handleDeleteEvent = useCallback(async (event: CalendarEvent) => {
        if (event.extendedProps?.isPhase) {
            if (!event.extendedProps?.taskId) return;
            try {
                const taskId = event.extendedProps.taskId;
                const phaseIndex = Number(event.id.split('-').pop());
                const task = tasks.find(t => t.id === Number(taskId));
                if (!task) return;

                const currentPhases = task.phases || [];
                if (phaseIndex >= 0 && phaseIndex < currentPhases.length) {
                    const updatedPhases = currentPhases.filter((_, index) => index !== phaseIndex);
                    await api.put(`/tasks/${taskId}`, { phases: updatedPhases });
                    setSelectedEventId(null);
                    refetch();
                }
            } catch (error) {
                alert("Phaseの削除に失敗しました。");
            }
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const numericIdMatch = event.id.match(/\d+$/);
            if (!numericIdMatch) {
                setError("無効なイベントIDのため削除できませんでした。");
                return;
            }
            const numericId = numericIdMatch[0];
            const type = String(event.extendedProps.type).toLowerCase();

            if (type === 'task') {
                await api.delete(`/tasks/${numericId}`);
            } else if (type === 'project') {
                await api.delete(`/projects/${numericId}`);
            } else {
                await api.delete(`/calendar/events/${numericId}`);
            }

            setSelectedEventId(null);
            if (refreshGlobalData) await refreshGlobalData();
            refetch();
        } catch (err) {
            setError("イベントの削除に失敗しました。");
        } finally {
            setLoading(false);
        }
    }, [tasks, refetch, refreshGlobalData, setError, setLoading, setSelectedEventId]);

    // ────────────────────────────────────────────────────────────────────────
    // Phase 単体保存
    // ────────────────────────────────────────────────────────────────────────
    const handleSavePhase = useCallback(async (phaseUpdateData: any) => {
        try {
            const taskId = phaseUpdateData.taskId;
            const task = tasks.find(t => t.id === Number(taskId));
            if (!task) return;

            const currentPhases = task.phases || [];
            if (phaseUpdateData.phaseIndex >= 0 && phaseUpdateData.phaseIndex < currentPhases.length) {
                const updatedPhases = [...currentPhases];
                updatedPhases[phaseUpdateData.phaseIndex] = {
                    ...updatedPhases[phaseUpdateData.phaseIndex],
                    name: phaseUpdateData.newName,
                    date: phaseUpdateData.newDate,
                    is_completed: phaseUpdateData.isCompleted
                };

                await api.put(`/tasks/${taskId}`, { phases: updatedPhases });
                setIsPhaseEditModalOpen(false);
                refetch();
            }
        } catch (error) {
            alert("Phaseの保存に失敗しました。");
        }
    }, [tasks, refetch, setIsPhaseEditModalOpen]);

    // ────────────────────────────────────────────────────────────────────────
    // タスクのみの更新 (チェックリスト・成果物など)
    // ────────────────────────────────────────────────────────────────────────
    const handleUpdateTask = useCallback(async (taskId: number, updates: any) => {
        // Optimistic update: instantly refresh tasks inside globalData to make calendar cards update immediately
        if (globalData && updateGlobalData) {
            const updatedTasks = globalData.tasks.map(t => {
                if (t.id === taskId) {
                    const taskUpdate: any = {};
                    if (updates.name !== undefined) taskUpdate.name = updates.name;
                    if (updates.description !== undefined) taskUpdate.description = updates.description;
                    if (updates.status !== undefined) taskUpdate.status = updates.status;
                    if (updates.due_date !== undefined) taskUpdate.due_date = updates.due_date;
                    if (updates.project_id !== undefined) taskUpdate.project_id = updates.project_id;
                    if (updates.assigned_to !== undefined) taskUpdate.assigned_to = updates.assigned_to;
                    if (updates.cost !== undefined) taskUpdate.cost = updates.cost;
                    if (updates.dependsOn !== undefined) taskUpdate.dependsOn = updates.dependsOn;
                    if (updates.start_date !== undefined) taskUpdate.start_date = updates.start_date;
                    if (updates.priority !== undefined) taskUpdate.priority = updates.priority;
                    if (updates.type !== undefined) taskUpdate.type = updates.type;
                    if (updates.seqID !== undefined) taskUpdate.seqID = updates.seqID;
                    if (updates.shotID !== undefined) taskUpdate.shotID = updates.shotID;
                    if (updates.phases !== undefined) taskUpdate.phases = updates.phases;
                    if (updates.deliverables !== undefined) taskUpdate.deliverables = updates.deliverables;
                    if (updates.check_items !== undefined) taskUpdate.check_items = updates.check_items;
                    return { ...t, ...taskUpdate };
                }
                return t;
            });
            updateGlobalData({ tasks: updatedTasks });
        }

        try {
            await api.put(`/tasks/${taskId}`, updates);
            if (refreshGlobalData) await refreshGlobalData({ force: true });
            refetch();
        } catch (error) {
            alert("タスクの更新に失敗しました。");
            refetch(); // Revert state from backend if it failed
        }
    }, [globalData, updateGlobalData, refreshGlobalData, refetch]);

    // 非タスクイベントの一括更新 (保存ボタン方式)
    // ────────────────────────────────────────────────────────────────────────
    const handleUpdateEvent = useCallback(async (eventId: number, updates: any, eventType?: string) => {
        try {
            if (eventType === 'project') {
                const startDate = updates.start_time ? updates.start_time.slice(0, 10) : undefined;
                const endDate   = updates.end_time   ? updates.end_time.slice(0, 10)   : undefined;
                await api.put(`/projects/${eventId}`, {
                    name:        updates.title ?? undefined,
                    description: updates.description ?? undefined,
                    start_date:  startDate ? `${startDate}T00:00:00+09:00` : undefined,
                    end_date:    endDate   ? `${endDate}T00:00:00+09:00`   : undefined,
                });
            } else if (eventType === 'group') {
                const startDate = updates.start_time ? updates.start_time.slice(0, 10) : undefined;
                const endDate   = updates.end_time   ? updates.end_time.slice(0, 10)   : undefined;
                await api.put(`/api/groups/${eventId}`, {
                    start_date: startDate ? `${startDate}T00:00:00+09:00` : undefined,
                    end_date:   endDate   ? `${endDate}T00:00:00+09:00`   : undefined,
                });
            } else {
                await api.put(`/calendar/events/${eventId}`, updates);
            }
            refetch();
        } catch (error) {
            alert("イベントの更新に失敗しました。");
        }
    }, [refetch]);

    // ────────────────────────────────────────────────────────────────────────
    // Phase 削除 (フェーズ詳細モーダルから)
    // ────────────────────────────────────────────────────────────────────────
    const handleDeletePhase = useCallback(async () => {
        if (!modalEventToEdit || !modalEventToEdit.extendedProps?.taskId) return;
        try {
            const taskId = modalEventToEdit.extendedProps.taskId;
            const phaseIndex = Number(modalEventToEdit.id.split('-').pop());
            const task = tasks.find(t => t.id === Number(taskId));
            if (!task) return;

            const currentPhases = task.phases || [];
            if (phaseIndex >= 0 && phaseIndex < currentPhases.length) {
                const updatedPhases = currentPhases.filter((_, index) => index !== phaseIndex);
                await api.put(`/tasks/${taskId}`, { phases: updatedPhases });
                setIsPhaseEditModalOpen(false);
                setModalEventToEdit(null);
                setSelectedEventId(null);
                refetch();
            }
        } catch (error) {
            alert("Phaseの削除に失敗しました。");
        }
    }, [modalEventToEdit, tasks, refetch, setIsPhaseEditModalOpen, setModalEventToEdit, setSelectedEventId]);

    // ────────────────────────────────────────────────────────────────────────
    // ドラッグ＆ドロップ (FullCalendar Drop)
    // ────────────────────────────────────────────────────────────────────────
    const handleEventDrop = useCallback(async (arg: any) => {
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
                const match = idStr.match(/^task-(\d+)-phase-(\d+)$/);
                if (!match) { arg.revert(); return; }
                const tId = parseInt(match[1], 10);
                const pIndex = parseInt(match[2], 10);

                const newDate = formatForApi(start, true);
                if (!newDate) { arg.revert(); return; }

                const task = tasks.find(t => t.id === tId);
                if (!task || !task.phases) { arg.revert(); return; }

                const updatedPhases = [...task.phases];
                if (pIndex >= 0 && pIndex < updatedPhases.length) {
                    updatedPhases[pIndex] = { ...updatedPhases[pIndex], date: newDate };
                    await api.put(`/tasks/${tId}`, { phases: updatedPhases });
                } else {
                    arg.revert();
                    return;
                }
            } else if (type === 'task') {
                const dueDate = formatForApi(start, true);
                if (!dueDate) { arg.revert(); return; }
                await api.put(`/tasks/${numericId}`, { due_date: `${dueDate}T00:00:00+09:00` });
            } else if (type === 'project' || idStr.startsWith('proj-')) {
                const startDate = formatForApi(start, true);
                const endDate = end && allDay ? formatForApi(addDays(end, -1), true) : formatForApi(end, true);
                if (!startDate) { arg.revert(); return; }
                await api.put(`/projects/${numericId}`, {
                    start_date: `${startDate}T00:00:00+09:00`,
                    end_date: endDate ? `${endDate}T00:00:00+09:00` : undefined,
                });
            } else if (type === 'group' || idStr.startsWith('group-')) {
                const startDate = formatForApi(start, true);
                const endDate = end && allDay ? formatForApi(addDays(end, -1), true) : formatForApi(end, true);
                if (!startDate) { arg.revert(); return; }
                await api.put(`/api/groups/${numericId}`, {
                    start_date: `${startDate}T00:00:00+09:00`,
                    end_date: endDate ? `${endDate}T00:00:00+09:00` : undefined,
                });
            } else {
                const startTime = formatForApi(start, allDay);
                const endTime = formatForApi(end ?? start, allDay);
                if (!startTime || !endTime) { arg.revert(); return; }
                await api.put(`/calendar/events/${numericId}`, {
                    start_time: allDay ? `${startTime}T00:00:00+09:00` : startTime,
                    end_time: allDay ? `${endTime}T00:00:00+09:00` : endTime,
                });
            }

            if (refreshGlobalData) await refreshGlobalData();
            refetch();
        } catch (err) {
            console.error('Event drop update failed:', err);
            arg.revert();
        }
    }, [tasks, refetch, refreshGlobalData, formatForApi]);

    // ────────────────────────────────────────────────────────────────────────
    // イベントリサイズ (FullCalendar Resize)
    // ────────────────────────────────────────────────────────────────────────
    const handleEventResize = useCallback(async (arg: any) => {
        const ev = arg.event;
        const idStr = ev.id;
        const numericMatch = idStr.match(/\d+$/);
        if (!numericMatch) { arg.revert(); return; }
        const numericId = numericMatch[0];
        const start = ev.start ? new Date(ev.start) : null;
        const end = ev.end ? new Date(ev.end) : null;
        const allDay = ev.allDay ?? false;
        const type = (ev.extendedProps?.type as string)?.toLowerCase?.();

        if (type === 'task') { arg.revert(); return; }

        try {
            if (type === 'project' || idStr.startsWith('proj-')) {
                const startDate = formatForApi(start, true);
                const endDate = end && allDay ? formatForApi(addDays(end, -1), true) : formatForApi(end, true);
                if (!startDate) { arg.revert(); return; }
                await api.put(`/projects/${numericId}`, {
                    start_date: `${startDate}T00:00:00+09:00`,
                    end_date: endDate ? `${endDate}T00:00:00+09:00` : undefined,
                });
            } else if (type === 'group' || idStr.startsWith('group-')) {
                const startDate = formatForApi(start, true);
                const endDate = end && allDay ? formatForApi(addDays(end, -1), true) : formatForApi(end, true);
                if (!startDate) { arg.revert(); return; }
                await api.put(`/api/groups/${numericId}`, {
                    start_date: `${startDate}T00:00:00+09:00`,
                    end_date: endDate ? `${endDate}T00:00:00+09:00` : undefined,
                });
            } else {
                const startTime = formatForApi(start, allDay);
                const endTime = formatForApi(end ?? start, allDay);
                if (!startTime || !endTime) { arg.revert(); return; }
                await api.put(`/calendar/events/${numericId}`, {
                    start_time: allDay ? `${startTime}T00:00:00+09:00` : startTime,
                    end_time: allDay ? `${endTime}T00:00:00+09:00` : endTime,
                });
            }
            if (refreshGlobalData) await refreshGlobalData();
            refetch();
        } catch (err) {
            console.error('Event resize update failed:', err);
            arg.revert();
        }
    }, [refetch, refreshGlobalData, formatForApi]);

    // ────────────────────────────────────────────────────────────────────────
    // タスク複製
    // ────────────────────────────────────────────────────────────────────────
    const handleDuplicateTask = useCallback(async (taskId: number) => {
        setLoading(true);
        setError(null);
        try {
            const task = tasks.find(t => t.id === taskId);
            if (!task) {
                setError("複製対象のタスクが見つかりませんでした。");
                return;
            }

            const duplicatedTaskData = {
                name: `${task.name} のコピー`,
                description: task.description || '',
                status: task.status || 'todo',
                due_date: task.due_date,
                project_id: task.project_id,
                assigned_to: task.assigned_to,
                cost: task.cost,
                dependsOn: task.dependsOn || [],
                start_date: task.start_date,
                priority: task.priority,
                type: task.type,
                seqID: task.seqID,
                shotID: task.shotID,
                phases: task.phases,
                deliverables: (task as any).deliverables,
                check_items: (task as any).check_items,
            };

            const response = await api.post('/tasks', duplicatedTaskData);
            console.log("Duplicate success:", response.data);

            if (refreshGlobalData) await refreshGlobalData();
            refetch();
        } catch (err: any) {
            console.error("Failed to duplicate task:", err);
            setError("タスクの複製に失敗しました。");
        } finally {
            setLoading(false);
        }
    }, [tasks, refetch, refreshGlobalData, setError, setLoading]);

    // ────────────────────────────────────────────────────────────────────────
    // イベント複製
    // ────────────────────────────────────────────────────────────────────────
    const handleDuplicateEvent = useCallback(async (eventId: number) => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.get<BackendEvent>(`/calendar/events/${eventId}`);
            const event = res.data;
            if (!event) {
                setError("複製対象のイベントが見つかりませんでした。");
                return;
            }

            const duplicatedEventData = {
                title: `${event.title} のコピー`,
                description: event.description || '',
                type: event.type || 'Generic',
                location: event.location || '',
                allDay: event.allDay ?? false,
                start_time: event.start_time,
                end_time: event.end_time,
                status: event.status || 'offline',
                project_id: event.project_id,
                participants: event.participants || [],
                user_ids: event.user_ids || [],
            };

            const response = await api.post('/calendar/events', duplicatedEventData);
            console.log("Duplicate event success:", response.data);

            if (refreshGlobalData) await refreshGlobalData();
            refetch();
        } catch (err: any) {
            console.error("Failed to duplicate event:", err);
            setError("イベントの複製に失敗しました。");
        } finally {
            setLoading(false);
        }
    }, [refetch, refreshGlobalData, setError, setLoading]);

    return {
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
    };
};
