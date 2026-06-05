import React, { useEffect, useState, useMemo } from 'react'
import {
    Box,
    Paper,
    Typography,
    Divider,
    Button,
    IconButton,
    Tooltip,
    Chip,
    CircularProgress,
    Container,
    Tabs,
    Tab,
} from '@mui/material'
import {
    SmartToy as SmartToyIcon,
    CheckCircleOutline as CheckCircleIcon,
    HighlightOff as HighlightOffIcon,
    People as PeopleIcon,
    HourglassEmpty as PendingIcon,
    CalendarToday as CalendarIcon,
} from '@mui/icons-material'
import api from '../services/api'
import { MeetingTask } from '../types'
import { usePageState } from '../contexts/PageStateContext'

const AIRecommendedTasksPage: React.FC = () => {
    const [tasks, setTasks] = useState<MeetingTask[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedProject, setSelectedProject] = useState('')
    const { refreshGlobalData } = usePageState()

    const fetchTasks = async () => {
        setLoading(true)
        try {
            // 検出済みタスクのみ取得
            const res = await api.get('/meeting-tasks?status=detected')
            setTasks(res.data)
        } catch (err) {
            console.error('Failed to fetch meeting tasks:', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchTasks()
    }, [])

    const groupedTasks = useMemo(() => {
        const sorted = [...tasks].sort((a, b) => (a.project_name || '').localeCompare(b.project_name || ''))
        const groups: { [key: string]: MeetingTask[] } = {}
        sorted.forEach(t => {
            const project = t.project_name || '不明なプロジェクト'
            if (!groups[project]) groups[project] = []
            groups[project].push(t)
        })
        return groups
    }, [tasks])

    useEffect(() => {
        if (!selectedProject && Object.keys(groupedTasks).length > 0) {
            setSelectedProject(Object.keys(groupedTasks)[0])
        } else if (selectedProject && !groupedTasks[selectedProject] && Object.keys(groupedTasks).length > 0) {
            // 現在のプロジェクトが空になった場合（タスクをすべて採用/削除した場合）、別のプロジェクトに切り替える
            setSelectedProject(Object.keys(groupedTasks)[0])
        }
    }, [groupedTasks, selectedProject])

    const projectList = useMemo(() => {
        return Object.keys(groupedTasks)
    }, [groupedTasks])

    const filteredGroups = useMemo(() => {
        if (!selectedProject) return {}
        return { [selectedProject]: groupedTasks[selectedProject] || [] }
    }, [groupedTasks, selectedProject])

    const handleAdopt = async (mtTask: MeetingTask) => {
        try {
            await api.post(`/meeting-tasks/${mtTask.id}/adopt`)
            setTasks(prev => prev.filter(t => t.id !== mtTask.id))
            refreshGlobalData?.()
        } catch (err) {
            console.error('Failed to adopt meeting task:', err)
        }
    }

    const handleDismiss = async (mtTask: MeetingTask) => {
        try {
            await api.patch(`/meeting-tasks/${mtTask.id}`, { status: 'dismissed' })
            setTasks(prev => prev.filter(t => t.id !== mtTask.id))
        } catch (err) {
            console.error('Failed to dismiss meeting task:', err)
        }
    }

    return (
        <Container maxWidth="xl" sx={{ py: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 4 }}>
                <SmartToyIcon fontSize="large" sx={{ color: 'primary.main' }} />
                <Box>
                    <Typography variant="h4" sx={{ fontWeight: 700, color: 'text.primary' }}>
                        AI 推薦タスク
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        会議議事録からAIが自動検出したタスク候補です。内容を確認してプロジェクトに追加しましょう。
                    </Typography>
                </Box>
            </Box>

            {!loading && tasks.length > 0 && (
                <Box sx={{ mb: 4, borderBottom: 1, borderColor: 'divider' }}>
                    <Tabs
                        value={selectedProject}
                        onChange={(_, v) => setSelectedProject(v)}
                        variant="scrollable"
                        scrollButtons="auto"
                        sx={{
                            '& .MuiTab-root': {
                                textTransform: 'none',
                                fontWeight: 600,
                                fontSize: '0.95rem',
                                minWidth: 100,
                                py: 1.5
                            }
                        }}
                    >
                        {projectList.map(name => (
                            <Tab
                                key={name}
                                label={`${name} (${groupedTasks[name]?.length || 0})`}
                                value={name}
                            />
                        ))}
                    </Tabs>
                </Box>
            )}

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
                    <CircularProgress />
                </Box>
            ) : tasks.length === 0 ? (
                <Paper
                    sx={{
                        p: 8,
                        textAlign: 'center',
                        borderRadius: 4,
                        bgcolor: 'rgba(0,0,0,0.02)',
                        border: '2px dashed',
                        borderColor: 'divider'
                    }}
                >
                    <PendingIcon sx={{ fontSize: 60, color: 'text.disabled', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary">
                        現在、推薦されているタスクはありません。
                    </Typography>
                    <Typography variant="body2" color="text.disabled">
                        新しい会議議事録が解析されると、ここにタスクが表示されます。
                    </Typography>
                </Paper>
            ) : (
                <Box>
                    {Object.entries(filteredGroups).map(([projectName, projectTasks]) => (
                        <Box key={projectName} sx={{ mb: 6 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                                <Typography variant="h5" sx={{ fontWeight: 700, color: 'primary.main', borderLeft: '4px solid', pl: 2 }}>
                                    {projectName}
                                </Typography>
                                <Chip label={`${projectTasks.length}件`} size="small" variant="outlined" />
                            </Box>
                            <Box
                                sx={{
                                    display: 'grid',
                                    gridTemplateColumns: {
                                        xs: '1fr',
                                        sm: 'repeat(2, 1fr)',
                                        md: 'repeat(3, 1fr)',
                                        lg: 'repeat(4, 1fr)'
                                    },
                                    gap: 3
                                }}
                            >
                                {projectTasks.map((task) => (
                                    <Paper
                                        key={task.id}
                                        elevation={0}
                                        sx={{
                                            p: 2.5,
                                            borderRadius: 4,
                                            border: '1px solid',
                                            borderColor: 'divider',
                                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'white',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            transition: 'all 0.2s ease',
                                            position: 'relative',
                                            '&:hover': {
                                                borderColor: 'primary.main',
                                                transform: 'translateY(-4px)',
                                                boxShadow: '0 10px 20px rgba(0,0,0,0.05)'
                                            }
                                        }}
                                    >
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                                            <Box sx={{ display: 'flex', gap: 1 }}>
                                                <Chip
                                                    label={task.type || '一般タスク'}
                                                    size="small"
                                                    color="primary"
                                                    variant="outlined"
                                                    sx={{ fontWeight: 600, fontSize: '0.65rem' }}
                                                />
                                                <Chip
                                                    label={task.project_name || '不明'}
                                                    size="small"
                                                    variant="outlined"
                                                    sx={{
                                                        fontWeight: 500,
                                                        fontSize: '0.65rem',
                                                        bgcolor: 'rgba(0,0,0,0.03)',
                                                        borderColor: 'transparent'
                                                    }}
                                                />
                                            </Box>
                                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                                                <Tooltip title="無視する">
                                                    <IconButton size="small" onClick={() => handleDismiss(task)}>
                                                        <HighlightOffIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            </Box>
                                        </Box>

                                        <Typography variant="body1" sx={{ fontWeight: 600, mb: 2, flex: 1, lineHeight: 1.5 }}>
                                            {task.content}
                                        </Typography>

                                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 2 }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <PeopleIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                                                <Typography variant="caption" color="text.secondary">
                                                    担当者候補: <Typography component="span" variant="caption" fontWeight="bold">{task.assignee_suggestion || '未設定'}</Typography>
                                                </Typography>
                                            </Box>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <CalendarIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                                                <Typography variant="caption" color="text.secondary">
                                                    会議日: <Typography component="span" variant="caption" fontWeight="bold">
                                                        {task.meeting_date ? new Date(task.meeting_date).toLocaleDateString('ja-JP', {
                                                            year: 'numeric',
                                                            month: '2-digit',
                                                            day: '2-digit'
                                                        }) : '不明'}
                                                    </Typography>
                                                </Typography>
                                            </Box>
                                        </Box>

                                        <Divider sx={{ my: 1.5, opacity: 0.5 }} />

                                        <Button
                                            fullWidth
                                            variant="contained"
                                            startIcon={<CheckCircleIcon />}
                                            onClick={() => handleAdopt(task)}
                                            sx={{
                                                borderRadius: 3,
                                                textTransform: 'none',
                                                fontWeight: 600,
                                                boxShadow: 'none',
                                                '&:hover': { boxShadow: '0 4px 10px rgba(25, 118, 210, 0.2)' }
                                            }}
                                        >
                                            プロジェクトに追加
                                        </Button>
                                    </Paper>
                                ))}
                            </Box>
                        </Box>
                    ))}
                </Box>
            )
            }
        </Container >
    )
}

export default AIRecommendedTasksPage
