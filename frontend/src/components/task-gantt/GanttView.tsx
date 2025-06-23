import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Gantt, Task as GanttTask, EventOption, StylingOption, ViewMode } from 'gantt-task-react';
import "gantt-task-react/dist/index.css";
// import { ViewSwitcher } from './ViewSwitcher'; // 存在しないためコメントアウト
// import { getStartEndDateForProject, initTasks } from './helpers'; // 存在しないためコメントアウト
import { Task, Project } from '../../types';
// import TaskTooltipContent from './TaskTooltipContent'; // 存在しないためコメントアウト
import { format, parseISO } from 'date-fns';
import { Box } from '@mui/material';

interface GanttViewProps {
  projects: Project[];
  tasks: Task[];
  onTaskClick: (task: GanttTask) => void;
  // 他の必要なプロパティ...
}

const GanttView: React.FC<GanttViewProps> = ({ projects, tasks: originalTasks, onTaskClick /* 他のProps */ }) => {
    const [view, setView] = useState<ViewMode>(ViewMode.Day);
    const [isChecked, setIsChecked] = useState(true); // isChecked はリスト表示の有無に使われているようなので残す
    const [columnWidth, setColumnWidth] = useState(60); // カラム幅も残す
    const ganttRef = useRef<HTMLDivElement>(null);
    // 他の State や Ref (ViewSwitcher や helpers に関連するものは削除または修正が必要な場合あり)

    // ★★★ ガントチャート用のタスクリストをフィルタリング＆変換 ★★★
    const validGanttTasks = useMemo(() => {
        return originalTasks
            .filter(task => {
                const startDateValid = task.start_date && !isNaN(parseISO(task.start_date).getTime());
                const endDateValid = task.due_date && !isNaN(parseISO(task.due_date).getTime());
                return startDateValid && endDateValid;
            })
            .map(task => ({
                start: parseISO(task.start_date!),
                end: parseISO(task.due_date!),
                name: task.name || '名称未設定',
                id: String(task.id),
                type: 'task' as 'task',
                progress: task.status === 'completed' ? 100 : (task.status === 'in-progress' ? 50 : 0),
                isDisabled: false,
                styles: { progressColor: '#ffbb54', progressSelectedColor: 'white' },
                project: String(task.project_id),
                originalTask: task
            } as GanttTask & { originalTask: Task }));
    }, [originalTasks]);
    // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★

    // --- 以下、既存のuseEffectやハンドラ関数など (省略) ---
    const handleTaskChange = (task: GanttTask) => {
        console.log("On date change Id:" + task.id);
        // API 呼び出しなど
    };

    const handleTaskDelete = (task: GanttTask) => {
        console.log("On delete Id:" + task.id);
        // API 呼び出しなど
    };

    const handleProgressChange = async (task: GanttTask) => {
        console.log("On progress change Id:" + task.id);
        // API 呼び出しなど
    };

    const handleDblClick = (task: GanttTask) => {
        alert("On Double Click event Id:" + task.id);
    };

    const handleSelect = (task: GanttTask, isSelected: boolean) => {
        console.log(task.name + " has " + (isSelected ? "selected" : "unselected"));
    };

    const handleExpanderClick = (task: GanttTask) => {
        console.log("On expander click Id:" + task.id);
    };
    // --- (省略ここまで) ---

    return (
        <Box ref={ganttRef} sx={{ width: '100%', height: 'calc(100vh - 200px)', overflow: 'hidden', fontFamily: 'Arial, sans-serif' }}>
            {/* <ViewSwitcher isChecked={isChecked} onViewModeChange={setView} onViewListChange={setIsChecked}/> */}
            {/* ViewSwitcher がないので、ビューモード変更やリスト表示切り替えのUIは別途実装が必要 */}
            <div style={{ marginBottom: '10px' }}> {/* 仮のUIスペース */} 
                <span>表示モード: {view}</span> {/* 現在のモード表示 */} 
                <button onClick={() => setView(ViewMode.Day)}>日</button>
                <button onClick={() => setView(ViewMode.Week)}>週</button>
                <button onClick={() => setView(ViewMode.Month)}>月</button>
                <label style={{ marginLeft: '10px' }}>
                    <input type="checkbox" checked={isChecked} onChange={() => setIsChecked(!isChecked)} />
                    タスクリスト表示
                </label>
            </div>

            <h3>ガントチャート</h3>
            {validGanttTasks.length > 0 ? (
                 <Gantt
                    tasks={validGanttTasks}
                    viewMode={view}
                    onDateChange={handleTaskChange}
                    onDelete={handleTaskDelete}
                    onProgressChange={handleProgressChange}
                    onDoubleClick={handleDblClick}
                    onSelect={handleSelect}
                    onExpanderClick={handleExpanderClick}
                    listCellWidth={isChecked ? "155px" : ""} // isChecked は state として存在
                    ganttHeight={600}
                    columnWidth={columnWidth}
                    locale="ja"
                    // TooltipContent={CustomTooltipContent} // 存在しないため削除 (デフォルトツールチップになる)
                />
            ) : (
                <div>表示可能なタスクがありません。タスクに有効な開始日と終了日が設定されているか確認してください。</div>
            )}
        </Box>
    );
};

// const CustomTooltipContent = ... // 存在しないため削除

export default GanttView; 