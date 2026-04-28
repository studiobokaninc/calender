import React, { useEffect, useRef, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
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
  IconButton,
  InputAdornment,
  Breadcrumbs,
  Link,
  CircularProgress,
} from '@mui/material'
import {
  Assignment as AssignmentIcon,
  Today as TodayIcon,
  Warning as WarningIcon,
  Schedule as ScheduleIcon,
  Mic as MicIcon,
  Stop as StopIcon,
  VolumeUp as VolumeUpIcon,
  HelpOutline as HelpIcon,
  QuestionAnswer as QuestionAnswerIcon,
} from '@mui/icons-material'
import { VoiceHelpDialog } from '../components/VoiceHelpDialog'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { usePageState } from '../contexts/PageStateContext'
import { format, startOfDay, parseISO, isBefore, addDays, isSameDay, isValid } from 'date-fns'
import { Task } from '../types'




type TaskDisplayCategory = 'today' | 'delayed' | 'dueSoon' | 'other'

const DUE_SOON_DAYS = 7

const getTaskCategory = (task: Task): TaskDisplayCategory => {
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

const partitionTasksByCategory = (tasks: Task[]): Record<TaskDisplayCategory, Task[]> => {
  const result: Record<TaskDisplayCategory, Task[]> = {
    today: [],
    delayed: [],
    dueSoon: [],
    other: [],
  }
  tasks.forEach((task) => {
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
  const navigate = useNavigate()
  const { token: authToken, user: currentUser } = useAuth()
  const { refreshGlobalData, globalData } = usePageState()
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
  const [isSystemBusy, setIsSystemBusy] = useState(false)


  const myCategorizedTasks = useMemo(() => {
    if (!currentUser || !globalData?.tasks) return { today: [], delayed: [], dueSoon: [], other: [] }

    const isTaskCompleted = (task: Task): boolean => {
      const status = (task.status || '').toLowerCase()
      return status === 'completed' || status === '完了'
    }

    const relevantTasks: Task[] = []
    globalData.tasks.forEach((task: Task) => {
      if (task.assigned_to !== currentUser.id) return
      if (isTaskCompleted(task)) return

      relevantTasks.push(task)

      if (task.phases && Array.isArray(task.phases)) {
        task.phases.forEach((p: any, idx: number) => {
          if (p.date && !p.is_completed) {
            const phaseTask: any = {
              ...task,
              id: -1 * (task.id * 100 + idx),
              originalId: task.id,
              _phaseIndex: idx,
              name: `${task.name}: ${p.name}`,
              due_date: p.date,
              isPhase: true,
            }
            relevantTasks.push(phaseTask)
          }
        })
      }
    })

    return partitionTasksByCategory(relevantTasks)
  }, [currentUser, globalData?.tasks])


  // 音声認識（Web Speech API）
  const [isListening, setIsListening] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const recognitionRef = useRef<any>(null)
  const [speechSupport, setSpeechSupport] = useState<boolean | null>(null)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [currentlySpeakingText, setCurrentlySpeakingText] = useState<string | null>(null)
  const [autoSpeak, setAutoSpeak] = useState(false)
  const [autoSend, setAutoSend] = useState(false)
  const [openVoiceHelp, setOpenVoiceHelp] = useState(false)
  const autoSendTimerRef = useRef<NodeJS.Timeout | null>(null)

  const autoSpeakRef = useRef(autoSpeak)
  useEffect(() => { autoSpeakRef.current = autoSpeak }, [autoSpeak])

  const autoSendRef = useRef(autoSend)
  useEffect(() => { autoSendRef.current = autoSend }, [autoSend])

  const isGeneratingRef = useRef(isGenerating)
  useEffect(() => { isGeneratingRef.current = isGenerating }, [isGenerating])

  const isSpeakingRef = useRef(isSpeaking)
  useEffect(() => { isSpeakingRef.current = isSpeaking }, [isSpeaking])

  const isSystemBusyRef = useRef(isSystemBusy)
  useEffect(() => { isSystemBusyRef.current = isSystemBusy }, [isSystemBusy])

  const audioRef = useRef<HTMLAudioElement | null>(null)

  const speakText = (text: string) => {
    if (!text) return

    // 以前の音声を停止
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    // Markdownタグなどを除去してプレーンテキストにする
    const plainText = text.replace(/```[\s\S]*?```/g, '').replace(/[#*`]/g, '')
    if (!plainText) return

    // バックエンドの高品質TTSエンドポイントを使用
    const url = `/api/tts/generate?text=${encodeURIComponent(plainText)}`
    const audio = new Audio(url)
    audioRef.current = audio

    audio.onplay = () => {
      setIsSpeaking(true)
    }
    audio.onended = () => {
      setIsSpeaking(false)
      audioRef.current = null
    }
    audio.onerror = () => {
      console.error('High quality TTS playback failed')
      setIsSpeaking(false)
      audioRef.current = null
    }

    audio.play().catch(err => {
      console.error('Audio play error:', err)
      setIsSpeaking(false)
    })
  }

  // コンポーネントがアンマウントされる際（ページ遷移時など）に
  // 再生中の音声を停止する
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  const stopSpeaking = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setIsSpeaking(false)
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setCurrentlySpeakingText(null)
  }

  const canSend = useMemo(() => chatInput.trim().length > 0 && !sending && !isGenerating && !isSystemBusy, [chatInput, sending, isGenerating, isSystemBusy])

  const triggerManualSend = async (text: string) => {
    if (text.trim().length === 0 || sending || isGenerating || isSystemBusy) return
    if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current)
    setChatInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setSending(true)
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    if (autoSpeak) {
      // ブラウザの音声再生制限を解除するために無音を再生（プライミング）
      speakText('')
    }
    handleStreamingMessage(text).catch(() => {
      setSending(false)
      setIsGenerating(false)
    })
  }

  const handleSend = async () => {
    if (!canSend) return
    triggerManualSend(chatInput)
  }


  // 初回マウント時にタスク・プロジェクトを取得（レイアウト表示用）
  useEffect(() => {
    refreshGlobalData?.()
  }, [refreshGlobalData])

  // 重い処理（議事録解析）の状況を確認
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
    const interval = setInterval(checkStatus, 5000) // 5秒おきにチェック (15秒から短縮)
    return () => clearInterval(interval)
  }, [])




  // 音声認識の初期化（Web Speech API）
  useEffect(() => {
    const win = typeof window !== 'undefined' ? window : null
    const SR = win && ((win as any).SpeechRecognition || (win as any).webkitSpeechRecognition)
    if (!SR) {
      setSpeechSupport(false)
      return
    }
    const recognition = new SR()
    recognition.lang = 'ja-JP'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event: any) => {
      // 回答中、読み上げ中、またはシステムがビジーな場合は音声入力を完全に無視する
      if (isGeneratingRef.current || isSpeakingRef.current || isSystemBusyRef.current) {
        return
      }

      let final = ''
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript
        } else {
          interim += event.results[i][0].transcript
        }
      }
      if (final) {
        setChatInput(prev => {
          const newVal = (prev.trim() + ' ' + final.trim()).trim()
          // 自動送信フラグがオンの場合、指定時間（2秒）無入力なら送信する
          if (autoSendRef.current) {
            if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current)
            autoSendTimerRef.current = setTimeout(() => {
              // 最新の入力内容で送信
              triggerManualSend(newVal)
            }, 2000)
          }
          return newVal
        })
      }
      setInterimTranscript(interim)
    }
    recognition.onstart = () => {
      console.log('Speech recognition started')
      setIsListening(true)
    }
    recognition.onend = () => {
      setIsListening(false)
      setInterimTranscript('')
    }
    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error)
      if (event.error === 'not-allowed') {
        alert('マイクの使用が許可されていません。ブラウザのアドレスバーにある鍵アイコンなどからマイク設定を確認し、許可してください。\n※HTTP接続（IPアドレス直接入力など）の場合は制限されることがあります。')
      } else if (event.error === 'no-speech') {
        // 静かに終了
      } else {
        alert(`音声入力エラー: ${event.error}`)
      }
      setIsListening(false)
      setInterimTranscript('')
    }
    recognitionRef.current = recognition
    setSpeechSupport(true)

    // セキュアコンテキストチェック (HTTP経由のIPアクセスなどは制限される場合が多い)
    if (win && win.location.protocol !== 'https:' && win.location.hostname !== 'localhost' && !win.location.hostname.startsWith('127.')) {
      console.warn('SpeechRecognition might not work on insecure origins (HTTP).')
    }
    return () => {
      try {
        if (recognitionRef.current) {
          recognitionRef.current.abort?.()
          recognitionRef.current.stop?.()
        }
      } catch { /* noop */ }
      recognitionRef.current = null
    }
  }, [])

  const toggleVoiceInput = React.useCallback(() => {
    if (!recognitionRef.current) {
      if (speechSupport === false) alert('お使いのブラウザは音声認識に対応していません。Chrome や Edge をご利用ください。')
      return
    }
    if (isListening) {
      try {
        recognitionRef.current.stop()
        setIsListening(false)
      } catch (e) { console.error(e) }
      return
    }
    try {
      setInterimTranscript('')
      recognitionRef.current.start()
      setIsListening(true) // UIフィードバックを即座に出す
    } catch (e) {
      console.warn('Speech recognition start error:', e)
      setIsListening(false)
    }
  }, [isListening, speechSupport])



  const scrollToBottom = () => {
    if (listEndRef.current) listEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }
  useEffect(() => { scrollToBottom() }, [messages, isGenerating])

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
            try { e.preventDefault() } catch (_) { }
            el.scrollLeft += e.deltaY
          }
        }
        try {
          el.addEventListener('wheel', onWheel, { passive: false })
        } catch (_) {
          el.addEventListener('wheel', onWheel as any)
        }
        ; (el as any)._wheelHandler = onWheel
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
      } catch (_) { }
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
      } catch (_) { }
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

    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    hasReceivedTaskActionRef.current = false
    setIsGenerating(true)

    let streamEnded = false
    let aiStarted = false
    let accumulatedContent = ''

    try {
      const response = await fetch('/api/chat/user/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          query: text,
          conversation_id: conversationId,
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('Response body is null')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''

        for (const part of parts) {
          if (!part.trim()) continue
          const lines = part.split('\n')
          let eventType = 'message'
          let dataStr = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.substring(7).trim()
            else if (line.startsWith('data: ')) dataStr += line.substring(6)
          }

          if (!dataStr) continue
          if (eventType === 'retry') continue

          try {
            const data = JSON.parse(dataStr)

            if (eventType === 'message') {
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
              } else if (data.event === 'error') {
                setMessages(prev => [...prev, { role: 'assistant', content: `エラー: ${data.message || data.detail || '不明'}` }])
              }
            } else if (eventType === 'task_action') {
              if (data?.type === 'task_action_candidate') {
                const rawList = data.actions ?? (data.action ? [data.action] : [])
                if (Array.isArray(rawList) && rawList.length > 0) {
                  setPendingActions(
                    rawList.map((a: any) => ({
                      action_type: a.action_type,
                      task_id: a.task_id,
                      task_data: a.task_data,
                      description: generateActionDescription(a),
                    }))
                  )
                  hasReceivedTaskActionRef.current = true
                }
              }
            } else if (eventType === 'message_end') {
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
              setIsGenerating(false)
              if (autoSpeak) {
                speakText(accumulatedContent)
              }
              return
            }

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
          } catch (e) {
            console.error('JSON parse error', e)
          }
        }
      }
    } catch (e: any) {
      console.error('Streaming error', e)
      if (!streamEnded && !aiStarted) {
        setMessages(prev => [...prev, { role: 'assistant', content: `エラーが発生しました: ${e.message}` }])
      }
    } finally {
      setIsGenerating(false)
      setSending(false)
      setCurrentTaskId(null)
      // Refを使用して最新のautoSpeak設定を確認
      if (autoSpeakRef.current && accumulatedContent) {
        speakText(accumulatedContent)
      }
    }
  }

  const handleNewConversation = () => {
    if (eventSourceRef.current) {
      try { eventSourceRef.current.close() } catch { }
      eventSourceRef.current = null
    }
    setConversationId(null)
    setSending(false)
    setChatInput('')
    setMessages([CHAT_WELCOME_MESSAGE])
  }


  const handleStopGeneration = async () => {
    if (currentTaskId) {
      try {
        await api.post(`/chat/user/stop/${currentTaskId}`, { user: 'default_user' })
      } catch (_) { }
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setIsGenerating(false)
    setSending(false)
    setCurrentTaskId(null)
  }



  const hasCreateTaskAction = pendingActions?.some(a => a.action_type === 'create_task') ?? false
  useEffect(() => {
    if (!hasCreateTaskAction) return
    api.get('/projects')
      .then((res: any) => {
        if (Array.isArray(res.data)) setProjectsForAction(res.data.map((p: any) => ({ id: p.id, name: p.name })))
      })
      .catch(() => { })
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

  return (
    <Box sx={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      p: { xs: 1, sm: 2 },
      maxWidth: 1200,
      mx: 'auto',
      width: '100%'
    }}>
      <Box sx={{ mb: 4 }}>
        <Breadcrumbs sx={{ mb: 1.5 }}>
          <Link color="inherit" onClick={() => navigate('/dashboard')} sx={{ cursor: 'pointer', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
            App
          </Link>
          <Typography color="text.primary" sx={{ fontWeight: 500 }}>Chat</Typography>
        </Breadcrumbs>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <QuestionAnswerIcon sx={{ fontSize: '2rem', color: '#00BCD4' }} />
              <Typography
                variant="h4"
                sx={{
                  fontWeight: 800,
                  background: 'linear-gradient(45deg, #00BCD4 30%, #3F51B5 90%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  fontSize: { xs: '1.75rem', sm: '2.25rem' }
                }}
              >
                AI Assistant Chat
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.95rem' }}>
              AIアシスタントと対話して、タスクの作成や更新、スケジュールの確認ができます。
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: { xs: 1, sm: 0 }, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>自動読み上げ</Typography>
              <Chip
                size="small"
                label={autoSpeak ? 'ON' : 'OFF'}
                color={autoSpeak ? 'primary' : 'default'}
                onClick={() => setAutoSpeak(!autoSpeak)}
                sx={{ cursor: 'pointer', fontWeight: 'bold', height: 24 }}
              />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>話しかけモード</Typography>
              <Chip
                size="small"
                label={autoSend ? 'ON' : 'OFF'}
                color={autoSend ? 'primary' : 'default'}
                onClick={() => {
                  setAutoSend(!autoSend)
                  if (!autoSend && !isListening) {
                    toggleVoiceInput()
                  }
                }}
                sx={{ cursor: 'pointer', fontWeight: 'bold', height: 24 }}
              />
            </Box>
            <Tooltip title="音声機能の設定方法">
              <IconButton size="small" onClick={() => setOpenVoiceHelp(true)} sx={{ ml: -0.5 }}>
                <HelpIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
              </IconButton>
            </Tooltip>
            <Button size="small" variant="outlined" onClick={handleNewConversation}>
              新しい会話
            </Button>
            {isSpeaking && (
              <Button size="small" variant="contained" color="error" startIcon={<StopIcon />} onClick={stopSpeaking} sx={{ height: 32 }}>
                停止
              </Button>
            )}
          </Box>
        </Box>
      </Box>

      <Paper sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        mb: 2,
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        boxShadow: 2
      }}>
        {/* メッセージリスト */}
        <Box sx={{
          flex: 1,
          overflowY: 'auto',
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50'
        }}>
          {messages.map((m, i) => (
            <Box key={i} sx={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <Paper sx={{
                p: 2,
                maxWidth: '85%',
                bgcolor: m.role === 'user' ? 'primary.main' : 'background.paper',
                color: m.role === 'user' ? 'primary.contrastText' : 'text.primary',
                borderRadius: 2,
                borderTopRightRadius: m.role === 'user' ? 0 : 16,
                borderTopLeftRadius: m.role === 'user' ? 16 : 0,
                boxShadow: 1,
                '& .markdown-content': {
                  '& p': { m: 0 },
                  '& ul, & ol': { m: '4px 0 4px 1.5rem' },
                  '& table': { borderCollapse: 'collapse', width: '100%', mt: 1, mb: 1, color: 'text.primary' },
                  '& th, & td': { border: '1px solid', borderColor: 'divider', p: 0.5, fontSize: '0.875rem' },
                  '& th': { bgcolor: 'action.hover', fontWeight: 600 }
                }
              }}>
                {m.role === 'assistant' ? (
                  <>
                    <div className="markdown-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                      {currentlySpeakingText === m.content ? (
                        <Button
                          size="small"
                          variant="text"
                          color="error"
                          startIcon={<StopIcon />}
                          onClick={stopSpeaking}
                          sx={{ fontSize: '0.75rem', fontWeight: 'bold' }}
                        >
                          停止
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          variant="text"
                          color="primary"
                          startIcon={<VolumeUpIcon />}
                          onClick={() => speakText(m.content)}
                          sx={{
                            fontSize: '0.75rem',
                            fontWeight: 'bold',
                            bgcolor: 'action.hover',
                            px: 1,
                            borderRadius: 1,
                            '&:hover': { bgcolor: 'action.selected' }
                          }}
                        >
                          読み上げる
                        </Button>
                      )}
                    </Box>
                  </>
                ) : (
                  <Typography sx={{ whiteSpace: 'pre-wrap' }}>{m.content}</Typography>
                )}
              </Paper>
            </Box>
          ))}
          {isListening && interimTranscript && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
              <Paper sx={{ p: 1.5, bgcolor: 'action.hover', border: '1px dashed grey', opacity: 0.8, maxWidth: '80%', borderRadius: 2 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <MicIcon fontSize="small" sx={{ animation: 'pulse 1.5s infinite' }} />
                  {interimTranscript}...
                </Typography>
              </Paper>
            </Box>
          )}
          <style>{`
            @keyframes pulse {
              0% { opacity: 0.4; }
              50% { opacity: 1; }
              100% { opacity: 0.4; }
            }
          `}</style>
          {isGenerating && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, gap: 1.5, color: 'text.secondary' }}>
              <CircularProgress size={20} color="inherit" />
              <Typography variant="body2">AIが考え中または情報収集しています...</Typography>
            </Box>
          )}
          <div ref={listEndRef} />
        </Box>

        {/* 入力エリア */}
        <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
          {isSystemBusy && (
            <Typography variant="body2" color="error" sx={{ mb: 1.5, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <WarningIcon fontSize="small" /> 議事録の解析またはナレッジの更新中のため、現在チャットは利用できません。完了までお待ちください。
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>

            <TextField
              fullWidth
              multiline
              maxRows={4}
              placeholder="メッセージを入力... (Enterで送信, Shift+Enterで改行)"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={sending || isSystemBusy}

              InputProps={{
                endAdornment: speechSupport !== false && (
                  <InputAdornment position="end">
                    <Tooltip title={isListening ? '音声入力を停止' : '音声で入力'}>
                      <IconButton
                        color={isListening ? 'error' : 'default'}
                        onClick={toggleVoiceInput}
                        disabled={sending || isGenerating || isSystemBusy}

                        edge="end"
                      >
                        {isListening ? <StopIcon /> : <MicIcon />}
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              }}
            />
            <Button
              variant="contained"
              onClick={isGenerating ? handleStopGeneration : handleSend}
              disabled={(!chatInput.trim() || isSystemBusy) && !isGenerating}

              color={isGenerating ? 'error' : 'primary'}
              sx={{ minWidth: 80, height: 56 }}
            >
              {isGenerating ? '停止' : sending ? '...' : '送信'}
            </Button>
          </Box>
        </Box>
      </Paper>

      {/* User Task List */}
      {(myCategorizedTasks.delayed.length > 0 || myCategorizedTasks.today.length > 0 || myCategorizedTasks.dueSoon.length > 0 || myCategorizedTasks.other.length > 0) && (
        <Paper sx={{ p: 2, mb: 2, overflowX: 'auto', border: 1, borderColor: 'divider' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <AssignmentIcon fontSize="small" color="primary" />
            あなたの未完了タスク
          </Typography>
          <Box sx={{ display: 'flex', gap: 3, minWidth: 'fit-content' }}>
            {myCategorizedTasks.delayed.length > 0 && (
              <Box>
                <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                  <WarningIcon fontSize="small" /> 遅れている
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {myCategorizedTasks.delayed.map(t => (
                    <Tooltip key={t.id} enterTouchDelay={0} leaveTouchDelay={4000} title={
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>{t.name}</Typography>
                        <Typography variant="caption" display="block">プロジェクト: {globalData?.projects?.find((p: any) => p.id === t.project_id)?.name || '未設定'}</Typography>
                        <Typography variant="caption" display="block">期日: {t.due_date ? format(parseISO(t.due_date), 'yyyy/MM/dd') : '未設定'}</Typography>
                      </Box>
                    } arrow>
                      <Chip
                        label={t.name}
                        size="small"
                        color="error"
                        variant={(t as any).isPhase ? "outlined" : "filled"}
                        sx={{ justifyContent: 'flex-start', maxWidth: 200 }}
                      />
                    </Tooltip>
                  ))}
                </Box>
              </Box>
            )}
            {myCategorizedTasks.today.length > 0 && (
              <Box>
                <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                  <TodayIcon fontSize="small" /> 今日中
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {myCategorizedTasks.today.map(t => (
                    <Tooltip key={t.id} enterTouchDelay={0} leaveTouchDelay={4000} title={
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>{t.name}</Typography>
                        <Typography variant="caption" display="block">プロジェクト: {globalData?.projects?.find((p: any) => p.id === t.project_id)?.name || '未設定'}</Typography>
                        <Typography variant="caption" display="block">期日: {t.due_date ? format(parseISO(t.due_date), 'yyyy/MM/dd') : '未設定'}</Typography>
                      </Box>
                    } arrow>
                      <Chip
                        label={t.name}
                        size="small"
                        color="primary"
                        variant={(t as any).isPhase ? "outlined" : "filled"}
                        sx={{ justifyContent: 'flex-start', maxWidth: 200 }}
                      />
                    </Tooltip>
                  ))}
                </Box>
              </Box>
            )}
            {myCategorizedTasks.dueSoon.length > 0 && (
              <Box>
                <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                  <ScheduleIcon fontSize="small" /> 期限が近い
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {myCategorizedTasks.dueSoon.map(t => (
                    <Tooltip key={t.id} enterTouchDelay={0} leaveTouchDelay={4000} title={
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>{t.name}</Typography>
                        <Typography variant="caption" display="block">プロジェクト: {globalData?.projects?.find((p: any) => p.id === t.project_id)?.name || '未設定'}</Typography>
                        <Typography variant="caption" display="block">期日: {t.due_date ? format(parseISO(t.due_date), 'yyyy/MM/dd') : '未設定'}</Typography>
                      </Box>
                    } arrow>
                      <Chip
                        label={t.name}
                        size="small"
                        color="warning"
                        variant={(t as any).isPhase ? "outlined" : "filled"}
                        sx={{ justifyContent: 'flex-start', maxWidth: 200 }}
                      />
                    </Tooltip>
                  ))}
                </Box>
              </Box>
            )}
            {myCategorizedTasks.other.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold', mb: 0.5, display: 'block' }}>
                  その他
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {myCategorizedTasks.other.map(t => (
                    <Tooltip key={t.id} enterTouchDelay={0} leaveTouchDelay={4000} title={
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>{t.name}</Typography>
                        <Typography variant="caption" display="block">プロジェクト: {globalData?.projects?.find((p: any) => p.id === t.project_id)?.name || '未設定'}</Typography>
                        <Typography variant="caption" display="block">期日: {t.due_date ? format(parseISO(t.due_date), 'yyyy/MM/dd') : '未設定'}</Typography>
                      </Box>
                    } arrow>
                      <Chip
                        label={t.name}
                        size="small"
                        variant="outlined"
                        sx={{ justifyContent: 'flex-start', maxWidth: 200, borderStyle: (t as any).isPhase ? 'dashed' : 'solid' }}
                      />
                    </Tooltip>
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        </Paper>
      )}

      {/* Pending Action Dialog */}
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
          <Button onClick={() => executeAction()} variant="contained" disabled={isExecutingAction}>
            {isExecutingAction ? '実行中...' : '実行する'}
          </Button>
        </DialogActions>
      </Dialog>
      {/* 音声ヘルプダイアログ */}
      <VoiceHelpDialog open={openVoiceHelp} onClose={() => setOpenVoiceHelp(false)} />
    </Box>
  )
}


export default ChatPage
