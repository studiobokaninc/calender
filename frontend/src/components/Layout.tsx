import React, { useState, ReactNode, useEffect, useCallback } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
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
  Alert,
  CircularProgress,
  ListSubheader,
  TextField,
  InputAdornment,
} from '@mui/material'
import {
  Menu as MenuIcon,
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
  Settings as SettingsIcon,
  Save as SaveIcon,
  FileUpload as FileUploadIcon,
  FileDownload as FileDownloadIcon,
  Storage as StorageIcon,
  People as PeopleIcon,
  EventNote as EventNoteIcon,
  Note as NoteIcon,
  Person as PersonIcon,
  QuestionAnswer as ChatIcon,
  AccessTime as AccessTimeIcon,
  Search as SearchIcon,
} from '@mui/icons-material'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import LightModeIcon from '@mui/icons-material/LightMode'
import { useAuth } from '../contexts/AuthContext'
import { useThemeMode } from '../contexts/ThemeModeContext'
import api, { mockDataApi, importMockData, userActivityApi } from '../services/api'
import { transformImportData } from '../utils/transformImportData'
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
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isDrawerCollapsed, setIsDrawerCollapsed] = useState(false)
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const shouldAutoCollapse = useMediaQuery(theme.breakpoints.down('md'))
  const location = useLocation()
  const [currentTitle, setCurrentTitle] = useState('')
  const { mode, toggleMode } = useThemeMode()
  
  // モックデータ管理用の状態
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [exportedData, setExportedData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [exportType, setExportType] = useState<'all' | 'users' | 'events'>('all')
  
  // ファイル入力用のref
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const userDataFileInputRef = React.useRef<HTMLInputElement>(null)
  const eventDataFileInputRef = React.useRef<HTMLInputElement>(null)

  // グローバル検索
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ projects: Array<{ id: number; name: string }>; tasks: Array<{ id: number; name: string; project_id: number | null }>; events: Array<{ id: number; title: string; start_time: string | null }> }>({ projects: [], tasks: [], events: [] })
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
        const res = await api.get<{ projects?: Array<{ id: number; name: string; description?: string }>; tasks?: Array<{ id: number; name: string; project_id: number | null }>; events?: Array<{ id: number; title: string; start_time: string | null }> }>('/search', { params: { q: q.trim(), limit: 8 } })
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

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen)
  }

  const toggleDrawer = () => {
    setIsDrawerCollapsed(!isDrawerCollapsed)
  }

  const allMenuItems: MenuItemType[] = [
    { text: 'チャット', icon: <ChatIcon />, path: '/chat' },
    { text: 'ダッシュボード', icon: <DashboardIcon />, path: '/dashboard' },
    { text: 'カレンダー', icon: <CalendarIcon />, path: '/calendar' },
    { text: 'プロジェクト', icon: <ProjectIcon />, path: '/projects' },
    { text: 'タスク', icon: <TaskIcon />, path: '/tasks' },
    { text: 'メモ', icon: <NoteIcon />, path: '/notes' },
    { text: 'イベント管理', icon: <EventNoteIcon />, path: '/event-management', isAdmin: true },
    { text: 'ユーザー', icon: <UserIcon />, path: '/admin/users' },
    { text: 'グループ管理', icon: <GroupIcon />, path: '/admin/groups', isAdmin: true },
    { text: 'データ管理', icon: <StorageIcon />, path: '/admin/data', isAdmin: true },
    { text: 'ユーザーアクティビティ管理', icon: <AccessTimeIcon />, path: '/admin/user-activities', isAdmin: true },
    { text: 'メトリクス', icon: <MetricsIcon />, path: '/metrics', isAdmin: true },
  ]

  useEffect(() => {
    const currentItem = allMenuItems.find(item => location.pathname.startsWith(item.path))
    if (currentItem) {
      setCurrentTitle(currentItem.text)
    } else {
      setCurrentTitle('スケジュール管理')
    }
  }, [location.pathname])

  useEffect(() => {
    if (shouldAutoCollapse) {
      setIsDrawerCollapsed(true)
      console.log('[useEffect] Auto collapsing drawer')
    }
  }, [shouldAutoCollapse])

  // メッセージを一定時間後に消す
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [successMessage])

  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [errorMessage])

  // 5:00になったら自動ログアウト（一般ユーザーのみ）
  useEffect(() => {
    if (!user || user.role !== 'user') {
      return
    }

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

  // ユーザーアクティビティ記録（一般ユーザーのみ）
  useEffect(() => {
    // 管理者は記録しない
    if (!user || user.role !== 'user') {
      return
    }

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
    let lastRecordTime: number = 0 // 最後に記録した時刻（ミリ秒）
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
      // 最後の記録から4分以内の場合は記録しない（重複防止）
      if (now - lastRecordTime < MIN_RECORD_INTERVAL) {
        console.log('[UserActivity] Skipping duplicate record (too soon)')
        return
      }
      
      try {
        await userActivityApi.recordActivity()
        lastRecordTime = now
        console.log('[UserActivity] Activity recorded')
      } catch (error: any) {
        // エラーは無視（サーバーが起動していない場合など）
        console.warn('[UserActivity] Failed to record activity:', error.message)
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

    // 初回記録（即座に実行）
    lastRecordTime = Date.now()
    recordActivity()
    lastCycleDate = getCycleDate(new Date())

    // 5分ごとにアクティビティを記録
    intervalId = setInterval(() => {
      recordActivity()
    }, 5 * 60 * 1000) // 5分 = 5 * 60 * 1000ミリ秒

    // 1分ごとに周期の変更をチェック
    checkCycleId = setInterval(() => {
      checkCycleChange()
    }, 60 * 1000) // 1分 = 60 * 1000ミリ秒

    return () => {
      if (intervalId) {
        clearInterval(intervalId)
      }
      if (checkCycleId) {
        clearInterval(checkCycleId)
      }
      // クリーンアップ時にフラグをリセット
      delete (window as any)[effectKey]
    }
  }, [user?.id, user?.role])

  // 一般ユーザーはチャットのみ表示。管理者は管理者以外のメニューを表示
  const menuItems = user?.role === 'admin'
    ? allMenuItems.filter(item => !item.isAdmin)
    : allMenuItems.filter(item => item.path === '/chat')
  const adminMenuItems = allMenuItems.filter(item => item.isAdmin)

  // モックデータのエクスポート
  const handleExportMockData = async (type: 'all' | 'users' | 'events' = 'all') => {
    setIsLoading(true)
    setErrorMessage(null)
    setExportType(type)
    
    try {
      let data;
      let message;
      
      switch (type) {
        case 'users':
          data = await mockDataApi.exportUserData();
          message = 'ユーザーデータを正常にエクスポートしました';
          break;
        case 'events':
          data = await mockDataApi.exportEventData();
          message = 'イベントデータを正常にエクスポートしました';
          break;
        default:
          data = await mockDataApi.exportMockData();
          message = 'モックデータを正常にエクスポートしました';
      }
      
      setExportedData(data)
      setIsExportDialogOpen(true)
      setSuccessMessage(message)
    } catch (error) {
      console.error('Export error:', error)
      setErrorMessage('データのエクスポートに失敗しました')
    } finally {
      setIsLoading(false)
    }
  }

  // モックデータのインポート - ファイル選択ダイアログを開く
  const handleOpenImportDialog = (type: 'all' | 'users' | 'events' = 'all') => {
    switch (type) {
      case 'users':
        if (userDataFileInputRef.current) {
          userDataFileInputRef.current.click();
        }
        break;
      case 'events':
        if (eventDataFileInputRef.current) {
          eventDataFileInputRef.current.click();
        }
        break;
      default:
        if (fileInputRef.current) {
          fileInputRef.current.click();
        }
    }
  }

  // モックデータのインポート - ファイル読み込み（全データ）
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const raw = JSON.parse(e.target?.result as string)
        const jsonData = transformImportData(raw)
        setIsLoading(true)
        setErrorMessage(null)
        
        await importMockData(jsonData)
        setSuccessMessage('モックデータを正常にインポートしました')
        
        // ファイル選択をリセット
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      } catch (error: any) {
        console.error('Import error:', error)
        let message = 'モックデータのインポートに失敗しました'
        if (error?.response?.data) {
          const data = error.response.data
          if (typeof data === 'string') message += `: ${data}`
          else if (data?.detail) message += `: ${JSON.stringify(data.detail)}`
          else message += `: ${JSON.stringify(data)}`
        } else if (error?.message) {
          message += `: ${error.message}`
        }
        setErrorMessage(message)
      } finally {
        setIsLoading(false)
      }
    }
    reader.onerror = () => {
      setErrorMessage('ファイルの読み込みに失敗しました')
    }
    reader.readAsText(file)
  }
  
  // ユーザーデータのインポート
  const handleUserDataFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const userData = JSON.parse(e.target?.result as string)
        setIsLoading(true)
        setErrorMessage(null)
        
        // 既存のイベントデータと結合してインポート
        await mockDataApi.importCombinedData(userData, {})
        setSuccessMessage('ユーザーデータを正常にインポートしました')
        
        // ファイル選択をリセット
        if (userDataFileInputRef.current) {
          userDataFileInputRef.current.value = ''
        }
      } catch (error) {
        console.error('User data import error:', error)
        setErrorMessage('ユーザーデータのインポートに失敗しました')
      } finally {
        setIsLoading(false)
      }
    }
    reader.onerror = () => {
      setErrorMessage('ファイルの読み込みに失敗しました')
    }
    reader.readAsText(file)
  }
  
  // イベントデータのインポート
  const handleEventDataFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const eventData = JSON.parse(e.target?.result as string)
        setIsLoading(true)
        setErrorMessage(null)
        
        // 既存のユーザーデータと結合してインポート
        await mockDataApi.importCombinedData({}, eventData)
        setSuccessMessage('イベントデータを正常にインポートしました')
        
        // ファイル選択をリセット
        if (eventDataFileInputRef.current) {
          eventDataFileInputRef.current.value = ''
        }
      } catch (error) {
        console.error('Event data import error:', error)
        setErrorMessage('イベントデータのインポートに失敗しました')
      } finally {
        setIsLoading(false)
      }
    }
    reader.onerror = () => {
      setErrorMessage('ファイルの読み込みに失敗しました')
    }
    reader.readAsText(file)
  }

  // エクスポートしたデータのダウンロード
  const handleDownloadExportedData = () => {
    if (!exportedData) return
    
    const dataStr = JSON.stringify(exportedData, null, 2)
    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(dataBlob)
    
    const link = document.createElement('a')
    link.href = url
    
    // ファイル名をエクスポートタイプに基づいて設定
    let filename;
    switch (exportType) {
      case 'users':
        filename = `users_data_${new Date().toISOString().split('T')[0]}.json`;
        break;
      case 'events':
        filename = `events_data_${new Date().toISOString().split('T')[0]}.json`;
        break;
      default:
        filename = `mock_data_export_${new Date().toISOString().split('T')[0]}.json`;
    }
    
    link.download = filename
    link.setAttribute('download', filename)
    
    // ファイルの保存先を /Users/ryoji/calender/data/ に指定
    // (ブラウザではセキュリティ上の制限により直接指定できないため、
    // ユーザーが手動で保存先を選択する必要があります)
    
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
    setIsExportDialogOpen(false)
  }

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
          <ListItem
            button
            key={item.text}
            onClick={() => {
              navigate(item.path)
              if (isMobile) setMobileOpen(false)
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
        ))}
      </List>
      {/* 管理者用項目 */}
      {user?.role === 'admin' && (
        <>
          <Divider />
          <List>
            {adminMenuItems.map((item: MenuItemType) => (
              <ListItem
                button
                key={item.text}
                onClick={() => {
                  console.log(`Navigating to: ${item.path}`);
                  navigate(item.path)
                  if (isMobile) setMobileOpen(false)
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
            ))}
          </List>
        </>
      )}
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

  return (
    <Box sx={{ display: 'flex', width: '100%', height: '100vh' }}>
      <CssBaseline />
      {/* 通知メッセージ */}
      {successMessage && (
        <Alert 
          severity="success" 
          sx={{ 
            position: 'fixed', 
            top: '16px', 
            right: '16px', 
            zIndex: 9999,
            boxShadow: 3
          }}
          onClose={() => setSuccessMessage(null)}
        >
          {successMessage}
        </Alert>
      )}
      {errorMessage && (
        <Alert 
          severity="error" 
          sx={{ 
            position: 'fixed', 
            top: '16px', 
            right: '16px', 
            zIndex: 9999,
            boxShadow: 3
          }}
          onClose={() => setErrorMessage(null)}
        >
          {errorMessage}
        </Alert>
      )}
      
      {/* エクスポートデータのダイアログ */}
      <Dialog 
        open={isExportDialogOpen} 
        onClose={() => setIsExportDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {exportType === 'users' ? 'ユーザーデータのエクスポート' : 
           exportType === 'events' ? 'イベントデータのエクスポート' : 
           'モックデータのエクスポート'}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" gutterBottom>
            データを正常にエクスポートしました。データをダウンロードするには「ダウンロード」ボタンをクリックしてください。
            保存先は「/Users/ryoji/calender/data」を選択してください。
          </Typography>
          <Box sx={{ mt: 2, mb: 1 }}>
            <pre style={{ maxHeight: '400px', overflow: 'auto', backgroundColor: '#f5f5f5', padding: '8px', borderRadius: '4px' }}>
              {exportedData ? JSON.stringify(exportedData, null, 2) : ''}
            </pre>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsExportDialogOpen(false)}>閉じる</Button>
          <Button onClick={handleDownloadExportedData} color="primary" variant="contained" startIcon={<FileDownloadIcon />}>
            ダウンロード
          </Button>
        </DialogActions>
      </Dialog>

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
                          <ListItemText primary={t?.name ?? ''} secondary={t?.project_id != null ? `プロジェクト ID: ${t.project_id}` : undefined} />
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
              <IconButton
                color="inherit"
                aria-label="open drawer"
                edge="start"
                onClick={handleDrawerToggle}
                sx={{ mr: { xs: 1, sm: 2 }, display: { sm: 'none' }, minWidth: 48, minHeight: 48 }}
              >
                <MenuIcon />
              </IconButton>
              <Typography variant="h6" noWrap component="div" sx={{ fontSize: { xs: '1rem', sm: '1.25rem' }, overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { 
              boxSizing: 'border-box', 
              width: drawerWidth,
              transition: theme.transitions.create('width', {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.enteringScreen,
              }),
            },
          }}
        >
          {drawer}
        </Drawer>
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
          padding: { xs: theme.spacing(1), sm: theme.spacing(1, 2, 2, 2) },
        }}
      >
        <Toolbar sx={{ minHeight: { xs: '48px !important', sm: '40px !important' }, flexShrink: 0 }} />
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {children}
        </Box>
      </Box>
    </Box>
  )
}

export default Layout 