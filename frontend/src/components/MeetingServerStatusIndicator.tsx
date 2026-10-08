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
} from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import FolderIcon from '@mui/icons-material/Folder';
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

const MeetingServerStatusIndicator: React.FC = () => {
  const [data, setData] = useState<ActiveStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await api.get<ActiveStatusResponse>('/meetings/active-status');
      setData(res.data);
      setLastChecked(new Date());
    } catch (e) {
      // ネットワークや未認証等でのエラー時は静かに無視
      console.warn('Failed to fetch meeting active status:', e);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 初回取得
    fetchStatus();

    // 15秒ごとにポーリングして最新状況を監視
    pollTimerRef.current = setInterval(() => {
      fetchStatus();
    }, 15000);

    // 自身のタブで録音開始/停止があった際や、画面復帰時の即時更新
    const handleStatusChanged = () => {
      fetchStatus();
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

  // ラベルテキストの構築
  let chipLabel = '';
  if (hasTasks) {
    if (recordingCount > 0 && processingCount > 0) {
      chipLabel = `録音 ${recordingCount}件 / 生成 ${processingCount}件`;
    } else if (recordingCount > 0) {
      chipLabel = `録音中 ${recordingCount}件`;
    } else {
      chipLabel = `議事録生成中 ${processingCount}件`;
    }
  } else {
    chipLabel = '会議タスクなし';
  }

  // 経過時間の表記計算
  const formatTimeAgo = (isoString: string | null) => {
    if (!isoString) return '不明';
    try {
      const date = new Date(isoString);
      const diffMs = Date.now() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'たった今';
      if (diffMins < 60) return `約${diffMins}分前`;
      const diffHours = Math.floor(diffMins / 60);
      return `約${diffHours}時間${diffMins % 60}分前`;
    } catch {
      return isoString;
    }
  };

  return (
    <>
      <Tooltip
        title={
          hasTasks
            ? '⚠️ 他のユーザーが録音中、または議事録生成処理中です。クリックして詳細を確認できます（サーバー再起動に注意）'
            : '✅ 現在、録音中や議事録生成中のタスクはありません。サーバーを安全に再起動可能です（クリックで確認）'
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
              recordingCount > 0 ? (
                <MicIcon sx={{ fontSize: '1.1rem !important', color: '#fff !important' }} />
              ) : (
                <AutoAwesomeIcon sx={{ fontSize: '1.1rem !important', color: '#fff !important' }} />
              )
            ) : (
              <CheckCircleOutlineIcon sx={{ fontSize: '1.1rem !important', color: 'inherit !important' }} />
            )
          }
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.3 }}>
                {chipLabel}
              </Typography>
              {hasTasks && (
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 800,
                    fontSize: '0.65rem',
                    bgcolor: 'rgba(0,0,0,0.25)',
                    px: 0.6,
                    py: 0.1,
                    borderRadius: 1,
                  }}
                >
                  再起動注意
                </Typography>
              )}
            </Box>
          }
          size="small"
          clickable
          sx={{
            cursor: 'pointer',
            height: 28,
            px: 0.5,
            transition: 'all 0.25s ease-in-out',
            ...(hasTasks
              ? {
                  background:
                    recordingCount > 0
                      ? 'linear-gradient(135deg, #d32f2f 0%, #f57c00 100%)'
                      : 'linear-gradient(135deg, #e65100 0%, #fbc02d 100%)',
                  color: '#fff',
                  boxShadow: '0 0 10px rgba(244, 67, 54, 0.45)',
                  border: '1px solid rgba(255,255,255,0.4)',
                  animation: 'pulseGlow 2s infinite ease-in-out',
                  '@keyframes pulseGlow': {
                    '0%': { boxShadow: '0 0 6px rgba(244, 67, 54, 0.4)' },
                    '50%': { boxShadow: '0 0 16px rgba(244, 67, 54, 0.85)' },
                    '100%': { boxShadow: '0 0 6px rgba(244, 67, 54, 0.4)' },
                  },
                  '&:hover': {
                    filter: 'brightness(1.15)',
                    transform: 'scale(1.02)',
                  },
                }
              : {
                  bgcolor: 'action.hover',
                  color: 'text.secondary',
                  border: '1px solid',
                  borderColor: 'divider',
                  '&:hover': {
                    bgcolor: 'action.selected',
                    color: 'text.primary',
                  },
                }),
          }}
        />
      </Tooltip>

      {/* 詳細確認ダイアログ */}
      <Dialog
        open={openDialog}
        onClose={() => setOpenDialog(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: { borderRadius: 3, p: 1 },
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {hasTasks ? (
              <WarningAmberIcon sx={{ color: '#d32f2f', fontSize: 32 }} />
            ) : (
              <CheckCircleOutlineIcon sx={{ color: '#2e7d32', fontSize: 32 }} />
            )}
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                {hasTasks ? 'サーバー再起動 注意（録音・議事録タスク稼働中）' : 'サーバー再起動 安全（稼働中タスクなし）'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                最終確認時刻: {lastChecked ? lastChecked.toLocaleTimeString() : '取得中...'}
              </Typography>
            </Box>
          </Box>
          <Tooltip title="最新の状態に更新">
            <IconButton onClick={() => fetchStatus(true)} disabled={loading} size="small">
              {loading ? <CircularProgress size={20} /> : <RefreshIcon />}
            </IconButton>
          </Tooltip>
        </DialogTitle>

        <DialogContent dividers sx={{ py: 2.5 }}>
          {hasTasks ? (
            <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
                現在、ブラウザ録音またはAIによる議事録生成処理が実行されています。
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', color: 'text.primary' }}>
                この状態でバックエンドサーバーを再起動すると、進行中のブラウザ録音が切断されたり、文字起こし・要約・タスク抽出などのAI処理が破損・失敗します。
                以下のタスクが完了するまで、<strong>サーバーの再起動はお控えください</strong>。
              </Typography>
            </Alert>
          ) : (
            <Alert severity="success" sx={{ mb: 3, borderRadius: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
                現在進行中の会議録音および議事録生成タスクはありません。
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', color: 'text.primary' }}>
                サーバーの再起動やメンテナンスを行っても、実行中の議事録タスクに影響はありません。安全に再起動を実施いただけます。
              </Typography>
            </Alert>
          )}

          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
              <span>アクティブなタスク一覧</span>
              <Chip
                label={`${data?.meetings.length ?? 0} 件`}
                size="small"
                color={hasTasks ? 'error' : 'default'}
                sx={{ height: 20, fontSize: '0.75rem', fontWeight: 700 }}
              />
            </Typography>

            {(!data?.meetings || data.meetings.length === 0) ? (
              <Box
                sx={{
                  py: 4,
                  textAlign: 'center',
                  bgcolor: 'action.hover',
                  borderRadius: 2,
                  border: '1px dashed',
                  borderColor: 'divider',
                }}
              >
                <CheckCircleOutlineIcon sx={{ color: 'text.secondary', fontSize: 40, mb: 1, opacity: 0.6 }} />
                <Typography variant="body2" color="text.secondary">
                  稼働中の録音・生成タスクはありません
                </Typography>
              </Box>
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
                        borderLeft: '4px solid',
                        borderLeftColor: isRecording ? '#d32f2f' : '#f57c00',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
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
                                label={isRecording ? '🔴 ブラウザ録音中' : '⚙️ 議事録AI生成中'}
                                size="small"
                                sx={{
                                  height: 22,
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  bgcolor: isRecording ? 'rgba(211, 47, 47, 0.12)' : 'rgba(245, 124, 0, 0.12)',
                                  color: isRecording ? '#d32f2f' : '#f57c00',
                                }}
                              />
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                                <FolderIcon sx={{ fontSize: 16 }} />
                                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                  {item.project_name}
                                </Typography>
                              </Box>
                            </Box>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
                              {item.title}
                            </Typography>
                          </Box>
                          <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              開始/更新: {formatTimeAgo(item.updated_at || item.created_at)}
                            </Typography>
                            {item.analysis_progress != null && !isRecording && (
                              <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.main' }}>
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
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 2.5, py: 1.5, justifyContent: 'space-between' }}>
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
