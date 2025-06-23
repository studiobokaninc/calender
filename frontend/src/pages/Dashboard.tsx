import React, { useEffect, useState } from 'react'
import {
  Box,
  Paper,
  Typography,
  CircularProgress,
} from '@mui/material'
import {
  People as PeopleIcon,
  Task as TaskIcon,
  Folder as ProjectIcon,
  Event as EventIcon,
} from '@mui/icons-material'
import api from '../services/api'
import { Metrics } from '../types'

const Dashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    )
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

        {/* タスク一覧 */}
        <Box sx={{ flexGrow: 1, flexBasis: { xs: '100%', md: 'calc(50% - 12px)' }, minWidth: { xs: '100%', md: 'calc(50% - 12px)' } }}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              タスク一覧
            </Typography>
            {/* タスク一覧のコンテンツ */}
          </Paper>
        </Box>

        {/* イベント一覧 */}
        <Box sx={{ flexGrow: 1, flexBasis: '100%', minWidth: '100%' }}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              イベント一覧
            </Typography>
            {/* イベント一覧のコンテンツ */}
          </Paper>
        </Box>
      </Box>
    </Box>
  )
}

export default Dashboard 