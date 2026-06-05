import React, { useState, ReactNode, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  AppBar,
  Box,
  CssBaseline,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  Divider,
  useTheme,
  useMediaQuery,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  CircularProgress,
  ListSubheader,
  InputAdornment,
  TextField,
  BottomNavigation,
  BottomNavigationAction,
  Paper,
} from '@mui/material'
import {
  Dashboard as DashboardIcon,
  CalendarMonth as CalendarIcon,
  Task as TaskIcon,
  Folder as ProjectIcon,
  People as UserIcon,
  Group as GroupIcon,
  BarChart as MetricsIcon,
  Logout as LogoutIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Storage as StorageIcon,
  EventNote as EventNoteIcon,
  Note as NoteIcon,
  Person as PersonIcon,
  QuestionAnswer as ChatIcon,
  AccessTime as AccessTimeIcon,
  Search as SearchIcon,
  Description as DescriptionIcon,
  LibraryBooks as KnowledgeIcon,
  ViewModule as TrackerIcon,
  SmartToy as AIRecommendedIcon,
} from '@mui/icons-material'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import LightModeIcon from '@mui/icons-material/LightMode'
import { useAuth } from '../contexts/AuthContext'
import { useThemeMode } from '../contexts/ThemeModeContext'
import api, { userActivityApi } from '../services/api'

import { debounce } from 'lodash'
import { ProjectEditDialog, TaskEditDialog, EventEditDialog } from './SearchEditDialogs'

interface LayoutProps {
  children?: ReactNode;
}

interface MenuItemType {
  text: string;
  icon: React.ReactElement;
  path: string;
  isAdmin?: boolean;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [isDrawerCollapsed, setIsDrawerCollapsed] = useState(false)
  const bottomNavRef = useRef<HTMLDivElement>(null)
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const shouldAutoCollapse = useMediaQuery(theme.breakpoints.down('md'))
  const location = useLocation()
  const [currentTitle, setCurrentTitle] = useState('')
  const { mode, toggleMode } = useThemeMode()

  // グローバル検索
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ projects: Array<{ id: number; name: string; description?: string }>; tasks: Array<{ id: number; name: string; project_id: number | null; project_name?: string | null }>; events: Array<{ id: number; title: string; start_time: string | null }> }>({ projects: [], tasks: [], events: [] })
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchEditTarget, setSearchEditTarget] = useState<{ type: 'project' | 'task' | 'event'; id: number } | null>(null)
  const fetchSearch = useCallback(
    debounce(async (q: string) => {
      if (!q.trim()) {
        setSearchResults({ projects: [], tasks: [], events: [] })
        return
      }
      setSearchLoading(true)
      try {
        const res = await api.get<{ projects?: Array<{ id: number; name: string; description?: string }>; tasks?: Array<{ id: number; name: string; project_id: number | null; project_name?: string | null }>; events?: Array<{ id: number; title: string; start_time: string | null }> }>('/search', { params: { q: q.trim(), limit: 10000 } })
        const data = res?.data
        setSearchResults({
          projects: Array.isArray(data?.projects) ? data.projects : [],
          tasks: Array.isArray(data?.tasks) ? data.tasks : [],
          events: Array.isArray(data?.events) ? data.events : [],
        })
      } catch {
        setSearchResults({ projects: [], tasks: [], events: [] })
      } finally {
        setSearchLoading(false)
      }
    }, 300),
    []
  )
  useEffect(() => {
    if (searchOpen && searchQuery.trim()) fetchSearch(searchQuery)
    else if (!searchQuery.trim()) setSearchResults({ projects: [], tasks: [], events: [] })
  }, [searchQuery, searchOpen, fetchSearch])
  const handleCloseSearch = () => {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults({ projects: [], tasks: [], events: [] })
  }
  const handleSearchResultClick = (type: 'project' | 'task' | 'event', id: number) => {
    setSearchEditTarget({ type, id })
    handleCloseSearch()
  }
  const handleSearchEditSaved = () => {
    window.dispatchEvent(new CustomEvent('globalDataRefreshed', { detail: {} }))
  }

  const drawerWidth = isDrawerCollapsed ? 65 : 240


  const toggleDrawer = () => {
    setIsDrawerCollapsed(!isDrawerCollapsed)
  }

  const allMenuItems: MenuItemType[] = [
    { text: 'ダッシュボード', icon: <DashboardIcon />, path: '/dashboard' },
    { text: 'チャット', icon: <ChatIcon />, path: '/chat' },
    { text: 'カレンダー', icon: <CalendarIcon />, path: '/calendar' },
    { text: 'プロジェクト', icon: <ProjectIcon />, path: '/projects' },
    { text: 'タスク', icon: <TaskIcon />, path: '/tasks' },
    { text: 'ユーザー', icon: <UserIcon />, path: '/admin/users', isAdmin: true },
    { text: '進捗トラッカー', icon: <TrackerIcon />, path: '/production-tracker' },
    { text: 'メモ', icon: <NoteIcon />, path: '/notes' },
    { text: '議事録', icon: <DescriptionIcon />, path: '/meetings' },
    { text: 'AI推薦タスク', icon: <AIRecommendedIcon />, path: '/ai-tasks', isAdmin: true },
    { text: 'ナレッジベース', icon: <KnowledgeIcon />, path: '/knowledge' },
    { text: 'イベント管理', icon: <EventNoteIcon />, path: '/event-management', isAdmin: true },
    { text: 'グループ管理', icon: <GroupIcon />, path: '/admin/groups', isAdmin: true },
    { text: 'データ管理', icon: <StorageIcon />, path: '/admin/data', isAdmin: true },
    { text: 'ユーザーアクティビティ管理', icon: <AccessTimeIcon />, path: '/admin/user-activities', isAdmin: true },
    { text: 'メトリクス', icon: <MetricsIcon />, path: '/metrics', isAdmin: true },
  ]

  const [currentTitleColor, setCurrentTitleColor] = useState('inherit')

  const getGroupColor = (_path: string) => {
    return 'inherit'
  }

  useEffect(() => {
    const currentItem = allMenuItems.find(item => location.pathname.startsWith(item.path))
    if (currentItem) {
      setCurrentTitle(currentItem.text)
      setCurrentTitleColor(getGroupColor(location.pathname))
    } else {
      setCurrentTitle('スケジュール管理')
      setCurrentTitleColor('inherit')
    }
  }, [location.pathname])

  useEffect(() => {
    if (shouldAutoCollapse) {
      setIsDrawerCollapsed(true)
      console.log('[useEffect] Auto collapsing drawer')
    }
  }, [shouldAutoCollapse])



  // 5:00になったら自動ログアウト（一般ユーザーのみ。管理者は対象外）
  useEffect(() => {
    if (!user || user.role === 'admin') return

    let checkTimeId: NodeJS.Timeout | null = null

    // 5:00になったらログアウトする関数
    const checkAndLogout = () => {
      const now = new Date()
      const hour = now.getHours()
      const minute = now.getMinutes()

      // 5:00になったらログアウト（5:00〜5:01の間）
      if (hour === 5 && minute === 0) {
        console.log('[Layout] 5:00 reached, logging out user')
        logout()
      }
    }

    // 1分ごとに時刻をチェック
    checkTimeId = setInterval(() => {
      checkAndLogout()
    }, 60 * 1000) // 1分 = 60 * 1000ミリ秒

    return () => {
      if (checkTimeId) {
        clearInterval(checkTimeId)
      }
    }
  }, [user, logout])

  // ユーザーアクティビティ記録（ログイン中は全ユーザー＝一般・管理者とも記録）
  useEffect(() => {
    if (!user) return

    // 既に実行中の場合はスキップ（重複防止）
    const effectKey = `activity_recording_${user.id}`
    if ((window as any)[effectKey]) {
      console.log('[UserActivity] Already recording for user', user.id)
      return
    }
    (window as any)[effectKey] = true

    let intervalId: NodeJS.Timeout | null = null
    let checkCycleId: NodeJS.Timeout | null = null
    let lastCycleDate: string | null = null
    let lastRecordTime: number = 0 // 0＝未記録なので初回は必ず記録する
    const MIN_RECORD_INTERVAL = 4 * 60 * 1000 // 4分以内の重複記録を防ぐ

    // 周期日を計算する関数（5:00~28:59の周期）
    const getCycleDate = (date: Date): string => {
      const hour = date.getHours()
      const cycleDate = new Date(date)
      if (hour < 5) {
        // 5:00より前なら前日の5:00を周期開始日とする
        cycleDate.setDate(cycleDate.getDate() - 1)
      }
      cycleDate.setHours(5, 0, 0, 0)
      return cycleDate.toISOString().split('T')[0] // YYYY-MM-DD形式
    }

    // アクティビティを記録する関数（重複防止付き）
    const recordActivity = async () => {
      const now = Date.now()
      // 最後の記録から4分以内の場合は記録しない（重複防止）。lastRecordTime=0 のときは初回なので必ず記録
      if (lastRecordTime > 0 && now - lastRecordTime < MIN_RECORD_INTERVAL) {
        console.log('[UserActivity] Skipping duplicate record (too soon)')
        return
      }

      try {
        await userActivityApi.recordActivity()
        lastRecordTime = now
        console.log('[UserActivity] Activity recorded')
      } catch (error: any) {
        console.warn('[UserActivity] Failed to record activity:', error?.response?.data?.detail || error.message)
      }
    }

    // 周期が変わったかチェックする関数
    const checkCycleChange = () => {
      const now = new Date()
      const currentCycleDate = getCycleDate(now)

      if (lastCycleDate !== null && lastCycleDate !== currentCycleDate) {
        console.log('[UserActivity] Cycle changed:', lastCycleDate, '->', currentCycleDate)
        // 周期が変わったらアクティビティを記録（重複防止はrecordActivity内で処理）
        recordActivity()
      }

      lastCycleDate = currentCycleDate
    }

    // 初回記録（ログイン直後はトークン確立のため少し遅延してから実行）
    lastCycleDate = getCycleDate(new Date())
    const initialDelay = 1500
    const initialTimer = setTimeout(() => {
      recordActivity()
    }, initialDelay)

    // 5分ごとにアクティビティを記録
    intervalId = setInterval(() => {
      recordActivity()
    }, 5 * 60 * 1000) // 5分 = 5 * 60 * 1000ミリ秒

    // 1分ごとに周期の変更をチェック
    checkCycleId = setInterval(() => {
      checkCycleChange()
    }, 60 * 1000) // 1分 = 60 * 1000ミリ秒

    return () => {
      clearTimeout(initialTimer)
      if (intervalId) clearInterval(intervalId)
      if (checkCycleId) clearInterval(checkCycleId)
      delete (window as any)[effectKey]
    }
  }, [user?.id, user?.role])

  const menuItems = allMenuItems.filter(item => {
    if (user?.role === 'admin') {
      // 管理者もチャットを表示できるようにする
      return true
    } else {
      // 一般ユーザーは特定の項目のみ表示
      return ['/calendar', '/chat', '/notes', '/knowledge'].includes(item.path)
    }
  })

  const bottomNavItems = menuItems

  // 下部ナビゲーションの現在のアクティブインデックス
  const activeBottomNavIndex = bottomNavItems.findIndex(item => location.pathname.startsWith(item.path))

  // ページ切り替え時にアクティブなナビゲーション項目を中央にスクロールさせる
  useEffect(() => {
    if (isMobile && activeBottomNavIndex !== -1 && bottomNavRef.current) {
      const container = bottomNavRef.current;
      const navElement = container.firstChild as HTMLElement;
      if (navElement && navElement.children[activeBottomNavIndex]) {
        const activeItem = navElement.children[activeBottomNavIndex] as HTMLElement;
        activeItem.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center'
        });
      }
    }
  }, [activeBottomNavIndex, isMobile]);

  // 以前のインポート/エクスポート関連の未使用ロジックを削除しました。



  const drawer = (
    <div>
      <Toolbar sx={{ minHeight: '48px !important' }}>
        {!isDrawerCollapsed ? (
          <Typography variant="subtitle1" noWrap component="div">
            スケジュール管理
          </Typography>
        ) : null}
        <IconButton onClick={toggleDrawer} sx={{ ml: 'auto' }}>
          {isDrawerCollapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
        </IconButton>
      </Toolbar>
      <Divider />
      <List>
        {menuItems.map((item) => (
          <React.Fragment key={item.text}>
            <ListItem
              button
              onClick={() => {
                navigate(item.path)
              }}
              selected={location.pathname.startsWith(item.path)}
              sx={{
                px: isDrawerCollapsed ? 1 : { xs: 2, sm: 2 },
                minHeight: { xs: 56, sm: 48 },
                py: { xs: 1.5, sm: 0 },
              }}
            >
              <Tooltip title={isDrawerCollapsed ? item.text : ""} placement="right">
                <ListItemIcon sx={{ minWidth: isDrawerCollapsed ? 'auto' : { xs: 48, sm: 40 } }}>
                  {item.icon}
                </ListItemIcon>
              </Tooltip>
              {!isDrawerCollapsed && <ListItemText primary={item.text} sx={{ '& .MuiTypography-root': { fontSize: { xs: '0.95rem', sm: '0.875rem' } } }} />}
            </ListItem>
            {/* カレンダー、進捗トラッカー、ナレッジベースの後に仕切り線を入れる */}
            {['/calendar', '/production-tracker', '/knowledge'].includes(item.path) && (
              <Divider sx={{ my: 1 }} />
            )}
          </React.Fragment>
        ))}
      </List>
      <Divider />
      <List>
        <ListItem
          button
          onClick={logout}
          sx={{
            px: isDrawerCollapsed ? 1 : { xs: 2, sm: 2 },
            minHeight: { xs: 56, sm: 48 },
            py: { xs: 1.5, sm: 0 },
          }}
        >
          <Tooltip title={isDrawerCollapsed ? "ログアウト" : ""} placement="right">
            <ListItemIcon sx={{ minWidth: isDrawerCollapsed ? 'auto' : { xs: 48, sm: 40 } }}>
              <LogoutIcon />
            </ListItemIcon>
          </Tooltip>
          {!isDrawerCollapsed && <ListItemText primary="ログアウト" sx={{ '& .MuiTypography-root': { fontSize: { xs: '0.95rem', sm: '0.875rem' } } }} />}
        </ListItem>
      </List>
    </div>
  )

  const handleBottomNavChange = (_event: React.SyntheticEvent, newValue: number) => {
    const targetPath = bottomNavItems[newValue]?.path
    if (targetPath) {
      navigate(targetPath)
    }
  }

  return (
    <Box sx={{ display: 'flex', width: '100%', height: '100vh' }}>
      <CssBaseline />


      {/* インポート/エクスポート関連のダイアログは削除されました */}


      {/* グローバル検索ダイアログ（disableScrollLock で背面レイアウトの白飛びを防止） */}
      <Dialog open={searchOpen} onClose={handleCloseSearch} maxWidth="sm" fullWidth disableScrollLock PaperProps={{ sx: { borderRadius: 2 } }}>
        <DialogTitle>検索</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            placeholder="プロジェクト・タスク・イベントを検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            }}
            sx={{ mb: 2 }}
          />
          {searchLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          {!searchLoading && (
            <Box sx={{ maxHeight: 360, overflow: 'auto' }}>
              {Array.isArray(searchResults.projects) && searchResults.projects.length > 0 && (
                <>
                  <ListSubheader sx={{ lineHeight: 2 }}>プロジェクト</ListSubheader>
                  <List dense disablePadding>
                    {searchResults.projects.map((p) => (
                      <ListItem key={`p-${p.id}`} disablePadding>
                        <ListItemButton onClick={() => handleSearchResultClick('project', p.id)}>
                          <ListItemIcon sx={{ minWidth: 36 }}><ProjectIcon fontSize="small" /></ListItemIcon>
                          <ListItemText primary={p?.name ?? ''} secondary={p?.description ? `${String(p.description).slice(0, 60)}${String(p.description).length > 60 ? '…' : ''}` : undefined} />
                        </ListItemButton>
                      </ListItem>
                    ))}
                  </List>
                </>
              )}
              {Array.isArray(searchResults.tasks) && searchResults.tasks.length > 0 && (
                <>
                  <ListSubheader sx={{ lineHeight: 2 }}>タスク</ListSubheader>
                  <List dense disablePadding>
                    {searchResults.tasks.map((t) => (
                      <ListItem key={`t-${t.id}`} disablePadding>
                        <ListItemButton onClick={() => handleSearchResultClick('task', t.id)}>
                          <ListItemIcon sx={{ minWidth: 36 }}><TaskIcon fontSize="small" /></ListItemIcon>
                          <ListItemText primary={t?.name ?? ''} secondary={t?.project_name ?? (t?.project_id != null ? searchResults.projects.find(p => p.id === t.project_id)?.name ?? `プロジェクト ID: ${t.project_id}` : undefined)} />
                        </ListItemButton>
                      </ListItem>
                    ))}
                  </List>
                </>
              )}
              {Array.isArray(searchResults.events) && searchResults.events.length > 0 && (
                <>
                  <ListSubheader sx={{ lineHeight: 2 }}>イベント</ListSubheader>
                  <List dense disablePadding>
                    {searchResults.events.map((e) => (
                      <ListItem key={`e-${e.id}`} disablePadding>
                        <ListItemButton onClick={() => handleSearchResultClick('event', e.id)}>
                          <ListItemIcon sx={{ minWidth: 36 }}><CalendarIcon fontSize="small" /></ListItemIcon>
                          <ListItemText primary={e?.title ?? ''} secondary={e?.start_time ? new Date(e.start_time).toLocaleString('ja-JP') : undefined} />
                        </ListItemButton>
                      </ListItem>
                    ))}
                  </List>
                </>
              )}
              {!searchLoading && searchQuery.trim() && (!Array.isArray(searchResults.projects) || searchResults.projects.length === 0) && (!Array.isArray(searchResults.tasks) || searchResults.tasks.length === 0) && (!Array.isArray(searchResults.events) || searchResults.events.length === 0) && (
                <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>該当なし</Typography>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseSearch}>閉じる</Button>
        </DialogActions>
      </Dialog>

      <ProjectEditDialog
        open={searchEditTarget?.type === 'project'}
        projectId={searchEditTarget?.type === 'project' ? searchEditTarget.id : null}
        onClose={() => setSearchEditTarget(null)}
        onSaved={handleSearchEditSaved}
      />
      <TaskEditDialog
        open={searchEditTarget?.type === 'task'}
        taskId={searchEditTarget?.type === 'task' ? searchEditTarget.id : null}
        onClose={() => setSearchEditTarget(null)}
        onSaved={handleSearchEditSaved}
      />
      <EventEditDialog
        open={searchEditTarget?.type === 'event'}
        eventId={searchEditTarget?.type === 'event' ? searchEditTarget.id : null}
        onClose={() => setSearchEditTarget(null)}
        onSaved={handleSearchEditSaved}
      />

      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
          transition: theme.transitions.create(['width', 'margin'], {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
        }}
      >
        <Toolbar sx={{ minHeight: { xs: '56px !important', sm: '40px !important' }, display: 'flex', justifyContent: 'space-between', px: { xs: 1, sm: 2 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1 }}>
            <>
              <Typography variant="h6" noWrap component="div" sx={{ fontSize: { xs: '1rem', sm: '1.25rem' }, overflow: 'hidden', textOverflow: 'ellipsis', color: currentTitleColor }}>
                {currentTitle}
              </Typography>
            </>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 1 }, flexShrink: 0 }}>
            <Tooltip title={mode === 'light' ? 'ダークモードに切り替え' : 'ライトモードに切り替え'}>
              <IconButton
                color="inherit"
                onClick={toggleMode}
                size={isMobile ? "medium" : "small"}
                aria-label="toggle color mode"
                sx={{ minWidth: { xs: 48, sm: 40 }, minHeight: { xs: 48, sm: 40 } }}
              >
                {mode === 'light' ? <DarkModeIcon fontSize={isMobile ? "medium" : "small"} /> : <LightModeIcon fontSize={isMobile ? "medium" : "small"} />}
              </IconButton>
            </Tooltip>
            {user?.role === 'admin' && (
              <Tooltip title="グローバル検索">
                <IconButton color="inherit" onClick={() => setSearchOpen(true)} size={isMobile ? "medium" : "small"} aria-label="検索" sx={{ minWidth: { xs: 48, sm: 40 }, minHeight: { xs: 48, sm: 40 } }}>
                  <SearchIcon fontSize={isMobile ? "medium" : "small"} />
                </IconButton>
              </Tooltip>
            )}
            <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 0.5 }}>
              <PersonIcon sx={{ fontSize: 20, opacity: 0.9 }} />
              <Typography variant="body2" component="span" sx={{ opacity: 0.95 }}>
                ログイン中: {user?.email || user?.username || user?.full_name || ''}
              </Typography>
              {user?.role === 'admin' && (
                <Typography component="span" variant="caption" sx={{ ml: 0.5, opacity: 0.85 }}>
                  (管理者)
                </Typography>
              )}
            </Box>
          </Box>
        </Toolbar>
      </AppBar>
      <Box
        component="nav"
        sx={{
          width: { sm: drawerWidth },
          flexShrink: { sm: 0 },
          transition: theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
        }}
      >
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
              transition: theme.transitions.create('width', {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.enteringScreen,
              }),
            },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>
      <Box
        component="main"
        sx={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
          padding: { xs: theme.spacing(1, 1, 9, 1), sm: theme.spacing(1, 2, 2, 2) },
        }}
      >
        <Toolbar sx={{ minHeight: { xs: '56px !important', sm: '40px !important' }, flexShrink: 0 }} />
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {children}
        </Box>
        {isMobile && (
          <Paper sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: (theme) => theme.zIndex.appBar + 1, borderTop: '1px solid', borderColor: 'divider' }} elevation={3}>
            <Box
              ref={bottomNavRef}
              sx={{
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
                '&::-webkit-scrollbar': { display: 'none' },
                msOverflowStyle: 'none',
                scrollbarWidth: 'none',
                display: 'flex',
                width: '100%',
                bgcolor: 'background.paper',
              }}
            >
              <BottomNavigation
                showLabels
                value={activeBottomNavIndex >= 0 ? activeBottomNavIndex : 0}
                onChange={handleBottomNavChange}
                sx={{
                  height: 64,
                  minWidth: bottomNavItems.length * 80, // 項目ごとに最低幅を確保してスクロール可能に
                  justifyContent: 'flex-start',
                  bgcolor: 'transparent',
                }}
              >
                {bottomNavItems.map((item, index) => (
                  <BottomNavigationAction
                    key={index}
                    label={item.text}
                    icon={item.icon}
                    sx={{
                      minWidth: 80,
                      maxWidth: 'none',
                      flex: '0 0 auto',
                      '&.Mui-selected': { color: 'primary.main' },
                      '& .MuiSvgIcon-root': { fontSize: 24 },
                      '& .MuiBottomNavigationAction-label': {
                        fontSize: '0.65rem',
                        '&.Mui-selected': { fontSize: '0.7rem' }
                      }
                    }}
                  />
                ))}
              </BottomNavigation>
            </Box>
          </Paper>
        )}
      </Box>
    </Box>
  )
}

export default Layout 