import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Alert,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Stack,
  Avatar,
  Tooltip,
  useMediaQuery,
  useTheme,
  Breadcrumbs,
  Link,
  IconButton,
} from '@mui/material';
import {
  AccessTime as AccessTimeIcon,
  Circle as CircleIcon,
  Refresh as RefreshIcon,
  FilterAltOff as FilterAltOffIcon,
  CalendarToday as CalendarTodayIcon,
  Person as PersonIcon,
  Schedule as ScheduleIcon,
  Login as LoginIcon,
} from '@mui/icons-material';
import api from '../services/api';
import { User } from '../types';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';

interface UserActivity {
  id: number;
  user_id: number;
  active_at: string;
  cycle_date: string;
  created_at: string;
}

interface UserActivityWithUser extends UserActivity {
  user?: User;
}

function getTodayCycleDateString(): string {
  const today = new Date();
  const cycleDate =
    today.getHours() < 5
      ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
      : new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return format(cycleDate, 'yyyy-MM-dd');
}

function getUserDisplayName(user?: User): string {
  return user?.full_name || user?.name || user?.username || user?.email || 'Unknown';
}

function getUserInitials(user?: User): string {
  const name = getUserDisplayName(user);
  return name
    .split(/[\s_]/)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() || '')
    .join('');
}

const USER_COLORS = [
  '#1976d2', '#d32f2f', '#388e3c', '#f57c00',
  '#7b1fa2', '#0288d1', '#c2185b', '#00796b',
  '#5d4037', '#455a64', '#e64a19', '#512da8',
];

// 周期時間を cycleHour（5～28）に変換
function toCycleHour(date: Date): number {
  const h = date.getHours();
  return h < 5 ? h + 24 : h;
}

// タイムライングリッドのスロット数（5:00〜29:00, 30分刻み = 48スロット）
const SLOT_MINUTES = 30;
const HOUR_START = 5;
const HOUR_END = 29; // 翌5:00 = exclusive
const TOTAL_SLOTS = ((HOUR_END - HOUR_START) * 60) / SLOT_MINUTES;

function getSlotLabel(slotIndex: number): string {
  const totalMinutes = HOUR_START * 60 + slotIndex * SLOT_MINUTES;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const displayH = h >= 24 ? h - 24 : h;
  return `${String(displayH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getSlotCycleMinutes(slotIndex: number): number {
  return HOUR_START * 60 + slotIndex * SLOT_MINUTES;
}

const UserActivityPage: React.FC = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isDark = theme.palette.mode === 'dark';

  const [activities, setActivities] = useState<UserActivityWithUser[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | ''>('');
  const [selectedCycleDate, setSelectedCycleDate] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(new Date());

  const effectiveCycleDate = selectedCycleDate || getTodayCycleDateString();
  const isShowingToday = effectiveCycleDate === getTodayCycleDateString();

  // リアルタイム時刻更新（1分ごと）
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await api.get<User[]>('/api/users');
      setUsers(res.data);
    } catch (e) {
      console.error('Failed to fetch users:', e);
    }
  }, []);

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, unknown> = { cycle_date: effectiveCycleDate };
      if (selectedUserId) params.user_id = selectedUserId;

      const res = await api.get<UserActivity[]>('/api/user-activities', { params });
      setActivities(
        res.data.map((a) => ({ ...a, user: users.find((u) => u.id === a.user_id) }))
      );
    } catch (err: any) {
      setError(err.response?.data?.detail || 'アクティビティの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [effectiveCycleDate, selectedUserId, users]);

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    if (users.length > 0) fetchActivities();
  }, [selectedUserId, selectedCycleDate, users]);

  // 30秒ごと自動更新
  useEffect(() => {
    if (loading || users.length === 0) return;
    const id = setInterval(() => fetchActivities(), 30_000);
    return () => clearInterval(id);
  }, [loading, fetchActivities, users]);

  // ユーザーリスト（アクティビティに登場するユーザー）
  const activeUserIds = useMemo(
    () => Array.from(new Set(activities.map((a) => a.user_id))),
    [activities]
  );

  const userColorMap = useMemo(() => {
    const map = new Map<number, string>();
    activeUserIds.forEach((uid, i) => map.set(uid, USER_COLORS[i % USER_COLORS.length]));
    return map;
  }, [activeUserIds]);

  // ユーザーごとのアクティビティを時系列ソート
  const activitiesByUser = useMemo(() => {
    const map = new Map<number, Date[]>();
    activities.forEach((a) => {
      if (!map.has(a.user_id)) map.set(a.user_id, []);
      map.get(a.user_id)!.push(parseISO(a.active_at));
    });
    map.forEach((dates) => dates.sort((a, b) => a.getTime() - b.getTime()));
    return map;
  }, [activities]);

  // ユーザー統計（セッション数・アクティブ時間・最終アクセス）
  const userStats = useMemo(() => {
    const SESSION_GAP = 15; // 15分以上空いたら別セッション
    return activeUserIds.map((userId) => {
      const user = users.find((u) => u.id === userId);
      const dates = activitiesByUser.get(userId) || [];

      const sessions: { start: Date; end: Date; minutes: number }[] = [];
      let sessionStart: Date | null = null;
      let lastTime: Date | null = null;

      for (const d of dates) {
        if (!sessionStart) {
          sessionStart = d;
          lastTime = d;
        } else if (lastTime) {
          const gap = (d.getTime() - lastTime.getTime()) / 60_000;
          if (gap > SESSION_GAP) {
            sessions.push({ start: sessionStart, end: lastTime, minutes: (lastTime.getTime() - sessionStart.getTime()) / 60_000 });
            sessionStart = d;
          }
          lastTime = d;
        }
      }
      if (sessionStart && lastTime) {
        sessions.push({ start: sessionStart, end: lastTime, minutes: (lastTime.getTime() - sessionStart.getTime()) / 60_000 });
      }

      const totalMinutes = sessions.reduce((s, sess) => s + sess.minutes, 0);
      const lastActive = dates[dates.length - 1] ?? null;
      const minutesSinceLast = lastActive
        ? (currentTime.getTime() - lastActive.getTime()) / 60_000
        : Infinity;
      const isOnline = isShowingToday && minutesSinceLast <= 10;

      return {
        userId,
        user,
        name: getUserDisplayName(user),
        initials: getUserInitials(user),
        sessionCount: sessions.length,
        totalMinutes,
        activeHours: Math.round((totalMinutes / 60) * 10) / 10,
        lastActive,
        minutesSinceLast,
        isOnline,
        color: userColorMap.get(userId) || USER_COLORS[0],
      };
    }).sort((a, b) => b.sessionCount - a.sessionCount || a.name.localeCompare(b.name));
  }, [activeUserIds, activitiesByUser, users, currentTime, isShowingToday, userColorMap]);

  // タイムライングリッド（各ユーザー × 各スロット）
  const cycleBase = useMemo(() => {
    const d = parseISO(effectiveCycleDate);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, [effectiveCycleDate]);

  const currentSlotIndex = useMemo(() => {
    if (!isShowingToday) return -1;
    const cycleH = toCycleHour(currentTime);
    const m = currentTime.getMinutes();
    const totalMin = cycleH * 60 + m - HOUR_START * 60;
    return Math.floor(totalMin / SLOT_MINUTES);
  }, [currentTime, isShowingToday]);

  const timelineGrid = useMemo(() => {
    return userStats.map(({ userId, color }) => {
      const dates = activitiesByUser.get(userId) || [];
      const slots = Array.from({ length: TOTAL_SLOTS }, (_, i) => {
        const slotCycleMin = getSlotCycleMinutes(i);
        const slotH = Math.floor(slotCycleMin / 60);
        const slotM = slotCycleMin % 60;

        const slotStart = new Date(cycleBase);
        slotStart.setHours(slotH >= 24 ? slotH - 24 : slotH, slotM, 0, 0);
        if (slotH >= 24) slotStart.setDate(slotStart.getDate() + 1);

        const slotEnd = new Date(slotStart.getTime() + SLOT_MINUTES * 60_000);

        // 未来スロットはグレー
        if (isShowingToday && slotStart > currentTime) return 'future';

        // このスロット内にアクティビティがあるか
        const hasActivity = dates.some((d) => d >= slotStart && d < slotEnd);
        return hasActivity ? 'active' : 'inactive';
      });
      return { userId, color, slots };
    });
  }, [userStats, activitiesByUser, cycleBase, currentTime, isShowingToday]);

  const handleClearFilters = () => {
    setSelectedUserId('');
    setSelectedCycleDate('');
  };

  // 時間軸ラベル（偶数時間のみ表示）
  const axisLabels = useMemo(
    () =>
      Array.from({ length: TOTAL_SLOTS }, (_, i) => {
        const totalMin = HOUR_START * 60 + i * SLOT_MINUTES;
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        return m === 0 && h % 2 === 1 ? getSlotLabel(i) : '';
      }),
    []
  );

  return (
    <Box sx={{ p: isMobile ? 1.5 : 3, pb: isMobile ? 10 : 4 }}>
      {/* ヘッダー */}
      <Box sx={{ mb: 3 }}>
        <Breadcrumbs sx={{ mb: 1.5 }}>
          <Link
            color="inherit"
            onClick={() => navigate('/dashboard')}
            sx={{ cursor: 'pointer', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
          >
            App
          </Link>
          <Typography color="text.primary" sx={{ fontWeight: 500 }}>
            ユーザーアクティビティ
          </Typography>
        </Breadcrumbs>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 2.5,
                background: 'linear-gradient(135deg, #00BCD4 0%, #3F51B5 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AccessTimeIcon sx={{ color: '#fff', fontSize: '1.4rem' }} />
            </Box>
            <Box>
              <Typography
                variant="h5"
                sx={{
                  fontWeight: 800,
                  background: isDark
                    ? 'linear-gradient(90deg, #4dd0e1, #7986cb)'
                    : 'linear-gradient(90deg, #0097a7, #303f9f)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  lineHeight: 1.2,
                }}
              >
                ユーザーアクティビティ
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {format(parseISO(effectiveCycleDate), 'yyyy年M月d日（EEE）', { locale: ja })} ・ 5:00〜翌4:59
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {isShowingToday && (
              <Chip
                icon={<CircleIcon sx={{ fontSize: '0.55rem !important' }} />}
                label="リアルタイム"
                size="small"
                color="success"
                sx={{ fontWeight: 700, fontSize: '0.72rem' }}
              />
            )}
            <Tooltip title="今すぐ更新">
              <IconButton size="small" onClick={fetchActivities} disabled={loading}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Box>

      {/* フィルター */}
      <Paper
        sx={{
          p: 2,
          mb: 3,
          borderRadius: 3,
          border: '1px solid',
          borderColor: 'divider',
          background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.01)',
        }}
        elevation={0}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <CalendarTodayIcon sx={{ color: 'text.disabled', display: { xs: 'none', sm: 'block' } }} />
          <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 200 } }}>
            <InputLabel>ユーザー絞込</InputLabel>
            <Select
              value={selectedUserId}
              label="ユーザー絞込"
              onChange={(e) => setSelectedUserId(e.target.value as number | '')}
              sx={{ borderRadius: 2 }}
            >
              <MenuItem value="">全員</MenuItem>
              {users.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {getUserDisplayName(u)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="日付（周期日）"
            type="date"
            size="small"
            value={selectedCycleDate}
            onChange={(e) => setSelectedCycleDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: { xs: '100%', sm: 200 }, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
          />
          {(selectedUserId !== '' || selectedCycleDate !== '') && (
            <Button
              size="small"
              variant="text"
              startIcon={<FilterAltOffIcon />}
              onClick={handleClearFilters}
              sx={{ whiteSpace: 'nowrap' }}
            >
              フィルター解除
            </Button>
          )}
        </Stack>
      </Paper>

      {/* ローディング */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!loading && !error && (
        <>
          {activities.length === 0 ? (
            <Paper sx={{ p: 5, textAlign: 'center', borderRadius: 3 }} elevation={0}>
              <ScheduleIcon sx={{ fontSize: '3rem', color: 'text.disabled', mb: 1 }} />
              <Typography color="text.secondary" fontWeight={600}>
                この日のアクティビティデータがありません
              </Typography>
              <Typography variant="caption" color="text.disabled">
                別の日付を選択するか、フィルターを解除してください
              </Typography>
            </Paper>
          ) : (
            <>
              {/* ユーザーサマリーカード */}
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.72rem' }}>
                メンバー概要
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr 1fr',
                    sm: 'repeat(3, 1fr)',
                    md: 'repeat(4, 1fr)',
                    lg: 'repeat(5, 1fr)',
                  },
                  gap: 1.5,
                  mb: 3,
                }}
              >
                {userStats.map((stat) => (
                  <Paper
                    key={stat.userId}
                    elevation={0}
                    sx={{
                      p: 1.75,
                      borderRadius: 3,
                      border: '1.5px solid',
                      borderColor: stat.isOnline ? `${stat.color}55` : 'divider',
                      background: stat.isOnline
                        ? isDark
                          ? `${stat.color}18`
                          : `${stat.color}0d`
                        : isDark
                        ? 'rgba(255,255,255,0.03)'
                        : 'rgba(0,0,0,0.015)',
                      transition: 'all 0.2s',
                      '&:hover': { borderColor: stat.color, transform: 'translateY(-1px)' },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
                      <Avatar
                        sx={{
                          width: 34,
                          height: 34,
                          bgcolor: stat.color,
                          fontSize: '0.8rem',
                          fontWeight: 800,
                        }}
                      >
                        {stat.initials || <PersonIcon sx={{ fontSize: '1rem' }} />}
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          variant="caption"
                          sx={{
                            fontWeight: 700,
                            display: 'block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontSize: '0.8rem',
                          }}
                        >
                          {stat.name}
                        </Typography>
                        {stat.isOnline ? (
                          <Chip
                            label="オンライン"
                            size="small"
                            sx={{
                              height: 16,
                              fontSize: '0.62rem',
                              fontWeight: 700,
                              bgcolor: `${stat.color}22`,
                              color: stat.color,
                              border: `1px solid ${stat.color}44`,
                              '& .MuiChip-label': { px: 0.75 },
                            }}
                          />
                        ) : (
                          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.68rem' }}>
                            {stat.lastActive
                              ? `最終: ${format(stat.lastActive, 'HH:mm', { locale: ja })}`
                              : 'ログインなし'}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1.5 }}>
                      <Tooltip title="セッション数（ログイン回数）">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                          <LoginIcon sx={{ fontSize: '0.9rem', color: 'text.disabled' }} />
                          <Typography variant="caption" sx={{ fontWeight: 800, fontSize: '0.85rem', color: stat.color }}>
                            {stat.sessionCount}
                          </Typography>
                          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.68rem' }}>
                            回
                          </Typography>
                        </Box>
                      </Tooltip>
                      <Tooltip title="推定アクティブ時間">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                          <ScheduleIcon sx={{ fontSize: '0.9rem', color: 'text.disabled' }} />
                          <Typography variant="caption" sx={{ fontWeight: 800, fontSize: '0.85rem', color: stat.color }}>
                            {stat.activeHours}
                          </Typography>
                          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.68rem' }}>
                            h
                          </Typography>
                        </Box>
                      </Tooltip>
                    </Box>
                  </Paper>
                ))}
              </Box>

              {/* タイムライングリッド */}
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.72rem' }}>
                タイムライン（30分刻み）
              </Typography>
              <Paper
                elevation={0}
                sx={{
                  borderRadius: 3,
                  border: '1px solid',
                  borderColor: 'divider',
                  overflow: 'hidden',
                }}
              >
                {/* 時間軸ヘッダー */}
                <Box
                  sx={{
                    display: 'flex',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
                  }}
                >
                  {/* 名前列ヘッダー */}
                  <Box
                    sx={{
                      minWidth: isMobile ? 72 : 120,
                      width: isMobile ? 72 : 120,
                      flexShrink: 0,
                      p: 1,
                      borderRight: '1px solid',
                      borderColor: 'divider',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.68rem', fontWeight: 700 }}>
                      メンバー
                    </Typography>
                  </Box>
                  {/* 時間ラベル */}
                  <Box sx={{ flex: 1, overflowX: 'auto' }}>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${TOTAL_SLOTS}, 1fr)`,
                        minWidth: isMobile ? `${TOTAL_SLOTS * 14}px` : '100%',
                      }}
                    >
                      {Array.from({ length: TOTAL_SLOTS }, (_, i) => (
                        <Box key={i} sx={{ borderRight: i % 2 === 1 ? '1px solid' : 'none', borderColor: 'divider', px: 0.25, py: 0.5, minWidth: 0 }}>
                          <Typography
                            variant="caption"
                            sx={{
                              fontSize: '0.6rem',
                              color: axisLabels[i] ? 'text.secondary' : 'transparent',
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                              userSelect: 'none',
                            }}
                          >
                            {axisLabels[i] || '·'}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Box>

                {/* ユーザー行 */}
                {timelineGrid.map((row, rowIdx) => {
                  const stat = userStats.find((s) => s.userId === row.userId);
                  if (!stat) return null;
                  return (
                    <Box
                      key={row.userId}
                      sx={{
                        display: 'flex',
                        borderBottom: rowIdx < timelineGrid.length - 1 ? '1px solid' : 'none',
                        borderColor: 'divider',
                        '&:hover': {
                          background: isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.015)',
                        },
                      }}
                    >
                      {/* ユーザー名 */}
                      <Box
                        sx={{
                          minWidth: isMobile ? 72 : 120,
                          width: isMobile ? 72 : 120,
                          flexShrink: 0,
                          p: 1,
                          borderRight: '1px solid',
                          borderColor: 'divider',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.75,
                        }}
                      >
                        <Avatar sx={{ width: 22, height: 22, bgcolor: stat.color, fontSize: '0.6rem', fontWeight: 800, flexShrink: 0 }}>
                          {stat.initials}
                        </Avatar>
                        {!isMobile && (
                          <Typography
                            variant="caption"
                            sx={{ fontWeight: 700, fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            {stat.name}
                          </Typography>
                        )}
                      </Box>

                      {/* スロット列 */}
                      <Box sx={{ flex: 1, overflowX: 'auto' }}>
                        <Box
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(${TOTAL_SLOTS}, 1fr)`,
                            minWidth: isMobile ? `${TOTAL_SLOTS * 14}px` : '100%',
                            height: 36,
                          }}
                        >
                          {row.slots.map((slotState, slotIdx) => {
                            const isCurrentSlot = slotIdx === currentSlotIndex;
                            const label = getSlotLabel(slotIdx);
                            return (
                              <Tooltip
                                key={slotIdx}
                                title={
                                  slotState === 'active'
                                    ? `${stat.name} ${label} アクティブ`
                                    : slotState === 'future'
                                    ? `${label} （未来）`
                                    : `${stat.name} ${label} 非アクティブ`
                                }
                                arrow
                              >
                                <Box
                                  sx={{
                                    height: '100%',
                                    bgcolor:
                                      slotState === 'active'
                                        ? row.color
                                        : slotState === 'future'
                                        ? isDark
                                          ? 'rgba(255,255,255,0.03)'
                                          : 'rgba(0,0,0,0.03)'
                                        : 'transparent',
                                    opacity: slotState === 'active' ? 0.85 : 1,
                                    borderRight: slotIdx % 2 === 1 ? '1px solid' : 'none',
                                    borderColor: 'divider',
                                    outline: isCurrentSlot ? `2px solid #f44336` : 'none',
                                    outlineOffset: -2,
                                    transition: 'background 0.15s',
                                    cursor: 'default',
                                  }}
                                />
                              </Tooltip>
                            );
                          })}
                        </Box>
                      </Box>
                    </Box>
                  );
                })}

                {/* 凡例フッター */}
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    px: 2,
                    py: 1.25,
                    borderTop: '1px solid',
                    borderColor: 'divider',
                    flexWrap: 'wrap',
                    background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Box sx={{ width: 18, height: 12, borderRadius: 0.5, bgcolor: '#1976d2', opacity: 0.85 }} />
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.72rem' }}>
                      アクティブ
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Box sx={{ width: 18, height: 12, borderRadius: 0.5, bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)' }} />
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.72rem' }}>
                      非アクティブ
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Box sx={{ width: 18, height: 12, borderRadius: 0.5, border: '2px solid #f44336' }} />
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.72rem' }}>
                      現在時刻
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.7rem', ml: 'auto' }}>
                    ※ 1スロット = 30分。アクティビティが1件以上記録された時間帯をアクティブと判定
                  </Typography>
                </Box>
              </Paper>
            </>
          )}
        </>
      )}
    </Box>
  );
};

export default UserActivityPage;
