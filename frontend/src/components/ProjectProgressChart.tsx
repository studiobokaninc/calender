import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Project, Task } from '../types'; // Adjust path if necessary
import { Box, Typography, Tooltip as MuiTooltip, IconButton, Modal, useTheme, useMediaQuery } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import CloseIcon from '@mui/icons-material/Close';
import { parseISO, format, eachDayOfInterval, isBefore, isEqual, startOfDay, startOfToday, addDays, isAfter, isValid } from 'date-fns';
import { getTaskStatusCategory, getStatusProgressWeight } from '../utils/taskStatus';

interface ProjectProgressChartProps {
    projects: Project[];
    tasks: Task[];
}

// ★★★ データ型の定義を明確化 ★★★
interface ProgressDataPoint {
    date: string;
    [key: string]: number | string | null; // Allows for project_actual, project_planned keys + date
}

const calculateProgressData = (projects: Project[], tasks: Task[], today: Date): ProgressDataPoint[] => {
    const targetProjects = projects;
    if (targetProjects.length === 0) {
        return [];
    }

    // 1. Determine date ranges
    let overallMinDate: Date | null = null;
    let latestProjectEndDate: Date | null = null;

    targetProjects.forEach(p => {
        try {
            const projStartDate = p.start_date ? startOfDay(parseISO(p.start_date)) : null;
            const projEndDate = p.end_date ? startOfDay(parseISO(p.end_date)) : null;

            if (projStartDate && isValid(projStartDate) && (!overallMinDate || isBefore(projStartDate, overallMinDate))) {
                overallMinDate = projStartDate;
            }
            if (projEndDate && isValid(projEndDate) && (!latestProjectEndDate || isBefore(latestProjectEndDate, projEndDate))) {
                latestProjectEndDate = projEndDate;
            }
        } catch (e) {
            // 日付解析エラーは無視
        }
    });

    // X軸の最終日を計算
    // プロジェクト終了日+7日 と 今日+7日 の遅い方を採用（遅延プロジェクト対応）
    let chartAxisEndDate: Date;
    const todayPlus7 = addDays(today, 7);

    if (latestProjectEndDate) {
        const projectEndPlus7 = addDays(latestProjectEndDate, 7);
        chartAxisEndDate = isAfter(todayPlus7, projectEndPlus7) ? todayPlus7 : projectEndPlus7;
    } else {
        chartAxisEndDate = todayPlus7;
    }

    // overallMinDateの検証
    if (!overallMinDate || !isValid(overallMinDate) || isBefore(chartAxisEndDate, overallMinDate)) {
        overallMinDate = startOfDay(new Date(chartAxisEndDate.getTime() - 30 * 24 * 60 * 60 * 1000));
        if (!isValid(overallMinDate) || isBefore(chartAxisEndDate, overallMinDate)) {
            overallMinDate = startOfDay(chartAxisEndDate);
        }
    }

    // 日付間隔の計算
    const dateIntervals = eachDayOfInterval({ start: overallMinDate, end: chartAxisEndDate });

    // 各プロジェクトの完了日を事前に計算
    const projectCompletionDates = new Map<string, Date | null>();

    targetProjects.forEach(project => {
        const projectTasks = tasks.filter(t => String(t.project_id) === String(project.id));
        const allCompleted = projectTasks.length > 0 && projectTasks.every(t => getTaskStatusCategory(t.status) === 'completed');

        if (allCompleted) {
            let latestCompletionDate: Date | null = null;

            projectTasks.forEach(t => {
                let taskCompletionDate: Date | null = null;

                if (t.status_history && t.status_history.length > 0) {
                    const completedEntries = t.status_history.filter(h => getTaskStatusCategory(h.status) === 'completed');

                    if (completedEntries.length > 0) {
                        const lastCompleted = completedEntries[completedEntries.length - 1];
                        taskCompletionDate = startOfDay(parseISO(lastCompleted.changed_at));
                    }
                }

                // フォールバック: status_historyがない場合はupdated_atを使用
                if (!taskCompletionDate && getTaskStatusCategory(t.status) === 'completed' && t.updated_at) {
                    taskCompletionDate = startOfDay(parseISO(t.updated_at));
                }

                if (taskCompletionDate && isValid(taskCompletionDate)) {
                    if (!latestCompletionDate || isAfter(taskCompletionDate, latestCompletionDate)) {
                        latestCompletionDate = taskCompletionDate;
                    }
                }
            });

            if (latestCompletionDate) {
                projectCompletionDates.set(project.name, latestCompletionDate);
            }
        }
    });

    // 2. Calculate progress for each day
    const progressData: ProgressDataPoint[] = dateIntervals.map(currentDateRaw => {
        const currentDate = startOfDay(currentDateRaw);
        const dateStr = format(currentDate, 'MM/dd');
        const dailyProgress: ProgressDataPoint = { date: dateStr };

        targetProjects.forEach(project => {
            const projectTasks = tasks.filter(t => String(t.project_id) === String(project.id));
            const totalTasksInProject = projectTasks.length;
            const actualProgressKey = `${project.name}_actual`;
            const plannedProgressKey = `${project.name}_planned`;

            // プロジェクト完了日以降は実績・計画をnullにする
            const completionDate = projectCompletionDates.get(project.name);
            const isAfterCompletion = completionDate && isAfter(currentDate, completionDate);

            // 実績進捗の計算
            if (isBefore(today, currentDate)) {
                dailyProgress[actualProgressKey] = null;
            } else if (isAfterCompletion) {
                // プロジェクト完了日より後は表示しない
                dailyProgress[actualProgressKey] = null;
            } else {
                let actualWeightedSum = 0;
                if (totalTasksInProject > 0) {
                    projectTasks.forEach(t => {
                        let taskContribution = 0;
                        if (t.status_history && t.status_history.length > 0) {
                            // ステータス履歴を日付順にソート（古い順）
                            const sortedHistory = [...t.status_history].sort((a, b) => {
                                const dateA = a.changed_at ? new Date(a.changed_at).getTime() : 0;
                                const dateB = b.changed_at ? new Date(b.changed_at).getTime() : 0;
                                return dateA - dateB;
                            });

                            // 指定日時以前の最新のステータスを取得
                            let currentStatusEntry = null;
                            let lastValidEntry = null;

                            for (const entry of sortedHistory) {
                                try {
                                    if (!entry.changed_at) {
                                        continue;
                                    }

                                    const entryDate = startOfDay(parseISO(entry.changed_at));
                                    if (isBefore(entryDate, currentDate) || isEqual(entryDate, currentDate)) {
                                        lastValidEntry = entry;
                                    }
                                } catch (e) {
                                    // 日付解析エラーは無視
                                }
                            }

                            currentStatusEntry = lastValidEntry;

                            if (currentStatusEntry) {
                                // task_status_redesign_v2 §4 の進捗ウェイトを適用（共有ユーティリティ）。
                                // 旧19/旧7体系の値も canonicalize されて畳み込まれる。
                                // omit は null(除外) → ここでは 0 加算扱い。
                                const w = getStatusProgressWeight(currentStatusEntry.status);
                                taskContribution = w ?? 0;
                            }
                        }
                        actualWeightedSum += taskContribution;
                    });

                    const actualProgress = Math.round((actualWeightedSum / totalTasksInProject) * 100);
                    dailyProgress[actualProgressKey] = actualProgress;
                } else {
                    dailyProgress[actualProgressKey] = 0;
                }
            }

            // 計画進捗の計算
            if (isAfterCompletion) {
                // プロジェクト完了日より後は計画線も表示しない
                dailyProgress[plannedProgressKey] = null;
            } else {
                let plannedCompletedCount = 0;
                if (totalTasksInProject > 0) {
                    plannedCompletedCount = projectTasks.filter(t => {
                        try {
                            const dueDate = t.due_date ? startOfDay(parseISO(t.due_date)) : null;
                            return dueDate && isValid(dueDate) && (isBefore(dueDate, currentDate) || isEqual(dueDate, currentDate));
                        } catch (e) {
                            return false;
                        }
                    }).length;
                    dailyProgress[plannedProgressKey] = Math.round((plannedCompletedCount / totalTasksInProject) * 100);
                } else {
                    dailyProgress[plannedProgressKey] = 0;
                }
            }
        });

        return dailyProgress;
    });

    return progressData;
};

// ★★★ カスタムツールチップコンポーネント修正: 外側の Box を Fragment に ★★★
const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <>
                <Typography sx={{ fontWeight: 'bold', mb: 0.5, color: 'text.primary', fontSize: '0.8rem' }}>{label}</Typography>
                {payload.map((pld: any, index: number) => {
                    const nameMatch = pld.name?.match(/\(([^)]+)\)/);
                    const shortName = nameMatch ? `(${nameMatch[1]})` : pld.name;
                    const value = pld.value;

                    if (value === null || value === undefined) return null;

                    return (
                        <Typography key={index} sx={{ color: pld.color, fontSize: '0.75rem' }}>
                            {`${shortName}: ${value}%`}
                        </Typography>
                    );
                })}
            </>
        );
    }
    return null;
};

// ★★★ モーダル内のグラフ描画用ヘルパーコンポーネント修正: Fragment 削除 ★★★
const ModalChartContent = ({ progressData, projectLines, todayFormatted }: {
    progressData: ProgressDataPoint[];
    projectLines: any[];
    todayFormatted: string;
}) => (
    <ResponsiveContainer width="100%" height="100%">
        {/* ★★★ Fragment を削除し、LineChart を直接の子にする ★★★ */}
        <LineChart
            data={progressData}
            margin={{ top: 15, right: 30, left: 0, bottom: 10 }}
        >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" fontSize={12} tick={{ dy: 5 }} />
            <YAxis
                label={{ value: '完了率 (%)', angle: -90, position: 'insideLeft', fontSize: 12, dx: -15 }}
                domain={[0, 100]}
                fontSize={12}
                tick={{ dx: -5 }}
            />
            <RechartsTooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 1500 }} />
            <Legend wrapperStyle={{ fontSize: '0.8rem', paddingTop: '10px' }} />
            <ReferenceLine x={todayFormatted} stroke="red" strokeDasharray="3 3" label={{ value: '今日', position: 'insideTopRight', fill: 'red', fontSize: 12 }} />
            {projectLines.map(line => (
                <Line
                    key={line.dataKey}
                    type="monotone"
                    dataKey={line.dataKey}
                    name={line.name}
                    stroke={line.color}
                    strokeWidth={2}
                    dot={false}
                    strokeOpacity={line.isPlanned ? 0.4 : 1}
                    strokeDasharray={line.isPlanned ? "5 5" : ""}
                    connectNulls={false}
                />
            ))}
        </LineChart>
    </ResponsiveContainer>
);

// ★★★ モーダルのスタイル定義 ★★★
const modalStyle = {
    position: 'absolute' as 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '85vw', // 画面幅の85%
    height: '80vh', // 画面高さの80%
    bgcolor: 'background.paper',
    border: '2px solid #000',
    boxShadow: 24,
    p: 3, // 内側のパディング
    display: 'flex',
    flexDirection: 'column' // 閉じるボタンを配置しやすくするため
};

const ProjectProgressChart: React.FC<ProjectProgressChartProps> = ({ projects, tasks }) => {
    // ★★★ 今日をコンポーネントの state または定数として定義 ★★★
    const today = useMemo(() => startOfToday(), []);
    const todayFormatted = useMemo(() => format(today, 'MM/dd'), [today]);

    // ★★★ モーダル開閉用の state ★★★
    const [isModalOpen, setIsModalOpen] = useState(false);
    const handleOpenModal = () => setIsModalOpen(true);
    const handleCloseModal = () => setIsModalOpen(false);

    const progressData = useMemo(
        // ★★★ calculateProgressData に today を渡す ★★★
        () => calculateProgressData(projects, tasks, today),
        [projects, tasks, today] // Add today to dependency array
    );

    // ★★★ 表示する線の定義を変更 (実績と計画) ★★★
    const projectLines = useMemo(() => {
        const lines: any[] = [];
        const targetProjects = projects;
        const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#d0ed57', '#a4de6c', '#8dd1e1', '#83a6ed'];

        targetProjects.forEach((project, index) => {
            const color = colors[index % colors.length];
            lines.push({
                dataKey: `${project.name}_actual`,
                name: `${project.name} (実績)`,
                color: color,
                isPlanned: false,
            });
            lines.push({
                dataKey: `${project.name}_planned`,
                name: `${project.name} (計画)`,
                color: color,
                isPlanned: true,
            });
        });
        return lines;
    }, [projects]);

    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    // ★★★ Linter Error 対策: 条件付きでレンダリングするコンテンツを事前に定義 ★★★
    let chartContent;
    if (progressData && progressData.length > 0) {
        chartContent = (
            <Box sx={{
                width: '100%',
                height: 280,
                overflowX: isMobile ? 'auto' : 'visible',
                '&::-webkit-scrollbar': { height: '8px' },
                '&::-webkit-scrollbar-thumb': { backgroundColor: 'divider', borderRadius: '4px' }
            }}>
                <Box sx={{ minWidth: isMobile ? '600px' : 'auto', height: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                            data={progressData}
                            margin={{ top: 5, right: isMobile ? 30 : 15, left: isMobile ? 0 : -15, bottom: 5 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" fontSize={10} tick={{ dy: 5 }} interval={isMobile ? 1 : 'preserveStartEnd'} />
                            <YAxis
                                label={{ value: '完了率 (%)', angle: -90, position: 'insideLeft', fontSize: 10, dx: -10 }}
                                domain={[0, 100]}
                                fontSize={10}
                                tick={{ dx: -5 }}
                            />
                            {/* wrapperStyle を削除 */}
                            <RechartsTooltip content={<CustomTooltip />} />
                            <Legend wrapperStyle={{ fontSize: '0.75rem', paddingTop: '5px' }} />
                            <ReferenceLine x={todayFormatted} stroke="red" strokeDasharray="3 3" label={{ value: '今日', position: 'insideTopRight', fill: 'red', fontSize: 10 }} />
                            {projectLines.map((line, idx) => (
                                <Line
                                    key={`${line.dataKey}-${idx}`}
                                    type="monotone"
                                    dataKey={line.dataKey}
                                    name={line.name}
                                    stroke={line.color}
                                    strokeWidth={2}
                                    dot={false}
                                    strokeOpacity={line.isPlanned ? 0.4 : 1}
                                    strokeDasharray={line.isPlanned ? "5 5" : ""}
                                    connectNulls={false}
                                />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                </Box>
            </Box>
        );
    } else {
        chartContent = (
            <Typography sx={{ textAlign: 'center', color: 'text.secondary', height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                表示するデータがありません。
            </Typography>
        );
    }

    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle1" sx={{ flexGrow: 1, fontWeight: 'bold', fontSize: '0.9rem' }}>
                    プロジェクト進捗状況 (計画 vs 実績)
                </Typography>
                <MuiTooltip title="グラフをクリックして拡大表示します。計画（点線）: タスクが期日通りに完了した場合の理想進捗。実績（実線）: 完了タスク(100%)+進行中タスク(50%)で計算した実際の進捗（今日まで表示）。グラフはプロジェクト終了日+1週まで表示。今日の日付に赤線を表示。">
                    <IconButton size="small">
                        <HelpOutlineIcon fontSize="small" />
                    </IconButton>
                </MuiTooltip>
            </Box>

            {/* ★★★ クリック可能な Box 内で chartContent をレンダリング ★★★ */}
            <Box onClick={handleOpenModal} sx={{ cursor: 'pointer', border: '1px dashed grey', p: 1 }}>
                {chartContent}
            </Box>

            {/* ★★★ モーダルウィンドウ ★★★ */}
            <Modal
                open={isModalOpen}
                onClose={handleCloseModal}
                aria-labelledby="modal-chart-title"
                aria-describedby="modal-chart-description"
            >
                <Box sx={modalStyle}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography id="modal-chart-title" variant="h6" component="h2">
                            プロジェクト進捗 (拡大)
                        </Typography>
                        <IconButton onClick={handleCloseModal} size="small">
                            <CloseIcon />
                        </IconButton>
                    </Box>
                    {/* モーダル内にグラフコンテンツを描画 */}
                    <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
                        {progressData && progressData.length > 0 ? (
                            <ModalChartContent
                                progressData={progressData}
                                projectLines={projectLines}
                                todayFormatted={todayFormatted}
                            />
                        ) : (
                            <Typography sx={{ flexGrow: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                データなし
                            </Typography>
                        )}
                    </Box>
                </Box>
            </Modal>
        </Box>
    );
};

export default ProjectProgressChart;
