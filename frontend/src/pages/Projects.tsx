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
import { Project, Task } from '../types'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'

const statusLabels = {
  planning: '計画中',
  active: '進行中',
  completed: '完了',
  on_hold: '保留中',
} as const

const Projects: React.FC = () => {
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<{ [key: number]: Task[] }>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openDialog, setOpenDialog] = useState(false)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    start_date: '',
    end_date: '',
    status: 'planning',
  })

  useEffect(() => {
    fetchProjects()
  }, [])

  const fetchProjects = async () => {
    try {
      const response = await api.get('/projects')
      const projectsData = response.data
      setProjects(projectsData)
      
      // 各プロジェクトのタスクを取得
      const tasksData: { [key: number]: Task[] } = {}
      for (const project of projectsData) {
        const tasksResponse = await api.get(`/tasks?project_id=${project.id}`)
        tasksData[project.id] = tasksResponse.data
      }
      setTasks(tasksData)
    } catch (err) {
      setError('プロジェクトの取得に失敗しました')
      console.error('Failed to fetch projects:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleOpenDialog = (project?: Project) => {
    if (project) {
      setSelectedProject(project)
      setFormData({
        name: project.name,
        description: project.description || '',
        start_date: project.start_date || '',
        end_date: project.end_date || '',
        status: project.status || 'planning',
      })
    } else {
      setSelectedProject(null)
      setFormData({
        name: '',
        description: '',
        start_date: '',
        end_date: '',
        status: 'planning',
      })
    }
    setOpenDialog(true)
  }

  const handleCloseDialog = () => {
    setOpenDialog(false)
    setSelectedProject(null)
  }

  const handleSubmit = async () => {
    try {
      if (selectedProject) {
        await api.put(`/projects/${selectedProject.id}`, formData)
      } else {
        await api.post('/projects', formData)
      }
      handleCloseDialog()
      fetchProjects()
    } catch (err) {
      setError('プロジェクトの保存に失敗しました')
      console.error('Failed to save project:', err)
    }
  }

  const calculateProgress = (projectId: number) => {
    const projectTasks = tasks[projectId] || []
    if (projectTasks.length === 0) return 0
    const completedTasks = projectTasks.filter(task => task.status === 'done').length
    return (completedTasks / projectTasks.length) * 100
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
        <Typography variant="h4">プロジェクト</Typography>
        {user?.role === 'admin' && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => handleOpenDialog()}
          >
            新規プロジェクト
          </Button>
        )}
      </Box>

      {error && (
        <Typography color="error" mb={2}>
          {error}
        </Typography>
      )}

      <Grid container spacing={3}>
        {projects.map((project) => (
          <Grid item xs={12} sm={6} md={4} key={project.id}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  {project.name}
                </Typography>
                <Typography color="textSecondary" gutterBottom>
                  {project.description}
                </Typography>
                <Box display="flex" gap={1} mb={2}>
                  <Chip
                    label={statusLabels[project.status as keyof typeof statusLabels] || '計画中'}
                    color={project.status === 'completed' ? 'success' : 'default'}
                    size="small"
                  />
                </Box>
                <Box mb={2}>
                  <Typography variant="body2" color="textSecondary" gutterBottom>
                    進捗状況
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={calculateProgress(project.id)}
                    sx={{ height: 8, borderRadius: 4 }}
                  />
                  <Typography variant="body2" color="textSecondary" align="right" mt={0.5}>
                    {calculateProgress(project.id).toFixed(1)}%
                  </Typography>
                </Box>
                <Typography variant="body2" color="textSecondary">
                  開始日: {project.start_date ? new Date(project.start_date).toLocaleDateString() : '未設定'}
                </Typography>
                {project.end_date && (
                  <Typography variant="body2" color="textSecondary">
                    終了日: {new Date(project.end_date).toLocaleDateString()}
                  </Typography>
                )}
              </CardContent>
              <CardActions>
                {user?.role === 'admin' && (
                  <Button size="small" onClick={() => handleOpenDialog(project)}>
                    編集
                  </Button>
                )}
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {selectedProject ? 'プロジェクトを編集' : '新規プロジェクト'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="プロジェクト名"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label="説明"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              fullWidth
              multiline
              rows={3}
            />
            <FormControl fullWidth>
              <InputLabel>ステータス</InputLabel>
              <Select
                value={formData.status}
                label="ステータス"
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              >
                <MenuItem value="planning">計画中</MenuItem>
                <MenuItem value="active">進行中</MenuItem>
                <MenuItem value="completed">完了</MenuItem>
                <MenuItem value="on_hold">保留中</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="開始日"
              type="date"
              value={formData.start_date}
              onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
              fullWidth
              required
              InputLabelProps={{
                shrink: true,
              }}
            />
            <TextField
              label="終了日"
              type="date"
              value={formData.end_date}
              onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
              fullWidth
              InputLabelProps={{
                shrink: true,
              }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>キャンセル</Button>
          <Button onClick={handleSubmit} variant="contained">
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default Projects 