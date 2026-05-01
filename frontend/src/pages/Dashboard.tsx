import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Paper,
  Typography,
  CircularProgress,
  IconButton,
  Checkbox,
  Drawer,
  Divider,
  Button,
  Tooltip,
} from '@mui/material'
import {
  People as PeopleIcon,
  Task as TaskIcon,
  Folder as ProjectIcon,
  CalendarToday as CalendarTodayIcon,
  Event as EventIcon,
  Close as CloseIcon,
  Edit as EditIcon,
} from '@mui/icons-material'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import api from '../services/api'
import { DashboardMetrics, BackendEvent, Task } from '../types'
import { usePageState } from '../contexts/PageStateContext'
import { useAuth } from '../contexts/AuthContext'
import { TaskEditDialog, EventEditDialog } from '../components/SearchEditDialogs'
import { TaskQuickDetail } from '../components/TaskQuickDetail'

const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [backendEvents, setBackendEvents] = useState<BackendEvent[]>([])
  const [eventsLoaded, setEventsLoaded] = useState(false)
  const [isSystemBusy, setIsSystemBusy] = useState(false)

  // 編集ダイアログ用
  const [editTaskId, setEditTaskId] = useState<number | null>(null);
  const [editEventId, setEditEventId] = useState<number | null>(null);

  // 詳細パネル用
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<Task | null>(null);
  const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false);
  const [selectedEventDetail, setSelectedEventDetail] = useState<BackendEvent | null>(null);
  const [isEventDetailOpen, setIsEventDetailOpen] = useState(false);

  const { refreshGlobalData, globalData } = usePageState();

  const handleUpdateTaskQuick = async (taskId: number, updates: any) => {
    try {
      await api.put(`/tasks/${taskId}`, updates);
      refreshGlobalData?.();
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  };

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const response = await api.get('/metrics/dashboard')
        setMetrics(response.data)
      } catch (err) {
        setError('メトリクスの取得に失敗しました')
      } finally {
        setLoading(false)
      }
    }
    fetchMetrics()
  }, [])

  useEffect(() => {
    refreshGlobalData?.()
  }, [refreshGlobalData])

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await api.get('/chat/status')
        setIsSystemBusy(!!res.data.is_processing)
      } catch (err) {
        console.error('Failed to fetch chat status:', err)
      }
    }
    checkStatus()
    const interval = setInterval(checkStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  const fetchEvents = useCallback(async () => {
    try {
      const res = await api.get<BackendEvent[]>('/calendar/events')
      setBackendEvents(res.data ?? [])
    } catch {
      setBackendEvents([])
    } finally {
      setEventsLoaded(true)
    }
  }, [])

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  const todayStr = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  const eventTypeToLabel: Record<string, string> = {
    Meeting: '会議',
    Deadline: '締切',
    Milestone: 'マイルストーン',
    Workshop: 'ワークショップ',
    Generic: 'イベント',
    Task: 'タスク',
  }

  const todayItems = useMemo(() => {
    const projects = globalData?.projects ?? []
    const users = globalData?.users ?? []
    const getProjectName = (projectId: number | null | undefined): string => {
      if (projectId == null) return '（プロジェクトなし）'
      const p = projects.find((x: any) => x.id === projectId)
      return p?.name ?? `ID:${projectId}`
    }
    const getAssigneeName = (userId: number | null | undefined): string => {
      if (userId == null) return ''
      const u = users.find((x: any) => x.id === userId)
      return u?.username || u?.full_name || u?.name || u?.email || `User ${userId}`
    }

    type TodayItem = { type: 'event' | 'task'; name: string; projectName: string; assigneeName?: string; id: string | number; timeLabel?: string; kindLabel: string; startTime?: string; isPhase?: boolean; rawId: number; phaseIdx?: number; }
    const eventList: TodayItem[] = []

    backendEvents.forEach((ev: BackendEvent) => {
      const p = projects.find((x: any) => x.id === ev.project_id);
      if (p && (p.status === 'completed' || p.status === 'cancelled')) return;

      let startDate = '';
      if (ev.start_time) {
        const d = new Date(ev.start_time);
        if (!isNaN(d.getTime())) {
          startDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
      }

      let endDate = startDate;
      if (ev.end_time) {
        const d = new Date(ev.end_time);
        if (!isNaN(d.getTime())) {
          const isMidnight = d.getHours() === 0 && d.getMinutes() === 0;
          if (isMidnight || ev.allDay) {
            d.setDate(d.getDate() - 1);
          }
          endDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          if (endDate < startDate) endDate = startDate;
        }
      }

      if (!startDate) return;
      if (todayStr >= startDate && todayStr <= endDate) {
        const evType = (ev.type ?? 'Generic').toString()
        eventList.push({
          type: 'event',
          id: String(ev.id),
          name: ev.title ?? `イベント #${ev.id}`,
          projectName: getProjectName(ev.project_id ?? undefined),
          timeLabel: ev.allDay ? '終日' : (ev.start_time ? new Date(ev.start_time).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : ''),
          kindLabel: eventTypeToLabel[evType] ?? evType,
          startTime: ev.start_time ?? '',
          isPhase: false,
          rawId: ev.id,
        })
      }
    });

    const tasks = globalData?.tasks ?? [];
    const completedStatuses = ['completed', 'COMPLETED', 'cancelled', 'CANCELLED'];

    tasks.forEach((t: any) => {
      const isTaskCompleted = completedStatuses.includes(String(t.status ?? ''));
      if (!isTaskCompleted && t.due_date) {
        const due = new Date(t.due_date);
        const dueStr = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
        if (dueStr === todayStr) {
          eventList.push({
            type: 'task',
            id: String(t.id),
            name: t.name,
            projectName: getProjectName(t.project_id ?? null),
            assigneeName: getAssigneeName(t.assigned_to ?? null),
            timeLabel: '締切',
            kindLabel: 'タスク',
            startTime: t.due_date,
            isPhase: false,
            rawId: t.id,
          });
        }
      }
      if (!isTaskCompleted && t.phases && Array.isArray(t.phases)) {
        t.phases.forEach((p: any, idx: number) => {
          if (p.is_completed) return;
          if (!p.date) return;
          const pDate = new Date(p.date);
          const pDateStr = `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, '0')}-${String(pDate.getDate()).padStart(2, '0')}`;
          if (pDateStr === todayStr) {
            eventList.push({
              type: 'task',
              id: `phase-${t.id}-${idx}`,
              name: `${t.name}: ${p.name}`,
              projectName: getProjectName(t.project_id ?? null),
              assigneeName: getAssigneeName(t.assigned_to ?? null),
              timeLabel: '目標日',
              kindLabel: '段階目標',
              startTime: p.date,
              isPhase: true,
              rawId: t.id,
              phaseIdx: idx
            });
          }
        });
      }
    });

    eventList.sort((a, b) => {
      if (a.timeLabel === '終日' && b.timeLabel !== '終日') return -1;
      if (a.timeLabel !== '終日' && b.timeLabel === '終日') return 1;
      return (a.startTime ?? '').localeCompare(b.startTime ?? '');
    });
    return eventList
  }, [globalData?.projects, globalData?.tasks, todayStr, backendEvents])

  const weekDeadlineTasks = useMemo(() => {
    const tasks = globalData?.tasks ?? []
    const projects = globalData?.projects ?? []
    const users = globalData?.users ?? []
    const getProjectName = (projectId: number | null | undefined): string => {
      if (projectId == null) return '（プロジェクトなし）'
      const p = projects.find((x: any) => x.id === projectId)
      return p?.name ?? `ID:${projectId}`
    }
    const getAssigneeName = (userId: number | null | undefined): string => {
      if (userId == null) return ''
      const u = users.find((x: any) => x.id === userId)
      return u?.username || u?.full_name || u?.name || u?.email || `User ${userId}`
    }

    const now = new Date()
    const startOfWeek = new Date(now)
    startOfWeek.setDate(now.getDate() - now.getDay() + 1)
    startOfWeek.setHours(0, 0, 0, 0)
    const endOfWeek = new Date(startOfWeek)
    endOfWeek.setDate(startOfWeek.getDate() + 6)
    endOfWeek.setHours(23, 59, 59, 999)
    const completed = ['completed', 'COMPLETED']
    const expandedTasks: any[] = []

    tasks.forEach((t: any) => {
      const isTaskCompleted = completed.includes(String(t.status ?? ''))
      const due = t.due_date ? new Date(t.due_date) : null
      if (due && !isTaskCompleted && due >= startOfWeek && due <= endOfWeek) {
        expandedTasks.push({ ...t, isPhase: false })
      }
      if (!isTaskCompleted && t.phases && Array.isArray(t.phases)) {
        t.phases.forEach((p: any, idx: number) => {
          if (p.is_completed) return;
          const phaseDate = p.date ? new Date(p.date) : null
          if (phaseDate && phaseDate >= startOfWeek && phaseDate <= endOfWeek) {
            expandedTasks.push({
              ...t,
              id: `phase-${t.id}-${idx}`,
              originalId: t.id,
              phaseIdx: idx,
              name: `${t.name}: ${p.name}`,
              due_date: p.date,
              isPhase: true
            })
          }
        })
      }
    })

    return expandedTasks
      .sort((a: any, b: any) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
      .map((t: any) => ({
        ...t,
        projectName: getProjectName(t.project_id ?? null),
        assigneeName: getAssigneeName(t.assigned_to ?? null),
      }))
  }, [globalData?.tasks, globalData?.projects, globalData?.users])

  const delayedTasks = useMemo(() => {
    const tasks = globalData?.tasks ?? []
    const projects = globalData?.projects ?? []
    const users = globalData?.users ?? []
    const getProjectName = (projectId: number | null | undefined): string => {
      if (projectId == null) return '（プロジェクトなし）'
      const p = projects.find((x: any) => x.id === projectId)
      return p?.name ?? `ID:${projectId}`
    }
    const getAssigneeName = (userId: number | null | undefined): string => {
      if (userId == null) return ''
      const u = users.find((x: any) => x.id === userId)
      return u?.username || u?.full_name || u?.name || u?.email || `User ${userId}`
    }

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const completed = ['completed', 'COMPLETED']
    const expandedTasks: any[] = []

    tasks.forEach((t: any) => {
      const isTaskCompleted = completed.includes(String(t.status ?? ''))
      if (isTaskCompleted) return
      let isTaskDelayed = false
      if (String(t.status ?? '').toLowerCase() === 'delayed') {
        isTaskDelayed = true
      } else {
        const due = t.due_date ? new Date(t.due_date) : null
        if (due) {
          due.setHours(0, 0, 0, 0)
          if (due < todayStart) isTaskDelayed = true
        }
      }
      if (isTaskDelayed) expandedTasks.push({ ...t, isPhase: false })
      if (t.phases && Array.isArray(t.phases)) {
        t.phases.forEach((p: any, idx: number) => {
          if (p.is_completed) return;
          const phaseDate = p.date ? new Date(p.date) : null
          if (phaseDate) {
            phaseDate.setHours(0, 0, 0, 0)
            if (phaseDate < todayStart) {
              expandedTasks.push({
                ...t,
                id: `phase-${t.id}-${idx}`,
                originalId: t.id,
                phaseIdx: idx,
                name: `${t.name}: ${p.name}`,
                due_date: p.date,
                isPhase: true
              })
            }
          }
        })
      }
    })
    return expandedTasks
      .sort((a: any, b: any) => new Date(a.due_date || 0).getTime() - new Date(b.due_date || 0).getTime())
      .map((t: any) => ({
        ...t,
        projectName: getProjectName(t.project_id ?? null),
        assigneeName: getAssigneeName(t.assigned_to ?? null),
      }))
  }, [globalData?.tasks, globalData?.projects, globalData?.users])

  const summaryCounts = useMemo(() => {
    const projects = globalData?.projects ?? []
    const tasks = globalData?.tasks ?? []
    const onlineProjects = projects.filter((p: any) => (p.display_status ?? 'online') === 'online')
    const onlineProjectIds = new Set(onlineProjects.map((p: any) => p.id))
    const tasksInOnlineProjects = tasks.filter((t: any) => {
      const pid = t.project_id ?? null
      if (pid == null) return true
      return onlineProjectIds.has(pid)
    })
    return {
      projects: onlineProjects.length,
      tasks: tasksInOnlineProjects.length,
    }
  }, [globalData?.projects, globalData?.tasks])

  const handleTogglePhase = async (taskId: number, phaseIdx: number, completed: boolean) => {
    try {
      const task = globalData?.tasks.find((t: any) => t.id === taskId);
      if (!task || !task.phases) return;
      const updatedPhases = [...task.phases];
      updatedPhases[phaseIdx] = { ...updatedPhases[phaseIdx], is_completed: completed };
      await api.put(`/tasks/${taskId}`, { phases: updatedPhases });
      if (refreshGlobalData) await refreshGlobalData();
    } catch (err) {
      console.error('Failed to update phase:', err);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    )
  }

  if (error) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <Typography color="error">{error}</Typography>
      </Box>
    )
  }

  const statCards = [
    {
      title: 'ユーザー',
      value: metrics?.users || 0,
      subValue: '登録済みユーザー',
      icon: <PeopleIcon sx={{ fontSize: 40 }} />,
      bgGradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      path: '/admin/users',
      requiresAdmin: false,
    },
    {
      title: 'タスク',
      value: globalData?.lastFetched != null ? summaryCounts.tasks : (metrics?.tasks ?? 0),
      subValue: '登録済みタスク（オンラインのみ）',
      icon: <TaskIcon sx={{ fontSize: 40 }} />,
      bgGradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      path: '/tasks',
      requiresAdmin: false,
    },
    {
      title: 'プロジェクト',
      value: globalData?.lastFetched != null ? summaryCounts.projects : (metrics?.projects ?? 0),
      subValue: '登録済みプロジェクト（オンラインのみ）',
      icon: <ProjectIcon sx={{ fontSize: 40 }} />,
      bgGradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      path: '/projects',
      requiresAdmin: false,
    },
  ]

  return (
    <Box sx={{ p: { xs: 1, sm: 1.5, md: 2 }, pb: { xs: 12, sm: 3 }, maxWidth: 1600, mx: 'auto', width: '100%' }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.secondary', mb: 1.5, fontSize: '0.9rem' }}>サマリー</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: { xs: 1.5, sm: 2 }, mb: { xs: 2, sm: 3 } }}>
        {statCards.map((card, index) => {
          const canNavigate = !card.requiresAdmin || isAdmin
          return (
            <Paper
              key={index}
              elevation={2}
              onClick={() => canNavigate && navigate(card.path)}
              sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: { xs: 1.5, sm: 2 }, position: 'relative', overflow: 'hidden', minHeight: { xs: 120, sm: 140 }, display: 'flex', flexDirection: 'column', justifyContent: 'center', transition: 'all 0.2s ease', cursor: canNavigate ? 'pointer' : 'default', opacity: canNavigate ? 1 : 0.7, '&:active': canNavigate ? { transform: 'scale(0.98)' } : {}, '&:hover': canNavigate ? { boxShadow: 4 } : {} }}
            >
              <Box sx={{ position: 'absolute', top: 0, right: 0, width: 72, height: 72, background: card.bgGradient, borderRadius: '50%', transform: 'translate(20px, -20px)', opacity: 0.12 }} />
              <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <Box sx={{ display: 'inline-flex', p: { xs: 0.875, sm: 1.25 }, borderRadius: { xs: 1.25, sm: 1.5 }, background: card.bgGradient, mb: { xs: 0.75, sm: 1 }, boxShadow: 1 }}>
                  <Box sx={{ color: 'white', '& svg': { fontSize: { xs: 28, sm: 40 } } }}>{card.icon}</Box>
                </Box>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: { xs: 0.25, sm: 0.5 }, fontWeight: 500, fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>{card.title}</Typography>
                <Typography variant="h5" sx={{ fontWeight: 700, color: 'text.primary', lineHeight: 1.2, fontSize: { xs: '1.35rem', sm: '2rem' } }}>{(card.value ?? 0).toLocaleString()}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: { xs: '0.65rem', sm: '0.75rem' } }}>{card.subValue}</Typography>
              </Box>
            </Paper>
          )
        })}
      </Box>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.secondary', mb: 1.5, fontSize: '0.9rem' }}>今週の概要</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: { xs: 1.5, sm: 2 }, mb: { xs: 2, sm: 3 } }}>
        {/* 今日の予定 */}
        <Paper elevation={2} sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: { xs: 1.5, sm: 2 }, position: 'relative', overflow: 'hidden', minHeight: { xs: 300, sm: 420 }, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ position: 'absolute', top: 0, right: 0, width: '120px', height: '120px', background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', borderRadius: '50%', transform: 'translate(36px, -36px)', opacity: 0.12 }} />
          <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.25, flexShrink: 0 }}>
              <Box sx={{ display: 'inline-flex', p: 1, borderRadius: 2, background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', boxShadow: 2 }}>
                <Box sx={{ color: 'white' }}><CalendarTodayIcon sx={{ fontSize: 24 }} /></Box>
              </Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.primary', fontSize: '0.95rem' }}>今日の予定</Typography>
            </Box>
            <Box sx={{ height: 350, minHeight: 0, overflowY: 'auto', '&::-webkit-scrollbar': { width: 6 }, '&::-webkit-scrollbar-thumb': { borderRadius: 3, bgcolor: 'action.hover' } }}>
              {!eventsLoaded && todayItems.length === 0 ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 120, px: 2 }}><Typography variant="body2" color="text.secondary">読み込み中...</Typography></Box>
              ) : todayItems.length === 0 ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 120, px: 2 }}><Typography variant="body2" color="text.secondary">今日の予定はありません</Typography></Box>
              ) : (
                todayItems.map((item) => (
                  <Box key={`${item.type}-${item.id}`} onClick={() => { if (item.type === 'event') { const ev = backendEvents.find(e => e.id === item.rawId); if (ev) { setSelectedEventDetail(ev); setIsEventDetailOpen(true); } } else { const tk = (globalData?.tasks ?? []).find((t: any) => t.id === item.rawId); if (tk) { setSelectedTaskDetail(tk); setIsTaskDetailOpen(true); } } }} sx={{ py: 1.25, px: 1.25, mb: 1, borderRadius: 1.5, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderLeft: '4px solid', borderLeftColor: item.type === 'event' ? 'info.main' : (item.isPhase ? 'secondary.main' : 'warning.main'), display: 'flex', alignItems: 'flex-start', gap: 1.25, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}>
                    <Box sx={{ flexShrink: 0, width: 32, height: 32, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: item.type === 'event' ? 'info.light' : (item.isPhase ? 'secondary.light' : 'warning.light'), color: item.type === 'event' ? 'info.dark' : (item.isPhase ? 'secondary.dark' : 'warning.dark') }}>{item.type === 'event' ? <EventIcon sx={{ fontSize: 18 }} /> : <TaskIcon sx={{ fontSize: 18 }} />}</Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.5 }}>
                        <Typography variant="body1" sx={{ fontWeight: 600, color: 'text.primary', lineHeight: 1.35 }} noWrap>{item.name}</Typography>
                        <Typography component="span" variant="caption" sx={{ px: 0.75, py: 0.2, borderRadius: 1, bgcolor: item.type === 'event' ? 'info.main' : (item.isPhase ? 'secondary.main' : 'warning.main'), color: 'white', fontWeight: 600, fontSize: '0.7rem' }}>{item.kindLabel}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><ProjectIcon sx={{ fontSize: 14, color: 'text.secondary' }} /><Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.8rem' }}>{item.projectName}</Typography></Box>
                    </Box>
                  </Box>
                ))
              )}
            </Box>
          </Box>
        </Paper>

        {/* 今週の締切 */}
        <Paper elevation={2} sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: { xs: 1.5, sm: 2 }, position: 'relative', overflow: 'hidden', minHeight: { xs: 300, sm: 420 }, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ position: 'absolute', top: 0, right: 0, width: '120px', height: '120px', background: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', borderRadius: '50%', transform: 'translate(36px, -36px)', opacity: 0.12 }} />
          <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.25, flexShrink: 0 }}>
              <Box sx={{ display: 'inline-flex', p: 1, borderRadius: 2, background: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', boxShadow: 2 }}><Box sx={{ color: 'white' }}><TaskIcon sx={{ fontSize: 24 }} /></Box></Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.primary', fontSize: '0.95rem' }}>今週の締切</Typography>
              <Typography component="span" variant="caption" sx={{ px: 0.75, py: 0.2, borderRadius: 1, bgcolor: 'grey.300', color: 'text.primary', fontWeight: 600 }}>{weekDeadlineTasks.length}件</Typography>
            </Box>
            <Box sx={{ height: 350, minHeight: 0, overflowY: 'auto', '&::-webkit-scrollbar': { width: 6 }, '&::-webkit-scrollbar-thumb': { borderRadius: 3, bgcolor: 'action.hover' } }}>
              {weekDeadlineTasks.length === 0 ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 120, px: 2 }}><Typography variant="body2" color="text.secondary">今週の締切はありません</Typography></Box>
              ) : (
                weekDeadlineTasks.map((t: any) => (
                  <Box key={t.id} onClick={() => { const taskId = t.isPhase && t.originalId ? Number(t.originalId) : Number(t.id); const tk = (globalData?.tasks ?? []).find((x: any) => x.id === taskId); if (tk) { setSelectedTaskDetail(tk); setIsTaskDetailOpen(true); } }} sx={{ py: 1, px: 1.25, mb: 1, borderRadius: 1.5, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderLeft: '4px solid', borderLeftColor: 'warning.main', cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }} noWrap>{t.name}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t.due_date ? format(new Date(t.due_date), 'M/d (EEE)', { locale: ja }) : ''}</Typography>
                    </Box>
                  </Box>
                ))
              )}
            </Box>
          </Box>
        </Paper>

        {/* 遅延タスク */}
        <Paper elevation={2} sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: { xs: 1.5, sm: 2 }, position: 'relative', overflow: 'hidden', minHeight: { xs: 300, sm: 420 }, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ position: 'absolute', top: 0, right: 0, width: '120px', height: '120px', background: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%)', borderRadius: '50%', transform: 'translate(36px, -36px)', opacity: 0.12 }} />
          <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.25, flexShrink: 0 }}>
              <Box sx={{ display: 'inline-flex', p: 1, borderRadius: 2, background: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%)', boxShadow: 2 }}><Box sx={{ color: 'white' }}><TaskIcon sx={{ fontSize: 24 }} /></Box></Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.primary', fontSize: '0.95rem' }}>遅延タスク</Typography>
              <Typography component="span" variant="caption" sx={{ px: 0.75, py: 0.2, borderRadius: 1, bgcolor: 'error.light', color: 'white', fontWeight: 600 }}>{delayedTasks.length}件</Typography>
            </Box>
            <Box sx={{ height: 350, minHeight: 0, overflowY: 'auto', '&::-webkit-scrollbar': { width: 6 }, '&::-webkit-scrollbar-thumb': { borderRadius: 3, bgcolor: 'action.hover' } }}>
              {delayedTasks.length === 0 ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 120, px: 2 }}><Typography variant="body2" color="text.secondary">遅延タスクはありません</Typography></Box>
              ) : (
                delayedTasks.map((t: any) => (
                  <Box key={t.id} onClick={() => { const taskId = t.isPhase && t.originalId ? Number(t.originalId) : Number(t.id); const tk = (globalData?.tasks ?? []).find((x: any) => x.id === taskId); if (tk) { setSelectedTaskDetail(tk); setIsTaskDetailOpen(true); } }} sx={{ py: 1, px: 1.25, mb: 1, borderRadius: 1.5, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderLeft: '4px solid', borderLeftColor: 'error.main', cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }} noWrap>{t.name}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t.due_date ? format(new Date(t.due_date), 'M/d (EEE)', { locale: ja }) : '期日未設定'}</Typography>
                    </Box>
                  </Box>
                ))
              )}
            </Box>
          </Box>
        </Paper>
      </Box>

      {/* 編集ダイアログ・ドロワー類 */}
      <TaskEditDialog open={editTaskId !== null} taskId={editTaskId} onClose={() => setEditTaskId(null)} onSaved={() => refreshGlobalData?.()} />
      <EventEditDialog open={editEventId !== null} eventId={editEventId} onClose={() => setEditEventId(null)} onSaved={() => fetchEvents()} />
      <Drawer anchor="right" open={isTaskDetailOpen} onClose={() => setIsTaskDetailOpen(false)} PaperProps={{ sx: { width: { xs: '100%', sm: 400 } } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="h6">タスク詳細</Typography>
          <IconButton onClick={() => setIsTaskDetailOpen(false)}><CloseIcon /></IconButton>
        </Box>
        {selectedTaskDetail && <TaskQuickDetail task={selectedTaskDetail} projects={globalData?.projects ?? []} users={globalData?.users ?? []} onUpdate={handleUpdateTaskQuick} />}
        <Box sx={{ p: 2, mt: 'auto' }}>
          <Button fullWidth variant="outlined" startIcon={<EditIcon />} onClick={() => { setIsTaskDetailOpen(false); setEditTaskId(selectedTaskDetail!.id); }}>詳細編集</Button>
        </Box>
      </Drawer>
      <Drawer anchor="right" open={isEventDetailOpen} onClose={() => setIsEventDetailOpen(false)} PaperProps={{ sx: { width: { xs: '100%', sm: 400 } } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="h6">イベント詳細</Typography>
          <IconButton onClick={() => setIsEventDetailOpen(false)}><CloseIcon /></IconButton>
        </Box>
        <Box sx={{ p: 2 }}>
          {selectedEventDetail && (
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>{selectedEventDetail.title}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{selectedEventDetail.start_time ? format(new Date(selectedEventDetail.start_time), 'yyyy/MM/dd HH:mm') : ''}</Typography>
              <Divider sx={{ my: 2 }} />
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{selectedEventDetail.description}</Typography>
              <Button fullWidth variant="outlined" startIcon={<EditIcon />} sx={{ mt: 4 }} onClick={() => { setIsEventDetailOpen(false); setEditEventId(selectedEventDetail.id); }}>編集する</Button>
            </Box>
          )}
        </Box>
      </Drawer>
    </Box>
  )
}

export default Dashboard