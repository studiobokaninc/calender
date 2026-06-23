/**
 * カレンダーページのデータ取得・変換ロジックを分離したカスタムフック
 * CalendarPage.tsx の fetchData・globalData 監視・バックエンドイベント取得を統合管理する
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../services/api';
import { Project, Task, BackendEvent, CalendarEvent, User, Group } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useCalendarPageState, usePageState } from '../contexts/PageStateContext';
import {
    sortEventsForDisplay,
    taskToCalendarEvents,
    projectToCalendarEvent,
    groupToCalendarEvent,
    backendEventToCalendarEvent,
} from '../utils/calendarEventMapper';

interface UseCalendarDataReturn {
    rawEvents: CalendarEvent[];
    projects: Project[];
    tasks: Task[];
    users: User[];
    groups: Group[];
    loading: boolean;
    error: string | null;
    backendEvents: CalendarEvent[];
    scoreSummary: { shots: number; retakes: number; troubles: number } | null;
    refetch: () => void;
}

export const useCalendarData = (
    eventStatusFilter: string,
    viewRange?: { start: Date; end: Date } | null
): UseCalendarDataReturn => {
    const { user } = useAuth();
    const { globalData, updateGlobalData, isInitialLoad } = useCalendarPageState();
    const { refreshGlobalData } = usePageState();

    const [rawEvents, setRawEvents] = useState<CalendarEvent[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [backendEvents, setBackendEvents] = useState<CalendarEvent[]>([]);
    const [scoreSummary, setScoreSummary] = useState<{ shots: number; retakes: number; troubles: number } | null>(null);

    const isAdmin = user?.role === 'admin';

    // fetchData直後のglobalData useEffectで /calendar/events が再フェッチされるのを防ぐフラグ
    const didFetchRef = useRef(false);

    // ────────────────────────────────────────────────────────────────────────
    // 一般ユーザー向けフィルタリング
    // ────────────────────────────────────────────────────────────────────────
    const filterForNonAdmin = useCallback((rawTasks: Task[], rawProjects: Project[]) => {
        if (isAdmin) return { tasks: rawTasks, projects: rawProjects };
        if (!user) return { tasks: [], projects: [] };
        const myTasks = rawTasks.filter(t => String(t.assigned_to) === String(user.id));
        const myProjectIds = new Set(myTasks.map(t => t.project_id).filter(Boolean));
        return {
            tasks: myTasks,
            projects: rawProjects.filter(p => myProjectIds.has(p.id)),
        };
    }, [isAdmin, user]);

    // ────────────────────────────────────────────────────────────────────────
    // バックエンドイベント取得（カレンダーイベント専用）
    // ────────────────────────────────────────────────────────────────────────
    const fetchBackendEvents = useCallback(async (currentProjects: Project[], range?: { start: Date; end: Date } | null) => {
        try {
            const params: Record<string, string> = {};
            if (range) {
                params.start_date = range.start.toISOString();
                params.end_date = range.end.toISOString();
            }
            const res = await api.get<BackendEvent[]>('/calendar/events', { params });
            const processed = res.data
                .map(be => backendEventToCalendarEvent(be, { user: user as any, projects: currentProjects }))
                .filter((e): e is CalendarEvent => e !== null);
            setBackendEvents(processed);
        } catch {
            // バックエンドイベント取得失敗は致命的でないのでサイレントに
        }
    }, [user]);

    // ────────────────────────────────────────────────────────────────────────
    // 全データフェッチ（初回・強制リフレッシュ用）
    // ────────────────────────────────────────────────────────────────────────
    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const eventParams: Record<string, string> = {};
            if (viewRange) {
                eventParams.start_date = viewRange.start.toISOString();
                eventParams.end_date = viewRange.end.toISOString();
            }
            const [projRes, taskRes, eventsRes, userRes, groupRes, scoreRes] = await Promise.all([
                api.get<Project[]>('/projects'),
                api.get<Task[]>('/tasks', { params: { include_history: false } }),
                api.get<BackendEvent[]>('/calendar/events', { params: eventParams }),
                api.get<User[]>('/api/users'),
                api.get<Group[]>('/api/groups'),
                eventStatusFilter !== 'all'
                    ? api.get(`/api/projects/${eventStatusFilter}/production-tracker`).catch(() => ({ data: { sequences: [] } }))
                    : Promise.resolve({ data: null }),
            ]);

            let projectsData = projRes.data;
            let tasksData = taskRes.data;
            const usersData = userRes.data;
            const groupsData = groupRes.data;

            // Score サマリー計算
            if (eventStatusFilter !== 'all' && (scoreRes as any).data) {
                const d = (scoreRes as any).data;
                let shots = 0, retakes = 0, troubles = 0;
                d.sequences?.forEach((seq: any) => {
                    seq.shots?.forEach((shot: any) => { shots++; retakes += shot.retakes_count || 0; troubles += shot.troubles_count || 0; });
                });
                setScoreSummary({ shots, retakes, troubles });
            } else {
                setScoreSummary(null);
            }

            // 一般ユーザーフィルタリング
            const { tasks: filteredTasks, projects: filteredProjects } = filterForNonAdmin(tasksData, projectsData);
            projectsData = filteredProjects;
            tasksData = filteredTasks;

            setProjects(projectsData);
            setTasks(tasksData);
            setUsers(usersData);
            setGroups(groupsData);

            // グローバルキャッシュ更新（didFetchRefでglobalData useEffectの二重フェッチをスキップ）
            didFetchRef.current = true;
            updateGlobalData?.({ tasks: tasksData, projects: projectsData, users: usersData, groups: groupsData });

            // Promise.all で取得済みのイベントデータを直接処理（ウォーターフォール解消）
            const processed = eventsRes.data
                .map(be => backendEventToCalendarEvent(be, { user: user as any, projects: projectsData }))
                .filter((e): e is CalendarEvent => e !== null);
            setBackendEvents(processed);
        } catch (err) {
            setError('カレンダーデータの取得または処理に失敗しました。');
        } finally {
            setLoading(false);
        }
    }, [eventStatusFilter, filterForNonAdmin, updateGlobalData, fetchBackendEvents, viewRange]);

    // ────────────────────────────────────────────────────────────────────────
    // globalData 監視（ページ切り替え後にキャッシュから即時反映）
    // ────────────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!globalData) return;
        const rawTasks = globalData.tasks || [];
        const rawProjects = globalData.projects || [];
        if (rawTasks.length === 0 && rawProjects.length === 0) return;

        const { tasks: ft, projects: fp } = filterForNonAdmin(rawTasks, rawProjects);
        if (rawTasks.length > 0) setTasks(ft);
        if (rawProjects.length > 0) {
            setProjects(fp);
            if (didFetchRef.current) {
                // fetchData直後のglobalData反映トリガー: /calendar/eventsは既取得済みのためスキップ
                didFetchRef.current = false;
            } else {
                fetchBackendEvents(fp, viewRange);
            }
        }
        if (globalData.users?.length > 0) setUsers(globalData.users);
        if (globalData.groups?.length > 0) setGroups(globalData.groups);
    }, [globalData?.tasks, globalData?.projects, globalData?.users, globalData?.groups, globalData?.lastFetched, filterForNonAdmin, fetchBackendEvents]);

    // ────────────────────────────────────────────────────────────────────────
    // イベントバス監視（CSV インポート・プロジェクト更新・グローバルリフレッシュ）
    // ────────────────────────────────────────────────────────────────────────
    useEffect(() => {
        const onGlobalRefresh = (e: CustomEvent) => {
            const { tasks: rawT, projects: rawP, users: u, groups: g } = e.detail;
            const { tasks: ft, projects: fp } = filterForNonAdmin(rawT || [], rawP || []);
            setTasks(ft); setProjects(fp); setUsers(u || []); setGroups(g || []);
        };
        const onCsvImport = async () => { await refreshGlobalData?.(); };
        const onProjectChange = async () => { await refreshGlobalData?.(); };

        window.addEventListener('globalDataRefreshed', onGlobalRefresh as EventListener);
        window.addEventListener('csvImportCompleted', onCsvImport as EventListener);
        window.addEventListener('projectDeleted', onProjectChange as EventListener);
        window.addEventListener('projectUpdated', onProjectChange as EventListener);
        window.addEventListener('projectStatusUpdated', onProjectChange as EventListener);

        return () => {
            window.removeEventListener('globalDataRefreshed', onGlobalRefresh as EventListener);
            window.removeEventListener('csvImportCompleted', onCsvImport as EventListener);
            window.removeEventListener('projectDeleted', onProjectChange as EventListener);
            window.removeEventListener('projectUpdated', onProjectChange as EventListener);
            window.removeEventListener('projectStatusUpdated', onProjectChange as EventListener);
        };
    }, [refreshGlobalData, filterForNonAdmin]);

    // ────────────────────────────────────────────────────────────────────────
    // 初回ロード
    // ────────────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (globalData?.tasks?.length > 0 && globalData?.projects?.length > 0) {
            setLoading(false);
            refreshGlobalData?.();
            return;
        }
        fetchData();
    }, [isInitialLoad, fetchData]); // eslint-disable-line react-hooks/exhaustive-deps

    // ────────────────────────────────────────────────────────────────────────
    // rawEvents 生成（tasks / projects / groups / backendEvents の変化で再構築）
    // ────────────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (loading) return;

        const taskEvents = tasks.flatMap(task =>
            taskToCalendarEvents(task, projects.find(p => p.id === task.project_id), isAdmin)
        );
        const projectEvents = projects
            .map(p => projectToCalendarEvent(p, isAdmin))
            .filter((e): e is CalendarEvent => e !== null);
        const groupEvents = groups
            .map(g => groupToCalendarEvent(g, isAdmin))
            .filter((e): e is CalendarEvent => e !== null);

        setRawEvents(sortEventsForDisplay([...projectEvents, ...taskEvents, ...groupEvents, ...backendEvents]));
    }, [tasks, projects, groups, backendEvents, loading, isAdmin]);

    return {
        rawEvents, projects, tasks, users, groups,
        loading, error, backendEvents, scoreSummary,
        refetch: fetchData,
    };
};
