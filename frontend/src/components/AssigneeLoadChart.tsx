import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Task, User, Project } from '../types'; // Adjust path if necessary
import { Box, Typography, Paper, Grid, Modal, IconButton, FormControl, InputLabel, Select, MenuItem, Checkbox, ListItemText, OutlinedInput, Tooltip as MuiTooltip, useTheme, useMediaQuery } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'; // ヘルプアイコン
import { parseISO, isValid, isBefore, startOfDay } from 'date-fns';
import { isOverdue as _isOverdue, getTaskStatusCategory } from '../utils/taskStatus';

interface AssigneeLoadChartProps {
    tasks: Task[];
    users: User[];
    projects: Project[]; // ★★★ projects を追加 ★★★
}

interface AssigneeLoadData {
    assigneeId: number; // フィルター用にIDも保持
    assigneeName: string;
    todoTasks: number;
    inProgressTasks: number;
    delayedTasks: number;
    doneTasks: number;
    todoCost: number;
    inProgressCost: number;
    delayedCost: number;
    doneCost: number;
}

// ★★★ データ計算ロジック変更: 新しい遅延定義を適用 ★★★
// 遅延判定 = オンラインプロジェクトのタスクで、status ∉ {deliver, omit, 旧completed} かつ 期日超過
const calculateAssigneeLoadData = (
    tasks: Task[],
    users: User[],
    projects: Project[],
): AssigneeLoadData[] => {
    const today = startOfDay(new Date()); // 今日の開始時刻
    const assignees = users.filter(u => u.role !== 'admin');

    // オンラインプロジェクト ID セット (O(1) 判定用)
    const onlineProjectIdSet = new Set<number>(
        projects
            .filter(p => (p.display_status ?? 'online') === 'online')
            .map(p => p.id)
    );

    // 渡されたtasksをそのまま使用（上位でフィルター済み）
    const filteredTasks = tasks;

    const loadData = assignees.map(assignee => {
        const assignedTasks = filteredTasks.filter(task => task.assigned_to === assignee.id);

        // ★★★ ステータス別に集計 ★★★
        let todoTasks = 0;
        let inProgressTasks = 0;
        let delayedTasks = 0;
        let doneTasks = 0;
        let todoCost = 0;
        let inProgressCost = 0;
        let delayedCost = 0;
        let doneCost = 0;

        assignedTasks.forEach(task => {
            const cost = typeof task.cost === 'number' ? task.cost : 0;
            let isDelayed = false;

            // task_status_redesign_v2 §2 の5カテゴリでバケット化
            //   completed = ap/client_ap/deliver / held = wt/omit(除外) / todo = mk
            //   review(qc/qc_fb) と in_progress(wip) は inProgress に集約
            const cat = getTaskStatusCategory(task.status);

            // 遅延判定: オンラインプロジェクトのタスクで、完了/待機・対象外でなく、期日超過
            if (task.due_date && task.project_id != null && onlineProjectIdSet.has(task.project_id)) {
                const dueDate = startOfDay(parseISO(task.due_date));
                const excluded = cat === 'completed' || cat === 'held';
                if (isValid(dueDate) && isBefore(dueDate, today) && !excluded) {
                    isDelayed = true;
                }
            }

            if (isDelayed) {
                delayedTasks++;
                delayedCost += cost;
            } else if (cat === 'completed') {
                doneTasks++;
                doneCost += cost;
            } else if (cat === 'held') {
                // wt / omit は集計対象外
            } else if (cat === 'todo') {
                todoTasks++;
                todoCost += cost;
            } else if (cat === 'in_progress' || cat === 'review') {
                inProgressTasks++;
                inProgressCost += cost;
            }
        });

        return {
            assigneeId: assignee.id, // IDを追加
            assigneeName: assignee.full_name || assignee.username || 'Unknown',
            todoTasks,
            inProgressTasks,
            delayedTasks,
            doneTasks,
            todoCost,
            inProgressCost,
            delayedCost,
            doneCost,
        };
    });

    console.log('Calculated Assignee Load Data:', loadData);
    return loadData;
};

// ★★★ 担当者負荷グラフ用のカスタムツールチップ (枠削除) ★★★
const AssigneeCustomTooltip = ({ active, payload, label, formatter }: any) => {
    if (active && payload && payload.length) {
        return (
            <>
                <Typography sx={{ fontWeight: 'bold', mb: 0.5, color: 'text.primary', fontSize: '0.8rem' }}>{label}</Typography>
                {payload.map((pld: any, index: number) => {
                    const value = formatter ? formatter(pld.value) : pld.value;
                    // valueが0の場合は表示しない
                    if (pld.value === 0) return null;
                    return (
                        <Typography key={index} sx={{ color: pld.color, fontSize: '0.75rem' }}>
                            {`${pld.name}: ${value}`}
                        </Typography>
                    );
                })}
            </>
        );
    }
    return null;
};

// ★★★ モーダルスタイル (ProjectProgressChartから流用) ★★★
const modalStyle = {
    position: 'absolute' as 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '80vw', // 少し小さめにする
    height: '70vh',
    bgcolor: 'background.paper',
    border: '1px solid #000',
    boxShadow: 24,
    p: 3,
    display: 'flex',
    flexDirection: 'column'
};

const AssigneeLoadChart: React.FC<AssigneeLoadChartProps> = ({ tasks, users, projects }) => {
    // ★★★ フィルター用の State ★★★
    const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<number[]>([]); // 初期は空（=全員表示）

    const assigneeLoadDataAll = useMemo(
        () => calculateAssigneeLoadData(tasks, users, projects),
        [tasks, users, projects]
    );

    // ★★★ 担当者リスト（フィルター用）★★★
    const assigneeOptions = useMemo(() =>
        users
            .filter(u => u.role !== 'admin')
            .map(u => ({ id: u.id, name: u.full_name || u.username }))
        , [users]);
    // ★★★ 全担当者IDリスト（「すべて選択」用）★★★
    const allAssigneeIds = useMemo(() => assigneeOptions.map(opt => opt.id), [assigneeOptions]);

    // ★★★ 担当者フィルター適用後のデータ ★★★
    const filteredAssigneeLoadData = useMemo(() => {
        // ★★★ フィルターロジック変更: IDリストが全IDと同じか空なら全員表示 ★★★
        const isAllSelected = selectedAssigneeIds.length === 0 || selectedAssigneeIds.length === allAssigneeIds.length;
        if (isAllSelected) {
            return assigneeLoadDataAll;
        }
        return assigneeLoadDataAll.filter(d => selectedAssigneeIds.includes(d.assigneeId));
    }, [assigneeLoadDataAll, selectedAssigneeIds, allAssigneeIds]); // allAssigneeIds を依存配列に追加

    // ★★★ モーダル State ★★★
    const [isTaskCountModalOpen, setIsTaskCountModalOpen] = useState(false);
    const [isTaskCostModalOpen, setIsTaskCostModalOpen] = useState(false);

    if (!assigneeLoadDataAll) { // 元データがない場合はローディング等を考慮（MetricsPage側で対応済みのはず）
        return null;
    }

    const taskCountFormatter = (value: number) => `${value} 件`;
    const costFormatter = (value: number) => `${value}`;

    const renderBarChart = (
        data: AssigneeLoadData[],
        countOrCost: 'count' | 'cost',
        formatter: (value: any) => string,
        isModal: boolean = false
    ) => {
        const theme = useTheme();
        const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

        // ★★★ keys に done を追加 ★★★
        const keys = countOrCost === 'count'
            ? { key1: 'todoTasks', name1: 'Todo', key2: 'inProgressTasks', name2: 'In Progress', key3: 'delayedTasks', name3: 'Delayed', key4: 'doneTasks', name4: 'Done' }
            : { key1: 'todoCost', name1: 'Todo', key2: 'inProgressCost', name2: 'In Progress', key3: 'delayedCost', name3: 'Delayed', key4: 'doneCost', name4: 'Done' };
        // ★★★ colors に done を追加 ★★★
        const colors = { todo: '#2196F3', inProgress: '#4CAF50', delayed: '#F44336', done: '#9E9E9E' };

        return (
            <Box sx={{
                width: '100%',
                height: isModal ? "100%" : "90%",
                overflowX: isMobile ? 'auto' : 'visible',
                '&::-webkit-scrollbar': { height: '8px' },
                '&::-webkit-scrollbar-thumb': { backgroundColor: 'divider', borderRadius: '4px' }
            }}>
                <Box sx={{ minWidth: isMobile ? '500px' : 'auto', height: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} margin={{ top: 5, right: isMobile ? 25 : 5, left: isModal ? -15 : -15, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="assigneeName" fontSize={isModal ? 11 : 10} tick={{ dy: 5 }} interval={0} />
                            <YAxis fontSize={isModal ? 11 : 10} tickFormatter={formatter} />
                            <Tooltip
                                content={<AssigneeCustomTooltip formatter={formatter} />}
                                cursor={{ fill: '#f5f5f5' }} // カーソル色を薄いグレーに
                                wrapperStyle={isModal ? { zIndex: 1500 } : {}}
                            />
                            <Legend
                                wrapperStyle={{ fontSize: isModal ? '0.8rem' : '0.75rem', paddingTop: '5px' }}
                                verticalAlign="top"
                                align="right"
                            />
                            {/* ★★★ Bar に done を追加 ★★★ */}
                            <Bar dataKey={keys.key1} name={keys.name1} fill={colors.todo} barSize={isModal ? 15 : isMobile ? 8 : 10} />
                            <Bar dataKey={keys.key2} name={keys.name2} fill={colors.inProgress} barSize={isModal ? 15 : isMobile ? 8 : 10} />
                            <Bar dataKey={keys.key3} name={keys.name3} fill={colors.delayed} barSize={isModal ? 15 : isMobile ? 8 : 10} />
                            <Bar dataKey={keys.key4} name={keys.name4} fill={colors.done} barSize={isModal ? 15 : isMobile ? 8 : 10} />
                        </BarChart>
                    </ResponsiveContainer>
                </Box>
            </Box>
        );
    }

    // ★★★ 「すべて選択」ハンドラー ★★★
    const handleSelectAllAssignees = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.checked) {
            setSelectedAssigneeIds(allAssigneeIds); // 全員のIDを選択
        } else {
            setSelectedAssigneeIds([]); // 選択を解除（空配列 = すべて）
        }
    };

    return (
        <Box>
            {/* ★★★ フィルターUIを Box で囲み、タイトルとヘルプを追加 ★★★ */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
                    担当者別タスク負荷
                </Typography>
                <MuiTooltip
                    title={
                        <Box sx={{ fontSize: '0.75rem' }}>
                            担当者ごとのタスク状況を表示します。<br />
                            Todo: 未着手<br />
                            In Progress: 進行中<br />
                            Delayed: 期限切れ(未完了)<br />
                            Done: 完了
                        </Box>
                    }
                >
                    <IconButton size="small">
                        <HelpOutlineIcon fontSize="small" />
                    </IconButton>
                </MuiTooltip>
            </Box>
            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel sx={{ fontSize: '0.8rem' }}>担当者</InputLabel>
                    <Select
                        multiple
                        value={selectedAssigneeIds}
                        onChange={(e) => {
                            const value = e.target.value;
                            // Ensure value is always an array of numbers
                            const newValue = typeof value === 'string' ? value.split(',').map(Number) : (Array.isArray(value) ? value.map(v => typeof v === 'string' ? Number(v) : v) : []);
                            setSelectedAssigneeIds(newValue.filter(id => typeof id === 'number' && !isNaN(id))); // Filter out invalid numbers
                        }}
                        input={<OutlinedInput label="担当者" />}
                        renderValue={(selected) =>
                            // ★★★ 空配列の場合「すべて」と表示 ★★★
                            selected.length === 0 || selected.length === allAssigneeIds.length
                                ? 'すべて'
                                : selected.map(id => assigneeOptions.find(opt => opt.id === id)?.name).join(', ')
                        }
                        MenuProps={{ PaperProps: { style: { maxHeight: 224 } } }}
                        sx={{ fontSize: '0.8rem' }}
                    >
                        {/* ★★★ 「すべて選択」MenuItem から value="select-all" を削除 ★★★ */}
                        <MenuItem>
                            <Checkbox
                                checked={selectedAssigneeIds.length === allAssigneeIds.length}
                                indeterminate={selectedAssigneeIds.length > 0 && selectedAssigneeIds.length < allAssigneeIds.length}
                                onChange={handleSelectAllAssignees}
                                size="small"
                            />
                            <ListItemText primary="すべて選択/解除" primaryTypographyProps={{ fontSize: '0.85rem' }} />
                        </MenuItem>
                        {assigneeOptions.map((assignee) => (
                            <MenuItem key={assignee.id} value={assignee.id}>
                                <Checkbox checked={selectedAssigneeIds.includes(assignee.id)} size="small" />
                                <ListItemText primary={assignee.name} primaryTypographyProps={{ fontSize: '0.85rem' }} />
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Box>

            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'bold', fontSize: '0.9rem' }}>担当者別タスク負荷</Typography>
            {/* グラフがない場合のメッセージ */}
            {filteredAssigneeLoadData.length === 0 && (
                <Typography sx={{ textAlign: 'center', color: 'text.secondary', height: 320 }}>表示対象の担当者データがありません。</Typography>
            )}
            {/* ★★★ グラフ表示部分 (Grid) ★★★ */}
            {filteredAssigneeLoadData.length > 0 && (
                <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                        <Paper sx={{ p: 2, height: '320px' }}>
                            <Typography variant="body2" sx={{ mb: 1, fontWeight: 'bold', textAlign: 'center', fontSize: '0.8rem' }}>タスク数</Typography>
                            {/* ★★★ renderBarChart にフィルター後のデータを渡す ★★★ */}
                            <Box onClick={() => setIsTaskCountModalOpen(true)} sx={{ cursor: 'pointer', height: 'calc(100% - 30px)' }}>
                                {renderBarChart(filteredAssigneeLoadData, 'count', taskCountFormatter)}
                            </Box>
                        </Paper>
                    </Grid>
                    <Grid item xs={12} md={6}>
                        <Paper sx={{ p: 2, height: '320px' }}>
                            <Typography variant="body2" sx={{ mb: 1, fontWeight: 'bold', textAlign: 'center', fontSize: '0.8rem' }}>タスクコスト</Typography>
                            {/* ★★★ renderBarChart にフィルター後のデータを渡す ★★★ */}
                            <Box onClick={() => setIsTaskCostModalOpen(true)} sx={{ cursor: 'pointer', height: 'calc(100% - 30px)' }}>
                                {renderBarChart(filteredAssigneeLoadData, 'cost', costFormatter)}
                            </Box>
                        </Paper>
                    </Grid>
                </Grid>
            )}

            {/* ★★★ タスク数モーダル ★★★ */}
            <Modal
                open={isTaskCountModalOpen}
                onClose={() => setIsTaskCountModalOpen(false)}
            >
                <Box sx={modalStyle}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography variant="h6" component="h2">担当者別タスク数 (拡大)</Typography>
                        <IconButton onClick={() => setIsTaskCountModalOpen(false)} size="small"><CloseIcon /></IconButton>
                    </Box>
                    <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
                        {/* ★★★ renderBarChart にフィルター後のデータを渡す ★★★ */}
                        {renderBarChart(filteredAssigneeLoadData, 'count', taskCountFormatter, true)}
                    </Box>
                </Box>
            </Modal>

            {/* ★★★ タスクコストモーダル ★★★ */}
            <Modal
                open={isTaskCostModalOpen}
                onClose={() => setIsTaskCostModalOpen(false)}
            >
                <Box sx={modalStyle}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography variant="h6" component="h2">担当者別タスクコスト (拡大)</Typography>
                        <IconButton onClick={() => setIsTaskCostModalOpen(false)} size="small"><CloseIcon /></IconButton>
                    </Box>
                    <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
                        {/* ★★★ renderBarChart にフィルター後のデータを渡す ★★★ */}
                        {renderBarChart(filteredAssigneeLoadData, 'cost', costFormatter, true)}
                    </Box>
                </Box>
            </Modal>

        </Box>
    );
};

export default AssigneeLoadChart; 