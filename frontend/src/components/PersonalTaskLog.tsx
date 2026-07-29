import React, { useMemo, useState } from 'react';
import {
    Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    FormControl, InputLabel, Select, MenuItem, Chip, Card, CardContent, Grid, Divider,
    FormControlLabel, Checkbox, useTheme, useMediaQuery, TableSortLabel, Tooltip,
} from '@mui/material';
import { Task, User, Project } from '../types';
import { format, parseISO, isValid, differenceInCalendarDays } from 'date-fns';
import { getTaskStatusCategory, getTaskStatusLabel, getTaskStatusColor } from '../utils/taskStatus';
import { useAuth } from '../contexts/AuthContext';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import AssignmentLateIcon from '@mui/icons-material/AssignmentLate';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ShowChartIcon from '@mui/icons-material/ShowChart';

interface PersonalTaskLogProps {
    tasks: Task[];
    users: User[];
    projects: Project[];
}

interface LogRow {
    id: number;
    name: string;
    projectName: string;
    status: string;
    dueDate: string | null;
    completedDate: string | null;
    isCompleted: boolean;
    /** 完了タスク: 期日に対する遅延日数(完了日 - 期日)。負値=前倒し。null=期日/完了日欠落。
     *  未完了タスク: 本日に対する超過日数(>0のみ意味を持つ)。 */
    delayDays: number | null;
    onTime: boolean | null; // 完了かつ期日ありのみ true/false。それ以外 null
    cost: number;
    description: string;
    taskType: string;
    priority: string;
}

type Order = 'asc' | 'desc';
type OrderBy = 'completedDate' | 'dueDate' | 'delayDays' | 'cost' | 'name';

const fmtDate = (v: string | null): string => {
    if (!v) return '—';
    try {
        const d = parseISO(v);
        return isValid(d) ? format(d, 'yyyy/MM/dd') : '—';
    } catch { return '—'; }
};

/** 完了日をステータス履歴から取得する。
 *  完了カテゴリ(ap/client_ap/deliver)へ「最初に」遷移した履歴の日時を採用。
 *  履歴が無い場合は completed_at にフォールバック。 */
const completionDateFromHistory = (t: Task): string | null => {
    let earliestMs = Infinity;
    let earliestIso: string | null = null;
    for (const h of t.status_history || []) {
        if (getTaskStatusCategory(h.status) !== 'completed') continue;
        const iso = h.changed_at || h.timestamp;
        if (!iso) continue;
        const d = parseISO(iso);
        if (!isValid(d)) continue;
        const ms = d.getTime();
        if (ms < earliestMs) { earliestMs = ms; earliestIso = iso; }
    }
    return earliestIso ?? t.completed_at ?? null;
};

const PersonalTaskLog: React.FC<PersonalTaskLogProps> = ({ tasks, users, projects }) => {
    const theme = useTheme();
    const isDark = theme.palette.mode === 'dark';
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const { user: authUser } = useAuth();

    const selectableUsers = useMemo(
        () => users.filter(u => u.role !== 'admin').sort((a, b) =>
            (a.full_name || a.username || '').localeCompare(b.full_name || b.username || '')),
        [users]
    );

    const [selectedUserId, setSelectedUserId] = useState<number | ''>(() => {
        const aid = authUser?.id != null ? Number(authUser.id) : NaN;
        if (!isNaN(aid) && users.some(u => u.id === aid)) return aid;
        return selectableUsers[0]?.id ?? '';
    });
    const [completedOnly, setCompletedOnly] = useState(false);
    const [order, setOrder] = useState<Order>('desc');
    const [orderBy, setOrderBy] = useState<OrderBy>('completedDate');

    const projectNameOf = (pid?: number | null): string => {
        if (pid == null) return '（プロジェクトなし）';
        return projects.find(p => p.id === pid)?.name ?? `ID:${pid}`;
    };



    const rows: LogRow[] = useMemo(() => {
        if (selectedUserId === '') return [];
        const today = new Date();
        const mine = tasks.filter(t => t.assigned_to === selectedUserId);
        const built = mine.map<LogRow>(t => {
            const cat = getTaskStatusCategory(t.status);
            const isCompleted = cat === 'completed';
            const due = t.due_date && isValid(parseISO(t.due_date)) ? parseISO(t.due_date) : null;
            // 完了日はステータス履歴から取得（完了カテゴリへ最初に遷移した日時）
            const completedIso = isCompleted ? completionDateFromHistory(t) : null;
            const done = completedIso && isValid(parseISO(completedIso)) ? parseISO(completedIso) : null;

            let delayDays: number | null = null;
            let onTime: boolean | null = null;
            if (isCompleted && due && done) {
                // 完了日 − 期日: +N=期日より遅い / -N=期日より早い / 0=ピッタリ
                delayDays = differenceInCalendarDays(done, due);
                onTime = delayDays <= 0;
            } else if (!isCompleted && due && cat !== 'held') {
                // 未完了で期日超過なら現時点の超過日数
                const d = differenceInCalendarDays(today, due);
                delayDays = d > 0 ? d : null;
            }

            return {
                id: t.id,
                name: t.name || '(名称未設定)',
                projectName: projectNameOf(t.project_id),
                status: (t.status || 'wt'),
                dueDate: t.due_date ?? null,
                completedDate: completedIso,
                isCompleted,
                delayDays,
                onTime,
                cost: typeof t.cost === 'number' ? t.cost : 0,
                description: t.description || '',
                taskType: t.type || '',
                priority: t.priority || '',
            };
        });
        const filtered = completedOnly ? built.filter(r => r.isCompleted) : built;
        const dir = order === 'asc' ? 1 : -1;
        return [...filtered].sort((a, b) => {
            let av: number | string = 0, bv: number | string = 0;
            switch (orderBy) {
                case 'completedDate': av = a.completedDate || ''; bv = b.completedDate || ''; break;
                case 'dueDate': av = a.dueDate || ''; bv = b.dueDate || ''; break;
                case 'delayDays': av = a.delayDays ?? -Infinity; bv = b.delayDays ?? -Infinity; break;
                case 'cost': av = a.cost; bv = b.cost; break;
                case 'name': av = a.name; bv = b.name; break;
            }
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            return 0;
        });
    }, [tasks, selectedUserId, completedOnly, order, orderBy, projects]);

    const summary = useMemo(() => {
        const completed = rows.filter(r => r.isCompleted);
        const completedWithDue = completed.filter(r => r.onTime !== null);
        const onTimeCount = completedWithDue.filter(r => r.onTime === true).length;
        const totalCost = rows.reduce((s, r) => s + r.cost, 0);
        const completedCost = completed.reduce((s, r) => s + r.cost, 0);
        
        // 最新合意予定基準オンスケジュール率（件数ベース）
        const onScheduleRate = completedWithDue.length > 0
            ? (onTimeCount / completedWithDue.length) * 100
            : null;

        // 現在の期限超過タスク数 (未完了かつ超過)
        const overdueCount = rows.filter(r => !r.isCompleted && r.delayDays !== null && r.delayDays > 0).length;

        return {
            total: rows.length,
            completedCount: completed.length,
            totalCost,
            completedCost,
            onTimeCount,
            completedWithDueCount: completedWithDue.length,
            onScheduleRate,
            overdueCount,
        };
    }, [rows]);

    const handleSort = (key: OrderBy) => {
        if (orderBy === key) setOrder(order === 'asc' ? 'desc' : 'asc');
        else { setOrderBy(key); setOrder('desc'); }
    };

    const renderDelay = (r: LogRow) => {
        if (r.delayDays === null) {
            return <Typography variant="body2" color="text.secondary">—</Typography>;
        }
        if (r.isCompleted) {
            if (r.delayDays === 0) {
                // 期日ちょうどに完了 (±0日 ピッタリ -> 緑)
                return <Chip size="small" label="±0日 (ピッタリ)"
                    sx={{ bgcolor: isDark ? 'rgba(76, 175, 80, 0.15)' : '#E8F5E9', color: isDark ? '#a5d6a7' : '#2E7D32', fontWeight: 700 }} />;
            }
            if (r.delayDays < 0) {
                // 期日より早い（前倒し -> 青）
                return <Chip size="small" label={`${r.delayDays}日 (前倒し)`}
                    sx={{ bgcolor: isDark ? 'rgba(33, 150, 243, 0.15)' : '#E3F2FD', color: isDark ? '#90caf9' : '#1565C0', fontWeight: 700 }} />;
            }
            // 期日より遅い（遅れ -> 赤）
            return <Chip size="small" label={`+${r.delayDays}日 (遅れ)`}
                sx={{ bgcolor: isDark ? 'rgba(244, 67, 54, 0.15)' : '#FFEBEE', color: isDark ? '#ef9a9a' : '#C62828', fontWeight: 700 }} />;
        }
        // 未完了で超過 (超過 -> 赤)
        return <Chip size="small" label={`+${r.delayDays}日 (未完了・超過)`}
            sx={{ bgcolor: isDark ? 'rgba(244, 67, 54, 0.15)' : '#FFEBEE', color: isDark ? '#ef9a9a' : '#C62828', fontWeight: 700 }} />;
    };

    return (
        <Box sx={{ p: { xs: 1, sm: 2 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* コントロール */}
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
                <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel id="ptl-user-label">対象メンバー</InputLabel>
                    <Select
                        labelId="ptl-user-label"
                        label="対象メンバー"
                        value={selectedUserId === '' ? '' : String(selectedUserId)}
                        onChange={(e) => setSelectedUserId(e.target.value === '' ? '' : Number(e.target.value))}
                    >
                        {selectableUsers.map(u => (
                            <MenuItem key={u.id} value={String(u.id)}>
                                {u.full_name || u.username || u.email || `User ${u.id}`}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <FormControlLabel
                    control={<Checkbox size="small" checked={completedOnly} onChange={(e) => setCompletedOnly(e.target.checked)} />}
                    label="完了のみ"
                />
            </Box>

            {/* 個人評価メトリクス */}
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: isDark ? '#9fa8da' : '#3F51B5', mb: 1.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <ShowChartIcon fontSize="small" /> 個人評価メトリクス
            </Typography>

            {/* 実績サマリー */}
            <Grid container spacing={1.5} sx={{ mb: 2 }}>
                {/* 完了/総数 */}
                <Grid item xs={12} sm={4} md={4}>
                    <Card variant="outlined" sx={{ height: '100%', borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'divider', transition: 'all 0.2s', '&:hover': { boxShadow: 1, borderColor: isDark ? '#9fa8da' : '#3F51B5' } }}>
                        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>完了件数 / 総タスク数</Typography>
                                <Tooltip title="集計期間中の担当完了タスク数と、総登録タスク数（OMITを除く）の割合です。" arrow>
                                    <HelpOutlineIcon sx={{ fontSize: 16, color: 'text.secondary', cursor: 'help' }} />
                                </Tooltip>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                                <CheckCircleIcon sx={{ color: '#4CAF50', fontSize: 20 }} />
                                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                    {summary.completedCount} <Typography component="span" variant="body2" color="text.secondary">/ {summary.total}</Typography>
                                </Typography>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>

                {/* 合計予定工数 */}
                <Grid item xs={12} sm={4} md={4}>
                    <Card variant="outlined" sx={{ height: '100%', borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'divider', transition: 'all 0.2s', '&:hover': { boxShadow: 1, borderColor: isDark ? '#9fa8da' : '#3F51B5' } }}>
                        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>予定工数合計 (完了分)</Typography>
                                <Tooltip title="担当タスクの予定工数（コスト）の総和と、完了済みタスクが占める割合です。" arrow>
                                    <HelpOutlineIcon sx={{ fontSize: 16, color: 'text.secondary', cursor: 'help' }} />
                                </Tooltip>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                                <AccessTimeIcon sx={{ color: '#00BCD4', fontSize: 20 }} />
                                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                    {summary.totalCost.toLocaleString()} <Typography component="span" variant="body2" color="text.secondary">H （{summary.completedCost.toLocaleString()}H）</Typography>
                                </Typography>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>

                {/* 現在の期限超越タスク数 */}
                <Grid item xs={12} sm={4} md={4}>
                    <Card 
                        variant="outlined" 
                        sx={{ 
                            height: '100%', 
                            borderColor: summary.overdueCount > 0 ? (isDark ? '#e53935' : '#ffcdd2') : (isDark ? 'rgba(255, 255, 255, 0.12)' : 'divider'),
                            bgcolor: summary.overdueCount > 0 ? (isDark ? 'rgba(229, 57, 53, 0.15)' : 'rgba(255, 235, 235, 0.15)') : 'transparent',
                            transition: 'all 0.2s', 
                            '&:hover': { boxShadow: 1, borderColor: isDark ? '#ef5350' : '#f44336' } 
                        }}
                    >
                        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>現在の期限超過タスク数</Typography>
                                <Tooltip title="現在完了していないタスクのうち、期日を過ぎているタスクの件数です。" arrow>
                                    <HelpOutlineIcon sx={{ fontSize: 16, color: 'text.secondary', cursor: 'help' }} />
                                </Tooltip>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                                <AssignmentLateIcon sx={{ color: summary.overdueCount > 0 ? '#f44336' : 'text.secondary', fontSize: 20 }} />
                                <Typography variant="h6" sx={{ fontWeight: 700, color: summary.overdueCount > 0 ? (isDark ? '#ef5350' : '#f44336') : 'text.primary' }}>
                                    {summary.overdueCount} <Typography component="span" variant="body2" color="text.secondary">件</Typography>
                                </Typography>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            {/* オンスケジュール率分析 */}
            <Grid container spacing={2} sx={{ mb: 2 }}>
                {/* 件数ベースのオンスケ率 */}
                <Grid item xs={12}>
                    <Card variant="outlined" sx={{ height: '100%', borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'divider' }}>
                        <CardContent>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: isDark ? '#9fa8da' : '#3F51B5' }}>
                                    オンスケジュール率 (件数ベース)
                                </Typography>
                                <Tooltip title="期限内に完了した件数 ÷ 期日が設定されていた全完了件数 × 100" arrow>
                                    <HelpOutlineIcon sx={{ fontSize: 18, color: 'text.secondary', cursor: 'help' }} />
                                </Tooltip>
                            </Box>
                            <Box sx={{ p: 1.5, bgcolor: isDark ? 'rgba(255, 255, 255, 0.05)' : '#f5f5f5', borderRadius: 1 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>最新合意予定基準</Typography>
                                <Typography 
                                    variant="h5" 
                                    sx={{ 
                                        fontWeight: 800, 
                                        color: summary.onScheduleRate == null ? 'text.secondary' : (summary.onScheduleRate >= 80 ? (isDark ? '#81c784' : '#2E7D32') : summary.onScheduleRate >= 50 ? (isDark ? '#ffb74d' : '#E65100') : (isDark ? '#e57373' : '#C62828')) 
                                    }}
                                >
                                    {summary.onScheduleRate == null ? '—' : `${summary.onScheduleRate.toFixed(1)}%`}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                    （{summary.onTimeCount} / {summary.completedWithDueCount}件）
                                </Typography>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>



            <Divider sx={{ mb: 1 }} />

            {/* ログテーブル */}
            <TableContainer component={Paper} variant="outlined" sx={{ flex: 1, minHeight: 0 }}>
                <Table size="small" stickyHeader>
                    <TableHead>
                        <TableRow>
                            <TableCell>
                                <TableSortLabel active={orderBy === 'name'} direction={orderBy === 'name' ? order : 'asc'} onClick={() => handleSort('name')}>タスク</TableSortLabel>
                            </TableCell>
                            {!isMobile && <TableCell>プロジェクト</TableCell>}
                            <TableCell>ステータス</TableCell>
                            <TableCell>
                                <TableSortLabel active={orderBy === 'dueDate'} direction={orderBy === 'dueDate' ? order : 'asc'} onClick={() => handleSort('dueDate')}>期日</TableSortLabel>
                            </TableCell>
                            <TableCell>
                                <TableSortLabel active={orderBy === 'completedDate'} direction={orderBy === 'completedDate' ? order : 'asc'} onClick={() => handleSort('completedDate')}>完了日</TableSortLabel>
                            </TableCell>
                            <TableCell>
                                <TableSortLabel active={orderBy === 'delayDays'} direction={orderBy === 'delayDays' ? order : 'asc'} onClick={() => handleSort('delayDays')}>期日差</TableSortLabel>
                            </TableCell>
                            <TableCell align="right">
                                <TableSortLabel active={orderBy === 'cost'} direction={orderBy === 'cost' ? order : 'asc'} onClick={() => handleSort('cost')}>コスト</TableSortLabel>
                            </TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.length === 0 && (
                            <TableRow><TableCell colSpan={isMobile ? 6 : 7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                                表示するタスクがありません。
                            </TableCell></TableRow>
                        )}
                        {rows.map(r => (
                            <TableRow key={r.id} hover>
                                <TableCell sx={{ maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</TableCell>
                                {!isMobile && <TableCell sx={{ maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.projectName}</TableCell>}
                                <TableCell>
                                    <Chip size="small" label={getTaskStatusLabel(r.status)}
                                        sx={{ bgcolor: getTaskStatusColor(r.status), color: '#fff', fontWeight: 600 }} />
                                </TableCell>
                                <TableCell>{fmtDate(r.dueDate)}</TableCell>
                                <TableCell>{r.isCompleted ? fmtDate(r.completedDate) : '—'}</TableCell>
                                <TableCell>{renderDelay(r)}</TableCell>
                                <TableCell align="right">{r.cost.toLocaleString()}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};

export default PersonalTaskLog;
