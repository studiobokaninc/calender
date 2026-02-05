// src/components/EventDetailsPanel.tsx
import React, { useMemo } from 'react';
import { Box, Typography, List, ListItem, ListItemButton, ListItemText, Divider, Paper, Chip, IconButton, Button, Tooltip, FormControl, Select, MenuItem, FormGroup, FormControlLabel, Checkbox } from '@mui/material';
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
const getTaskColor = (
  status?: string,
  projectStatus?: string,
  dueDate?: string | Date | null
): string => {
  const projectStatusStr = projectStatus ? String(projectStatus).toLowerCase() : undefined;

  if (projectStatusStr === 'completed' || projectStatusStr === 'cancelled') {
    return '#9E9E9E'; // Grey if project is completed/cancelled
  }

  switch (status) {
    case 'todo': return '#2196F3';
    case 'in-progress': return '#FF9800';
    case 'review': return '#9C27B0';
    case 'delayed': return '#F44336';
    case 'completed': return '#9E9E9E'; // Grey if task itself is completed
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
      return '#9e9e9e'; // Grey (completed 統一)
    case '保留':
      return '#ff9800'; // Orange
    default:
      return '#9e9e9e'; // Grey for default/unknown
  }
};

// 日付が過ぎているかどうかを判定するヘルパー関数
const isDatePast = (dateStr: string | Date | null | undefined): boolean => {
  if (!dateStr) return false;
  try {
    const date = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
    if (!isValid(date)) return false;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const eventDate = new Date(date);
    eventDate.setHours(0, 0, 0, 0);
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    return eventDate <= yesterday;
  } catch {
    return false;
  }
};

// Updated getEventColor (same logic as CalendarPage.tsx)
const getEventColor = (
  type?: string,
  projectStatus?: string,
  eventDate?: string | Date | null
): string => {
  // プロジェクトステータスを文字列に変換（Enum型の場合も考慮）
  const projectStatusStr = projectStatus ? String(projectStatus).toLowerCase() : undefined;
  
  // プロジェクトが完了またはキャンセルの場合は、イベントの種類に関わらずグレーにする
  if (projectStatusStr === 'completed' || projectStatusStr === 'cancelled') {
    return '#9E9E9E';
  }
  
  // 日付が過ぎている場合はグレーにする
  if (eventDate) {
    const isPast = isDatePast(eventDate);
    if (isPast) {
      return '#9E9E9E';
    }
  }
  
  const t = type?.toLowerCase();
  switch (t) {
    case 'meeting': return '#1976d2';
    case 'review': case 'workshop': return '#00897b';
    case 'deadline': return '#d32f2f';
    case 'milestone': return '#9C27B0';
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
  eventTypeFilter: Record<string, boolean>;
  onEventTypeFilterChange: (typeKey: string, checked: boolean) => void;
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
  eventTypeFilter,
  onEventTypeFilterChange,
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
        
        if (eventEndObj) {
          // FullCalendarの終日イベントは排他的終了日を使用（実際の終了日+1日）
          // 期間イベント（プロジェクトなど）の場合、終了日は排他的
          const currentEventDayEnd = startOfDay(eventEndObj);
          
          // 単一日イベントかどうかをチェック（start日とend日が同じまたは1日差）
          const daysDiff = Math.floor((currentEventDayEnd.getTime() - currentEventDayStart.getTime()) / (1000 * 60 * 60 * 24));
          
          if (daysDiff <= 1) {
            // 単一日イベント（マイルストーン、締切など）
            return isSameDay(currentEventDayStart, selectedDate!);
          } else {
            // 期間イベント（プロジェクトなど）- 排他的終了日として扱う
            return currentEventDayStart <= selectedDayEnd && currentEventDayEnd > selectedDayStart;
          }
        } else {
          // endがない場合は単一日イベント
          return isSameDay(currentEventDayStart, selectedDate!);
        }
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
  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach(u => {
      const key = String(u.id);
      const label = u.username || u.name || u.email || String(u.id);
      m.set(key, label);
      if (!key.startsWith('user-')) m.set(`user-${key}`, label); // バックエンドの "user-1" 形式にも対応
    });
    return m;
  }, [users]);
  const groupMap: Map<string, string> = useMemo(() => {
    const m = new Map<string, string>();
    groups.forEach(g => {
      const key = String(g.id);
      m.set(key, g.name);
      if (!key.startsWith('group-')) m.set(`group-${key}`, g.name); // バックエンドの "group-1" 形式にも対応
    });
    return m;
  }, [groups]);
  // ★★★ Add projectMap for lookup (Project型) ★★★
  const projectMap = useMemo(() => new Map((projects ?? []).map(p => {
    let key = String(p.id);
    if (key.startsWith('proj-')) key = key.replace('proj-', '');
    return [key, p];
  })), [projects]);

  /** 参加者オブジェクトから表示名を取得（id が "user-1" / "group-1" または数値の両方に対応） */
  const getParticipantDisplayName = (p: Participant): string => {
    const idStr = String(p.id ?? '');
    if (p.type === 'user') {
      return userMap.get(idStr) ?? userMap.get(idStr.replace(/^user-/, '')) ?? idStr;
    }
    const groupId = idStr.startsWith('group-') ? idStr.replace('group-', '') : idStr;
    return groupMap.get(groupId) ?? groupMap.get(idStr) ?? idStr;
  };

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
      case 'group': return <GroupIcon sx={{ mr: 1, color: 'inherit' }} fontSize="small" />;
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
    
    // プロジェクトIDからプロジェクト情報を取得
    const projectId = event.extendedProps?.projectId;
    const project = projectId ? projectMap.get(String(projectId)) : undefined;
    const projectStatus = project?.status ?? event.extendedProps?.projectStatus;
    
    // イベント日付を取得
    let eventDate: string | Date | null = null;
    if (event.end) {
      eventDate = typeof event.end === 'string' ? event.end : event.end;
    } else if (event.start) {
      eventDate = typeof event.start === 'string' ? event.start : event.start;
    }
    
    if (type === 'project') return getProjectColor({ status: projectStatus ?? undefined });
    if (type === 'task') {
      const taskDueDate = event.extendedProps?.taskDueDate;
      return getTaskColor(
        event.extendedProps?.taskStatus ?? 'todo', 
        (projectStatus === null || projectStatus === undefined) ? undefined : projectStatus, 
        (taskDueDate === null || taskDueDate === undefined) ? undefined : (taskDueDate as string | Date | null)
      );
    }
    if (type === 'group') return '#9C27B0'; // グループは紫
    return getEventColor(
      type ?? undefined, 
      (projectStatus === null || projectStatus === undefined) ? undefined : projectStatus, 
      (eventDate === null || eventDate === undefined) ? undefined : (eventDate as string | Date | null)
    );
  };

  // カード色分け用関数
  const getCardColor = (ev: CalendarEvent) => {
    const type = ev.extendedProps?.type?.toLowerCase?.();
    
    // プロジェクトIDからプロジェクト情報を取得
    const projectId = ev.extendedProps?.projectId;
    const project = projectId ? projectMap.get(String(projectId)) : undefined;
    const projectStatus = project?.status ?? ev.extendedProps?.projectStatus;
    
    // イベント日付を取得
    let eventDate: string | Date | null = null;
    if (ev.end) {
      eventDate = typeof ev.end === 'string' ? ev.end : ev.end;
    } else if (ev.start) {
      eventDate = typeof ev.start === 'string' ? ev.start : ev.start;
    }
    
    if (type === 'project') return getProjectColor({ status: projectStatus ?? undefined });
    if (type === 'group') return '#9C27B0'; // グループは紫
    if (type === 'task') {
      const taskDueDate = ev.extendedProps?.taskDueDate;
      return getTaskColor(
        ev.extendedProps?.taskStatus ?? 'todo', 
        (projectStatus === null || projectStatus === undefined) ? undefined : (projectStatus as string), 
        (taskDueDate === null || taskDueDate === undefined) ? undefined : (taskDueDate as string | Date | null)
      );
    }
    // バックエンドイベント（会議、マイルストーン、締切など）の場合
    return getEventColor(
      ev.extendedProps?.type, 
      (projectStatus === null || projectStatus === undefined) ? undefined : (projectStatus as string), 
      (eventDate === null || eventDate === undefined) ? undefined : (eventDate as string | Date | null)
    );
  };

  // カード色デバッグ: dailyEventsが変化したときに出力
  React.useEffect(() => {
    dailyEvents.forEach(ev => {
      console.log('カード色デバッグ:', {
        id: ev.id,
        title: ev.title,
        type: ev.extendedProps?.type,
        color: getCardColor(ev),
        projectStatus: ev.extendedProps?.projectStatus,
        taskStatus: ev.extendedProps?.taskStatus
      });
    });
  }, [dailyEvents]);

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
        <Box sx={{ mb: 1 }}>
          {selectedDate && (
            <Typography variant="subtitle1" sx={{ fontWeight: 700, fontSize: '1.15rem', color: 'primary.main', mb: 1 }}>
              {formatDate(selectedDate)}
            </Typography>
          )}
          {/* フィルターラベル */}
          <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '1.1rem', mb: 0.5 }}>表示イベント</Typography>
          {/* プロジェクトフィルター */}
          <FormControl size="small" sx={{ minWidth: 140, mb: 1, '& .MuiInputBase-root': { height: 32 }, '& .MuiSelect-select': { py: 0.5, fontSize: '0.92rem' } }}>
            <Select
              labelId="event-project-filter-label"
              value={eventStatusFilter}
              onChange={onEventStatusFilterChange}
              displayEmpty
              inputProps={{ 'aria-label': 'プロジェクトフィルター' }}
              sx={{ fontSize: '0.92rem', height: 32, minHeight: 32 }}
            >
              <MenuItem value="all">すべてのプロジェクト</MenuItem>
              <MenuItem value="no-project">プロジェクト未設定</MenuItem>
              {projects.filter(project => project.display_status !== 'offline').map((project) => {
                const isOnline = project.display_status === 'online';
                const statusColor = isOnline ? '#4CAF50' : '#9E9E9E';
                return (
                  <MenuItem 
                    key={project.id} 
                    value={String(project.id)}
                    sx={{
                      '&::before': {
                        content: '""',
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: statusColor,
                        marginRight: 1,
                        verticalAlign: 'middle'
                      }
                    }}
                  >
                    {project.name}
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
          {/* 表示する予定の種類（チェックボックスで個別にオンオフ） */}
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5, mb: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.secondary', mr: 1 }}>表示する種類</Typography>
            <Button size="small" variant="outlined" sx={{ minWidth: 64, py: 0.25, fontSize: '0.75rem' }} onClick={() => ['project', 'task', 'milestone', 'deadline', 'meeting', 'workshop', 'generic', 'event', 'group'].forEach((k) => onEventTypeFilterChange(k, true))}>全てオン</Button>
            <Button size="small" variant="outlined" sx={{ minWidth: 64, py: 0.25, fontSize: '0.75rem' }} onClick={() => ['project', 'task', 'milestone', 'deadline', 'meeting', 'workshop', 'generic', 'event', 'group'].forEach((k) => onEventTypeFilterChange(k, false))}>全てオフ</Button>
          </Box>
          <FormGroup row sx={{ flexWrap: 'wrap', gap: 0 }}>
            <FormControlLabel
              control={<Checkbox size="small" checked={eventTypeFilter.project !== false} onChange={(_, c) => onEventTypeFilterChange('project', c)} />}
              label={<Typography variant="body2">プロジェクト</Typography>}
            />
            <FormControlLabel
              control={<Checkbox size="small" checked={eventTypeFilter.task !== false} onChange={(_, c) => onEventTypeFilterChange('task', c)} />}
              label={<Typography variant="body2">タスク</Typography>}
            />
            <FormControlLabel
              control={<Checkbox size="small" checked={eventTypeFilter.milestone !== false} onChange={(_, c) => onEventTypeFilterChange('milestone', c)} />}
              label={<Typography variant="body2">マイルストーン</Typography>}
            />
            <FormControlLabel
              control={<Checkbox size="small" checked={eventTypeFilter.deadline !== false} onChange={(_, c) => onEventTypeFilterChange('deadline', c)} />}
              label={<Typography variant="body2">締切</Typography>}
            />
            <FormControlLabel
              control={<Checkbox size="small" checked={eventTypeFilter.meeting !== false} onChange={(_, c) => onEventTypeFilterChange('meeting', c)} />}
              label={<Typography variant="body2">会議</Typography>}
            />
            <FormControlLabel
              control={<Checkbox size="small" checked={eventTypeFilter.workshop !== false} onChange={(_, c) => onEventTypeFilterChange('workshop', c)} />}
              label={<Typography variant="body2">ワークショップ</Typography>}
            />
            <FormControlLabel
              control={<Checkbox size="small" checked={(eventTypeFilter.generic !== false && eventTypeFilter.event !== false)} onChange={(_, c) => { onEventTypeFilterChange('generic', c); onEventTypeFilterChange('event', c); }} />}
              label={<Typography variant="body2">通常・その他</Typography>}
            />
            <FormControlLabel
              control={<Checkbox size="small" checked={eventTypeFilter.group !== false} onChange={(_, c) => onEventTypeFilterChange('group', c)} />}
              label={<Typography variant="body2">グループ</Typography>}
            />
          </FormGroup>
        </Box>
      )}

      {!isMinimized && (
        <>
          {selectedEvent && (
            <Paper 
              elevation={2} 
              sx={{ 
                p: 2, 
                borderLeft: 5, 
                borderColor: getTitleBorderColor(selectedEvent),
                backgroundColor: '#fafafa',
                transition: 'box-shadow 0.2s',
                '&:hover': { boxShadow: 4 },
                cursor: 'pointer',
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                handleEdit();
              }}
            >
              {/* 1. タイトル（アイコン付き・青・ボールド・左詰め） */}
              <Box sx={{ mb: 1.5 }}>
                {/* タイプ表示Chip */}
                <Chip 
                  label={(() => {
                    const type = selectedEvent.extendedProps?.type;
                    switch(type?.toLowerCase()) {
                      case 'task': return 'タスク';
                      case 'project': return 'プロジェクト';
                      case 'group': return 'グループ';
                      case 'milestone': return 'マイルストーン';
                      case 'deadline': return '締切';
                      case 'meeting': return '会議';
                      case 'review': return 'レビュー';
                      case 'generic': case 'event': return '通常';
                      default: return type || '通常';
                    }
                  })()} 
                  size="small"
                  sx={{ 
                    mb: 1,
                    fontWeight: 600,
                    backgroundColor: selectedEvent.extendedProps?.type === 'task' 
                      ? getTaskColor(selectedEvent.extendedProps?.taskStatus ?? 'todo')
                      : selectedEvent.extendedProps?.type === 'project'
                        ? getProjectColor({ status: selectedEvent.extendedProps?.projectStatus ?? undefined })
                        : selectedEvent.extendedProps?.type === 'group'
                          ? '#9C27B0'
                          : getEventColor(selectedEvent.extendedProps?.type ?? undefined),
                    color: '#fff'
                  }}
                />
                
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    color: 'text.primary',
                    fontSize: '1.15rem',
                    mb: 0.8,
                    pl: 0,
                  }}
                >
                  {getTypeIcon(selectedEvent.extendedProps?.type)} 
                  {selectedEvent.title}
                </Typography>

                {/* 2. 時間 or 期日（アイコン付き） */}
                <Typography
                  color="text.secondary"
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: '0.9rem',
                    pl: 0,
                  }}
                >
                <AccessTimeIcon fontSize="inherit" sx={{ mr: 0.5 }} />
                {selectedEvent.extendedProps?.taskDueDate != null
                  ? `${formatDate(selectedEvent.extendedProps.taskDueDate)} (終日)`
                  : (selectedEvent.start != null
                      ? (() => {
                          if (selectedEvent.allDay) {
                            // 締切・マイルストーンの場合は、startを直接使用（タイムゾーン問題を回避）
                            const eventType = selectedEvent.extendedProps?.type;
                            if (eventType === 'Deadline' || eventType === 'Milestone') {
                              return `${formatDate(selectedEvent.start)} (終日)`;
                            }
                          // 期間のある終日イベント（プロジェクトや通常イベント）は開始日と終了日を表示
                          if (selectedEvent.end) {
                            const startDate = typeof selectedEvent.start === 'string' ? parseISO(selectedEvent.start) : selectedEvent.start;
                            const endDate = addDays((typeof selectedEvent.end === 'string' ? parseISO(selectedEvent.end) : selectedEvent.end), -1);
                            // 開始日と終了日が同じ場合は終日のみ表示
                            if (formatDate(startDate) === formatDate(endDate)) {
                              return `${formatDate(startDate)} (終日)`;
                            }
                            // 異なる場合は期間を表示
                            return `${formatDate(startDate)} - ${formatDate(endDate)} (終日)`;
                          }
                          // 終了日がない場合は開始日のみ
                          console.log(`[EventDetailsPanel] No end date for event: ${selectedEvent.title}, type: ${selectedEvent.extendedProps?.type}, start: ${selectedEvent.start}`);
                          return `${formatDate(selectedEvent.start)} (終日)`;
                          }
                          return `${formatDate(selectedEvent.start)} ${formatTime(selectedEvent.start)} - ${formatTime(selectedEvent.end != null ? selectedEvent.end : '')}`;
                        })()
                      : '')}
                </Typography>
              </Box>

              {/* 3. その他の詳細（Chipや担当者など） */}
              {selectedEvent.extendedProps?.type === 'task' && (
                <>
                  {/* 関連プロジェクト（日付の下、説明の上に表示。未設定の場合は「未設定」と表示） */}
                  <Box sx={{ 
                    mt: 1, 
                    mb: 1.5, 
                    p: 1, 
                    backgroundColor: selectedEvent.extendedProps?.projectId && projectMap.has(String(selectedEvent.extendedProps.projectId)) ? 'rgba(25, 118, 210, 0.08)' : 'rgba(0,0,0,0.04)', 
                    borderRadius: 1,
                    display: 'flex',
                    alignItems: 'center'
                  }}>
                    <FolderIcon sx={{ mr: 1, color: selectedEvent.extendedProps?.projectId ? 'primary.main' : 'text.secondary', fontSize: '1.1rem' }} />
                    <Typography variant="body2" sx={{ fontWeight: 600, color: selectedEvent.extendedProps?.projectId ? 'primary.main' : 'text.secondary', fontSize: '0.95rem' }}>
                      {selectedEvent.extendedProps?.projectId && projectMap.has(String(selectedEvent.extendedProps.projectId))
                        ? (() => {
                            const project = projectMap.get(String(selectedEvent.extendedProps.projectId));
                            return project && 'name' in project ? project.name : '';
                          })()
                        : 'プロジェクト未設定'}
                    </Typography>
                  </Box>
                   
                  {/* タスクの説明 */}
                  {selectedEvent.extendedProps?.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, fontSize: '0.9rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      {selectedEvent.extendedProps.description}
                    </Typography>
                  )}
                  
                  <Divider sx={{ my: 1.5 }} />
                  
                  {/* メタ情報セクション */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {/* ステータスChip */}
                    {selectedEvent.extendedProps?.taskStatus && (
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Typography variant="caption" sx={{ minWidth: 70, color: 'text.secondary', fontWeight: 500 }}>
                          ステータス:
                        </Typography>
                        <Chip
                          label={selectedEvent.extendedProps.taskStatus}
                          size="small"
                          sx={{ backgroundColor: getTaskColor(selectedEvent.extendedProps.taskStatus ?? 'todo'), color: '#fff', fontWeight: 500 }}
                        />
                      </Box>
                    )}
                    
                    {/* 担当者（ユーザーIDで表示） */}
                    {selectedEvent.extendedProps?.taskAssigneeId != null && (() => {
                      const assigneeIdStr = String(selectedEvent.extendedProps.taskAssigneeId);
                      const assigneeIdNum = parseInt(assigneeIdStr, 10);
                      const user = users.find(u => u.id === assigneeIdNum);
                      if (user) {
                        return (
                          <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <Typography variant="caption" sx={{ minWidth: 70, color: 'text.secondary', fontWeight: 500 }}>
                              担当者:
                            </Typography>
                            <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
                              {user.username || user.id}
                            </Typography>
                          </Box>
                        );
                      }
                      return null;
                    })()}
                    
                    {/* コスト */}
                    {selectedEvent.extendedProps?.taskCost !== undefined && (
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Typography variant="caption" sx={{ minWidth: 70, color: 'text.secondary', fontWeight: 500 }}>
                          コスト:
                        </Typography>
                        <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
                          {selectedEvent.extendedProps.taskCost?.toLocaleString() ?? '未設定'}
                        </Typography>
                      </Box>
                    )}
                    
                    {/* 依存関係 */}
                    {(() => {
                      const dependsOn = selectedEvent.extendedProps?.dependsOn || [];
                      const thisTaskId = selectedEvent.extendedProps?.taskId;
                      const toTasks = events.filter(e =>
                        e.extendedProps?.type === 'task' &&
                        Array.isArray(e.extendedProps?.dependsOn) &&
                        e.extendedProps.dependsOn.includes(String(thisTaskId))
                      );
                      
                      // このタスクが依存しているタスクを取得（実際に存在するもののみ）
                      const fromTasks = dependsOn
                        .map(id => events.find(e => e.extendedProps?.type === 'task' && String(e.extendedProps?.taskId) === String(id)))
                        .filter(t => t !== undefined);
                      
                      // 依存関係がある場合のみ表示（実際にタスクが見つかった場合のみ）
                      if (fromTasks.length > 0 || toTasks.length > 0) {
                        // 依存タスクをまとめて表示
                        const allDependentTasks = [
                          ...fromTasks.map(t => t!.title),
                          ...toTasks.map(t => t.title)
                        ].filter(title => title); // 空文字列を除外
                        
                        // 実際に表示するタスクがある場合のみ表示
                        if (allDependentTasks.length > 0) {
                          return (
                            <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
                              <Typography variant="caption" sx={{ minWidth: 70, color: 'text.secondary', fontWeight: 500, pt: 0.25 }}>
                                依存タスク:
                              </Typography>
                              <Typography variant="body2" color="text.primary" sx={{ flex: 1, fontSize: '0.875rem' }}>
                                {allDependentTasks.join(', ')}
                              </Typography>
                            </Box>
                          );
                        }
                      }
                      return null;
                    })()}
                  </Box>
                </>
              )}
              {selectedEvent.extendedProps?.type === 'project' && (
                <>
                  {selectedEvent.extendedProps?.projectDescription && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 1.5, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                      {selectedEvent.extendedProps.projectDescription}
                    </Typography>
                  )}
                  
                  <Divider sx={{ my: 1.5 }} />
                  
                  {/* プロジェクト統計情報 */}
                  {(() => {
                    const projectId = selectedEvent.extendedProps?.projectId;
                    const projectTasks = events.filter(e => e.extendedProps?.type === 'task' && String(e.extendedProps?.projectId) === String(projectId));
                    const taskCount = projectTasks.length;
                    const assigneeIds = Array.from(new Set(projectTasks.map(t => t.extendedProps?.taskAssigneeId).filter(Boolean)));
                    const assigneeNames = assigneeIds
                      .map(id => userMap.get(String(id ?? '')) ?? '')
                      .filter((name): name is string => !!name);
                    return (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography variant="caption" sx={{ minWidth: 80, color: 'text.secondary', fontWeight: 500 }}>
                            タスク数:
                          </Typography>
                          <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
                            {taskCount}
                          </Typography>
                        </Box>
                        {assigneeNames.length > 0 && (
                          <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
                            <Typography variant="caption" sx={{ minWidth: 80, color: 'text.secondary', fontWeight: 500, pt: 0.25 }}>
                              関係者:
                            </Typography>
                            <Typography variant="body2" color="text.primary" sx={{ flex: 1, fontSize: '0.875rem' }}>
                              {assigneeNames.join(', ')}
                            </Typography>
                          </Box>
                        )}
                      </Box>
                    );
                  })()}
                  
                  {/* ステータス */}
                  {selectedEvent.extendedProps?.projectStatus && (
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Typography variant="caption" sx={{ minWidth: 80, color: 'text.secondary', fontWeight: 500 }}>
                        ステータス:
                      </Typography>
                      <Chip
                        label={selectedEvent.extendedProps.projectStatus}
                        size="small"
                        sx={{ 
                          backgroundColor: getProjectColor({ status: selectedEvent.extendedProps.projectStatus }), 
                          color: '#fff', 
                          fontWeight: 500 
                        }}
                      />
                    </Box>
                  )}
                </>
              )}
              {selectedEvent.extendedProps?.type === 'group' && (
                <>
                  {selectedEvent.extendedProps?.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 1.5, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                      {selectedEvent.extendedProps.description}
                    </Typography>
                  )}
                  <Divider sx={{ my: 1.5 }} />
                </>
              )}
              {!['task', 'project', 'group'].includes(selectedEvent.extendedProps?.type || '') && (
                 <>
                   {/* 説明 */}
                   {selectedEvent.extendedProps?.description && (
                     <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 1.5, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                       {selectedEvent.extendedProps.description}
                     </Typography>
                   )}
                   
                   {/* 情報がある場合はDividerで区切る */}
                   {(selectedEvent.extendedProps?.location || selectedEvent.extendedProps?.status || (selectedEvent.extendedProps?.participants && selectedEvent.extendedProps.participants.length > 0)) && (
                     <Divider sx={{ my: 1.5 }} />
                   )}
                   
                   {/* メタ情報セクション */}
                   <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
                     {/* 時間情報（会議、ワークショップ、通常イベント用） */}
                     {['meeting', 'workshop', 'generic', 'event'].includes(selectedEvent.extendedProps?.type?.toLowerCase() || '') && !selectedEvent.allDay && selectedEvent.start && (
                       <Box sx={{ 
                         p: 1.5, 
                         backgroundColor: 'rgba(33, 150, 243, 0.08)', 
                         borderRadius: 1,
                         borderLeft: 3,
                         borderColor: 'primary.main'
                       }}>
                         <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                           <AccessTimeIcon sx={{ mr: 0.5, color: 'primary.main', fontSize: '1.2rem' }} />
                           <Typography variant="body2" sx={{ fontWeight: 600, color: 'primary.main' }}>
                             時間
                           </Typography>
                         </Box>
                         <Box sx={{ ml: 3 }}>
                           <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                             <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main' }}>
                               {formatTime(selectedEvent.start)}
                             </Typography>
                             <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                               〜
                             </Typography>
                             <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main' }}>
                               {selectedEvent.end ? formatTime(selectedEvent.end) : '未設定'}
                             </Typography>
                           </Box>
                         </Box>
                       </Box>
                     )}
                     
                     {/* 場所情報 */}
                     {selectedEvent.extendedProps?.location && (
                       <Box sx={{ display: 'flex', alignItems: 'center' }}>
                         <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 70 }}>
                           <LocationOnIcon sx={{ mr: 0.5, color: 'text.secondary', fontSize: '1rem' }} />
                           <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                             場所:
                           </Typography>
                         </Box>
                         <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
                           {selectedEvent.extendedProps.location}
                         </Typography>
                       </Box>
                     )}
                     
                     {/* ステータス（特定のイベントタイプでは非表示） */}
                     {selectedEvent.extendedProps?.status && 
                      !['meeting', 'milestone', 'deadline', 'workshop', 'generic', 'event'].includes(selectedEvent.extendedProps?.type?.toLowerCase() || '') && (
                       <Box sx={{ display: 'flex', alignItems: 'center' }}>
                         <Typography variant="caption" sx={{ minWidth: 70, color: 'text.secondary', fontWeight: 500 }}>
                           ステータス:
                         </Typography>
                         <Chip
                           label={selectedEvent.extendedProps.status}
                           size="small"
                           sx={{ 
                             backgroundColor: getStatusColor(selectedEvent.extendedProps.status), 
                             color: '#fff', 
                             fontWeight: 500 
                           }}
                         />
                       </Box>
                     )}
                     
                     {/* 参加者 */}
                     {selectedEvent.extendedProps?.participants && selectedEvent.extendedProps.participants.length > 0 && (
                       <Box>
                         <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.8 }}>
                           <GroupIcon sx={{ mr: 0.5, color: 'text.secondary', fontSize: '1rem' }} />
                           <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
                             参加者
                           </Typography>
                         </Box>
                         <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, ml: 3 }}>
                          {(selectedEvent.extendedProps.participants as Participant[]).map((p, index) => {
                            const name = getParticipantDisplayName(p);
                            const key = `${p.type}-${String(p.id)}-${index}`;
                            return (
                              <Chip 
                                key={key} 
                                label={name} 
                                size="small" 
                                sx={{ 
                                  fontWeight: 500,
                                  backgroundColor: p.type === 'group' ? 'secondary.light' : 'primary.light',
                                  color: p.type === 'group' ? 'secondary.dark' : 'primary.dark'
                                }} 
                              />
                            );
                          })}
                         </Box>
                       </Box>
                     )}
                     
                     {/* 関連プロジェクト（未設定の場合は「未設定」と表示） */}
                     <Box sx={{ 
                       mt: 0.5,
                       p: 1, 
                       backgroundColor: selectedEvent.extendedProps?.projectId && projectMap.has(String(selectedEvent.extendedProps.projectId)) ? 'rgba(25, 118, 210, 0.08)' : 'rgba(0,0,0,0.04)', 
                       borderRadius: 1,
                       display: 'flex',
                       alignItems: 'center'
                     }}>
                       <FolderIcon sx={{ mr: 1, color: selectedEvent.extendedProps?.projectId ? 'primary.main' : 'text.secondary', fontSize: '1rem' }} />
                       <Typography variant="body2" sx={{ fontWeight: 600, color: selectedEvent.extendedProps?.projectId ? 'primary.main' : 'text.secondary', fontSize: '0.9rem' }}>
                         {selectedEvent.extendedProps?.projectId && projectMap.has(String(selectedEvent.extendedProps.projectId))
                           ? (() => {
                               const project = projectMap.get(String(selectedEvent.extendedProps.projectId));
                               return project && 'name' in project ? project.name : '';
                             })()
                           : 'プロジェクト未設定'}
                       </Typography>
                     </Box>
                   </Box>
                 </>
              )}
              {/* 4. 編集・削除ボタン（右端） */}
              <Divider sx={{ my: 1.5 }} />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                <Tooltip title="編集">
                  <IconButton 
                    size="small" 
                    onClick={handleEdit} 
                    sx={{ 
                      backgroundColor: 'action.hover',
                      '&:hover': { backgroundColor: 'primary.light', color: 'primary.main' }
                    }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="削除">
                  <IconButton 
                    size="small" 
                    onClick={handleDelete}
                    sx={{ 
                      backgroundColor: 'action.hover',
                      '&:hover': { backgroundColor: 'error.light', color: 'error.main' }
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Paper>
          )}
          {/* 選択日あり・イベントなし: 案内表示 */}
          {selectedEvent === null && selectedDate && dailyEvents.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2, p: 1.5, fontStyle: 'italic' }}>
              この日の予定はありません
            </Typography>
          )}
          {/* イベントリスト表示: selectedEventがnullかつdailyEventsがある場合（カード式表示） */}
          {selectedEvent === null && dailyEvents.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary', mb: 1.5 }}>
                この日の予定 ({dailyEvents.length} 件)
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {dailyEvents.map(ev => (
                <Paper
                  key={ev.id}
                  elevation={2}
                  sx={{
                    width: '100%',
                    minWidth: 0,
                    p: 1.25,
                    cursor: 'pointer',
                    borderLeft: 4,
                    borderColor: getCardColor(ev),
                    transition: 'box-shadow 0.2s',
                    '&:hover': { boxShadow: 6, background: '#f5faff' },
                  }}
                  onClick={() => onEventSelect(ev)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onEdit(ev);
                  }}
                >
                  {/* タイプ表示Chip */}
                  <Chip 
                    label={(() => {
                      const type = ev.extendedProps?.type;
                      switch(type?.toLowerCase()) {
                        case 'task': return 'タスク';
                        case 'project': return 'プロジェクト';
                        case 'group': return 'グループ';
                        case 'milestone': return 'マイルストーン';
                        case 'deadline': return '締切';
                        case 'meeting': return '会議';
                        case 'review': return 'レビュー';
                        case 'generic': case 'event': return '通常';
                        default: return type || '通常';
                      }
                    })()} 
                    size="small"
                    sx={{ 
                      mb: 0.5,
                      height: 20,
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      backgroundColor: getCardColor(ev),
                      color: '#fff'
                    }}
                  />
                  
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.3 }}>
                    <span style={{ color: getCardColor(ev), display: 'flex', alignItems: 'center' }}>
                      {getTypeIcon(ev.extendedProps?.type)}
                    </span>
                    <Typography variant="body2" sx={{ ml: 0.5, flex: 1, fontSize: '0.98rem', color: getCardColor(ev), fontWeight: 400 }} noWrap>
                      {ev.title}
                    </Typography>
                  </Box>
                  {/* 日付・時刻表示 */}
                  {ev.allDay ? (
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.2, fontSize: '0.85rem' }}>
                      {(() => {
                        // 締切・マイルストーンの場合は、startを直接使用（タイムゾーン問題を回避）
                        const eventType = ev.extendedProps?.type;
                        if (eventType === 'Deadline' || eventType === 'Milestone') {
                          return `${formatDate(ev.start)} (終日)`;
                        }
                        // 期間のある終日イベント（プロジェクトや通常イベント）は開始日と終了日を表示
                        if (ev.end) {
                          const startDate = typeof ev.start === 'string' ? parseISO(ev.start) : ev.start;
                          const endDate = addDays((typeof ev.end === 'string' ? parseISO(ev.end) : ev.end), -1);
                          // 開始日と終了日が同じ場合は終日のみ表示
                          if (formatDate(startDate) === formatDate(endDate)) {
                            return `${formatDate(startDate)} (終日)`;
                          }
                          // 異なる場合は期間を表示
                          return `${formatDate(startDate)} - ${formatDate(endDate)} (終日)`;
                        }
                        // 終了日がない場合は開始日のみ
                        return `${formatDate(ev.start)} (終日)`;
                      })()}
                    </Typography>
                  ) : (
                    // 会議、ワークショップ、通常イベントの時刻表示を強調
                    <Box sx={{ mb: 0.2 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', display: 'block' }}>
                        {formatDate(ev.start)}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.2 }}>
                        <AccessTimeIcon sx={{ fontSize: '0.85rem', color: 'primary.main' }} />
                        <Typography variant="body2" sx={{ fontWeight: 600, color: 'primary.main', fontSize: '0.9rem' }}>
                          {formatTime(ev.start)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                          〜
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: 'primary.main', fontSize: '0.9rem' }}>
                          {ev.end ? formatTime(ev.end) : ''}
                        </Typography>
                      </Box>
                    </Box>
                  )}
                  
                  {/* 追加情報エリア */}
                  <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.3 }}>
                    {/* 場所 */}
                    {ev.extendedProps?.location && (
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <LocationOnIcon sx={{ fontSize: '0.9rem', color: 'text.secondary', mr: 0.3 }} />
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }} noWrap>
                          {ev.extendedProps.location}
                        </Typography>
                      </Box>
                    )}
                    
                    {/* 参加者（横長の余白を活かして名前を横並びで表示） */}
                    {ev.extendedProps?.participants && ev.extendedProps.participants.length > 0 && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', mt: 0.2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                          <GroupIcon sx={{ fontSize: '0.9rem', color: 'text.secondary', mr: 0.25 }} />
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                            参加者:
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4, alignItems: 'center', flex: 1, minWidth: 0 }}>
                          {(ev.extendedProps.participants as Participant[]).map((p, index) => {
                            const name = getParticipantDisplayName(p);
                            const key = `ev-${ev.id}-${p.type}-${String(p.id)}-${index}`;
                            return (
                              <Chip
                                key={key}
                                label={name}
                                size="small"
                                sx={{
                                  height: 20,
                                  fontSize: '0.7rem',
                                  fontWeight: 500,
                                  maxWidth: 160,
                                  '& .MuiChip-label': { px: 0.6, overflow: 'hidden', textOverflow: 'ellipsis' },
                                  backgroundColor: p.type === 'group' ? 'secondary.light' : 'primary.light',
                                  color: p.type === 'group' ? 'secondary.dark' : 'primary.dark',
                                }}
                              />
                            );
                          })}
                        </Box>
                      </Box>
                    )}
                    
                    {/* ステータス（タスク・プロジェクト・特定イベントタイプ以外） */}
                    {ev.extendedProps?.status && 
                     !['task', 'project', 'meeting', 'milestone', 'deadline', 'workshop', 'generic', 'event'].includes(ev.extendedProps?.type?.toLowerCase() || '') && (
                      <Chip
                        label={ev.extendedProps.status}
                        size="small"
                        sx={{ 
                          height: 18,
                          fontSize: '0.65rem',
                          mt: 0.2,
                          backgroundColor: getStatusColor(ev.extendedProps.status), 
                          color: '#fff', 
                          fontWeight: 500,
                          '& .MuiChip-label': { px: 0.8, py: 0 }
                        }}
                      />
                    )}
                    
                    {/* 関連プロジェクト（未設定の場合は「未設定」と表示） */}
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <FolderIcon sx={{ fontSize: '0.9rem', color: ev.extendedProps?.projectId ? 'primary.main' : 'text.secondary', mr: 0.3 }} />
                      <Typography variant="caption" sx={{ fontSize: '0.75rem', color: ev.extendedProps?.projectId ? 'primary.main' : 'text.secondary', fontWeight: 500 }} noWrap>
                        {ev.extendedProps?.projectId && projectMap.has(String(ev.extendedProps.projectId))
                          ? (() => {
                              const project = projectMap.get(String(ev.extendedProps.projectId));
                              return project && 'name' in project ? project.name : '';
                            })()
                          : 'プロジェクト未設定'}
                      </Typography>
                    </Box>
                  </Box>
            </Paper>
              ))}
              </Box>
            </Box>
          )}
          {/* 日付未選択時の案内 */}
          {selectedEvent === null && !selectedDate && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2, p: 1.5, lineHeight: 1.6 }}>
              {`カレンダーの日付をクリックすると、その日の予定がここに表示されます。`}
            </Typography>
          )}
        </>
      )}
    </Box>
  );
};

export default EventDetailsPanel;