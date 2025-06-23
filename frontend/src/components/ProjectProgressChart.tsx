import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Project, Task } from '../types'; // Adjust path if necessary
import { Box, Typography, Tooltip as MuiTooltip, IconButton, Select, MenuItem, FormControl, InputLabel, Modal } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import CloseIcon from '@mui/icons-material/Close';
import { parseISO, format, eachDayOfInterval, isBefore, isEqual, startOfDay, endOfDay, differenceInDays, min, max, startOfToday, addDays, isAfter, isValid } from 'date-fns'; // ★★★ date-fns をインポート ★★★

interface ProjectProgressChartProps {
    projects: Project[];
    tasks: Task[];
    selectedProjectId: string | 'all'; // 'all' or a specific project ID
    onProjectChange: (projectId: string | 'all') => void;
}

// ★★★ データ型の定義を明確化 ★★★
interface ProgressDataPoint {
    date: string;
    [key: string]: number | string | null; // Allows for project_actual, project_planned keys + date
}

// ★★★ 引数に today を追加 ★★★
const calculateProgressData = (projects: Project[], tasks: Task[], selectedProjectId: string | 'all', today: Date): ProgressDataPoint[] => {
    console.log("=== 進捗データ計算開始 ===");
    console.log("プロジェクト数:", projects.length);
    console.log("タスク数:", tasks.length);
    console.log("選択されたプロジェクトID:", selectedProjectId);

    // タスクのステータス履歴を確認
    tasks.forEach(task => {
        if (task.status_history && task.status_history.length > 0) {
            console.log(`タスク ${task.id} (${task.name}) のステータス履歴:`, {
                現在のステータス: task.status,
                履歴数: task.status_history.length,
                履歴: task.status_history.map(h => ({
                    ステータス: h.status,
                    日時: h.changed_at
                }))
            });
        }
    });

    const targetProjects = projects.filter(p => selectedProjectId === 'all' || String(p.id) === selectedProjectId);
    if (targetProjects.length === 0) {
        console.log("対象プロジェクトが存在しません");
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
            console.error(`プロジェクト ${p.id} の日付解析エラー:`, e);
        }
    });

    // X軸の最終日を計算
    let chartAxisEndDate: Date;
    if (latestProjectEndDate) {
        chartAxisEndDate = addDays(latestProjectEndDate, 7);
    } else {
        chartAxisEndDate = addDays(today, 7);
        console.warn("プロジェクト終了日が見つかりません。今日 + 7日を軸の終了日として使用します。");
    }
    
    // overallMinDateの検証
    if (!overallMinDate || !isValid(overallMinDate) || isBefore(chartAxisEndDate, overallMinDate)) {
        console.warn("無効な開始日または終了日より後の日付です。開始日を調整します。");
        overallMinDate = startOfDay(new Date(chartAxisEndDate.getTime() - 30 * 24 * 60 * 60 * 1000));
        if (!isValid(overallMinDate) || isBefore(chartAxisEndDate, overallMinDate)) {
            overallMinDate = startOfDay(chartAxisEndDate);
        }
    }

    console.log("計算期間:", format(overallMinDate, 'yyyy/MM/dd'), "～", format(chartAxisEndDate, 'yyyy/MM/dd'));

    // 日付間隔の計算
    const dateIntervals = eachDayOfInterval({ start: overallMinDate, end: chartAxisEndDate });
    console.log("計算対象日数:", dateIntervals.length);

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

            // 実績進捗の計算
            if (isBefore(today, currentDate)) {
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
                                        console.warn(`タスク ${t.id} (${t.name}) のステータス履歴に日付がありません:`, entry);
                                        continue;
                                    }

                                    const entryDate = startOfDay(parseISO(entry.changed_at));
                                    if (isBefore(entryDate, currentDate) || isEqual(entryDate, currentDate)) {
                                        lastValidEntry = entry;
                                    }
                                } catch (e) {
                                    console.error(`日付解析エラー (タスク ${t.id}):`, e);
                                }
                            }

                            currentStatusEntry = lastValidEntry;

                            if (currentStatusEntry) {
                                // ステータスに応じた進捗率を設定
                                switch (currentStatusEntry.status) {
                                    case 'completed':
                                        taskContribution = 1;
                                        break;
                                    case 'in-progress':
                                        taskContribution = 0.5;
                                        break;
                                    case 'review':
                                        taskContribution = 0.75;
                                        break;
                                    case 'delayed':
                                        taskContribution = 0.25;
                                        break;
                                    default:
                                        taskContribution = 0;
                                }

                                // 進捗貢献度が0より大きい場合のみログを出力
                                if (taskContribution > 0) {
                                    console.log(`タスク ${t.id} (${t.name}) の進捗貢献:`, {
                                        ステータス: currentStatusEntry.status,
                                        貢献度: taskContribution,
                                        日時: currentStatusEntry.changed_at,
                                        現在の日付: dateStr,
                                        タスクID: t.id
                                    });
                                }
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
        });

        return dailyProgress;
    });

    console.log("=== 進捗データ計算完了 ===");
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

const ProjectProgressChart: React.FC<ProjectProgressChartProps> = ({ projects, tasks, selectedProjectId, onProjectChange }) => {
    // ★★★ 今日をコンポーネントの state または定数として定義 ★★★
    const today = useMemo(() => startOfToday(), []);
    const todayFormatted = useMemo(() => format(today, 'MM/dd'), [today]);

    // ★★★ モーダル開閉用の state ★★★
    const [isModalOpen, setIsModalOpen] = useState(false);
    const handleOpenModal = () => setIsModalOpen(true);
    const handleCloseModal = () => setIsModalOpen(false);

    const progressData = useMemo(
        // ★★★ calculateProgressData に today を渡す ★★★
        () => calculateProgressData(projects, tasks, selectedProjectId, today),
        [projects, tasks, selectedProjectId, today] // Add today to dependency array
    );

    // ★★★ 表示する線の定義を変更 (実績と計画) ★★★
    const projectLines = useMemo(() => {
        const lines: any[] = [];
        const targetProjects = projects.filter(p => selectedProjectId === 'all' || String(p.id) === selectedProjectId);
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
    }, [projects, selectedProjectId]);

    // ★★★ Linter Error 対策: 条件付きでレンダリングするコンテンツを事前に定義 ★★★
    let chartContent;
    if (progressData && progressData.length > 0) {
        chartContent = (
            <ResponsiveContainer width="100%" height={280}>
                <LineChart
                    data={progressData}
                    margin={{ top: 5, right: 15, left: -15, bottom: 5 }}
                >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" fontSize={10} tick={{ dy: 5 }} />
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
                <FormControl size="small" sx={{ minWidth: 150, mr: 1 }}>
                    <InputLabel id="project-filter-label" sx={{ fontSize: '0.8rem' }}>プロジェクト</InputLabel>
                    <Select
                        labelId="project-filter-label"
                        value={selectedProjectId}
                        label="プロジェクト"
                        onChange={(e) => onProjectChange(e.target.value as string)}
                        sx={{ fontSize: '0.8rem' }}
                    >
                        <MenuItem value="all">すべてのプロジェクト</MenuItem>
                        {projects.map((proj) => (
                            <MenuItem key={proj.id} value={proj.id}>
                                {proj.name}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
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

// export default ProjectProgressChart; // ★★★ 重複をコメントアウト ★★★

export default ProjectProgressChart;
// export default ProjectProgressChart; // ★★★ 重複をコメントアウト ★★★
var _c, _c2, _c3;$RefreshReg$(_c, "CustomTooltip");$RefreshReg$(_c2, "ModalChartContent");$RefreshReg$(_c3, "ProjectProgressChart");
