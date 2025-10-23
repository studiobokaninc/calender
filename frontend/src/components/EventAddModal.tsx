import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Select,
  MenuItem, FormControl, InputLabel, Checkbox, FormControlLabel, Box, Grid,
  FormHelperText, RadioGroup, Radio, Divider, Typography,
  Autocomplete, Chip, CircularProgress
} from '@mui/material';
import { format, parseISO, isValid as isDateValid, addDays, addHours, addMinutes, startOfDay, setHours, setMinutes, parse } from 'date-fns';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import ja from 'date-fns/locale/ja';
import { Project, User, Group, Participant, CalendarEvent, Task } from '../types';
import api from '../services/api';
import { EventInput, EventApi } from '@fullcalendar/core';
import { DateClickArg } from '@fullcalendar/interaction';

// --- Interfaces ---
type TimedEventType = 'Generic' | 'Meeting' | 'Deadline' | 'Milestone' | 'Workshop';

interface EventFormData {
  type: string;
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
}

interface ProjectOption { id: string; name: string; }
interface UserOption { id: string; name?: string; }
interface TaskOption { id: string; name: string; }

// --- Dummy Data ---
const dummyProjectList: ProjectOption[] = [
  { id: 'proj-1', name: '既存プロジェクト A' },
  { id: 'proj-2', name: '既存プロジェクト B' },
];
const dummyUserList: UserOption[] = [
  { id: 'user-1', name: '田中 太郎' },
  { id: 'user-2', name: '佐藤 花子' },
];

// --- Option type for Autocomplete ---
interface ParticipantOption {
  id: string;
  type: 'user' | 'group';
  label: string; // Display name
}

// --- Component Props ---
interface EventAddModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (eventData: any) => void;
  initialDate: Date | null;
  eventToEdit?: CalendarEvent | null;
  dateClickArg?: DateClickArg | null;
  projects: Project[];
  users: User[];
  tasks: Task[];
  groups: Group[];
}

// --- Component ---
const EventAddModal: React.FC<EventAddModalProps> = ({ open, onClose, onSave, initialDate, eventToEdit, dateClickArg, projects: projectsFromProps, users: usersFromProps, tasks: tasksFromProps, groups: groupsFromProps }) => {
  console.log("tasksFromProps on modal open (checking for ID 10 or name 'タスク 10'):", JSON.stringify(tasksFromProps.filter(t => String(t.id) === "10" || t.name === "タスク 10"), null, 2));
  const getInitialState = (): EventFormData => {
    let initialStartDateTime = new Date();
    let initialEndDateTime = addHours(initialStartDateTime, 2);
    let initialAllDay = false; // 初期値として設定、後にタイプによって上書きされる可能性あり
    const defaultStartTime = 9;
    const defaultEndTime = 11;
    let initialType = 'Task'; // ★ デフォルトを 'Task' に変更

    if (dateClickArg) {
      initialStartDateTime = dateClickArg.date;
      const viewType = dateClickArg.view ? dateClickArg.view.type : null;

      if (viewType === 'dayGridMonth') { // 月表示からのクリック
        initialStartDateTime = setMinutes(setHours(startOfDay(initialStartDateTime), defaultStartTime), 0);
        initialEndDateTime = setMinutes(setHours(startOfDay(initialStartDateTime), defaultEndTime), 0);
        initialType = 'Task'; // 月表示クリック時はタスクをデフォルトに
        initialAllDay = true; // タスクなので終日
      } else if (viewType) { // 週・日表示からのクリック
        initialEndDateTime = addHours(initialStartDateTime, 2);
        initialType = 'Meeting'; // 週・日表示クリック時は会議をデフォルトに
        initialAllDay = false; // 会議なので終日ではない
      } else { // viewType がない場合 (dateClickArg のみ存在)
        // initialType は 'Task' のまま
        initialStartDateTime = setMinutes(setHours(startOfDay(initialStartDateTime), defaultStartTime), 0);
        initialEndDateTime = setMinutes(setHours(startOfDay(initialStartDateTime), defaultEndTime), 0);
        initialAllDay = true; // デフォルトのTaskに合わせて終日
      }
    } else if (initialDate) { // カレンダー外からの呼び出し（例：＋ボタン、initialTypeは'Task'のまま)
      initialStartDateTime = setMinutes(setHours(startOfDay(initialDate), defaultStartTime), 0);
      initialEndDateTime = setMinutes(setHours(startOfDay(initialDate), defaultEndTime), 0);
      initialAllDay = true; // デフォルトのTaskに合わせて終日
    } else {
      // initialDate も dateClickArg もない場合 (モーダルを直接開くなど、レアケース)
      // initialType は 'Task' のまま
      initialStartDateTime = setMinutes(setHours(startOfDay(new Date()), defaultStartTime), 0);
      initialEndDateTime = setMinutes(setHours(startOfDay(new Date()), defaultEndTime), 0);
      initialAllDay = true; // デフォルトのTaskに合わせて終日
    }

    const isTaskType = initialType === 'Task';

    return {
      type: initialType,
    title: '',
    description: '',
      startDate: isTaskType ? undefined : format(initialStartDateTime, 'yyyy-MM-dd'),
      endDate: isTaskType ? undefined : format(initialEndDateTime, 'yyyy-MM-dd'),
      startTime: isTaskType ? undefined : format(initialStartDateTime, 'HH:mm'),
      endTime: isTaskType ? undefined : format(initialEndDateTime, 'HH:mm'),
      allDay: isTaskType ? true : initialAllDay, 
    projectId: null,
    newProjectName: '',
    newProjectDescription: '',
      newProjectStartDate: '',
      newProjectEndDate: '',
    newProjectColor: '#4CAF50',
      taskDueDate: isTaskType ? format(initialStartDateTime, 'yyyy-MM-dd') : undefined,
    taskAssigneeId: null,
    taskCost: '',
    taskStatus: 'todo',
      taskDependsOn: [],
    location: '',
      dueDate: format(initialStartDateTime, 'yyyy-MM-dd'),
    };
  };

  const [formData, setFormData] = useState<EventFormData>(getInitialState());
  const [projectSelectionMode, setProjectSelectionMode] = useState<'existing' | 'new'>('existing');
  const [errors, setErrors] = useState<Partial<Record<keyof EventFormData | 'newProjectName' | 'taskDueDate' | 'taskAssigneeId', string>>>({});
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState<ParticipantOption[]>([]);
  const [selectedDependencies, setSelectedDependencies] = useState<TaskOption[]>([]);

  useEffect(() => {
    if (open) {
      setProjectsLoading(false);
          setParticipantsLoading(false);
    }
  }, [open]);

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
      type: 'user' as const,
      label: u.username || u.name || u.email || `User ${u.id}`
    }));
    const groupParticipantOptions: ParticipantOption[] = groupsFromProps.map(g => ({
      id: String(g.id),
      type: 'group' as const,
      label: g.name || `Group ${g.id}`
    }));
    return [...userParticipantOptions, ...groupParticipantOptions].sort((a, b) => (a.label || '').localeCompare(b.label || '', 'ja'));
  }, [usersFromProps, groupsFromProps]);

  const taskOptions = useMemo((): TaskOption[] => {
    const editingTaskId = eventToEdit?.id?.startsWith('task-') ? eventToEdit.id.replace('task-','').toString() : null;

    let tasksForCurrentProject: Task[] = [];

    if (projectSelectionMode === 'existing' && formData.projectId) {
      tasksForCurrentProject = tasksFromProps.filter(
        task => String(task.project_id) === String(formData.projectId)
      );
    } else if (projectSelectionMode === 'new') {
      tasksForCurrentProject = [];
    } else {
      tasksForCurrentProject = [];
    }
    
    const filteredTasks = tasksForCurrentProject
        .filter(task => String(task.id) !== editingTaskId)
        .map(t => ({ id: String(t.id), name: t.name || '(名称未設定)' }));
    
    const uniqueTasks: TaskOption[] = [];
    const seenIds = new Set<string>();
    for (const task of filteredTasks) {
        if (!seenIds.has(task.id)) {
            uniqueTasks.push(task);
            seenIds.add(task.id);
        }
    }
    return uniqueTasks;
  }, [tasksFromProps, eventToEdit, formData.projectId, projectSelectionMode]);

  useEffect(() => {
    if (open) {
      if (eventToEdit) {
        const eventTypeFromEditRaw = eventToEdit.extendedProps?.type;
        const eventTypeFromEdit = (eventTypeFromEditRaw === 'Task' || eventTypeFromEditRaw === 'task') ? 'task' : (eventTypeFromEditRaw === 'Project' || eventTypeFromEditRaw === 'project') ? 'project' : (eventTypeFromEditRaw || 'Generic');
        const isTask = eventTypeFromEdit === 'task';
        const isProject = eventTypeFromEdit === 'project';

        let calculatedStartDateStr: string | undefined = undefined;
        let taskDueDateStr: string | undefined = undefined;

        if (isTask) {
          const dueDateFromProps = eventToEdit.extendedProps?.taskDueDate || (eventToEdit as any).due_date;
          const cost = eventToEdit.extendedProps?.taskCost ? Number(eventToEdit.extendedProps.taskCost) : 0;
          
          if (dueDateFromProps) {
            const dueDateObj = parseISO(dueDateFromProps);
            if (isDateValid(dueDateObj)) {
              taskDueDateStr = format(dueDateObj, 'yyyy-MM-dd');
              const days = Math.ceil(cost / 8);
              const startDateObj = addDays(dueDateObj, -days);
              calculatedStartDateStr = format(startDateObj, 'yyyy-MM-dd');
            }
          }
        } else if (isProject && eventToEdit.extendedProps?.projectStartDate) {
          // プロジェクトの場合は、extendedPropsから元の開始日を取得
          const projectStartDateObj = parseISO(eventToEdit.extendedProps.projectStartDate);
          if (isDateValid(projectStartDateObj)) {
            calculatedStartDateStr = format(projectStartDateObj, 'yyyy-MM-dd');
          }
        } else if (eventToEdit.start) {
          const startObjTmp = (eventToEdit.start instanceof Date) ? eventToEdit.start : parseISO(eventToEdit.start as string);
          if (isDateValid(startObjTmp)) {
            calculatedStartDateStr = format(startObjTmp, 'yyyy-MM-dd');
          }
        }

        const startObjForForm = eventToEdit.start ? ((eventToEdit.start instanceof Date) ? eventToEdit.start : parseISO(eventToEdit.start as string)) : undefined;
        const endObjForForm = eventToEdit.end ? ((eventToEdit.end instanceof Date) ? eventToEdit.end : parseISO(eventToEdit.end as string)) : undefined;

        // プロジェクトの場合は、extendedPropsから元の終了日を取得（FullCalendar用に+1日されていない）
        let endDateStr: string | undefined = undefined;
        if (isProject && eventToEdit.extendedProps?.projectEndDate) {
          const projectEndDateObj = parseISO(eventToEdit.extendedProps.projectEndDate);
          if (isDateValid(projectEndDateObj)) {
            endDateStr = format(projectEndDateObj, 'yyyy-MM-dd');
          }
        } else if (!isTask && endObjForForm && isDateValid(endObjForForm)) {
          // 終日イベントの場合、FullCalendarの排他的終了日から-1日して元の終了日に戻す
          if (eventToEdit.allDay) {
            endDateStr = format(addDays(endObjForForm, -1), 'yyyy-MM-dd');
          } else {
            endDateStr = format(endObjForForm, 'yyyy-MM-dd');
          }
        }

        setFormData({
          type: eventTypeFromEdit,
          title: eventToEdit.title || '',
          description: isProject ? (eventToEdit.extendedProps?.projectDescription || eventToEdit.extendedProps?.description || '') : (eventToEdit.extendedProps?.description || ''),
          startDate: calculatedStartDateStr,
          endDate: endDateStr,
          startTime: (isTask || isProject || !startObjForForm || !isDateValid(startObjForForm) || eventToEdit.allDay) ? undefined : format(startObjForForm, 'HH:mm'),
          endTime: (isTask || isProject || !endObjForForm || !isDateValid(endObjForForm) || eventToEdit.allDay) ? undefined : format(endObjForForm, 'HH:mm'),
          allDay: (isTask || isProject) ? true : (eventToEdit.allDay ?? false),
          projectId: eventToEdit.extendedProps?.projectId?.toString() || null,
          taskDueDate: taskDueDateStr, // Use the parsed and formatted due date string for tasks
          taskAssigneeId: eventToEdit.extendedProps?.taskAssigneeId?.toString() || null,
          taskCost: eventToEdit.extendedProps?.taskCost || '',
          taskStatus: isProject ? (eventToEdit.extendedProps?.projectStatus || 'planning') : (eventToEdit.extendedProps?.taskStatus || 'todo'),
          location: eventToEdit.extendedProps?.location || '',
          newProjectName: '',
          newProjectDescription: '',
          newProjectStartDate: '',
          newProjectEndDate: '',
          newProjectColor: '#4CAF50',
          dueDate: '', // This appears to be legacy or for other types, taskDueDate is primary for tasks
          taskDependsOn: eventToEdit.extendedProps?.dependsOn || [],
        } as EventFormData);

        setSelectedParticipants([]); // Reset participants for now, assuming they are not part of eventToEdit for tasks directly
        setSelectedDependencies([]);

        setProjectSelectionMode(eventToEdit.extendedProps?.projectId ? 'existing' : 'existing');
        setErrors({});

        const initialDeps = (eventToEdit.extendedProps?.dependsOn || []) as string[];
        const initialSelectedOptions = taskOptions.filter(opt => initialDeps.includes(opt.id));
        setSelectedDependencies(initialSelectedOptions);

      } else {
        setFormData(getInitialState());
        setSelectedParticipants([]);
        setSelectedDependencies([]);
        setProjectSelectionMode('existing');
        setErrors({});
      }
    }
  }, [open, initialDate, eventToEdit, dateClickArg]);

  useEffect(() => {
    if (formData.type === 'Task' || formData.type === 'task') {
      const validSelectedDependencies = selectedDependencies.filter(dep =>
        taskOptions.some(opt => opt.id === dep.id)
      );
      if (validSelectedDependencies.length !== selectedDependencies.length) {
        setSelectedDependencies(validSelectedDependencies);
      }
    }
  }, [taskOptions, selectedDependencies, formData.type]);

  const parseDateString = (dateStr: string | undefined): Date | null => {
      if (!dateStr) return null;
      try {
          // まずyyyy-MM-ddでパース
          let parsed = parse(dateStr, 'yyyy-MM-dd', new Date());
          if (isDateValid(parsed)) return parsed;

          // ISO 8601形式 (例: 2023-10-27T10:00:00.000Z) も試す
          parsed = parseISO(dateStr);
          if (isDateValid(parsed)) return parsed;

          // 他の一般的な形式も試す (必要に応じて追加)
          // ...

          return null; // いずれの形式にも一致しない場合
      } catch (e) {
          return null; // パース中にエラーが発生した場合
      }
  };


  const parseTimeString = (timeStr: string | undefined, baseDate: Date | null): Date | null => {
      if (!timeStr || !baseDate || !isDateValid(baseDate)) return null;
      try {
          const [hours, minutes] = timeStr.split(':').map(Number);
          if (isNaN(hours) || isNaN(minutes)) return null;
          // baseDateはJSTのDateオブジェクトなので、そのままsetHours/setMinutes
          const dateWithHours = new Date(baseDate);
          dateWithHours.setHours(hours, minutes, 0, 0); // 秒とミリ秒を0に設定
          return isDateValid(dateWithHours) ? dateWithHours : null;
      } catch (e) {
          return null;
      }
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | any) => {
    const { name, value, type, checked } = event.target;
    let valueToSet: any = value;
    if (type === 'checkbox') {
        valueToSet = checked;
    }
    
    // コストが変更された場合、開始日を再計算
    if (name === 'taskCost' && formData.type === 'task' && formData.taskDueDate) {
      const cost = value ? Number(value) : 0;
      const days = Math.ceil(cost / 8); // 1日8時間として計算
      const dueDate = parseDateString(formData.taskDueDate);
      if (dueDate) {
        const startDate = addDays(dueDate, -days);
        setFormData(prev => ({
          ...prev,
          [name]: valueToSet,
          startDate: format(startDate, 'yyyy-MM-dd') // タスクの開始日も更新
        }));
      } else {
    setFormData(prev => ({ ...prev, [name]: valueToSet }));
      }
    } else {
      setFormData(prev => ({ ...prev, [name]: valueToSet }));
    }
    
    if (errors[name as keyof typeof errors]) {
        setErrors(prev => ({ ...prev, [name]: undefined }));
    }
  };

  const handleDateChange = (name: keyof EventFormData, newValue: Date | null) => {
    if (name === 'taskDueDate' && newValue && isDateValid(newValue) && formData.type === 'task') {
      const newDueDateStr = format(newValue, 'yyyy-MM-dd');
      const cost = formData.taskCost ? Number(formData.taskCost) : 0;
      const days = Math.ceil(cost / 8);
      const startDate = addDays(newValue, -days);

      setFormData(prev => ({
        ...prev,
        taskDueDate: newDueDateStr,
        startDate: format(startDate, 'yyyy-MM-dd') // タスクの開始日も更新
      }));
    } else {
    setFormData(prev => ({
      ...prev,
      [name]: newValue && isDateValid(newValue) ? format(newValue, 'yyyy-MM-dd') : ''
    }));
    }
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: undefined }));
    }
  };


  const handleTimeChange = (name: keyof EventFormData, newValue: Date | null) => {
    const baseDateStr = name === 'startTime' ? formData.startDate : formData.endDate;
    const baseDate = baseDateStr ? parseDateString(baseDateStr) : null;

    if (newValue && isDateValid(newValue) && baseDate && isDateValid(baseDate)) {
        const newTimeStr = format(newValue, 'HH:mm');
        setFormData(prev => ({ ...prev, [name]: newTimeStr }));
        // 開始時刻が変更された場合、終了時刻も自動調整（例：1時間後）
        if (name === 'startTime' && !formData.endTime) {
          const newEndTime = addHours(newValue, 1);
          setFormData(prev => ({ ...prev, endTime: format(newEndTime, 'HH:mm') }));
        }
         if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: undefined }));
        }
    } else {
        // 無効な時刻またはベース日付がない場合はクリア
        setFormData(prev => ({ ...prev, [name]: '' }));
        setErrors(prev => ({ ...prev, [name]: '無効な時間です' }));
    }
  };


  const handleTypeChange = (event: any) => {
    const newType = event.target.value as string;
  
    setFormData((prev) => {
      // まずは現在の入力をすべて保持
      const next: EventFormData = { ...prev, type: newType };
  
      // 型ごとに「必要な差分だけ」上書きする
      if (newType === 'Task' || newType === 'task') {
        // タスクは終日・時間不要。start/end は保存時に計算するのでクリア。
        next.allDay = true;
        next.startTime = undefined;
        next.endTime = undefined;
  
        // 期日は可能なら既存値を優先。未設定なら既存の開始/終了日から推測、
        // それも無ければ空（= バリデーションで促す）。※今日にはしない
        if (!prev.taskDueDate) {
          next.taskDueDate = prev.endDate || prev.startDate || '';
        }
  
        next.startDate = undefined;
        next.endDate = undefined;
  
      } else if (newType === 'Project' || newType === 'project') {
        // プロジェクトは終日・時間不要。開始日と終了日が必要。
        next.allDay = true;
        next.startTime = undefined;
        next.endTime = undefined;
  
        // 開始日・終了日は既存値を優先
        next.startDate = prev.startDate || prev.taskDueDate || '';
        next.endDate = prev.endDate || '';
  
      } else if (newType === 'Deadline' || newType === 'Milestone') {
        // これらは終日・時間不要。必要なのは期日に相当する startDate。
        next.allDay = true;
        next.startTime = undefined;
        next.endTime = undefined;
  
        // 既存の startDate を優先。無ければ taskDueDate → endDate の順に利用。
        next.startDate = prev.startDate || prev.taskDueDate || prev.endDate || '';
        next.endDate = undefined;
  
      } else if (newType === 'Meeting' || newType === 'Workshop') {
        // 会議/WSは基本的に時間あり（終日OFF固定）。
        next.allDay = false;
  
        // 日付は既存値を尊重。無ければ taskDueDate を流用、無ければ空。
        next.startDate = prev.startDate || prev.taskDueDate || '';
        next.endDate   = prev.endDate   || next.startDate || '';
  
        // 時刻は既存値を優先、なければ軽いデフォルト（今日には依存しない）
        next.startTime = prev.startTime || '09:00';
        next.endTime   = prev.endTime   || '10:00';
  
      } else { // Generic
        // Generic は終日ON/OFFをユーザーに委ねる（既存をそのまま）
        next.startDate = prev.startDate || prev.taskDueDate || '';
        next.endDate   = prev.endDate   || (prev.allDay ? '' : prev.startDate) || '';
  
        if (prev.allDay) {
          next.startTime = '';
          next.endTime   = '';
        } else {
          next.startTime = prev.startTime || '09:00';
          next.endTime   = prev.endTime   || '10:00';
        }
      }
  
      return next;
    });

    // タイプ変更時は常に依存関係をリセットし、プロジェクト選択を既存に戻す
    setSelectedDependencies([]);
    setProjectSelectionMode('existing');
    setErrors({});
  };

  const handleProjectSelectionModeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newMode = event.target.value as 'existing' | 'new';
    setProjectSelectionMode(newMode);
    setErrors(prev => ({ ...prev, projectId: undefined, newProjectName: undefined }));
    if (newMode === 'new') {
        setFormData(prev => ({ ...prev, projectId: null }));
        setSelectedDependencies([]); 
    } else {
      setFormData(prev => ({ ...prev, newProjectName: '', newProjectDescription: '', newProjectStartDate: '', newProjectEndDate: '' }));
      // 既存プロジェクト選択モードに変わったとき、選択されていたプロジェクトIDに基づいて依存タスクを再評価するため、
      // ここではクリアせず、上記の useEffect(() => { ... }, [taskOptions, ...]) に任せる。
      // もしプロジェクトIDが未選択なら、taskOptions が空になり、結果的に selectedDependencies も空になる。
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof EventFormData | 'newProjectName' | 'taskDueDate' | 'taskAssigneeId', string>> = {};
    if (!formData.type) newErrors.type = 'イベントタイプを選択してください';
    if (!formData.title.trim()) newErrors.title = 'タイトル/タスク名を入力してください';

    if (formData.type === 'task' || formData.type === 'Task') {
      if (projectSelectionMode === 'existing' && !formData.projectId) {
        newErrors.projectId = '既存プロジェクトを選択してください';
      } else if (projectSelectionMode === 'new') {
          if (!formData.newProjectName?.trim()) newErrors.newProjectName = '新規プロジェクト名を入力してください';
          if (!formData.newProjectStartDate) newErrors.newProjectStartDate = '開始日を入力してください';
          if (!formData.newProjectEndDate) newErrors.newProjectEndDate = '終了日を入力してください';
          // TODO: 新規プロジェクトの日付検証 (開始日 <= 終了日)
      }
      if (!formData.taskDueDate) newErrors.taskDueDate = '期日を入力してください';
      // if (!formData.taskAssigneeId) newErrors.taskAssigneeId = '担当者を選択してください'; // 必須ではなくなった
      if (formData.taskCost && isNaN(Number(formData.taskCost))) newErrors.taskCost = 'コストには数値を入力してください';

    } else if (formData.type === 'project' || formData.type === 'Project') {
      // プロジェクトタイプの検証
      if (!formData.startDate) newErrors.startDate = '開始日を入力してください';
      if (!formData.endDate) newErrors.endDate = '終了日を入力してください';
      // 日付の順序検証
      if (formData.startDate && formData.endDate && formData.startDate > formData.endDate) {
        newErrors.endDate = '終了日は開始日より後に設定してください';
      }
    } else if (formData.type) { // Generic, Meeting, Workshop, Deadline, Milestone
        if (!formData.startDate) {
            newErrors.startDate = (formData.type === 'Deadline' || formData.type === 'Milestone') ? '期日を入力してください' : '開始日を入力してください';
        }
        if (!formData.allDay) {
            if (!formData.startTime) newErrors.startTime = '開始時間を入力してください';
            if ((formData.type === 'Generic' || formData.type === 'Meeting' || formData.type === 'Workshop') && !formData.endDate) {
                newErrors.endDate = '終了日を入力してください';
        }
            if ((formData.type === 'Generic' || formData.type === 'Meeting' || formData.type === 'Workshop') && !formData.endTime) {
                newErrors.endTime = '終了時間を入力してください';
            }
            // 時間の順序検証 (開始時刻 < 終了時刻)
            if (formData.startDate && formData.endDate && formData.startTime && formData.endTime &&
                `${formData.startDate} ${formData.startTime}` >= `${formData.endDate} ${formData.endTime}`) {
                newErrors.endTime = '終了時刻は開始時刻より後に設定してください';
            }
        }
        // プロジェクト選択が必要なタイプ
        if (["Meeting", "Workshop", "Deadline", "Milestone"].includes(formData.type) && !formData.projectId) {
            newErrors.projectId = '関連プロジェクトを選択してください';
        }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSaveClick = () => {
    console.log("handleSaveClick: validateFormを呼び出す直前");
    console.log("Saving task with dependencies. Selected Dependencies:", JSON.stringify(selectedDependencies, null, 2));

    if (validateForm()) {
      console.log("handleSaveClick: validateForm成功後");
      let dataToSave: any = {
        title: formData.title,
        description: formData.description || '',
      };

      const typeMap: Record<string, string> = {
        task: 'Task',
        Task: 'Task',
        project: 'Project',
        Project: 'Project',
        meeting: 'Meeting',
        Meeting: 'Meeting',
        deadline: 'Deadline',
        Deadline: 'Deadline',
        milestone: 'Milestone',
        Milestone: 'Milestone',
        workshop: 'Workshop',
        Workshop: 'Workshop',
        generic: 'Generic',
        Generic: 'Generic',
      };
      const normalizedType = typeMap[formData.type] || 'Generic';
      dataToSave.type = normalizedType;


      if (normalizedType === 'Project') {
        // プロジェクトの場合
        if (formData.startDate) {
          const startDateObj = parseDateString(formData.startDate);
          if (startDateObj && isDateValid(startDateObj)) {
            dataToSave.start_time = format(startOfDay(startDateObj), "yyyy-MM-dd'T'HH:mm:ssxxx");
            dataToSave.projectStartDate = format(startDateObj, 'yyyy-MM-dd');
          }
        }
        if (formData.endDate) {
          const endDateObj = parseDateString(formData.endDate);
          if (endDateObj && isDateValid(endDateObj)) {
            dataToSave.end_time = format(startOfDay(addDays(endDateObj, 1)), "yyyy-MM-dd'T'HH:mm:ssxxx");
            dataToSave.projectEndDate = format(endDateObj, 'yyyy-MM-dd');
          }
        }
        dataToSave.allDay = true;
        dataToSave.projectDescription = formData.description || '';
        dataToSave.projectStatus = formData.taskStatus || 'planning'; // プロジェクトのステータス
        dataToSave.status = formData.taskStatus || 'planning'; // APIに送信するステータス
      } else if (normalizedType === 'Task') {
        if (formData.startDate) { // Check if calculated startDate exists
            const startDateObj = parseDateString(formData.startDate);
            if (startDateObj && isDateValid(startDateObj)) {
                dataToSave.start_time = format(startOfDay(startDateObj), "yyyy-MM-dd'T'HH:mm:ssxxx");
            }
        } else if (formData.taskDueDate) { // Fallback if startDate is not calculated for some reason, calculate from dueDate
            const dueDateObj = parseDateString(formData.taskDueDate);
            if (dueDateObj && isDateValid(dueDateObj)) {
                const cost = formData.taskCost ? Number(formData.taskCost) : 0;
                const days = Math.ceil(cost / 8);
                const startDateObjFallback = addDays(dueDateObj, -days);
                dataToSave.start_time = format(startOfDay(startDateObjFallback), "yyyy-MM-dd'T'HH:mm:ssxxx");
            }
        }

        // Set end_time for tasks based on taskDueDate (期日の翌日の開始時刻)
        if (formData.taskDueDate) {
            const dueDateObj = parseDateString(formData.taskDueDate);
            if (dueDateObj && isDateValid(dueDateObj)) {
                dataToSave.end_time = format(startOfDay(addDays(dueDateObj, 1)), "yyyy-MM-dd'T'HH:mm:ssxxx");
                // ★ due_date は日付文字列 'yyyy-MM-dd' で送信
                dataToSave.due_date = format(dueDateObj, 'yyyy-MM-dd'); 
            }
        }
        dataToSave.allDay = true; // Tasks are always all-day

        dataToSave.assigned_to = formData.taskAssigneeId ? parseInt(formData.taskAssigneeId.split('-')[1], 10) : null; // `user-1` or `group-1`
        dataToSave.assignee_type = formData.taskAssigneeId ? formData.taskAssigneeId.split('-')[0] : null;
          dataToSave.cost = formData.taskCost ? Number(formData.taskCost) : 0;
          dataToSave.status = formData.taskStatus || 'todo';
        dataToSave.dependsOn = selectedDependencies.map(dep => dep.id);
        console.log("Formatted dependsOn to save:", JSON.stringify(dataToSave.dependsOn, null, 2));

        if (projectSelectionMode === 'existing' && formData.projectId) {
            dataToSave.project_id = parseInt(formData.projectId, 10);
        } else if (projectSelectionMode === 'new') {
              dataToSave.new_project = {
                        name: formData.newProjectName,
                        description: formData.newProjectDescription,
                  start_date: formData.newProjectStartDate,
                  end_date: formData.newProjectEndDate,
                // color: formData.newProjectColor,
            };
        }
        // ★新しいログ出力 START (既存ログの前に挿入)
        console.log("[EventAddModal:handleSaveClick] BEFORE ONSAVE - TASK data:", JSON.stringify({
          type: dataToSave.type,
          title: dataToSave.title,
          start_time: dataToSave.start_time, 
          due_date: dataToSave.due_date, 
          end_time: dataToSave.end_time, 
          cost: dataToSave.cost,
          allDay: dataToSave.allDay,
          project_id: dataToSave.project_id,
          assigned_to: dataToSave.assigned_to,
          assignee_type: dataToSave.assignee_type,
          status: dataToSave.status,
          dependsOn: dataToSave.dependsOn,
          new_project: dataToSave.new_project
        }, null, 2));
        // ★新しいログ出力 END
        // onSave(dataToSave); // この行をコメントアウトまたは削除
      } else { // Other event types
        dataToSave.allDay = formData.allDay;
          if (formData.startDate) {
          const startDateObj = parseDateString(formData.startDate);
          if (startDateObj) {
            if (formData.allDay || normalizedType === 'Deadline' || normalizedType === 'Milestone') {
              // 締切・マイルストーンの場合は、日付をそのまま使用（タイムゾーン問題を回避）
              const dateStr = format(startDateObj, 'yyyy-MM-dd');
              dataToSave.start_time = `${dateStr}T00:00:00+09:00`;
              dataToSave.end_time = `${dateStr}T00:00:00+09:00`;
              } else if (formData.startTime) {
              const startDateTime = parseTimeString(formData.startTime, startDateObj);
              if (startDateTime) dataToSave.start_time = format(startDateTime, "yyyy-MM-dd'T'HH:mm:ssxxx");
            }
          }
        }

        if (!formData.allDay && (normalizedType === 'Generic' || normalizedType === 'Meeting' || normalizedType === 'Workshop')) {
          const endDateForCalc = formData.endDate || formData.startDate;
          const endDateObj = parseDateString(endDateForCalc);
          if (endDateObj && formData.endTime) {
            const endDateTime = parseTimeString(formData.endTime, endDateObj);
            if (endDateTime) dataToSave.end_time = format(endDateTime, "yyyy-MM-dd'T'HH:mm:ssxxx");
          } else if (endDateObj && !formData.endTime && dataToSave.start_time) {
            dataToSave.end_time = format(addHours(parseISO(dataToSave.start_time), 1), "yyyy-MM-dd'T'HH:mm:ssxxx");
          }
        } else if (formData.allDay && (normalizedType === 'Generic' || normalizedType === 'Meeting' || normalizedType === 'Workshop')) {
            if(dataToSave.start_time) {
                 const startDateForEnd = parseISO(dataToSave.start_time);
                 const endDateForEnd = formData.endDate ? parseDateString(formData.endDate) : startDateForEnd;
                 if(endDateForEnd){
                    dataToSave.end_time = format(startOfDay(addDays(endDateForEnd, 1)), "yyyy-MM-dd'T'HH:mm:ssxxx");
                 }
            }
        }


          dataToSave.location = formData.location || '';
        if (["Meeting", "Workshop", "Deadline", "Milestone"].includes(normalizedType) && formData.projectId) {
               dataToSave.project_id = parseInt(formData.projectId, 10);
           }
        if (normalizedType === 'Meeting' || normalizedType === 'Workshop' || normalizedType === 'Generic' ) {
           dataToSave.participants = selectedParticipants.map(p => ({
             type: p.type,
             id: p.type === 'user' ? parseInt(p.id, 10) : p.id 
           }));
        }
      }

      if (eventToEdit && eventToEdit.id) {
          const parts = eventToEdit.id.split('-');
          const numericId = parts.length > 1 ? parts[parts.length - 1] : null;
          if (numericId && !isNaN(parseInt(numericId, 10))) {
            dataToSave.id = parseInt(numericId, 10);
          } else {
            console.warn("Could not parse numeric ID from eventToEdit.id:", eventToEdit.id);
          }
      }
      onSave(dataToSave);
    } else {
        console.log("Validation failed. Errors:", JSON.stringify(errors, null, 2));
    }
  };

  // --- UI 表示制御ロジック ---
  const showProjectSelection = useMemo(() => {
    if (!formData?.type) return false;
    // タスク、会議、ワークショップ、締切、マイルストーンで表示（プロジェクトは除外）
    return ['task', 'Task', 'Meeting', 'Workshop', 'Deadline', 'Milestone'].includes(formData.type);
  }, [formData?.type]);

  const showParticipants = useMemo(() => {
    if (!formData?.type) return false;
    return ['Meeting', 'Workshop', 'Generic'].includes(formData.type);
  }, [formData?.type]);

  const showLocation = useMemo(() => {
    if (!formData?.type) return false;
    return ['Meeting', 'Workshop', 'Generic'].includes(formData.type);
  }, [formData?.type]);

  const showAllDayCheckbox = useMemo(() => {
    if (!formData?.type) return false;
    if (['task', 'Task', 'Deadline', 'Milestone', 'Meeting', 'Workshop'].includes(formData.type)) return false;
    return true; // Generic のみ表示
  }, [formData?.type]);

  const showTimeFields = useMemo(() => {
    if (!formData?.type || formData.allDay) return false;
    // タスク、締切、マイルストーンでは非表示
    if (['task', 'Task', 'Deadline', 'Milestone'].includes(formData.type)) return false;
    return true; // Generic, Meeting, Workshop で表示 (かつ終日でない場合)
  }, [formData?.type, formData.allDay]);

  const showEndDate = useMemo(() => {
    if (!formData?.type) return false;
    // タスク、締切、マイルストーンでは非表示
    if (['task', 'Task', 'Deadline', 'Milestone'].includes(formData.type)) return false;
    return true; // Generic, Meeting, Workshop で表示
  }, [formData?.type]);

  // 担当者オプション (ユーザー + グループ)
  const assigneeOptions = useMemo((): Array<{ id: string; label: string; type: string; }> => {
    const users = usersFromProps.map(u => ({ id: `user-${u.id}`, label: u.username || u.name || u.email || `User ${u.id}`, type: 'user' as const }));
    return users.sort((a: {label: string}, b: {label: string}) => a.label.localeCompare(b.label));
  }, [usersFromProps]);


  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: '1.1rem', pb: 1 }}>{eventToEdit ? 'イベント編集' : 'イベント追加'}</DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ja}>
          <Grid container spacing={1.5}>
          <Grid item xs={12}>
              {/* Event Type */}
              <FormControl fullWidth required error={!!errors.type} size="small" sx={{ mb: 1.5 }}>
                 <InputLabel id="event-type-label">タイプ *</InputLabel>
                 <Select
                   labelId="event-type-label"
                   name="type"
                   value={formData.type}
                   label="タイプ *"
                   onChange={handleTypeChange}
                   size="small"
                   disabled={!!eventToEdit} // 編集時はタイプ変更不可
                >
                   <MenuItem value="Task">タスク</MenuItem>
                  <MenuItem value="Project">プロジェクト</MenuItem>
                  <MenuItem value="Meeting">会議</MenuItem>
                  <MenuItem value="Workshop">ワークショップ</MenuItem>
                  <MenuItem value="Generic">イベント (通常)</MenuItem>
                  <MenuItem value="Deadline">締切</MenuItem>
                  <MenuItem value="Milestone">マイルストーン</MenuItem>
             </Select>
              {errors.type && <FormHelperText>{errors.type}</FormHelperText>}
               </FormControl>

               {/* Title */}
               <TextField
                  label={formData.type === 'task' || formData.type === 'Task' ? "タスク名 *" : "タイトル *"}
                  name="title"
                  value={formData.title}
                  onChange={handleChange}
                  fullWidth
                  required
                  error={!!errors.title}
                  helperText={errors.title}
                  size="small"
                  sx={{ mb: 1.5 }}
               />
               
               {/* Description (always shown if type is selected) */}
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
                
               {/* Project Selection (for Task, Meeting, Workshop, Deadline, Milestone) */}
               {showProjectSelection && (
                  <>
                     <Divider sx={{ my: 1 }}><Typography variant="caption">プロジェクト情報</Typography></Divider>
                      <FormControl component="fieldset" sx={{ mb: 1 }}>
                        <RadioGroup row name="projectSelectionMode" value={projectSelectionMode} onChange={handleProjectSelectionModeChange}>
                           <FormControlLabel value="existing" control={<Radio size="small"/>} label="既存プロジェクト" sx={{ mr: 1 }}/>
                           <FormControlLabel value="new" control={<Radio size="small"/>} label="新規プロジェクト" />
                        </RadioGroup>
                      </FormControl>

                      {projectSelectionMode === 'existing' && (
                         <FormControl fullWidth required={!(formData.type === 'task' || formData.type === 'Task')} error={!!errors.projectId} size="small" sx={{ mb: 1.5 }}>
                             <InputLabel id="existing-project-label">既存プロジェクト {!(formData.type === 'task' || formData.type === 'Task') && "*"}</InputLabel>
                             <Select
                                labelId="existing-project-label"
                                name="projectId"
                                value={formData.projectId || ''}
                                label={`既存プロジェクト ${!(formData.type === 'task' || formData.type === 'Task') && "*"}`}
                                onChange={handleChange}
                                size="small"
                                disabled={projectsLoading}
                             >
                                 <MenuItem value="" disabled><em>{projectsLoading ? '読み込み中...' : '選択してください'}</em></MenuItem>
                                 {projectOptions.map((p) => (
                                     <MenuItem key={`project-${p.id}`} value={p.id}>{p.name}</MenuItem>
                                 ))}
                             </Select>
                             {errors.projectId && <FormHelperText>{errors.projectId}</FormHelperText>}
                         </FormControl>
                      )}
                      {projectSelectionMode === 'new' && (
                        <Grid container spacing={1} sx={{pl: 1, mb: 1.5}}>
                            <Grid item xs={12}>
                                <TextField
                                    label="新規プロジェクト名 *"
                                    name="newProjectName"
                                    value={formData.newProjectName}
                                    onChange={handleChange}
                                    fullWidth
                                    required
                                    size="small"
                                    error={!!errors.newProjectName}
                                    helperText={errors.newProjectName}
                                />
                            </Grid>
                            <Grid item xs={12}>
                                <TextField
                                    label="新規プロジェクト概要"
                                    name="newProjectDescription"
                                    value={formData.newProjectDescription}
                                    onChange={handleChange}
                                    fullWidth
                                    multiline
                                    rows={2}
                                    size="small"
                                />
                            </Grid>
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

            {/* Task Specific Fields */}
            {(formData.type === 'task' || formData.type === 'Task') && (
              <Grid item xs={12} container spacing={1.5}> 
                  {/* Task Due Date */}
                  <Grid item xs={12}> {/* Due Date spans full width */}
                      <DatePicker
                          label="期限日 *"
                          value={parseDateString(formData.taskDueDate)}
                          onChange={(newValue) => handleDateChange('taskDueDate', newValue)}
                          slotProps={{ textField: { fullWidth: true, size: 'small', required: true, error: !!errors.taskDueDate, helperText: errors.taskDueDate } }}
                      />
                  </Grid>
                  {/* Assignee, Cost, Status, Dependencies */}
                  <Grid item xs={12}>
                      <FormControl fullWidth error={!!errors.taskAssigneeId} size="small">
                          <InputLabel id="assignee-select-label">担当者</InputLabel>
                          <Select
                              labelId="assignee-select-label"
                              name="taskAssigneeId"
                              value={formData.taskAssigneeId || ''}
                              label="担当者"
                              onChange={handleChange}
                          >
                              <MenuItem value=""><em>未割り当て</em></MenuItem>
                              {assigneeOptions.map((option) => (
                                  <MenuItem key={option.id} value={option.id}>
                                    {option.label}
                                  </MenuItem>
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
                          inputProps={{ step: "0.1" }} // Allow decimal for cost
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
                              <MenuItem value="review">レビュー中</MenuItem>
                              <MenuItem value="completed">完了</MenuItem>
                              <MenuItem value="delayed">遅延</MenuItem>
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
                          onChange={(event, newValue) => {
                              setSelectedDependencies(newValue);
                          }}
                          isOptionEqualToValue={(option, value) => option.id === value.id}
                          disabled={projectSelectionMode === 'new' || !formData.projectId} // 新規プロジェクト作成時またはプロジェクト未選択時は無効
                          renderInput={(params) => (
                              <TextField
                                  {...params}
                                  variant="outlined"
                                  label="依存先タスク"
                                  placeholder="依存するタスクを選択"
                                  size="small"
                              />
                          )}
                          renderTags={(value: readonly TaskOption[], getTagProps) =>
                              value.map((option: TaskOption, index: number) => {
                                  const { key, ...tagProps } = getTagProps({ index });
                                  return (
                                      <Chip key={key} variant="outlined" label={option.name} {...tagProps} size="small" />
                                  );
                              })
                          }
                          renderOption={(props, option, { selected }) => (
                            <li {...props} key={option.id}> {/* Ensure unique key for list items */}
                              {option.name} (ID: {option.id})
                            </li>
                          )}
                          size="small"
                      />
          </Grid>
              </Grid>
            )}

            {/* Project Specific Fields */}
            {(formData.type === 'project' || formData.type === 'Project') && (
              <Grid item xs={12} container spacing={1.5}>
                  {/* Project Start Date */}
                  <Grid item xs={6}>
                      <DatePicker
                          label="開始日 *"
                          value={parseDateString(formData.startDate)}
                          onChange={(newValue) => handleDateChange('startDate', newValue)}
                          slotProps={{ textField: { fullWidth: true, size: 'small', required: true, error: !!errors.startDate, helperText: errors.startDate } }}
                      />
                  </Grid>
                  {/* Project End Date */}
                  <Grid item xs={6}>
                      <DatePicker
                          label="終了日 *"
                          value={parseDateString(formData.endDate)}
                          onChange={(newValue) => handleDateChange('endDate', newValue)}
                          slotProps={{ textField: { fullWidth: true, size: 'small', required: true, error: !!errors.endDate, helperText: errors.endDate } }}
                      />
                  </Grid>
                  {/* Project Status */}
                  <Grid item xs={12}>
                      <FormControl fullWidth size="small">
                          <InputLabel id="project-status-select-label">ステータス</InputLabel>
                          <Select
                              labelId="project-status-select-label"
                              name="taskStatus"
                              value={formData.taskStatus}
                              label="ステータス"
                              onChange={handleChange}
                          >
                              <MenuItem value="planning">計画中</MenuItem>
                              <MenuItem value="in-progress">進行中</MenuItem>
                              <MenuItem value="completed">完了</MenuItem>
                          </Select>
                      </FormControl>
                  </Grid>
              </Grid>
            )}

            {/* Fields for Non-Task Event Types (Generic, Meeting, Workshop, Deadline, Milestone) */}
            {formData.type && formData.type !== 'task' && formData.type !== 'Task' && formData.type !== 'project' && formData.type !== 'Project' && (
              <Grid item xs={12} container spacing={1.5}>
                   {/* All Day Checkbox */}
                   {showAllDayCheckbox && (
                    <Grid item xs={12}>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={formData.allDay}
                                    onChange={(e) => {
                                        setFormData(prev => ({ ...prev, allDay: e.target.checked }));
                                        if (e.target.checked) {
                                            // 終日の場合、時間をクリア
                                            setFormData(prev => ({
                                                ...prev,
                                                startTime: '', // Clear time
                                                endTime: ''   // Clear time
                                            }));
                                        }
                                    }}
                                    size="small"
                                />
                            }
                            label="終日"
                        />
                    </Grid>
                   )}

                   {/* Start Date (or Due Date for Deadline/Milestone) */}
                   <Grid item xs={(formData.allDay || !showTimeFields) ? 12 : 6}>
                        <DatePicker
                            label={(formData.type === 'Deadline' || formData.type === 'Milestone') ? "期日 *" : "開始日 *"}
                            value={parseDateString(formData.startDate)}
                            onChange={(newValue) => handleDateChange('startDate', newValue)}
                            slotProps={{ textField: { fullWidth: true, size: 'small', required: true, error: !!errors.startDate, helperText: errors.startDate } }}
                        />
                    </Grid>

                    {/* Start Time */}
                    {showTimeFields && (
                         <Grid item xs={6}>
                            <TimePicker
                                label="開始時間 *"
                                value={parseTimeString(formData.startTime, parseDateString(formData.startDate))}
                                onChange={(newValue) => handleTimeChange('startTime', newValue)}
                                slotProps={{ textField: { fullWidth: true, size: 'small', required: true, error: !!errors.startTime, helperText: errors.startTime } }}
                            />
                        </Grid>
                     )}

                    {/* End Date & End Time (only for Generic, Meeting, Workshop) */}
                    {showEndDate && (
                        <>
                            <Grid item xs={(formData.allDay || !showTimeFields) ? 12 : 6}>
                                <DatePicker
                                    label="終了日 *"
                                    value={parseDateString(formData.endDate)}
                                    onChange={(newValue) => handleDateChange('endDate', newValue)}
                                    slotProps={{ textField: { fullWidth: true, size: 'small', required: true, error: !!errors.endDate, helperText: errors.endDate } }}
                            />
                        </Grid>
                            {showTimeFields && (
                        <Grid item xs={6}>
                            <TimePicker
                                        label="終了時間 *"
                                value={parseTimeString(formData.endTime, parseDateString(formData.endDate) ?? parseDateString(formData.startDate))}
                                onChange={(newValue) => handleTimeChange('endTime', newValue)}
                                        slotProps={{ textField: { fullWidth: true, size: 'small', required: true, error: !!errors.endTime, helperText: errors.endTime } }}
                            />
                        </Grid>
                            )}
                    </>
                  )}
                  {/* Location (for Meeting, Workshop, Generic) */}
                  {showLocation && (
                      <Grid item xs={12}>
                          <TextField label="場所" name="location" value={formData.location} onChange={handleChange} fullWidth size="small" sx={{ mb: 1 }}/>
                      </Grid>
                  )}
                  
                  {/* Participants (for Meeting, Workshop, Generic) */}
                  {showParticipants && (
              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  id="participants-autocomplete"
                        size="small"
                  options={participantOptions}
                        getOptionLabel={(option) => option.label}
                  value={selectedParticipants}
                  onChange={(event, newValue) => {
                    setSelectedParticipants(newValue);
                  }}
                        isOptionEqualToValue={(option, value) => option.id === value.id && option.type === value.type}
                  renderTags={(value, getTagProps) =>
                          value.map((option, index) => {
                            const { key, ...tagProps } = getTagProps({ index });
                            return (
                      <Chip 
                                key={key}
                        variant="outlined" 
                        size="small" 
                                label={option.label}
                                {...tagProps}
                              />
                            );
                          })
                        }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      variant="outlined"
                            label="参加者"
                            placeholder="ユーザーを選択"
                      size="small"
                          />
                        )}
                  loading={participantsLoading}
                        loadingText="読み込み中..."
                        noOptionsText="該当なし"
                />
            </Grid>
          )}
            </Grid>
          )}
        </Grid>
        </LocalizationProvider>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} size="small">キャンセル</Button>
        <Button onClick={handleSaveClick} variant="contained" color="primary" disabled={!formData.type} size="small">保存</Button>
      </DialogActions>
    </Dialog>
  );
};

export default EventAddModal;