import React from 'react';
import { Box, Typography, Divider, Chip, Checkbox, FormControlLabel, TextField, List, ListItem, useTheme, Avatar, Button } from '@mui/material';
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
import EditIcon from '@mui/icons-material/Edit';
import HistoryIcon from '@mui/icons-material/History';


interface TaskQuickDetailProps {
    task: Task;
    projects: Project[];
    users: User[];
    onUpdate: (taskId: number, updates: Partial<Task>) => Promise<void>;
    onEditFull?: (task: Task) => void;
}

const getTaskStatusColor = (status?: string | null) => {
    switch (status?.toLowerCase()) {
        case 'todo': return '#2196F3';           // 青: 未着手
        case 'in-progress': return '#FF9800';    // オレンジ: 進行中
        case 'review': return '#9C27B0';        // 紫: 確認中
        case 'completed': return '#9E9E9E';     // グレー: 完了
        case 'delayed': return '#F44336';       // 赤: 遅延
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

export const TaskQuickDetail: React.FC<TaskQuickDetailProps> = ({ task, projects, users, onUpdate, onEditFull }) => {
    const theme = useTheme();
    const isDark = theme.palette.mode === 'dark';
    const project = projects.find(p => p.id === task.project_id);
    const assignee = users.find(u => u.id === task.assigned_to);

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

    return (
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

                {task.description && (
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
                )}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                <Chip
                    label={project?.name || 'プロジェクト未設定'}
                    size="small"
                    icon={<FolderIcon fontSize="small" />}
                    variant="outlined"
                    sx={{
                        maxWidth: 200,
                        fontWeight: 600,
                        borderColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)',
                        bgcolor: 'background.paper'
                    }}
                />
                {(task.seqID || task.shotID) && (
                    <Chip
                        label={`${task.seqID || '-'}${task.shotID ? ` / ${task.shotID}` : ''}`}
                        size="small"
                        icon={<HistoryIcon fontSize="small" />}
                        variant="outlined"
                        sx={{
                            maxWidth: 200,
                            fontWeight: 600,
                            borderColor: isDark ? 'rgba(255,152,0,0.3)' : 'rgba(255,152,0,0.2)',
                            bgcolor: isDark ? 'rgba(255,152,0,0.05)' : 'rgba(255,152,0,0.02)',
                            color: isDark ? '#ffb74d' : '#f57c00'
                        }}
                    />
                )}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 1, bgcolor: 'background.paper', px: 1, py: 0.5, borderRadius: 10, border: '1px solid', borderColor: 'divider' }}>
                    <Avatar sx={{
                        width: 24,
                        height: 24,
                        fontSize: '0.7rem',
                        bgcolor: theme.palette.primary.main,
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}>
                        {assignee?.username?.[0]?.toUpperCase() || '?'}
                    </Avatar>
                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
                        {assignee?.username || '未割り当て'}
                    </Typography>
                </Box>
            </Box>

            <Divider />

            {/* Interactive Updates Section */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {/* Status Picker */}
                <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                        <TaskAltIcon fontSize="small" color="primary" /> ステータス
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {['todo', 'in-progress', 'review', 'completed', 'delayed'].map((s) => (
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
                                    <IconButton edge="end" size="small" onClick={() => handleDeleteCheckItem(idx)}>
                                        <CloseIcon fontSize="inherit" />
                                    </IconButton>
                                }
                            >
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            size="small"
                                            checked={item.checked}
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
                    </List>
                </Box>

                <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <AssignmentIcon fontSize="small" color="primary" /> メモ
                        </Typography>
                        {localDeliverables !== (task.deliverables || '') && (
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
                        placeholder="タスクに関するメモやリンク、参考情報をご記入ください..."
                        value={localDeliverables}
                        onChange={(e) => setLocalDeliverables(e.target.value)}
                        onBlur={handleDeliverablesBlur}
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

                {/* Dates */}
                <Box sx={{ display: 'flex', gap: 4, mt: 1 }}>
                    <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <CalendarTodayIcon sx={{ fontSize: '0.9rem' }} /> 開始日
                        </Typography>
                        <Typography variant="body2">{formatDate(task.start_date)}</Typography>
                    </Box>
                    <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <CalendarTodayIcon sx={{ fontSize: '0.9rem' }} /> 期日
                        </Typography>
                        <Typography variant="body2" color={task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed' ? 'error.main' : 'inherit'}>
                            {formatDate(task.due_date)}
                        </Typography>
                    </Box>
                </Box>
            </Box>


            {onEditFull && (
                <Box sx={{ mt: 1 }}>
                    <Divider sx={{ mb: 2 }} />
                    <Button
                        fullWidth
                        variant="outlined"
                        startIcon={<EditIcon />}
                        onClick={() => onEditFull(task)}
                        sx={{
                            py: 1.2,
                            borderRadius: 2,
                            textTransform: 'none',
                            fontWeight: 600,
                            borderColor: theme.palette.divider,
                            '&:hover': {
                                borderColor: theme.palette.primary.main,
                                bgcolor: 'rgba(25, 118, 210, 0.04)'
                            }
                        }}
                    >
                        詳細編集を開く
                    </Button>
                </Box>
            )}
        </Box>
    );
};
