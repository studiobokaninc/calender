import React from 'react';
import {
    Box, Typography, Divider, Chip, Checkbox, FormControlLabel, TextField, List,
    ListItem, useTheme, Avatar, Button, FormControl, Select, MenuItem, InputLabel,
    Autocomplete, Grid
} from '@mui/material';
import { Task, User, Project } from '../types';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import ChecklistIcon from '@mui/icons-material/Checklist';
import AssignmentIcon from '@mui/icons-material/Assignment';
import FolderIcon from '@mui/icons-material/Folder';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import AddIcon from '@mui/icons-material/Add';
import { format, parseISO, isValid, parse, addDays } from 'date-fns';
import { ja } from 'date-fns/locale';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import HistoryIcon from '@mui/icons-material/History';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Cancel';
import { useAuth } from '../contexts/AuthContext';
import { mockDataApi } from '../services/api';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';

interface TaskQuickDetailProps {
    task: Task;
    projects: Project[];
    users: User[];
    onUpdate: (taskId: number, updates: Partial<Task>) => Promise<void>;
    onEditFull?: (task: Task) => void;
    tasks?: Task[];
    onEdit?: () => void;
}

const getTaskStatusColor = (status?: string | null) => {
    switch (status?.toLowerCase()) {
        case 'todo': return '#2196F3';           // 青: 未着手
        case 'in-progress': return '#FF9800';    // オレンジ: 進行中
        case 'review': return '#9C27B0';        // 紫: 確認中
        case 'completed': return '#9E9E9E';     // グレー: 完了
        case 'delayed': return '#F44336';       // 赤: 遅延
        case 'retake': return '#E91E63';        // マゼンタ: リテイク
        default: return '#BDBDBD';
    }
};

const getTaskStatusLabel = (status?: string | null) => {
    switch (status?.toLowerCase()) {
        case 'todo': return '未着手';
        case 'in-progress': return '進行中';
        case 'review': return '確認中';
        case 'completed': return '完了';
        case 'delayed': return '遅延';
        case 'retake': return 'リテイク';
        default: return status || '未定';
    }
};

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

    // Form states
    const [editName, setEditName] = React.useState(task.name);
    const [editDescription, setEditDescription] = React.useState(task.description || '');
    const [editProjectId, setEditProjectId] = React.useState<number | string>(task.project_id || '');
    const [editAssignedTo, setEditAssignedTo] = React.useState<number | string>(task.assigned_to || '');
    const [editStartDate, setEditStartDate] = React.useState(task.start_date || '');
    const [editDueDate, setEditDueDate] = React.useState(task.due_date || '');
    const [editCost, setEditCost] = React.useState<number | string>(task.cost !== null && task.cost !== undefined ? task.cost : '');
    const [editPriority, setEditPriority] = React.useState(task.priority || 'low');
    const [editTaskType, setEditTaskType] = React.useState(task.type || '');
    const [editSeqID, setEditSeqID] = React.useState(task.seqID || '');
    const [editShotID, setEditShotID] = React.useState(task.shotID || '');
    const [editShotRelId, setEditShotRelId] = React.useState<number | null>(task.shot_id || null);
    const [editDependsOn, setEditDependsOn] = React.useState<string[]>(task.dependsOn || []);

    const [shots, setShots] = React.useState<{ id: number; shotID: string; seqID: string }[]>([]);

    // Reset edit form when task changes
    const dependsOnStr = JSON.stringify(task.dependsOn || []);
    React.useEffect(() => {
        setEditName(task.name);
        setEditDescription(task.description || '');
        setEditProjectId(task.project_id || '');
        setEditAssignedTo(task.assigned_to || '');
        setEditStartDate(task.start_date ? task.start_date.split('T')[0] : '');
        setEditDueDate(task.due_date ? task.due_date.split('T')[0] : '');
        setEditCost(task.cost !== null && task.cost !== undefined ? task.cost : '');
        setEditPriority(task.priority || 'low');
        setEditTaskType(task.type || '');
        setEditSeqID(task.seqID || '');
        setEditShotID(task.shotID || '');
        setEditShotRelId(task.shot_id || null);
        setEditDependsOn(task.dependsOn || []);
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

    // Local states for smoother interaction
    const [localCheckItems, setLocalCheckItems] = React.useState<{ label: string, checked: boolean }[]>(task.check_items || []);
    const [localDeliverables, setLocalDeliverables] = React.useState<string>(task.deliverables || '');
    const [newItemText, setNewItemText] = React.useState('');

    // Sync with props when task changes
    React.useEffect(() => {
        setLocalCheckItems(task.check_items || []);
        setLocalDeliverables(task.deliverables || '');
    }, [task.id, task.check_items, task.deliverables]);

    const handleAddCheckItem = async () => {
        if (!newItemText.trim()) return;
        const newItems = [...localCheckItems, { label: newItemText.trim(), checked: false }];
        setLocalCheckItems(newItems); // Optimistic UI
        setNewItemText('');
        await onUpdate(task.id, { check_items: newItems });
    };

    const handleToggleCheckItem = async (idx: number, checked: boolean) => {
        const newItems = [...localCheckItems];
        newItems[idx] = { ...newItems[idx], checked };
        setLocalCheckItems(newItems);
        await onUpdate(task.id, { check_items: newItems });
    };

    const handleDeleteCheckItem = async (idx: number) => {
        const newItems = localCheckItems.filter((_, i) => i !== idx);
        setLocalCheckItems(newItems);
        await onUpdate(task.id, { check_items: newItems });
    };

    const handleDeliverablesBlur = async () => {
        if (localDeliverables !== (task.deliverables || '')) {
            await onUpdate(task.id, { deliverables: localDeliverables });
        }
    };

    const handleNameBlur = async () => {
        if (!editName.trim()) {
            setEditName(task.name);
            return;
        }
        if (editName !== task.name) {
            await onUpdate(task.id, { name: editName });
        }
    };

    const handleDescriptionBlur = async () => {
        if (editDescription !== (task.description || '')) {
            await onUpdate(task.id, { description: editDescription || null });
        }
    };

    const handleCostBlur = async () => {
        const newCost = editCost !== '' ? Number(editCost) : null;
        if (newCost !== task.cost) {
            await onUpdate(task.id, { cost: newCost });
        }
    };

    const handleIncrementCost = async () => {
        const currentCost = editCost !== '' ? Number(editCost) : 0;
        const newCost = currentCost + 1;
        setEditCost(String(newCost));
        await onUpdate(task.id, { cost: newCost });
    };

    const handleSeqIDBlur = async () => {
        if (editSeqID !== (task.seqID || '')) {
            await onUpdate(task.id, { seqID: editSeqID || null });
        }
    };

    const handleShotIDBlur = async () => {
        if (editShotID !== (task.shotID || '')) {
            await onUpdate(task.id, { shotID: editShotID || null });
        }
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ja}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, p: 2 }}>
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
                            onChange={(e) => { setEditName(e.target.value); onEdit?.(); }}
                            onBlur={handleNameBlur}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    (e.target as HTMLInputElement).blur();
                                }
                            }}
                            placeholder="タスク名"
                            fullWidth
                            variant="standard"
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
                            {task.name}
                        </Typography>
                    )}

                    {isAdmin ? (
                        <TextField
                            value={editDescription}
                            onChange={(e) => { setEditDescription(e.target.value); onEdit?.(); }}
                            onBlur={handleDescriptionBlur}
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
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                            {['todo', 'in-progress', 'review', 'completed', 'delayed', 'retake'].map((s) => (
                                <Chip
                                    key={s}
                                    label={getTaskStatusLabel(s)}
                                    size="medium"
                                    onClick={() => onUpdate(task.id, { status: s })}
                                    variant={task.status === s ? "filled" : "outlined"}
                                    sx={{
                                        transition: 'all 0.2s',
                                        px: 0.5,
                                        backgroundColor: task.status === s ? getTaskStatusColor(s) : 'transparent',
                                        color: task.status === s ? 'white' : 'text.primary',
                                        borderColor: getTaskStatusColor(s),
                                        '&:hover': {
                                            backgroundColor: getTaskStatusColor(s),
                                            color: 'white',
                                        }
                                    }}
                                />
                            ))}
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
                                    <Grid item xs={6}>
                                        <FormControl fullWidth size="small">
                                            <InputLabel>プロジェクト</InputLabel>
                                            <Select
                                                value={editProjectId}
                                                label="プロジェクト"
                                                onChange={async (e) => {
                                                    const val = e.target.value;
                                                    const newProjId = val ? Number(val) : null;
                                                    setEditProjectId(val);
                                                    setEditShotRelId(null);
                                                    setEditSeqID('');
                                                    setEditShotID('');
                                                    setEditDependsOn([]);
                                                    await onUpdate(task.id, {
                                                        project_id: newProjId,
                                                        shot_id: null,
                                                        seqID: null,
                                                        shotID: null,
                                                        dependsOn: []
                                                    });
                                                }}
                                            >
                                                <MenuItem value=""><em>未設定</em></MenuItem>
                                                {projects.map((p) => (
                                                    <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                    </Grid>
                                    <Grid item xs={6}>
                                        <FormControl fullWidth size="small">
                                            <InputLabel>担当者</InputLabel>
                                            <Select
                                                value={editAssignedTo}
                                                label="担当者"
                                                onChange={async (e) => {
                                                    const val = e.target.value;
                                                    const newAssignedTo = val ? Number(val) : null;
                                                    setEditAssignedTo(val);
                                                    await onUpdate(task.id, { assigned_to: newAssignedTo });
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
                                            onChange={async (val) => {
                                                let formattedStartDate = val && isValid(val) ? format(val, 'yyyy-MM-dd') : '';
                                                setEditStartDate(formattedStartDate);
                                                if (formattedStartDate && !formattedStartDate.includes('T')) {
                                                    formattedStartDate = `${formattedStartDate}T00:00:00+09:00`;
                                                }
                                                await onUpdate(task.id, { start_date: formattedStartDate || null });
                                            }}
                                            slotProps={{ textField: { size: 'small', fullWidth: true } }}
                                        />
                                    </Grid>
                                    <Grid item xs={6}>
                                        <DatePicker
                                            label="期日"
                                            value={editDueDate ? parseISO(editDueDate) : null}
                                            onChange={async (val) => {
                                                let formattedDueDate = val && isValid(val) ? format(val, 'yyyy-MM-dd') : '';
                                                setEditDueDate(formattedDueDate);
                                                if (formattedDueDate && !formattedDueDate.includes('T')) {
                                                    formattedDueDate = `${formattedDueDate}T00:00:00+09:00`;
                                                }
                                                await onUpdate(task.id, { due_date: formattedDueDate || null });
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
                                                onChange={(e) => { setEditCost(e.target.value); onEdit?.(); }}
                                                onBlur={handleCostBlur}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        (e.target as HTMLInputElement).blur();
                                                    }
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
                                                onChange={async (e) => {
                                                    const val = e.target.value;
                                                    setEditPriority(val);
                                                    await onUpdate(task.id, { priority: val.toUpperCase() });
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
                                        onChange={async (e) => {
                                            const val = e.target.value;
                                            setEditTaskType(val);
                                            await onUpdate(task.id, { type: val || null });
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
                                    <InputLabel>ショット（Scoreプロジェクト）</InputLabel>
                                    <Select
                                        value={editShotRelId ?? ''}
                                        label="ショット（Scoreプロジェクト）"
                                        onChange={async (e) => {
                                            const val = e.target.value;
                                            if (val === '') {
                                                setEditShotRelId(null);
                                                setEditSeqID('');
                                                setEditShotID('');
                                                await onUpdate(task.id, {
                                                    shot_id: null,
                                                    seqID: null,
                                                    shotID: null
                                                });
                                            } else {
                                                const shotNum = Number(val);
                                                const selectedShot = shots.find(s => s.id === shotNum);
                                                setEditShotRelId(shotNum);
                                                setEditSeqID(selectedShot?.seqID ?? '');
                                                setEditShotID(selectedShot?.shotID ?? '');
                                                await onUpdate(task.id, {
                                                    shot_id: shotNum,
                                                    seqID: selectedShot?.seqID ?? null,
                                                    shotID: selectedShot?.shotID ?? null
                                                });
                                            }
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
                                            onChange={(e) => { setEditSeqID(e.target.value); onEdit?.(); }}
                                            onBlur={handleSeqIDBlur}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    (e.target as HTMLInputElement).blur();
                                                }
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
                                            onChange={(e) => { setEditShotID(e.target.value); onEdit?.(); }}
                                            onBlur={handleShotIDBlur}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    (e.target as HTMLInputElement).blur();
                                                }
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
                                    onChange={async (_event, newValue) => {
                                        const newDependsOn = newValue.map(v => v.id);
                                        setEditDependsOn(newDependsOn);
                                        await onUpdate(task.id, { dependsOn: newDependsOn });
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
                                    <Typography variant="body2" sx={{ fontWeight: 600 }} color={task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed' ? 'error.main' : 'inherit'}>
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
                    {task.phases && task.phases.length > 0 && (
                        <Box>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <CalendarTodayIcon fontSize="small" color="primary" /> 段階目標
                            </Typography>
                            <List sx={{ p: 0, bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderRadius: 1 }}>
                                {task.phases.map((p, idx) => (
                                    <ListItem key={idx} sx={{ py: 0.5, px: 2 }}>
                                        <FormControlLabel
                                            control={
                                                <Checkbox
                                                    size="small"
                                                    checked={!!p.is_completed}
                                                    disabled={!isAdmin}
                                                    onChange={async (e) => {
                                                        const updatedPhases = [...(task.phases || [])];
                                                        updatedPhases[idx] = { ...updatedPhases[idx], is_completed: e.target.checked };
                                                        await onUpdate(task.id, { phases: updatedPhases });
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
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                                <AssignmentIcon fontSize="small" color="primary" /> メモ
                            </Typography>
                            {isAdmin && localDeliverables !== (task.deliverables || '') && (
                                <Button
                                    size="small"
                                    variant="contained"
                                    onClick={handleDeliverablesBlur}
                                    sx={{ py: 0, fontSize: '0.75rem' }}
                                >
                                    確定
                                </Button>
                            )}
                        </Box>
                        <TextField
                            key={`deliverables-input-${task.id}`}
                            multiline
                            rows={3}
                            fullWidth
                            size="small"
                            placeholder={isAdmin ? "タスクに関するメモやリンク、参考情報をご記入ください..." : "メモはありません"}
                            value={localDeliverables}
                            onChange={(e) => setLocalDeliverables(e.target.value)}
                            onBlur={handleDeliverablesBlur}
                            disabled={!isAdmin}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                    handleDeliverablesBlur();
                                }
                            }}
                            sx={{
                                '& .MuiInputBase-root': {
                                    fontSize: '0.85rem',
                                    bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'
                                }
                            }}
                        />
                    </Box>
                </Box>
            </Box>
        </LocalizationProvider>
    );
};
