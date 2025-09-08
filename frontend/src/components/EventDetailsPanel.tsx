// src/components/EventDetailsPanel.tsx
import React, { useMemo } from 'react';
import { Box, Typography, List, ListItem, ListItemButton, ListItemText, Divider, Paper, Chip, IconButton, Button, Tooltip, FormControl, Select, MenuItem } from '@mui/material';
import { CalendarEvent, Project, Task, User, Group, Participant } from '../types';
import { format, isSameDay, parseISO, isValid, startOfDay, endOfDay, addDays } from 'date-fns';
import { ja } from 'date-fns/locale';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import GroupIcon from '@mui/icons-material/Group';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import FolderIcon from '@mui/icons-material/Folder';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import EventIcon from '@mui/icons-material/Event';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import { EventApi } from '@fullcalendar/core';

// ★★★ Define color functions here (copy from Calendar.tsx or implement) ★★★
const getProjectColor = (project: Project | { status?: string, color?: string } | undefined): string => {
  if (!project) return '#757575'; // Default grey if no project data
  if ('color' in project && project.color) return project.color;
  switch (project.status) {
    case 'planning': return '#FF9800';
    case 'in-progress': return '#4CAF50';
    case 'completed': return '#9E9E9E';
    default: return '#757575';
  }
}
const getTaskColor = (status?: string): string => {
  switch (status) {
    case 'todo': return '#2196F3';
    case 'in-progress': return '#FF9800';
    case 'review': return '#9C27B0';
    case 'delayed': return '#F44336';
    case 'completed': return '#4CAF50';
    default: return '#BDBDBD';
  }
}

// ★★★ Updated formatDate helper function ★★★
const formatDate = (dateInput: string | Date | null | undefined): string => {
  if (!dateInput) return '';
  try {
    const dateObj = typeof dateInput === 'string' ? parseISO(dateInput) : dateInput;
    if (isValid(dateObj)) { // Check if the parsed date is valid
      return format(dateObj, 'yyyy年M月d日', { locale: ja });
    } else {
      console.warn("Invalid date value received in formatDate:", dateInput);
      return '無効な日付'; // Or return empty string
    }
  } catch (error) {
      console.error("Error formatting date:", dateInput, error);
      return '日付エラー'; // Or return empty string
  }
};

// ★★★ Updated formatTime helper function ★★★
const formatTime = (dateInput: string | Date | null | undefined): string => {
  if (!dateInput) return '';
   try {
      const dateObj = typeof dateInput === 'string' ? parseISO(dateInput) : dateInput;
      if (isValid(dateObj)) { // Check if the parsed date is valid
         return format(dateObj, 'HH:mm', { locale: ja });
      } else {
         console.warn("Invalid date value received in formatTime:", dateInput);
         return ''; // Return empty for invalid time
      }
   } catch (error) {
      console.error("Error formatting time:", dateInput, error);
      return ''; // Return empty on error
   }
};

// ★★★ Add getStatusColor helper function (similar to Calendar.tsx) ★★★
const getStatusColor = (status?: string): string => {
  switch (status) {
    case '未着手':
      return '#f44336'; // Red
    case '進行中':
      return '#2196f3'; // Blue
    case '完了':
      return '#4caf50'; // Green
    case '保留':
      return '#ff9800'; // Orange
    default:
      return '#9e9e9e'; // Grey for default/unknown
  }
};

// Updated getEventColor (copy or import from Calendar.tsx if needed)
const getEventColor = (type?: string): string => {
  switch (type?.toLowerCase()) {
    case 'meeting': return '#1976d2';
    case 'review': return '#9c27b0';
    case 'deadline': return '#d32f2f';
    default: return '#2196f3'; // Default blue for generic events
  }
};

// ★★★ Add totalCost prop back ★★★
interface EventDetailsPanelProps {
  selectedDate: Date | null;
  selectedEvent: CalendarEvent | null;
  events: CalendarEvent[];
  onEventSelect: (event: CalendarEvent) => void;
  isMinimized: boolean;
  onToggleMinimize: () => void;
  onOpenAddModal: () => void;
  totalCost?: number;
  users: User[];
  groups: Group[];
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
  eventStatusFilter: string;
  onEventStatusFilterChange: (event: any) => void;
  projects: Project[];
}

const EventDetailsPanel: React.FC<EventDetailsPanelProps> = ({
  selectedDate,
  selectedEvent,
  events,
  onEventSelect,
  isMinimized,
  onToggleMinimize,
  onOpenAddModal,
  totalCost,
  users,
  groups,
  onEdit,
  onDelete,
  eventStatusFilter,
  onEventStatusFilterChange,
  projects,
}) => {
  console.log('EventDetailsPanel projects:', projects);

  console.log("Selected Event in Panel:", selectedEvent);

  // ★★★ Debugging: Log selectedEvent when it changes ★★★
  React.useEffect(() => {
      console.log("Selected Event in Panel:", selectedEvent);
  }, [selectedEvent]);

  // ★★★ Calculate dailyEvents only when needed using useMemo ★★★
  const dailyEvents = useMemo(() => {
    if (!selectedDate || !isValid(selectedDate)) {
      console.warn("[EventDetailsPanel] dailyEvents: selectedDate is null or invalid. Returning [].");
      return [];
    }
    const filtered = events.filter((event) => {
      if (!event || !event.start) {
        return false;
      }
      let eventStartObj: Date | null = null;
      if (event.start instanceof Date) {
        if (isValid(event.start)) {
          eventStartObj = event.start;
        } else {
          console.warn(`[EventDetailsPanel] Event ID: ${event?.id} start is invalid Date.`);
          return false;
        }
      } else if (typeof event.start === 'string') {
        const parsed = parseISO(event.start);
        if (isValid(parsed)) {
          eventStartObj = parsed;
        } else {
          console.warn(`[EventDetailsPanel] Event ID: ${event?.id} start is invalid string: ${event.start}`);
          return false;
        }
      } else {
        return false;
      }
      const selectedDayStart = startOfDay(selectedDate!); 
      const selectedDayEnd = endOfDay(selectedDate!);     
      let eventEndObj: Date | null = null;
      if (event.end) {
        if (event.end instanceof Date) {
          if (isValid(event.end)) {
            eventEndObj = event.end;
          }
        } else if (typeof event.end === 'string') {
          const parsedEnd = parseISO(event.end);
          if (isValid(parsedEnd)) {
            eventEndObj = parsedEnd;
          }
        }
      }
      if (event.allDay) {
        const currentEventDayStart = startOfDay(eventStartObj);
        const currentEventDayEnd = eventEndObj ? endOfDay(eventEndObj) : endOfDay(eventStartObj);
        return currentEventDayStart <= selectedDayEnd && currentEventDayEnd >= selectedDayStart;
      } else {
        const currentEventActualEnd = eventEndObj || eventStartObj;
        return eventStartObj <= selectedDayEnd && currentEventActualEnd >= selectedDayStart;
      }
    });
    console.log(`[EventDetailsPanel] dailyEvents: selectedDate=${selectedDate?.toISOString?.()} 件数=${filtered.length}`);
    return filtered;
  }, [events, selectedDate]);

  // ★★★ Split dailyEvents by type for separate rendering ★★★
  const projectBarEventsForDate = useMemo(() => dailyEvents.filter(e => e.extendedProps?.type === 'project'), [dailyEvents]);
  const tasksForDate = useMemo(() => dailyEvents.filter(e => e.extendedProps?.type === 'Task'), [dailyEvents]);
  
  const timedEventsForDate = useMemo(() => {
    const filtered = dailyEvents.filter(e => !['project', 'task'].includes(e.extendedProps?.type || ''));
    // ★★★ デバッグログ追加 ★★★
    console.log("[EventDetailsPanel] timedEventsForDate calculation, input dailyEvents:", JSON.parse(JSON.stringify(dailyEvents)));
    console.log("[EventDetailsPanel] timedEventsForDate calculation, output filtered (these should NOT be project/task):", JSON.parse(JSON.stringify(filtered)));
    return filtered;
  }, [dailyEvents]);

  // ★★★ timedEventsForDate を allDay とそれ以外に分割 ★★★
  const allDayTimedEvents = useMemo(() => {
    const filtered = timedEventsForDate.filter(e => e.allDay);
    // ★★★ デバッグログ追加 ★★★
    console.log("[EventDetailsPanel] allDayTimedEvents calculation, input timedEventsForDate:", JSON.parse(JSON.stringify(timedEventsForDate)));
    console.log("[EventDetailsPanel] allDayTimedEvents calculation, output filtered (these should be allDay):", JSON.parse(JSON.stringify(filtered)));
    return filtered;
  }, [timedEventsForDate]);

  const nonAllDayTimedEvents = useMemo(() => {
    const filtered = timedEventsForDate.filter(e => !e.allDay);
    // ★★★ デバッグログ追加 ★★★
    console.log("[EventDetailsPanel] nonAllDayTimedEvents calculation, input timedEventsForDate:", JSON.parse(JSON.stringify(timedEventsForDate)));
    console.log("[EventDetailsPanel] nonAllDayTimedEvents calculation, output filtered (these should NOT be allDay):", JSON.parse(JSON.stringify(filtered)));
    return filtered;
  }, [timedEventsForDate]);

  // ★★★ Create maps for user and group lookup ★★★
  const userMap = useMemo(() => new Map(users.map(u => [String(u.id), u.username || u.name || u.email || u.id])), [users]);
  const groupMap: Map<string, string> = useMemo(() => new Map(groups.map(g => [String(g.id), g.name])), [groups]);
  // ★★★ Add projectMap for lookup (Project型) ★★★
  const projectMap = useMemo(() => new Map((projects ?? []).map(p => {
    let key = String(p.id);
    if (key.startsWith('proj-')) key = key.replace('proj-', '');
    return [key, p];
  })), [projects]);

  const handleDelete = () => {
      if (selectedEvent && window.confirm('このイベントを削除してもよろしいですか？')) {
          onDelete(selectedEvent);
      }
  };

  const handleEdit = () => {
      if (selectedEvent) {
          onEdit(selectedEvent);
      }
  };

  // Helper function to get icon based on type
  const getTypeIcon = (type?: string) => {
    const t = type?.toLowerCase();
    switch (t) {
      case 'project': return <FolderIcon sx={{ mr: 1, color: 'inherit' }} fontSize="small" />;
      case 'task': return <TaskAltIcon sx={{ mr: 1, color: 'inherit' }} fontSize="small" />;
      case 'milestone': return <EventIcon sx={{ mr: 1, color: 'inherit' }} fontSize="small" />;
      case 'deadline': return <EventIcon sx={{ mr: 1, color: 'inherit' }} fontSize="small" />;
      case 'meeting': return <EventIcon sx={{ mr: 1, color: 'inherit' }} fontSize="small" />;
      case 'review': return <EventIcon sx={{ mr: 1, color: 'inherit' }} fontSize="small" />;
      default: return <EventIcon sx={{ mr: 1, color: 'inherit' }} fontSize="small" />;
    }
  };

  // Helper function to get the border color for the title box
  const getTitleBorderColor = (event: CalendarEvent | null): string => {
    // ★★★ ログ追加 ★★★
    console.log("[EventDetailsPanel] getTitleBorderColor called with event:", event ? { type: event.extendedProps?.type, status: event.extendedProps?.taskStatus, projectStatus: event.extendedProps?.projectStatus } : null);
    if (!event) return 'transparent';
    const type = event.extendedProps?.type;
    if (type === 'project') return getProjectColor(projectMap.get(String(event.extendedProps?.projectId)));
    if (type === 'Task') return getTaskColor(event.extendedProps?.taskStatus ?? undefined);
    return getEventColor(type);
  };

  // カード色分け用関数
  const getCardColor = (ev: CalendarEvent) => {
    const type = ev.extendedProps?.type?.toLowerCase?.();
    let projectId = ev.extendedProps?.projectId;
    if (!projectId && type === 'project') {
      let key = String(ev.id);
      if (key.startsWith('proj-')) key = key.replace('proj-', '');
      projectId = key;
    } else if (typeof projectId === 'string' && projectId.startsWith('proj-')) {
      projectId = projectId.replace('proj-', '');
    }
    if (type === 'milestone') return '#d32f2f'; // マイルストーンは常に赤
    if (type === 'project') return getProjectColor(projectMap.get(String(projectId)));
    if (type === 'task') return getTaskColor(typeof ev.extendedProps?.taskStatus === 'string' ? ev.extendedProps?.taskStatus : undefined);
    if (type === 'milestone' || type === 'deadline') return getEventColor(type);
    return getEventColor(type);
  };

  // カード色デバッグ: dailyEventsが変化したときに出力
  React.useEffect(() => {
    dailyEvents.forEach(ev => {
      console.log('カード色デバッグ:', {
        id: ev.id,
        title: ev.title,
        type: ev.extendedProps?.type,
        color: getCardColor(ev),
        project: projectMap.get(String(ev.extendedProps?.projectId))
      });
    });
  }, [dailyEvents, projectMap]);

  return (
    <Box sx={{ p: 1, pt: 4, overflowY: 'auto', flexGrow: 1, position: 'relative', height: '100%' }}>
      <Tooltip title={isMinimized ? "詳細を開く" : "詳細を閉じる"}>
        <IconButton
          onClick={onToggleMinimize}
          size="small"
          sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
        >
          {isMinimized ? <ChevronLeftIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
        </IconButton>
      </Tooltip>

      {/* プルダウンを詳細欄の上部に表示（ミニマイズ時は非表示） */}
      {!isMinimized && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>表示イベント</Typography>
          <FormControl size="small" sx={{ minWidth: 110, height: 32, '& .MuiInputBase-root': { height: 32 }, '& .MuiSelect-select': { py: 0.5, fontSize: '0.92rem' } }}>
            <Select
              labelId="event-status-filter-label"
              value={eventStatusFilter}
              onChange={onEventStatusFilterChange}
              displayEmpty
              inputProps={{ 'aria-label': '表示イベント' }}
              sx={{ fontSize: '0.92rem', height: 32, minHeight: 32 }}
            >
              <MenuItem value="all">すべて</MenuItem>
              <MenuItem value="online">オンライン</MenuItem>
              <MenuItem value="offline">オフライン</MenuItem>
              <MenuItem value="archived">アーカイブ済み</MenuItem>
            </Select>
          </FormControl>
        </Box>
      )}

      {!isMinimized && (
        <>
          {selectedEvent && (
            <Paper elevation={0} sx={{ p: 1.5, borderLeft: 5, borderColor: getTitleBorderColor(selectedEvent) }}>
              {/* 1. タイトル（アイコン付き・青・ボールド・左詰め） */}
              <Typography
                variant="subtitle1"
                sx={{
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  color: getEventColor(selectedEvent.extendedProps?.type ?? undefined) || getTaskColor(selectedEvent.extendedProps?.taskStatus ?? undefined),
                  fontSize: '1.1rem',
                  mb: 0.5,
                  pl: 0,
                }}
              >
                {getTypeIcon(selectedEvent.extendedProps?.type)} {selectedEvent.extendedProps?.type === 'Task' ? `タスク: ${selectedEvent.title}` : selectedEvent.title}
              </Typography>

              {/* 2. 時間 or 期日（アイコン付き） */}
              <Typography
                color="text.secondary"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '0.95rem',
                  mb: 0.5,
                  pl: 0,
                }}
              >
                <AccessTimeIcon fontSize="inherit" sx={{ mr: 0.5 }} />
                {selectedEvent.extendedProps?.taskDueDate != null
                  ? `${formatDate(selectedEvent.extendedProps.taskDueDate)} (終日)`
                  : (selectedEvent.start != null
                      ? (() => {
                          if (selectedEvent.allDay) {
                            const endForDisplay = selectedEvent.end
                              ? addDays((typeof selectedEvent.end === 'string' ? parseISO(selectedEvent.end) : selectedEvent.end), -1)
                              : (typeof selectedEvent.start === 'string' ? parseISO(selectedEvent.start) : selectedEvent.start);
                            return `${formatDate(endForDisplay)} (終日)`;
                          }
                          return `${formatDate(selectedEvent.start)} ${formatTime(selectedEvent.start)} - ${formatTime(selectedEvent.end != null ? selectedEvent.end : '')}`;
                        })()
                      : '')}
              </Typography>

              {/* 3. その他の詳細（Chipや担当者など） */}
              {selectedEvent.extendedProps?.type === 'Task' && (
                <>
                  {/* ステータスChip */}
                  {selectedEvent.extendedProps?.taskStatus && (
                    <Chip
                      label={selectedEvent.extendedProps.taskStatus}
                      size="small"
                      sx={{ mt: 0, backgroundColor: getTaskColor(selectedEvent.extendedProps.taskStatus), color: '#fff' }}
                    />
                  )}
                  {/* 担当者（ユーザーIDで表示） */}
                  {selectedEvent.extendedProps?.taskAssigneeId != null && (() => {
                    const assigneeIdStr = String(selectedEvent.extendedProps.taskAssigneeId);
                    const assigneeIdNum = parseInt(assigneeIdStr, 10);
                    const user = users.find(u => u.id === assigneeIdNum);
                    if (user) {
                      return (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                          担当者: {user.username || user.id}
                  </Typography>
                      );
                    }
                    return null;
                  })()}
                  {/* コスト */}
                  {selectedEvent.extendedProps?.taskCost !== undefined && (
                    <Typography variant="body2" color="text.secondary">
                      コスト: {selectedEvent.extendedProps.taskCost ?? '未設定'}
                    </Typography>
                  )}
                  {/* from/to 依存関係 */}
                  {(() => {
                    const dependsOn = selectedEvent.extendedProps?.dependsOn || [];
                    // ★★★ デバッグログ追加 ★★★
                    console.log("[EventDetailsPanel] Current Task ID:", selectedEvent.extendedProps?.taskId);
                    console.log("[EventDetailsPanel] DependsOn IDs for current task:", JSON.stringify(dependsOn));
                    console.log("[EventDetailsPanel] All task events available for lookup (showing relevant props):", JSON.stringify(
                      events
                        .filter(e => e.extendedProps?.type === 'Task')
                        .map(e => ({ 
                          id: e.id, // FullCalendar event ID, e.g., task-10
                          taskId: e.extendedProps?.taskId, // Actual task ID from DB, e.g., 10
                          title: e.title,
                          dependsOn: e.extendedProps?.dependsOn
                        })),
                      null, 2
                    ));
                    // ★★★ デバッグログ追加ここまで ★★★
                    const thisTaskId = selectedEvent.extendedProps?.taskId;
                    const toTasks = events.filter(e =>
                      e.extendedProps?.type === 'Task' &&
                      Array.isArray(e.extendedProps?.dependsOn) &&
                      e.extendedProps.dependsOn.includes(String(thisTaskId))
                    );
                    return (
                      <>
                        <Typography variant="body2" color="text.secondary">
                          from: {dependsOn.length > 0 ? dependsOn.map(id => {
                            const t = events.find(e => e.extendedProps?.type === 'Task' && String(e.extendedProps?.taskId) === String(id));
                            return t ? t.title : id;
                          }).join(', ') : 'なし'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          to: {toTasks.length > 0 ? toTasks.map(t => t.title).join(', ') : 'なし'}
                        </Typography>
                      </>
                    );
                  })()}
                  {/* 関連プロジェクト */}
                   {selectedEvent.extendedProps?.projectId && projectMap.has(String(selectedEvent.extendedProps.projectId)) && (
                      <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
                        関連プロジェクト: {(() => {
                          const project = projectMap.get(String(selectedEvent.extendedProps.projectId));
                          return project && 'name' in project ? project.name : '';
                        })()}
                      </Typography>
                   )}
                </>
              )}
              {selectedEvent.extendedProps?.type === 'project' && (
                <>
                  {selectedEvent.extendedProps?.projectDescription && (
                    <Typography variant="body2" sx={{ mt: 1, mb: 1, whiteSpace: 'pre-wrap' }}>
                      {selectedEvent.extendedProps.projectDescription}
                    </Typography>
                  )}
                  {/* トータルコスト・タスク数・関係ユーザー */}
                  {(() => {
                    const projectId = selectedEvent.extendedProps?.projectId;
                    const projectTasks = events.filter(e => e.extendedProps?.type === 'Task' && String(e.extendedProps?.projectId) === String(projectId));
                    const totalCost = projectTasks.reduce((sum, t) => sum + (t.extendedProps?.taskCost || 0), 0);
                    const taskCount = projectTasks.length;
                    const assigneeIds = Array.from(new Set(projectTasks.map(t => t.extendedProps?.taskAssigneeId).filter(Boolean)));
                    const assigneeNames = assigneeIds
                      .map(id => userMap.get(String(id ?? '')) ?? '')
                      .filter((name): name is string => !!name);
                    return (
                      <Box sx={{ mt: 1, mb: 1 }}>
                        <Typography variant="body2" color="text.secondary">トータルコスト: {totalCost.toLocaleString()}（{taskCount}タスク）</Typography>
                        {assigneeNames.length > 0 && (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            関係ユーザー: {assigneeNames.join(', ')}
                    </Typography>
                  )}
                      </Box>
                    );
                  })()}
                  {selectedEvent.extendedProps?.projectStatus && (
                     <Chip
                       label={selectedEvent.extendedProps.projectStatus}
                       size="small"
                       sx={{ mt: 1, backgroundColor: getProjectColor(selectedEvent.extendedProps as any), color: '#fff' }}
                     />
                  )}
                </>
              )}
              {!['task', 'project'].includes(selectedEvent.extendedProps?.type || '') && (
                 <>
                   {selectedEvent.extendedProps?.location && (
                     <Typography variant="body2" color="text.secondary" sx={{ mb: 1, display: 'flex', alignItems: 'center' }}>
                      <LocationOnIcon fontSize="inherit" sx={{ mr: 0.5 }}/>{selectedEvent.extendedProps.location}
                     </Typography>
                   )}
                   {selectedEvent.extendedProps?.description && (
                     <Typography variant="body2" sx={{ mt: 1, mb: 1, whiteSpace: 'pre-wrap' }}>
                       {selectedEvent.extendedProps.description}
                     </Typography>
                   )}
                   {selectedEvent.extendedProps?.participants && selectedEvent.extendedProps.participants.length > 0 && (
                     <Box sx={{ mt: 1 }}>
                       <Typography variant="caption" display="flex" alignItems="center" color="text.secondary">
                         <GroupIcon fontSize="inherit" sx={{ mr: 0.5 }} /> 参加者:
                       </Typography>
                       <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                        {(selectedEvent.extendedProps.participants as Participant[]).map((p, index) => {
                          let groupId = String(p.id);
                          if (
                            p.type === 'group' &&
                            typeof p.id === 'string' &&
                            (p.id as string).startsWith('group-')
                          ) {
                            groupId = (p.id as string).replace('group-', '');
                          }
                          let groupName: string | undefined;
                          groupName = groupMap.get(groupId);
                          const name = p.type === 'user'
                            ? (userMap.get(String(p.id ?? '')) ?? String(p.id ?? ''))
                            : (groupName ?? String(p.id ?? ''));
                          const key = `${p.type}-${String(p.id)}-${index}`;
                          return (
                            <Chip key={key} label={name} size="small" />
                          );
                        })}
                       </Box>
                     </Box>
                   )}
                 </>
              )}
              {/* 4. 編集・削除ボタン（右端） */}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                <Tooltip title="編集">
                  <IconButton size="small" onClick={handleEdit} sx={{ mr: 0.5 }}>
                    <EditIcon fontSize="inherit" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="削除">
                  <IconButton size="small" onClick={handleDelete}>
                    <DeleteIcon fontSize="inherit" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Paper>
          )}
          {/* イベントリスト表示: selectedEventがnullかつdailyEventsがある場合（カード式表示） */}
          {selectedEvent === null && dailyEvents.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1 }}>
              {dailyEvents.map(ev => (
                <Paper
                  key={ev.id}
                  elevation={2}
                               sx={{
                    minWidth: 180,
                    maxWidth: 260,
                    flex: '1 1 180px',
                    p: 1,
                    cursor: 'pointer',
                    borderLeft: 4,
                    borderColor: getCardColor(ev),
                    transition: 'box-shadow 0.2s',
                    '&:hover': { boxShadow: 6, background: '#f5faff' },
                  }}
                  onClick={() => onEventSelect(ev)}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.3 }}>
                    <span style={{ color: getCardColor(ev), display: 'flex', alignItems: 'center' }}>
                      {getTypeIcon(ev.extendedProps?.type)}
                    </span>
                    <Typography variant="body2" sx={{ ml: 0.5, flex: 1, fontSize: '0.98rem', color: getCardColor(ev), fontWeight: 400 }} noWrap>
                      {ev.title}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ mb: 0.2, fontSize: '0.85rem' }}>
                    {ev.allDay
                      ? (() => {
                          const endForDisplay = ev.end
                            ? addDays((typeof ev.end === 'string' ? parseISO(ev.end) : ev.end), -1)
                            : (typeof ev.start === 'string' ? parseISO(ev.start) : ev.start);
                          return `${formatDate(endForDisplay)} (終日)`;
                        })()
                      : `${formatDate(ev.start)} ${formatTime(ev.start)} - ${formatTime(ev.end)}`}
                  </Typography>
                  {ev.extendedProps?.location && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', mt: 0.2, fontSize: '0.8rem' }}>
                      <LocationOnIcon fontSize="inherit" sx={{ mr: 0.5 }} />{ev.extendedProps.location}
                    </Typography>
              )}
            </Paper>
              ))}
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

export default EventDetailsPanel;
