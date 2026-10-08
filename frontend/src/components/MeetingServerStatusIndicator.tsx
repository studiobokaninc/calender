import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Alert,
  CircularProgress,
  Tooltip,
  Card,
  CardContent,
  IconButton,
  Divider,
  Paper,
  Collapse,
} from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import FolderIcon from '@mui/icons-material/Folder';
import BlockIcon from '@mui/icons-material/Block';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CloseIcon from '@mui/icons-material/Close';
import api from '../services/api';

export interface ActiveMeetingItem {
  id: number;
  project_id: number;
  project_name: string;
  title: string;
  status: 'recording' | 'processing';
  date: string | null;
  created_at: string | null;
  updated_at: string | null;
  attendees: string[];
  analysis_progress: number | null;
  analysis_backend: string | null;
}

export interface ActiveStatusResponse {
  has_active_tasks: boolean;
  recording_count: number;
  processing_count: number;
  total_active_count: number;
  meetings: ActiveMeetingItem[];
}

interface IndicatorProps {
  /** バナーのみを描画するか、AppBarのチップのみを描画するか、または両方か */
  variant?: 'chip' | 'banner' | 'all';
}

export const MeetingServerStatusIndicator: React.FC<IndicatorProps> = ({ variant = 'chip' }) => {
  const [data, setData] = useState<ActiveStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevActiveCountRef = useRef<number>(0);

  const fetchStatus = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await api.get<ActiveStatusResponse>('/meetings/active-status');
      setData(res.data);
      setLastChecked(new Date());

      // 新たにタスクが増えた場合はバナーのdismissを自動解除して再表示する
      if (res.data.total_active_count > prevActiveCountRef.current) {
        setBannerDismissed(false);
      }
      prevActiveCountRef.current = res.data.total_active_count;
    } catch (e) {
      console.warn('Failed to fetch meeting active status:', e);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    // 10秒ごとにポーリング
    pollTimerRef.current = setInterval(() => {
      fetchStatus();
    }, 10000);

    const handleStatusChanged = () => {
      fetchStatus();
      setBannerDismissed(false);
    };
    const handleFocus = () => {
      fetchStatus();
    };

    window.addEventListener('meetingStatusChanged', handleStatusChanged);
    window.addEventListener('focus', handleFocus);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      window.removeEventListener('meetingStatusChanged', handleStatusChanged);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchStatus]);

  const hasTasks = !!data?.has_active_tasks;
  const recordingCount = data?.recording_count ?? 0;
  const processingCount = data?.processing_count ?? 0;

  // 経過時間の表記計算
  const formatTimeAgo = (isoString: string | null) => {
    if (!isoString) return '不明';
    try {
      const date = new Date(isoString);
      const diffMs = Date.now() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'たった今';
      if (diffMins < 60) return `${diffMins}分前`;
      const diffHours = Math.floor(diffMins / 60);
      return `${diffHours}時間${diffMins % 60}分前`;
    } catch {
      return isoString;
    }
  };

  // 代表タスクの取得
  const firstMeeting = data?.meetings && data.meetings.length > 0 ? data.meetings[0] : null;

  // --- 1. グローバル警告バナー（画面最上部に常駐するストリップ） ---
  const renderBanner = () => {
    if (!hasTasks || bannerDismissed) return null;

    const bgGradient =
      recordingCount > 0
        ? 'linear-gradient(90deg, #b71c1c 0%, #d32f2f 40%, #e65100 100%)'
        : 'linear-gradient(90deg, #e65100 0%, #f57c00 50%, #fb8c00 100%)';

    return (
      <Paper
        elevation={4}
        sx={{
          background: bgGradient,
          color: '#ffffff',
          borderRadius: 2,
          p: { xs: 1.2, sm: 1.5 },
          mb: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5,
          boxShadow: '0 4px 18px rgba(211, 47, 47, 0.45)',
          border: '1px solid rgba(255, 255, 255, 0.35)',
          animation: 'bannerPulse 3s infinite ease-in-out',
          '@keyframes bannerPulse': {
            '0%': { boxShadow: '0 4px 14px rgba(211, 47, 47, 0.35)' },
            '50%': { boxShadow: '0 6px 24px rgba(244, 67, 54, 0.7)' },
            '100%': { boxShadow: '0 4px 14px rgba(211, 47, 47, 0.35)' },
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, flex: 1 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 38,
              height: 38,
              borderRadius: '50%',
              bgcolor: 'rgba(0, 0, 0, 0.25)',
              border: '2px solid rgba(255, 255, 255, 0.6)',
              flexShrink: 0,
            }}
          >
            {recordingCount > 0 ? (
              <MicIcon sx={{ fontSize: 24, color: '#ffffff' }} />
            ) : (
              <AutoAwesomeIcon sx={{ fontSize: 22, color: '#ffffff' }} />
            )}
          </Box>

          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: 900,
                  fontSize: { xs: '0.9rem', sm: '1rem' },
                  letterSpacing: 0.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.8,
                }}
              >
                <BlockIcon sx={{ fontSize: 18, color: '#ffeb3b' }} />
                【サーバー再起動 厳禁】
                {recordingCount > 0 ? '録音タスク稼働中' : '議事録AI生成中'}
              </Typography>
              <Chip
                label={`録音: ${recordingCount}件 / AI生成: ${processingCount}件`}
                size="small"
                sx={{
                  bgcolor: 'rgba(0, 0, 0, 0.35)',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  height: 22,
                }}
              />
            </Box>

            <Typography
              variant="body2"
              sx={{
                fontSize: { xs: '0.8rem', sm: '0.875rem' },
                opacity: 0.95,
                mt: 0.2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {firstMeeting ? (
                <>
                  現在、<strong>[{firstMeeting.project_name}]</strong> の「<strong>{firstMeeting.title}</strong>」が実行中です。サーバーを停止・再起動するとデータが失われます。
                </>
              ) : (
                '他のユーザーが現在会議タスクを実行中です。サーバーの再起動はお控えください。'
              )}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          <Button
            variant="contained"
            size="small"
            onClick={() => {
              fetchStatus(true);
              setOpenDialog(true);
            }}
            endIcon={<ArrowForwardIcon />}
            sx={{
              bgcolor: '#ffffff',
              color: '#d32f2f',
              fontWeight: 800,
              fontSize: '0.8rem',
              borderRadius: 2,
              px: 1.8,
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              '&:hover': {
                bgcolor: '#fff9c4',
                color: '#b71c1c',
              },
            }}
          >
            詳細タスクを確認
          </Button>
          <IconButton
            size="small"
            onClick={() => setBannerDismissed(true)}
            sx={{
              color: 'rgba(255, 255, 255, 0.8)',
              '&:hover': { color: '#ffffff', bgcolor: 'rgba(0,0,0,0.2)' },
            }}
            title="一時的にバナーを閉じる"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Paper>
    );
  };

  // --- 2. AppBar内のリッチステータスチップ ---
  const renderChip = () => {
    let chipLabel = '';
    if (hasTasks) {
      if (recordingCount > 0 && processingCount > 0) {
        chipLabel = `録音 ${recordingCount}件 / 生成 ${processingCount}件`;
      } else if (recordingCount > 0) {
        chipLabel = `録音中 ${recordingCount}件`;
      } else {
        chipLabel = `AI生成中 ${processingCount}件`;
      }
    } else {
      chipLabel = '再起動OK (タスクなし)';
    }

    return (
      <Tooltip
        title={
          hasTasks
            ? '⚠️ 他のユーザーが録音中、または議事録生成処理中です。サーバー再起動は禁止されています（クリックで詳細）'
            : '🟢 現在、録音中や議事録生成中のタスクはありません。サーバーを安全に再起動可能です（クリックで確認）'
        }
        arrow
      >
        <Chip
          onClick={() => {
            fetchStatus(true);
            setOpenDialog(true);
          }}
          icon={
            hasTasks ? (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  ml: 0.5,
                }}
              >
                {/* 録音中の場合は赤く脈動するインジケータードット */}
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: recordingCount > 0 ? '#ff1744' : '#ff9100',
                    boxShadow: recordingCount > 0 ? '0 0 8px #ff1744' : '0 0 8px #ff9100',
                    animation: 'blinkDot 1.2s infinite ease-in-out',
                    '@keyframes blinkDot': {
                      '0%': { opacity: 1, transform: 'scale(1)' },
                      '50%': { opacity: 0.35, transform: 'scale(0.8)' },
                      '100%': { opacity: 1, transform: 'scale(1)' },
                    },
                  }}
                />
              </Box>
            ) : (
              <CheckCircleOutlineIcon sx={{ fontSize: '1.15rem !important', color: '#2e7d32 !important' }} />
            )
          }
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 800,
                  fontSize: '0.8rem',
                  letterSpacing: 0.3,
                  color: hasTasks ? '#ffffff' : 'inherit',
                }}
              >
                {chipLabel}
              </Typography>
              {hasTasks && (
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 900,
                    fontSize: '0.65rem',
                    bgcolor: 'rgba(0, 0, 0, 0.35)',
                    color: '#ffea00',
                    px: 0.8,
                    py: 0.15,
                    borderRadius: 1,
                    letterSpacing: 0.5,
                  }}
                >
                  再起動厳禁
                </Typography>
              )}
            </Box>
          }
          size="medium"
          clickable
          sx={{
            cursor: 'pointer',
            height: 32,
            px: 1,
            borderRadius: 3,
            transition: 'all 0.25s ease-in-out',
            ...(hasTasks
              ? {
                  background:
                    recordingCount > 0
                      ? 'linear-gradient(135deg, #c62828 0%, #e53935 50%, #f57c00 100%)'
                      : 'linear-gradient(135deg, #e65100 0%, #f57c00 50%, #ffa726 100%)',
                  color: '#ffffff',
                  boxShadow: '0 0 12px rgba(229, 57, 53, 0.55)',
                  border: '1.5px solid rgba(255, 255, 255, 0.65)',
                  animation: 'pulseGlow 2s infinite ease-in-out',
                  '@keyframes pulseGlow': {
                    '0%': { boxShadow: '0 0 8px rgba(229, 57, 53, 0.4)' },
                    '50%': { boxShadow: '0 0 18px rgba(244, 67, 54, 0.85)' },
                    '100%': { boxShadow: '0 0 8px rgba(229, 57, 53, 0.4)' },
                  },
                  '&:hover': {
                    filter: 'brightness(1.15)',
                    transform: 'scale(1.03)',
                  },
                }
              : {
                  bgcolor: 'action.hover',
                  color: 'text.primary',
                  border: '1px solid',
                  borderColor: 'divider',
                  '&:hover': {
                    bgcolor: 'action.selected',
                  },
                }),
          }}
        />
      </Tooltip>
    );
  };

  return (
    <>
      {variant === 'banner' && renderBanner()}
      {variant === 'chip' && renderChip()}
      {variant === 'all' && (
        <>
          {renderBanner()}
          {renderChip()}
        </>
      )}

      {/* 詳細確認ダイアログ */}
      <Dialog
        open={openDialog}
        onClose={() => setOpenDialog(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: { borderRadius: 3, overflow: 'hidden' },
        }}
      >
        {/* ダイアログ上部の信号機ヘッダー */}
        <Box
          sx={{
            p: 2.5,
            background: hasTasks
              ? 'linear-gradient(135deg, #b71c1c 0%, #d32f2f 60%, #e65100 100%)'
              : 'linear-gradient(135deg, #1b5e20 0%, #2e7d32 60%, #388e3c 100%)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box
              sx={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                bgcolor: 'rgba(0,0,0,0.25)',
                border: '3px solid rgba(255,255,255,0.7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {hasTasks ? (
                <BlockIcon sx={{ fontSize: 32, color: '#ffea00' }} />
              ) : (
                <CheckCircleOutlineIcon sx={{ fontSize: 34, color: '#ffffff' }} />
              )}
            </Box>
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 900, letterSpacing: 0.5, lineHeight: 1.2 }}>
                {hasTasks ? '🚫 サーバー再起動 厳禁' : '✅ サーバー再起動 安全'}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9, mt: 0.5 }}>
                {hasTasks
                  ? '現在、会議の録音またはAI議事録生成処理が進行中です。再起動はお控えください。'
                  : '現在進行中の録音・生成タスクはありません。安全に再起動やメンテナンスが可能です。'}
              </Typography>
            </Box>
          </Box>

          <Tooltip title="最新の状態に更新">
            <IconButton
              onClick={() => fetchStatus(true)}
              disabled={loading}
              sx={{ color: '#ffffff', bgcolor: 'rgba(255,255,255,0.15)', '&:hover': { bgcolor: 'rgba(255,255,255,0.3)' } }}
            >
              {loading ? <CircularProgress size={22} color="inherit" /> : <RefreshIcon />}
            </IconButton>
          </Tooltip>
        </Box>

        <DialogContent sx={{ py: 3, px: 3 }}>
          {/* 集計ダッシュボードカード */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2, mb: 3 }}>
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 2,
                textAlign: 'center',
                borderColor: recordingCount > 0 ? '#d32f2f' : 'divider',
                bgcolor: recordingCount > 0 ? 'rgba(211, 47, 47, 0.05)' : 'background.paper',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.8, color: recordingCount > 0 ? '#d32f2f' : 'text.secondary', mb: 0.5 }}>
                <MicIcon fontSize="small" />
                <Typography variant="caption" sx={{ fontWeight: 700 }}>ブラウザ録音中</Typography>
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 900, color: recordingCount > 0 ? '#d32f2f' : 'text.primary' }}>
                {recordingCount} <Typography component="span" variant="body2" color="text.secondary">件</Typography>
              </Typography>
            </Paper>

            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 2,
                textAlign: 'center',
                borderColor: processingCount > 0 ? '#f57c00' : 'divider',
                bgcolor: processingCount > 0 ? 'rgba(245, 124, 0, 0.05)' : 'background.paper',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.8, color: processingCount > 0 ? '#f57c00' : 'text.secondary', mb: 0.5 }}>
                <AutoAwesomeIcon fontSize="small" />
                <Typography variant="caption" sx={{ fontWeight: 700 }}>AI議事録生成中</Typography>
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 900, color: processingCount > 0 ? '#f57c00' : 'text.primary' }}>
                {processingCount} <Typography component="span" variant="body2" color="text.secondary">件</Typography>
              </Typography>
            </Paper>

            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 2,
                textAlign: 'center',
                borderColor: hasTasks ? '#d32f2f' : '#2e7d32',
                bgcolor: hasTasks ? 'rgba(211, 47, 47, 0.03)' : 'rgba(46, 125, 50, 0.05)',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.8, color: hasTasks ? '#d32f2f' : '#2e7d32', mb: 0.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>再起動ステータス判定</Typography>
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 900, color: hasTasks ? '#d32f2f' : '#2e7d32', mt: 0.5 }}>
                {hasTasks ? '再起動 NG' : '再起動 OK'}
              </Typography>
            </Paper>
          </Box>

          {/* タスク一覧 */}
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <span>アクティブなタスク詳細一覧</span>
            <Chip
              label={`${data?.meetings.length ?? 0} 件`}
              size="small"
              color={hasTasks ? 'error' : 'default'}
              sx={{ height: 20, fontSize: '0.75rem', fontWeight: 800 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
              最終同期: {lastChecked ? lastChecked.toLocaleTimeString() : '取得中...'}
            </Typography>
          </Typography>

          {(!data?.meetings || data.meetings.length === 0) ? (
            <Paper
              variant="outlined"
              sx={{
                py: 4,
                textAlign: 'center',
                bgcolor: 'action.hover',
                borderRadius: 2,
                borderStyle: 'dashed',
              }}
            >
              <CheckCircleOutlineIcon sx={{ color: '#2e7d32', fontSize: 44, mb: 1, opacity: 0.8 }} />
              <Typography variant="body1" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
                稼働中のタスクはありません
              </Typography>
              <Typography variant="caption" color="text.secondary">
                サーバーの再起動、プログラムの更新、メンテナンスを安全に実施できます。
              </Typography>
            </Paper>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxHeight: 360, overflowY: 'auto' }}>
              {data.meetings.map((item) => {
                const isRecording = item.status === 'recording';
                return (
                  <Card
                    key={item.id}
                    variant="outlined"
                    sx={{
                      borderRadius: 2,
                      borderLeft: '5px solid',
                      borderLeftColor: isRecording ? '#d32f2f' : '#f57c00',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                    }}
                  >
                    <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 1 }}>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
                            <Chip
                              icon={
                                isRecording ? (
                                  <MicIcon sx={{ fontSize: '0.9rem !important' }} />
                                ) : (
                                  <AutoAwesomeIcon sx={{ fontSize: '0.9rem !important' }} />
                                )
                              }
                              label={isRecording ? '🔴 ブラウザで音声録音中' : '⚙️ AI解析・議事録生成中'}
                              size="small"
                              sx={{
                                height: 24,
                                fontSize: '0.75rem',
                                fontWeight: 800,
                                bgcolor: isRecording ? 'rgba(211, 47, 47, 0.12)' : 'rgba(245, 124, 0, 0.12)',
                                color: isRecording ? '#d32f2f' : '#f57c00',
                              }}
                            />
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                              <FolderIcon sx={{ fontSize: 16 }} />
                              <Typography variant="caption" sx={{ fontWeight: 700 }}>
                                {item.project_name}
                              </Typography>
                            </Box>
                          </Box>
                          <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.3 }}>
                            {item.title}
                          </Typography>
                        </Box>

                        <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            開始/更新: {formatTimeAgo(item.updated_at || item.created_at)}
                          </Typography>
                          {item.analysis_progress != null && !isRecording && (
                            <Typography variant="caption" sx={{ fontWeight: 800, color: 'primary.main' }}>
                              進捗率: {item.analysis_progress}%
                            </Typography>
                          )}
                        </Box>
                      </Box>

                      <Divider sx={{ my: 1 }} />

                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                          <PeopleAltIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                          <Typography variant="caption" color="text.secondary">
                            参加者:{' '}
                            {item.attendees && item.attendees.length > 0
                              ? item.attendees.join(', ')
                              : '未指定'}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                          <AccessTimeIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                          <Typography variant="caption" color="text.secondary">
                            会議ID: #{item.id}
                          </Typography>
                        </Box>
                      </Box>
                    </CardContent>
                  </Card>
                );
              })}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, bgcolor: 'action.hover', justifyContent: 'space-between' }}>
          <Button
            startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
            onClick={() => fetchStatus(true)}
            disabled={loading}
            size="small"
            variant="outlined"
          >
            最新状態を再確認
          </Button>
          <Button onClick={() => setOpenDialog(false)} variant="contained" size="small">
            閉じる
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default MeetingServerStatusIndicator;
