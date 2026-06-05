import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { parseISO, format, eachDayOfInterval, addDays, isBefore, isAfter, startOfDay } from 'date-fns';

import { Task, Project } from '../../types'; // 型定義をインポート

interface ProjectProgressChartProps {
  projects: Project[];
  tasks: Task[];
}

// データ計算ロジック（コンポーネント外だが、Propsで型を受け取る）
const calculateProgressData = (projects: Project[], tasks: Task[]) => {
  console.log("=== 進捗データ計算開始 ===");
  console.log("プロジェクト数:", projects.length);
  console.log("タスク数:", tasks.length);

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

  if (!projects.length || !tasks.length) {
    console.log("プロジェクトまたはタスクが存在しません");
    return [];
  }

  // 全体の開始日と終了日を計算
  const allStartDates = tasks.map(t => t.start_date ? parseISO(t.start_date) : new Date()).filter(d => !isNaN(d.getTime()));
  const allDueDates = tasks.map(t => t.due_date ? parseISO(t.due_date) : new Date()).filter(d => !isNaN(d.getTime()));

  if (!allStartDates.length || !allDueDates.length) {
    console.log("有効な開始日または終了日が存在しません");
    return [];
  }

  const overallStartDate = startOfDay(new Date(Math.min(...allStartDates.map(d => d.getTime()))));
  const overallEndDate = startOfDay(addDays(new Date(Math.max(...allDueDates.map(d => d.getTime()))), 1));
  const today = startOfDay(new Date());

  console.log("計算期間:", format(overallStartDate, 'yyyy/MM/dd'), "～", format(overallEndDate, 'yyyy/MM/dd'));

  const dateArray = eachDayOfInterval({ start: overallStartDate, end: overallEndDate });
  console.log("計算対象日数:", dateArray.length);

  const progressData = dateArray.map(currentDate => {
    const dateStr = format(currentDate, 'MM/dd');
    const dailyProgress: { [key: string]: number | string | null } = { date: dateStr };

    projects.forEach(project => {
      const projectTasks = tasks.filter(task => task.project_id === project.id);
      const totalTasksInProject = projectTasks.length;
      const plannedProgressKey = `${project.name}_計画`;
      const actualProgressKey = `${project.name}_実績`;

      // --- 計画線の計算 ---
      const tasksDueByDate = projectTasks.filter(t => t.due_date && isBefore(parseISO(t.due_date), addDays(currentDate, 1)));
      if (totalTasksInProject > 0) {
        dailyProgress[plannedProgressKey] = Math.round((tasksDueByDate.length / totalTasksInProject) * 100);
      } else {
        dailyProgress[plannedProgressKey] = 0;
      }

      // --- 実績線の計算 ---
      let actualCompletedCount = 0;
      let actualInProgressCount = 0;

      projectTasks.forEach(task => {
        if (task.status_history && task.status_history.length > 0) {
          // ステータス履歴を日付でソート（新しい順）
          const sortedHistory = [...task.status_history].sort((a, b) => {
            const dateA = new Date(a.changed_at).getTime();
            const dateB = new Date(b.changed_at).getTime();
            return dateB - dateA;  // 降順（新しい順）
          });

          // 現在の日付以前の最新のステータスを取得
          const currentStatusEntry = sortedHistory.find(entry => {
            const entryDate = parseISO(entry.changed_at);
            return isBefore(entryDate, addDays(currentDate, 1));
          });

          if (currentStatusEntry) {
            const status = currentStatusEntry.status.toLowerCase();
            console.log(`タスク ${task.id} (${task.name}) の ${dateStr} 時点のステータス:`, {
              ステータス: status,
              日時: currentStatusEntry.changed_at,
              現在の日付: dateStr
            });

            if (status === 'completed') {
              actualCompletedCount++;
            } else if (status === 'in-progress' || status === 'in_progress') {
              actualInProgressCount++;
            }
          }
        }
      });

      if (totalTasksInProject > 0) {
        // 完了タスクは100%、進行中タスクは50%として計算
        const actualProgress = ((actualCompletedCount * 1.0) + (actualInProgressCount * 0.5)) / totalTasksInProject * 100;
        dailyProgress[actualProgressKey] = Math.round(actualProgress);
        
        // 詳細なデバッグログ
        console.log(`[${dateStr}] プロジェクト ${project.name} の進捗計算:`, {
          総タスク数: totalTasksInProject,
          完了タスク数: actualCompletedCount,
          進行中タスク数: actualInProgressCount,
          計算式: `(${actualCompletedCount} * 1.0 + ${actualInProgressCount} * 0.5) / ${totalTasksInProject} * 100`,
          進捗率: `${dailyProgress[actualProgressKey]}%`
        });
      } else {
        dailyProgress[actualProgressKey] = 0;
      }

      // 未来の日付の実績はnullに設定
      if (isAfter(currentDate, today)) {
        dailyProgress[actualProgressKey] = null;
      }
    });

    return dailyProgress;
  });

  console.log("=== 進捗データ計算完了 ===");
  return progressData;
};

const ProjectProgressChart: React.FC<ProjectProgressChartProps> = ({ projects, tasks }) => {
  console.log("ProjectProgressChart: コンポーネントのレンダリング開始");
  const progressData = useMemo(() => {
    console.log("ProjectProgressChart: 進捗データの計算開始");
    const data = calculateProgressData(projects, tasks);
    console.log("ProjectProgressChart: 進捗データの計算完了", data);
    return data;
  }, [projects, tasks]);

  if (!progressData || progressData.length === 0) {
    console.log("ProjectProgressChart: データが不足しているため、チャートを表示できません");
    return <div>プロジェクトまたはタスクデータが不足しているため、進捗チャートを表示できません。</div>;
  }

  console.log("ProjectProgressChart: チャートの描画開始");
  const projectColors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#387908', '#ff0090'];

  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart
        data={progressData}
        margin={{
          top: 5,
          right: 30,
          left: 20,
          bottom: 5,
        }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis label={{ value: '進捗率 (%)', angle: -90, position: 'insideLeft' }} />
        <Tooltip />
        <Legend />
        {projects.map((project, index) => (
          <React.Fragment key={project.id}>
            <Line
              type="monotone"
              dataKey={`${project.name}_計画`}
              stroke={projectColors[index % projectColors.length]}
              strokeDasharray="5 5"
              activeDot={{ r: 8 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey={`${project.name}_実績`}
              stroke={projectColors[index % projectColors.length]}
              activeDot={{ r: 8 }}
              connectNulls
            />
          </React.Fragment>
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
};

export default ProjectProgressChart; 
 
 
 
 
 
 
 
 
 
 
 