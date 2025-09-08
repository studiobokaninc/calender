import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Select,
  MenuItem, FormControl, InputLabel, Checkbox, FormControlLabel, Box, Grid,
  FormHelperText, RadioGroup, Radio, Divider, Typography,
  Autocomplete, Chip, CircularProgress
} from '@mui/material';
import { format, parseISO, isValid as isDateValid, addDays, addHours, startOfDay, setHours, setMinutes, parse } from 'date-fns';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import ja from 'date-fns/locale/ja';
import { Project, User, Group, Participant, CalendarEvent, Task } from '../types';
import api from '../services/api';
import { EventInput, EventApi } from '@fullcalendar/core';
import { DateClickArg } from '@fullcalendar/interaction';
import { SelectChangeEvent } from '@mui/material/Select';

// --- Interfaces ---
type EventType = 'Generic' | 'Meeting' | 'Deadline' | 'Milestone' | 'Workshop' | 'Task';

interface EventFormData {
  type: EventType;
  title: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;
  projectId?: string | null;
  newProjectName?: string;
  newProjectDescription?: string;
  newProjectStartDate?: string;
  newProjectEndDate?: string;
  newProjectColor?: string;
  taskDueDate?: string;
  taskAssigneeId?: string | null;
  taskCost?: number | string;
  taskStatus?: string;
  taskDependsOn?: string[];
  location?: string;
  dueDate?: string;
  displayStatus?: 'online' | 'offline' | 'archived';
  priority?: 'low' | 'medium' | 'high';
}

interface ProjectOption { id: string; name: string; }
interface UserOption { id: string; name?: string; }
interface TaskOption { id: string; name: string; }

// --- Option type for Autocomplete ---
interface ParticipantOption {
  id: string;
  type: 'user' | 'group';
  label: string; // Display name
}

// --- Component Props ---
interface EventAddModalMonthlyProps {
  open: boolean;
  onClose: () => void;
  onSave: (eventData: any) => void;
  initialDate: Date | null;
  eventToEdit?: CalendarEvent | null;
  dateClickArg?: DateClickArg | null;
  projects: Project[];
  users: User[];
  groups: Group[];
  tasks: Task[];
}

// --- Component ---
const EventAddModalMonthly: React.FC<EventAddModalMonthlyProps> = ({ open, onClose, onSave, initialDate, eventToEdit, dateClickArg, projects: projectsFromProps, users: usersFromProps, groups: groupsFromProps, tasks: tasksFromProps }) => {
  const getInitialState = (): EventFormData => {
    let initialStartDateTime = new Date();
    let initialEndDateTime = addHours(initialStartDateTime, 2);
    let initialAllDay = false;
    const defaultStartTime = 9;
    const defaultEndTime = 11;

    if (dateClickArg) {
      initialStartDateTime = dateClickArg.date;
      initialAllDay = dateClickArg.allDay;
      const viewType = dateClickArg.view.type;

      if (initialAllDay || viewType === 'dayGridMonth') {
        initialStartDateTime = setMinutes(setHours(startOfDay(initialStartDateTime), defaultStartTime), 0);
        initialEndDateTime = setMinutes(setHours(startOfDay(initialStartDateTime), defaultEndTime), 0);
        initialAllDay = true;
      } else {
        initialEndDateTime = addHours(initialStartDateTime, 2);
        initialAllDay = false;
      }
    } else if (initialDate) {
      initialStartDateTime = setMinutes(setHours(startOfDay(initialDate), defaultStartTime), 0);
      initialEndDateTime = setMinutes(setHours(startOfDay(initialDate), defaultEndTime), 0);
      initialAllDay = true;
    }
    return {
      type: 'Generic',
      title: '',
      description: '',
      startDate: format(initialStartDateTime, 'yyyy-MM-dd'),
      endDate: format(initialEndDateTime, 'yyyy-MM-dd'),
      startTime: format(initialStartDateTime, 'HH:mm'),
      endTime: format(initialEndDateTime, 'HH:mm'),
      allDay: initialAllDay,
      projectId: null,
      newProjectName: '',
      newProjectDescription: '',
      newProjectStartDate: '',
      newProjectEndDate: '',
      newProjectColor: '#4CAF50',
      taskDueDate: format(initialStartDateTime, 'yyyy-MM-dd'),
      taskAssigneeId: null,
      taskCost: '',
      taskStatus: 'todo',
      taskDependsOn: [],
      location: '',
      dueDate: format(initialStartDateTime, 'yyyy-MM-dd'),
      displayStatus: 'online',
      priority: 'medium',
    };
  };

  const [formData, setFormData] = useState<EventFormData>(getInitialState());
  const [projectSelectionMode, setProjectSelectionMode] = useState<'existing' | 'new'>('existing');
  const [errors, setErrors] = useState<Partial<Record<keyof EventFormData | 'newProjectName' | 'taskDueDate' | 'taskAssigneeId' | 'participants', string>>>({});
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState<ParticipantOption[]>([]);
  const [selectedDependencies, setSelectedDependencies] = useState<TaskOption[]>([]);

  useEffect(() => {
    if (open) {
      if (eventToEdit) {
        const eventTypeFromEditRaw = eventToEdit.extendedProps?.type;
        const eventTypeFromEdit = (eventTypeFromEditRaw === 'Task' || eventTypeFromEditRaw === 'task') ? 'task' : (eventTypeFromEditRaw || 'Generic');
        const isTask = eventTypeFromEdit === 'task';
        const taskDueDateFromProps = eventToEdit.extendedProps?.taskDueDate;
        const eventStartDate = eventToEdit.start ? new Date(eventToEdit.start as string) : new Date();
        const eventEndDate = eventToEdit.end ? new Date(eventToEdit.end as string) : new Date();
        const taskDueDate = taskDueDateFromProps ? new Date(taskDueDateFromProps) : eventEndDate;

        setFormData(prev => ({
          ...prev,
          type: eventTypeFromEdit,
          title: eventToEdit.title || '',
          description: eventToEdit.extendedProps?.description || '',
          startDate: format(eventStartDate, 'yyyy-MM-dd'),
          endDate: format(eventEndDate, 'yyyy-MM-dd'),
          startTime: format(eventStartDate, 'HH:mm'),
          endTime: format(eventEndDate, 'HH:mm'),
          allDay: eventToEdit.allDay || false,
          projectId: eventToEdit.extendedProps?.projectId?.toString() || null,
          taskDueDate: taskDueDateFromProps ? format(taskDueDate, 'yyyy-MM-dd') : '',
          taskAssigneeId: eventToEdit.extendedProps?.taskAssigneeId?.toString() || null,
          taskCost: eventToEdit.extendedProps?.taskCost || '',
          taskStatus: eventToEdit.extendedProps?.taskStatus || 'todo',
          taskDependsOn: eventToEdit.extendedProps?.dependsOn || [],
          location: eventToEdit.extendedProps?.location || '',
          displayStatus: 'online',
          priority: 'medium',
        }));
      } else {
        setFormData(getInitialState());
      }
      setProjectsLoading(false);
      setParticipantsLoading(false);
    }
  }, [open, eventToEdit]);

  const projectOptions = useMemo((): ProjectOption[] => {
    return projectsFromProps.map(p => ({ id: String(p.id), name: p.name })) || [];
  }, [projectsFromProps]);

  const userOptions = useMemo((): UserOption[] => {
    return usersFromProps.map(u => ({
      id: String(u.id),
      name: u.name || u.email
    })) || [];
  }, [usersFromProps]);

  const participantOptions = useMemo(() => {
    const userParticipantOptions: ParticipantOption[] = usersFromProps.map(u => ({
      id: String(u.id),
      type: 'user',
      label: u.name || u.email || ''
    }));
    const groupParticipantOptions: ParticipantOption[] = (groupsFromProps || []).map(g => ({
      id: String(g.id),
      type: 'group',
      label: g.name
    }));
    return [...userParticipantOptions, ...groupParticipantOptions].sort((a, b) => (a.label || '').localeCompare(b.label || '', 'ja'));
  }, [usersFromProps, groupsFromProps]);

  const taskOptions = useMemo((): TaskOption[] => {
    const editingTaskId = eventToEdit?.id?.startsWith('task-') ? eventToEdit.id.replace('task-','').toString() : null;
    return tasksFromProps
        .filter(task => String(task.id) !== editingTaskId)
        .map(t => ({ id: String(t.id), name: t.name || '(名称未設定)' })) || [];
  }, [tasksFromProps, eventToEdit]);

  const parseDateString = (dateStr: string | undefined): Date | null => {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts.map(Number);
      if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
        return new Date(year, month - 1, day);
      }
    }
    const parsed = parseISO(dateStr);
    return isDateValid(parsed) ? parsed : null;
  };

  const parseTimeString = (timeStr: string | undefined, baseDate: Date | null): Date | null => {
    if (!timeStr || !baseDate) return null;
    try {
        const [hours, minutes] = timeStr.split(':').map(Number);
        const date = new Date(baseDate);
        date.setHours(hours, minutes, 0, 0);
        return date;
    } catch (e) {
        console.error('Error parsing time string:', e);
        return null;
    }
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | any) => {
    const { name, value, type, checked } = event.target;
    let valueToSet: any = value;
    if (type === 'checkbox') {
      valueToSet = checked;
    }
    setFormData(prev => ({ ...prev, [name]: valueToSet }));
    if (errors[name as keyof typeof errors]) {
      setErrors(prev => ({ ...prev, [name]: undefined }));
    }
  };

  const handleDateChange = (name: keyof EventFormData, newValue: Date | null) => {
    setFormData(prev => ({
      ...prev,
      [name]: newValue && isDateValid(newValue) ? format(newValue, 'yyyy-MM-dd') : ''
    }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: undefined }));
    }
  };

  const handleTypeChange = (event: SelectChangeEvent<EventType>) => {
    const newType = event.target.value as EventType;
    setFormData(prev => ({
      ...getInitialState(),
      type: newType,
      title: prev.title,
      startDate: initialDate ? format(initialDate, 'yyyy-MM-dd') : '',
      endDate: initialDate ? format(initialDate, 'yyyy-MM-dd') : '',
      startTime: newType !== 'Task' ? '09:00' : '',
      endTime: newType !== 'Task' ? '10:00' : '',
      allDay: newType === 'Task',
      taskDueDate: newType === 'Task' ? (initialDate ? format(initialDate, 'yyyy-MM-dd') : '') : '',
      description: '',
      projectId: null,
      taskAssigneeId: null,
      taskCost: '',
      taskStatus: 'todo',
      taskDependsOn: [],
      location: '',
      displayStatus: 'online',
      priority: 'medium',
    }));
    setSelectedDependencies([]);
    setProjectSelectionMode('existing');
    setErrors({});
  };

  const handleProjectSelectionModeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setProjectSelectionMode(event.target.value as 'existing' | 'new');
    setErrors(prev => ({ ...prev, projectId: undefined, newProjectName: undefined }));
    if (event.target.value === 'new') {
      setFormData(prev => ({ ...prev, projectId: null }));
    } else {
      setFormData(prev => ({ ...prev, newProjectName: '', newProjectDescription: '', newProjectStartDate: '', newProjectEndDate: '' }));
    }
  };

  const handleTimeChange = (name: keyof EventFormData, newValue: Date | null) => {
    const baseDateStr = name === 'startTime' ? formData.startDate : formData.endDate;
    const baseDate = baseDateStr ? parseDateString(baseDateStr) : null;

    if (newValue && isDateValid(newValue) && baseDate && isDateValid(baseDate)) {
        const newTimeStr = format(newValue, 'HH:mm');
        setFormData(prev => ({ ...prev, [name]: newTimeStr }));
        if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: undefined }));
        }
    } else {
        setFormData(prev => ({ ...prev, [name]: '' }));
        setErrors(prev => ({ ...prev, [name]: '無効な時間です' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof EventFormData | 'newProjectName' | 'taskDueDate' | 'taskAssigneeId' | 'participants', string>> = {};
    if (!formData.type) newErrors.type = 'イベントタイプを選択してください';
    if (!formData.title.trim()) newErrors.title = 'タイトル/タスク名を入力してください';

    if (formData.type === 'task') {
        if (projectSelectionMode === 'existing' && !formData.projectId) { newErrors.projectId = '既存プロジェクトを選択してください'; }
        else if (projectSelectionMode === 'new') {
            if (!formData.newProjectName?.trim()) newErrors.newProjectName = '新規プロジェクト名を入力してください';
            if (!formData.newProjectStartDate) newErrors.newProjectStartDate = '開始日を入力してください';
            if (!formData.newProjectEndDate) newErrors.newProjectEndDate = '終了日を入力してください';
        }
        if (!formData.taskDueDate) newErrors.taskDueDate = '期日を入力してください';
        if (!formData.taskAssigneeId) newErrors.taskAssigneeId = '担当者を選択してください';
        if (formData.taskCost && isNaN(Number(formData.taskCost))) newErrors.taskCost = 'コストには数値を入力してください';
    } else if (formData.type) {
        if (!formData.startDate) newErrors.startDate = '期日を入力してください';
        if (!formData.allDay && !formData.startTime) newErrors.startTime = '開始時間を入力してください';
        if ((formData.type === 'Meeting' || formData.type === 'Workshop') && selectedParticipants.length === 0) {
            newErrors.participants = '参加者を選択してください';
        }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSaveClick = () => {
    if (validateForm()) {
      let dataToSave: any = {};

      dataToSave.title = formData.title;
      dataToSave.description = formData.description || '';

      // イベントタイプの正規化
      const typeMap: Record<string, string> = {
        'Task': 'Task',
        'Meeting': 'Meeting',
        'Deadline': 'Deadline',
        'Milestone': 'Milestone',
        'Workshop': 'Workshop',
        'Generic': 'Generic'
      };

      const normalizedType = typeMap[formData.type] || 'Generic';
      dataToSave.type = normalizedType;

      if (normalizedType === 'Task') {
        dataToSave.due_date = formData.taskDueDate;
        dataToSave.assigned_to = formData.taskAssigneeId ? parseInt(formData.taskAssigneeId, 10) : null;
        dataToSave.cost = formData.taskCost ? Number(formData.taskCost) : 0;
        dataToSave.status = formData.taskStatus || 'todo';
        dataToSave.priority = formData.priority || 'medium';
        dataToSave.dependsOn = selectedDependencies.map(dep => parseInt(dep.id, 10));
        dataToSave.display_status = formData.displayStatus || 'online';

        if (projectSelectionMode === 'existing') {
          dataToSave.project_id = formData.projectId ? parseInt(formData.projectId, 10) : undefined;
        } else {
          dataToSave.new_project = {
            name: formData.newProjectName,
            description: formData.newProjectDescription,
            start_date: formData.newProjectStartDate,
            end_date: formData.newProjectEndDate,
          };
          delete dataToSave.project_id;
        }
      } else if (normalizedType === 'Deadline' || normalizedType === 'Milestone') {
        const dueDate = parseDateString(formData.startDate);
        dataToSave.start_time = dueDate ? format(startOfDay(dueDate), "yyyy-MM-dd'T'HH:mm:ssxxx") : null;
        dataToSave.end_time = dueDate ? format(startOfDay(dueDate), "yyyy-MM-dd'T'HH:mm:ssxxx") : null;
        dataToSave.allDay = true;
        dataToSave.display_status = formData.displayStatus || 'online';
        if (formData.projectId) {
          dataToSave.project_id = parseInt(formData.projectId, 10);
        }
      } else {
        const startDate = parseDateString(formData.startDate);
        if (startDate) {
          dataToSave.start_time = format(startOfDay(startDate), "yyyy-MM-dd'T'HH:mm:ssxxx");
          dataToSave.end_time = format(startOfDay(startDate), "yyyy-MM-dd'T'HH:mm:ssxxx");
        }
        dataToSave.allDay = true;
        dataToSave.location = formData.location || '';
        dataToSave.display_status = formData.displayStatus || 'online';
        if (formData.projectId) {
          dataToSave.project_id = parseInt(formData.projectId, 10);
        }
      }

      if (eventToEdit && eventToEdit.id) {
        const parts = eventToEdit.id.split('-');
        const numericId = parts.length > 1 ? parts[parts.length - 1] : null;
        if (numericId && !isNaN(parseInt(numericId, 10))) {
          dataToSave.id = parseInt(numericId, 10);
        }
      }

      onSave(dataToSave);
    }
  };

  const showProjectForTimed = useMemo(() => {
    return formData.type !== 'Task' && formData.type !== 'Generic';
  }, [formData.type]);

  const showParticipants = useMemo(() => {
    return formData.type === 'Meeting' || formData.type === 'Workshop' || formData.type === 'Generic';
  }, [formData.type]);

  const showLocation = useMemo(() => {
    return formData.type === 'Meeting' || formData.type === 'Workshop' || formData.type === 'Generic';
  }, [formData.type]);

  const showTimeFields = useMemo(() => {
    return formData.type === 'Meeting' || formData.type === 'Workshop' || formData.type === 'Generic';
  }, [formData.type]);

  const showAllDayCheckbox = useMemo(() => {
    return formData.type === 'Meeting' || formData.type === 'Workshop' || formData.type === 'Generic';
  }, [formData.type]);

  const showEndDate = useMemo(() => {
    return formData.type === 'Generic';
  }, [formData.type]);

  // マイルストーン・締切の場合はallDayを強制的にtrueにする
  useEffect(() => {
    if (formData.type === 'Milestone' || formData.type === 'Deadline') {
      if (!formData.allDay) {
        setFormData(prev => ({ ...prev, allDay: true }));
      }
    }
  }, [formData.type]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{eventToEdit ? 'イベントを編集' : '新規イベント'}</DialogTitle>
      <DialogContent>
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <FormControl fullWidth error={!!errors.type}>
                <InputLabel>イベントタイプ</InputLabel>
                <Select
                  name="type"
                  value={formData.type}
                  onChange={handleTypeChange}
                  label="イベントタイプ"
                >
                  <MenuItem value="Generic">通常イベント</MenuItem>
                  <MenuItem value="Meeting">会議</MenuItem>
                  <MenuItem value="Deadline">締切</MenuItem>
                  <MenuItem value="Milestone">マイルストーン</MenuItem>
                  <MenuItem value="Workshop">ワークショップ</MenuItem>
                  <MenuItem value="Task">タスク</MenuItem>
                </Select>
                {errors.type && <FormHelperText>{errors.type}</FormHelperText>}
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField label={formData.type === 'task' ? "タスク名 *" : "タイトル *"} name="title" value={formData.title} onChange={handleChange} fullWidth required error={!!errors.title} helperText={errors.title} size="small" sx={{ mb: 1.5 }}/>
              
              {formData.type && (
                <TextField
                  label="説明"
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  fullWidth
                  multiline
                  rows={2}
                  size="small"
                  sx={{ mb: 1.5 }}
                />
              )}
              
              {formData.type === 'task' && (
                <>
                  <Divider sx={{ my: 1 }}><Typography variant="caption">プロジェクト情報</Typography></Divider>
                  <FormControl component="fieldset" sx={{ mb: 1 }}>
                    <RadioGroup row name="projectSelectionMode" value={projectSelectionMode} onChange={handleProjectSelectionModeChange}>
                      <FormControlLabel value="existing" control={<Radio size="small"/>} label="既存" sx={{ mr: 1 }}/>
                      <FormControlLabel value="new" control={<Radio size="small"/>} label="新規" />
                    </RadioGroup>
                  </FormControl>
                  {projectSelectionMode === 'existing' && (
                    <FormControl fullWidth required error={!!errors.projectId} size="small" sx={{ mb: 1.5 }}>
                      <InputLabel id="ex-proj-lbl">既存プロジェクト *</InputLabel>
                      <Select labelId="ex-proj-lbl" name="projectId" value={formData.projectId || ''} label="既存プロジェクト *" onChange={handleChange} size="small" disabled={projectsLoading}>
                        <MenuItem value="" disabled><em>{projectsLoading ? '読み込み中...' : '選択'}</em></MenuItem>
                        {projectOptions.map((p) => ( <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem> ))}
                      </Select>
                      {errors.projectId && <FormHelperText>{errors.projectId}</FormHelperText>}
                    </FormControl>
                  )}
                  {projectSelectionMode === 'new' && (
                    <Grid container spacing={1} sx={{pl: 1, mb: 1.5}}>
                      <Grid item xs={12}> <TextField label="新規プロジェクト名 *" name="newProjectName" value={formData.newProjectName} onChange={handleChange} fullWidth required size="small" error={!!errors.newProjectName} helperText={errors.newProjectName}/> </Grid>
                      <Grid item xs={12}> <TextField label="新規プロジェクト概要" name="newProjectDescription" value={formData.newProjectDescription} onChange={handleChange} fullWidth multiline rows={2} size="small"/> </Grid>
                      <Grid item xs={6}>
                        <DatePicker
                          label="プロジェクト開始日 *"
                          value={parseDateString(formData.newProjectStartDate)}
                          onChange={(newValue) => handleDateChange('newProjectStartDate', newValue)}
                          slotProps={{ textField: { fullWidth: true, size: 'small', required: true, error: !!errors.newProjectStartDate, helperText: errors.newProjectStartDate } }}
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <DatePicker
                          label="プロジェクト終了日 *"
                          value={parseDateString(formData.newProjectEndDate)}
                          onChange={(newValue) => handleDateChange('newProjectEndDate', newValue)}
                          slotProps={{ textField: { fullWidth: true, size: 'small', required: true, error: !!errors.newProjectEndDate, helperText: errors.newProjectEndDate } }}
                        />
                      </Grid>
                    </Grid>
                  )}
                </>
              )}
            </Grid>

            {formData.type?.toLowerCase() === 'task' && (
              <Grid item xs={12} container spacing={1.5}> 
                <Grid item xs={12}> 
                  <DatePicker
                    label="期限日 *"
                    value={parseDateString(formData.taskDueDate)}
                    onChange={(newValue) => handleDateChange('taskDueDate', newValue)}
                    slotProps={{ textField: { fullWidth: true, size: 'small', required: true, error: !!errors.taskDueDate, helperText: errors.taskDueDate } }}
                  />
                </Grid>
                <Grid item xs={12}>
                  <FormControl fullWidth error={!!errors.taskAssigneeId} size="small">
                    <InputLabel id="assignee-select-label">担当者 *</InputLabel>
                    <Select
                      labelId="assignee-select-label"
                      name="taskAssigneeId"
                      value={formData.taskAssigneeId || ''}
                      label="担当者 *"
                      onChange={handleChange}
                    >
                      <MenuItem value=""><em>未割り当て</em></MenuItem>
                      {userOptions.map((option) => (
                        <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>
                      ))}
                    </Select>
                    {errors.taskAssigneeId && <FormHelperText>{errors.taskAssigneeId}</FormHelperText>}
                  </FormControl>
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="コスト"
                    name="taskCost"
                    type="number"
                    value={formData.taskCost}
                    onChange={handleChange}
                    fullWidth
                    size="small"
                    error={!!errors.taskCost}
                    helperText={errors.taskCost}
                    inputProps={{ step: "0.1" }}
                  />
                </Grid>
                <Grid item xs={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="status-select-label">ステータス</InputLabel>
                    <Select
                      labelId="status-select-label"
                      name="taskStatus"
                      value={formData.taskStatus}
                      label="ステータス"
                      onChange={handleChange}
                    >
                      <MenuItem value="todo">未着手</MenuItem>
                      <MenuItem value="in-progress">進行中</MenuItem>
                      <MenuItem value="completed">完了</MenuItem>
                      <MenuItem value="pending">保留</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12}>
                  <Autocomplete
                    multiple
                    id="task-dependencies"
                    options={taskOptions}
                    getOptionLabel={(option) => option.name}
                    value={selectedDependencies}
                    onChange={(_, newValue) => {
                      setSelectedDependencies(newValue);
                      setFormData(prev => ({
                        ...prev,
                        taskDependsOn: newValue.map(dep => dep.id)
                      }));
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="依存タスク"
                        size="small"
                      />
                    )}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          label={option.name}
                          size="small"
                          {...getTagProps({ index })}
                        />
                      ))
                    }
                  />
                </Grid>
              </Grid>
            )}

            {showTimeFields && (
              <Grid item xs={12} container spacing={1.5}>
                <Grid item xs={12}>
                  <DatePicker
                    label="開始日 *"
                    value={parseDateString(formData.startDate)}
                    onChange={(newValue) => handleDateChange('startDate', newValue)}
                    slotProps={{ textField: { fullWidth: true, size: 'small', required: true, error: !!errors.startDate, helperText: errors.startDate } }}
                  />
                </Grid>
                {showEndDate && (
                  <Grid item xs={12}>
                    <DatePicker
                      label="終了日"
                      value={parseDateString(formData.endDate)}
                      onChange={(newValue) => handleDateChange('endDate', newValue)}
                      slotProps={{ textField: { fullWidth: true, size: 'small' } }}
                    />
                  </Grid>
                )}
                {!formData.allDay && (
                  <>
                    <Grid item xs={6}>
                      <TimePicker
                        label="開始時間 *"
                        value={parseTimeString(formData.startTime, parseDateString(formData.startDate))}
                        onChange={(newValue) => handleTimeChange('startTime', newValue)}
                        slotProps={{ textField: { fullWidth: true, size: 'small', required: true, error: !!errors.startTime, helperText: errors.startTime } }}
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <TimePicker
                        label="終了時間 *"
                        value={parseTimeString(formData.endTime, parseDateString(formData.endDate || formData.startDate))}
                        onChange={(newValue) => handleTimeChange('endTime', newValue)}
                        slotProps={{ textField: { fullWidth: true, size: 'small', required: true, error: !!errors.endTime, helperText: errors.endTime } }}
                      />
                    </Grid>
                  </>
                )}
                {showAllDayCheckbox && (
                  <Grid item xs={12}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={formData.allDay}
                          onChange={(e) => setFormData(prev => ({ ...prev, allDay: e.target.checked }))}
                          size="small"
                        />
                      }
                      label="終日"
                    />
                  </Grid>
                )}
              </Grid>
            )}

            {showLocation && (
              <Grid item xs={12}>
                <TextField
                  label="場所"
                  name="location"
                  value={formData.location}
                  onChange={handleChange}
                  fullWidth
                  size="small"
                  required={formData.type === 'Meeting' || formData.type === 'Workshop'}
                  error={!!errors.location}
                  helperText={errors.location}
                />
              </Grid>
            )}

            {showParticipants && (
              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  id="participants"
                  options={participantOptions}
                  getOptionLabel={(option) => option.label}
                  value={selectedParticipants}
                  onChange={(_, newValue) => {
                    setSelectedParticipants(newValue);
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="参加者"
                      size="small"
                      required={formData.type === 'Meeting' || formData.type === 'Workshop'}
                      error={!!errors.participants}
                      helperText={errors.participants}
                    />
                  )}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip
                        label={option.label}
                        size="small"
                        {...getTagProps({ index })}
                      />
                    ))
                  }
                />
              </Grid>
            )}

            {showProjectForTimed && (
              <Grid item xs={12}>
                <FormControl fullWidth required error={!!errors.projectId} size="small">
                  <InputLabel id="project-select-label">関連プロジェクト *</InputLabel>
                  <Select
                    labelId="project-select-label"
                    name="projectId"
                    value={formData.projectId || ''}
                    label="関連プロジェクト *"
                    onChange={handleChange}
                  >
                    <MenuItem value=""><em>選択</em></MenuItem>
                    {projectOptions.map((option) => (
                      <MenuItem key={option.id} value={option.id}>{option.name}</MenuItem>
                    ))}
                  </Select>
                  {errors.projectId && <FormHelperText>{errors.projectId}</FormHelperText>}
                </FormControl>
              </Grid>
            )}
          </Grid>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button onClick={handleSaveClick} variant="contained" color="primary">保存</Button>
      </DialogActions>
    </Dialog>
  );
};

export default EventAddModalMonthly; 