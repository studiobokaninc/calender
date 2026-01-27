import React, { useState, ReactNode, useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  AppBar,
  Box,
  CssBaseline,
  Drawer,
  IconButton,
  List,
  ListItem,
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
} from '@mui/icons-material'
import { useAuth } from '../contexts/AuthContext'
import { mockDataApi, importMockData } from '../services/api'
import { transformImportData } from '../utils/transformImportData'

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

  const drawerWidth = isDrawerCollapsed ? 65 : 240

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen)
  }

  const toggleDrawer = () => {
    setIsDrawerCollapsed(!isDrawerCollapsed)
  }

  const allMenuItems: MenuItemType[] = [
    { text: 'ダッシュボード', icon: <DashboardIcon />, path: '/dashboard' },
    { text: 'カレンダー', icon: <CalendarIcon />, path: '/calendar' },
    { text: 'プロジェクト', icon: <ProjectIcon />, path: '/projects' },
    { text: 'タスク', icon: <TaskIcon />, path: '/tasks' },
    { text: 'メモ', icon: <NoteIcon />, path: '/notes' },
    { text: 'イベント管理', icon: <EventNoteIcon />, path: '/event-management', isAdmin: true },
    { text: 'ユーザー管理', icon: <UserIcon />, path: '/admin/users', isAdmin: true },
    { text: 'グループ管理', icon: <GroupIcon />, path: '/admin/groups', isAdmin: true },
    { text: 'データ管理', icon: <StorageIcon />, path: '/admin/data', isAdmin: true },
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

  const menuItems = allMenuItems.filter(item => !item.isAdmin)
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
              px: isDrawerCollapsed ? 1 : 2,
              minHeight: 48,
            }}
          >
            <Tooltip title={isDrawerCollapsed ? item.text : ""} placement="right">
              <ListItemIcon sx={{ minWidth: isDrawerCollapsed ? 'auto' : 40 }}>
                {item.icon}
              </ListItemIcon>
            </Tooltip>
            {!isDrawerCollapsed && <ListItemText primary={item.text} />}
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
                  px: isDrawerCollapsed ? 1 : 2,
                  minHeight: 48,
                }}
              >
                <Tooltip title={isDrawerCollapsed ? item.text : ""} placement="right">
                  <ListItemIcon sx={{ minWidth: isDrawerCollapsed ? 'auto' : 40 }}>
                    {item.icon}
                  </ListItemIcon>
                </Tooltip>
                {!isDrawerCollapsed && <ListItemText primary={item.text} />}
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
            px: isDrawerCollapsed ? 1 : 2,
            minHeight: 48,
          }}
        >
          <Tooltip title={isDrawerCollapsed ? "ログアウト" : ""} placement="right">
            <ListItemIcon sx={{ minWidth: isDrawerCollapsed ? 'auto' : 40 }}>
              <LogoutIcon />
            </ListItemIcon>
          </Tooltip>
          {!isDrawerCollapsed && <ListItemText primary="ログアウト" />}
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
        <Toolbar sx={{ minHeight: '40px !important', display: 'flex', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <>
              <IconButton
                color="inherit"
                aria-label="open drawer"
                edge="start"
                onClick={handleDrawerToggle}
                sx={{ mr: 2, display: { sm: 'none' } }}
              >
                <MenuIcon />
              </IconButton>
              <Typography variant="h6" noWrap component="div">
                {currentTitle}
              </Typography>
            </>
          </Box>
          <Typography variant="subtitle1" noWrap component="div">
            {user?.full_name}
          </Typography>
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
          overflow: 'auto',
          minHeight: 0,
          padding: theme.spacing(1, 2, 2, 2),
        }}
      >
        <Toolbar sx={{ minHeight: '40px !important'}} />
        {children}
      </Box>
    </Box>
  )
}

export default Layout 