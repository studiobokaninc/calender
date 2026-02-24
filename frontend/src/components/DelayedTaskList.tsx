import React, { useState, useMemo } from 'react';
import { Task, User, Project } from '../types';
import {
    Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel,
    FormControl, InputLabel, Select, MenuItem, Checkbox, ListItemText, OutlinedInput, Tooltip as MuiTooltip, IconButton
} from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { format, differenceInDays, isValid, startOfDay, parseISO, isBefore } from 'date-fns'; // date-fnsをインポート

// 遅延タスク情報の型定義
interface DelayedTaskInfo {
    id: number;
    title: string;
    assigneeId: number;
    assigneeName: string;
    projectId: number | null;
    projectName: string;
    dueDate: Date | null;
    delayDays: number | null;
}

// Propsの型定義
interface DelayedTaskListProps {
    tasks: Task[];
    users: User[];
    projects: Project[];
}

type Order = 'asc' | 'desc';
type OrderBy = keyof DelayedTaskInfo; // ソート対象の列キー

// 遅延タスクデータを計算・加工する関数
const calculateDelayedTaskData = (
    tasks: Task[],
    users: User[],
    projects: Project[]
): DelayedTaskInfo[] => {
    const today = startOfDay(new Date()); // 今日の開始時刻

    // ★★★ フィルター条件を変更 ★★★
    const delayedTasks = tasks.filter(task => {
        // 1. 期限日があるか？
        if (!task.due_date) return false;

        const dueDate = startOfDay(parseISO(task.due_date));
        // 2. 期限日が有効で、かつ過去か？
        if (!isValid(dueDate) || !isBefore(dueDate, today)) return false;

        // 3. ステータスが完了でないか？
        return task.status !== 'completed';
    });

    // マッピング処理 (変更なし、ただし遅延日数の計算基準が today になる)
    return delayedTasks.map(task => {
        const assignee = users.find(u => u.id === task.assigned_to);
        const project = projects.find(p => p.id === task.project_id);
        const dueDate = startOfDay(parseISO(task.due_date!)); // 上でチェック済みなので Non-null assertion
        const delayDays = differenceInDays(today, dueDate);

        return {
            id: task.id,
            title: task.name,
            assigneeId: assignee?.id || -1,
            assigneeName: assignee?.full_name || assignee?.username || '不明',
            projectId: project?.id || null,
            projectName: project?.name || '不明',
            dueDate: dueDate,
            // 遅延日数は1日以上のはずだが念のため max(1, ...) or max(0, ...) 
            delayDays: Math.max(1, delayDays), // 少なくとも1日は遅延している
        };
    });
};

// テーブルソート用のユーティリティ関数
function descendingComparator<T>(a: T, b: T, orderBy: keyof T) {
    const aValue = a[orderBy];
    const bValue = b[orderBy];

    // null または undefined を常に大きい値（=末尾）として扱う
    const aIsNullOrUndefined = aValue === null || aValue === undefined;
    const bIsNullOrUndefined = bValue === null || bValue === undefined;
    if (aIsNullOrUndefined && bIsNullOrUndefined) return 0;
    if (aIsNullOrUndefined) return 1; // a が null/undefined なら b より大きい
    if (bIsNullOrUndefined) return -1; // b が null/undefined なら a より大きい

    // Dateオブジェクトの場合、getTime()で比較
    if (aValue instanceof Date && bValue instanceof Date) {
        if (bValue.getTime() < aValue.getTime()) return -1;
        if (bValue.getTime() > aValue.getTime()) return 1;
        return 0;
    }

    // 通常の比較
    if (bValue < aValue) {
        return -1;
    }
    if (bValue > aValue) {
        return 1;
    }
    return 0;
}

function getComparator<Key extends OrderBy>(
    order: Order,
    orderBy: Key,
): (a: DelayedTaskInfo, b: DelayedTaskInfo) => number {
    return order === 'desc'
        ? (a, b) => descendingComparator(a, b, orderBy)
        : (a, b) => -descendingComparator(a, b, orderBy);
}

// 安定ソート関数
function stableSort(array: readonly DelayedTaskInfo[], comparator: (a: DelayedTaskInfo, b: DelayedTaskInfo) => number) {
    const stabilizedThis = array.map((el, index) => [el, index] as [DelayedTaskInfo, number]);
    stabilizedThis.sort((a, b) => {
        const order = comparator(a[0], b[0]);
        if (order !== 0) {
            return order;
        }
        return a[1] - b[1]; // 安定ソートのため元のインデックスで比較
    });
    return stabilizedThis.map((el) => el[0]);
}


const DelayedTaskList: React.FC<DelayedTaskListProps> = ({ tasks, users, projects }) => {
    const [order, setOrder] = useState<Order>('desc'); // デフォルトは遅延日数の降順
    const [orderBy, setOrderBy] = useState<OrderBy>('delayDays');
    const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<number[]>([]);

    // 遅延タスクデータの計算 (初回のみ)
    const allDelayedTasks = useMemo(
        () => calculateDelayedTaskData(tasks, users, projects),
        [tasks, users, projects]
    );

    // 担当者リスト（フィルター用）
    const assigneeOptions = useMemo(() =>
        users
            .filter(u => u.role !== 'admin' && allDelayedTasks.some(task => task.assigneeId === u.id)) // 遅延タスクを持つ担当者のみ
            .map(u => ({ id: u.id, name: u.full_name || u.username }))
        , [users, allDelayedTasks]);
    const allAssigneeIds = useMemo(() => assigneeOptions.map(opt => opt.id), [assigneeOptions]);

    // フィルター適用後のデータ
    const filteredDelayedTasks = useMemo(() => {
        let filtered = allDelayedTasks;
        // 担当者フィルター
        const isAllAssigneesSelected = selectedAssigneeIds.length === 0 || selectedAssigneeIds.length === allAssigneeIds.length;
        if (!isAllAssigneesSelected && allAssigneeIds.length > 0) {
            filtered = filtered.filter(task => selectedAssigneeIds.includes(task.assigneeId));
        }
        return filtered;
    }, [allDelayedTasks, selectedAssigneeIds, allAssigneeIds]);

    // ソート適用後のデータ
    const sortedDelayedTasks = useMemo(() => {
        return stableSort(filteredDelayedTasks as DelayedTaskInfo[], getComparator(order, orderBy));
    }, [filteredDelayedTasks, order, orderBy]);

    // ソートハンドラー
    const handleRequestSort = (property: OrderBy) => {
        const isAsc = orderBy === property && order === 'asc';
        setOrder(isAsc ? 'desc' : 'asc');
        setOrderBy(property);
    };

    // 「すべて選択」ハンドラー
    const handleSelectAllAssignees = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.checked) {
            setSelectedAssigneeIds(allAssigneeIds);
        } else {
            setSelectedAssigneeIds([]);
        }
    };

    return (
        <Paper sx={{ p: 2, mt: 3 }}> {/* 上にマージンを追加 */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="h6" component="h2" sx={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                    遅延タスクリスト
                </Typography>
                <MuiTooltip
                    title={
                        <Box sx={{ fontSize: '0.75rem' }}>
                            期限日が過ぎており、かつステータスが完了('Done')でないタスクの一覧です。
                        </Box>
                    }
                    placement="top-start" // Tooltipの表示位置
                >
                    <IconButton size="small">
                        <HelpOutlineIcon fontSize="small" />
                    </IconButton>
                </MuiTooltip>
            </Box>

            {/* フィルター */}
            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel sx={{ fontSize: '0.8rem' }}>担当者</InputLabel>
                    <Select
                        multiple
                        value={selectedAssigneeIds}
                        onChange={(e) => {
                            const value = e.target.value;
                            const newValue = typeof value === 'string' ? value.split(',').map(Number) : (Array.isArray(value) ? value : []);
                            setSelectedAssigneeIds(newValue.filter(id => id !== -1));
                        }}
                        input={<OutlinedInput label="担当者" />}
                        renderValue={(selected) =>
                            selected.length === 0 || selected.length === allAssigneeIds.length
                                ? 'すべて'
                                : selected.map(id => assigneeOptions.find(opt => opt.id === id)?.name).join(', ')
                        }
                        MenuProps={{ PaperProps: { style: { maxHeight: 224 } } }}
                        sx={{ fontSize: '0.8rem' }}
                    >
                        <MenuItem>
                            <Checkbox
                                checked={selectedAssigneeIds.length === allAssigneeIds.length && allAssigneeIds.length > 0} // 全件数が0の場合を除く
                                indeterminate={selectedAssigneeIds.length > 0 && selectedAssigneeIds.length < allAssigneeIds.length}
                                onChange={handleSelectAllAssignees}
                                size="small"
                                disabled={allAssigneeIds.length === 0} // 選択肢がない場合は無効
                            />
                            <ListItemText primary="すべて選択/解除" primaryTypographyProps={{ fontSize: '0.85rem' }} />
                        </MenuItem>
                        {assigneeOptions.map((assignee) => (
                            <MenuItem key={assignee.id} value={assignee.id}>
                                <Checkbox checked={selectedAssigneeIds.includes(assignee.id)} size="small" />
                                <ListItemText primary={assignee.name} primaryTypographyProps={{ fontSize: '0.85rem' }} />
                            </MenuItem>
                        ))}
                        {assigneeOptions.length === 0 && <MenuItem disabled sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>遅延タスクを持つ担当者がいません</MenuItem>}
                    </Select>
                </FormControl>
            </Box>

            {/* タスクリストテーブル */}
            <TableContainer>
                <Table stickyHeader size="small">
                    <TableHead>
                        <TableRow>
                            {/* ソート可能なヘッダーセル */}
                            {(['title', 'projectName', 'assigneeName', 'dueDate', 'delayDays'] as const).map((headCell) => (
                                <TableCell
                                    key={headCell}
                                    sortDirection={orderBy === headCell ? order : false}
                                    sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}
                                >
                                    <TableSortLabel
                                        active={orderBy === headCell}
                                        direction={orderBy === headCell ? order : 'asc'}
                                        onClick={() => handleRequestSort(headCell)}
                                        sx={{ fontSize: 'inherit' }} // Inherit font size
                                    >
                                        {/* 列名の表示 */}
                                        {headCell === 'title' ? 'タスク名' :
                                            headCell === 'projectName' ? 'プロジェクト' :
                                                headCell === 'assigneeName' ? '担当者' :
                                                    headCell === 'dueDate' ? '期限日' :
                                                        headCell === 'delayDays' ? '遅延日数' : headCell}
                                    </TableSortLabel>
                                </TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {sortedDelayedTasks.length > 0 ? (
                            sortedDelayedTasks.map((task) => (
                                <TableRow hover key={task.id}>
                                    <TableCell sx={{ fontSize: '0.75rem' }}>{task.title}</TableCell>
                                    <TableCell sx={{ fontSize: '0.75rem' }}>{task.projectName}</TableCell>
                                    <TableCell sx={{ fontSize: '0.75rem' }}>{task.assigneeName}</TableCell>
                                    <TableCell sx={{ fontSize: '0.75rem' }}>
                                        {task.dueDate ? format(task.dueDate, 'yyyy/MM/dd') : '日付なし'}
                                    </TableCell>
                                    <TableCell sx={{ fontSize: '0.75rem', color: task.delayDays !== null ? 'error.main' : 'text.disabled', fontWeight: task.delayDays !== null ? 'bold' : 'normal' }}>
                                        {task.delayDays !== null ? `${task.delayDays} 日` : '-'}
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={5} align="center" sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
                                    遅延しているタスクはありません。
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        </Paper>
    );
};

export default DelayedTaskList; 