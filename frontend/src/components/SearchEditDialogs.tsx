import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Select, MenuItem, FormControl, InputLabel,
  Stack, CircularProgress, Alert, SelectChangeEvent, Box, Chip, Divider, Typography, Checkbox, FormControlLabel, IconButton,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import api, { mockDataApi, fetchProjectRoles, createScoreUserRole, updateScoreUserRole, deleteScoreUserRole } from '../services/api';
import { usePageState } from '../contexts/PageStateContext';
import { Project, Task, User, BackendEvent, CalendarEvent } from '../types';
import { getStatusOptionsFor } from '../utils/taskStatus';
import EventAddModal from './EventAddModal';
import { Group } from '../types';
import { TaskLabel } from '@/components/common/TaskLabel';

// --- ProjectEditDialog ---
interface ProjectEditDialogProps {
  open: boolean;
  projectId: number | null;
  onClose: () => void;
  onSaved: () => void;
}

export const ProjectEditDialog: React.FC<ProjectEditDialogProps> = ({ open, projectId, onClose, onSaved }) => {
  const { globalData } = usePageState();
  const users = globalData.users as User[];
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    status: 'planning',
    priority: '',
    startDate: '',
    endDate: '',
    color: '#1976d2',
    display_status: 'online',
  });
  const [directorId, setDirectorId] = useState<number | ''>('');
  const [pmId, setPmId] = useState<number | ''>('');
  const [existingRoles, setExistingRoles] = useState<any[]>([]);

  useEffect(() => {
    if (!open || projectId == null) return;
    setError(null);
    setLoading(true);
    Promise.all([
      api.get<Project>(`/projects/${projectId}`),
      fetchProjectRoles(projectId).catch(() => []),
    ]).then(([res, roles]) => {
        const p = res.data;
        const startStr = p.start_date ? (typeof p.start_date === 'string' ? p.start_date.slice(0, 10) : (p.start_date as Date).toISOString?.()?.slice(0, 10)) : '';
        const endStr = p.end_date ? (typeof p.end_date === 'string' ? p.end_date.slice(0, 10) : (p.end_date as Date).toISOString?.()?.slice(0, 10)) : '';
        setForm({
          name: p.name ?? '',
          description: p.description ?? '',
          status: (p.status as string) ?? 'planning',
          priority: (p.priority as string) ?? '',
          startDate: startStr,
          endDate: endStr,
          color: p.color ?? '#1976d2',
          display_status: p.display_status ?? 'online',
        });
        setExistingRoles(roles as any[]);
        const director = (roles as any[]).find((r: any) => r.role === 'director');
        const pm = (roles as any[]).find((r: any) => r.role === 'pm');
        setDirectorId(director ? director.user_id : '');
        setPmId(pm ? pm.user_id : '');
      })
      .catch(() => setError('プロジェクトの取得に失敗しました'))
      .finally(() => setLoading(false));
  }, [open, projectId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | SelectChangeEvent<string>) => {
    const name = e.target.name;
    const value = e.target.value;
    if (name) setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async () => {
    if (projectId == null) return;
    if (directorId === '' || pmId === '') {
      setError('DirectorとPMは必須です');
      return;
    }
    if (directorId === pmId) {
      setError('DirectorとPMには異なるユーザーを指定してください');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.put(`/projects/${projectId}`, {
        name: form.name,
        description: form.description || null,
        status: form.status,
        priority: form.priority || null,
        start_date: form.startDate || null,
        end_date: form.endDate || null,
        color: form.color,
        display_status: form.display_status,
      });
    } catch {
      setError('プロジェクトの保存に失敗しました');
      setSaving(false);
      return;
    }
    // ロール保存: 失敗しても保存自体は成功
    try {
      const toDelete = existingRoles.filter(r => r.role === 'director' || r.role === 'pm');
      const toKeep = existingRoles.filter(r => r.role !== 'director' && r.role !== 'pm');
      for (const r of toDelete) {
        await deleteScoreUserRole(r.id);
      }
      // upsert: 他ロールが残存している場合はPATCH、なければPOST
      const upsertRole = async (userId: number, role: string) => {
        const existing = toKeep.find(r => r.user_id === userId);
        if (existing) {
          await updateScoreUserRole(existing.id, { role });
        } else {
          await createScoreUserRole({ user_id: userId, project_id: projectId!, role });
        }
      };
      if (directorId) await upsertRole(directorId as number, 'director');
      if (pmId) await upsertRole(pmId as number, 'pm');
    } catch (roleErr) {
      console.error('Director/PMロール保存失敗:', roleErr);
      setError('プロジェクトは保存されましたがDirector/PMロールの設定に失敗しました');
      setSaving(false);
      onSaved();
      onClose();
      return;
    }
    onSaved();
    onClose();
    setSaving(false);
  };

  if (!open) return null;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>プロジェクトを編集</DialogTitle>
      <DialogContent>
        {loading && <Box sx={{ py: 2, textAlign: 'center' }}><CircularProgress size={24} /></Box>}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {!loading && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField name="name" label="プロジェクト名" value={form.name} onChange={handleChange} fullWidth size="small" required />
            <TextField name="description" label="説明" value={form.description} onChange={handleChange} fullWidth multiline rows={2} size="small" />
            <FormControl fullWidth size="small">
              <InputLabel>Director</InputLabel>
              <Select value={directorId} label="Director" onChange={(e) => setDirectorId(e.target.value as number)}>
                {users.map(u => (
                  <MenuItem key={u.id} value={u.id}>
                    {u.full_name || u.username || u.name || u.email}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>PM</InputLabel>
              <Select value={pmId} label="PM" onChange={(e) => setPmId(e.target.value as number)}>
                {users.map(u => (
                  <MenuItem key={u.id} value={u.id}>
                    {u.full_name || u.username || u.name || u.email}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>進捗</InputLabel>
              <Select name="status" value={form.status} label="進捗" onChange={handleChange}>
                <MenuItem value="planning">計画中</MenuItem>
                <MenuItem value="in-progress">進行中</MenuItem>
                <MenuItem value="completed">完了</MenuItem>
                <MenuItem value="on-hold">保留中</MenuItem>
                <MenuItem value="cancelled">キャンセル</MenuItem>
                <MenuItem value="delayed">遅延</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>表示状態</InputLabel>
              <Select name="display_status" value={form.display_status} label="表示状態" onChange={handleChange}>
                <MenuItem value="online">オンライン</MenuItem>
                <MenuItem value="offline">オフライン</MenuItem>
                <MenuItem value="archived">アーカイブ</MenuItem>
              </Select>
            </FormControl>
            <TextField name="startDate" label="開始日" type="date" value={form.startDate} onChange={handleChange} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <TextField name="endDate" label="終了日" type="date" value={form.endDate} onChange={handleChange} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <TextField name="color" label="色" type="color" value={form.color} onChange={handleChange} fullWidth size="small" />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={loading || saving}>{saving ? '保存中...' : '保存'}</Button>
      </DialogActions>
    </Dialog>
  );
};

// --- TaskEditDialog（共通タスク編集ダイアログ）---
interface TaskEditDialogProps {
  open: boolean;
  taskId: number | null;
  onClose: () => void;
  onSaved: () => void;
}

const TASK_TYPE_OPTIONS = [
  "animation", "layout", "comp", "fx", "lighting", "asset", 
  "programming", "design", "testing", "documentation", 
  "shoot", "gs", "report", "other"
];

export const TaskEditDialog: React.FC<TaskEditDialogProps> = ({ open, taskId, onClose, onSaved }) => {
  const { globalData } = usePageState();
  const projects = globalData.projects as Project[];
  const users = globalData.users as User[];
  const tasks = globalData.tasks as Task[];
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shots, setShots] = useState<{ id: number; shotID: string; seqID: string }[]>([]);
  const [dependencySelectOpen, setDependencySelectOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    status: 'todo',
    project_id: null as number | null,
    assigned_to: null as number | null,
    due_date: '',
    start_date: '',
    priority: 'medium',
    cost: 0,
    type: '',
    seqID: '',
    shotID: '',
    shot_id: null as number | null,
    dependsOn: [] as string[],
    phases: [] as { name: string; date: string }[],
    check_items: [] as { label: string; checked: boolean }[],
    deliverables: '',
  });


  useEffect(() => {
    if (!open || taskId == null) return;
    setError(null);
    setLoading(true);
    api.get<Task>(`/tasks/${taskId}`)
      .then((taskRes) => {
        const t = taskRes.data;
        const dueStr = t.due_date ? (typeof t.due_date === 'string' ? t.due_date.slice(0, 10) : (t.due_date as Date).toISOString?.()?.slice(0, 10)) : '';
        const startStr = t.start_date ? (typeof t.start_date === 'string' ? t.start_date.slice(0, 10) : (t.start_date as Date).toISOString?.()?.slice(0, 10)) : '';
        setForm({
          name: t.name ?? '',
          description: t.description ?? '',
          status: (t.status as string) ?? 'todo',
          project_id: t.project_id ?? null,
          assigned_to: t.assigned_to ?? null,
          due_date: dueStr,
          start_date: startStr,
          priority: (t.priority as string)?.toLowerCase() ?? 'medium',
          cost: t.cost ?? 0,
          type: (t as any).type?.toLowerCase() ?? (t as any).extendedProps?.type?.toLowerCase() ?? '',
          seqID: (t as any).seqID ?? (t as any).extendedProps?.seqID ?? '',
          shotID: (t as any).shotID ?? (t as any).extendedProps?.shotID ?? '',
          shot_id: (t as any).shot_id ?? null,
          dependsOn: t.dependsOn ?? [],
          phases: t.phases ?? [],
          check_items: (t as any).check_items ?? [],
          deliverables: (t as any).deliverables ?? '',
        });
      })
      .catch(() => setError('タスクの取得に失敗しました'))
      .finally(() => setLoading(false));
  }, [open, taskId]);

  useEffect(() => {
    if (!form.project_id) {
      setShots([]);
      return;
    }
    mockDataApi.getProductionTracker(form.project_id)
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


      .catch(() => console.error('Failed to fetch shots'));
  }, [form.project_id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | SelectChangeEvent<string | number>) => {
    const name = e.target.name;
    const value = e.target.value;
    if (name === 'project_id' || name === 'assigned_to' || name === 'shot_id') {
      setForm((prev) => {
        const next = { ...prev, [name]: value === '' ? null : Number(value) };
        if (name === 'project_id' && prev.project_id !== next.project_id) next.dependsOn = [];
        if (name === 'shot_id') {
          const selectedShot = shots.find(s => s.id === Number(value));
          if (selectedShot) {
            next.seqID = selectedShot.seqID;
            next.shotID = selectedShot.shotID;
          } else {
            next.seqID = '';
            next.shotID = '';
          }
        }
        return next;
      });
    } else if (name === 'cost') {

      setForm((prev) => ({ ...prev, [name]: Number(value) || 0 }));
    } else if (name) {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleMultiSelectChange = (e: SelectChangeEvent<string[]>) => {
    const { name, value } = e.target;
    if (name === 'dependsOn') {
      setForm((prev) => ({ ...prev, dependsOn: typeof value === 'string' ? value.split(',') : value }));
    }
  };

  const handleSubmit = async () => {
    if (taskId == null) return;
    if (!form.name?.trim()) {
      setError('タスク名を入力してください');
      return;
    }
    if (!form.project_id) {
      setError('プロジェクトを選択してください');
      return;
    }
    if (!form.due_date) {
      setError('期日を入力してください');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        status: form.status,
        project_id: form.project_id,
        assigned_to: form.assigned_to,
        due_date: form.due_date ? form.due_date + 'T00:00:00' : null,
        start_date: form.start_date ? form.start_date + 'T00:00:00' : null,
        priority: (form.priority || 'low').toUpperCase(),
        cost: form.cost,
        type: (form.type || '').toLowerCase(),
        shot_id: form.shot_id,
        seqID: form.seqID,
        shotID: form.shotID,
        check_items: form.check_items,
        deliverables: form.deliverables || null,


        dependsOn: form.dependsOn || [],
        phases: form.phases || [],
        display_status: 'online',
      };

      console.log("[TaskEditDialog] Saving task with phases:", form.name, payload.phases);

      await api.put(`/tasks/${taskId}`, payload);
      onSaved();
      onClose();
    } catch (err: any) {
      const msg = err.response?.data?.detail
        ? (Array.isArray(err.response.data.detail)
          ? err.response.data.detail.map((e: any) => `${e.loc?.join?.('.')}: ${e.msg}`).join('\n')
          : err.response.data.detail)
        : '保存に失敗しました';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const taskMap = React.useMemo(() => new Map(tasks.map((t) => [t.id, t.name ?? ''])), [tasks]);
  const dependOptions = tasks.filter((t) => t.id !== taskId && t.project_id === form.project_id);

  if (!open) return null;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem' }}>タスクを編集</DialogTitle>
      <DialogContent>
        {loading && <Box sx={{ py: 2, textAlign: 'center' }}><CircularProgress size={24} /></Box>}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {!loading && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField name="name" label="タスク名" value={form.name} onChange={handleChange} fullWidth size="small" required />
            <TextField name="description" label="説明" value={form.description} onChange={handleChange} fullWidth multiline rows={3} size="small" />
            <FormControl fullWidth size="small" required>
              <InputLabel>プロジェクト</InputLabel>
              <Select name="project_id" value={form.project_id ?? ''} label="プロジェクト" onChange={handleChange}>
                <MenuItem value="">選択してください</MenuItem>
                {projects.map((p) => (
                  <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField name="due_date" label="期日" type="date" value={form.due_date} onChange={handleChange} fullWidth size="small" InputLabelProps={{ shrink: true }} required />
            <TextField name="start_date" label="開始日" type="date" value={form.start_date} onChange={handleChange} fullWidth size="small" InputLabelProps={{ shrink: true }} />
            <FormControl fullWidth size="small">
              <InputLabel>担当者</InputLabel>
              <Select name="assigned_to" value={form.assigned_to ?? ''} label="担当者" onChange={handleChange}>
                <MenuItem value="">未割当</MenuItem>
                {users.map((u) => (
                  <MenuItem key={u.id} value={u.id}>{u.username || u.name || u.email}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>ステータス</InputLabel>
              <Select name="status" value={form.status} label="ステータス" onChange={handleChange}>
                {getStatusOptionsFor(form.status).map(opt => (
                  <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>優先度</InputLabel>
              <Select name="priority" value={form.priority} label="優先度" onChange={handleChange}>
                <MenuItem value="high">高</MenuItem>
                <MenuItem value="medium">中</MenuItem>
                <MenuItem value="low">低</MenuItem>
              </Select>
            </FormControl>
            <TextField name="cost" label="コスト" type="number" value={form.cost} onChange={handleChange} fullWidth size="small" inputProps={{ min: 0, step: 0.1 }} />
            <FormControl fullWidth size="small" disabled={!form.project_id}>
              <InputLabel>既存IDセット</InputLabel>
              <Select name="shot_id" value={form.shot_id ?? ''} label="既存IDセット" onChange={handleChange}>
                {!form.project_id ? (
                  <MenuItem value="" disabled>プロジェクトを先に選択してください</MenuItem>
                ) : shots.length === 0 ? (
                  <MenuItem value="" disabled>このプロジェクトにはショットがありません</MenuItem>
                ) : (
                  <MenuItem value="">（なし）</MenuItem>
                )}
                {shots.map((s) => (
                  <MenuItem key={s.id} value={s.id}>{s.seqID} / {s.shotID}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                name="seqID"
                label="シーケンスID"
                value={form.seqID}
                onChange={handleChange}
                fullWidth
                size="small"
                InputProps={{ readOnly: !!form.shot_id }}
                helperText={form.shot_id ? '自動入力' : '手動入力（レガシー用）'}
                sx={{ bgcolor: form.shot_id ? 'action.hover' : 'inherit' }}
              />
              <TextField
                name="shotID"
                label="ショットID"
                value={form.shotID}
                onChange={handleChange}
                fullWidth
                size="small"
                InputProps={{ readOnly: !!form.shot_id }}
                helperText={form.shot_id ? '自動入力' : ''}
                sx={{ bgcolor: form.shot_id ? 'action.hover' : 'inherit' }}
              />
            </Box>



            <FormControl fullWidth size="small">
              <InputLabel>Type</InputLabel>
              <Select name="type" value={form.type} label="Type" onChange={handleChange}>
                <MenuItem value="">未設定</MenuItem>
                {TASK_TYPE_OPTIONS.map((opt) => (
                  <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small" disabled={!form.project_id}>
              <InputLabel>依存元タスク</InputLabel>
              <Select
                multiple
                name="dependsOn"
                value={form.dependsOn || []}
                label="依存元タスク"
                open={dependencySelectOpen}
                onOpen={() => setDependencySelectOpen(true)}
                onClose={() => setDependencySelectOpen(false)}
                onChange={handleMultiSelectChange}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.map((value) => {
                      const id = parseInt(String(value).replace('task-', ''), 10);
                      const name = taskMap.get(id);
                      return <Chip key={value} label={name || value} size="small" />;
                    })}
                  </Box>
                )}
              >
                {dependOptions.map((task) => (
                  <MenuItem key={task.id} value={`task-${task.id}`}>
                    <TaskLabel shotId={task.shotID} title={task.name} />
                  </MenuItem>
                ))}
                <Divider />
                <Box sx={{ position: 'sticky', bottom: 0, bgcolor: 'background.paper', zIndex: 1, width: '100%', display: 'flex', justifyContent: 'flex-end', py: 1, px: 1 }} onClick={(e) => e.stopPropagation()}>
                  <Button onClick={() => setDependencySelectOpen(false)} size="small" variant="contained">完了</Button>
                </Box>
              </Select>
            </FormControl>

            <Typography variant="subtitle2" sx={{ mt: 1 }}>段階目標 (Phases)</Typography>
            {form.phases.map((phase, index) => (
              <Stack direction="row" spacing={1} key={index} alignItems="center">
                <TextField
                  label="目標名"
                  value={phase.name}
                  onChange={(e) => {
                    const newPhases = [...form.phases];
                    newPhases[index].name = e.target.value;
                    setForm({ ...form, phases: newPhases });
                  }}
                  size="small"
                  sx={{ flex: 1 }}
                />
                <TextField
                  type="date"
                  value={phase.date}
                  onChange={(e) => {
                    const newPhases = [...form.phases];
                    newPhases[index].date = e.target.value;
                    setForm({ ...form, phases: newPhases });
                  }}
                  size="small"
                  sx={{ width: 150 }}
                  InputLabelProps={{ shrink: true }}
                />
                <Button color="error" size="small" style={{ minWidth: '40px' }} onClick={() => {
                  const newPhases = form.phases.filter((_, i) => i !== index);
                  setForm({ ...form, phases: newPhases });
                }}>×</Button>
              </Stack>
            ))}
            <Button variant="outlined" size="small" onClick={() => {
              setForm({ ...form, phases: [...form.phases, { name: '', date: '' }] });
            }}>段階目標を追加</Button>

            {/* チェックリスト (check_items) */}
            <Divider />
            <Typography variant="subtitle2" sx={{ mt: 1 }}>チェックリスト</Typography>
            {form.check_items.map((item, index) => (
              <Stack direction="row" spacing={1} key={index} alignItems="center">
                <Checkbox
                  checked={item.checked}
                  size="small"
                  onChange={(e) => {
                    const next = [...form.check_items];
                    next[index].checked = e.target.checked;
                    setForm({ ...form, check_items: next });
                  }}
                />
                <TextField
                  label={`項目 ${index + 1}`}
                  value={item.label}
                  onChange={(e) => {
                    const next = [...form.check_items];
                    next[index].label = e.target.value;
                    setForm({ ...form, check_items: next });
                  }}
                  size="small"
                  sx={{ flex: 1 }}
                />
                <IconButton size="small" color="error" onClick={() => {
                  setForm({ ...form, check_items: form.check_items.filter((_, i) => i !== index) });
                }}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setForm({ ...form, check_items: [...form.check_items, { label: '', checked: false }] })}
            >
              チェック項目を追加
            </Button>

            {/* 成果物 (deliverables) */}
            <Divider />
            <TextField
              name="deliverables"
              label="成果物"
              value={form.deliverables}
              onChange={handleChange}
              fullWidth
              multiline
              rows={2}
              size="small"
              helperText="このタスクで生成・提出するファイルや成果物の説明"
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={loading || saving}>{saving ? '保存中...' : '保存'}</Button>
      </DialogActions>
    </Dialog>
  );
};

// --- EventEditDialog (EventAddModal を利用) ---
function backendEventToCalendarEvent(be: BackendEvent, projectDisplayStatus?: string): CalendarEvent {
  const startStr = be.start_time ? (typeof be.start_time === 'string' ? be.start_time : (be.start_time as Date).toISOString?.()) : '';
  const endStr = be.end_time ? (typeof be.end_time === 'string' ? be.end_time : (be.end_time as Date).toISOString?.()) : '';
  return {
    id: `event-${be.id}`,
    title: be.title ?? '',
    start: startStr,
    end: endStr || undefined,
    allDay: be.allDay ?? false,
    extendedProps: {
      type: (be.type as string) || 'Generic',
      description: be.description ?? undefined,
      location: be.location ?? undefined,
      projectId: be.project_id ?? undefined,
      displayStatus: projectDisplayStatus as 'online' | 'offline' | 'archived' | undefined,
    },
  };
}

interface EventEditDialogProps {
  open: boolean;
  eventId: number | null;
  onClose: () => void;
  onSaved: () => void;
}

export const EventEditDialog: React.FC<EventEditDialogProps> = ({ open, eventId, onClose, onSaved }) => {
  const { globalData } = usePageState();
  const projects = globalData.projects as Project[];
  const users = globalData.users as User[];
  const tasks = globalData.tasks as Task[];
  const groups = globalData.groups as Group[];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventToEdit, setEventToEdit] = useState<CalendarEvent | null>(null);

  useEffect(() => {
    if (!open || eventId == null) return;
    setError(null);
    setEventToEdit(null);
    setLoading(true);
    api.get<BackendEvent>(`/calendar/events/${eventId}`)
      .then((eventRes) => {
        const be = eventRes.data;
        const project = be.project_id ? projects.find((p) => p.id === be.project_id) : undefined;
        setEventToEdit(backendEventToCalendarEvent(be, project?.display_status ?? undefined));
      })
      .catch(() => setError('イベントの取得に失敗しました'))
      .finally(() => setLoading(false));
  }, [open, eventId, projects]);

  const handleSave = async (modalData: any) => {
    if (eventId == null) return;
    try {
      const payload: Record<string, unknown> = {
        title: modalData.title,
        description: modalData.description ?? null,
        type: modalData.type ?? 'Generic',
        start_time: modalData.start_time ?? null,
        end_time: modalData.end_time ?? null,
        allDay: modalData.allDay ?? false,
        location: modalData.location ?? null,
        project_id: modalData.project_id != null ? Number(modalData.project_id) : (modalData.projectId ? Number(modalData.projectId) : null),
        participants: modalData.participants ?? null,
      };
      await api.put(`/calendar/events/${eventId}`, payload);
      onSaved();
      onClose();
    } catch {
      setError('保存に失敗しました');
    }
  };

  if (!open) return null;
  if (loading) {
    return (
      <Dialog open={open} onClose={onClose}>
        <DialogContent><Box sx={{ py: 2, textAlign: 'center' }}><CircularProgress /></Box></DialogContent>
      </Dialog>
    );
  }
  if (error || !eventToEdit) {
    return (
      <Dialog open={open} onClose={onClose}>
        <DialogTitle>イベントを編集</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>
        <DialogActions><Button onClick={onClose}>閉じる</Button></DialogActions>
      </Dialog>
    );
  }
  return (
    <EventAddModal
      open={open}
      onClose={onClose}
      onSave={handleSave}
      initialDate={eventToEdit.start ? new Date(eventToEdit.start as string) : null}
      eventToEdit={eventToEdit}
      projects={projects}
      users={users}
      tasks={tasks}
      groups={groups}
      canCreateProject={false}
    />
  );
};
