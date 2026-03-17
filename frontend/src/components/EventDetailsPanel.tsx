// src/components/EventDetailsPanel.tsx
import React, { useMemo } from 'react';
import { Box, Typography, Divider, Paper, Chip, IconButton, Button, Tooltip, FormControl, Select, MenuItem, FormGroup, FormControlLabel, Checkbox, useTheme, useMediaQuery } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { CalendarEvent, Project, User, Group, Participant, Task } from '../types';
import { TaskQuickDetail } from './TaskQuickDetail';
import { format, isSameDay, parseISO, isValid, startOfDay, endOfDay } from 'date-fns';
import { ja } from 'date-fns/locale';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import EventIcon from '@mui/icons-material/Event';
import FolderIcon from '@mui/icons-material/Folder';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

const formatDate = (dateInput: string | Date | null | undefined): string => {
  if (!dateInput) return '';
  try {
    const dateObj = typeof dateInput === 'string' ? parseISO(dateInput) : dateInput;
    if (isValid(dateObj)) return format(dateObj, 'yyyy年M月d日', { locale: ja });
    return '無効な日付';
  } catch { return '日付エラー'; }
};
const formatTime = (dateInput: string | Date | null | undefined): string => {
  if (!dateInput) return '';
  try {
    const dateObj = typeof dateInput === 'string' ? parseISO(dateInput) : dateInput;
    if (isValid(dateObj)) return format(dateObj, 'HH:mm', { locale: ja });
    return '';
  } catch { return ''; }
};
const isDatePast = (dateStr: string | Date | null | undefined): boolean => {
  if (!dateStr) return false;
  try {
    const date = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
    if (!isValid(date)) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eventDate = new Date(date);
    eventDate.setHours(0, 0, 0, 0);
    return eventDate < today;
  } catch { return false; }
};
const getEventColor = (type?: string, projectStatus?: string, eventDate?: string | Date | null): string => {
  const projectStatusStr = projectStatus ? String(projectStatus).toLowerCase() : undefined;
  if (projectStatusStr === 'completed' || projectStatusStr === 'cancelled') return '#9E9E9E';
  if (eventDate && isDatePast(eventDate)) return '#9E9E9E';
  const t = type?.toLowerCase();
  switch (t) {
    case 'meeting': return '#1976d2';
    case 'review': case 'workshop': return '#00897b';
    case 'deadline': return '#d32f2f';
    case 'milestone': return '#d32f2f';
    default: return '#2196f3';
  }
};

interface EventDetailsPanelProps {
  selectedDate: Date | null;
  selectedEvent: CalendarEvent | null;
  events: CalendarEvent[];
  onEventSelect: (event: CalendarEvent) => void;
  isMinimized: boolean;
  onToggleMinimize: () => void;
  onOpenAddModal: () => void;
  users: User[];
  groups: Group[];
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
  eventStatusFilter: string;
  onEventStatusFilterChange: (event: any) => void;
  eventTypeFilter: Record<string, boolean>;
  onEventTypeFilterChange: (typeKey: string, checked: boolean) => void;
  projects: Project[];
  googleStatus?: { configured: boolean; connected: boolean; synced_task_ids: number[]; synced_event_ids: number[] };
  onGoogleSyncToggle?: (eventId: number, currentSynced: boolean) => void;
  onUpdateTask?: (taskId: number, updates: any) => Promise<void>;
  totalCost?: number;
}

const EventDetailsPanel: React.FC<EventDetailsPanelProps> = ({
  selectedDate,
  selectedEvent,
  events,
  onEventSelect,
  isMinimized,
  onToggleMinimize,
  onOpenAddModal: _onOpenAddModal,
  users,
  groups,
  onEdit,
  onDelete,
  eventStatusFilter,
  onEventStatusFilterChange,
  eventTypeFilter,
  onEventTypeFilterChange,
  projects,
  googleStatus,
  onGoogleSyncToggle,
  onUpdateTask,
}) => {
  const { user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const dailyEvents = useMemo(() => {
    if (!selectedDate || !isValid(selectedDate)) return [];
    return events.filter((event) => {
      if (!event || !event.start) return false;
      const eventStartObj = typeof event.start === 'string' ? parseISO(event.start) : event.start;
      if (!isValid(eventStartObj)) return false;

      const selectedDayStart = startOfDay(selectedDate);
      const selectedDayEnd = endOfDay(selectedDate);

      let eventEndObj = event.end ? (typeof event.end === 'string' ? parseISO(event.end) : event.end) : null;

      if (event.allDay) {
        const currentEventDayStart = startOfDay(eventStartObj);
        if (eventEndObj) {
          const currentEventDayEnd = startOfDay(eventEndObj);
          const daysDiff = Math.floor((currentEventDayEnd.getTime() - currentEventDayStart.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff <= 1) return isSameDay(currentEventDayStart, selectedDate);
          return currentEventDayStart <= selectedDayEnd && currentEventDayEnd > selectedDayStart;
        }
        return isSameDay(currentEventDayStart, selectedDate);
      } else {
        const currentEventActualEnd = eventEndObj || eventStartObj;
        return eventStartObj <= selectedDayEnd && currentEventActualEnd >= selectedDayStart;
      }
    });
  }, [events, selectedDate]);

  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach(u => m.set(String(u.id), u.name || u.username || u.email || ''));
    return m;
  }, [users]);

  const projectMap = useMemo(() => new Map((projects ?? []).map(p => [String(p.id), p])), [projects]);

  const getParticipantDisplayName = (p: Participant): string => {
    const idStr = String(p.id ?? '');
    if (p.type === 'user') return userMap.get(idStr) || idStr;
    return (groups.find(g => String(g.id) === idStr)?.name) || idStr;
  };

  const getCardColor = (ev: CalendarEvent) => {
    if (ev.backgroundColor) return ev.backgroundColor;
    const type = ev.extendedProps?.type;
    const projectStatus = ev.extendedProps?.projectId ? projectMap.get(String(ev.extendedProps.projectId))?.status || undefined : undefined;
    return getEventColor(type, projectStatus, ev.start);
  };

  const getTypeIcon = (type?: string) => {
    const t = type?.toLowerCase();
    switch (t) {
      case 'project': return <FolderIcon sx={{ mr: 1 }} fontSize="small" />;
      case 'task': return <TaskAltIcon sx={{ mr: 1 }} fontSize="small" />;
      default: return <EventIcon sx={{ mr: 1 }} fontSize="small" />;
    }
  };

  const getTitleBorderColor = (event: CalendarEvent | null): string => {
    if (!event) return 'transparent';
    return getCardColor(event);
  };

  const handleDelete = () => {
    if (selectedEvent && window.confirm('削除してもよろしいですか？')) onDelete(selectedEvent);
  };

  const handleEdit = () => {
    if (selectedEvent) onEdit(selectedEvent);
  };

  return (
    <Box sx={{ p: isMobile ? 0 : 1, pt: isMobile ? 0 : 4, overflowY: 'auto', flexGrow: 1, position: 'relative', height: '100%' }}>
      {!isMobile && (
        <Tooltip title={isMinimized ? "詳細を開く" : "詳細を閉じる"}>
          <IconButton onClick={onToggleMinimize} size="small" sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
            {isMinimized ? <ChevronLeftIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      )}

      {!isMinimized && !isMobile && (
        <Box sx={{ mb: 1 }}>
          {selectedDate && (
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'primary.main', mb: 1 }}>
              {formatDate(selectedDate)}
            </Typography>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>表示イベント</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" variant="text" onClick={() => Object.keys(eventTypeFilter).forEach(k => onEventTypeFilterChange(k, true))}>全オン</Button>
              <Button size="small" variant="text" onClick={() => Object.keys(eventTypeFilter).forEach(k => onEventTypeFilterChange(k, false))}>全オフ</Button>
            </Box>
          </Box>
          <FormControl size="small" sx={{ minWidth: 140, mb: 1 }}>
            <Select value={eventStatusFilter} onChange={onEventStatusFilterChange} displayEmpty>
              <MenuItem value="all">すべてのプロジェクト</MenuItem>
              {projects.filter(p => p.display_status !== 'offline').map(p => (
                <MenuItem key={p.id} value={String(p.id)}>{p.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormGroup row>
            {Object.keys(eventTypeFilter).map(k => (
              <FormControlLabel
                key={k}
                control={<Checkbox size="small" checked={eventTypeFilter[k] !== false} onChange={(_, c) => onEventTypeFilterChange(k, c)} />}
                label={
                  <Typography variant="body2">
                    {k === 'task' ? 'タスク' :
                      k === 'meeting' ? '会議' :
                        k === 'deadline' ? '締切' :
                          k === 'milestone' ? 'マイルストーン' :
                            k === 'workshop' ? 'ワークショップ' :
                              k === 'generic' || k === 'event' ? '通常' :
                                k === 'project' ? 'プロジェクト' :
                                  k === 'group' ? 'グループ' :
                                    k}
                  </Typography>
                }
              />
            ))}
          </FormGroup>
        </Box>
      )}

      {!isMinimized && (
        <>
          {selectedEvent ? (
            <Paper elevation={2} sx={{ p: isMobile ? 1.5 : 2, borderLeft: 5, borderColor: getTitleBorderColor(selectedEvent) }}>
              <Box sx={{ mb: 1.5 }}>
                <Chip
                  label={selectedEvent.extendedProps?.type || '通常'}
                  size="small"
                  sx={{ mb: 1, fontWeight: 600, backgroundColor: getCardColor(selectedEvent), color: '#fff' }}
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {getTypeIcon(selectedEvent.extendedProps?.type)}
                  {selectedEvent.extendedProps?.type?.toLowerCase() !== 'task' ? (
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>{selectedEvent.title}</Typography>
                  ) : (
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.secondary' }}>タスク詳細</Typography>
                  )}
                </Box>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {selectedEvent.allDay ? `${formatDate(selectedEvent.start)} (終日)` : `${formatDate(selectedEvent.start)} ${formatTime(selectedEvent.start)} 〜 ${formatTime(selectedEvent.end)}`}
                </Typography>
              </Box>

              <Divider sx={{ my: 1.5 }} />

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {selectedEvent.extendedProps?.description && selectedEvent.extendedProps?.type?.toLowerCase() !== 'task' && (
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>{selectedEvent.extendedProps.description}</Typography>
                )}
                {selectedEvent.extendedProps?.location && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LocationOnIcon fontSize="small" color="action" />
                    <Typography variant="body2">{selectedEvent.extendedProps.location}</Typography>
                  </Box>
                )}

                {/* タスク固有の情報表示（最新のクイックコンポーネントを使用） */}
                {selectedEvent.extendedProps?.type?.toLowerCase() === 'task' && (
                  <TaskQuickDetail
                    task={{
                      id: Number(selectedEvent.extendedProps.taskId),
                      name: selectedEvent.title,
                      project_id: selectedEvent.extendedProps.projectId ? Number(selectedEvent.extendedProps.projectId) : undefined,
                      assigned_to: selectedEvent.extendedProps.taskAssigneeId ? Number(selectedEvent.extendedProps.taskAssigneeId) : undefined,
                      status: selectedEvent.extendedProps.taskStatus,
                      progress: selectedEvent.extendedProps.taskProgress,
                      check_items: selectedEvent.extendedProps.check_items,
                      deliverables: selectedEvent.extendedProps.deliverables,
                      start_date: selectedEvent.extendedProps.taskStartDate,
                      due_date: selectedEvent.extendedProps.taskDueDate,
                      description: selectedEvent.extendedProps.description,
                    } as Task}
                    projects={projects}
                    users={users}
                    onUpdate={async (id, updates) => {
                      if (onUpdateTask) await onUpdateTask(id, updates);
                    }}
                  />
                )}
                {selectedEvent.extendedProps?.participants && (selectedEvent.extendedProps.participants as Participant[]).length > 0 && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>参加者:</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                      {(selectedEvent.extendedProps.participants as Participant[]).map((p, i) => (
                        <Chip key={i} label={getParticipantDisplayName(p)} size="small" />
                      ))}
                    </Box>
                  </Box>
                )}
              </Box>

              {googleStatus?.connected && !['task', 'project'].includes(selectedEvent.extendedProps?.type?.toLowerCase() || '') && (
                <Box sx={{ mt: 2, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <Typography variant="caption" sx={{ display: 'block', mb: 0.5, fontWeight: 'bold' }}>Google連携</Typography>
                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={googleStatus.synced_event_ids.some(id => String(id) === String(selectedEvent.id.replace('event-', '')))}
                        onChange={() => {
                          const eventIdStr = selectedEvent.id.replace('event-', '');
                          const synced = googleStatus.synced_event_ids.some(id => String(id) === String(eventIdStr));
                          onGoogleSyncToggle?.(Number(eventIdStr), synced);
                        }}
                      />
                    }
                    label={<Typography variant="body2">自分のカレンダーに表示</Typography>}
                  />
                </Box>
              )}

              {user?.role === 'admin' && (
                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                  <IconButton size="small" onClick={handleEdit}><EditIcon fontSize="small" /></IconButton>
                  <IconButton size="small" onClick={handleDelete} color="error"><DeleteIcon fontSize="small" /></IconButton>
                </Box>
              )}
            </Paper>
          ) : selectedDate && dailyEvents.length > 0 ? (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>この日の予定 ({dailyEvents.length} 件)</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {dailyEvents.map(ev => (
                  <Paper
                    key={ev.id}
                    elevation={1}
                    sx={{ p: 1.25, cursor: 'pointer', borderLeft: 4, borderColor: getCardColor(ev), '&:hover': { bgcolor: 'action.hover' } }}
                    onClick={() => onEventSelect(ev)}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {getTypeIcon(ev.extendedProps?.type)}
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{ev.title}</Typography>
                    </Box>
                  </Paper>
                ))}
              </Box>
            </Box>
          ) : selectedDate ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2, p: 1.5 }}>予定はありません</Typography>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2, p: 1.5 }}>日付を選択してください</Typography>
          )}
        </>
      )}
    </Box>
  );
};

export default EventDetailsPanel;