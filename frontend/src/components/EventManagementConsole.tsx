import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Box, Typography, List, ListItem, Paper, CircularProgress, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, FormControl, InputLabel, Select,
  MenuItem, Chip, FormLabel, RadioGroup, FormControlLabel, Radio, Checkbox, OutlinedInput,
  IconButton, Tooltip, Card, CardContent, Stack, Snackbar, Alert, Accordion, AccordionSummary, AccordionDetails, useMediaQuery, useTheme
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RefreshIcon from '@mui/icons-material/Refresh';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import api from '../services/api';
import { Project, BackendEvent, User, Group } from '../types';
import EventAddModal from './EventAddModal';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(utc);
dayjs.extend(timezone);

const WEEKDAYS = [
  { label: '日曜日', value: 0 },
  { label: '月曜日', value: 1 },
  { label: '火曜日', value: 2 },
  { label: '水曜日', value: 3 },
  { label: '木曜日', value: 4 },
  { label: '金曜日', value: 5 },
  { label: '土曜日', value: 6 },
];

const EVENT_TYPE_LABELS: Record<string, string> = {
  meeting: '会議',
  MEETING: '会議',
  deadline: '締切',
  DEADLINE: '締切',
  milestone: 'マイルストーン',
  MILESTONE: 'マイルストーン',
  workshop: 'ワークショップ',
  WORKSHOP: 'ワークショップ',
  task: 'タスク',
  TASK: 'タスク',
  generic: 'イベント',
  Generic: 'イベント',
};

type ParticipantOption = {
  id: string;
  label: string;
  type: 'user' | 'group';
};

const EventManagementConsole: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [events, setEvents] = useState<BackendEvent[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(new Set());

  // 新規イベント作成モーダル（カレンダーと同じ EventAddModal）
  const [isAddEventModalOpen, setIsAddEventModalOpen] = useState(false);
  const [selectedDateForNewEvent, setSelectedDateForNewEvent] = useState<Date | null>(null);

  // 定例作成モーダル
  const [modalOpen, setModalOpen] = useState(false);
  const [recurringForm, setRecurringForm] = useState({
    type: 'weekly',
    weekday: 1,
    monthDay: 1,
    startTime: '14:00',
    endTime: '16:00',
    title: '',
    description: '',
    location: '',
    participants: [] as ParticipantOption[],
    projectId: '' as string | number | '',
    startDate: dayjs().format('YYYY-MM-DD'),
    endDate: dayjs().add(3, 'month').format('YYYY-MM-DD'),
  });

  // プロジェクトの折りたたみ状態を管理
  const handleAccordionChange = (projectId: number) => (_event: React.SyntheticEvent, isExpanded: boolean) => {
    setExpandedProjects(prev => {
      const newSet = new Set(prev);
      if (isExpanded) {
        newSet.add(projectId);
      } else {
        newSet.delete(projectId);
      }
      return newSet;
    });
  };

  // イベント編集モーダル
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<BackendEvent | null>(null);
  const [editForm, setEditForm] = useState({
    title: '',
    type: '',
    description: '',
    location: '',
    startTime: '',
    endTime: '',
    participants: [] as ParticipantOption[],
  });
  const [editSaving, setEditSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({ open: false, message: '', severity: 'info' });

  const fetchMetadata = useCallback(async () => {
    try {
      const [projectsRes, usersRes, groupsRes] = await Promise.all([
        api.get<Project[]>('/projects'),
        api.get<User[]>('/api/users'),
        api.get<Group[]>('/api/groups'),
      ]);
      setProjects(projectsRes.data);
      setUsers(usersRes.data);
      setGroups(groupsRes.data);
    } catch (err) {
      setError('データの取得に失敗しました');
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const eventsRes = await api.get<BackendEvent[]>('/calendar/events');
      setEvents(eventsRes.data);
    } catch (err) {
      setError('イベントの取得に失敗しました');
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchMetadata(), fetchEvents()]);
    } finally {
      setLoading(false);
    }
  }, [fetchMetadata, fetchEvents]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCloseAddEventModal = () => {
    setIsAddEventModalOpen(false);
    setSelectedDateForNewEvent(null);
  };

  const handleSaveNewEvent = useCallback(async (modalData: any) => {
    const apiData = {
      title: modalData.title,
      description: modalData.description,
      type: modalData.type || 'Generic',
      location: modalData.location,
      allDay: modalData.allDay,
      start_time: modalData.start_time,
      end_time: modalData.end_time,
      status: modalData.status,
      project_id: modalData.project_id ? parseInt(String(modalData.project_id), 10) : undefined,
      participants: modalData.participants,
    };
    try {
      await api.post('/calendar/events', apiData);
      setSnackbar({ open: true, message: 'イベントを作成しました', severity: 'success' });
      handleCloseAddEventModal();
      await fetchEvents();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const msg = Array.isArray(detail)
        ? detail.map((e: any) => (e?.loc ? `${e.loc.join('.')}: ${e.msg}` : JSON.stringify(e))).join('\n')
        : (typeof detail === 'string' ? detail : err?.message || '保存に失敗しました');
      setSnackbar({ open: true, message: `作成に失敗しました: ${msg}`, severity: 'error' });
    }
  }, [fetchData]);

  const participantOptions: ParticipantOption[] = useMemo(() => [
    ...users.map(u => ({
      id: `user-${u.id}`,
      label: u.username || u.full_name || u.name || u.email || '',
      type: 'user' as const,
    })),
    ...groups.map(g => ({
      id: `group-${g.id}`,
      label: g.name || `Group ${g.id}`,
      type: 'group' as const,
    })),
  ].filter(p => p.label).sort((a, b) => (a.label || '').localeCompare(b.label || '', 'ja')), [users, groups]);

  // プロジェクトごとのイベントを取得
  const getProjectEvents = useCallback((projectId: number) => {
    return events
      .filter(ev => ev.project_id === projectId && (ev.type?.toLowerCase() || '') !== 'task')
      .sort((a, b) => {
        const sa = a.start_time ? new Date(a.start_time).getTime() : 0;
        const sb = b.start_time ? new Date(b.start_time).getTime() : 0;
        return sb - sa;
      });
  }, [events]);

  // プロジェクトに属さないイベントを取得
  const getNoProjectEvents = useCallback(() => {
    return events
      .filter(ev => ev.project_id == null && (ev.type?.toLowerCase() || '') !== 'task')
      .sort((a, b) => {
        const sa = a.start_time ? new Date(a.start_time).getTime() : 0;
        const sb = b.start_time ? new Date(b.start_time).getTime() : 0;
        return sb - sa;
      });
  }, [events]);

  const projectEventDetails = useMemo(() => {
    const details: Record<number, { total: number; meeting: number; deadline: number; milestone: number; workshop: number }> = {};
    projects.forEach(project => {
      const filtered = events.filter(ev =>
        ev.project_id === project.id && (ev.type?.toLowerCase() !== 'task')
      );
      details[project.id] = {
        total: filtered.length,
        meeting: filtered.filter(ev => (ev.type?.toLowerCase() || '') === 'meeting').length,
        deadline: filtered.filter(ev => (ev.type?.toLowerCase() || '') === 'deadline').length,
        milestone: filtered.filter(ev => (ev.type?.toLowerCase() || '') === 'milestone').length,
        workshop: filtered.filter(ev => (ev.type?.toLowerCase() || '') === 'workshop').length,
      };
    });
    return details;
  }, [projects, events]);

  const getTypeLabel = (type: string | null | undefined) =>
    EVENT_TYPE_LABELS[type || ''] || type || '—';

  const getTypeColor = (type: string | null | undefined): 'primary' | 'secondary' | 'success' | 'warning' | 'default' => {
    const t = (type || '').toLowerCase();
    if (t === 'meeting' || t === 'workshop') return 'primary';
    if (t === 'deadline') return 'warning';
    if (t === 'milestone') return 'success';
    return 'default';
  };

  /** イベントが終了しているか（終了日時が現在より前か） */
  const isEventEnded = (ev: BackendEvent): boolean => {
    const endOrStart = ev.end_time || ev.start_time;
    if (!endOrStart) return false;
    return dayjs(endOrStart).isBefore(dayjs(), 'minute');
  };

  const handleOpenRecurringModal = (project?: Project) => {
    const defaultTitle = project ? `${project.name}定例` : '定例会議';
    const defaultStartDate = project ? dayjs(project.start_date).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD');
    const defaultEndDate = project ? dayjs(project.end_date).format('YYYY-MM-DD') : dayjs().add(3, 'month').format('YYYY-MM-DD');
    setRecurringForm({
      type: 'weekly',
      weekday: 1,
      monthDay: 1,
      startTime: '14:00',
      endTime: '16:00',
      title: defaultTitle,
      description: '',
      location: '',
      participants: [],
      projectId: project ? project.id : '',
      startDate: defaultStartDate,
      endDate: defaultEndDate,
    });
    setModalOpen(true);
  };

  const handleCreateRecurringMeetings = async () => {
    const { type, weekday, monthDay, startTime, endTime, title, description, location, participants, projectId, startDate, endDate } = recurringForm;

    // 日付範囲の検証
    if (!startDate || !endDate) {
      setSnackbar({ open: true, message: '開始日と終了日を入力してください', severity: 'error' });
      return;
    }

    const start = dayjs(startDate);
    const end = dayjs(endDate);

    if (start.isAfter(end)) {
      setSnackbar({ open: true, message: '開始日は終了日より前である必要があります', severity: 'error' });
      return;
    }

    let dates: dayjs.Dayjs[] = [];
    if (type === 'weekly') {
      let d = start.startOf('day');
      while (d.isBefore(end) || d.isSame(end, 'day')) {
        if (d.day() === weekday) dates.push(d);
        d = d.add(1, 'day');
      }
    } else {
      let d = start.startOf('month');
      while (d.isBefore(end) || d.isSame(end, 'month')) {
        const day = d.date(Math.min(monthDay, d.daysInMonth()));
        if (day.isBefore(start)) { d = d.add(1, 'month'); continue; }
        if (day.isAfter(end)) break;
        dates.push(day);
        d = d.add(1, 'month');
      }
    }

    if (dates.length === 0) {
      setSnackbar({ open: true, message: '指定された期間内に該当する日付がありません', severity: 'error' });
      return;
    }

    const participantsPayload = participants.map(p => ({ type: p.type, id: parseInt(p.id.replace(/\D/g, ''), 10) }));
    const projectIdNum = projectId ? parseInt(String(projectId), 10) : undefined;

    setLoading(true);
    try {
      for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        const eventTitle = dates.length > 1 ? `${title}（${i + 1}回目）` : title;
        const dateStr = date.format('YYYY-MM-DD');
        const startISO = `${dateStr}T${startTime}:00+09:00`;
        const endISO = `${dateStr}T${endTime}:00+09:00`;
        await api.post('/calendar/events', {
          project_id: projectIdNum,
          type: 'MEETING',
          title: eventTitle,
          description,
          location,
          start_time: startISO,
          end_time: endISO,
          participants: participantsPayload,
        });
      }
      setModalOpen(false);
      setSnackbar({ open: true, message: `${dates.length}件の定例イベントを作成しました`, severity: 'success' });
      await fetchEvents();
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const msg = Array.isArray(detail)
        ? detail.map((err: any) => (err?.loc ? `${err.loc.join('.')}: ${err.msg}` : JSON.stringify(err))).join('\n')
        : (typeof detail === 'string' ? detail : e?.message || 'イベント作成に失敗しました');
      setSnackbar({ open: true, message: `作成に失敗しました: ${msg}`, severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const openEditModal = (ev: BackendEvent) => {
    setEditingEvent(ev);
    const start = ev.start_time ? dayjs(ev.start_time) : null;
    const end = ev.end_time ? dayjs(ev.end_time) : null;
    const participants: ParticipantOption[] = (ev.participants || []).map((p: { id: number; type: string }) => {
      const idStr = p.type === 'user' ? `user-${p.id}` : `group-${p.id}`;
      const opt = participantOptions.find(o => o.id === idStr);
      return opt || { id: idStr, label: String(p.id), type: (p.type as 'user' | 'group') };
    });
    setEditForm({
      title: ev.title || '',
      type: ev.type || 'MEETING',
      description: ev.description || '',
      location: ev.location || '',
      startTime: start ? start.format('HH:mm') : '09:00',
      endTime: end ? end.format('HH:mm') : '10:00',
      participants,
    });
    setEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingEvent) return;
    setEditSaving(true);
    try {
      const startDate = editingEvent.start_time ? dayjs(editingEvent.start_time).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD');
      const endDate = editingEvent.end_time ? dayjs(editingEvent.end_time).format('YYYY-MM-DD') : startDate;
      const startISO = `${startDate}T${editForm.startTime}:00+09:00`;
      const endISO = `${endDate}T${editForm.endTime}:00+09:00`;
      const participantsPayload = editForm.participants.map(p => ({
        type: p.type,
        id: parseInt(p.id.replace(/\D/g, ''), 10),
      }));
      await api.put(`/calendar/events/${editingEvent.id}`, {
        title: editForm.title,
        type: editForm.type,
        description: editForm.description || null,
        location: editForm.location || null,
        start_time: startISO,
        end_time: endISO,
        participants: participantsPayload,
      });
      setSnackbar({ open: true, message: 'イベントを更新しました', severity: 'success' });
      setEditModalOpen(false);
      setEditingEvent(null);
      await fetchEvents();
    } catch (e) {
      setSnackbar({ open: true, message: '更新に失敗しました', severity: 'error' });
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteEvent = async (ev: BackendEvent) => {
    if (!window.confirm(`「${ev.title}」を削除してもよろしいですか？`)) return;
    try {
      await api.delete(`/calendar/events/${ev.id}`);
      setSnackbar({ open: true, message: 'イベントを削除しました', severity: 'success' });
      await fetchEvents();
    } catch (e) {
      setSnackbar({ open: true, message: '削除に失敗しました', severity: 'error' });
    }
  };

  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  if (loading && events.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 320 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography color="error">{error}</Typography>
        <Button startIcon={<RefreshIcon />} onClick={fetchData} sx={{ mt: 2 }}>再読み込み</Button>
      </Paper>
    );
  }

  return (
    <Paper sx={{
      p: isMobile ? 1.5 : 2,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      borderRadius: isMobile ? 0 : 2,
      border: isMobile ? 'none' : undefined,
      pb: isMobile ? 10 : 2
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h6" fontWeight={600}>
          定例会議管理
        </Typography>
        <Tooltip title="再読み込み">
          <IconButton onClick={fetchData} size="small" disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {/* プロジェクトに属さない定例会議作成セクション */}
        <Card variant="outlined" sx={{ mb: 2, bgcolor: isDark ? 'rgba(25, 118, 210, 0.15)' : 'rgba(25, 118, 210, 0.04)', borderColor: 'primary.main', borderWidth: 2, borderRadius: 3 }}>
          <CardContent sx={{ p: isMobile ? 2 : 3 }}>
            <Box sx={{
              display: 'flex',
              alignItems: isMobile ? 'stretch' : 'center',
              justifyContent: 'space-between',
              flexDirection: isMobile ? 'column' : 'row',
              gap: 2
            }}>
              <Box>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
                  プロジェクトに属さない定例会議
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  プロジェクトに関連付けずに定例会議を作成できます
                </Typography>
              </Box>
              <Button
                variant="contained"
                size="medium"
                startIcon={<MeetingRoomIcon />}
                onClick={() => handleOpenRecurringModal()}
                fullWidth={isMobile}
                sx={{ minWidth: isMobile ? 'none' : 180, borderRadius: 2 }}
              >
                定例会議を作成
              </Button>
            </Box>
          </CardContent>
        </Card>

        {/* プロジェクトに属さないイベント一覧（折りたたみ可能） */}
        {(() => {
          const noProjectEvents = getNoProjectEvents();
          if (noProjectEvents.length > 0) {
            return (
              <Accordion
                expanded={expandedProjects.has(-1)}
                onChange={handleAccordionChange(-1)}
                sx={{ mb: 2 }}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', pr: 2 }}>
                    <Typography variant="subtitle1" fontWeight={600}>
                      プロジェクト未設定のイベント ({noProjectEvents.length}件)
                    </Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <List disablePadding>
                    {noProjectEvents.map(ev => {
                      const ended = isEventEnded(ev);
                      return (
                        <ListItem key={ev.id} disablePadding sx={{ mb: 1 }}>
                          <Card
                            variant="outlined"
                            sx={{
                              width: '100%',
                              borderRadius: 1,
                              ...(ended && {
                                opacity: 0.65,
                                bgcolor: 'action.hover',
                                '& .MuiTypography-root': { color: 'text.secondary' },
                                '& .MuiChip-root': { opacity: 0.9 },
                              }),
                            }}
                          >
                            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="subtitle1" fontWeight={600}>{ev.title}</Typography>
                                  <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 0.5 }}>
                                    <Chip size="small" label={getTypeLabel(ev.type)} color={getTypeColor(ev.type)} />
                                    {ev.start_time && (
                                      <Typography variant="caption" color="text.secondary">
                                        {dayjs(ev.start_time).format('YYYY/MM/DD HH:mm')}
                                        {ev.end_time && ` ～ ${dayjs(ev.end_time).format('HH:mm')}`}
                                      </Typography>
                                    )}
                                  </Stack>
                                  {(ev.description || ev.location) && (
                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                      {ev.description}
                                      {ev.location && ` · ${ev.location}`}
                                    </Typography>
                                  )}
                                </Box>
                                <Stack direction="row" spacing={0.5}>
                                  <Tooltip title="編集">
                                    <IconButton size="small" onClick={() => openEditModal(ev)}>
                                      <EditIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                  <Tooltip title="削除">
                                    <IconButton size="small" color="error" onClick={() => handleDeleteEvent(ev)}>
                                      <DeleteIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                </Stack>
                              </Box>
                            </CardContent>
                          </Card>
                        </ListItem>
                      );
                    })}
                  </List>
                </AccordionDetails>
              </Accordion>
            );
          }
          return null;
        })()}

        {/* プロジェクト別の定例会議作成セクション */}
        <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
          プロジェクト別の定例会議作成
        </Typography>
        {projects.length === 0 ? (
          <Card variant="outlined" sx={{ py: 4 }}>
            <CardContent>
              <Typography color="text.secondary" align="center">
                プロジェクトがまだありません
              </Typography>
            </CardContent>
          </Card>
        ) : (
          <Box>
            {projects.map((project, idx) => {
              const detail = projectEventDetails[project.id] || { total: 0, meeting: 0, deadline: 0, milestone: 0, workshop: 0 };
              const projectEvents = getProjectEvents(project.id);
              const isExpanded = expandedProjects.has(project.id);

              return (
                <Accordion
                  key={project.id}
                  expanded={isExpanded}
                  onChange={handleAccordionChange(project.id)}
                  sx={{ mb: idx < projects.length - 1 ? 1 : 0 }}
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box sx={{ display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'space-between', width: '100%', pr: 2, flexDirection: isMobile ? 'column' : 'row' }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="subtitle1" fontWeight={600}>{project.name}</Typography>
                        <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} flexWrap="wrap">
                          <Chip size="small" label={`合計 ${detail.total}`} />
                          <Chip size="small" variant="outlined" label={`会議 ${detail.meeting}`} />
                          <Chip size="small" variant="outlined" label={`締切 ${detail.deadline}`} />
                          <Chip size="small" variant="outlined" label={`マイルストーン ${detail.milestone}`} />
                          <Chip size="small" variant="outlined" label={`ワークショップ ${detail.workshop}`} />
                        </Stack>
                        {project.priority && (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>優先度: {project.priority}</Typography>
                        )}
                      </Box>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<MeetingRoomIcon />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenRecurringModal(project);
                        }}
                        sx={{ flexShrink: 0, ml: isMobile ? 0 : 2, mt: isMobile ? 1 : 0, borderRadius: 2 }}
                        fullWidth={isMobile}
                      >
                        定例mtg作成
                      </Button>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    {projectEvents.length === 0 ? (
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                        このプロジェクトにはイベントがありません
                      </Typography>
                    ) : (
                      <List disablePadding>
                        {projectEvents.map(ev => {
                          const ended = isEventEnded(ev);
                          return (
                            <ListItem key={ev.id} disablePadding sx={{ mb: 1 }}>
                              <Card
                                variant="outlined"
                                sx={{
                                  width: '100%',
                                  borderRadius: 1,
                                  ...(ended && {
                                    opacity: 0.65,
                                    bgcolor: 'action.hover',
                                    '& .MuiTypography-root': { color: 'text.secondary' },
                                    '& .MuiChip-root': { opacity: 0.9 },
                                  }),
                                }}
                              >
                                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                      <Typography variant="subtitle1" fontWeight={600}>{ev.title}</Typography>
                                      <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 0.5 }}>
                                        <Chip size="small" label={getTypeLabel(ev.type)} color={getTypeColor(ev.type)} />
                                        {ev.start_time && (
                                          <Typography variant="caption" color="text.secondary">
                                            {dayjs(ev.start_time).format('YYYY/MM/DD HH:mm')}
                                            {ev.end_time && ` ～ ${dayjs(ev.end_time).format('HH:mm')}`}
                                          </Typography>
                                        )}
                                      </Stack>
                                      {(ev.description || ev.location) && (
                                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                          {ev.description}
                                          {ev.location && ` · ${ev.location}`}
                                        </Typography>
                                      )}
                                    </Box>
                                    <Stack direction="row" spacing={0.5}>
                                      <Tooltip title="編集">
                                        <IconButton size="small" onClick={() => openEditModal(ev)}>
                                          <EditIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                      <Tooltip title="削除">
                                        <IconButton size="small" color="error" onClick={() => handleDeleteEvent(ev)}>
                                          <DeleteIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                    </Stack>
                                  </Box>
                                </CardContent>
                              </Card>
                            </ListItem>
                          );
                        })}
                      </List>
                    )}
                  </AccordionDetails>
                </Accordion>
              );
            })}
          </Box>
        )}
      </Box>

      {/* 定例作成モーダル */}
      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>定例会議作成</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {/* プロジェクト選択（任意） */}
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>プロジェクト（任意）</InputLabel>
            <Select
              value={recurringForm.projectId}
              label="プロジェクト（任意）"
              onChange={e => setRecurringForm(f => ({ ...f, projectId: e.target.value }))}
            >
              <MenuItem value="">プロジェクトに属さない</MenuItem>
              {projects.map(p => (
                <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* 日付範囲 */}
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField
              fullWidth
              label="開始日"
              type="date"
              value={recurringForm.startDate}
              onChange={e => setRecurringForm(f => ({ ...f, startDate: e.target.value }))}
              InputLabelProps={{ shrink: true }}
              required
            />
            <TextField
              fullWidth
              label="終了日"
              type="date"
              value={recurringForm.endDate}
              onChange={e => setRecurringForm(f => ({ ...f, endDate: e.target.value }))}
              InputLabelProps={{ shrink: true }}
              required
            />
          </Stack>

          {/* 繰り返しタイプ */}
          <FormControl component="fieldset" sx={{ mb: 2 }}>
            <FormLabel>繰り返しタイプ</FormLabel>
            <RadioGroup row value={recurringForm.type} onChange={e => setRecurringForm(f => ({ ...f, type: e.target.value }))}>
              <FormControlLabel value="weekly" control={<Radio />} label="ウィークリー" />
              <FormControlLabel value="monthly" control={<Radio />} label="マンスリー" />
            </RadioGroup>
          </FormControl>

          {/* 曜日または日付 */}
          {recurringForm.type === 'weekly' ? (
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>曜日</InputLabel>
              <Select value={recurringForm.weekday} label="曜日" onChange={e => setRecurringForm(f => ({ ...f, weekday: Number(e.target.value) }))}>
                {WEEKDAYS.map(d => (
                  <MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : (
            <TextField
              fullWidth
              sx={{ mb: 2 }}
              label="日付 (毎月)"
              type="number"
              value={recurringForm.monthDay}
              onChange={e => setRecurringForm(f => ({ ...f, monthDay: Number(e.target.value) }))}
              inputProps={{ min: 1, max: 31 }}
              helperText="毎月の日付を指定（1-31）"
            />
          )}

          {/* 時間 */}
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField
              label="開始時刻"
              type="time"
              value={recurringForm.startTime}
              onChange={e => setRecurringForm(f => ({ ...f, startTime: e.target.value }))}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label="終了時刻"
              type="time"
              value={recurringForm.endTime}
              onChange={e => setRecurringForm(f => ({ ...f, endTime: e.target.value }))}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Stack>

          {/* タイトル */}
          <TextField
            fullWidth
            label="タイトル"
            value={recurringForm.title}
            onChange={e => setRecurringForm(f => ({ ...f, title: e.target.value }))}
            sx={{ mb: 2 }}
            required
          />

          {/* 説明 */}
          <TextField
            fullWidth
            label="説明"
            multiline
            minRows={2}
            value={recurringForm.description}
            onChange={e => setRecurringForm(f => ({ ...f, description: e.target.value }))}
            sx={{ mb: 2 }}
          />

          {/* 場所 */}
          <TextField
            fullWidth
            label="場所"
            value={recurringForm.location}
            onChange={e => setRecurringForm(f => ({ ...f, location: e.target.value }))}
            sx={{ mb: 2 }}
          />

          {/* 参加者 */}
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>参加者</InputLabel>
            <Select
              multiple
              value={recurringForm.participants.map(p => p.id)}
              onChange={(e) => {
                const selectedIds = typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value;
                const selectedParticipants = participantOptions.filter(opt => selectedIds.includes(opt.id));
                setRecurringForm(f => ({ ...f, participants: selectedParticipants }));
              }}
              input={<OutlinedInput label="参加者" />}
              renderValue={(selected) => {
                if (selected.length === 0) return '';
                const selectedLabels = participantOptions
                  .filter(opt => selected.includes(opt.id))
                  .map(opt => opt.label);
                return selectedLabels.join(', ');
              }}
              MenuProps={{
                PaperProps: {
                  style: {
                    maxHeight: 224,
                  },
                },
              }}
            >
              {participantOptions.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  <Checkbox checked={recurringForm.participants.some(p => p.id === option.id)} />
                  <Typography variant="body2">{option.label}</Typography>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)}>キャンセル</Button>
          <Button variant="contained" onClick={handleCreateRecurringMeetings} disabled={loading}>
            {loading ? '作成中...' : '作成'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* イベント編集モーダル */}
      <Dialog open={editModalOpen} onClose={() => { setEditModalOpen(false); setEditingEvent(null); }} maxWidth="sm" fullWidth>
        <DialogTitle>イベントを編集</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField fullWidth label="タイトル" value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} sx={{ mb: 2 }} />
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>種別</InputLabel>
            <Select value={editForm.type} label="種別" onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))}>
              <MenuItem value="MEETING">会議</MenuItem>
              <MenuItem value="DEADLINE">締切</MenuItem>
              <MenuItem value="MILESTONE">マイルストーン</MenuItem>
              <MenuItem value="WORKSHOP">ワークショップ</MenuItem>
              <MenuItem value="Generic">イベント</MenuItem>
            </Select>
          </FormControl>
          <TextField fullWidth label="説明" multiline minRows={2} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} sx={{ mb: 2 }} />
          <TextField fullWidth label="場所" value={editForm.location} onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))} sx={{ mb: 2 }} />
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField fullWidth label="開始時刻" type="time" value={editForm.startTime} onChange={e => setEditForm(f => ({ ...f, startTime: e.target.value }))} InputLabelProps={{ shrink: true }} />
            <TextField fullWidth label="終了時刻" type="time" value={editForm.endTime} onChange={e => setEditForm(f => ({ ...f, endTime: e.target.value }))} InputLabelProps={{ shrink: true }} />
          </Stack>
          {/* 参加者 */}
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>参加者</InputLabel>
            <Select
              multiple
              value={editForm.participants.map(p => p.id)}
              onChange={(e) => {
                const selectedIds = typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value;
                const selectedParticipants = participantOptions.filter(opt => selectedIds.includes(opt.id));
                setEditForm(f => ({ ...f, participants: selectedParticipants }));
              }}
              input={<OutlinedInput label="参加者" />}
              renderValue={(selected) => {
                if (selected.length === 0) return '';
                const selectedLabels = participantOptions
                  .filter(opt => selected.includes(opt.id))
                  .map(opt => opt.label);
                return selectedLabels.join(', ');
              }}
              MenuProps={{
                PaperProps: {
                  style: {
                    maxHeight: 224,
                  },
                },
              }}
            >
              {participantOptions.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  <Checkbox checked={editForm.participants.some(p => p.id === option.id)} />
                  <Typography variant="body2">{option.label}</Typography>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setEditModalOpen(false); setEditingEvent(null); }}>キャンセル</Button>
          <Button variant="contained" onClick={handleSaveEdit} disabled={editSaving}>{editSaving ? '保存中...' : '保存'}</Button>
        </DialogActions>
      </Dialog>

      <EventAddModal
        open={isAddEventModalOpen}
        onClose={handleCloseAddEventModal}
        onSave={handleSaveNewEvent}
        initialDate={selectedDateForNewEvent || new Date()}
        eventToEdit={null}
        dateClickArg={null}
        projects={projects}
        users={users}
        tasks={[]}
        groups={groups}
        eventTypesOnly
      />

      <Snackbar open={snackbar.open} autoHideDuration={5000} onClose={() => setSnackbar(s => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={() => setSnackbar(s => ({ ...s, open: false }))} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default EventManagementConsole;
