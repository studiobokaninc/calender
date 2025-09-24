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

const Dashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    { role: 'assistant', content: 'ようこそ！何かお聞きになりたいことはありますか？' },
  ])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const listEndRef = useRef<HTMLDivElement | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

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

  const canSend = useMemo(() => chatInput.trim().length > 0 && !sending, [chatInput, sending])

  const scrollToBottom = () => {
    if (listEndRef.current) {
      listEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

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

    // 既存のEventSourceをクリーンアップ
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    try {
      await handleStreamingMessage(text)
    } catch (e: any) {
      const msg = e?.message || '送信に失敗しました'
      setMessages((prev) => [...prev, { role: 'assistant', content: `エラー: ${msg}` }])
    } finally {
      setSending(false)
    }
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

    let aiStarted = false
    let streamEnded = false

    eventSource.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.conversation_id) {
          console.debug('[chat] recv SSE', { conversation_id: data.conversation_id })
        }
        
        if (data.conversation_id && !conversationId) {
          setConversationId(data.conversation_id)
        }
        
        if (data.answer) {
          if (!aiStarted) {
            aiStarted = true
            setMessages((prev) => [...prev, { role: 'assistant', content: data.answer }])
          } else {
            setMessages((prev) => {
              if (prev.length === 0) return prev
              const lastIdx = prev.length - 1
              const last = prev[lastIdx]
              if (last.role !== 'assistant') return [...prev, { role: 'assistant', content: data.answer }]
              const updated = [...prev]
              updated[lastIdx] = { ...last, content: last.content + data.answer }
              return updated
            })
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

    eventSource.addEventListener('message_end', () => {
      streamEnded = true
      eventSource.close()
      eventSourceRef.current = null
    })

    eventSource.onerror = (error) => {
      console.error('ストリーミングエラー:', error)
      // 正常終了後や一部受信済みの場合はエラーを表示しない
      if (streamEnded || aiStarted || eventSource.readyState === EventSource.CLOSED) {
        eventSource.close()
        eventSourceRef.current = null
        return
      }
      eventSource.close()
      eventSourceRef.current = null
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
    setSending(false)
    setChatInput('')
    setMessages([{ role: 'assistant', content: 'ようこそ！何かお聞きになりたいことはありますか？' }])
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
			{/* メッセージ一覧（LINE風 吹き出し） */}
			<Box sx={{
			  border: '1px solid',
			  borderColor: 'divider',
			  borderRadius: 1,
			  p: 1.5,
			  height: 360,
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
			{/* 入力欄と送信ボタン */}
			<Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
			  <TextField
				fullWidth
				size="small"
				placeholder="メッセージを入力..."
				value={chatInput}
				onChange={(e) => setChatInput(e.target.value)}
				onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
				disabled={sending}
			  />
			  <Button variant="contained" onClick={handleSend} disabled={!canSend}>{sending ? '送信中...' : '送信'}</Button>
			</Box>
		  </Paper>
		</Box>
      </Box>
    </Box>
  )
}

export default Dashboard 