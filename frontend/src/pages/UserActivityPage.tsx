import React, { useState, useEffect, useMemo } from 'react';
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
  Card,
  CardContent
} from '@mui/material';
import {
  AccessTime as AccessTimeIcon,
  Timeline as TimelineIcon
} from '@mui/icons-material';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine
} from 'recharts';
import api from '../services/api';
import { User } from '../types';
import { format, parseISO, getHours, getMinutes } from 'date-fns';
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

// 今日の周期日（5:00〜翌4:59の「日」）を YYYY-MM-DD で返す
function getTodayCycleDateString(): string {
  const today = new Date();
  const cycleDate = today.getHours() < 5
    ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
    : new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return format(cycleDate, 'yyyy-MM-dd');
}

const UserActivityPage: React.FC = () => {
  const [activities, setActivities] = useState<UserActivityWithUser[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | ''>('');
  const [selectedCycleDate, setSelectedCycleDate] = useState<string>('');

  // 表示対象の周期日（未選択時は今日の周期）。取得・表示は常に「その日」単位
  const effectiveCycleDate = selectedCycleDate || getTodayCycleDateString();

  useEffect(() => {
    fetchUsers();
    fetchActivities();
  }, []);

  useEffect(() => {
    fetchActivities();
  }, [selectedUserId, selectedCycleDate]);

  // リアルタイム更新（30秒ごと）
  useEffect(() => {
    if (loading) return;

    const intervalId = setInterval(() => {
      fetchActivities();
    }, 30000); // 30秒ごとに更新

    return () => {
      clearInterval(intervalId);
    };
  }, [selectedUserId, selectedCycleDate, loading]);

  const fetchUsers = async () => {
    try {
      const response = await api.get<User[]>('/api/users');
      setUsers(response.data);
    } catch (err: any) {
      console.error('Failed to fetch users:', err);
    }
  };

  const fetchActivities = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = {};
      if (selectedUserId) {
        params.user_id = selectedUserId;
      }
      // 常に周期日で取得（日ごとのログイン回数表示のため。未選択時は今日の周期）
      params.cycle_date = effectiveCycleDate;

      const response = await api.get<UserActivity[]>('/api/user-activities', { params });
      const activitiesData = response.data;

      // ユーザー情報を結合
      const activitiesWithUsers: UserActivityWithUser[] = activitiesData.map(activity => {
        const user = users.find(u => u.id === activity.user_id);
        return { ...activity, user };
      });

      setActivities(activitiesWithUsers);
    } catch (err: any) {
      console.error('Failed to fetch activities:', err);
      setError(err.response?.data?.detail || 'アクティビティの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  // 現在時刻を取得（リアルタイム更新用）
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // 1分ごとに更新

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  // 現在時刻のラベルを計算（5:00〜28:59の周期に対応、10分刻み）
  const currentTimeLabel = useMemo(() => {
    const now = currentTime;
    const hour = getHours(now);
    const minute = getMinutes(now);

    // 5:00〜28:59の周期に変換
    let cycleHour = hour;
    if (hour < 5) {
      cycleHour = hour + 24; // 前日の5:00以降として扱う
    }

    // 10分刻みに丸める（例：13:07 → 13:10, 13:23 → 13:20）
    const roundedMinute = Math.floor(minute / 10) * 10;

    const displayHour = cycleHour >= 24 ? cycleHour - 24 : cycleHour;
    const dayLabel = cycleHour >= 24 ? '翌日' : '当日';
    // グラフのtimeLabel形式に合わせる（10分刻み）
    const timeLabel = `${dayLabel} ${displayHour.toString().padStart(2, '0')}:${roundedMinute.toString().padStart(2, '0')}`;

    return {
      cycleHour,
      roundedMinute,
      timeLabel,
      timeKey: `${cycleHour * 60 + roundedMinute}` // グラフのtimeキーと一致させる（分数で表現）
    };
  }, [currentTime]);

  // 表示中の周期日が「今日の周期」かどうか（現在時刻ライン表示用）
  const isShowingToday = useMemo(() => {
    return effectiveCycleDate === getTodayCycleDateString();
  }, [effectiveCycleDate]);

  // 時間帯別アクティビティ状態（ユーザー別）- オンオフ表示用（10分刻み）
  // 表示対象の周期日（effectiveCycleDate）の基準日
  const chartCycleBase = useMemo(() => {
    const d = parseISO(effectiveCycleDate);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, [effectiveCycleDate]);

  const hourlyDataByUser = useMemo(() => {
    // ユーザーごとのアクティビティ時刻を記録（時系列でソート）
    const userActivitiesMap = new Map<number, Array<Date>>();

    activities.forEach(activity => {
      const date = parseISO(activity.active_at);
      if (!userActivitiesMap.has(activity.user_id)) {
        userActivitiesMap.set(activity.user_id, []);
      }
      userActivitiesMap.get(activity.user_id)!.push(date);
    });

    // 各ユーザーのアクティビティを時系列でソート
    userActivitiesMap.forEach((dates, userId) => {
      dates.sort((a, b) => a.getTime() - b.getTime());
    });

    // 各10分スロットは「その時間帯に記録が1件以上あるとき」のみオン。現在周期では最後の記録から10分経過後はオフ表示
    const ACTIVE_THRESHOLD_MINUTES = 10;
    const now = currentTime;

    const result: Array<{ time: string; timeLabel: string;[key: string]: string | number }> = [];

    // 5:00から28:59まで10分刻みで生成（5:00, 5:10, 5:20, ..., 28:50＝翌4:50。28:50〜29:00で4:50〜4:59をカバー）
    for (let h = 5; h < 29; h++) {
      for (let m = 0; m < 60; m += 10) {
        const cycleMinutes = h * 60 + m; // 周期内の分数（5:00 = 300分, 28:50 = 1730分）
        const displayHour = h >= 24 ? h - 24 : h;
        const timeLabel = `${displayHour.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        const dayLabel = h >= 24 ? '翌日' : '当日';

        // 時間帯の開始時刻を計算（表示対象の周期日を基準に：選択日 or 今日の周期）
        const cycleDate = new Date(chartCycleBase.getTime());
        const timeSlotStart = new Date(cycleDate);
        timeSlotStart.setHours(h >= 24 ? h - 24 : h, m, 0, 0);
        if (h >= 24) {
          timeSlotStart.setDate(timeSlotStart.getDate() + 1);
        }

        const timeSlotEnd = new Date(timeSlotStart);
        timeSlotEnd.setMinutes(timeSlotEnd.getMinutes() + 10);

        const dataPoint: any = {
          time: `${cycleMinutes}`,
          timeLabel: `${dayLabel} ${timeLabel}`
        };

        // 表示しているのが「現在の周期」かどうか（未来スロットを0にするかどうか）
        const todayCycleDay = now.getHours() < 5 ? now.getDate() - 1 : now.getDate();
        const isCurrentCycle =
          chartCycleBase.getFullYear() === now.getFullYear() &&
          chartCycleBase.getMonth() === now.getMonth() &&
          chartCycleBase.getDate() === todayCycleDay;

        userActivitiesMap.forEach((activityDates, userId) => {
          const user = users.find(u => u.id === userId);
          const userName = user?.name || user?.username || `ユーザー${userId}`;

          // 現在周期を表示しているときのみ：その時間帯が現在時刻より後なら非アクティブ
          if (isCurrentCycle && timeSlotStart > now) {
            dataPoint[userName] = 0;
            return;
          }

          // その10分間（h:m ～ h:m+10）にアクティビティが1件以上あるときだけオンとする（1ログイン＝最大10分表示）
          let isActive = false;
          for (const activityDate of activityDates) {
            const activityTime = new Date(activityDate);
            if (activityTime >= timeSlotStart && activityTime < timeSlotEnd) {
              isActive = true;
              break;
            }
          }
          // 現在周期のみ：この時間帯に記録はあるが、最後のアクティビティから10分以上経過していれば非アクティブ表示
          if (isActive && isCurrentCycle) {
            const lastActivity = activityDates[activityDates.length - 1];
            const lastActivityTime = new Date(lastActivity);
            const minutesSinceLastActivity = (now.getTime() - lastActivityTime.getTime()) / (1000 * 60);
            if (minutesSinceLastActivity > ACTIVE_THRESHOLD_MINUTES && timeSlotStart > lastActivityTime) {
              isActive = false;
            }
          }
          dataPoint[userName] = isActive ? 1 : 0;
        });

        result.push(dataPoint);
      }
    }

    return result;
  }, [activities, users, currentTime, chartCycleBase, selectedCycleDate]);

  // ユーザー別のセッション数とアクティブ時間（ログイン回数とセッション時間）
  const userStats = useMemo(() => {
    // ユーザーごとのアクティビティを時系列でソート
    const userActivitiesMap = new Map<number, UserActivityWithUser[]>();

    activities.forEach(activity => {
      if (!userActivitiesMap.has(activity.user_id)) {
        userActivitiesMap.set(activity.user_id, []);
      }
      userActivitiesMap.get(activity.user_id)!.push(activity);
    });

    // 各ユーザーについて、セッションを計算
    const statsMap = new Map<number, { sessionCount: number; totalActiveMinutes: number; sessions: Array<{ start: Date; end: Date; minutes: number }> }>();

    userActivitiesMap.forEach((userActivities, userId) => {
      // アクティビティを時系列でソート
      const sortedActivities = userActivities.sort((a, b) =>
        parseISO(a.active_at).getTime() - parseISO(b.active_at).getTime()
      );

      // セッションを検出（アクティビティの間隔が15分以上空いたら新しいセッションとみなす）
      const SESSION_GAP_MINUTES = 15;
      const sessions: Array<{ start: Date; end: Date; minutes: number }> = [];
      let currentSessionStart: Date | null = null;
      let lastActivityTime: Date | null = null;

      sortedActivities.forEach(activity => {
        const activityTime = parseISO(activity.active_at);

        if (currentSessionStart === null) {
          // 最初のアクティビティでセッション開始
          currentSessionStart = activityTime;
          lastActivityTime = activityTime;
        } else if (lastActivityTime) {
          const minutesDiff = (activityTime.getTime() - lastActivityTime.getTime()) / (1000 * 60);

          if (minutesDiff > SESSION_GAP_MINUTES) {
            // 15分以上空いたら前のセッションを終了
            const sessionMinutes = (lastActivityTime.getTime() - currentSessionStart.getTime()) / (1000 * 60);
            sessions.push({
              start: currentSessionStart,
              end: lastActivityTime,
              minutes: sessionMinutes
            });
            // 新しいセッション開始
            currentSessionStart = activityTime;
          }
          lastActivityTime = activityTime;
        }
      });

      // 最後のセッションを追加
      if (currentSessionStart && lastActivityTime) {
        const sessionMinutes = (lastActivityTime.getTime() - currentSessionStart.getTime()) / (1000 * 60);
        sessions.push({
          start: currentSessionStart,
          end: lastActivityTime,
          minutes: sessionMinutes
        });
      }

      const totalActiveMinutes = sessions.reduce((sum, session) => sum + session.minutes, 0);
      statsMap.set(userId, {
        sessionCount: sessions.length,
        totalActiveMinutes,
        sessions
      });
    });

    return Array.from(statsMap.entries())
      .map(([userId, stats]) => {
        const user = users.find(u => u.id === userId);
        return {
          userId,
          name: user?.name || user?.username || `ユーザー${userId}`,
          sessionCount: stats.sessionCount,
          totalActiveMinutes: stats.totalActiveMinutes,
          activeHours: Math.round(stats.totalActiveMinutes / 60 * 10) / 10
        };
      })
      .sort((a, b) => b.sessionCount - a.sessionCount);
  }, [activities, users]);

  // ユーザーリストと色のマッピング
  const userColors = useMemo(() => {
    const colors = [
      '#1976d2', '#d32f2f', '#388e3c', '#f57c00',
      '#7b1fa2', '#0288d1', '#c2185b', '#00796b',
      '#5d4037', '#455a64', '#e64a19', '#512da8',
      '#0097a7', '#c51162', '#303f9f', '#00796b'
    ];

    const userList = Array.from(new Set(activities.map(a => a.user_id)))
      .map(userId => {
        const user = users.find(u => u.id === userId);
        return {
          userId,
          name: user?.name || user?.username || `ユーザー${userId}`,
          email: user?.email
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const colorMap = new Map<number, string>();
    userList.forEach((user, index) => {
      colorMap.set(user.userId, colors[index % colors.length]);
    });

    return { userList, colorMap };
  }, [activities, users]);


  const handleClearFilters = () => {
    setSelectedUserId('');
    setSelectedCycleDate('');
  };



  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <AccessTimeIcon sx={{ mr: 1, color: 'primary.main' }} />
        <Typography variant="h5" component="div" sx={{ fontWeight: 'bold' }}>
          ユーザーアクティビティ管理
        </Typography>
      </Box>

      {/* フィルター */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          フィルター
        </Typography>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          flexWrap="wrap"
        >
          <FormControl sx={{ minWidth: { xs: '100%', sm: 200 } }} size="small">
            <InputLabel>ユーザー</InputLabel>
            <Select
              value={selectedUserId}
              label="ユーザー"
              onChange={(e) => setSelectedUserId(e.target.value as number | '')}
            >
              <MenuItem value="">すべて</MenuItem>
              {users.map(user => (
                <MenuItem key={user.id} value={user.id}>
                  {user.name || user.username || user.email}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="周期日"
            type="date"
            value={selectedCycleDate}
            onChange={(e) => setSelectedCycleDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            size="small"
            sx={{ minWidth: { xs: '100%', sm: 200 } }}
          />
          <Button variant="outlined" onClick={handleClearFilters} sx={{ width: { xs: '100%', sm: 'auto' } }}>
            フィルター解除
          </Button>
        </Stack>
      </Paper>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
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
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body1" color="text.secondary">
                アクティビティデータがありません
              </Typography>
            </Paper>
          ) : (
            <Card sx={{ height: { xs: '600px', md: 'calc(100vh - 280px)' }, display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, pb: 2 }}>
                <Box sx={{ mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <TimelineIcon color="primary" />
                      ユーザー別アクティブ状態（5:00〜翌4:59）
                    </Typography>
                    <Chip
                      label="リアルタイム更新中"
                      color="success"
                      size="small"
                      sx={{ fontSize: '0.7rem' }}
                    />
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    各時間帯におけるユーザーのアクティブ状態を表示しています。その10分間にアクティビティが1件以上記録された時間帯のみオン（1）になります。1回のログインは最大10分として表示されます。
                  </Typography>

                  {/* ユーザー統計情報（表示中の周期日＝その日のログイン回数・アクティブ時間） */}
                  <Paper sx={{ p: 1.5, mb: 1.5 }} elevation={0}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                      {format(parseISO(effectiveCycleDate), 'M/d', { locale: ja })}（5:00〜翌4:59）のログイン回数・アクティブ時間
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                      {userStats.slice(0, 8).map(stat => {
                        const color = userColors.colorMap.get(stat.userId) || '#1976d2';
                        return (
                          <Box key={stat.userId} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box
                              sx={{
                                width: 12,
                                height: 12,
                                borderRadius: '50%',
                                bgcolor: color
                              }}
                            />
                            <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                              {stat.name}:
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {stat.sessionCount}回ログイン ({stat.activeHours}時間)
                            </Typography>
                          </Box>
                        );
                      })}
                      {userStats.length > 8 && (
                        <Typography variant="caption" color="text.secondary">
                          他 {userStats.length - 8}名
                        </Typography>
                      )}
                    </Box>
                  </Paper>
                </Box>
                <Box sx={{ flex: 1, minHeight: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={hourlyDataByUser} margin={{ top: 10, right: 20, left: 10, bottom: 80 }}>
                      <defs>
                        {userColors.userList.map(user => {
                          const color = userColors.colorMap.get(user.userId) || '#1976d2';
                          return (
                            <linearGradient key={user.userId} id={`color${user.userId}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={color} stopOpacity={0.4} />
                              <stop offset="95%" stopColor={color} stopOpacity={0.05} />
                            </linearGradient>
                          );
                        })}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                      <XAxis
                        dataKey="timeLabel"
                        angle={-45}
                        textAnchor="end"
                        height={80}
                        interval={5}
                        tick={{ fontSize: 9 }}
                        label={{ value: '時間帯（10分刻み）', position: 'insideBottom', offset: -5, style: { textAnchor: 'middle', fontSize: 12 } }}
                      />
                      <YAxis
                        label={{ value: 'アクティブ状態', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 12 } }}
                        tick={{ fontSize: 11 }}
                        domain={[0, 1]}
                        ticks={[0, 1]}
                        tickFormatter={(value) => value === 1 ? 'オン' : 'オフ'}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'rgba(255, 255, 255, 0.98)',
                          fontSize: '12px',
                          border: '1px solid #ccc',
                          borderRadius: '4px',
                          padding: '8px'
                        }}
                        formatter={(value: any, name: string) => [value === 1 ? 'アクティブ' : '非アクティブ', name]}
                        labelFormatter={(label) => `時間帯: ${label}`}
                      />
                      <Legend
                        wrapperStyle={{ paddingTop: '10px', fontSize: '11px' }}
                        iconType="circle"
                        iconSize={8}
                        verticalAlign="top"
                        height={36}
                      />
                      {/* 現在時刻を示す線（今日のデータを表示している場合のみ） */}
                      {isShowingToday && currentTimeLabel.cycleHour >= 5 && currentTimeLabel.cycleHour < 29 && (
                        <ReferenceLine
                          x={currentTimeLabel.timeLabel}
                          stroke="#ff0000"
                          strokeWidth={2.5}
                          strokeDasharray="5 5"
                          label={{
                            value: '現在',
                            position: 'top',
                            fill: '#ff0000',
                            fontSize: 11,
                            fontWeight: 'bold',
                            offset: 5
                          }}
                        />
                      )}
                      {userColors.userList.map(user => {
                        const color = userColors.colorMap.get(user.userId) || '#1976d2';
                        return (
                          <Area
                            key={user.userId}
                            type="stepAfter"
                            dataKey={user.name}
                            stroke={color}
                            fill={`url(#color${user.userId})`}
                            strokeWidth={2.5}
                            name={user.name}
                            connectNulls={false}
                            isAnimationActive={false}
                            strokeOpacity={0.8}
                            fillOpacity={0.3}
                          />
                        );
                      })}
                    </AreaChart>
                  </ResponsiveContainer>
                </Box>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </Box>
  );
};

export default UserActivityPage;
