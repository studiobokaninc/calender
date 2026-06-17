import React, { useState, useEffect, useMemo } from 'react';
import { mockDataApi } from '../services/api';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Select,
  MenuItem, FormControl, InputLabel, Checkbox, FormControlLabel, Box, Grid,
  FormHelperText, RadioGroup, Radio, Divider, Typography, Stack,
  Autocomplete, Chip, IconButton
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add'; // Added AddIcon
import CloseIcon from '@mui/icons-material/Close';
import { format, parseISO, isValid as isDateValid, addDays, addHours, startOfDay, setHours, setMinutes, parse } from 'date-fns';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import ja from 'date-fns/locale/ja';
import { Project, User, Group, CalendarEvent, Task } from '../types';
import { formatTaskLabel } from '../utils/taskLabel';

import { DateClickArg } from '@fullcalendar/interaction';

// --- Interfaces ---


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
  taskStartDate?: string;
  taskAssigneeId?: string | null;
  taskCost?: number | string;
  taskStatus?: string;
  taskPriority?: string;
  taskType?: string;
  taskSeqID?: string;
  taskShotID?: string;
  taskShotRelId?: number | null;
  taskDependsOn?: string[];
  location?: string;
  dueDate?: string;
  taskPhases?: { name: string; date: string }[];
  phaseTargetTaskId?: string | null; // Added for Phase creation
  taskCheckItems?: { label: string; checked: boolean }[];
  taskDeliverables?: string;
}

interface ProjectOption { id: string; name: string; }
interface TaskOption { id: string; name: string; }



// --- Option type for Autocomplete ---
interface ParticipantOption {
  id: string;
  type: 'user' | 'group';
  label: string; // Display name
}

// --- Component Props ---
/** true のときタイプは会議・ワークショップ・イベント・締切・マイルストーンのみ（タスク・プロジェクトを非表示） */
/** canCreateProject が false のときは「プロジェクト」タイプと「新規プロジェクトでタスク作成」を非表示（一般ユーザー用） */
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
  eventTypesOnly?: boolean;
  canCreateProject?: boolean;
}

// --- Component ---
const EventAddModal: React.FC<EventAddModalProps> = ({ open, onClose, onSave, initialDate, eventToEdit, dateClickArg, projects: projectsFromProps, users: usersFromProps, tasks: tasksFromProps, groups: groupsFromProps, eventTypesOnly = false, canCreateProject = true }) => {
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
    } else if (initialDate) { // カレンダー外からの呼び出し（例：＋ボタン、イベント管理ページ）
      initialStartDateTime = setMinutes(setHours(startOfDay(initialDate), defaultStartTime), 0);
      initialEndDateTime = setMinutes(setHours(startOfDay(initialDate), defaultEndTime), 0);
      if (eventTypesOnly) {
        initialType = 'Meeting';
        initialAllDay = false;
      } else {
        initialAllDay = true; // デフォルトのTaskに合わせて終日
      }
    } else {
      // initialDate も dateClickArg もない場合 (モーダルを直接開くなど、レアケース)
      if (eventTypesOnly) {
        initialType = 'Meeting';
        initialAllDay = false;
        initialStartDateTime = setMinutes(setHours(startOfDay(new Date()), defaultStartTime), 0);
        initialEndDateTime = setMinutes(setHours(startOfDay(new Date()), defaultEndTime), 0);
      } else {
        initialType = 'Task';
        initialStartDateTime = setMinutes(setHours(startOfDay(new Date()), defaultStartTime), 0);
        initialEndDateTime = setMinutes(setHours(startOfDay(new Date()), defaultEndTime), 0);
        initialAllDay = true;
      }
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
      taskStartDate: isTaskType ? format(initialStartDateTime, 'yyyy-MM-dd') : undefined,
      taskAssigneeId: null,
      taskCost: '',
      taskStatus: (initialType === 'Project' || initialType === 'project') ? 'planning' : 'todo',
      taskPriority: 'low',
      taskType: '',
      taskSeqID: '',
      taskShotID: '',
      taskShotRelId: null,
      taskDependsOn: [],
      location: '',
      dueDate: format(initialStartDateTime, 'yyyy-MM-dd'),
      taskPhases: [],
      phaseTargetTaskId: null,
      taskCheckItems: [],
      taskDeliverables: '',
    };
  };

  const [formData, setFormData] = useState<EventFormData>(getInitialState());
  const [projectSelectionMode, setProjectSelectionMode] = useState<'existing' | 'new'>('existing');
  const [errors, setErrors] = useState<Partial<Record<keyof EventFormData | 'newProjectName' | 'taskDueDate' | 'taskAssigneeId' | 'phaseTargetTaskId', string>>>({});
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState<ParticipantOption[]>([]);
  const [selectedDependencies, setSelectedDependencies] = useState<TaskOption[]>([]);
  const [isRange, setIsRange] = useState(false); // Added for Generic event range selection
  const [shots, setShots] = useState<{ id: number; shotID: string; seqID: string }[]>([]);

  useEffect(() => {
    if (open) {
      setProjectsLoading(false);
    }
  }, [open]);

  // プロジェクト選択時にショット一覧を取得
  const selectedProjectId = projectSelectionMode === 'existing' ? formData.projectId : null;
  useEffect(() => {
    if (!selectedProjectId) {
      setShots([]);
      return;
    }
    mockDataApi.getProductionTracker(Number(selectedProjectId))
      .then((data: any) => {
        const allShots: { id: number; shotID: string; seqID: string }[] = [];
        if (data && data.sequences) {
          data.sequences.forEach((seqData: any) => {
            if (seqData.shots) {
              seqData.shots.forEach((s: any) => {
                allShots.push({ id: s.id, shotID: s.shotID, seqID: seqData.seqID });
              });
            }
          });
        }
        setShots(allShots);
      })
      .catch(() => console.error('Failed to fetch shots for EventAddModal'));
  }, [selectedProjectId]);

  useEffect(() => {
    if (!canCreateProject && projectSelectionMode === 'new') {
      setProjectSelectionMode('existing');
    }
  }, [canCreateProject, projectSelectionMode]);

  const projectOptions = useMemo((): ProjectOption[] => {
    return projectsFromProps.map(p => ({ id: String(p.id), name: p.name })) || [];
  }, [projectsFromProps]);



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
    const editingTaskId = eventToEdit?.id?.startsWith('task-') ? eventToEdit.id.replace('task-', '').toString() : null;

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
          taskStartDate: isTask ? ((eventToEdit.extendedProps as any)?.taskStartDate ? format(parseISO((eventToEdit.extendedProps as any).taskStartDate), 'yyyy-MM-dd') : calculatedStartDateStr) : undefined,
          taskAssigneeId: eventToEdit.extendedProps?.taskAssigneeId?.toString() || null,
          taskCost: eventToEdit.extendedProps?.taskCost || '',
          taskStatus: isProject ? (eventToEdit.extendedProps?.projectStatus || 'planning') : (eventToEdit.extendedProps?.taskStatus || 'todo'),
          taskPriority: ((eventToEdit.extendedProps as any)?.taskPriority ?? 'low').toString().toLowerCase(),
          taskType: (eventToEdit.extendedProps as any)?.taskType ?? '',
          taskSeqID: (eventToEdit.extendedProps as any)?.taskSeqID ?? '',
          taskShotID: (eventToEdit.extendedProps as any)?.taskShotID ?? '',
          location: eventToEdit.extendedProps?.location || '',
          newProjectName: '',
          newProjectDescription: '',
          newProjectStartDate: '',
          newProjectEndDate: '',
          newProjectColor: '#4CAF50',
          dueDate: '', // This appears to be legacy or for other types, taskDueDate is primary for tasks
          taskDependsOn: eventToEdit.extendedProps?.dependsOn || [],
          taskPhases: ((eventToEdit.extendedProps as any)?.phases || []).map((p: any) => ({
            name: p.name || '',
            date: p.date || p.due_date || '',
            is_completed: p.is_completed ?? false,
          })),
          taskCheckItems: ((eventToEdit.extendedProps as any)?.check_items || []).map((item: any) => ({
            label: item.label || '',
            checked: item.checked ?? false,
          })),
          taskDeliverables: (eventToEdit.extendedProps as any)?.deliverables || '',
        } as EventFormData);

        // Populate selectedParticipants from eventToEdit
        if (eventToEdit.extendedProps?.participants) {
          const initialParticipants: ParticipantOption[] = [];
          eventToEdit.extendedProps.participants.forEach(p => {
            // p.id is number, opt.id is string
            const pIdStr = String(p.id);
            const option = participantOptions.find(opt => opt.type === p.type && opt.id === pIdStr);
            if (option) {
              initialParticipants.push(option);
            }
          });
          setSelectedParticipants(initialParticipants);
        } else {
          setSelectedParticipants([]);
        }

        setSelectedDependencies([]);

        setProjectSelectionMode(eventToEdit.extendedProps?.projectId ? 'existing' : 'existing');
        setErrors({});

        const initialDeps = (eventToEdit.extendedProps?.dependsOn || []) as string[];
        const initialSelectedOptions = taskOptions.filter(opt => initialDeps.includes(opt.id));
        setSelectedDependencies(initialSelectedOptions);

        // Set isRange for Generic events
        if (eventTypeFromEdit === 'Generic' && (eventToEdit.allDay ?? false)) {
          // If start date and end date are different (and valid), it's a range
          // Note: FullCalendar end date for allDay is exclusive (+1 day).
          // calculatedStartDateStr and endDateStr are already normalized to YYYY-MM-DD.
          if (calculatedStartDateStr && endDateStr && calculatedStartDateStr !== endDateStr) {
            setIsRange(true);
          } else {
            setIsRange(false);
          }
        } else {
          setIsRange(false);
        }

      } else {
        setFormData(getInitialState());
        setSelectedParticipants([]);
        setSelectedDependencies([]);
        setIsRange(false);
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
      // S/M/L形式の場合は変換
      let cost = 0;
      if (value === 'S') cost = 2;
      else if (value === 'M') cost = 8;
      else if (value === 'L') cost = 24;
      else if (value) cost = Number(value) || 0;

      const days = Math.ceil(cost / 8); // 1日8時間として計算
      const dueDate = parseDateString(formData.taskDueDate);
      if (dueDate) {
        // コストが8時間(1日)なら開始日は期日と同じ。16時間(2日)なら期日の前日。
        const daysToSubtract = days > 0 ? days - 1 : 0;
        const startDate = addDays(dueDate, -daysToSubtract);
        setFormData(prev => ({
          ...prev,
          [name]: valueToSet,
          startDate: format(startDate, 'yyyy-MM-dd')
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
      // S/M/L形式の場合は変換
      let costNum = 0;
      if (formData.taskCost === 'S') costNum = 2;
      else if (formData.taskCost === 'M') costNum = 8;
      else if (formData.taskCost === 'L') costNum = 24;
      else if (formData.taskCost) costNum = Number(formData.taskCost) || 0;

      const daysComputed = Math.ceil(costNum / 8);
      const daysToSubtract = daysComputed > 0 ? daysComputed - 1 : 0;
      const startDate = addDays(newValue, -daysToSubtract);

      setFormData(prev => ({
        ...prev,
        taskDueDate: newDueDateStr,
        startDate: format(startDate, 'yyyy-MM-dd'),
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
    // GenericとMeetingで時間指定の場合は実施日のみを使用（終了日は使用しない）
    const useStartDateForEndTime = (formData.type === 'Generic' || formData.type === 'Meeting') && !formData.allDay;
    const baseDateStr = name === 'startTime' ? formData.startDate : (useStartDateForEndTime ? formData.startDate : formData.endDate);
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
        next.taskStatus = 'todo';

      } else if (newType === 'Project' || newType === 'project') {
        // プロジェクトは終日・時間不要。開始日と終了日が必要。
        next.allDay = true;
        next.startTime = undefined;
        next.endTime = undefined;

        // 開始日・終了日は既存値を優先
        next.startDate = prev.startDate || prev.taskDueDate || '';
        next.endDate = prev.endDate || '';
        next.taskStatus = 'planning';

      } else if (newType === 'Deadline' || newType === 'Milestone') {
        // これらは終日・時間不要。必要なのは期日に相当する startDate。
        next.allDay = true;
        next.startTime = undefined;
        next.endTime = undefined;

        // 既存の startDate を優先。無ければ taskDueDate → endDate の順に利用。
        next.startDate = prev.startDate || prev.taskDueDate || prev.endDate || '';
        next.endDate = undefined;

      } else if (newType === 'Meeting') {
        // 会議は実施日のみ（終了日は設定しない）。時間あり（終日OFF固定）。
        next.allDay = false;

        // 実施日のみ。既存値を尊重。無ければ taskDueDate を流用。
        next.startDate = prev.startDate || prev.taskDueDate || '';
        next.endDate = undefined; // 会議は終了日を使わない

        // 時刻は既存値を優先、なければ軽いデフォルト（今日には依存しない）
        next.startTime = prev.startTime || '09:00';
        next.endTime = prev.endTime || '10:00';

      } else if (newType === 'Workshop') {
        // ワークショップは会議と同様に時間指定あり（終日OFF固定）
        next.allDay = false;

        // 実施日のみ。既存値を尊重。無ければ taskDueDate を流用。
        next.startDate = prev.startDate || prev.taskDueDate || '';
        next.endDate = undefined; // ワークショップは終了日を使わない

        // 時刻は既存値を優先、なければ軽いデフォルト
        next.startTime = prev.startTime || '13:00';
        next.endTime = prev.endTime || '16:00';

      } else if (newType === 'Phase') {
        // Phase creation mode
        next.allDay = true;
        next.startTime = undefined;
        next.endTime = undefined;
        // Phase date (use startDate)
        next.startDate = prev.startDate || prev.taskDueDate || '';
        next.endDate = undefined;
        // Reset task related fields except those needed for phase logic if any
        next.phaseTargetTaskId = null;
      } else { // Generic
        // Generic は終日ON/OFFをユーザーに委ねる（デフォルトはオフに）
        next.allDay = false;
        next.startDate = prev.startDate || prev.taskDueDate || '';
        next.endDate = undefined; // 終了日は使用しない
        next.startTime = prev.startTime || '09:00';
        next.endTime = prev.endTime || '10:00';
      }

      return next;
    });

    // タイプ変更時は常に依存関係をリセットし、プロジェクト選択を既存に戻す
    setSelectedDependencies([]);
    setProjectSelectionMode('existing');
    setIsRange(false); // Reset isRange
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
    const newErrors: Partial<Record<keyof EventFormData | 'newProjectName' | 'taskDueDate' | 'taskAssigneeId' | 'phaseTargetTaskId', string>> = {};
    if (!formData.type) newErrors.type = 'イベントタイプを選択してください';
    if (!formData.title.trim()) newErrors.title = 'タイトル/タスク名を入力してください';

    if (formData.type === 'task' || formData.type === 'Task') {
      // プロジェクトは任意（既存で未選択＝プロジェクトなしでOK）
      if (projectSelectionMode === 'new') {
        if (!formData.newProjectName?.trim()) newErrors.newProjectName = '新規プロジェクト名を入力してください';
        if (!formData.newProjectStartDate) newErrors.newProjectStartDate = '開始日を入力してください';
        if (!formData.newProjectEndDate) newErrors.newProjectEndDate = '終了日を入力してください';
        // TODO: 新規プロジェクトの日付検証 (開始日 <= 終了日)
      }
      if (!formData.taskDueDate) newErrors.taskDueDate = '期日を入力してください';
      // if (!formData.taskAssigneeId) newErrors.taskAssigneeId = '担当者を選択してください'; // 必須ではなくなった
      // S/M/L形式または数値を受け入れる
      if (formData.taskCost && !['S', 'M', 'L'].includes(String(formData.taskCost))) {
        if (isNaN(Number(formData.taskCost))) {
          newErrors.taskCost = 'コストにはS/M/Lまたは数値を入力してください';
        }
      }

    } else if (formData.type === 'project' || formData.type === 'Project') {
      // プロジェクトタイプの検証
      if (!formData.startDate) newErrors.startDate = '開始日を入力してください';
      if (!formData.endDate) newErrors.endDate = '終了日を入力してください';
      // 日付の順序検証
      if (formData.startDate && formData.endDate && formData.startDate > formData.endDate) {
        newErrors.endDate = '終了日は開始日より後に設定してください';
      }
    } else if (formData.type === 'Phase') {
      if (!formData.phaseTargetTaskId) newErrors.phaseTargetTaskId = 'タスクを選択してください';
      if (!formData.title.trim()) newErrors.title = '段階目標名を入力してください';
      if (!formData.startDate) newErrors.startDate = '目標日を入力してください';
    } else if (formData.type) { // Generic, Meeting, Workshop, Deadline, Milestone
      if (!formData.startDate) {
        newErrors.startDate = (formData.type === 'Deadline' || formData.type === 'Milestone') ? '期日を入力してください' : '開始日を入力してください';
      }
      if (!formData.allDay) {
        if (!formData.startTime) newErrors.startTime = '開始時間を入力してください';
        // GenericとMeetingは時間指定の場合、終了時間を必須
        if ((formData.type === 'Generic' || formData.type === 'Meeting') && !formData.endTime) {
          newErrors.endTime = '終了時間を入力してください';
        }
        // 時間の順序検証 (開始時刻 < 終了時刻)。GenericとMeetingは同一実施日で比較
        const startDateForCompare = formData.startDate;
        if (startDateForCompare && formData.startTime && formData.endTime &&
          `${startDateForCompare} ${formData.startTime}` >= `${startDateForCompare} ${formData.endTime}`) {
          newErrors.endTime = '終了時刻は開始時刻より後に設定してください';
        }
      } else if (formData.type === 'Generic') {
        // Genericで終日の場合は実施日のみ（終了日は使用しない）
        if (!formData.startDate) {
          newErrors.startDate = '開始日を入力してください';
        }
        // Genericで終日かつ期間指定の場合は終了日必須
        if (formData.allDay && isRange && !formData.endDate) {
          newErrors.endDate = '終了日を入力してください';
        }
        // 終了日が開始日より前でないかのチェック
        if (formData.allDay && isRange && formData.startDate && formData.endDate && formData.startDate > formData.endDate) {
          newErrors.endDate = '終了日は開始日より後に設定してください';
        }
      }
      // プロジェクトは任意（指定しなくてもよい）
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
        phase: 'Phase',
        Phase: 'Phase',
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
      } else if (normalizedType === 'Phase') {
        dataToSave.phaseTargetTaskId = formData.phaseTargetTaskId;
        dataToSave.date = formData.startDate; // Phase date
        dataToSave.allDay = true;
      } else if (normalizedType === 'Task') {
        // start_time: 開始日 → startDate(期日-コスト) → 期日ベースのフォールバック
        if (formData.taskStartDate) {
          const startDateObj = parseDateString(formData.taskStartDate);
          if (startDateObj && isDateValid(startDateObj)) {
            dataToSave.start_time = format(startOfDay(startDateObj), "yyyy-MM-dd'T'HH:mm:ssxxx");
          }
        }
        if (!dataToSave.start_time && formData.startDate) {
          const startDateObj = parseDateString(formData.startDate);
          if (startDateObj && isDateValid(startDateObj)) {
            dataToSave.start_time = format(startOfDay(startDateObj), "yyyy-MM-dd'T'HH:mm:ssxxx");
          }
        }
        if (!dataToSave.start_time && formData.taskDueDate) {
          const dueDateObj = parseDateString(formData.taskDueDate);
          if (dueDateObj && isDateValid(dueDateObj)) {
            // S/M/L形式の場合は変換
            let cost = 0;
            if (formData.taskCost === 'S') cost = 2;
            else if (formData.taskCost === 'M') cost = 8;
            else if (formData.taskCost === 'L') cost = 24;
            else if (formData.taskCost) cost = Number(formData.taskCost) || 0;
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
            dataToSave.due_date = format(dueDateObj, 'yyyy-MM-dd');
          }
        }
        dataToSave.allDay = true;

        // assigned_toの処理を安全に行う
        if (formData.taskAssigneeId) {
          const taskAssigneeIdStr = String(formData.taskAssigneeId);
          const match = taskAssigneeIdStr.match(/^(user|group)-(\d+)$/);
          if (match) {
            dataToSave.assigned_to = parseInt(match[2], 10);
            dataToSave.assignee_type = match[1];
          } else {
            // フォーマットが期待通りでない場合はnullに設定
            dataToSave.assigned_to = null;
            dataToSave.assignee_type = null;
          }
        } else {
          dataToSave.assigned_to = null;
          dataToSave.assignee_type = null;
        }
        // S/M/L形式の場合はそのまま送信（バックエンドで変換）
        dataToSave.cost = formData.taskCost ? (['S', 'M', 'L'].includes(String(formData.taskCost)) ? String(formData.taskCost) : Number(formData.taskCost)) : 0;
        dataToSave.status = formData.taskStatus || 'todo';
        dataToSave.priority = (formData.taskPriority ?? 'low').toLowerCase();
        dataToSave.taskType = (formData.taskType ?? '').toLowerCase() || undefined;
        dataToSave.seqID = formData.taskSeqID?.trim() ?? '';
        dataToSave.shotID = formData.taskShotID?.trim() ?? '';
        dataToSave.shot_id = formData.taskShotRelId ?? null;

        dataToSave.dependsOn = selectedDependencies.map(dep => dep.id);
        // 段階目標: カレンダー表示用に date と is_completed を含める（name のみの場合は is_completed: false）
        dataToSave.phases = (formData.taskPhases || []).map((p: { name: string; date: string; is_completed?: boolean }) => ({
          name: p.name,
          date: p.date,
          is_completed: p.is_completed ?? false,
        })).filter((p: { name: string; date: string }) => p.name.trim() !== '' && p.date !== '');
        
        dataToSave.check_items = formData.taskCheckItems || [];
        dataToSave.deliverables = formData.taskDeliverables || null;

        console.log("Formatted dependsOn to save:", JSON.stringify(dataToSave.dependsOn, null, 2));

        if (projectSelectionMode === 'existing' && formData.projectId) {
          dataToSave.project_id = parseInt(formData.projectId, 10);
        } else if (projectSelectionMode === 'existing') {
          dataToSave.project_id = null; // プロジェクト未設定のタスク
        } else if (projectSelectionMode === 'new') {
          dataToSave.new_project = {
            name: formData.newProjectName,
            description: formData.newProjectDescription,
            start_date: formData.newProjectStartDate,
            end_date: formData.newProjectEndDate,
            // color: formData.newProjectColor,
          };
        }
      } else { // Other event types
        // Deadline, Milestoneは常に終日
        if (normalizedType === 'Deadline' || normalizedType === 'Milestone') {
          dataToSave.allDay = true;
        } else {
          dataToSave.allDay = formData.allDay;
        }

        if (formData.startDate) {
          const startDateObj = parseDateString(formData.startDate);
          if (startDateObj) {
            if (dataToSave.allDay || normalizedType === 'Deadline' || normalizedType === 'Milestone') {
              // 締切・マイルストーンは常に終日。日付をそのまま使用（タイムゾーン問題を回避）
              const dateStr = format(startDateObj, 'yyyy-MM-dd');
              dataToSave.start_time = `${dateStr}T00:00:00+09:00`;
              // Googleカレンダー等の終日仕様（翌日00:00が終了）に合わせる
              const nextDayStr = format(addDays(startDateObj, 1), 'yyyy-MM-dd');
              dataToSave.end_time = `${nextDayStr}T00:00:00+09:00`;
            } else if (formData.startTime) {
              const startDateTime = parseTimeString(formData.startTime, startDateObj);
              if (startDateTime) dataToSave.start_time = format(startDateTime, "yyyy-MM-dd'T'HH:mm:ssxxx");
            }
          }
        }

        if (!dataToSave.allDay && (normalizedType === 'Generic' || normalizedType === 'Meeting' || normalizedType === 'Workshop')) {
          // 時間指定の場合、実施日のみを使用（終了日は使用しない）
          const endDateObj = parseDateString(formData.startDate);
          if (endDateObj && formData.endTime) {
            const endDateTime = parseTimeString(formData.endTime, endDateObj);
            if (endDateTime) dataToSave.end_time = format(endDateTime, "yyyy-MM-dd'T'HH:mm:ssxxx");
          } else if (endDateObj && !formData.endTime && dataToSave.start_time) {
            dataToSave.end_time = format(addHours(parseISO(dataToSave.start_time), 1), "yyyy-MM-dd'T'HH:mm:ssxxx");
          }
        } else if (dataToSave.allDay && normalizedType === 'Generic') {
          if (dataToSave.start_time) {
            const startDateForEnd = parseISO(dataToSave.start_time);
            if (isRange && formData.endDate) {
              // 期間指定あり: endDate + 1日 (終日仕様)
              const endDateObj = parseDateString(formData.endDate);
              if (endDateObj) {
                dataToSave.end_time = format(startOfDay(addDays(endDateObj, 1)), "yyyy-MM-dd'T'HH:mm:ssxxx");
                dataToSave.end = dataToSave.end_time; // For safety/redundancy
              }
            } else {
              // 期間指定なし (単日): 開始日の翌日
              dataToSave.end_time = format(startOfDay(addDays(startDateForEnd, 1)), "yyyy-MM-dd'T'HH:mm:ssxxx");
              dataToSave.end = dataToSave.end_time;
            }
          }
        }


        dataToSave.location = formData.location || '';
        // プロジェクトは任意：指定されていれば送信
        if (formData.projectId) {
          dataToSave.project_id = parseInt(formData.projectId, 10);
        }
        if (normalizedType === 'Meeting' || normalizedType === 'Generic' || normalizedType === 'Workshop') {
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
    // タスク・プロジェクト以外の全イベントタイプでプロジェクトを任意指定可能
    return ['task', 'Task', 'Meeting', 'Workshop', 'Deadline', 'Milestone', 'Generic'].includes(formData.type);
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
    if (['task', 'Task', 'Deadline', 'Milestone', 'Meeting', 'Workshop', 'Phase', 'phase'].includes(formData.type)) return false;
    return true; // Generic のみ表示
  }, [formData?.type]);

  const showTimeFields = useMemo(() => {
    if (!formData?.type || formData.allDay) return false;
    // タスク、締切、マイルストーン、Phaseでは非表示
    if (['task', 'Task', 'Deadline', 'Milestone', 'Phase', 'phase'].includes(formData.type)) return false;
    return true; // Generic, Meeting のみ表示 (かつ終日でない場合)
  }, [formData?.type, formData.allDay]);

  const showEndDate = useMemo(() => {
    if (!formData?.type) return false;
    // Generic の場合、allDay かつ isRange なら表示
    if (formData.type === 'Generic') {
      return formData.allDay && isRange;
    }
    // タスク、締切、マイルストーン、会議、ワークショップ、Phaseは非表示
    if (['task', 'Task', 'Deadline', 'Milestone', 'Meeting', 'Workshop', 'Phase', 'phase'].includes(formData.type)) return false;
    // Project などは表示
    return true;
  }, [formData?.type, formData.allDay, isRange]);

  // 担当者オプション (ユーザー + グループ)
  const assigneeOptions = useMemo((): Array<{ id: string; label: string; type: string; }> => {
    const users = usersFromProps.map(u => ({ id: `user-${u.id}`, label: u.username || u.name || u.email || `User ${u.id}`, type: 'user' as const }));
    return users.sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label));
  }, [usersFromProps]);

  const normalizedType = useMemo(() => {
    const map: Record<string, string> = {
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
      phase: 'Phase',
      Phase: 'Phase',
      generic: 'Generic',
      Generic: 'Generic',
    };
    return map[formData.type] || 'Generic';
  }, [formData.type]);

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
                  {!eventTypesOnly && <MenuItem value="Task">タスク</MenuItem>}
                  {!eventTypesOnly && canCreateProject && <MenuItem value="Project">プロジェクト</MenuItem>}
                  <MenuItem value="Meeting">会議</MenuItem>
                  <MenuItem value="Workshop">ワークショップ</MenuItem>
                  <MenuItem value="Generic">通常イベント (Generic)</MenuItem>
                  <MenuItem value="Deadline">締切</MenuItem>
                  <MenuItem value="Milestone">マイルストーン (Milestone)</MenuItem>
                  <MenuItem value="Phase">段階目標 (Phase)</MenuItem>
                </Select>
                {errors.type && <FormHelperText>{errors.type}</FormHelperText>}
              </FormControl>

              {/* Title */}
              <TextField
                label={formData.type === 'task' || formData.type === 'Task' ? "タスク名 *" : (formData.type === 'Phase' ? "段階目標名 *" : "タイトル *")}
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

              {/* Description (Moved from bottom) */}
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



              {/* Project Selection (for Task, Meeting, Workshop, Deadline, Milestone) */}
              {showProjectSelection && (
                <>
                  <Divider sx={{ my: 1 }}><Typography variant="caption">プロジェクト情報</Typography></Divider>
                  {canCreateProject ? (
                    <FormControl component="fieldset" sx={{ mb: 1 }}>
                      <RadioGroup row name="projectSelectionMode" value={projectSelectionMode} onChange={handleProjectSelectionModeChange}>
                        <FormControlLabel value="existing" control={<Radio size="small" />} label="既存プロジェクト" sx={{ mr: 1 }} />
                        <FormControlLabel value="new" control={<Radio size="small" />} label="新規プロジェクト" />
                      </RadioGroup>
                    </FormControl>
                  ) : null}

                  {projectSelectionMode === 'existing' && (
                    <FormControl fullWidth error={!!errors.projectId} size="small" sx={{ mb: 1.5 }}>
                      <InputLabel id="existing-project-label">プロジェクト（任意）</InputLabel>
                      <Select
                        labelId="existing-project-label"
                        name="projectId"
                        value={formData.projectId || ''}
                        label="プロジェクト（任意）"
                        onChange={handleChange}
                        size="small"
                        disabled={projectsLoading}
                      >
                        <MenuItem value=""><em>{projectsLoading ? '読み込み中...' : '未設定'}</em></MenuItem>
                        {projectOptions.map((p) => (
                          <MenuItem key={`project-${p.id}`} value={p.id}>{p.name}</MenuItem>
                        ))}
                      </Select>
                      {errors.projectId && <FormHelperText>{errors.projectId}</FormHelperText>}
                    </FormControl>
                  )}
                  {canCreateProject && projectSelectionMode === 'new' && (
                    <Grid container spacing={1} sx={{ pl: 1, mb: 1.5 }}>
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
                {/* Task Start Date（開始日を上に） */}
                <Grid item xs={12}>
                  <DatePicker
                    label="開始日"
                    value={parseDateString(formData.taskStartDate)}
                    onChange={(newValue) => handleDateChange('taskStartDate', newValue)}
                    slotProps={{ textField: { fullWidth: true, size: 'small' } }}
                  />
                </Grid>
                {/* Task Due Date（期日をその下に） */}
                <Grid item xs={12}>
                  <DatePicker
                    label="期日 *"
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
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <TextField
                      label="コスト（時間）"
                      name="taskCost"
                      type="number"
                      value={formData.taskCost || ''}
                      onChange={handleChange}
                      fullWidth
                      size="small"
                      error={!!errors.taskCost}
                      helperText={errors.taskCost}
                      inputProps={{ step: "0.1", min: 0 }}
                    />
                    <IconButton
                      size="small"
                      onClick={() => {
                        const currentCost = Number(formData.taskCost) || 0;
                        handleChange({ target: { name: 'taskCost', value: String(currentCost + 1) } } as any);
                      }}
                      sx={{ ml: 1, border: '1px solid rgba(0,0,0,0.23)', borderRadius: '4px' }}
                      title="コストを+1時間"
                    >
                      <AddIcon fontSize="small" />
                    </IconButton>
                  </Box>
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
                <Grid item xs={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="priority-select-label">優先度</InputLabel>
                    <Select
                      labelId="priority-select-label"
                      name="taskPriority"
                      value={formData.taskPriority ?? 'low'}
                      label="優先度"
                      onChange={handleChange}
                    >
                      <MenuItem value="high">高</MenuItem>
                      <MenuItem value="medium">中</MenuItem>
                      <MenuItem value="low">低</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="task-type-select-label">タスクタイプ</InputLabel>
                    <Select
                      labelId="task-type-select-label"
                      name="taskType"
                      value={formData.taskType ?? ''}
                      label="タスクタイプ"
                      onChange={handleChange}
                    >
                      <MenuItem value="">未設定</MenuItem>
                      <MenuItem value="animation">animation</MenuItem>
                      <MenuItem value="layout">layout</MenuItem>
                      <MenuItem value="comp">comp</MenuItem>
                      <MenuItem value="fx">fx</MenuItem>
                      <MenuItem value="lighting">lighting</MenuItem>
                      <MenuItem value="asset">asset</MenuItem>
                      <MenuItem value="programming">programming</MenuItem>
                      <MenuItem value="design">design</MenuItem>
                      <MenuItem value="testing">testing</MenuItem>
                      <MenuItem value="documentation">documentation</MenuItem>
                      <MenuItem value="shoot">shoot</MenuItem>
                      <MenuItem value="gs">gs</MenuItem>
                      <MenuItem value="report">report</MenuItem>
                      <MenuItem value="other">other</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                {/* ショット選択（Scoreプロジェクト連携） */}
                <Grid item xs={12}>
                  <FormControl fullWidth size="small" disabled={!formData.projectId}>
                    <InputLabel>既存IDセット</InputLabel>
                    <Select
                      value={formData.taskShotRelId ?? ''}
                      label="既存IDセット"
                      onChange={(e) => {
                        const val = e.target.value as number | '';
                        if (val === '') {
                          setFormData(prev => ({ ...prev, taskShotRelId: null, taskSeqID: '', taskShotID: '' }));
                        } else {
                          const shot = shots.find(s => s.id === val);
                          setFormData(prev => ({
                            ...prev,
                            taskShotRelId: val,
                            taskSeqID: shot?.seqID ?? '',
                            taskShotID: shot?.shotID ?? '',
                          }));
                        }
                      }}
                    >
                      {!formData.projectId ? (
                        <MenuItem value="" disabled>プロジェクトを先に選択してください</MenuItem>
                      ) : shots.length === 0 ? (
                        <MenuItem value="" disabled>このプロジェクトにはショットがありません</MenuItem>
                      ) : (
                        <MenuItem value="">（なし）</MenuItem>
                      )}
                      {shots.map(s => (
                        <MenuItem key={s.id} value={s.id}>{s.seqID} / {s.shotID}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="シーケンスID"
                    name="taskSeqID"
                    value={formData.taskSeqID ?? ''}
                    onChange={handleChange}
                    fullWidth
                    size="small"
                    InputProps={{ readOnly: !!formData.taskShotRelId }}
                    helperText={formData.taskShotRelId ? 'ショット選択で自動入力' : '手動入力（レガシープロジェクト用）'}
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="ショットID"
                    name="taskShotID"
                    value={formData.taskShotID ?? ''}
                    onChange={handleChange}
                    fullWidth
                    size="small"
                    InputProps={{ readOnly: !!formData.taskShotRelId }}
                  />
                </Grid>
                <Grid item xs={12}>
                  <Autocomplete
                    multiple
                    id="task-dependencies"
                    options={taskOptions}
                    getOptionLabel={(option) => option.name}
                    value={selectedDependencies}
                    onChange={(_event, newValue) => {
                      setSelectedDependencies(newValue);
                    }}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    disabled={projectSelectionMode === 'new' || !formData.projectId} // 新規プロジェクト作成時またはプロジェクト未選択時は無効
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        variant="outlined"
                        label="依存元タスク"
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
                    renderOption={(props, option, _state) => (
                      <li {...props} key={option.id}> {/* Ensure unique key for list items */}
                        {option.name} (ID: {option.id})
                      </li>
                    )}
                    size="small"
                  />
                </Grid>
                {/* 段階目標 (Phases) - タスクページの編集ダイアログと同じ表示 */}
                <Grid item xs={12}>
                  <Typography variant="subtitle2" sx={{ mt: 1 }}>段階目標 (Phases)</Typography>
                  {(formData.taskPhases || []).map((phase, index) => (
                    <Stack key={index} direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, mb: 0.5 }}>
                      <TextField
                        label="目標名"
                        value={phase.name}
                        onChange={(e) => {
                          const newPhases = [...(formData.taskPhases || [])];
                          newPhases[index].name = e.target.value;
                          setFormData({ ...formData, taskPhases: newPhases });
                        }}
                        size="small"
                        sx={{ flex: 1 }}
                      />
                      <TextField
                        type="date"
                        label="日付"
                        value={phase.date}
                        onChange={(e) => {
                          const newPhases = [...(formData.taskPhases || [])];
                          newPhases[index].date = e.target.value;
                          setFormData({ ...formData, taskPhases: newPhases });
                        }}
                        size="small"
                        sx={{ width: 150 }}
                        InputLabelProps={{ shrink: true }}
                      />
                      <Button
                        color="error"
                        size="small"
                        style={{ minWidth: '40px' }}
                        onClick={() => {
                          const newPhases = (formData.taskPhases || []).filter((_, i) => i !== index);
                          setFormData({ ...formData, taskPhases: newPhases });
                        }}
                      >
                        ×
                      </Button>
                    </Stack>
                  ))}
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      const newPhases = [...(formData.taskPhases || []), { name: '', date: '' }];
                      setFormData({ ...formData, taskPhases: newPhases });
                    }}
                    sx={{ mt: 0.5 }}
                  >
                    段階目標を追加
                  </Button>
                </Grid>

                {/* チェックリスト (check_items) */}
                <Grid item xs={12}>
                  <Divider sx={{ my: 1.5 }} />
                  <Typography variant="subtitle2" sx={{ mt: 1, fontWeight: 600 }}>確認事項（チェックリスト）</Typography>
                  {(formData.taskCheckItems || []).map((item, index) => (
                    <Stack key={index} direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, mb: 0.5 }}>
                      <Checkbox
                        checked={item.checked}
                        size="small"
                        onChange={(e) => {
                          const next = [...(formData.taskCheckItems || [])];
                          next[index].checked = e.target.checked;
                          setFormData({ ...formData, taskCheckItems: next });
                        }}
                      />
                      <TextField
                        label={`項目 ${index + 1}`}
                        value={item.label}
                        onChange={(e) => {
                          const next = [...(formData.taskCheckItems || [])];
                          next[index].label = e.target.value;
                          setFormData({ ...formData, taskCheckItems: next });
                        }}
                        size="small"
                        sx={{ flex: 1 }}
                      />
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => {
                          const next = (formData.taskCheckItems || []).filter((_, i) => i !== index);
                          setFormData({ ...formData, taskCheckItems: next });
                        }}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ))}
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() => {
                      const next = [...(formData.taskCheckItems || []), { label: '', checked: false }];
                      setFormData({ ...formData, taskCheckItems: next });
                    }}
                    sx={{ mt: 0.5 }}
                  >
                    チェック項目を追加
                  </Button>
                </Grid>

                {/* 成果物 (deliverables) */}
                <Grid item xs={12}>
                  <Divider sx={{ my: 1.5 }} />
                  <TextField
                    name="taskDeliverables"
                    label="成果物（メモ）"
                    value={formData.taskDeliverables || ''}
                    onChange={handleChange}
                    fullWidth
                    multiline
                    rows={3}
                    size="small"
                    placeholder="このタスクで作成する納品物や成果物、参考メモを入力してください..."
                    helperText="タスクに紐づく提出ファイルや成果物に関する説明"
                  />
                </Grid>
              </Grid>
            )}

            {/* Phase Type Fields */}
            {normalizedType === 'Phase' && (
              <>
                <Grid item xs={12}>
                  <FormControl fullWidth error={!!errors.phaseTargetTaskId} size="small" sx={{ mb: 1.5 }}>
                    <InputLabel id="phase-target-task-label">対象タスク (未完了のみ) *</InputLabel>
                    <Select
                      labelId="phase-target-task-label"
                      value={formData.phaseTargetTaskId || ''}
                      label="対象タスク (未完了のみ) *"
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormData({ ...formData, phaseTargetTaskId: val || null });
                        if (errors.phaseTargetTaskId) setErrors({ ...errors, phaseTargetTaskId: undefined });
                      }}
                      required
                    >
                      {tasksFromProps
                        .filter(t => t.status !== 'completed' && t.status !== 'cancelled')
                        .map(t => (
                          <MenuItem key={t.id} value={String(t.id)}>
                            {formatTaskLabel(t.shotID, t.name || `Task ${t.id}`)}
                          </MenuItem>
                        ))}
                    </Select>
                    {errors.phaseTargetTaskId && <FormHelperText>{errors.phaseTargetTaskId}</FormHelperText>}
                  </FormControl>
                </Grid>
                <Grid item xs={12}>
                  {/* Phase Name reuses Title */}
                </Grid>
                <Grid item xs={12}>
                  <DatePicker
                    label="目標日 *"
                    value={parseDateString(formData.startDate)}
                    onChange={(newValue) => handleDateChange('startDate', newValue)}
                    slotProps={{ textField: { fullWidth: true, size: 'small', required: true, error: !!errors.startDate, helperText: errors.startDate } }}
                  />
                </Grid>
              </>
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
                      <MenuItem value="on-hold">保留中</MenuItem>
                      <MenuItem value="cancelled">キャンセル</MenuItem>
                      <MenuItem value="delayed">遅延</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            )}

            {/* Fields for Non-Task Event Types (Generic, Meeting, Workshop, Deadline, Milestone) */}
            {formData.type && formData.type !== 'task' && formData.type !== 'Task' && formData.type !== 'project' && formData.type !== 'Project' && formData.type !== 'Phase' && formData.type !== 'phase' && (
              <Grid item xs={12} container spacing={1.5}>
                {/* All Day Checkbox */}
                {showAllDayCheckbox && (
                  <Grid item xs={12} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={formData.allDay}
                          onChange={(e) => {
                            setFormData(prev => ({ ...prev, allDay: e.target.checked }));
                            if (e.target.checked) {
                              setFormData(prev => ({ ...prev, startTime: '', endTime: '' }));
                              // 終日にしたとき、デフォルトで期間はオフに
                              // setIsRange(false); // ユーザーの操作性を考えて維持または自動設定するか... 一旦維持
                            } else {
                              setIsRange(false); // 終日解除なら期間も解除
                            }
                          }}
                          size="small"
                        />
                      }
                      label="終日"
                    />

                    {formData.type === 'Generic' && formData.allDay && (
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={isRange}
                            onChange={(e) => setIsRange(e.target.checked)}
                            size="small"
                          />
                        }
                        label="期間（終了日を設定）"
                      />
                    )}
                  </Grid>
                )}

                {/* 実施日/開始日 */}
                <Grid item xs={(formData.allDay || !showTimeFields) ? (showEndDate ? 6 : 12) : 12}>
                  <DatePicker
                    label={(formData.type === 'Deadline' || formData.type === 'Milestone') ? "期日 *" : (formData.type === 'Meeting' || formData.type === 'Workshop' || formData.type === 'Generic') ? "実施日 *" : "開始日 *"}
                    value={parseDateString(formData.startDate)}
                    onChange={(newValue) => handleDateChange('startDate', newValue)}
                    slotProps={{ textField: { fullWidth: true, size: 'small', required: true, error: !!errors.startDate, helperText: errors.startDate } }}
                  />
                </Grid>

                {/* 終了日（Genericで終日の場合のみ表示） */}
                {showEndDate && (
                  <Grid item xs={6}>
                    <DatePicker
                      label="終了日 *"
                      value={parseDateString(formData.endDate)}
                      onChange={(newValue) => handleDateChange('endDate', newValue)}
                      slotProps={{ textField: { fullWidth: true, size: 'small', required: true, error: !!errors.endDate, helperText: errors.endDate } }}
                    />
                  </Grid>
                )}
                {/* 開始時間・終了時間（会議・ワークショップ・Genericで時間ありのとき、横並びで表示） */}
                {showTimeFields && (
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
                        value={parseTimeString(formData.endTime, parseDateString(formData.startDate))}
                        onChange={(newValue) => handleTimeChange('endTime', newValue)}
                        slotProps={{ textField: { fullWidth: true, size: 'small', required: true, error: !!errors.endTime, helperText: errors.endTime } }}
                      />
                    </Grid>
                  </>
                )}
                {/* Location (for Meeting, Workshop, Generic) */}
                {showLocation && (
                  <Grid item xs={12}>
                    <TextField label="場所" name="location" value={formData.location} onChange={handleChange} fullWidth size="small" sx={{ mb: 1 }} />
                  </Grid>
                )}

                {/* Participants (for Meeting, Workshop, Generic) */}
                {showParticipants && (
                  <Grid item xs={12}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="participants-select-label">参加者</InputLabel>
                      <Select
                        labelId="participants-select-label"
                        multiple
                        value={selectedParticipants.map(p => `${p.type}-${p.id}`)}
                        label="参加者"
                        onChange={(e) => {
                          const values = typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value as string[];
                          const newSelected = values.map((val) => {
                            const match = val.match(/^(user|group)-(\d+)$/);
                            if (!match) return null;
                            const type = match[1] as 'user' | 'group';
                            const id = match[2];
                            return participantOptions.find(opt => opt.type === type && opt.id === id);
                          }).filter((p): p is ParticipantOption => p !== null && p !== undefined);
                          setSelectedParticipants(newSelected);
                        }}
                        renderValue={(selected) => (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {selected.map((val) => {
                              const match = val.match(/^(user|group)-(\d+)$/);
                              if (!match) return null;
                              const type = match[1];
                              const id = match[2];
                              const option = participantOptions.find(opt => opt.type === type && opt.id === id);
                              return <Chip key={val} label={option?.label || val} size="small" />;
                            })}
                          </Box>
                        )}
                      >
                        {participantOptions.map((option) => (
                          <MenuItem key={`${option.type}-${option.id}`} value={`${option.type}-${option.id}`}>
                            {option.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                )}
              </Grid>
            )}
            {/* Description (Moved to top) */}
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