import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Box, Typography, List, ListItem, Paper, CircularProgress, Divider, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, FormControl, InputLabel, Select,
  MenuItem, Chip, FormLabel, RadioGroup, FormControlLabel, Radio, Autocomplete, Tab, Tabs,
  IconButton, Tooltip, Card, CardContent, Stack, Snackbar, Alert
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
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
  const [tabValue, setTabValue] = useState(0);

  // 新規イベント作成モーダル（カレンダーと同じ EventAddModal）
  const [isAddEventModalOpen, setIsAddEventModalOpen] = useState(false);
  const [selectedDateForNewEvent, setSelectedDateForNewEvent] = useState<Date | null>(null);

  // 定例作成モーダル
  const [modalOpen, setModalOpen] = useState(false);
  const [modalProject, setModalProject] = useState<Project | null>(null);
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
  });

  // イベント一覧フィルタ
  const [filterProjectId, setFilterProjectId] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');

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

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectsRes, eventsRes, usersRes, groupsRes] = await Promise.all([
        api.get<Project[]>('/projects'),
        api.get<BackendEvent[]>('/calendar/events'),
        api.get<User[]>('/api/users'),
        api.get<Group[]>('/api/groups'),
      ]);
      setProjects(projectsRes.data);
      setEvents(eventsRes.data);
      setUsers(usersRes.data);
      setGroups(groupsRes.data);
    } catch (err) {
      setError('データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleOpenAddEventModal = () => {
    setSelectedDateForNewEvent(new Date());
    setIsAddEventModalOpen(true);
  };

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
      await fetchData();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const msg = Array.isArray(detail)
        ? detail.map((e: any) => (e?.loc ? `${e.loc.join('.')}: ${e.msg}` : JSON.stringify(e))).join('\n')
        : (typeof detail === 'string' ? detail : err?.message || '保存に失敗しました');
      setSnackbar({ open: true, message: `作成に失敗しました: ${msg}`, severity: 'error' });
    }
  }, [fetchData]);

  const projectMap = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects]);

  const participantOptions: ParticipantOption[] = useMemo(() => [
    ...users.map(u => ({
      id: `user-${u.id}`,
      label: u.full_name || u.username || u.email || '',
      type: 'user' as const,
    })),
    ...groups.map(g => ({
      id: `group-${g.id}`,
      label: g.name || `Group ${g.id}`,
      type: 'group' as const,
    })),
  ].filter(p => p.label).sort((a, b) => (a.label || '').localeCompare(b.label || '', 'ja')), [users, groups]);

  const filteredEvents = useMemo(() => {
    let list = [...events].filter(ev => (ev.type?.toLowerCase() || '') !== 'task');
    if (filterProjectId) {
      const pid = parseInt(filterProjectId, 10);
      if (!isNaN(pid)) list = list.filter(ev => ev.project_id === pid);
    }
    if (filterType) {
      const t = filterType.toLowerCase();
      list = list.filter(ev => (ev.type?.toLowerCase() || '') === t);
    }
    if (filterDateFrom) {
      list = list.filter(ev => {
        const start = ev.start_time ? dayjs(ev.start_time).format('YYYY-MM-DD') : '';
        return start >= filterDateFrom;
      });
    }
    if (filterDateTo) {
      list = list.filter(ev => {
        const start = ev.start_time ? dayjs(ev.start_time).format('YYYY-MM-DD') : '';
        return start <= filterDateTo;
      });
    }
    // 日付が新しいものが上にくるよう降順でソート
    return list.sort((a, b) => {
      const sa = a.start_time ? new Date(a.start_time).getTime() : 0;
      const sb = b.start_time ? new Date(b.start_time).getTime() : 0;
      return sb - sa;
    });
  }, [events, filterProjectId, filterType, filterDateFrom, filterDateTo]);

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

  const handleOpenRecurringModal = (project: Project) => {
    setModalProject(project);
    setRecurringForm({
      type: 'weekly',
      weekday: 1,
      monthDay: 1,
      startTime: '14:00',
      endTime: '16:00',
      title: `${project.name}定例`,
      description: '',
      location: '',
      participants: [],
    });
    setModalOpen(true);
  };

  const handleCreateRecurringMeetings = async () => {
    if (!modalProject) return;
    const { type, weekday, monthDay, startTime, endTime, title, description, location, participants } = recurringForm;
    const start = dayjs(modalProject.start_date);
    const end = dayjs(modalProject.end_date);
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
    const participantsPayload = participants.map(p => ({ type: p.type, id: parseInt(p.id.replace(/\D/g, ''), 10) }));
    setLoading(true);
    try {
      for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        const eventTitle = `${title}（${i + 1}回目）`;
        const dateStr = date.format('YYYY-MM-DD');
        const startISO = `${dateStr}T${startTime}:00+09:00`;
        const endISO = `${dateStr}T${endTime}:00+09:00`;
        await api.post('/calendar/events', {
          project_id: modalProject.id,
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
      await fetchData();
    } catch (e) {
      setSnackbar({ open: true, message: 'イベント作成に失敗しました', severity: 'error' });
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
      const startISO = `${startDate}T${editForm.startTime}:00+09:00`;
      const endISO = `${startDate}T${editForm.endTime}:00+09:00`;
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
      await fetchData();
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
      await fetchData();
    } catch (e) {
      setSnackbar({ open: true, message: '削除に失敗しました', severity: 'error' });
    }
  };

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
    <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)} sx={{ minHeight: 40 }}>
          <Tab label="イベント一覧" />
          <Tab label="定例作成" />
        </Tabs>
        <Tooltip title="再読み込み">
          <IconButton onClick={fetchData} size="small" disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {tabValue === 0 && (
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }} flexWrap="wrap" alignItems="center">
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>プロジェクト</InputLabel>
              <Select
                value={filterProjectId}
                label="プロジェクト"
                onChange={e => setFilterProjectId(e.target.value)}
              >
                <MenuItem value="">すべて</MenuItem>
                {projects.map(p => (
                  <MenuItem key={p.id} value={String(p.id)}>{p.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>種別</InputLabel>
              <Select value={filterType} label="種別" onChange={e => setFilterType(e.target.value)}>
                <MenuItem value="">すべて</MenuItem>
                <MenuItem value="meeting">会議</MenuItem>
                <MenuItem value="deadline">締切</MenuItem>
                <MenuItem value="milestone">マイルストーン</MenuItem>
                <MenuItem value="workshop">ワークショップ</MenuItem>
                <MenuItem value="generic">イベント</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="開始日"
              type="date"
              value={filterDateFrom}
              onChange={e => setFilterDateFrom(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ width: 160 }}
            />
            <TextField
              size="small"
              label="終了日"
              type="date"
              value={filterDateTo}
              onChange={e => setFilterDateTo(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ width: 160 }}
            />
            <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenAddEventModal} sx={{ ml: { sm: 'auto' } }}>
              新規イベント作成
            </Button>
          </Stack>
          {filteredEvents.length === 0 ? (
            <Card variant="outlined" sx={{ py: 4 }}>
              <CardContent>
                <Typography color="text.secondary" align="center">
                  {events.filter(e => (e.type?.toLowerCase() || '') !== 'task').length === 0
                    ? 'イベントがまだありません。'
                    : '条件に一致するイベントはありません。'}
                </Typography>
              </CardContent>
            </Card>
          ) : (
            <List disablePadding>
              {filteredEvents.map(ev => (
                <ListItem
                  key={ev.id}
                  disablePadding
                  sx={{ mb: 1 }}
                >
                  <Card variant="outlined" sx={{ width: '100%', borderRadius: 1 }}>
                    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="subtitle1" fontWeight={600}>{ev.title}</Typography>
                          <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 0.5 }}>
                            <Chip size="small" label={getTypeLabel(ev.type)} color={getTypeColor(ev.type)} />
                            {ev.project_id != null && (
                              <Chip size="small" variant="outlined" label={projectMap.get(ev.project_id) || ev.project_id} />
                            )}
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
              ))}
            </List>
          )}
        </Box>
      )}

      {tabValue === 1 && (
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          <List sx={{ py: 0 }}>
            {projects.map((project, idx) => {
              const detail = projectEventDetails[project.id] || { total: 0, meeting: 0, deadline: 0, milestone: 0, workshop: 0 };
              return (
                <React.Fragment key={project.id}>
                  <ListItem sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', py: 2, px: 0 }}>
                    <Card variant="outlined" sx={{ borderRadius: 1 }}>
                      <CardContent>
                        <Typography variant="subtitle1" fontWeight={600}>{project.name}</Typography>
                        <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap">
                          <Chip size="small" label={`合計 ${detail.total}`} />
                          <Chip size="small" variant="outlined" label={`会議 ${detail.meeting}`} />
                          <Chip size="small" variant="outlined" label={`締切 ${detail.deadline}`} />
                          <Chip size="small" variant="outlined" label={`マイルストーン ${detail.milestone}`} />
                          <Chip size="small" variant="outlined" label={`ワークショップ ${detail.workshop}`} />
                        </Stack>
                        {project.priority && (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>優先度: {project.priority}</Typography>
                        )}
                        <Button variant="outlined" size="small" startIcon={<MeetingRoomIcon />} sx={{ mt: 2 }} onClick={() => handleOpenRecurringModal(project)}>
                          定例mtg作成
                        </Button>
                      </CardContent>
                    </Card>
                  </ListItem>
                  {idx < projects.length - 1 && <Divider sx={{ my: 0 }} />}
                </React.Fragment>
              );
            })}
          </List>
        </Box>
      )}

      {/* 定例作成モーダル */}
      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>定例会議作成</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <FormControl component="fieldset" sx={{ mb: 2 }}>
            <FormLabel>タイプ</FormLabel>
            <RadioGroup row value={recurringForm.type} onChange={e => setRecurringForm(f => ({ ...f, type: e.target.value }))}>
              <FormControlLabel value="weekly" control={<Radio />} label="ウィークリー" />
              <FormControlLabel value="monthly" control={<Radio />} label="マンスリー" />
            </RadioGroup>
          </FormControl>
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
            <TextField fullWidth sx={{ mb: 2 }} label="日付 (毎月)" type="number" value={recurringForm.monthDay} onChange={e => setRecurringForm(f => ({ ...f, monthDay: Number(e.target.value) }))} inputProps={{ min: 1, max: 31 }} />
          )}
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField label="開始" type="time" value={recurringForm.startTime} onChange={e => setRecurringForm(f => ({ ...f, startTime: e.target.value }))} InputLabelProps={{ shrink: true }} fullWidth />
            <TextField label="終了" type="time" value={recurringForm.endTime} onChange={e => setRecurringForm(f => ({ ...f, endTime: e.target.value }))} InputLabelProps={{ shrink: true }} fullWidth />
          </Stack>
          <TextField fullWidth label="タイトル" value={recurringForm.title} onChange={e => setRecurringForm(f => ({ ...f, title: e.target.value }))} sx={{ mb: 2 }} />
          <TextField fullWidth label="説明" multiline minRows={2} value={recurringForm.description} onChange={e => setRecurringForm(f => ({ ...f, description: e.target.value }))} sx={{ mb: 2 }} />
          <TextField fullWidth label="場所" value={recurringForm.location} onChange={e => setRecurringForm(f => ({ ...f, location: e.target.value }))} sx={{ mb: 2 }} />
          <Autocomplete multiple options={participantOptions} getOptionLabel={o => o.label} value={recurringForm.participants} onChange={(_, v) => setRecurringForm(f => ({ ...f, participants: v as ParticipantOption[] }))} renderInput={params => <TextField {...params} label="参加者" />} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)}>キャンセル</Button>
          <Button variant="contained" onClick={handleCreateRecurringMeetings} disabled={loading}>作成</Button>
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
          <Autocomplete multiple options={participantOptions} getOptionLabel={o => o.label} value={editForm.participants} onChange={(_, v) => setEditForm(f => ({ ...f, participants: v as ParticipantOption[] }))} renderInput={params => <TextField {...params} label="参加者" />} />
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
