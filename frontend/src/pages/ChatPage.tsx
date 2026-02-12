import React, { useEffect, useRef, useState, useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Tooltip,
  Grid,
  Checkbox,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import {
  Assignment as AssignmentIcon,
  Today as TodayIcon,
  Warning as WarningIcon,
  Schedule as ScheduleIcon,
  CheckCircle as CheckCircleIcon,
  EmojiEvents as EmojiEventsIcon,
} from '@mui/icons-material'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { usePageState } from '../contexts/PageStateContext'
import { format, startOfDay, parseISO, isBefore, addDays, isSameDay, isValid } from 'date-fns'
import type { Task, Project } from '../types'

/** タスクの表示カテゴリ（今日 / 遅延 / 期限間近 / その他）。1タスク1カテゴリで重複表示しない */
type TaskDisplayCategory = 'today' | 'delayed' | 'dueSoon' | 'other'

const DUE_SOON_DAYS = 7 // 期限「間近」の日数（1週間）

/** タスクがどのカテゴリに属するか（優先度: 今日 > 遅延 > 期限間近 > その他） */
function getTaskCategory(task: Task): TaskDisplayCategory {
  if (!task.due_date) return 'other'
  const due = parseISO(task.due_date)
  if (!isValid(due)) return 'other'
  const dueDate = startOfDay(due)
  const today = startOfDay(new Date())
  if (isSameDay(dueDate, today)) return 'today'
  if (isBefore(dueDate, today)) return 'delayed'
  const limit = addDays(today, DUE_SOON_DAYS)
  if (isBefore(dueDate, limit) || isSameDay(dueDate, limit)) return 'dueSoon'
  return 'other'
}

/** ユーザーごとのタスクを今日/遅延/期限間近/その他に分割（重複なし） */
function partitionTasksByCategory(tasks: Task[]): Record<TaskDisplayCategory, Task[]> {
  const result: Record<TaskDisplayCategory, Task[]> = {
    today: [],
    delayed: [],
    dueSoon: [],
    other: []
  }
  tasks.forEach(task => {
    const cat = getTaskCategory(task)
    result[cat].push(task)
  })
  return result
}

const CHAT_WELCOME_MESSAGE: { role: 'assistant'; content: string } = {
  role: 'assistant',
  content: 'ようこそ！タスクについてお気軽にご相談ください！',
}

interface PendingAction {
  action_type: 'update_task' | 'create_task' | 'delete_task'
  task_id?: number
  task_data?: any
  description: string
}

const ChatPage: React.FC = () => {
  const { user, token: authToken } = useAuth()
  const { refreshGlobalData, globalData } = usePageState()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([CHAT_WELCOME_MESSAGE])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)
  const [pendingActions, setPendingActions] = useState<PendingAction[] | null>(null)
  const [isExecutingAction, setIsExecutingAction] = useState(false)
  const [projectsForAction, setProjectsForAction] = useState<Array<{ id: number; name: string }>>([])
  const [selectedProjectIdForAction, setSelectedProjectIdForAction] = useState<number | ''>('')
  const listEndRef = useRef<HTMLDivElement | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const hasReceivedTaskActionRef = useRef<boolean>(false)
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // Google カレンダー連携（ユーザー個人のカレンダーにタスクを1件ずつ表示ON/OFF）
  const [googleStatus, setGoogleStatus] = useState<{ configured: boolean; connected: boolean; synced_task_ids: number[] }>({
    configured: false,
    connected: false,
    synced_task_ids: [],
  })
  const [googleSyncingTaskId, setGoogleSyncingTaskId] = useState<number | null>(null)

  const canSend = useMemo(() => chatInput.trim().length > 0 && !sending && !isGenerating, [chatInput, sending, isGenerating])

  // 初回マウント時にタスク・プロジェクトを取得（レイアウト表示用）
  useEffect(() => {
    refreshGlobalData?.()
  }, [refreshGlobalData])

  // Google カレンダー連携状態の取得
  const fetchGoogleStatus = React.useCallback(async () => {
    try {
      const res = await api.get<{ configured: boolean; connected: boolean; synced_task_ids: number[] }>('/google/status')
      setGoogleStatus({
        configured: res.data.configured,
        connected: res.data.connected,
        synced_task_ids: res.data.synced_task_ids ?? [],
      })
    } catch (err) {
      console.error('Google status fetch error:', err)
      setGoogleStatus({ configured: false, connected: false, synced_task_ids: [] })
    }
  }, [])
  
  useEffect(() => {
    fetchGoogleStatus()
  }, [fetchGoogleStatus])

  const handleGoogleConnect = React.useCallback(async () => {
    try {
      const res = await api.get<{ url: string }>('/google/authorize')
      if (res.data?.url) {
        window.location.href = res.data.url
      } else {
        console.error('Google authorize URL not found in response:', res.data)
      }
    } catch (err: any) {
      console.error('Google connect error:', err)
      const errorMessage = err?.response?.data?.detail || err?.message || 'Google 連携の開始に失敗しました'
      alert(`Google連携エラー: ${errorMessage}`)
    }
  }, [])

  const handleGoogleSyncToggle = React.useCallback(async (taskId: number, currentSynced: boolean) => {
    setGoogleSyncingTaskId(taskId)
    try {
      await api.post(`/google/sync/task/${taskId}`, { sync: !currentSynced })
      await fetchGoogleStatus()
      // 成功メッセージは表示しない（UIでチェック状態が変わるので）
    } catch (err: any) {
      console.error('Google sync toggle error:', err)
      alert(`Googleカレンダーへの追加に失敗しました: ${err?.response?.data?.detail || err?.message || '不明なエラー'}`)
    } finally {
      setGoogleSyncingTaskId(null)
    }
  }, [fetchGoogleStatus])

  const scrollToBottom = () => {
    if (listEndRef.current) listEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }
  useEffect(() => { scrollToBottom() }, [messages])

  // テーブル上でマウスホイールを横スクロールに変換（ダッシュボードと同じ）
  useEffect(() => {
    const setupWheelHandlers = () => {
      const containers = Array.from(document.querySelectorAll('.message-content .table-scroll')) as HTMLDivElement[]
      containers.forEach((el) => {
        if ((el as any)._wheelHandler) return
        const onWheel = (e: WheelEvent) => {
          if (e.ctrlKey) return
          if (el.scrollWidth <= el.clientWidth) return
          if (e.deltaY !== 0) {
            try { e.preventDefault() } catch (_) {}
            el.scrollLeft += e.deltaY
          }
        }
        try {
          el.addEventListener('wheel', onWheel, { passive: false })
        } catch (_) {
          el.addEventListener('wheel', onWheel as any)
        }
        ;(el as any)._wheelHandler = onWheel
      })
    }
    const initialTimeoutId = setTimeout(setupWheelHandlers, 100)
    const intervalId = setInterval(setupWheelHandlers, 500)
    return () => {
      clearTimeout(initialTimeoutId)
      clearInterval(intervalId)
      const containers = Array.from(document.querySelectorAll('.message-content .table-scroll')) as HTMLDivElement[]
      containers.forEach((el) => {
        if ((el as any)._wheelHandler) {
          el.removeEventListener('wheel', (el as any)._wheelHandler)
          delete (el as any)._wheelHandler
        }
      })
    }
  }, [messages])

  const renderMarkdown = (md: string) => {
    marked.setOptions({ gfm: true, breaks: true })
    const html = marked.parse(md || '') as string
    return enhanceTableDates(DOMPurify.sanitize(html))
  }

  // 表セル内の日付を検出し、相対日数バッジを付与（ダッシュボードと同じロジック）
  const enhanceTableDates = (html: string): string => {
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')
      const tables = Array.from(doc.querySelectorAll('table'))
      if (tables.length === 0) return html

      const datePatterns: RegExp[] = [
        /(\d{4})-(\d{1,2})-(\d{1,2})/g,
        /(\d{4})\/(\d{1,2})\/(\d{1,2})/g,
        /(^|\s)(\d{1,2})\/(\d{1,2})(?=\s|$)/g,
      ]
      const today = new Date()
      const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()

      const makeBadge = (diffDays: number): HTMLSpanElement => {
        const span = doc.createElement('span')
        span.className = 'date-badge ' + (diffDays < 0 ? 'past' : diffDays === 0 ? 'today' : 'future')
        span.textContent = diffDays < 0 ? '過日' : diffDays === 0 ? '今日' : `${diffDays}日後`
        return span
      }
      const toMidnight = (y: number, m: number, d: number) => new Date(y, m, d).getTime()

      const processCell = (cell: HTMLElement) => {
        if (cell.querySelector('.date-badge')) return
        const walker = doc.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
        const textNodes: Text[] = []
        let n: Node | null
        while ((n = walker.nextNode())) {
          if (n.nodeType === Node.TEXT_NODE && n.nodeValue && n.nodeValue.trim() !== '')
            textNodes.push(n as Text)
        }
        for (const t of textNodes) {
          let changed = false
          let content = t.nodeValue || ''
          for (const re of datePatterns) {
            re.lastIndex = 0
            const frag = doc.createDocumentFragment()
            let lastIndex = 0
            let match: RegExpExecArray | null
            let any = false
            while ((match = re.exec(content))) {
              any = true
              frag.appendChild(doc.createTextNode(content.slice(lastIndex, match.index)))
              let y: number, m: number, d: number
              if (match.length >= 4 && re !== datePatterns[2]) {
                y = parseInt(match[1], 10)
                m = parseInt(match[2], 10) - 1
                d = parseInt(match[3], 10)
              } else {
                y = today.getFullYear()
                m = parseInt(match[2], 10) - 1
                d = parseInt(match[3], 10)
              }
              const target = toMidnight(y, m, d)
              if (!isNaN(target)) {
                const diffDays = Math.round((target - todayMid) / (1000 * 60 * 60 * 24))
                frag.appendChild(doc.createTextNode(match[0]))
                frag.appendChild(doc.createTextNode(' '))
                frag.appendChild(makeBadge(diffDays))
              } else {
                frag.appendChild(doc.createTextNode(match[0]))
              }
              lastIndex = re.lastIndex
            }
            if (any) {
              frag.appendChild(doc.createTextNode(content.slice(lastIndex)))
              t.parentNode?.replaceChild(frag, t)
              changed = true
              break
            }
          }
          if (changed) break
        }
      }

      tables.forEach(tbl => {
        const cells = tbl.querySelectorAll('td, th')
        cells.forEach(c => processCell(c as HTMLElement))
        const parent = tbl.parentElement
        if (!parent) return
        if (parent.classList.contains('table-scroll')) return
        const wrapper = doc.createElement('div')
        wrapper.className = 'table-scroll'
        parent.replaceChild(wrapper, tbl)
        wrapper.appendChild(tbl)
      })

      return doc.body.innerHTML
    } catch {
      return html
    }
  }

  const generateActionDescription = (action: any): string => {
    const getTaskName = (taskId?: number) => {
      if (!taskId || !globalData?.tasks) return ''
      const task = globalData.tasks.find((t: any) => t.id === taskId)
      return task?.name || ''
    }
    const getProjectNameByTaskId = (taskId?: number) => {
      if (!taskId || !globalData?.tasks || !globalData?.projects) return ''
      const task = globalData.tasks.find((t: any) => t.id === taskId)
      const project = globalData?.projects.find((p: any) => p.id === task?.project_id)
      return project?.name || ''
    }
    const getProjectNameById = (projectId?: number) => {
      if (projectId == null || !globalData?.projects) return ''
      const project = globalData.projects.find((p: any) => p.id === projectId)
      return project?.name || ''
    }
    const label = (taskId: number | undefined, taskName: string, projectName: string) =>
      projectName && taskName ? `プロジェクト「${projectName}」のタスク「${taskName}」` : taskName ? `タスク「${taskName}」` : `タスクID ${taskId}`
    switch (action.action_type) {
      case 'update_task': {
        const taskName = getTaskName(action.task_id)
        const projectName = getProjectNameByTaskId(action.task_id)
        const updates: string[] = []
        if (action.task_data?.status) updates.push(`ステータス: ${action.task_data.status}`)
        if (action.task_data?.name) updates.push(`名前: ${action.task_data.name}`)
        return `${label(action.task_id, taskName, projectName)} を更新。${updates.length ? updates.join(', ') : 'その他'}`
      }
      case 'create_task': {
        const details: string[] = []
        if (action.task_data?.project_id != null) details.push(`プロジェクト: ${getProjectNameById(action.task_data.project_id)}`)
        if (action.task_data?.name) details.push(`名前: ${action.task_data.name}`)
        return `新規タスク作成。${details.length ? details.join('\n') : '詳細未設定'}`
      }
      case 'delete_task': {
        const taskName = getTaskName(action.task_id)
        const projectName = getProjectNameByTaskId(action.task_id)
        return `${label(action.task_id, taskName, projectName)} を削除します。`
      }
      default:
        return 'アクションを実行します。'
    }
  }

  const detectActionFromContent = (content: string): any | any[] | null => {
    const validTypes = ['update_task', 'create_task', 'delete_task']
    const isValid = (a: any) => a && typeof a === 'object' && validTypes.includes(a.action_type)
    const blocks = (text: string) => {
      const out: string[] = []
      const regex = /```(?:json)?\s*([\s\S]*?)```/g
      let m: RegExpExecArray | null
      while ((m = regex.exec(text)) !== null) {
        const inner = m[1].trim()
        if (inner) out.push(inner)
      }
      return out
    }
    const parseBlock = (block: string): any[] => {
      try {
        const parsed = JSON.parse(block)
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isValid)) return parsed
        if (isValid(parsed)) return [parsed]
      } catch (_) {}
      return []
    }
    const searchContent = content.includes('---') ? content.split('---').slice(1).join('---').trim() : content
    const collected: any[] = []
    for (const block of blocks(searchContent)) {
      collected.push(...parseBlock(block))
    }
    if (collected.length > 1) return collected
    if (collected.length === 1) return collected[0]
    const singleMatch = content.match(/\{[\s\S]*?"action_type":\s*"(update_task|create_task|delete_task)"[\s\S]*?\}/)
    if (singleMatch) {
      try {
        const action = JSON.parse(singleMatch[0])
        if (isValid(action)) return action
      } catch (_) {}
    }
    return null
  }

  const handleStreamingMessage = async (text: string) => {
    const token = authToken ?? localStorage.getItem('token')
    if (!token) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❌ ログインが必要です。' }])
      setSending(false)
      return
    }
    const url = new URL('/api/chat/user/stream', window.location.origin)
    url.searchParams.append('query', text)
    if (conversationId) url.searchParams.append('conversation_id', conversationId)
    url.searchParams.append('access_token', token)

    hasReceivedTaskActionRef.current = false
    const eventSource = new EventSource(url.toString())
    eventSourceRef.current = eventSource
    setIsGenerating(true)

    let aiStarted = false
    let streamEnded = false
    let accumulatedContent = ''

    eventSource.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.task_id) setCurrentTaskId(data.task_id)
        if (data.conversation_id && !conversationId) setConversationId(data.conversation_id)
        if (data.answer) {
          accumulatedContent += data.answer
          if (!aiStarted) {
            aiStarted = true
            setMessages(prev => [...prev, { role: 'assistant', content: accumulatedContent }])
          } else {
            if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current)
            updateTimeoutRef.current = setTimeout(() => {
              setMessages(prev => {
                if (prev.length === 0) return prev
                const last = prev[prev.length - 1]
                if (last.role !== 'assistant') return [...prev, { role: 'assistant', content: accumulatedContent }]
                const updated = [...prev]
                updated[updated.length - 1] = { ...last, content: accumulatedContent }
                return updated
              })
            }, 50)
          }
        } else if (data.type === 'error') {
          setMessages(prev => [...prev, { role: 'assistant', content: `エラー: ${data.detail || '不明'}` }])
          eventSource.close()
        }
      } catch (_) {}
    })

    eventSource.addEventListener('task_action', (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data?.type !== 'task_action_candidate') return
        const rawList = data.actions ?? (data.action ? [data.action] : [])
        if (!Array.isArray(rawList) || rawList.length === 0) return
        setPendingActions(
          rawList.map((a: any) => ({
            action_type: a.action_type,
            task_id: a.task_id,
            task_data: a.task_data,
            description: generateActionDescription(a),
          }))
        )
        hasReceivedTaskActionRef.current = true
      } catch (_) {}
    })

    eventSource.addEventListener('message_end', () => {
      streamEnded = true
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
        updateTimeoutRef.current = null
      }
      setMessages(prev => {
        if (prev.length === 0) return prev
        const last = prev[prev.length - 1]
        if (last.role === 'assistant') {
          const u = [...prev]
          u[u.length - 1] = { ...last, content: accumulatedContent }
          return u
        }
        return prev
      })
      if (!hasReceivedTaskActionRef.current) {
        const detected = detectActionFromContent(accumulatedContent)
        if (detected != null) {
          const list = Array.isArray(detected) ? detected : [detected]
          setPendingActions(
            list.map((a: any) => ({
              action_type: a.action_type,
              task_id: a.task_id,
              task_data: a.task_data,
              description: generateActionDescription(a),
            }))
          )
        }
      }
      hasReceivedTaskActionRef.current = false
      eventSource.close()
      eventSourceRef.current = null
      setIsGenerating(false)
      setSending(false)
      setCurrentTaskId(null)
    })

    eventSource.onerror = () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
        updateTimeoutRef.current = null
      }
      if (streamEnded || aiStarted || eventSource.readyState === EventSource.CLOSED) {
        eventSource.close()
        eventSourceRef.current = null
        setIsGenerating(false)
        setSending(false)
        setCurrentTaskId(null)
        return
      }
      eventSource.close()
      eventSourceRef.current = null
      setIsGenerating(false)
      setSending(false)
      setCurrentTaskId(null)
      setMessages(prev => [...prev, { role: 'assistant', content: 'ストリーミング接続に失敗しました' }])
    }
  }

  const handleSend = async () => {
    if (!canSend) return
    const text = chatInput.trim()
    setChatInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setSending(true)
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    handleStreamingMessage(text).catch(() => {
      setSending(false)
      setIsGenerating(false)
    })
  }

  const handleStopGeneration = async () => {
    if (currentTaskId) {
      try {
        await api.post(`/chat/user/stop/${currentTaskId}`, { user: 'default_user' })
      } catch (_) {}
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setIsGenerating(false)
    setSending(false)
    setCurrentTaskId(null)
  }

  const handleNewConversation = () => {
    if (eventSourceRef.current) {
      try { eventSourceRef.current.close() } catch (_) {}
      eventSourceRef.current = null
    }
    setConversationId(null)
    setSending(false)
    setChatInput('')
    setMessages([CHAT_WELCOME_MESSAGE])
  }

  const hasCreateTaskAction = pendingActions?.some(a => a.action_type === 'create_task') ?? false
  useEffect(() => {
    if (!hasCreateTaskAction) return
    api.get('/projects')
      .then((res: any) => {
        if (Array.isArray(res.data)) setProjectsForAction(res.data.map((p: any) => ({ id: p.id, name: p.name })))
      })
      .catch(() => {})
  }, [hasCreateTaskAction])

  const executeAction = async () => {
    if (!pendingActions?.length) return
    const token = authToken ?? localStorage.getItem('token')
    if (!token) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❌ タスク操作にはログインが必要です。' }])
      setPendingActions(null)
      return
    }
    if (!localStorage.getItem('token')) localStorage.setItem('token', token)
    setIsExecutingAction(true)
    const results: string[] = []
    for (const pa of pendingActions) {
      const payload: any = {
        action_type: pa.action_type,
        task_id: pa.task_id,
        task_data: pa.task_data ? { ...pa.task_data } : {},
      }
      if (pa.action_type === 'create_task') {
        payload.task_data = payload.task_data || {}
        if (selectedProjectIdForAction !== '') payload.task_data.project_id = selectedProjectIdForAction
        const todayStr = format(new Date(), 'yyyy-MM-dd')
        payload.task_data.start_date = todayStr
        payload.task_data.due_date = todayStr
      }
      try {
        const response = await api.post('/chat/actions/task', payload)
        results.push(response.data.success ? `✅ ${response.data.message}` : `❌ ${response.data.error ?? 'エラー'}`)
      } catch (err: any) {
        const status = err.response?.status
        const data = err.response?.data
        const msg = status === 401 || status === 403
          ? (data?.error || data?.detail || '認証が必要です。')
          : (data?.error || data?.detail || err.message || 'エラー')
        results.push(`❌ ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`)
      }
    }
    setMessages(prev => [...prev, { role: 'assistant', content: results.join('\n') }])
    if (results.some(r => r.startsWith('✅')) && refreshGlobalData) await refreshGlobalData()
    setIsExecutingAction(false)
    setPendingActions(null)
    setSelectedProjectIdForAction('')
  }

  // ログインしているユーザーのタスクを取得
  const currentUserTasks = useMemo(() => {
    if (!user?.id || !globalData?.tasks || !globalData?.projects) {
      console.log('[ChatPage] No tasks - user:', user?.id, 'tasks:', globalData?.tasks?.length, 'projects:', globalData?.projects?.length)
      return []
    }
    
    const projectMap = new Map<number, string>()
    const completedProjectIds = new Set<number>()
    globalData.projects.forEach((project: Project) => {
      projectMap.set(project.id, project.name)
      const status = (project.status || '').toLowerCase()
      if (status === 'completed' || status === '完了') {
        completedProjectIds.add(project.id)
      }
    })

    const isTaskCompleted = (task: Task): boolean => {
      const status = (task.status || '').toLowerCase()
      return status === 'completed' || status === '完了'
    }

    const userId = Number(user.id)
    const filteredTasks = globalData.tasks.filter((task: Task) => {
      const taskAssignedTo = task.assigned_to ? Number(task.assigned_to) : null
      if (taskAssignedTo !== userId) return false
      if (task.display_status !== 'online') return false
      if (isTaskCompleted(task)) return false
      const projectId = task.project_id ?? 0
      if (projectId !== 0 && completedProjectIds.has(projectId)) return false
      return true
    })
    
    console.log('[ChatPage] Filtered tasks for user', userId, ':', filteredTasks.length, 'tasks')
    return filteredTasks
  }, [user?.id, globalData?.tasks, globalData?.projects])

  const tasksByCategory = useMemo(() => {
    return partitionTasksByCategory(currentUserTasks)
  }, [currentUserTasks])

  const projectNames = useMemo(() => {
    if (!globalData?.projects) return {}
    const names: Record<number, string> = {}
    globalData.projects.forEach((project: Project) => {
      names[project.id] = project.name
    })
    names[0] = 'プロジェクト未設定'
    return names
  }, [globalData?.projects])

  return (
    <Box sx={{ width: '100%', maxWidth: 1200, mx: 'auto', p: { xs: 1.5, sm: 2 } }}>
      {/* 会話エリア */}
      <Paper sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: { xs: '0.9rem', sm: '1rem' } }}>
            会話
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {/* Google カレンダー連携 */}
            {googleStatus.configured && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                {!googleStatus.connected ? (
                  <Tooltip title="連携後、タスクページで各タスクの「Google」列のチェックで、Googleカレンダーに表示できます">
                    <Button
                      size="small"
                      variant="contained"
                      color="primary"
                      onClick={handleGoogleConnect}
                      sx={{ textTransform: 'none', fontWeight: 600, fontSize: { xs: '0.7rem', sm: '0.875rem' }, px: { xs: 1, sm: 1.5 } }}
                    >
                      {isMobile ? 'Google連携' : 'Google カレンダーと連携'}
                    </Button>
                  </Tooltip>
                ) : (
                  <Tooltip title="下の「あなたのタスク」で各タスクのチェックボックスから、Googleカレンダーに表示できます">
                    <Chip
                      size="small"
                      label={isMobile ? '連携済み' : 'Google 連携済み'}
                      color="success"
                      sx={{ fontWeight: 600, cursor: 'default', fontSize: { xs: '0.7rem', sm: '0.75rem' } }}
                    />
                  </Tooltip>
                )}
              </Box>
            )}
            {!googleStatus.configured && (
              <Tooltip title="Google連携はバックエンドで設定されていません（GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET が必要です）">
                <Chip
                  size="small"
                  label={isMobile ? '未設定' : 'Google連携未設定'}
                  variant="outlined"
                  sx={{ color: 'text.secondary', cursor: 'default', fontSize: { xs: '0.7rem', sm: '0.75rem' } }}
                />
              </Tooltip>
            )}
            <Button size="small" variant="outlined" onClick={handleNewConversation} sx={{ fontSize: { xs: '0.7rem', sm: '0.875rem' } }}>
              {isMobile ? '新規' : '新しい会話'}
            </Button>
          </Box>
        </Box>
        <Box sx={{ position: 'relative', height: { xs: 350, sm: 440 } }}>
          <Box
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1.5,
              p: { xs: 1, sm: 1.5 },
              height: { xs: 290, sm: 380 },
              overflow: 'auto',
              backgroundColor: (theme) => theme.palette.mode === 'dark' ? theme.palette.background.default : theme.palette.grey[50],
              display: 'flex',
              flexDirection: 'column',
              gap: { xs: 1, sm: 1.25 },
            }}
          >
            {messages.map((m, i) => (
              <Box key={i} sx={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', minWidth: 0 }}>
                <Box sx={{
                  maxWidth: m.role === 'assistant' ? { xs: '98%', sm: '95%' } : { xs: '85%', sm: '75%' },
                  minWidth: 0,
                  px: { xs: 1.5, sm: 2 },
                  py: m.role === 'assistant' ? { xs: 0.75, sm: 1 } : { xs: 1, sm: 1.5 },
                  bgcolor: m.role === 'user' ? 'primary.main' : 'background.paper',
                  color: m.role === 'user' ? 'primary.contrastText' : 'text.primary',
                  borderRadius: 2,
                  borderTopRightRadius: m.role === 'user' ? 0 : 12,
                  borderTopLeftRadius: m.role === 'user' ? 12 : 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  boxShadow: m.role === 'user' ? 2 : 1,
                  border: m.role === 'assistant' ? '1px solid' : 'none',
                  borderColor: m.role === 'assistant' ? 'divider' : 'transparent',
                  overflow: 'hidden',
                  '& .markdown-content': {
                    lineHeight: 1.35,
                    overflowX: 'auto',
                    maxWidth: '100%',
                    minWidth: 0,
                    '& h1, & h2, & h3, & h4, & h5, & h6': {
                      margin: '6px 0 2px 0',
                      fontWeight: 600,
                      color: 'text.primary',
                    },
                    '& h1': { fontSize: { xs: '1.1rem', sm: '1.25rem' } },
                    '& h2': { fontSize: { xs: '1rem', sm: '1.125rem' } },
                    '& h3': { fontSize: { xs: '0.9rem', sm: '1rem' } },
                  },
                  '& .markdown-content p': {
                    margin: '2px 0',
                    color: 'text.primary',
                    fontSize: { xs: '0.85rem', sm: '0.875rem' },
                  },
                  '& .markdown-content ul, & .markdown-content ol': {
                    margin: '4px 0 4px 1.25rem',
                    paddingLeft: '0.5rem',
                  },
                  '& .markdown-content li': {
                    margin: '1px 0',
                    color: 'text.primary',
                    fontSize: { xs: '0.85rem', sm: '0.875rem' },
                  },
                  '& .markdown-content strong, & .markdown-content b': {
                    fontWeight: 600,
                    color: 'text.primary',
                  },
                  '& .markdown-content em, & .markdown-content i': {
                    fontStyle: 'italic',
                    color: 'text.secondary',
                  },
                  '& .markdown-content code': {
                    backgroundColor: (theme) => theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[200],
                    color: 'text.primary',
                    padding: '2px 4px',
                    borderRadius: '4px',
                    fontSize: { xs: '0.75rem', sm: '0.875rem' },
                    fontFamily: 'monospace',
                  },
                  '& .markdown-content blockquote': {
                    borderLeft: '4px solid',
                    borderColor: 'primary.main',
                    paddingLeft: '10px',
                    margin: '6px 0',
                    fontStyle: 'italic',
                    color: 'text.secondary',
                  },
                  '& .markdown-content table': {
                    borderCollapse: 'collapse',
                    borderSpacing: 0,
                    display: 'table',
                    tableLayout: 'auto',
                    fontSize: { xs: '0.8rem', sm: '0.95rem' },
                    borderRadius: 8,
                    overflow: 'hidden',
                    boxShadow: 1,
                    width: 'max-content',
                    maxWidth: '100%',
                  },
                  '& .markdown-content .table-scroll': {
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    maxWidth: '100%',
                    width: '100%',
                    scrollbarWidth: 'auto',
                  },
                  '& .markdown-content th, & .markdown-content td': {
                    border: '1px solid',
                    borderColor: 'divider',
                    padding: { xs: '3px 6px', sm: '4px 8px' },
                    verticalAlign: 'top',
                    whiteSpace: 'nowrap',
                    boxSizing: 'border-box',
                    color: 'text.primary',
                    fontSize: { xs: '0.75rem', sm: '0.875rem' },
                  },
                  '& .markdown-content th': {
                    backgroundColor: (theme) => theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[200],
                    fontWeight: 600,
                  },
                  '& .markdown-content tbody tr:nth-of-type(odd) td': {
                    backgroundColor: (theme) => theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[50],
                  },
                  '& .markdown-content tbody tr:nth-of-type(even) td': {
                    backgroundColor: (theme) => theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.background.paper,
                  },
                  '& .markdown-content tbody tr:hover td': {
                    backgroundColor: 'action.hover',
                  },
                  '& .markdown-content thead': {
                    position: 'static',
                  },
                  '& .markdown-content thead th': {
                    position: 'static',
                    backgroundColor: (theme) => theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[200],
                  },
                  '& .markdown-content caption': {
                    captionSide: 'bottom',
                    textAlign: 'left',
                    color: 'text.secondary',
                    fontSize: '0.85rem',
                    paddingTop: '4px',
                  },
                  '& .markdown-content .date-badge': {
                    display: 'inline-block',
                    padding: '0px 6px',
                    borderRadius: 999,
                    fontSize: { xs: '0.65rem', sm: '0.75rem' },
                    lineHeight: 1.8,
                    marginLeft: '4px',
                    border: '1px solid',
                    borderColor: 'divider',
                  },
                  '& .markdown-content .date-badge.past': {
                    backgroundColor: 'success.main',
                    color: 'common.white',
                    borderColor: 'success.main',
                  },
                  '& .markdown-content .date-badge.today': {
                    backgroundColor: 'warning.main',
                    color: 'grey.900',
                    borderColor: 'warning.main',
                  },
                  '& .markdown-content .date-badge.future': {
                    backgroundColor: 'info.main',
                    color: 'common.white',
                    borderColor: 'info.main',
                  },
                }}>
                  {m.role === 'assistant' ? (
                    <div
                      className="message-content markdown-content"
                      style={{ overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                    />
                  ) : (
                    m.content
                  )}
                </Box>
              </Box>
            ))}
            <div ref={listEndRef} />
          </Box>
          <Box
            sx={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              display: 'flex',
              gap: 1,
              pt: 1,
              backgroundColor: 'background.paper',
            }}
          >
            <TextField
              fullWidth
              size="small"
              placeholder="メッセージを入力..."
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              disabled={sending}
              sx={{
                '& .MuiInputBase-input': {
                  fontSize: { xs: '0.875rem', sm: '1rem' },
                }
              }}
            />
            <Button
              variant="contained"
              onClick={isGenerating ? handleStopGeneration : handleSend}
              disabled={!canSend && !isGenerating}
              color={isGenerating ? 'error' : 'primary'}
              sx={{
                fontSize: { xs: '0.75rem', sm: '0.875rem' },
                px: { xs: 1.5, sm: 2 },
                minWidth: { xs: 60, sm: 80 }
              }}
            >
              {isGenerating ? '停止' : sending ? '送信中...' : '送信'}
            </Button>
          </Box>
        </Box>
      </Paper>

      {/* あなたのタスク */}
      {user && (
        <>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.secondary', mb: 1.5, fontSize: '0.9rem' }}>
            あなたのタスク
          </Typography>
          <Paper sx={{ p: 2.5, borderRadius: 2 }}>
            {(globalData?.lastFetched ?? 0) === 0 && currentUserTasks.length === 0 ? (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
                <Typography variant="body2" color="text.secondary">
                  読み込み中...
                </Typography>
              </Box>
            ) : currentUserTasks.length === 0 ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                py: 3,
                px: 3,
                textAlign: 'center',
                background: (theme) => theme.palette.mode === 'dark' 
                  ? 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)'
                  : 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
                borderRadius: 2,
                border: '2px dashed',
                borderColor: 'primary.light',
              }}
            >
              <Box
                sx={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  bgcolor: 'success.light',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 1.5,
                  boxShadow: '0 4px 12px rgba(76, 175, 80, 0.3)',
                }}
              >
                <CheckCircleIcon
                  sx={{
                    fontSize: 40,
                    color: 'success.main',
                  }}
                />
              </Box>
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 'bold',
                  color: 'text.primary',
                  mb: 0.5,
                  background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                すべてのタスクが完了しています！
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: 'text.secondary',
                  mb: 1,
                  maxWidth: 400,
                }}
              >
                素晴らしい仕事ぶりですね。新しいタスクが割り当てられたら、ここに表示されます。
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  color: 'success.main',
                  fontWeight: 'medium',
                }}
              >
                <EmojiEventsIcon sx={{ fontSize: 20 }} />
                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                  完璧な状態です
                </Typography>
              </Box>
            </Box>
            ) : (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                <AssignmentIcon sx={{ color: 'primary.main', fontSize: { xs: 20, sm: 22 } }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: { xs: '0.9rem', sm: '1rem' } }}>
                  {currentUserTasks.length}件のタスク
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                  {tasksByCategory.delayed.length > 0 && <Chip size="small" label={`遅延 ${tasksByCategory.delayed.length}`} sx={{ height: { xs: 20, sm: 22 }, fontSize: { xs: '0.7rem', sm: '0.75rem' }, bgcolor: 'error.light', color: 'error.dark' }} />}
                  {tasksByCategory.today.length > 0 && <Chip size="small" label={`今日 ${tasksByCategory.today.length}`} sx={{ height: { xs: 20, sm: 22 }, fontSize: { xs: '0.7rem', sm: '0.75rem' }, bgcolor: 'info.light', color: 'info.dark' }} />}
                  {tasksByCategory.dueSoon.length > 0 && <Chip size="small" label={`期限間近 ${tasksByCategory.dueSoon.length}`} sx={{ height: { xs: 20, sm: 22 }, fontSize: { xs: '0.7rem', sm: '0.75rem' }, bgcolor: 'warning.light', color: 'warning.dark' }} />}
                  {tasksByCategory.other.length > 0 && <Chip size="small" label={`その他 ${tasksByCategory.other.length}`} variant="outlined" sx={{ height: { xs: 20, sm: 22 }, fontSize: { xs: '0.7rem', sm: '0.75rem' } }} />}
                </Typography>
              </Box>
              <Grid container spacing={{ xs: 2, sm: 3 }}>
            {tasksByCategory.delayed.length > 0 && (
              <Grid item xs={12} sm={6} md={3}>
                <Box sx={{ height: '100%' }}>
                  <Typography variant="body1" sx={{ color: 'error.main', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, fontSize: { xs: '1rem', sm: '1.1rem' } }}>
                    <WarningIcon fontSize={isMobile ? "small" : "medium"} /> 遅れている
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', flexWrap: 'wrap', gap: 1 }}>
                    {tasksByCategory.delayed.map((t) => {
                      const synced = googleStatus.connected && googleStatus.synced_task_ids.includes(t.id)
                      const loading = googleSyncingTaskId === t.id
                      return (
                        <Box key={t.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Tooltip title={`📁 ${projectNames[t.project_id ?? 0] || '—'} / 期日: ${t.due_date ? new Date(t.due_date).toLocaleDateString('ja-JP') : '—'}`}>
                            <Chip 
                              label={t.name} 
                              sx={{ 
                                bgcolor: (theme) => theme.palette.mode === 'dark' ? theme.palette.error.dark : '#FFEBEE', 
                                color: (theme) => theme.palette.mode === 'dark' ? theme.palette.error.light : '#C62828', 
                                fontSize: { xs: '0.85rem', sm: '0.95rem' },
                                height: { xs: 32, sm: 36 },
                                padding: { xs: '0 8px', sm: '0 12px' },
                                '& .MuiChip-label': {
                                  padding: { xs: '0 6px', sm: '0 8px' },
                                }
                              }} 
                            />
                          </Tooltip>
                          {googleStatus.connected && (
                            <Tooltip title={synced ? 'Googleカレンダーに表示中（クリックで解除）' : 'Googleカレンダーに表示する'}>
                              <Checkbox
                                size="small"
                                checked={synced}
                                disabled={loading}
                                onChange={() => handleGoogleSyncToggle(t.id, synced)}
                                sx={{ p: 0.5 }}
                              />
                            </Tooltip>
                          )}
                        </Box>
                      )
                    })}
                  </Box>
                </Box>
              </Grid>
            )}
            {tasksByCategory.today.length > 0 && (
              <Grid item xs={12} sm={6} md={3}>
                <Box sx={{ height: '100%' }}>
                  <Typography variant="body1" sx={{ color: 'info.main', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, fontSize: { xs: '1rem', sm: '1.1rem' } }}>
                    <TodayIcon fontSize={isMobile ? "small" : "medium"} /> 今日中
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', flexWrap: 'wrap', gap: 1 }}>
                    {tasksByCategory.today.map((t) => {
                      const synced = googleStatus.connected && googleStatus.synced_task_ids.includes(t.id)
                      const loading = googleSyncingTaskId === t.id
                      return (
                        <Box key={t.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Tooltip title={`📁 ${projectNames[t.project_id ?? 0] || '—'} / 期日: ${t.due_date ? new Date(t.due_date).toLocaleDateString('ja-JP') : '—'}`}>
                            <Chip 
                              label={t.name} 
                              sx={{ 
                                bgcolor: (theme) => theme.palette.mode === 'dark' ? theme.palette.info.dark : '#E3F2FD', 
                                color: (theme) => theme.palette.mode === 'dark' ? theme.palette.info.light : '#1565C0', 
                                fontSize: { xs: '0.85rem', sm: '0.95rem' },
                                height: { xs: 32, sm: 36 },
                                padding: { xs: '0 8px', sm: '0 12px' },
                                '& .MuiChip-label': {
                                  padding: { xs: '0 6px', sm: '0 8px' },
                                }
                              }} 
                            />
                          </Tooltip>
                          {googleStatus.connected && (
                            <Tooltip title={synced ? 'Googleカレンダーに表示中（クリックで解除）' : 'Googleカレンダーに表示する'}>
                              <Checkbox
                                size="small"
                                checked={synced}
                                disabled={loading}
                                onChange={() => handleGoogleSyncToggle(t.id, synced)}
                                sx={{ p: 0.5 }}
                              />
                            </Tooltip>
                          )}
                        </Box>
                      )
                    })}
                  </Box>
                </Box>
              </Grid>
            )}
            {tasksByCategory.dueSoon.length > 0 && (
              <Grid item xs={12} sm={6} md={3}>
                <Box sx={{ height: '100%' }}>
                  <Typography variant="body1" sx={{ color: 'warning.main', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, fontSize: { xs: '1rem', sm: '1.1rem' } }}>
                    <ScheduleIcon fontSize={isMobile ? "small" : "medium"} /> 期限が近い
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', flexWrap: 'wrap', gap: 1 }}>
                    {tasksByCategory.dueSoon.map((t) => {
                      const synced = googleStatus.connected && googleStatus.synced_task_ids.includes(t.id)
                      const loading = googleSyncingTaskId === t.id
                      return (
                        <Box key={t.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Tooltip title={`📁 ${projectNames[t.project_id ?? 0] || '—'} / 期日: ${t.due_date ? new Date(t.due_date).toLocaleDateString('ja-JP') : '—'}`}>
                            <Chip 
                              label={t.name} 
                              sx={{ 
                                bgcolor: (theme) => theme.palette.mode === 'dark' ? theme.palette.warning.dark : '#FFF3E0', 
                                color: (theme) => theme.palette.mode === 'dark' ? theme.palette.warning.light : '#E65100', 
                                fontSize: { xs: '0.85rem', sm: '0.95rem' },
                                height: { xs: 32, sm: 36 },
                                padding: { xs: '0 8px', sm: '0 12px' },
                                '& .MuiChip-label': {
                                  padding: { xs: '0 6px', sm: '0 8px' },
                                }
                              }} 
                            />
                          </Tooltip>
                          {googleStatus.connected && (
                            <Tooltip title={synced ? 'Googleカレンダーに表示中（クリックで解除）' : 'Googleカレンダーに表示する'}>
                              <Checkbox
                                size="small"
                                checked={synced}
                                disabled={loading}
                                onChange={() => handleGoogleSyncToggle(t.id, synced)}
                                sx={{ p: 0.5 }}
                              />
                            </Tooltip>
                          )}
                        </Box>
                      )
                    })}
                  </Box>
                </Box>
              </Grid>
            )}
            {tasksByCategory.other.length > 0 && (
              <Grid item xs={12} sm={6} md={3}>
                <Box sx={{ height: '100%' }}>
                  <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 'bold', mb: 1.5, display: 'block', fontSize: { xs: '1rem', sm: '1.1rem' } }}>余裕をもって進める</Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', flexWrap: 'wrap', gap: 1 }}>
                    {tasksByCategory.other.map((t) => {
                      const synced = googleStatus.connected && googleStatus.synced_task_ids.includes(t.id)
                      const loading = googleSyncingTaskId === t.id
                      return (
                        <Box key={t.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Tooltip title={`📁 ${projectNames[t.project_id ?? 0] || '—'}${t.due_date ? ` / 期日: ${new Date(t.due_date).toLocaleDateString('ja-JP')}` : ''}`}>
                            <Chip 
                              label={t.name} 
                              variant="outlined" 
                              sx={{ 
                                fontSize: { xs: '0.85rem', sm: '0.95rem' },
                                height: { xs: 32, sm: 36 },
                                padding: { xs: '0 8px', sm: '0 12px' },
                                '& .MuiChip-label': {
                                  padding: { xs: '0 6px', sm: '0 8px' },
                                }
                              }} 
                            />
                          </Tooltip>
                          {googleStatus.connected && (
                            <Tooltip title={synced ? 'Googleカレンダーに表示中（クリックで解除）' : 'Googleカレンダーに表示する'}>
                              <Checkbox
                                size="small"
                                checked={synced}
                                disabled={loading}
                                onChange={() => handleGoogleSyncToggle(t.id, synced)}
                                sx={{ p: 0.5 }}
                              />
                            </Tooltip>
                          )}
                        </Box>
                      )
                    })}
                  </Box>
                </Box>
              </Grid>
            )}
              </Grid>
            </>
          )}
        </Paper>
        </>
      )}

      <Dialog open={pendingActions != null && pendingActions.length > 0} onClose={() => setPendingActions(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {pendingActions?.length ? (pendingActions.some(a => a.action_type === 'delete_task') ? 'タスクの削除' : pendingActions.some(a => a.action_type === 'create_task') ? 'タスクの作成' : 'タスクの更新') + (pendingActions.length > 1 ? `（${pendingActions.length}件）` : '') : ''}
        </DialogTitle>
        <DialogContent>
          {pendingActions?.map((pa, i) => (
            <Typography key={i} variant="body2" sx={{ mb: 1.5, whiteSpace: 'pre-line' }}>{pa.description}</Typography>
          ))}
          {hasCreateTaskAction && (
            <Box sx={{ mt: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>プロジェクト（任意）</InputLabel>
                <Select
                  value={selectedProjectIdForAction}
                  label="プロジェクト（任意）"
                  onChange={e => setSelectedProjectIdForAction(e.target.value === '' ? '' : Number(e.target.value))}
                >
                  <MenuItem value=""><em>未指定</em></MenuItem>
                  {projectsForAction.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            この操作{pendingActions && pendingActions.length > 1 ? 'をすべて' : ''}実行しますか？
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingActions(null)} disabled={isExecutingAction}>キャンセル</Button>
          <Button onClick={executeAction} variant="contained" disabled={isExecutingAction}>
            {isExecutingAction ? '実行中...' : '実行する'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default ChatPage
