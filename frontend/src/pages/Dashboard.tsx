import React, { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import {
  Box,
  Paper,
  Typography,
  CircularProgress,
  TextField,
  Button,
} from '@mui/material'
import {
  People as PeopleIcon,
  Task as TaskIcon,
  Folder as ProjectIcon,
  Event as EventIcon,
} from '@mui/icons-material'
import api from '../services/api'
import { DashboardMetrics } from '../types'
import { useDashboardPageState } from '../contexts/PageStateContext'

const Dashboard: React.FC = () => {
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
  
  
  // ページ状態管理の使用
  const { dashboardState, updateDashboardState, isInitialLoad } = useDashboardPageState();
  
  // 状態を分離（初期化時はページ状態から取得）
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [stateRestored, setStateRestored] = useState(false)
  const listEndRef = useRef<HTMLDivElement | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // ページ状態が復元されたらローカル状態を更新
  useEffect(() => {
    if (!isInitialLoad && dashboardState.messages.length > 0) {
      console.log('Restoring dashboard state:', {
        messagesCount: dashboardState.messages.length,
        conversationId: dashboardState.conversationId,
        messages: dashboardState.messages.map(msg => ({
          role: msg.role,
          contentLength: msg.content.length,
          contentPreview: msg.content.substring(0, 50) + (msg.content.length > 50 ? '...' : '')
        }))
      });
      
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
        console.log('[chat] Restoring currentMessageId:', dashboardState.currentMessageId);
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
        console.error('Failed to fetch metrics:', err)
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
        console.log('Updating dashboard state:', {
          messagesCount: messages.length,
          conversationId: conversationId,
          isRestored: stateRestored,
          hasMessagesChanged,
          hasConversationChanged
        });
        
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
    const containers = Array.from(document.querySelectorAll('.message-content .table-scroll')) as HTMLDivElement[]
    const cleanups: Array<() => void> = []

    containers.forEach((el) => {
      if ((el as any)._wheelSetup) return
      const onWheel = (e: WheelEvent) => {
        // ピンチズームや修飾キー時は素通し
        if (e.ctrlKey) return
        // 横オーバーフローがない場合は素通し
        if (el.scrollWidth <= el.clientWidth) return
        // 垂直スクロール量が主であれば横スクロールに変換
        const dominantDelta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
        if (dominantDelta === 0) return
        e.preventDefault()
        el.scrollLeft += dominantDelta
      }
      el.addEventListener('wheel', onWheel, { passive: false })
      ;(el as any)._wheelSetup = true
      cleanups.push(() => {
        el.removeEventListener('wheel', onWheel as any)
        delete (el as any)._wheelSetup
      })
    })

    return () => { cleanups.forEach((fn) => fn()) }
  }, [messages])

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
        console.error('[chat] stop request failed:', error)
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
      console.error('[chat] Failed to fetch suggestions:', error)
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
        console.log('[chat] received SSE data:', data)
        console.log('[chat] event type:', data.event)
        console.log('[chat] data.message_id:', data.message_id)
        console.log('[chat] data.conversation_id:', data.conversation_id)
        console.log('[chat] data keys:', Object.keys(data))
        
        // より詳細な構造分析
        if (data.data) {
          console.log('[chat] data.data keys:', Object.keys(data.data))
          if (data.data.outputs) {
            console.log('[chat] data.data.outputs keys:', Object.keys(data.data.outputs))
            if (data.data.outputs.answer) {
              console.log('[chat] data.data.outputs.answer keys:', Object.keys(data.data.outputs.answer))
              console.log('[chat] data.data.outputs.answer.message_id:', data.data.outputs.answer.message_id)
            }
          }
        }
        
        console.log('[chat] full data structure:', JSON.stringify(data, null, 2))
        
        if (data.conversation_id) {
          console.debug('[chat] recv SSE', { conversation_id: data.conversation_id })
        }
        
        if (data.task_id) {
          console.log('[chat] received task_id:', data.task_id)
          setCurrentTaskId(data.task_id)
        }
        
        // message_idの取得を複数の方法で試行
        let foundMessageId = null
        
        // 1. 直接message_idが含まれている場合
        if (data.message_id) {
          foundMessageId = data.message_id
          console.log('[chat] received message_id directly:', data.message_id)
        }
        // 2. node_finishedイベントでdata.outputs.answerにmessage_idが含まれている場合
        else if (data.event === 'node_finished' && data.data && data.data.outputs && data.data.outputs.answer) {
          const answerData = data.data.outputs.answer
          if (answerData.message_id) {
            foundMessageId = answerData.message_id
            console.log('[chat] received message_id from node_finished:', answerData.message_id)
          }
        }
        // 3. data.data.message_idが含まれている場合
        else if (data.data && data.data.message_id) {
          foundMessageId = data.data.message_id
          console.log('[chat] received message_id from data.data:', data.data.message_id)
        }
        // 4. data.data.outputs.answer.message_idが含まれている場合
        else if (data.data && data.data.outputs && data.data.outputs.answer && data.data.outputs.answer.message_id) {
          foundMessageId = data.data.outputs.answer.message_id
          console.log('[chat] received message_id from data.data.outputs.answer:', data.data.outputs.answer.message_id)
        }
        
         if (foundMessageId) {
           console.log('[chat] Setting currentMessageId to:', foundMessageId)
           setCurrentMessageId(foundMessageId)
           messageIdRef.current = foundMessageId // refにも保存
           latestMessageId = foundMessageId // 直接変数にも保存
           console.log('[chat] saved message_id to latestMessageId and ref:', foundMessageId)
         } else {
           console.log('[chat] No message_id found in any location')
         }
        
        if (data.conversation_id && !conversationId) {
          setConversationId(data.conversation_id)
        }
        
        if (data.answer) {
          // 累積コンテンツを更新
          accumulatedContent += data.answer
          
          console.log('[chat] received answer chunk:', { 
            chunk: data.answer, 
            chunkLength: data.answer.length,
            accumulatedLength: accumulatedContent.length,
            aiStarted 
          });
          
          if (!aiStarted) {
            aiStarted = true
            console.log('[chat] starting new assistant message with:', data.answer);
            setMessages((prev) => {
              const newMessages = [...prev, { role: 'assistant' as const, content: accumulatedContent }]
              console.log('[chat] created new assistant message:', newMessages[newMessages.length - 1])
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
                  console.log('[chat] creating new assistant message:', accumulatedContent);
                  return [...prev, { role: 'assistant' as const, content: accumulatedContent }]
                }
                // 既存のアシスタントメッセージを累積コンテンツで更新
                const updated = [...prev]
                console.log('[chat] updating existing message with accumulated content:', { 
                  previousLength: last.content.length,
                  accumulatedLength: accumulatedContent.length,
                  contentPreview: accumulatedContent.substring(0, 100) + (accumulatedContent.length > 100 ? '...' : '')
                });
                updated[lastIdx] = { ...last, content: accumulatedContent }
                console.log('[chat] updated message:', updated[lastIdx])
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
        console.error('SSE message parse error:', e)
      }
    })

    eventSource.addEventListener('message_end', (event) => {
      streamEnded = true
      console.debug('[chat] stream ended, final accumulated content length:', accumulatedContent.length);
      
      // message_endイベントでもmessage_idを確認
      let messageIdFromEnd = null
      try {
        const data = JSON.parse(event.data)
        console.log('[chat] message_end event data:', data)
        console.log('[chat] message_end data keys:', Object.keys(data))
        
         // 複数の場所でmessage_idを探す
         if (data.message_id) {
           console.log('[chat] received message_id in message_end:', data.message_id)
           messageIdFromEnd = data.message_id
           console.log('[chat] Setting currentMessageId to:', data.message_id)
           setCurrentMessageId(data.message_id)
           messageIdRef.current = data.message_id // refにも保存
           latestMessageId = data.message_id // 直接変数にも保存
         } else if (data.data && data.data.message_id) {
           console.log('[chat] received message_id in message_end data.data:', data.data.message_id)
           messageIdFromEnd = data.data.message_id
           console.log('[chat] Setting currentMessageId to:', data.data.message_id)
           setCurrentMessageId(data.data.message_id)
           messageIdRef.current = data.data.message_id // refにも保存
           latestMessageId = data.data.message_id // 直接変数にも保存
         } else if (data.data && data.data.outputs && data.data.outputs.answer && data.data.outputs.answer.message_id) {
           console.log('[chat] received message_id in message_end data.data.outputs.answer:', data.data.outputs.answer.message_id)
           messageIdFromEnd = data.data.outputs.answer.message_id
           console.log('[chat] Setting currentMessageId to:', data.data.outputs.answer.message_id)
           setCurrentMessageId(data.data.outputs.answer.message_id)
           messageIdRef.current = data.data.outputs.answer.message_id // refにも保存
           latestMessageId = data.data.outputs.answer.message_id // 直接変数にも保存
         } else {
           console.log('[chat] No message_id found in message_end event')
           console.log('[chat] message_end full data structure:', JSON.stringify(data, null, 2))
         }
        
        // message_idが取得できた場合の確認ログ
        if (messageIdFromEnd) {
          console.log('[chat] message_id successfully set in message_end:', messageIdFromEnd)
        } else {
          console.log('[chat] No message_id found in message_end event')
        }
      } catch (error) {
        console.error('[chat] Error parsing message_end data:', error)
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
      
      eventSource.close()
      eventSourceRef.current = null
      setIsGenerating(false)
      setSending(false)
      setCurrentTaskId(null)
      // setCurrentMessageId(null) // message_idを保持して推奨質問取得に使用
      
       // 推奨質問を取得
       // メッセージが存在し、推奨質問がまだ取得されていない場合
       if (messages.length > 0 && suggestedQuestions.length === 0 && !isLoadingSuggestions) {
         // refから直接message_idを取得
         const messageIdToUse = messageIdRef.current || latestMessageId || messageIdFromEnd || currentMessageId
         
         if (messageIdToUse && messageIdToUse !== conversationId) {
           // 少し遅延を入れてDB反映を待つ
           setTimeout(() => {
             fetchSuggestedQuestions(messageIdToUse)
           }, 500)
         }
       }
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
      icon: <PeopleIcon sx={{ fontSize: 40, color: 'primary.main' }} />,
    },
    {
      title: 'タスク',
      value: metrics?.tasks || 0,
      subValue: '登録済みタスク',
      icon: <TaskIcon sx={{ fontSize: 40, color: 'secondary.main' }} />,
    },
    {
      title: 'プロジェクト',
      value: metrics?.projects || 0,
      subValue: '登録済みプロジェクト',
      icon: <ProjectIcon sx={{ fontSize: 40, color: 'success.main' }} />,
    },
    {
      title: 'イベント',
      value: metrics?.events || 0,
      subValue: '登録済みイベント',
      icon: <EventIcon sx={{ fontSize: 40, color: 'info.main' }} />,
    },
  ]

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        ダッシュボード
      </Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        {statCards.map((card, index) => (
          <Box key={index} sx={{ flexGrow: 1, flexBasis: { xs: '100%', sm: 'calc(50% - 12px)', md: 'calc(25% - 12px)' }, minWidth: { xs: '100%', sm: 'calc(50% - 12px)', md: 'calc(25% - 12px)' } }}>
            <Paper sx={{ p: 2 }}>
              <Box display="flex" alignItems="center" mb={1}>
                {card.icon}
                <Typography variant="h6" sx={{ ml: 1 }}>
                  {card.title}
                </Typography>
              </Box>
              <Typography variant="h4" gutterBottom>
                {card.value}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {card.subValue}
              </Typography>
            </Paper>
          </Box>
        ))}

        {/* プロジェクト概要 */}
        <Box sx={{ flexGrow: 1, flexBasis: { xs: '100%', md: 'calc(50% - 12px)' }, minWidth: { xs: '100%', md: 'calc(50% - 12px)' } }}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              プロジェクト概要
            </Typography>
            {/* プロジェクト一覧のコンテンツ */}
          </Paper>
        </Box>

		{/* チャット欄 */}
		<Box sx={{ flexGrow: 1, flexBasis: '100%', minWidth: '100%' }}>
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
			  
			  {/* 推奨質問：固定位置に表示 */}
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
				  <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontSize: '0.875rem' }}>
				    推奨質問 ({suggestedQuestions.length}件):
				  </Typography>
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
						    推奨質問を生成中...
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
			    <TextField
				  fullWidth
				  size="small"
				  placeholder="メッセージを入力..."
				  value={chatInput}
				  onChange={(e) => setChatInput(e.target.value)}
				  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
				  onFocus={() => {
				    // 推奨質問がまだ取得されていない場合（メッセージがある時）
				    if (messages.length > 1 && suggestedQuestions.length === 0 && !isLoadingSuggestions) {
				      // refから直接message_idを取得
				      const messageIdToUse = messageIdRef.current || currentMessageId
				      
				      if (messageIdToUse && messageIdToUse !== conversationId) {
				        fetchSuggestedQuestions(messageIdToUse)
				      }
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
      </Box>
    </Box>
  )
}

export default Dashboard 