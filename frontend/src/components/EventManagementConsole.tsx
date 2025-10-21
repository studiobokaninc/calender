import React, { useEffect, useState, useMemo } from 'react';
import { Box, Typography, List, ListItem, ListItemText, Paper, CircularProgress, Divider, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, FormControl, InputLabel, Select, MenuItem, Checkbox, ListItemIcon, OutlinedInput, Chip, FormLabel, RadioGroup, FormControlLabel, Radio, Autocomplete } from '@mui/material';
import api from '../services/api';
import { Project, BackendEvent, User, Group } from '../types';
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
  const [modalOpen, setModalOpen] = useState(false);
  const [modalProject, setModalProject] = useState<Project | null>(null);
  const [form, setForm] = useState({
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

  useEffect(() => {
    const fetchData = async () => {
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
    };
    fetchData();
  }, []);

  // プロジェクトごとのタスク以外のイベント数と種別ごとの件数を集計
  const projectEventDetails = useMemo(() => {
    const details: Record<string, {
      total: number;
      meeting: number;
      deadline: number;
      milestone: number;
      workshop: number;
    }> = {};
    projects.forEach(project => {
      const projectId = project.id;
      const filtered = events.filter(ev =>
        ev.project_id === projectId &&
        (ev.type?.toLowerCase() !== 'task')
      );
      details[projectId] = {
        total: filtered.length,
        meeting: filtered.filter(ev => ev.type?.toLowerCase() === 'meeting').length,
        deadline: filtered.filter(ev => ev.type?.toLowerCase() === 'deadline').length,
        milestone: filtered.filter(ev => ev.type?.toLowerCase() === 'milestone').length,
        workshop: filtered.filter(ev => ev.type?.toLowerCase() === 'workshop').length,
      };
    });
    return details;
  }, [projects, events]);
    
  const participantOptions: ParticipantOption[] = useMemo(() => [
    ...users.map(u => ({
      id: `user-${u.id}`,
      label: u.full_name || u.username || u.email || '',
      type: 'user' as const,
    })),
    ...groups.map(g => ({
      id: `group-${g.id}`,
      label: g.name,
      type: 'group' as const,
    })),
  ], [users, groups]);

  const handleOpenModal = (project: Project) => {
    setModalProject(project);
    setForm({
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
  const handleCloseModal = () => setModalOpen(false);

  const handleCreateRecurringMeetings = async () => {
    if (!modalProject) return;
    const { type, weekday, monthDay, startTime, endTime, title, description, location, participants } = form;
    const start = dayjs(modalProject.start_date);
    const end = dayjs(modalProject.end_date);
    let dates: dayjs.Dayjs[] = [];
    if (type === 'weekly') {
      // プロジェクト期間内の指定曜日リストを作成
      let d = start.startOf('day');
      while (d.isBefore(end) || d.isSame(end, 'day')) {
        if (d.day() === weekday) {
          dates.push(d);
        }
        d = d.add(1, 'day');
      }
    } else {
      // 月次: プロジェクト期間内の各月の指定日リスト
      let d = start.startOf('month');
      while (d.isBefore(end) || d.isSame(end, 'month')) {
        const day = d.date(monthDay);
        if (day.isBefore(start)) {
          d = d.add(1, 'month');
          continue;
        }
        if (day.isAfter(end)) break;
        dates.push(day);
        d = d.add(1, 'month');
      }
    }
    // 参加者整形
    const participantsPayload = participants.map(p => ({
      type: p.type,
      id: p.id,
    }));
    // イベント生成
    setLoading(true);
    try {
      for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        const eventTitle = `${title}（${i + 1}回目）`;
        // カレンダー追加と同じ方式でUTC（Z付き）で送信
        const startDateObj = dayjs.tz(date.format('YYYY-MM-DD') + 'T' + startTime, 'Asia/Tokyo').toDate();
        const endDateObj = dayjs.tz(date.format('YYYY-MM-DD') + 'T' + endTime, 'Asia/Tokyo').toDate();
        const startISO = startDateObj.toISOString();
        const endISO = endDateObj.toISOString();
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
      // イベント再取得
      const eventsRes = await api.get<BackendEvent[]>('/calendar/events');
      setEvents(eventsRes.data);
    } catch (e) {
      setError('イベント作成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Paper sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" gutterBottom>
          プロジェクト別イベント総計
        </Typography>
        <Divider />
      </Box>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Typography color="error">{error}</Typography>
      ) : (
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          <List sx={{ py: 0 }}>
            {projects.map((project, idx) => {
              const detail = projectEventDetails[project.id] || { total: 0, meeting: 0, deadline: 0, milestone: 0, workshop: 0 };
              return (
                <React.Fragment key={project.id}>
                  <ListItem sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', py: 2 }}>
                    <ListItemText
                      primary={project.name}
                      secondary={
                        <>
                          <span>イベント数: {detail.total}</span>
                          <Typography variant="body2" component="span" sx={{ color: '#555', marginLeft: 1, display: 'block' }}>
                            ・会議: {detail.meeting}　・締切: {detail.deadline}　・マイルストーン: {detail.milestone}　・ワークショップ: {detail.workshop}
                          </Typography>
                          <Typography variant="body2" component="span" sx={{ color: '#555', marginLeft: 1, display: 'block' }}>
                            ・優先度: {project.priority || '未設定'}
                          </Typography>
                        </>
                      }
                    />
                    <Button variant="outlined" size="small" sx={{ mt: 1 }} onClick={() => handleOpenModal(project)}>
                      定例mtg作成
                    </Button>
                  </ListItem>
                  {idx < projects.length - 1 && <Divider />}
                </React.Fragment>
              );
            })}
          </List>
        </Box>
      )}

      {/* 定例mtg作成モーダル */}
      <Dialog open={modalOpen} onClose={handleCloseModal} maxWidth="sm" fullWidth>
        <DialogTitle>定例会議作成</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <FormControl component="fieldset" sx={{ mb: 2 }}>
            <FormLabel component="legend">タイプ</FormLabel>
            <RadioGroup
              row
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
            >
              <FormControlLabel value="weekly" control={<Radio />} label="ウィークリー" />
              <FormControlLabel value="monthly" control={<Radio />} label="マンスリー" />
            </RadioGroup>
          </FormControl>
          {form.type === 'weekly' ? (
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>曜日</InputLabel>
              <Select
                value={form.weekday}
                label="曜日"
                onChange={e => setForm(f => ({ ...f, weekday: Number(e.target.value) }))}
          >
                {WEEKDAYS.map(day => (
                  <MenuItem key={day.value} value={day.value}>{day.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : (
            <TextField
              label="日付 (毎月)"
              type="number"
              fullWidth
              sx={{ mb: 2 }}
              value={form.monthDay}
              onChange={e => setForm(f => ({ ...f, monthDay: Number(e.target.value) }))}
              inputProps={{ min: 1, max: 31 }}
            />
          )}
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField
              label="開始時間"
              type="time"
              value={form.startTime}
              onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label="終了時間"
              type="time"
              value={form.endTime}
              onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
              InputLabelProps={{ shrink: true }}
        fullWidth
            />
          </Box>
          <TextField
            label="タイトル"
            fullWidth
            sx={{ mb: 2 }}
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          />
          <TextField
            label="説明"
            fullWidth
            multiline
            minRows={2}
            sx={{ mb: 2 }}
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          />
          <TextField
            label="場所"
            fullWidth
            sx={{ mb: 2 }}
            value={form.location}
            onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
          />
          <Autocomplete
            multiple
            options={participantOptions}
            getOptionLabel={option => option.label}
            value={form.participants}
            onChange={(_, value) => setForm(f => ({ ...f, participants: value as ParticipantOption[] }))}
            renderInput={params => <TextField {...params} label="参加者（ユーザー・グループ）" sx={{ mb: 2 }} />}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseModal}>キャンセル</Button>
          <Button variant="contained" onClick={handleCreateRecurringMeetings} disabled={loading}>作成</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default EventManagementConsole; 