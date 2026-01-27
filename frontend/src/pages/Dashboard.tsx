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
  Event as EventIcon,
} from '@mui/icons-material'
import api from '../services/api'
import { DashboardMetrics } from '../types'
import { useDashboardPageState, usePageState } from '../contexts/PageStateContext'
import { useAuth } from '../contexts/AuthContext'

const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null)
  const messageIdRef = useRef<string | null>(null) // 直接参照用のref
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [lastSuggestedForMessageId, setLastSuggestedForMessageId] = useState<string | null>(null)
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // アクション確認ダイアログ用の状態
  interface PendingAction {
    action_type: 'update_task' | 'create_task' | 'delete_task';
    task_id?: number;
    task_data?: any;
    description: string;
  }
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isExecutingAction, setIsExecutingAction] = useState(false);
  const [projectsForAction, setProjectsForAction] = useState<Array<{ id: number; name: string }>>([]);
  const [selectedProjectIdForAction, setSelectedProjectIdForAction] = useState<number | ''>('');
  
  
  // ページ状態管理の使用
  const { dashboardState, updateDashboardState, isInitialLoad } = useDashboardPageState();
  const { refreshGlobalData } = usePageState();
  
  // 状態を分離（初期化時はページ状態から取得）
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [stateRestored, setStateRestored] = useState(false)
  const listEndRef = useRef<HTMLDivElement | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

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

  const canSend = useMemo(() => chatInput.trim().length > 0 && !sending && !isGenerating, [chatInput, sending, isGenerating])

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
    
    // 新しいメッセージ送信時に推奨質問をリセット（デモ質問も含む）
    setSuggestedQuestions([])
    setShowSuggestions(false)
    setLastSuggestedForMessageId(null)

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

  const fetchSuggestedQuestions = async (messageId: string) => {
    if (!messageId) return
    
    // conversation_idとmessage_idが同じ場合はスキップ（ただし、conversationIdがnullの場合は許可）
    if (messageId === conversationId && conversationId !== null) return
    
    setIsLoadingSuggestions(true)
    try {
      const apiUrl = `/suggestions/${messageId}?user=dify1@studiobokan.com`
      const response = await api.get(apiUrl)
      
      // レスポンス構造に応じて配列を取得
      let suggestions = []
      if (response.data?.suggestions && Array.isArray(response.data.suggestions)) {
        suggestions = response.data.suggestions
      } else if (response.data?.data && Array.isArray(response.data.data)) {
        suggestions = response.data.data
      }
      
      // 推奨質問が空の場合は何も表示しない
      if (suggestions.length === 0) {
        setShowSuggestions(false)
        setIsLoadingSuggestions(false)
        return
      }
      
      setSuggestedQuestions(suggestions)
      setShowSuggestions(true)
      setLastSuggestedForMessageId(messageId)
    } catch (error) {
      // エラー時は推奨質問を表示しない
      setSuggestedQuestions([])
      setShowSuggestions(false)
    } finally {
      setIsLoadingSuggestions(false)
    }
  }

  const handleSuggestedQuestion = (question: string) => {
    setChatInput(question)
    setShowSuggestions(false)
    // 自動的に送信
    setTimeout(() => {
      handleSend()
    }, 100)
  }

  // アクションJSONを検出する関数
  const detectActionFromContent = (content: string): any | null => {
    try {
      // JSON形式のアクションを検出（複数のパターンに対応）
      const jsonPatterns = [
        /\{[\s\S]*?"action_type"[\s\S]*?\}/,  // 基本的なJSONパターン
        /\{[\s\S]*?"action_type":\s*"(update_task|create_task|delete_task)"[\s\S]*?\}/,  // より具体的なパターン
      ];
      
      for (const pattern of jsonPatterns) {
        const match = content.match(pattern);
        if (match) {
          try {
            const action = JSON.parse(match[0]);
            if (['update_task', 'create_task', 'delete_task'].includes(action.action_type)) {
              return action;
            }
          } catch (e) {
            // JSON解析エラーは次のパターンを試す
            continue;
          }
        }
      }
      
      // コードブロック内のJSONも検出
      const codeBlockPattern = /```(?:json)?\s*(\{[\s\S]*?"action_type"[\s\S]*?\})\s*```/;
      const codeMatch = content.match(codeBlockPattern);
      if (codeMatch) {
        try {
          const action = JSON.parse(codeMatch[1]);
          if (['update_task', 'create_task', 'delete_task'].includes(action.action_type)) {
            return action;
          }
        } catch (e) {
          // JSON解析エラーは無視
        }
      }
    } catch (e) {
      // エラーは無視
      console.debug('Action detection error:', e);
    }
    
    return null;
  };

  // アクションの説明を生成
  const generateActionDescription = (action: any): string => {
    switch (action.action_type) {
      case 'update_task':
        const updates: string[] = [];
        if (action.task_data?.status) updates.push(`ステータス: ${action.task_data.status}`);
        if (action.task_data?.name) updates.push(`名前: ${action.task_data.name}`);
        if (action.task_data?.due_date) updates.push(`期日: ${action.task_data.due_date}`);
        if (action.task_data?.assigned_to) updates.push(`担当者ID: ${action.task_data.assigned_to}`);
        if (action.task_data?.description) updates.push(`説明: ${action.task_data.description}`);
        return `タスクID ${action.task_id} を更新します。\n変更内容: ${updates.length > 0 ? updates.join(', ') : 'その他の更新'}`;
      
      case 'create_task':
        const details: string[] = [];
        if (action.task_data?.name) details.push(`名前: ${action.task_data.name}`);
        if (action.task_data?.description) details.push(`説明: ${action.task_data.description}`);
        if (action.task_data?.status) details.push(`ステータス: ${action.task_data.status}`);
        if (action.task_data?.due_date) details.push(`期日: ${action.task_data.due_date}`);
        if (action.task_data?.assigned_to) details.push(`担当者ID: ${action.task_data.assigned_to}`);
        return `新しいタスクを作成します。\n${details.length > 0 ? details.join('\n') : '詳細は未設定'}`;
      
      case 'delete_task':
        return `タスクID ${action.task_id} を削除します。\nこの操作は取り消せません。`;
      
      default:
        return 'アクションを実行します。';
    }
  };

  // アクション確認ダイアログ用に、タスク作成時のプロジェクト一覧を取得
  useEffect(() => {
    const fetchProjectsForAction = async () => {
      if (pendingAction?.action_type !== 'create_task') return;
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
  }, [pendingAction]);

  // アクションを実行
  const executeAction = async () => {
    if (!pendingAction) return;
    
    setIsExecutingAction(true);
    try {
      // 送信前にペイロードを構築（必要に応じてproject_idを付与）
      const payload: any = {
        action_type: pendingAction.action_type,
        task_id: pendingAction.task_id,
        task_data: pendingAction.task_data ? { ...pendingAction.task_data } : {},
      };

      // タスク作成時にユーザーがプロジェクトを選択していれば、そのIDを付与
      if (
        pendingAction.action_type === 'create_task' &&
        selectedProjectIdForAction !== ''
      ) {
        payload.task_data.project_id = selectedProjectIdForAction;
      }

      const response = await api.post('/chat/actions/task', payload);
      
      if (response.data.success) {
        // 成功メッセージをチャットに追加
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ ${response.data.message}`
        }]);
        
        // グローバルデータを更新（タスク一覧を再取得）
        if (refreshGlobalData) {
          await refreshGlobalData();
        }
      } else {
        // エラーメッセージをチャットに追加
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `❌ エラー: ${response.data.error}`
        }]);
      }
    } catch (error: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ エラーが発生しました: ${error.response?.data?.error || error.message}`
      }]);
    } finally {
      setIsExecutingAction(false);
      setPendingAction(null);
      setSelectedProjectIdForAction('');
    }
  };

  // アクションをキャンセル
  const cancelAction = () => {
    setPendingAction(null);
    setSelectedProjectIdForAction('');
  };

  const handleStreamingMessage = async (text: string) => {
    const url = new URL('/api/chat/stream', window.location.origin)
    url.searchParams.append('query', text)
    if (conversationId) {
      url.searchParams.append('conversation_id', conversationId)
    }
    console.debug('[chat] send SSE', { query: text, conversationId: conversationId || null, url: url.toString() })

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

    // バックエンドからのタスクアクション候補イベントを受信
    eventSource.addEventListener('task_action', (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data?.type === 'task_action_candidate' && data.action) {
          const action = data.action
          const description = generateActionDescription(action)
          setPendingAction({
            action_type: action.action_type,
            task_id: action.task_id,
            task_data: action.task_data,
            description,
          })
        }
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
      if (!pendingAction) {
        try {
          const action = detectActionFromContent(accumulatedContent);
          if (action) {
            const description = generateActionDescription(action);
            setPendingAction({
              action_type: action.action_type,
              task_id: action.task_id,
              task_data: action.task_data,
              description: description
            });
          }
        } catch (e) {
          // アクション検出エラーは無視
          console.debug('Action detection error:', e);
        }
      }
      
      eventSource.close()
      eventSourceRef.current = null
      setIsGenerating(false)
      setSending(false)
      setCurrentTaskId(null)
      // setCurrentMessageId(null) // message_idを保持して推奨質問取得に使用
      
       // 自動表示は無効化（手動ボタンでのみ表示）
       // 推奨質問を取得
       // メッセージが存在し、推奨質問がまだ取得されていない場合
       // if (messages.length > 0 && suggestedQuestions.length === 0 && !isLoadingSuggestions) {
       //   // refから直接message_idを取得
       //   const messageIdToUse = messageIdRef.current || latestMessageId || messageIdFromEnd || currentMessageId
       //   
       //   if (messageIdToUse && messageIdToUse !== conversationId) {
       //     // 少し遅延を入れてDB反映を待つ
       //     setTimeout(() => {
       //       fetchSuggestedQuestions(messageIdToUse)
       //     }, 500)
       //   }
       // }
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
    
    // 推奨質問の状態もリセット（デモ質問は表示しない）
    setSuggestedQuestions([])
    setShowSuggestions(false)
    setLastSuggestedForMessageId(null)
    
    const initialMessage = { role: 'assistant' as const, content: 'ようこそ！何かお聞きになりたいことはありますか？' }
    setMessages([initialMessage])
    
    // デモ質問は表示しない
    setSuggestedQuestions([])
    setShowSuggestions(false)
    
    // 新しい会話開始時も状態を更新
    updateDashboardState({
      messages: [initialMessage],
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
      icon: <PeopleIcon sx={{ fontSize: 48 }} />,
      color: 'primary',
      bgGradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      path: '/admin/users',
      requiresAdmin: true, // 管理者専用ページ
    },
    {
      title: 'タスク',
      value: metrics?.tasks || 0,
      subValue: '登録済みタスク',
      icon: <TaskIcon sx={{ fontSize: 48 }} />,
      color: 'secondary',
      bgGradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      path: '/tasks',
      requiresAdmin: false,
    },
    {
      title: 'プロジェクト',
      value: metrics?.projects || 0,
      subValue: '登録済みプロジェクト',
      icon: <ProjectIcon sx={{ fontSize: 48 }} />,
      color: 'success',
      bgGradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      path: '/projects',
      requiresAdmin: false,
    },
    {
      title: 'イベント',
      value: metrics?.events || 0,
      subValue: '登録済みイベント',
      icon: <EventIcon sx={{ fontSize: 48 }} />,
      color: 'info',
      bgGradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      path: '/calendar',
      requiresAdmin: false,
    },
  ]

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography 
        variant="h4" 
        gutterBottom 
        sx={{ 
          mb: 4,
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
            md: 'repeat(4, 1fr)',
          },
          gap: 3,
          mb: 4,
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
                p: 3,
                borderRadius: 3,
                position: 'relative',
                overflow: 'hidden',
                transition: 'all 0.3s ease-in-out',
                cursor: canNavigate ? 'pointer' : 'default',
                opacity: canNavigate ? 1 : 0.7,
                '&:hover': canNavigate ? {
                  transform: 'translateY(-4px)',
                  boxShadow: 6,
                } : {},
              }}
            >
            {/* 背景グラデーション */}
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: '120px',
                height: '120px',
                background: card.bgGradient,
                borderRadius: '50%',
                transform: 'translate(30px, -30px)',
                opacity: 0.1,
              }}
            />
            
            <Box sx={{ position: 'relative', zIndex: 1 }}>
              {/* アイコン */}
              <Box
                sx={{
                  display: 'inline-flex',
                  p: 1.5,
                  borderRadius: 2,
                  background: card.bgGradient,
                  mb: 2,
                  boxShadow: 2,
                }}
              >
                <Box sx={{ color: 'white' }}>
                  {card.icon}
                </Box>
              </Box>
              
              {/* タイトル */}
              <Typography
                variant="body1"
                sx={{
                  color: 'text.secondary',
                  mb: 1,
                  fontWeight: 500,
                  fontSize: '0.875rem',
                }}
              >
                {card.title}
              </Typography>
              
              {/* 数値 */}
              <Typography
                variant="h3"
                sx={{
                  fontWeight: 700,
                  mb: 0.5,
                  color: 'text.primary',
                  lineHeight: 1.2,
                }}
              >
                {typeof card.value === 'number' && card.value < 0 ? '-' : card.value.toLocaleString()}
              </Typography>
              
              {/* サブタイトル */}
              <Typography
                variant="caption"
                sx={{
                  color: 'text.secondary',
                  fontSize: '0.75rem',
                }}
              >
                {card.subValue}
              </Typography>
            </Box>
          </Paper>
          )
        })}
      </Box>

		{/* チャット欄 */}
		<Box sx={{ width: '100%', mt: 3 }}>
		  <Paper sx={{ p: 2 }}>
			<Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
				<Typography variant="h6">
				  チャット
				</Typography>
				<Button size="small" variant="outlined" onClick={handleNewConversation}>new chat</Button>
			</Box>
			
			{/* チャットコンテナ：固定高さで推奨質問スペースを確保 */}
			<Box sx={{ position: 'relative', height: 520 }}>
			  {/* メッセージ一覧（LINE風 吹き出し） */}
			  <Box sx={{
			    border: '1px solid',
			    borderColor: 'divider',
			    borderRadius: 1,
			    p: 1.5,
			    height: showSuggestions && suggestedQuestions.length > 0 ? 360 : 440,
			    overflow: 'auto',
			    backgroundColor: 'background.default',
			    display: 'flex',
			    flexDirection: 'column',
			    gap: 1,
			    transition: 'height 0.3s ease',
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
			  
			  {/* 予測された質問：固定位置に表示 */}
			  {showSuggestions && 
			    suggestedQuestions.length > 0 && 
			    !isLoadingSuggestions && (
			    <Box sx={{ 
			      position: 'absolute',
			      bottom: 56, // 入力欄の高さ分上に配置
			      left: 0,
			      right: 0,
			      mt: 2,
			      mb: 1,
			    }}>
				  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
				    <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.875rem' }}>
				      予測された質問 ({suggestedQuestions.length}件):
				    </Typography>
				    <Button
				      size="small"
				      onClick={() => setShowSuggestions(false)}
				      sx={{ 
				        fontSize: '0.75rem',
				        minWidth: 'auto',
				        px: 1,
				        py: 0,
				      }}
				    >
				      非表示
				    </Button>
				  </Box>
				  <Box sx={{ 
				    display: 'flex', 
				    gap: 1, 
				    overflowX: 'auto',
				    pb: 1,
				    '&::-webkit-scrollbar': {
				      height: '4px',
				    },
				    '&::-webkit-scrollbar-track': {
				      backgroundColor: 'rgba(0,0,0,0.1)',
				      borderRadius: '2px',
				    },
				    '&::-webkit-scrollbar-thumb': {
				      backgroundColor: 'rgba(0,0,0,0.3)',
				      borderRadius: '2px',
				    },
				  }}>
				    {isLoadingSuggestions ? (
				      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1 }}>
					    <CircularProgress size={16} />
					    <Typography variant="body2" color="text.secondary">
						    予測された質問を生成中...
					    </Typography>
					  </Box>
				    ) : (
					  suggestedQuestions.map((question, index) => (
					    <Button
						  key={index}
						  variant="outlined"
						  size="small"
						  onClick={() => handleSuggestedQuestion(question)}
						  disabled={sending || isGenerating}
						  sx={{
						    fontSize: '0.75rem',
						    textTransform: 'none',
						    borderRadius: 3,
						    px: 2,
						    py: 0.5,
						    minWidth: 'auto',
						    whiteSpace: 'nowrap',
						    flexShrink: 0,
						    borderColor: 'primary.light',
						    color: 'primary.main',
						    '&:hover': {
							  backgroundColor: 'primary.light',
							  color: 'primary.contrastText',
							  transform: 'translateY(-1px)',
							  boxShadow: 2,
						    },
						    transition: 'all 0.2s ease-in-out',
						  }}
					    >
						  {question}
					    </Button>
					  ))
				    )}
				  </Box>
			    </Box>
			  )}
			  
			  {/* 入力欄と送信ボタン：固定位置 */}
			  <Box sx={{ 
			    position: 'absolute',
			    bottom: 0,
			    left: 0,
			    right: 0,
			    display: 'flex', 
			    gap: 1,
			  }}>
			    <Button
			      variant="outlined"
			      size="small"
			      onClick={async () => {
			        if (showSuggestions) {
			          setShowSuggestions(false)
			        } else {
			          // 予測された質問を取得して表示
			          const messageIdToUse = messageIdRef.current || currentMessageId
			          if (messageIdToUse && messageIdToUse !== conversationId && messages.length > 1) {
			            await fetchSuggestedQuestions(messageIdToUse)
			          }
			        }
			      }}
			      disabled={sending || isGenerating || messages.length <= 1}
			      sx={{ 
			        fontSize: '0.75rem',
			        minWidth: 'auto',
			        px: 1.5,
			        whiteSpace: 'nowrap',
			      }}
			    >
			      {showSuggestions ? '質問非表示' : '予測質問'}
			    </Button>
			    <TextField
				  fullWidth
				  size="small"
				  placeholder="メッセージを入力..."
				  value={chatInput}
				  onChange={(e) => setChatInput(e.target.value)}
				  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
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
      
      {/* アクション確認ダイアログ */}
      <Dialog
        open={pendingAction !== null}
        onClose={cancelAction}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {pendingAction?.action_type === 'delete_task' ? 'タスクの削除' : 
           pendingAction?.action_type === 'create_task' ? 'タスクの作成' : 
           'タスクの更新'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2, whiteSpace: 'pre-line' }}>
            {pendingAction?.description}
          </Typography>
          {pendingAction?.action_type === 'create_task' && (
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
            この操作を実行しますか？
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={cancelAction} disabled={isExecutingAction}>
            キャンセル
          </Button>
          <Button
            onClick={executeAction}
            variant="contained"
            color={pendingAction?.action_type === 'delete_task' ? 'error' : 'primary'}
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