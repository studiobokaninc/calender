import React, { useEffect, useState } from 'react'
import {
  Box,
  Typography,
  CircularProgress,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Card,
  CardContent,
  CardActions,
  Chip,
  LinearProgress,
} from '@mui/material'
import { Add as AddIcon } from '@mui/icons-material'
import { Task } from '../types'
import api from '../services/api'

const priorityColors = {
  low: 'success',
  medium: 'warning',
  high: 'error',
} as const

const statusLabels = {
  todo: '未着手',
  in_progress: '進行中',
  done: '完了',
} as const

const Tasks: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openDialog, setOpenDialog] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    status: 'todo',
    priority: 'medium',
    due_date: '',
    project_id: '',
    cost: 0,
  })

  useEffect(() => {
    // グローバルデータが利用可能な場合はそれを使用
    // 独立したコンポーネントなので、必要に応じてデータを取得
    fetchTasks()
  }, [])

  const fetchTasks = async () => {
    try {
      const response = await api.get('/tasks')
      setTasks(response.data)
    } catch (err) {
      setError('タスクの取得に失敗しました')
      console.error('Failed to fetch tasks:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleOpenDialog = (task?: Task) => {
    if (task) {
      setSelectedTask(task)
      setFormData({
        name: task.name,
        description: task.description || '',
        status: task.status || 'todo',
        priority: task.extendedProps?.priority || 'medium',
        due_date: task.due_date || '',
        project_id: task.project_id?.toString() || '',
        cost: task.cost || 0,
      })
    } else {
      setSelectedTask(null)
      setFormData({
        name: '',
        description: '',
        status: 'todo',
        priority: 'medium',
        due_date: '',
        project_id: '',
        cost: 0,
      })
    }
    setOpenDialog(true)
  }

  const handleCloseDialog = () => {
    setOpenDialog(false)
    setSelectedTask(null)
  }

  const handleSubmit = async () => {
    try {
      if (selectedTask) {
        await api.put(`/tasks/${selectedTask.id}`, formData)
      } else {
        await api.post('/tasks', formData)
      }
      handleCloseDialog()
      fetchTasks()
    } catch (err) {
      setError('タスクの保存に失敗しました')
      console.error('Failed to save task:', err)
    }
  }

  const handleStatusChange = async (taskId: number, newStatus: string) => {
    try {
      await api.put(`/tasks/${taskId}`, { status: newStatus })
      fetchTasks()
    } catch (err) {
      setError('タスクの更新に失敗しました')
      console.error('Failed to update task status:', err)
    }
  }

  const calculateProgress = (task: Task) => {
    if (!task.cost) return 0
    // completed_costプロパティが存在しないため、progressプロパティを使用
    return task.progress || 0
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">タスク</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
        >
          新規タスク
        </Button>
      </Box>

      {error && (
        <Typography color="error" mb={2}>
          {error}
        </Typography>
      )}

      <Grid container spacing={3}>
        {tasks.map((task) => (
          <Grid item xs={12} sm={6} md={4} key={task.id}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  {task.name}
                </Typography>
                <Typography color="textSecondary" gutterBottom>
                  {task.description}
                </Typography>
                <Box display="flex" gap={1} mb={2}>
                  <Chip
                    label={statusLabels[task.status as keyof typeof statusLabels]}
                    color={task.status === 'done' ? 'success' : 'default'}
                    size="small"
                  />
                  <Chip
                    label={task.extendedProps?.priority || 'medium'}
                    color={priorityColors[(task.extendedProps?.priority || 'medium') as keyof typeof priorityColors]}
                    size="small"
                  />
                </Box>
                {task.cost && task.cost > 0 && (
                  <Box mb={2}>
                    <Typography variant="body2" color="textSecondary" gutterBottom>
                      コスト進捗: {task.progress || 0}% / {task.cost}h
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={calculateProgress(task)}
                      sx={{ height: 8, borderRadius: 4 }}
                    />
                    <Typography variant="body2" color="textSecondary" align="right" mt={0.5}>
                      {calculateProgress(task).toFixed(1)}%
                    </Typography>
                  </Box>
                )}
                {task.due_date && (
                  <Typography variant="body2" color="textSecondary">
                    期限: {new Date(task.due_date).toLocaleDateString()}
                  </Typography>
                )}
              </CardContent>
              <CardActions>
                <Button size="small" onClick={() => handleOpenDialog(task)}>
                  編集
                </Button>
                {task.status !== 'done' && (
                  <Button
                    size="small"
                    color="primary"
                    onClick={() => handleStatusChange(task.id, 'done')}
                  >
                    完了にする
                  </Button>
                )}
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {selectedTask ? 'タスクを編集' : '新規タスク'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              label="タイトル"
              fullWidth
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              margin="normal"
            />
            <TextField
              label="説明"
              fullWidth
              multiline
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              margin="normal"
            />
            <FormControl fullWidth margin="normal">
              <InputLabel>ステータス</InputLabel>
              <Select
                value={formData.status}
                label="ステータス"
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              >
                <MenuItem value="todo">未着手</MenuItem>
                <MenuItem value="in_progress">進行中</MenuItem>
                <MenuItem value="done">完了</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth margin="normal">
              <InputLabel>優先度</InputLabel>
              <Select
                value={formData.priority}
                label="優先度"
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
              >
                <MenuItem value="low">低</MenuItem>
                <MenuItem value="medium">中</MenuItem>
                <MenuItem value="high">高</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="期限"
              type="date"
              fullWidth
              value={formData.due_date}
              onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              margin="normal"
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="コスト (時間)"
              type="number"
              fullWidth
              value={formData.cost}
              onChange={(e) => setFormData({ ...formData, cost: Number(e.target.value) })}
              margin="normal"
              InputLabelProps={{ shrink: true }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>キャンセル</Button>
          <Button onClick={handleSubmit} variant="contained" color="primary">
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default Tasks 