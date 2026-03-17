import React from 'react';
import { Box, Typography, Divider, Chip, Checkbox, FormControlLabel, TextField, List, ListItem, useTheme, Avatar } from '@mui/material';
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


interface TaskQuickDetailProps {
    task: Task;
    projects: Project[];
    users: User[];
    onUpdate: (taskId: number, updates: Partial<Task>) => Promise<void>;
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

export const TaskQuickDetail: React.FC<TaskQuickDetailProps> = ({ task, projects, users, onUpdate }) => {
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
            {/* Basic Info Header */}
            <Box>
                <Typography variant="h5" sx={{
                    fontWeight: 800,
                    mb: 1,
                    lineHeight: 1.2,
                    color: theme.palette.text.primary,
                    letterSpacing: '-0.02em'
                }}>
                    {task.name}
                </Typography>

                {task.description && (
                    <Box sx={{
                        mb: 2,
                        p: 1.5,
                        bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                        borderRadius: 1,
                        borderLeft: `4px solid ${theme.palette.primary.main}`
                    }}>
                        <Typography variant="caption" color="primary" sx={{ fontWeight: 700, textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
                            説明
                        </Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.primary', lineHeight: 1.6 }}>
                            {task.description}
                        </Typography>
                    </Box>
                )}

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Chip
                        label={project?.name || 'プロジェクト未設定'}
                        size="small"
                        icon={<FolderIcon fontSize="small" />}
                        variant="outlined"
                        sx={{ maxWidth: 200, fontWeight: 500 }}
                    />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
                        <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem', bgcolor: theme.palette.primary.main }}>
                            {assignee?.username?.[0]?.toUpperCase() || '?'}
                        </Avatar>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {assignee?.username || '未割り当て'}
                        </Typography>
                    </Box>
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
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <AssignmentIcon fontSize="small" color="primary" /> メモ
                    </Typography>
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


        </Box>
    );
};
