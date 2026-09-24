import React from 'react';
import {
    Box, Typography, Checkbox, FormControlLabel, TextField, List,
    ListItem, useTheme, Avatar, Button, FormControl, Select, MenuItem, InputLabel,
    Autocomplete, Grid, CircularProgress
} from '@mui/material';
import { Task, User, Project } from '../types';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import ChecklistIcon from '@mui/icons-material/Checklist';
import AssignmentIcon from '@mui/icons-material/Assignment';
import FolderIcon from '@mui/icons-material/Folder';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import AddIcon from '@mui/icons-material/Add';
import { format, parseISO, isValid } from 'date-fns';
import { ja } from 'date-fns/locale';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import HistoryIcon from '@mui/icons-material/History';
import SaveIcon from '@mui/icons-material/Save';
import { useAuth } from '../contexts/AuthContext';
import { mockDataApi } from '../services/api';
import { TaskLabel } from '@/components/common/TaskLabel';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import {
    getTaskStatusColor,
    getGatedStatusOptions,
    getTaskStatusCategory,
} from '../utils/taskStatus';
import { useAllowedTransitions } from '../hooks/useAllowedTransitions';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';

interface TaskQuickDetailProps {
    task: Task;
    projects: Project[];
    users: User[];
    onUpdate: (taskId: number, updates: Partial<Task>) => Promise<void>;
    onEditFull?: (task: Task) => void;
    tasks?: Task[];
    onEdit?: () => void;
}

const formatDate = (dateInput: string | null | undefined): string => {
    if (!dateInput) return '未設定';
    try {
        const dateObj = parseISO(dateInput);
        if (isValid(dateObj)) return format(dateObj, 'yyyy年M月d日', { locale: ja });
        return '無効な日付';
    } catch { return '日付エラー'; }
};

export const TaskQuickDetail: React.FC<TaskQuickDetailProps> = ({ task, projects, users, onUpdate, onEditFull, tasks = [], onEdit }) => {
    const theme = useTheme();
    const isDark = theme.palette.mode === 'dark';
    const project = projects.find(p => p.id === task.project_id);
    const assignee = users.find(u => u.id === task.assigned_to);

    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    const { data: allowedTransitions } = useAllowedTransitions(task.id, true, task.status);

    // Form states
    const [editName, setEditName] = React.useState(task.name);
    const [editDescription, setEditDescription] = React.useState(task.description || '');
    const [editStatus, setEditStatus] = React.useState(task.status || 'wt');
    const [editProjectId, setEditProjectId] = React.useState<number | string>(task.project_id || '');
    const [editAssignedTo, setEditAssignedTo] = React.useState<number | string>(task.assigned_to || '');
    const [editStartDate, setEditStartDate] = React.useState(task.start_date ? task.start_date.split('T')[0] : '');
    const [editDueDate, setEditDueDate] = React.useState(task.due_date ? task.due_date.split('T')[0] : '');
    const [editCost, setEditCost] = React.useState<number | string>(task.cost !== null && task.cost !== undefined ? task.cost : '');
    const [editPriority, setEditPriority] = React.useState(task.priority ? task.priority.toLowerCase() : 'low');
    const [editTaskType, setEditTaskType] = React.useState(task.type || '');
    const [editSeqID, setEditSeqID] = React.useState(task.seqID || '');
    const [editShotID, setEditShotID] = React.useState(task.shotID || '');
    const [editShotRelId, setEditShotRelId] = React.useState<number | null>(task.shot_id || null);
    const [editDependsOn, setEditDependsOn] = React.useState<string[]>(task.dependsOn || []);
    const [localCheckItems, setLocalCheckItems] = React.useState<{ label: string; checked: boolean }[]>(task.check_items || []);
    const [localDeliverables, setLocalDeliverables] = React.useState<string>(task.deliverables || '');
    const [editPhases, setEditPhases] = React.useState<{ name: string; date: string; is_completed?: boolean }[]>(task.phases || []);
    const [newItemText, setNewItemText] = React.useState('');
    const [isSaving, setIsSaving] = React.useState(false);

    const [shots, setShots] = React.useState<{ id: number; shotID: string; seqID: string }[]>([]);

    // Reset form when active task changes
    React.useEffect(() => {
        setEditName(task.name);
        setEditDescription(task.description || '');
        setEditStatus(task.status || 'wt');
        setEditProjectId(task.project_id || '');
        setEditAssignedTo(task.assigned_to || '');
        setEditStartDate(task.start_date ? task.start_date.split('T')[0] : '');
        setEditDueDate(task.due_date ? task.due_date.split('T')[0] : '');
        setEditCost(task.cost !== null && task.cost !== undefined ? task.cost : '');
        setEditPriority(task.priority ? task.priority.toLowerCase() : 'low');
        setEditTaskType(task.type || '');
        setEditSeqID(task.seqID || '');
        setEditShotID(task.shotID || '');
        setEditShotRelId(task.shot_id || null);
        setEditDependsOn(task.dependsOn || []);
        setLocalCheckItems(task.check_items || []);
        setLocalDeliverables(task.deliverables || '');
        setEditPhases(task.phases || []);
    }, [task.id]);

    // Fetch shots when project selection changes
    React.useEffect(() => {
        if (!editProjectId) {
            setShots([]);
            return;
        }
        mockDataApi.getProductionTracker(Number(editProjectId))
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
            .catch(() => console.error('Failed to fetch shots for TaskQuickDetail'));
    }, [editProjectId]);

    const taskOptions = React.useMemo(() => {
        if (!editProjectId) return [];
        return tasks
            .filter(t => Number(t.project_id) === Number(editProjectId) && Number(t.id) !== Number(task.id))
            .map(t => ({ id: String(t.id), name: t.name || '(名称未設定)' }));
    }, [tasks, editProjectId, task.id]);

    const assigneeOptions = React.useMemo(() => {
        return users.map(u => ({
            id: u.id,
            label: u.username || u.name || u.email || `User ${u.id}`
        })).sort((a, b) => a.label.localeCompare(b.label));
    }, [users]);

    // Check if there are unsaved local modifications
    const isDirty = React.useMemo(() => {
        if (editName !== task.name) return true;
        if (editDescription !== (task.description || '')) return true;
        if (editStatus !== (task.status || 'wt')) return true;
        if ((editAssignedTo ? Number(editAssignedTo) : null) !== (task.assigned_to || null)) return true;
        const origStart = task.start_date ? task.start_date.split('T')[0] : '';
        if (editStartDate !== origStart) return true;
        const origDue = task.due_date ? task.due_date.split('T')[0] : '';
        if (editDueDate !== origDue) return true;
        const origCost = task.cost !== null && task.cost !== undefined ? String(task.cost) : '';
        if (String(editCost) !== origCost) return true;
        const origPriority = task.priority ? task.priority.toLowerCase() : 'low';
        if (editPriority.toLowerCase() !== origPriority) return true;
        if (editTaskType !== (task.type || '')) return true;
        if (editShotRelId !== (task.shot_id || null)) return true;
        if (editSeqID !== (task.seqID || '')) return true;
        if (editShotID !== (task.shotID || '')) return true;
        if (JSON.stringify(editDependsOn) !== JSON.stringify(task.dependsOn || [])) return true;
        if (localDeliverables !== (task.deliverables || '')) return true;
        if (JSON.stringify(localCheckItems) !== JSON.stringify(task.check_items || [])) return true;
        if (JSON.stringify(editPhases) !== JSON.stringify(task.phases || [])) return true;
        return false;
    }, [
        editName, editDescription, editStatus, editAssignedTo, editStartDate, editDueDate,
        editCost, editPriority, editTaskType, editShotRelId, editSeqID, editShotID,
        editDependsOn, localDeliverables, localCheckItems, editPhases, task
    ]);

    const handleSave = async () => {
        if (!isDirty || isSaving) return;
        setIsSaving(true);
        try {
            let formattedStartDate = editStartDate;
            if (formattedStartDate && !formattedStartDate.includes('T')) {
                formattedStartDate = `${formattedStartDate}T00:00:00+09:00`;
            }
            let formattedDueDate = editDueDate;
            if (formattedDueDate && !formattedDueDate.includes('T')) {
                formattedDueDate = `${formattedDueDate}T00:00:00+09:00`;
            }
            const updates: Partial<Task> = {
                name: editName,
                description: editDescription || null,
                status: editStatus,
                assigned_to: editAssignedTo ? Number(editAssignedTo) : null,
                start_date: formattedStartDate || null,
                due_date: formattedDueDate || null,
                cost: editCost !== '' ? Number(editCost) : null,
                priority: editPriority ? editPriority.toUpperCase() : 'LOW',
                type: editTaskType || null,
                shot_id: editShotRelId,
                seqID: editSeqID || null,
                shotID: editShotID || null,
                dependsOn: editDependsOn,
                deliverables: localDeliverables || null,
                check_items: localCheckItems,
                phases: editPhases,
            };
            await onUpdate(task.id, updates);
        } catch (err) {
            console.error('Failed to save task updates:', err);
        } finally {
            setIsSaving(false);
        }
    };

    const handleResetForm = () => {
        setEditName(task.name);
        setEditDescription(task.description || '');
        setEditStatus(task.status || 'wt');
        setEditProjectId(task.project_id || '');
        setEditAssignedTo(task.assigned_to || '');
        setEditStartDate(task.start_date ? task.start_date.split('T')[0] : '');
        setEditDueDate(task.due_date ? task.due_date.split('T')[0] : '');
        setEditCost(task.cost !== null && task.cost !== undefined ? task.cost : '');
        setEditPriority(task.priority ? task.priority.toLowerCase() : 'low');
        setEditTaskType(task.type || '');
        setEditSeqID(task.seqID || '');
        setEditShotID(task.shotID || '');
        setEditShotRelId(task.shot_id || null);
        setEditDependsOn(task.dependsOn || []);
        setLocalCheckItems(task.check_items || []);
        setLocalDeliverables(task.deliverables || '');
        setEditPhases(task.phases || []);
    };

    const handleAddCheckItem = () => {
        if (!newItemText.trim()) return;
        const newItems = [...localCheckItems, { label: newItemText.trim(), checked: false }];
        setLocalCheckItems(newItems);
        setNewItemText('');
        onEdit?.();
    };

    const handleToggleCheckItem = (idx: number, checked: boolean) => {
        const newItems = [...localCheckItems];
        newItems[idx] = { ...newItems[idx], checked };
        setLocalCheckItems(newItems);
        onEdit?.();
    };

    const handleDeleteCheckItem = (idx: number) => {
        const newItems = localCheckItems.filter((_, i) => i !== idx);
        setLocalCheckItems(newItems);
        onEdit?.();
    };

    const handleIncrementCost = () => {
        const currentCost = editCost !== '' ? Number(editCost) : 0;
        setEditCost(String(currentCost + 1));
        onEdit?.();
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ja}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, p: 2, position: 'relative' }}>
                {/* Basic Info Header - Unified & Prominent */}
                <Box sx={{
                    mb: 1,
                    p: 2.5,
                    borderRadius: 2,
                    background: isDark
                        ? 'linear-gradient(135deg, rgba(33, 150, 243, 0.15) 0%, rgba(33, 150, 243, 0.05) 100%)'
                        : 'linear-gradient(135deg, #e3f2fd 0%, #f1f8fe 100%)',
                    border: '1px solid',
                    borderColor: isDark ? 'rgba(33, 150, 243, 0.3)' : '#bbdefb',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                    position: 'relative',
                    overflow: 'hidden',
                    '&::before': {
                        content: '""',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '4px',
                        height: '100%',
                        backgroundColor: theme.palette.primary.main
                    }
                }}>
                    {isAdmin ? (
                        <TextField
                            value={editName}
                            onChange={(e) => {
                                setEditName(e.target.value);
                                onEdit?.();
                            }}
                            placeholder="タスク名"
                            fullWidth
                            variant="standard"
                            multiline
                            InputProps={{
                                disableUnderline: true,
                                style: {
                                    fontWeight: 800,
                                    fontSize: '1.4rem',
                                    color: isDark ? '#90caf9' : '#1976d2',
                                    letterSpacing: '-0.01em',
                                }
                            }}
                            sx={{
                                mb: 1,
                                '& .MuiInput-input': {
                                    padding: 0,
                                }
                            }}
                        />
                    ) : (
                        <Typography variant="h5" sx={{
                            fontWeight: 800,
                            mb: task.description ? 1.5 : 0,
                            lineHeight: 1.3,
                            color: isDark ? '#90caf9' : '#1976d2',
                            letterSpacing: '-0.01em',
                            fontSize: '1.4rem'
                        }}>
                            <TaskLabel shotId={task.shotID} title={task.name} fontSize="1.4rem" whiteSpace="normal" />
                        </Typography>
                    )}

                    {isAdmin ? (
                        <TextField
                            value={editDescription}
                            onChange={(e) => {
                                setEditDescription(e.target.value);
                                onEdit?.();
                            }}
                            placeholder="説明を追加..."
                            multiline
                            fullWidth
                            variant="standard"
                            InputProps={{
                                disableUnderline: true,
                                style: {
                                    fontSize: '0.95rem',
                                    lineHeight: 1.7,
                                    color: theme.palette.text.primary,
                                }
                            }}
                            sx={{
                                pt: 1.5,
                                borderTop: '1px solid',
                                borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
                                '& .MuiInput-input': {
                                    padding: 0,
                                }
                            }}
                        />
                    ) : (
                        task.description && (
                            <Typography variant="body2" sx={{
                                whiteSpace: 'pre-wrap',
                                color: theme.palette.text.primary,
                                lineHeight: 1.7,
                                fontSize: '0.95rem',
                                opacity: 0.9,
                                pt: 1.5,
                                borderTop: '1px solid',
                                borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
                            }}>
                                {task.description}
                            </Typography>
                        )
                    )}
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {/* Status Picker */}
                    <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                            <TaskAltIcon fontSize="small" color="primary" /> ステータス
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                            {getGatedStatusOptions(editStatus, allowedTransitions?.allowedNext, allowedTransitions?.actorRole).map((opt) => {
                                const s = opt.value;
                                const selected = editStatus === s;
                                const color = getTaskStatusColor(s);
                                const tooltipTitle = opt.disabled
                                    ? opt.disabledReason || '選択できません'
                                    : (opt.recommended ? '推奨される次の遷移先' : '');
                                return (
                                    <Tooltip key={s} title={tooltipTitle} disableHoverListener={!tooltipTitle}>
                                        <span>
                                            <Chip
                                                label={opt.label}
                                                size="small"
                                                disabled={opt.disabled}
                                                onClick={opt.disabled ? undefined : () => {
                                                    setEditStatus(s);
                                                    onEdit?.();
                                                }}
                                                variant={selected ? "filled" : "outlined"}
                                                sx={{
                                                    transition: 'all 0.2s',
                                                    px: 0.5,
                                                    backgroundColor: selected ? color : 'transparent',
                                                    color: selected ? 'white' : 'text.primary',
                                                    borderColor: color,
                                                    borderWidth: opt.recommended && !selected ? 2 : 1,
                                                    fontWeight: selected ? 700 : (opt.recommended ? 700 : 500),
                                                    '&:hover': opt.disabled ? undefined : {
                                                        backgroundColor: color,
                                                        color: 'white',
                                                    }
                                                }}
                                            />
                                        </span>
                                    </Tooltip>
                                );
                            })}
                        </Box>
                    </Box>

                    {/* Detailed Fields Section */}
                    <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                            <FolderIcon fontSize="small" color="primary" /> 詳細設定
                        </Typography>
                        {isAdmin ? (
                            <Box sx={{
                                p: 2,
                                borderRadius: 1.5,
                                bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
                                border: '1px solid',
                                borderColor: 'divider',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2
                            }}>
                                {/* Project & Assignee */}
                                <Grid container spacing={1.5}>
                                    <Grid item xs={12}>
                                        <FormControl fullWidth size="small">
                                            <InputLabel>担当者</InputLabel>
                                            <Select
                                                value={editAssignedTo}
                                                label="担当者"
                                                onChange={(e) => {
                                                    setEditAssignedTo(e.target.value);
                                                    onEdit?.();
                                                }}
                                            >
                                                <MenuItem value=""><em>未割り当て</em></MenuItem>
                                                {assigneeOptions.map((opt) => (
                                                    <MenuItem key={opt.id} value={opt.id}>{opt.label}</MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                    </Grid>
                                </Grid>

                                {/* Dates */}
                                <Grid container spacing={1.5}>
                                    <Grid item xs={6}>
                                        <DatePicker
                                            label="開始日"
                                            value={editStartDate ? parseISO(editStartDate) : null}
                                            onChange={(val) => {
                                                const formattedStartDate = val && isValid(val) ? format(val, 'yyyy-MM-dd') : '';
                                                setEditStartDate(formattedStartDate);
                                                onEdit?.();
                                            }}
                                            slotProps={{ textField: { size: 'small', fullWidth: true } }}
                                        />
                                    </Grid>
                                    <Grid item xs={6}>
                                        <DatePicker
                                            label="期日"
                                            value={editDueDate ? parseISO(editDueDate) : null}
                                            onChange={(val) => {
                                                const formattedDueDate = val && isValid(val) ? format(val, 'yyyy-MM-dd') : '';
                                                setEditDueDate(formattedDueDate);
                                                onEdit?.();
                                            }}
                                            slotProps={{ textField: { size: 'small', fullWidth: true } }}
                                        />
                                    </Grid>
                                </Grid>

                                {/* Cost & Priority */}
                                <Grid container spacing={1.5}>
                                    <Grid item xs={6}>
                                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                                            <TextField
                                                label="コスト（時間）"
                                                type="number"
                                                value={editCost}
                                                onChange={(e) => {
                                                    setEditCost(e.target.value);
                                                    onEdit?.();
                                                }}
                                                size="small"
                                                fullWidth
                                                inputProps={{ step: "0.1", min: 0 }}
                                            />
                                            <IconButton
                                                size="small"
                                                onClick={handleIncrementCost}
                                                sx={{ border: '1px solid rgba(0,0,0,0.23)', borderRadius: '4px', p: '5px' }}
                                                title="コストを+1時間"
                                            >
                                                <AddIcon fontSize="small" />
                                            </IconButton>
                                        </Box>
                                    </Grid>
                                    <Grid item xs={6}>
                                        <FormControl fullWidth size="small">
                                            <InputLabel>優先度</InputLabel>
                                            <Select
                                                value={editPriority.toLowerCase()}
                                                label="優先度"
                                                onChange={(e) => {
                                                    setEditPriority(e.target.value);
                                                    onEdit?.();
                                                }}
                                            >
                                                <MenuItem value="high">高</MenuItem>
                                                <MenuItem value="medium">中</MenuItem>
                                                <MenuItem value="low">低</MenuItem>
                                            </Select>
                                        </FormControl>
                                    </Grid>
                                </Grid>

                                {/* Task Type */}
                                <FormControl fullWidth size="small">
                                    <InputLabel>タスクタイプ</InputLabel>
                                    <Select
                                        value={editTaskType}
                                        label="タスクタイプ"
                                        onChange={(e) => {
                                            setEditTaskType(e.target.value);
                                            onEdit?.();
                                        }}
                                    >
                                        <MenuItem value="">未設定</MenuItem>
                                        {['animation', 'layout', 'comp', 'fx', 'lighting', 'asset', 'programming', 'design', 'testing', 'documentation', 'shoot', 'gs', 'report', 'other'].map((type) => (
                                            <MenuItem key={type} value={type}>{type}</MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>

                                {/* Shot Link */}
                                <FormControl fullWidth size="small" disabled={!editProjectId}>
                                    <InputLabel>既存IDセット</InputLabel>
                                    <Select
                                        value={editShotRelId ?? ''}
                                        label="既存IDセット"
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val === '') {
                                                setEditShotRelId(null);
                                                setEditSeqID('');
                                                setEditShotID('');
                                            } else {
                                                const shotNum = Number(val);
                                                const selectedShot = shots.find(s => s.id === shotNum);
                                                setEditShotRelId(shotNum);
                                                setEditSeqID(selectedShot?.seqID ?? '');
                                                setEditShotID(selectedShot?.shotID ?? '');
                                            }
                                            onEdit?.();
                                        }}
                                    >
                                        {!editProjectId ? (
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

                                {/* Seq ID & Shot ID TextFields */}
                                <Grid container spacing={1.5}>
                                    <Grid item xs={6}>
                                        <TextField
                                            label="シーケンスID"
                                            value={editSeqID}
                                            onChange={(e) => {
                                                setEditSeqID(e.target.value);
                                                onEdit?.();
                                            }}
                                            size="small"
                                            fullWidth
                                            InputProps={{ readOnly: !!editShotRelId }}
                                            helperText={editShotRelId ? '自動入力' : '手動入力用'}
                                            FormHelperTextProps={{ style: { fontSize: '0.65rem', margin: '3px 0 0' } }}
                                        />
                                    </Grid>
                                    <Grid item xs={6}>
                                        <TextField
                                            label="ショットID"
                                            value={editShotID}
                                            onChange={(e) => {
                                                setEditShotID(e.target.value);
                                                onEdit?.();
                                            }}
                                            size="small"
                                            fullWidth
                                            InputProps={{ readOnly: !!editShotRelId }}
                                        />
                                    </Grid>
                                </Grid>

                                {/* Dependencies */}
                                <Autocomplete
                                    multiple
                                    options={taskOptions}
                                    getOptionLabel={(option) => option.name}
                                    value={taskOptions.filter(opt => editDependsOn.includes(opt.id))}
                                    onChange={(_event, newValue) => {
                                        const newDependsOn = newValue.map(v => v.id);
                                        setEditDependsOn(newDependsOn);
                                        onEdit?.();
                                    }}
                                    isOptionEqualToValue={(option, value) => option.id === value.id}
                                    disabled={!editProjectId}
                                    renderInput={(params) => (
                                      <TextField
                                        {...params}
                                        variant="outlined"
                                        label="依存元タスク"
                                        placeholder="依存するタスクを選択"
                                        size="small"
                                      />
                                    )}
                                    renderTags={(value, getTagProps) =>
                                      value.map((option, index) => {
                                        const { key, ...tagProps } = getTagProps({ index });
                                        return (
                                          <Chip key={key} variant="outlined" label={option.name} {...tagProps} size="small" />
                                        );
                                      })
                                    }
                                />
                            </Box>
                        ) : (
                            <Box sx={{
                                p: 2,
                                borderRadius: 1.5,
                                bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
                                border: '1px solid',
                                borderColor: 'divider',
                                display: 'grid',
                                gridTemplateColumns: 'repeat(2, 1fr)',
                                gap: 2
                            }}>
                                <Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                        プロジェクト
                                    </Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                        {project?.name || '未設定'}
                                    </Typography>
                                </Box>
                                <Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                        担当者
                                    </Typography>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Avatar sx={{
                                            width: 20,
                                            height: 20,
                                            fontSize: '0.65rem',
                                            bgcolor: theme.palette.primary.main,
                                        }}>
                                            {assignee?.username?.[0]?.toUpperCase() || '?'}
                                        </Avatar>
                                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                            {assignee?.username || '未割り当て'}
                                        </Typography>
                                    </Box>
                                </Box>
                                <Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                        開始日
                                    </Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                        {formatDate(task.start_date)}
                                    </Typography>
                                </Box>
                                <Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                        期日
                                    </Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }} color={task.due_date && new Date(task.due_date) < new Date() && getTaskStatusCategory(task.status) !== 'completed' && getTaskStatusCategory(task.status) !== 'held' ? 'error.main' : 'inherit'}>
                                        {formatDate(task.due_date)}
                                    </Typography>
                                </Box>
                                <Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                        コスト
                                    </Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                        {task.cost ? `${task.cost} 時間` : '未設定'}
                                    </Typography>
                                </Box>
                                <Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                        優先度
                                    </Typography>
                                    <Chip
                                        label={task.priority ? (task.priority.toLowerCase() === 'high' ? '高' : task.priority.toLowerCase() === 'medium' ? '中' : '低') : '低'}
                                        size="small"
                                        sx={{
                                            fontWeight: 700,
                                            height: 20,
                                            fontSize: '0.75rem',
                                            bgcolor: task.priority?.toLowerCase() === 'high' ? 'error.light' : task.priority?.toLowerCase() === 'medium' ? 'warning.light' : 'action.selected',
                                            color: task.priority?.toLowerCase() === 'high' ? 'error.contrastText' : task.priority?.toLowerCase() === 'medium' ? 'warning.contrastText' : 'text.primary',
                                        }}
                                    />
                                </Box>
                                <Box sx={{ gridColumn: 'span 2' }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                        タスクタイプ
                                    </Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                        {task.type || '未設定'}
                                    </Typography>
                                </Box>
                                {(task.seqID || task.shotID) && (
                                    <Box sx={{ gridColumn: 'span 2' }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                            シーケンス / ショット
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                            {task.seqID || '-'}{task.shotID ? ` / ${task.shotID}` : ''}
                                        </Typography>
                                    </Box>
                                )}
                                <Box sx={{ gridColumn: 'span 2' }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                        依存元
                                    </Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={
                                        task.dependsOn && task.dependsOn.length > 0 ? (
                                            task.dependsOn.map((depId) => {
                                                const depTask = tasks.find(t => String(t.id) === String(depId));
                                                return depTask ? depTask.name : depId;
                                            }).join(', ')
                                        ) : 'なし'
                                    }>
                                        {task.dependsOn && task.dependsOn.length > 0 ? (
                                            task.dependsOn.map((depId) => {
                                                const depTask = tasks.find(t => String(t.id) === String(depId));
                                                return depTask ? depTask.name : depId;
                                            }).join(', ')
                                        ) : 'なし'}
                                    </Typography>
                                </Box>
                            </Box>
                        )}
                    </Box>

                    {/* Phases (Sub-milestones) */}
                    {editPhases && editPhases.length > 0 && (
                        <Box>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <CalendarTodayIcon fontSize="small" color="primary" /> 段階目標
                            </Typography>
                            <List sx={{ p: 0, bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderRadius: 1 }}>
                                {editPhases.map((p, idx) => (
                                    <ListItem key={idx} sx={{ py: 0.5, px: 2 }}>
                                        <FormControlLabel
                                            control={
                                                <Checkbox
                                                    size="small"
                                                    checked={!!p.is_completed}
                                                    disabled={!isAdmin}
                                                    onChange={(e) => {
                                                        const updatedPhases = [...editPhases];
                                                        updatedPhases[idx] = { ...updatedPhases[idx], is_completed: e.target.checked };
                                                        setEditPhases(updatedPhases);
                                                        onEdit?.();
                                                    }}
                                                />
                                            }
                                            label={
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    <Typography variant="body2" sx={{
                                                        textDecoration: p.is_completed ? 'line-through' : 'none',
                                                        color: p.is_completed ? 'text.secondary' : 'text.primary',
                                                        fontWeight: 600
                                                    }}>
                                                        {p.name}
                                                    </Typography>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', px: 0.5, borderRadius: 0.5 }}>
                                                        {formatDate(p.date)}
                                                    </Typography>
                                                </Box>
                                            }
                                        />
                                    </ListItem>
                                ))}
                            </List>
                        </Box>
                    )}

                    {/* Check Items */}
                    <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <ChecklistIcon fontSize="small" color="primary" /> 確認事項
                        </Typography>
                        <List sx={{ p: 0, bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderRadius: 1 }}>
                            {localCheckItems.map((item, idx) => (
                                <ListItem
                                    key={idx}
                                    sx={{ py: 0.5, pr: 1 }}
                                    secondaryAction={
                                        isAdmin && (
                                            <IconButton edge="end" size="small" onClick={() => handleDeleteCheckItem(idx)}>
                                                <CloseIcon fontSize="inherit" />
                                            </IconButton>
                                        )
                                    }
                                >
                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                size="small"
                                                checked={item.checked}
                                                disabled={!isAdmin}
                                                onChange={(e) => handleToggleCheckItem(idx, e.target.checked)}
                                            />
                                        }
                                        label={
                                            <Typography variant="body2" sx={{
                                                textDecoration: item.checked ? 'line-through' : 'none',
                                                color: item.checked ? 'text.secondary' : 'text.primary'
                                            }}>
                                                {item.label}
                                            </Typography>
                                        }
                                    />
                                </ListItem>
                            ))}
                            {isAdmin && (
                                <Box sx={{ px: 2, pb: 2, pt: 1, display: 'flex', gap: 1 }}>
                                    <TextField
                                        size="small"
                                        placeholder="新しい項目を追加..."
                                        variant="standard"
                                        fullWidth
                                        value={newItemText}
                                        onChange={(e) => setNewItemText(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                handleAddCheckItem();
                                            }
                                        }}
                                        sx={{ '& .MuiInput-root': { fontSize: '0.85rem' } }}
                                    />
                                    <IconButton size="small" onClick={handleAddCheckItem} color="primary" disabled={!newItemText.trim()}>
                                        <AddIcon fontSize="small" />
                                    </IconButton>
                                </Box>
                            )}
                        </List>
                    </Box>

                    {/* Memo (Deliverables) */}
                    <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <AssignmentIcon fontSize="small" color="primary" /> メモ
                        </Typography>
                        <TextField
                            key={`deliverables-input-${task.id}`}
                            multiline
                            rows={3}
                            fullWidth
                            size="small"
                            placeholder={isAdmin ? "タスクに関するメモやリンク、参考情報をご記入ください..." : "メモはありません"}
                            value={localDeliverables}
                            onChange={(e) => {
                                setLocalDeliverables(e.target.value);
                                onEdit?.();
                            }}
                            disabled={!isAdmin}
                            sx={{
                                '& .MuiInputBase-root': {
                                    fontSize: '0.85rem',
                                    bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'
                                }
                            }}
                        />
                    </Box>
                </Box>

                {/* Sticky Action Footer Bar */}
                {isAdmin && (
                    <Box sx={{
                        position: 'sticky',
                        bottom: -16,
                        left: 0,
                        right: 0,
                        mx: -2,
                        mb: -2,
                        mt: 2,
                        p: 2,
                        bgcolor: isDark ? '#1e293b' : '#ffffff',
                        borderTop: '1px solid',
                        borderColor: 'divider',
                        boxShadow: isDark ? '0 -4px 20px rgba(0,0,0,0.5)' : '0 -4px 20px rgba(0,0,0,0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        zIndex: 10,
                        borderRadius: '0 0 12px 12px',
                    }}>
                        <Typography variant="caption" sx={{ fontWeight: 600, color: isDirty ? 'warning.main' : 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {isDirty ? '● 未保存の変更があります' : 'すべての変更が保存されています'}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            {isDirty && (
                                <Button
                                    size="small"
                                    variant="outlined"
                                    color="inherit"
                                    onClick={handleResetForm}
                                    disabled={isSaving}
                                >
                                    元に戻す
                                </Button>
                            )}
                            <Button
                                size="small"
                                variant="contained"
                                color="primary"
                                startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                                onClick={handleSave}
                                disabled={!isDirty || isSaving}
                                sx={{ fontWeight: 700, px: 2 }}
                            >
                                {isSaving ? '保存中...' : '保存'}
                            </Button>
                        </Box>
                    </Box>
                )}
            </Box>
        </LocalizationProvider>
    );
};
