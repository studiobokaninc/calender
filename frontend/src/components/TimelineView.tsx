import React, { useMemo, useRef, useEffect } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { Task, Project, User } from '../types';
import { parseISO, isValid, min as dateMin, max as dateMax, addDays, subDays } from 'date-fns'; // date-fns を使う想定
// ★★★ vis-timeline/standalone と vis-data をインポート ★★★
import { Timeline } from 'vis-timeline/standalone';
import { DataSet } from 'vis-data/peer'; // peer dependency を利用
import 'vis-timeline/styles/vis-timeline-graph2d.min.css'; // ここでインポートしても良い

// vis-timeline-react types (simplified for now)
interface TimelineGroup {
  id: string;
  content: string;
}

interface TimelineItem {
  id: string;
  group: string;
  content: string;
  start: string;
  end?: string; // end might be optional or derived
}

interface TimelineViewProps {
  tasks: Task[];
  projects: Project[];
  users: User[];
}

// ★★★ トポロジカルソート用ヘルパー関数 ★★★
const topologicalSortTasks = (tasks: Task[]): Task[] => {
    if (!tasks || tasks.length === 0) return [];

    const taskMap = new Map<string, Task>(tasks.map(t => [t.id, t]));
    const adj = new Map<string, string[]>(); // 依存先 -> 依存元リスト
    const inDegree = new Map<string, number>();
    const sortedList: Task[] = [];
    const queue: string[] = [];

    // グラフと入次数を初期化
    tasks.forEach(task => {
        inDegree.set(task.id, 0);
        adj.set(task.id, []);
    });

    // 依存関係に基づいてグラフを構築
    tasks.forEach(task => {
        if (task.dependsOn) {
            task.dependsOn.forEach(depId => {
                // depId が実際に taskMap に存在するか確認
                if (taskMap.has(depId)) {
                    // task は depId に依存する
                    // adj には、depId が完了したら次に進める可能性のある task を記録
                    const dependents = adj.get(depId) || [];
                    dependents.push(task.id);
                    adj.set(depId, dependents);
                    // task の入次数を増やす
                    inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
                }
            });
        }
    });

    // 入次数が0のノードをキューに追加 (依存関係のないタスク)
    inDegree.forEach((degree, taskId) => {
        if (degree === 0) {
            queue.push(taskId);
        }
    });

    // 開始日でキューをソート (依存がないもの同士は開始日順)
    queue.sort((a, b) => {
        const taskA = taskMap.get(a);
        const taskB = taskMap.get(b);
        const startA = taskA?.taskStartDate ? parseISO(taskA.taskStartDate) : null;
        const startB = taskB?.taskStartDate ? parseISO(taskB.taskStartDate) : null;
        if (startA && startB && isValid(startA) && isValid(startB)) return startA.getTime() - startB.getTime();
        if (startA && isValid(startA)) return -1;
        if (startB && isValid(startB)) return 1;
        return 0;
    });

    // ソート処理
    while (queue.length > 0) {
        const taskId = queue.shift()!;
        const task = taskMap.get(taskId);
        if (task) {
            sortedList.push(task);
        }

        // 依存先のタスクの入次数を減らす
        (adj.get(taskId) || []).forEach(dependentId => {
            const newDegree = (inDegree.get(dependentId) || 1) - 1;
            inDegree.set(dependentId, newDegree);
            if (newDegree === 0) {
                // 新たに入次数が0になったものをキューに追加
                // 本来はここでもソートが必要だが、複雑化するため一旦省略
                // (依存関係が解消されたタスクが複数ある場合、その中での開始日順序)
                queue.push(dependentId);
                // TODO: Consider sorting the queue here based on start date among newly added items
            }
        });
         // 依存関係が解消された順でキューに追加されるため、ある程度開始日も考慮されるが、
         // 厳密な開始日順ではない可能性がある。キュー内ソートの追加を検討。
         queue.sort((a, b) => {
            const taskA = taskMap.get(a);
            const taskB = taskMap.get(b);
            const startA = taskA?.taskStartDate ? parseISO(taskA.taskStartDate) : null;
            const startB = taskB?.taskStartDate ? parseISO(taskB.taskStartDate) : null;
            if (startA && startB && isValid(startA) && isValid(startB)) return startA.getTime() - startB.getTime();
            if (startA && isValid(startA)) return -1;
            if (startB && isValid(startB)) return 1;
            return 0;
        });
    }

    // 循環依存チェック
    if (sortedList.length !== tasks.length) {
        console.warn("Cycle detected in task dependencies, not all tasks could be sorted.");
        // 循環しているタスクを除外したリストを返すか、エラーを投げるか、
        // あるいはソートできなかったタスクをリストの末尾に追加するかなどを検討。
        // ここではソートできたものだけを返す。
    }

    return sortedList;
};

const TimelineView: React.FC<TimelineViewProps> = ({ tasks, projects, users }) => {
  console.log("Rendering TimelineView with:", { numTasks: tasks.length, numProjects: projects.length });

  // ★★★ タイムライン描画用コンテナの参照 ★★★
  const timelineContainerRef = useRef<HTMLDivElement>(null);

  const { timelineGroups, timelineItems, timeRange } = useMemo(() => {
    console.log("Processing timeline data with sorting...");

    if (projects.length === 0 || tasks.length === 0) {
        return { timelineGroups: [], timelineItems: [], timeRange: { min: null, max: null } };
    }

    // 1. 各プロジェクトの最初のタスク開始日を見つける
    const projectStartDates = new Map<string, Date>();
    tasks.forEach(task => {
        if (task.taskStartDate) {
            const startDate = parseISO(task.taskStartDate);
            if (isValid(startDate)) {
                const currentMin = projectStartDates.get(task.projectId);
                if (!currentMin || startDate < currentMin) {
                    projectStartDates.set(task.projectId, startDate);
                }
            }
        }
    });

    // 2. Projects to Groups (最初のタスク開始日でソート、なければ最後に)
    const groups: TimelineGroup[] = projects
        .map(p => ({ 
            id: p.id, 
            content: p.name, 
            startDate: projectStartDates.get(p.id) // ソート用に追加
        }))
        .sort((a, b) => {
            if (a.startDate && b.startDate) return a.startDate.getTime() - b.startDate.getTime();
            if (a.startDate) return -1; // a のみ日付あり
            if (b.startDate) return 1;  // b のみ日付あり
            return a.content.localeCompare(b.content); // 両方日付なしなら名前順
        })
        // ソート後に startDate プロパティを削除 (オプション)
        .map(({ startDate, ...rest }) => rest);

    // 3. Tasks をプロジェクトごとにグループ化
    const tasksByProject = new Map<string, Task[]>();
    tasks.forEach(task => {
        if (task.taskStartDate && task.taskDueDate) { // 開始・終了があるもののみ
            const projectTasks = tasksByProject.get(task.projectId) || [];
            projectTasks.push(task);
            tasksByProject.set(task.projectId, projectTasks);
        }
    });

    // 4. 各プロジェクト内でタスクをソート (★トポロジカルソート適用★)
    let sortedItems: TimelineItem[] = [];
    const allValidDates: Date[] = [];

    groups.forEach(group => {
        const projectTasks = tasksByProject.get(group.id) || [];
        if (projectTasks.length === 0) return;

        // ★★★ topologicalSortTasks を使用 ★★★
        const sortedProjectTasks = topologicalSortTasks(projectTasks);

        // ソート結果を timelineItems に変換 (変更なし)
        sortedProjectTasks.forEach(t => {
            const start = parseISO(t.taskStartDate!); 
            const end = parseISO(t.taskDueDate!); 
            if (isValid(start) && isValid(end)) {
                sortedItems.push({
                    id: t.id,
                    group: t.projectId,
                    content: t.title,
                    start: t.taskStartDate!, 
                    end: t.taskDueDate!,     
                });
                allValidDates.push(start);
                allValidDates.push(end);
            }
        });
    });

    // 5. 全体の期間を計算
    const minDate = allValidDates.length > 0 ? dateMin(allValidDates) : null;
    const maxDate = allValidDates.length > 0 ? dateMax(allValidDates) : null;
    // ★★★ 表示期間に少し余裕を持たせる ★★★
    const rangeMin = minDate ? subDays(minDate, 7) : new Date(); // 7日前から
    const rangeMax = maxDate ? addDays(maxDate, 7) : addDays(new Date(), 30); // 7日後まで
    const timeRange = { min: rangeMin, max: rangeMax };

    console.log("Processed timeline groups:", groups.length, "items:", sortedItems.length, "range:", timeRange);
    return { timelineGroups: groups, timelineItems: sortedItems, timeRange };

  }, [tasks, projects]);

  // ★★★ タイムラインのオプションを定義 ★★★
  const timelineOptions = {
    // start: timeRange.min, // 初期表示範囲 (開始)
    // end: timeRange.max,   // 初期表示範囲 (終了)
    min: timeRange.min ?? undefined, // null の場合は undefined
    max: timeRange.max ?? undefined, // null の場合は undefined
    zoomMin: 1000 * 60 * 60 * 24 * 7, // 最小ズームレベル (例: 1週間)
    zoomMax: 1000 * 60 * 60 * 24 * 365 * 2, // 最大ズームレベル (例: 2年)
    // ★★★ stack: false を削除 (または stack: true) ★★★
    // stack: false,         
    horizontalScroll: true, // 水平スクロール有効
    verticalScroll: true,   // 垂直スクロール有効 (グループが多い場合)
    zoomKey: 'ctrlKey' as const,     // Ctrlキー + ホイールでズーム
    // locale: 'ja',        // 必要なら日本語化
    // selectable: true,     // アイテム選択を有効にするか
    // editable: {           // アイテムの編集設定
    //   add: false,
    //   updateTime: true, 
    //   updateGroup: false,
    //   remove: false,
    //   overrideItems: false
    // },
    // orientation: 'top', // 時間軸を上に表示する場合
    height: '100%',         // コンテナの高さに合わせる
    maxHeight: '100%',      // コンテナの高さに合わせる
  };

  // ★★★ useEffect でタイムラインを初期化・更新 ★★★
  useEffect(() => {
    let timeline: Timeline | null = null;

    if (timelineContainerRef.current && timelineItems.length > 0 && timelineGroups.length > 0) {
        console.log("Initializing Timeline...");
        // DataSet に変換
        const itemsDataSet = new DataSet(timelineItems);
        const groupsDataSet = new DataSet(timelineGroups);

        // Timeline インスタンス生成
        timeline = new Timeline(timelineContainerRef.current, itemsDataSet, groupsDataSet, timelineOptions);
        
        // イベントリスナー等を追加する場合はここに追加
        // timeline.on('select', properties => { ... });

    } else {
        console.log("Timeline not initialized. Container ref:", timelineContainerRef.current, "Items:", timelineItems.length, "Groups:", timelineGroups.length);
    }

    // クリーンアップ関数
    return () => {
        if (timeline) {
            console.log("Destroying timeline instance.");
            timeline.destroy();
            timeline = null; // 参照をクリア
        }
    };
    // timelineOptions も依存配列に含める (オプションが変わった場合再描画)
  }, [timelineItems, timelineGroups, timelineOptions]); 

  return (
    <Paper sx={{ p: 2, height: '500px', overflow: 'hidden' }}>
      <Typography variant="h6" component="h2" sx={{ mb: 2 }}>
        タイムラインビュー
      </Typography>
      {/* ★★★ Timeline コンポーネントを div に変更し、ref を設定 ★★★ */}
      <Box sx={{ height: 'calc(100% - 48px)' }}>
        {/* 常にコンテナ div は描画しておく */} 
        <div ref={timelineContainerRef} style={{ height: '100%' }} /> 

        {/* データがない場合のメッセージ (必要なら残す) */}
        {timelineItems.length === 0 || timelineGroups.length === 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'text.secondary', position: 'absolute', top: 0, left: 0, width: '100%' }}>
            <Typography variant="body2">タイムラインに表示できるデータがありません。</Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
};

export default TimelineView; 