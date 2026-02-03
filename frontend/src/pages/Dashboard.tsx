import React, { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Paper,
  Typography,
  CircularProgress,
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
} from '@mui/material'
import {
  People as PeopleIcon,
  Task as TaskIcon,
  Folder as ProjectIcon,
  CalendarToday as CalendarTodayIcon,
  Event as EventIcon,
} from '@mui/icons-material'
import { format } from 'date-fns'
import api from '../services/api'
import { DashboardMetrics, BackendEvent } from '../types'
import { useDashboardPageState, usePageState, DASHBOARD_WELCOME_MESSAGE } from '../contexts/PageStateContext'
import { useAuth } from '../contexts/AuthContext'

const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const { user, token: authToken } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [backendEvents, setBackendEvents] = useState<BackendEvent[]>([])
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null)
  const messageIdRef = useRef<string | null>(null) // 直接参照用のref
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // アクション確認ダイアログ用の状態（単一・複数どちらも配列で保持）
  interface PendingAction {
    action_type: 'update_task' | 'create_task' | 'delete_task';
    task_id?: number;
    task_data?: any;
    description: string;
  }
  const [pendingActions, setPendingActions] = useState<PendingAction[] | null>(null);
  const [isExecutingAction, setIsExecutingAction] = useState(false);
  const [projectsForAction, setProjectsForAction] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedProjectIdForAction, setSelectedProjectIdForAction] = useState<number | ''>('');
  
  
  // ページ状態管理の使用
  const { dashboardState, updateDashboardState, isInitialLoad } = useDashboardPageState();
  const { refreshGlobalData, globalData } = usePageState();
  
  // 状態を分離（初期化時はページ状態から取得）
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [stateRestored, setStateRestored] = useState(false)
  const listEndRef = useRef<HTMLDivElement | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const hasReceivedTaskActionRef = useRef<boolean>(false)

  // ページ状態が復元されたらローカル状態を更新
  useEffect(() => {
    if (!isInitialLoad && dashboardState.messages.length > 0) {
      // 状態復元中は状態更新を無効化
      setStateRestored(false);
      
      // メッセージの内容を完全に復元（深いコピー）
      const restoredMessages = dashboardState.messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
      setMessages(restoredMessages);
      setConversationId(dashboardState.conversationId);
      
      // currentMessageIdも復元
      if (dashboardState.currentMessageId) {
        setCurrentMessageId(dashboardState.currentMessageId);
      }
      
      // 状態復元が完了したことを示す
      setStateRestored(true);
    }
  }, [dashboardState, isInitialLoad]);

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
    const fetchEvents = async () => {
      try {
        const res = await api.get<BackendEvent[]>('/calendar/events')
        setBackendEvents(res.data ?? [])
      } catch {
        setBackendEvents([])
      }
    }
    fetchEvents()
  }, [])

  const canSend = useMemo(() => chatInput.trim().length > 0 && !sending && !isGenerating, [chatInput, sending, isGenerating])

  // 今日の日付（YYYY-MM-DD）でタスク・イベントをフィルタし、プロジェクト名付きで一覧化（フックは早期 return の前に必ず呼ぶ）
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
    const tasks = globalData?.tasks ?? []
    const projects = globalData?.projects ?? []
    const getProjectName = (projectId: number | null | undefined): string => {
      if (projectId == null) return '（プロジェクトなし）'
      const p = projects.find((x: any) => x.id === projectId)
      return p?.name ?? `ID:${projectId}`
    }
    const norm = (s: string | null | undefined): string =>
      (s ?? '').toString().split('T')[0]

    type TodayItem = { type: 'task' | 'event'; name: string; projectName: string; id: number; timeLabel?: string; kindLabel: string; startTime?: string; dueDate?: string }

    // 1. 今日のイベント（会議など）… start_time / end_time が今日に含まれるもの。開始時刻順で上に表示
    const eventList: TodayItem[] = []
    backendEvents.forEach((ev: BackendEvent) => {
      const startDate = norm(ev.start_time)
      const endDate = ev.end_time ? norm(ev.end_time) : startDate
      const startsToday = startDate === todayStr
      const endsToday = endDate === todayStr
      const spansToday = startDate <= todayStr && todayStr <= endDate
      if (!startsToday && !endsToday && !spansToday) return
      const evType = (ev.type ?? 'Generic').toString()
      eventList.push({
        type: 'event',
        name: ev.title ?? `イベント #${ev.id}`,
        projectName: getProjectName(ev.project_id ?? undefined),
        id: ev.id,
        timeLabel: ev.start_time ? new Date(ev.start_time).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : undefined,
        kindLabel: eventTypeToLabel[evType] ?? evType,
        startTime: ev.start_time ?? undefined,
      })
    })
    eventList.sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))

    // 2. タスク：開始日・期日のどちらかが設定されていればその日付に表示、両方あれば開始日〜期日まで表示。どちらも未設定は含めない。期日が近い順でイベントの下に表示
    const taskList: TodayItem[] = []
    tasks.forEach((t: any) => {
      const start = norm(t.start_date)
      const due = norm(t.due_date)
      const hasStart = start !== ''
      const hasDue = due !== ''
      if (!hasStart && !hasDue) return
      let showToday: boolean
      if (hasStart && hasDue) {
        showToday = start <= todayStr && todayStr <= due
      } else if (hasStart) {
        showToday = start === todayStr
      } else {
        showToday = due === todayStr
      }
      if (!showToday) return
      taskList.push({
        type: 'task',
        name: t.name ?? `タスク #${t.id}`,
        projectName: getProjectName(t.project_id ?? t.extendedProps?.projectId),
        id: t.id,
        kindLabel: 'タスク',
        dueDate: due || start || '9999-12-31',
      })
    })
    taskList.sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'))

    return [...eventList, ...taskList]
  }, [globalData?.tasks, globalData?.projects, todayStr, backendEvents])

  const scrollToBottom = () => {
    if (listEndRef.current) {
      listEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // チャット状態の変更をページ状態に反映（状態復元が完了した後のみ）
  useEffect(() => {
    if (stateRestored) {
      // メッセージの内容が実際に変更された場合のみ更新
      const hasMessagesChanged = messages.length !== dashboardState.messages.length ||
        messages.some((msg, index) => {
          const savedMsg = dashboardState.messages[index];
          return !savedMsg || msg.content !== savedMsg.content || msg.role !== savedMsg.role;
        });
      
      const hasConversationChanged = conversationId !== dashboardState.conversationId;
      
      if (hasMessagesChanged || hasConversationChanged) {
        // ストリーミング中は即座に更新、そうでなければデバウンス
        const delay = sending ? 0 : 100;
        const timeoutId = setTimeout(() => {
          updateDashboardState({
            messages: [...messages], // 新しい配列として保存
            conversationId,
            currentMessageId, // currentMessageIdも保存
          });
        }, delay);
        
        return () => clearTimeout(timeoutId);
      }
    }
  }, [messages, conversationId, stateRestored, updateDashboardState, dashboardState.messages, dashboardState.conversationId, sending]);

  // テーブル上でマウスホイールを横スクロールに変換
  useEffect(() => {
    // イベントリスナーを設定する関数
    const setupWheelHandlers = () => {
      const containers = Array.from(document.querySelectorAll('.message-content .table-scroll')) as HTMLDivElement[]
      
      containers.forEach((el) => {
        // 既にイベントリスナーが設定されている場合はスキップ
        if ((el as any)._wheelHandler) {
          return
        }
        
        const onWheel = (e: WheelEvent) => {
          // ピンチズームや修飾キー時は素通し
          if (e.ctrlKey) return
          // 横オーバーフローがない場合は素通し
          if (el.scrollWidth <= el.clientWidth) return
          
          // 横スクロールバーが出ている場合は、マウスホイールで横スクロール
          if (e.deltaY !== 0) {
            try {
              e.preventDefault()
            } catch (err) {
              // preventDefaultが失敗した場合は無視
            }
            el.scrollLeft += e.deltaY
          }
        }
        
        // より互換性の高いイベントリスナーの設定
        try {
          el.addEventListener('wheel', onWheel, { passive: false })
        } catch (err) {
          // 古いブラウザやpassive: falseが使えない場合のフォールバック
          el.addEventListener('wheel', onWheel as any)
        }
        ;(el as any)._wheelHandler = onWheel
      })
    }

    // 初回設定
    const initialTimeoutId = setTimeout(setupWheelHandlers, 100)
    
    // 定期的にチェックしてイベントリスナーを設定（新しいテーブルが追加された場合に対応）
    const intervalId = setInterval(setupWheelHandlers, 500)
    
    // クリーンアップ
    return () => {
      clearTimeout(initialTimeoutId)
      clearInterval(intervalId)
      
      // すべてのイベントリスナーを削除
      const containers = Array.from(document.querySelectorAll('.message-content .table-scroll')) as HTMLDivElement[]
      containers.forEach((el) => {
        if ((el as any)._wheelHandler) {
          el.removeEventListener('wheel', (el as any)._wheelHandler)
          delete (el as any)._wheelHandler
        }
      })
    }
  }, [messages, stateRestored])

  // Markdown -> HTML（GFMテーブル対応）
  const renderMarkdown = (md: string) => {
    marked.setOptions({ gfm: true, breaks: true })
    const html = marked.parse(md || '') as string
    const sanitized = DOMPurify.sanitize(html)
    return enhanceTableDates(sanitized)
  }

  // 表セル内の日付を検出し、相対日数バッジを付与
  const enhanceTableDates = (html: string): string => {
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')
      const tables = Array.from(doc.querySelectorAll('table'))
      if (tables.length === 0) return html

      const datePatterns: RegExp[] = [
        /(\d{4})-(\d{1,2})-(\d{1,2})/g,     // YYYY-MM-DD
        /(\d{4})\/(\d{1,2})\/(\d{1,2})/g, // YYYY/MM/DD
        /(^|\s)(\d{1,2})\/(\d{1,2})(?=\s|$)/g, // MM/DD (今年)
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
        // 既に処理済みならスキップ
        if (cell.querySelector('.date-badge')) return
        const walker = doc.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
        const textNodes: Text[] = []
        let n: Node | null
        while ((n = walker.nextNode())) {
          if (n.nodeType === Node.TEXT_NODE && n.nodeValue && n.nodeValue.trim() !== '') {
            textNodes.push(n as Text)
          }
        }

        for (const t of textNodes) {
          let changed = false
          let content = t.nodeValue || ''

          // 累積フラグで複数パターンを順次適用
          for (const re of datePatterns) {
            re.lastIndex = 0
            const frag = doc.createDocumentFragment()
            let lastIndex = 0
            let match: RegExpExecArray | null
            let any = false
            while ((match = re.exec(content))) {
              any = true
              // 追加: 直前テキスト
              frag.appendChild(doc.createTextNode(content.slice(lastIndex, match.index)))

              // 解析
              let y: number, m: number, d: number
              if (match.length >= 4 && re !== datePatterns[2]) {
                // YYYY-.. または YYYY/..
                y = parseInt(match[1], 10)
                m = parseInt(match[2], 10) - 1
                d = parseInt(match[3], 10)
              } else {
                // MM/DD（今年）
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
              // 残りテキスト
              frag.appendChild(doc.createTextNode(content.slice(lastIndex)))
              t.parentNode?.replaceChild(frag, t)
              changed = true
              break // 同一ノードへの多重適用を避ける
            }
          }

          if (changed) break
        }
      }

      tables.forEach(tbl => {
        const cells = tbl.querySelectorAll('td, th')
        cells.forEach(c => processCell(c as HTMLElement))

        // テーブルを横スクロール可能なラッパーで包む（重複包みを回避）
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

  const handleSend = async () => {
    if (!canSend) return
    const text = chatInput.trim()
    setChatInput('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setSending(true)
    
    // 既存のEventSourceをクリーンアップ
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    handleStreamingMessage(text).catch((e: any) => {
      const msg = e?.message || '送信に失敗しました'
      setMessages((prev) => [...prev, { role: 'assistant', content: `エラー: ${msg}` }])
      setSending(false)
      setIsGenerating(false)
    })
  }

  const handleStopGeneration = async () => {
    // Dify APIに停止リクエストを送信
    if (currentTaskId) {
      try {
        await api.post(`/api/chat/stop/${currentTaskId}`, {
          user: 'default_user' // 環境変数から取得するか、固定値を使用
        })
      } catch (error) {
        // Stop request failed - silently handle
        // エラーが発生してもローカルでの停止は実行
      }
    }
    
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setIsGenerating(false)
    setSending(false)
    setCurrentTaskId(null)
  }


  // アクションJSONを検出する関数（単一オブジェクトまたは配列を返す。配列の場合は複数アクション）
  const detectActionFromContent = (content: string): any | any[] | null => {
    const validTypes = ['update_task', 'create_task', 'delete_task'];
    const isValidAction = (a: any) => a && typeof a === 'object' && validTypes.includes(a.action_type);

    // 複数のコードブロックをすべて抽出（```json または ``` で囲まれた中身）
    const extractAllCodeBlocks = (text: string): string[] => {
      const blocks: string[] = [];
      const regex = /```(?:json)?\s*([\s\S]*?)```/g;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        const inner = m[1].trim();
        if (inner) blocks.push(inner);
      }
      return blocks;
    };

    // 1ブロックの文字列をパースして有効なアクションを配列で返す（0〜n件）
    const parseBlockToActions = (block: string): any[] => {
      try {
        const parsed = JSON.parse(block);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isValidAction))
          return parsed;
        if (isValidAction(parsed)) return [parsed];
      } catch (_) { /* ignore */ }
      return [];
    };

    try {
      // 検出対象テキスト（--- がある場合はその以降）
      const searchContent = content.includes('---')
        ? content.split('---').slice(1).join('---').trim()
        : content;

      const blocks = extractAllCodeBlocks(searchContent);
      const collected: any[] = [];
      for (const block of blocks) {
        collected.push(...parseBlockToActions(block));
      }
      if (collected.length > 1) return collected;
      if (collected.length === 1) return collected[0];

      // パターン3: コードブロックなしで単一オブジェクトのJSONを直接検出
      const singlePattern = /\{[\s\S]*?"action_type":\s*"(update_task|create_task|delete_task)"[\s\S]*?\}/;
      const singleMatch = content.match(singlePattern);
      if (singleMatch) {
        try {
          const action = JSON.parse(singleMatch[0]);
          if (isValidAction(action)) return action;
        } catch (_) { /* ignore */ }
      }
    } catch (e) {
      console.debug('Action detection error:', e);
    }
    return null;
  };

  // アクションの説明を生成（タスク名・プロジェクト名を表示）
  const generateActionDescription = (action: any): string => {
    // タスクIDからタスク名を取得
    const getTaskName = (taskId?: number): string => {
      if (!taskId || !globalData?.tasks) return '';
      const task = globalData.tasks.find((t: any) => t.id === taskId);
      return task?.name || '';
    };
    // タスクIDからプロジェクト名を取得（タスクの project_id を参照）
    const getProjectNameByTaskId = (taskId?: number): string => {
      if (!taskId || !globalData?.tasks || !globalData?.projects) return '';
      const task = globalData.tasks.find((t: any) => t.id === taskId);
      const projectId = task?.project_id;
      if (projectId == null) return '';
      const project = globalData.projects.find((p: any) => p.id === projectId);
      return project?.name || '';
    };
    // プロジェクトIDからプロジェクト名を取得
    const getProjectNameById = (projectId?: number): string => {
      if (projectId == null || !globalData?.projects) return '';
      const project = globalData.projects.find((p: any) => p.id === projectId);
      return project?.name || '';
    };
    // 「プロジェクト名 / タスク名」の表示用文字列を組み立て
    const projectTaskLabel = (taskId: number | undefined, taskName: string, projectName: string): string => {
      if (projectName && taskName) return `プロジェクト「${projectName}」のタスク「${taskName}」`;
      if (taskName) return `タスク「${taskName}」`;
      return `タスクID ${taskId}`;
    };

    switch (action.action_type) {
      case 'update_task': {
        const taskName = getTaskName(action.task_id);
        const projectName = getProjectNameByTaskId(action.task_id);
        const taskDisplay = projectTaskLabel(action.task_id, taskName, projectName);
        const updates: string[] = [];
        if (action.task_data?.status) updates.push(`ステータス: ${action.task_data.status}`);
        if (action.task_data?.name) updates.push(`名前: ${action.task_data.name}`);
        if (action.task_data?.due_date) updates.push(`期日: ${action.task_data.due_date}`);
        if (action.task_data?.assigned_to) updates.push(`担当者ID: ${action.task_data.assigned_to}`);
        if (action.task_data?.description) updates.push(`説明: ${action.task_data.description}`);
        return `${taskDisplay} を更新します。\n変更内容: ${updates.length > 0 ? updates.join(', ') : 'その他の更新'}`;
      }
      case 'create_task': {
        const details: string[] = [];
        const createProjectName = getProjectNameById(action.task_data?.project_id);
        if (createProjectName) details.push(`プロジェクト: ${createProjectName}`);
        if (action.task_data?.name) details.push(`名前: ${action.task_data.name}`);
        if (action.task_data?.description) details.push(`説明: ${action.task_data.description}`);
        if (action.task_data?.status) details.push(`ステータス: ${action.task_data.status}`);
        if (action.task_data?.due_date) details.push(`期日: ${action.task_data.due_date}`);
        if (action.task_data?.assigned_to) details.push(`担当者ID: ${action.task_data.assigned_to}`);
        return `新しいタスクを作成します。\n${details.length > 0 ? details.join('\n') : '詳細は未設定'}`;
      }
      case 'delete_task': {
        const deleteTaskName = getTaskName(action.task_id);
        const deleteProjectName = getProjectNameByTaskId(action.task_id);
        const deleteTaskDisplay = projectTaskLabel(action.task_id, deleteTaskName, deleteProjectName);
        return `${deleteTaskDisplay} を削除します。\nこの操作は取り消せません。`;
      }
      default:
        return 'アクションを実行します。';
    }
  };

  // アクション確認ダイアログ用に、タスク作成時のプロジェクト一覧を取得
  const hasCreateTaskAction = pendingActions?.some(a => a.action_type === 'create_task') ?? false;
  useEffect(() => {
    const fetchProjectsForAction = async () => {
      if (!hasCreateTaskAction) return;
      try {
        const res = await api.get('/projects');
        if (Array.isArray(res.data)) {
          const list = res.data.map((p: any) => ({ id: p.id, name: p.name }));
          setProjectsForAction(list);
        }
      } catch (e) {
        console.debug('プロジェクト一覧の取得に失敗しました', e);
      }
    };
    fetchProjectsForAction();
  }, [hasCreateTaskAction]);

  // アクションを実行（複数件の場合は順に実行）
  const executeAction = async () => {
    if (!pendingActions || pendingActions.length === 0) return;
    // タスク操作にはログインが必要（AuthContext のトークンを優先し、localStorage と同期）
    const token = authToken ?? localStorage.getItem('token');
    if (!token) {
      setMessages(prev => [...prev, { role: 'assistant', content: '❌ タスク操作を行うにはログインが必要です。' }]);
      setPendingActions(null);
      return;
    }
    if (!localStorage.getItem('token')) {
      localStorage.setItem('token', token);
    }
    setIsExecutingAction(true);
    const results: string[] = [];
    try {
      for (const pa of pendingActions) {
        const payload: any = {
          action_type: pa.action_type,
          task_id: pa.task_id,
          task_data: pa.task_data ? { ...pa.task_data } : {},
        };
        if (pa.action_type === 'create_task') {
          payload.task_data = payload.task_data || {};
          if (selectedProjectIdForAction !== '') {
            payload.task_data.project_id = selectedProjectIdForAction;
          }
          // 実行した日付で開始日・終了日を設定
          const todayStr = format(new Date(), 'yyyy-MM-dd');
          payload.task_data.start_date = todayStr;
          payload.task_data.due_date = todayStr;
        }
        try {
          const response = await api.post('/chat/actions/task', payload);
          if (response.data.success) {
            results.push(`✅ ${response.data.message}`);
          } else {
            results.push(`❌ ${response.data.error ?? 'エラー'}`);
          }
        } catch (err: any) {
          const status = err.response?.status;
          const data = err.response?.data;
          const isAuthError = status === 401 || status === 403;
          const msg = isAuthError
            ? (data?.error || data?.detail || '認証が必要です。再度ログインしてください。')
            : (data?.error || data?.detail || err.message || 'エラー');
          results.push(`❌ ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
        }
      }
      const message = results.length === 1 ? results[0] : results.join('\n');
      setMessages(prev => [...prev, { role: 'assistant', content: message }]);
      if (results.some(r => r.startsWith('✅')) && refreshGlobalData) {
        await refreshGlobalData();
      }
    } finally {
      setIsExecutingAction(false);
      setPendingActions(null);
      setSelectedProjectIdForAction('');
    }
  };

  // アクションをキャンセル
  const cancelAction = () => {
    setPendingActions(null);
    setSelectedProjectIdForAction('');
  };

  const handleStreamingMessage = async (text: string) => {
    const url = new URL('/api/chat/stream', window.location.origin)
    url.searchParams.append('query', text)
    if (conversationId) {
      url.searchParams.append('conversation_id', conversationId)
    }
    console.debug('[chat] send SSE', { query: text, conversationId: conversationId || null, url: url.toString() })

    hasReceivedTaskActionRef.current = false
    const eventSource = new EventSource(url.toString())
    eventSourceRef.current = eventSource
    console.log('[chat] setting isGenerating to true')
    setIsGenerating(true)
    console.log('[chat] isGenerating set to true, current state:', isGenerating)

    let aiStarted = false
    let streamEnded = false
    let accumulatedContent = '' // 累積されたコンテンツを追跡
    let latestMessageId: string | null = null // 最新のmessage_idを直接保存

    eventSource.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data)
        
        if (data.task_id) {
          setCurrentTaskId(data.task_id)
        }
        
        // message_idの取得を複数の方法で試行
        let foundMessageId = null
        
        // 1. 直接message_idが含まれている場合
        if (data.message_id) {
          foundMessageId = data.message_id
        }
        // 2. node_finishedイベントでdata.outputs.answerにmessage_idが含まれている場合
        else if (data.event === 'node_finished' && data.data && data.data.outputs && data.data.outputs.answer) {
          const answerData = data.data.outputs.answer
          if (answerData.message_id) {
            foundMessageId = answerData.message_id
          }
        }
        // 3. data.data.message_idが含まれている場合
        else if (data.data && data.data.message_id) {
          foundMessageId = data.data.message_id
        }
        // 4. data.data.outputs.answer.message_idが含まれている場合
        else if (data.data && data.data.outputs && data.data.outputs.answer && data.data.outputs.answer.message_id) {
          foundMessageId = data.data.outputs.answer.message_id
        }
        
         if (foundMessageId) {
           setCurrentMessageId(foundMessageId)
           messageIdRef.current = foundMessageId // refにも保存
           latestMessageId = foundMessageId // 直接変数にも保存
         }
         
        if (data.conversation_id && !conversationId) {
          setConversationId(data.conversation_id)
        }
        
        if (data.answer) {
          // 累積コンテンツを更新
          accumulatedContent += data.answer
          
          if (!aiStarted) {
            aiStarted = true
            setMessages((prev) => {
              const newMessages = [...prev, { role: 'assistant' as const, content: accumulatedContent }]
              return newMessages
            })
          } else {
            // デバウンス処理：頻繁な更新を防ぐ
            if (updateTimeoutRef.current) {
              clearTimeout(updateTimeoutRef.current)
            }
            
            updateTimeoutRef.current = setTimeout(() => {
              setMessages((prev) => {
                if (prev.length === 0) return prev
                const lastIdx = prev.length - 1
                const last = prev[lastIdx]
                if (last.role !== 'assistant') {
                  return [...prev, { role: 'assistant' as const, content: accumulatedContent }]
                }
                // 既存のアシスタントメッセージを累積コンテンツで更新
                const updated = [...prev]
                updated[lastIdx] = { ...last, content: accumulatedContent }
                return updated
              })
            }, 50) // 50msのデバウンス
          }
        } else if (data.type === 'error') {
          const errorMsg = `ストリーミングエラー: ${data.detail || '不明なエラー'}`
          setMessages((prev) => [...prev, { role: 'assistant', content: errorMsg }])
          eventSource.close()
        }
      } catch (e) {
        // SSE message parse error - silently handle
      }
    })

    // バックエンドからのタスクアクション候補イベントを受信（単一 action / 複数 actions 両対応）
    eventSource.addEventListener('task_action', (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data?.type !== 'task_action_candidate') return
        const rawList = data.actions ?? (data.action ? [data.action] : [])
        if (!Array.isArray(rawList) || rawList.length === 0) return
        const list: PendingAction[] = rawList.map((a: any) => ({
          action_type: a.action_type,
          task_id: a.task_id,
          task_data: a.task_data,
          description: generateActionDescription(a),
        }))
        setPendingActions(list)
        hasReceivedTaskActionRef.current = true
      } catch (e) {
        console.debug('Failed to handle task_action event:', e)
      }
    })

    eventSource.addEventListener('message_end', (event) => {
      streamEnded = true
      
      // message_endイベントでもmessage_idを確認
      let messageIdFromEnd = null
      try {
        const data = JSON.parse(event.data)
        
         // 複数の場所でmessage_idを探す
         if (data.message_id) {
           messageIdFromEnd = data.message_id
           setCurrentMessageId(data.message_id)
           messageIdRef.current = data.message_id // refにも保存
           latestMessageId = data.message_id // 直接変数にも保存
         } else if (data.data && data.data.message_id) {
           messageIdFromEnd = data.data.message_id
           setCurrentMessageId(data.data.message_id)
           messageIdRef.current = data.data.message_id // refにも保存
           latestMessageId = data.data.message_id // 直接変数にも保存
         } else if (data.data && data.data.outputs && data.data.outputs.answer && data.data.outputs.answer.message_id) {
           messageIdFromEnd = data.data.outputs.answer.message_id
           setCurrentMessageId(data.data.outputs.answer.message_id)
           messageIdRef.current = data.data.outputs.answer.message_id // refにも保存
           latestMessageId = data.data.outputs.answer.message_id // 直接変数にも保存
         }
      } catch (error) {
        // Error parsing message_end data - silently handle
      }
      
      // 残りの更新を即座に実行
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
        updateTimeoutRef.current = null
      }
      
      // 最終的なメッセージを即座に更新
      setMessages((prev) => {
        if (prev.length === 0) return prev
        const lastIdx = prev.length - 1
        const last = prev[lastIdx]
        if (last.role === 'assistant') {
          const updated = [...prev]
          updated[lastIdx] = { ...last, content: accumulatedContent }
          return updated
        }
        return prev
      })
      
      // まだサーバー側から task_action イベントが来ていない場合のみ、
      // テキストからアクションJSONを検出するフォールバックを実行
      if (!hasReceivedTaskActionRef.current) {
        try {
          const detected = detectActionFromContent(accumulatedContent);
          if (detected != null) {
            const list = Array.isArray(detected) ? detected : [detected];
            const pendingList: PendingAction[] = list.map((a: any) => ({
              action_type: a.action_type,
              task_id: a.task_id,
              task_data: a.task_data,
              description: generateActionDescription(a),
            }));
            setPendingActions(pendingList);
          }
        } catch (e) {
          console.debug('Action detection error:', e);
        }
      }
      hasReceivedTaskActionRef.current = false
      
      eventSource.close()
      eventSourceRef.current = null
      setIsGenerating(false)
      setSending(false)
      setCurrentTaskId(null)
    })

    eventSource.onerror = (error) => {
      // デバッグ用の詳細ログ（開発時のみ）
      if (process.env.NODE_ENV === 'development') {
        console.debug('EventSource error:', {
          readyState: eventSource.readyState,
          url: eventSource.url,
          streamEnded,
          aiStarted,
          error
        })
      }
      
      // タイムアウトをクリア
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
        updateTimeoutRef.current = null
      }
      
      // 正常終了後や一部受信済みの場合はエラーを表示しない
      if (streamEnded || aiStarted || eventSource.readyState === EventSource.CLOSED) {
        eventSource.close()
        eventSourceRef.current = null
        setIsGenerating(false)
        setSending(false)
        setCurrentTaskId(null)
        setCurrentMessageId(null)
        return
      }
      
      // 実際の接続エラーの場合のみユーザーに通知
      eventSource.close()
      eventSourceRef.current = null
      setIsGenerating(false)
      setSending(false)
      setCurrentTaskId(null)
      setCurrentMessageId(null)
      setMessages((prev) => [...prev, { role: 'assistant', content: 'ストリーミング接続に失敗しました' }])
    }
  }


  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    )
  }

  const handleNewConversation = () => {
    if (eventSourceRef.current) {
      try { eventSourceRef.current.close() } catch {}
      eventSourceRef.current = null
    }
    setConversationId(null)
    setCurrentMessageId(null) // currentMessageIdもリセット
    messageIdRef.current = null // refもリセット
    setSending(false)
    setChatInput('')
    setMessages([DASHBOARD_WELCOME_MESSAGE])
    
    // 新しい会話開始時も状態を更新
    updateDashboardState({
      messages: [DASHBOARD_WELCOME_MESSAGE],
      conversationId: null,
      currentMessageId: null,
    });
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
      color: 'primary',
      bgGradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      path: '/admin/users',
      requiresAdmin: false,
    },
    {
      title: 'タスク',
      value: metrics?.tasks || 0,
      subValue: '登録済みタスク',
      icon: <TaskIcon sx={{ fontSize: 40 }} />,
      color: 'secondary',
      bgGradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      path: '/tasks',
      requiresAdmin: false,
    },
    {
      title: 'プロジェクト',
      value: metrics?.projects || 0,
      subValue: '登録済みプロジェクト',
      icon: <ProjectIcon sx={{ fontSize: 40 }} />,
      color: 'success',
      bgGradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      path: '/projects',
      requiresAdmin: false,
    },
  ]

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Typography 
        variant="h4" 
        gutterBottom 
        sx={{ 
          mb: 2,
          fontWeight: 600,
          color: 'text.primary',
        }}
      >
        ダッシュボード
      </Typography>

      <Box 
        sx={{ 
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            md: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 2.2fr)',
          },
          gap: 2,
          mb: 2,
        }}
      >
        {statCards.map((card, index) => {
          const canNavigate = !card.requiresAdmin || isAdmin
          
          return (
            <Paper
              key={index}
              elevation={2}
              onClick={() => {
                if (canNavigate) {
                  navigate(card.path)
                }
              }}
              sx={{
                p: 2,
                borderRadius: 2,
                position: 'relative',
                overflow: 'hidden',
                height: 252,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                transition: 'all 0.3s ease-in-out',
                cursor: canNavigate ? 'pointer' : 'default',
                opacity: canNavigate ? 1 : 0.7,
                '&:hover': canNavigate ? {
                  transform: 'translateY(-2px)',
                  boxShadow: 4,
                } : {},
              }}
            >
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: '80px',
                height: '80px',
                background: card.bgGradient,
                borderRadius: '50%',
                transform: 'translate(24px, -24px)',
                opacity: 0.1,
              }}
            />
            <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', height: '100%' }}>
              <Box sx={{ display: 'inline-flex', p: 1.5, borderRadius: 2, background: card.bgGradient, mb: 1.25, boxShadow: 2 }}>
                <Box sx={{ color: 'white' }}>{card.icon}</Box>
              </Box>
              <Typography variant="body1" sx={{ color: 'text.secondary', mb: 0.75, fontWeight: 500, fontSize: '0.95rem' }}>
                {card.title}
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: 'text.primary', lineHeight: 1.2, mb: 0.5 }}>
                {typeof card.value === 'number' && card.value < 0 ? '-' : card.value.toLocaleString()}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
                {card.subValue}
              </Typography>
            </Box>
          </Paper>
          )
        })}

        {/* 今日の予定パネル：高さ固定（約3件表示）、4件以上はスクロール。種別（タスク/会議/締切等）を表示 */}
        <Paper
          elevation={2}
          onClick={() => navigate('/calendar')}
          sx={{
            p: 2,
            borderRadius: 3,
            position: 'relative',
            overflow: 'hidden',
            height: 252,
            display: 'flex',
            flexDirection: 'column',
            transition: 'all 0.3s ease-in-out',
            cursor: 'pointer',
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow: 6,
            },
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: '120px',
              height: '120px',
              background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
              borderRadius: '50%',
              transform: 'translate(36px, -36px)',
              opacity: 0.12,
            }}
          />
          <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.25, flexShrink: 0 }}>
              <Box
                sx={{
                  display: 'inline-flex',
                  p: 1,
                  borderRadius: 2,
                  background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
                  boxShadow: 2,
                }}
              >
                <Box sx={{ color: 'white' }}>
                  <CalendarTodayIcon sx={{ fontSize: 24 }} />
                </Box>
              </Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.primary', fontSize: '0.95rem' }}>
                今日の予定
              </Typography>
            </Box>
            <Box
              sx={{
                height: 200,
                minHeight: 0,
                overflowY: 'auto',
                '&::-webkit-scrollbar': { width: 6 },
                '&::-webkit-scrollbar-thumb': { borderRadius: 3, bgcolor: 'action.hover' },
              }}
            >
              {todayItems.length === 0 ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 120, px: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                    今日の予定はありません
                  </Typography>
                </Box>
              ) : (
                todayItems.map((item) => (
                  <Box
                    key={`${item.type}-${item.id}`}
                    sx={{
                      py: 1.25,
                      px: 1.25,
                      mb: 1,
                      borderRadius: 1.5,
                      bgcolor: 'background.paper',
                      border: '1px solid',
                      borderColor: 'divider',
                      borderLeft: '4px solid',
                      borderLeftColor: item.type === 'event' ? 'info.main' : 'secondary.main',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 1.25,
                      '&:last-of-type': { mb: 0 },
                    }}
                  >
                    <Box
                      sx={{
                        flexShrink: 0,
                        width: 32,
                        height: 32,
                        borderRadius: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: item.type === 'event' ? 'info.light' : 'secondary.light',
                        color: item.type === 'event' ? 'info.dark' : 'secondary.dark',
                      }}
                    >
                      {item.type === 'event' ? (
                        <EventIcon sx={{ fontSize: 18 }} />
                      ) : (
                        <TaskIcon sx={{ fontSize: 18 }} />
                      )}
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.5 }}>
                        <Typography variant="body1" sx={{ fontWeight: 600, color: 'text.primary', lineHeight: 1.35 }} title={item.name}>
                          {item.name}
                        </Typography>
                        <Typography
                          component="span"
                          variant="caption"
                          sx={{
                            flexShrink: 0,
                            px: 0.75,
                            py: 0.2,
                            borderRadius: 1,
                            bgcolor: item.type === 'event' ? 'info.main' : 'secondary.main',
                            color: 'white',
                            fontWeight: 600,
                            fontSize: '0.7rem',
                          }}
                        >
                          {item.kindLabel}
                        </Typography>
                        {item.timeLabel != null && (
                          <Typography
                            component="span"
                            variant="caption"
                            sx={{
                              flexShrink: 0,
                              px: 0.6,
                              py: 0.15,
                              borderRadius: 0.75,
                              bgcolor: 'action.selected',
                              color: 'text.secondary',
                              fontSize: '0.7rem',
                              fontWeight: 500,
                            }}
                          >
                            {item.timeLabel}
                          </Typography>
                        )}
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <ProjectIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                          {item.projectName}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>
                ))
              )}
            </Box>
          </Box>
        </Paper>
      </Box>

		{/* チャット欄 */}
		<Box sx={{ width: '100%', mt: 2 }}>
		  <Paper sx={{ p: 2 }}>
			<Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
				<Typography variant="h6">
				  チャット
				</Typography>
				<Button size="small" variant="outlined" onClick={handleNewConversation}>new chat</Button>
			</Box>
			
			{/* チャットコンテナ */}
			<Box sx={{ position: 'relative', height: 400 }}>
			  {/* メッセージ一覧（LINE風 吹き出し） */}
			  <Box sx={{
			    border: '1px solid',
			    borderColor: 'divider',
			    borderRadius: 1,
			    p: 1.5,
			    height: 340,
			    overflow: 'auto',
			    backgroundColor: 'background.default',
			    display: 'flex',
			    flexDirection: 'column',
			    gap: 1,
			  }}>
			    {messages.map((m, i) => (
				  <Box key={i} sx={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <Box sx={{
					  maxWidth: m.role === 'assistant' ? '95%' : '75%',
					  px: 2,
					  py: m.role === 'assistant' ? 1 : 1.5,
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
                  '& .markdown-content': {
                    lineHeight: 1.35,
                    overflowX: 'auto',
                    maxWidth: '100%',
                    '& h1, & h2, & h3, & h4, & h5, & h6': {
                      margin: '6px 0 2px 0',
                      fontWeight: 600,
                      color: 'text.primary',
                    },
                    '& h1': { fontSize: '1.25rem' },
                    '& h2': { fontSize: '1.125rem' },
                    '& h3': { fontSize: '1rem' },
                  },
                  '& .markdown-content p': {
                    margin: '2px 0',
                    color: 'text.primary',
                  },
                  '& .markdown-content ul, & .markdown-content ol': {
                    margin: '4px 0 4px 1.25rem',
                    paddingLeft: '0.5rem',
                  },
                  '& .markdown-content li': {
                    margin: '1px 0',
                    color: 'text.primary',
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
                    backgroundColor: 'grey.100',
                    padding: '2px 4px',
                    borderRadius: '4px',
                    fontSize: '0.875rem',
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
                    fontSize: '0.95rem',
                    borderRadius: 8,
                    overflow: 'hidden',
                    boxShadow: 1,
                    width: 'max-content',
                  },
                  '& .markdown-content .table-scroll': {
                    overflowX: 'scroll',
                    overflowY: 'hidden',
                    maxWidth: '100%',
                    // 常時スクロールバー表示（プラットフォーム依存）
                    scrollbarWidth: 'auto',
                  },
                  '& .markdown-content th, & .markdown-content td': {
                    border: '1px solid',
                    borderColor: 'divider',
                    padding: '4px 8px',
                    verticalAlign: 'top',
                    whiteSpace: 'nowrap',
                    boxSizing: 'border-box',
                  },
                  '& .markdown-content th': {
                    backgroundColor: 'grey.100',
                    fontWeight: 600,
                  },
                  '& .markdown-content tbody tr:nth-of-type(odd) td': {
                    backgroundColor: 'grey.50',
                  },
                  '& .markdown-content tbody tr:hover td': {
                    backgroundColor: 'action.hover',
                  },
                  '& .markdown-content thead': {
                    position: 'static',
                  },
                  '& .markdown-content thead th': {
                    position: 'static',
                    backgroundColor: 'grey.100',
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
                    fontSize: '0.75rem',
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
                      style={{ overflowX: 'auto' }}
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
			  
			  {/* 入力欄と送信ボタン：固定位置 */}
			  <Box sx={{ 
			    position: 'absolute',
			    bottom: 0,
			    left: 0,
			    right: 0,
			    display: 'flex', 
			    gap: 1,
			  }}>
			    <TextField
				  fullWidth
				  size="small"
				  placeholder="メッセージを入力..."
				  value={chatInput}
				  onChange={(e) => setChatInput(e.target.value)}
				  onKeyDown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
						e.preventDefault();
						handleSend();
					}
				}}
				  disabled={sending}
			    />
			    <Button 
				  variant="contained" 
				  onClick={isGenerating ? handleStopGeneration : handleSend} 
				  disabled={!canSend && !isGenerating}
				  color={isGenerating ? 'error' : 'primary'}
			    >
				  {isGenerating ? '停止' : sending ? '送信中...' : '送信'}
			    </Button>
			  </Box>
			</Box>
		  </Paper>
		</Box>
      
      {/* アクション確認ダイアログ（単一・複数両対応） */}
      <Dialog
        open={pendingActions != null && pendingActions.length > 0}
        onClose={cancelAction}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {pendingActions != null && pendingActions.length > 0 && (() => {
            const hasDelete = pendingActions.some(a => a.action_type === 'delete_task');
            const hasCreate = pendingActions.some(a => a.action_type === 'create_task');
            const label = hasDelete ? 'タスクの削除' : hasCreate ? 'タスクの作成' : 'タスクの更新';
            const suffix = pendingActions.length > 1 ? `（${pendingActions.length}件）` : '';
            return `${label}${suffix}`;
          })()}
        </DialogTitle>
        <DialogContent>
          {pendingActions != null && (
            pendingActions.length === 1 ? (
              <Typography variant="body1" sx={{ mb: 2, whiteSpace: 'pre-line' }}>
                {pendingActions[0].description}
              </Typography>
            ) : (
              <Typography component="div" variant="body1" sx={{ mb: 2 }}>
                {pendingActions.map((pa, i) => (
                  <Box key={i} sx={{ mb: 1.5 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      {i + 1}. {pa.action_type === 'update_task' ? '更新' : pa.action_type === 'create_task' ? '作成' : '削除'}
                    </Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-line', pl: 1 }}>
                      {pa.description}
                    </Typography>
                  </Box>
                ))}
              </Typography>
            )
          )}
          {hasCreateTaskAction && (
            <Box sx={{ mt: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel id="action-project-select-label">プロジェクト（任意）</InputLabel>
                <Select
                  labelId="action-project-select-label"
                  value={selectedProjectIdForAction}
                  label="プロジェクト（任意）"
                  onChange={(e) => {
                    const value = e.target.value;
                    setSelectedProjectIdForAction(
                      typeof value === 'number' ? value : value === '' ? '' : Number(value)
                    );
                  }}
                >
                  <MenuItem value="">
                    <em>未指定（プロジェクトに紐づけない）</em>
                  </MenuItem>
                  {projectsForAction.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          )}
          <Typography variant="body2" color="text.secondary">
            この操作{pendingActions && pendingActions.length > 1 ? 'をすべて' : ''}実行しますか？
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={cancelAction} disabled={isExecutingAction}>
            キャンセル
          </Button>
          <Button
            onClick={executeAction}
            variant="contained"
            color={pendingActions?.some(a => a.action_type === 'delete_task') ? 'error' : 'primary'}
            disabled={isExecutingAction}
          >
            {isExecutingAction ? '実行中...' : '実行する'}
          </Button>
        </DialogActions>
      </Dialog>
      </Box>
    )
  }

export default Dashboard 