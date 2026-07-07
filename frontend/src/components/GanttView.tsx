import React, { useMemo, useState, useEffect, createContext, useContext, useRef, useCallback, memo, forwardRef } from 'react';
import { Task as GtrTask, Gantt as ReactGantt, ViewMode, StylingOption, DisplayOption } from 'gantt-task-react'; // ★★★ Gantt を ReactGantt としてインポート ★★★、Ganttとは、ガントチャートを表示するためのライブラリです。
import "gantt-task-react/dist/index.css"; // ★★★ ライブラリのCSSをインポート ★★★、gantt-task-react/dist/index.cssとは、ガントチャートのライブラリのCSSです。CSSとは、ウェブページの見た目を作成するための言語です。
import {
  Paper,
  Typography,
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  SelectChangeEvent,
  Stack,
  Tooltip,
  IconButton,
  TextField,
  Button,
  Grid,
  ToggleButton,
  ToggleButtonGroup,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Alert,
  Popover,
  Chip,
  Snackbar,
  useTheme,
} from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { Task, Project, User } from '../types'; // ★★★ パス修正 ../../types -> ../types ★★★
import { getTaskStatusColor, migrateLegacyStatus } from '../utils/taskStatus';
import { parseISO, format as formatDate, isValid, differenceInCalendarDays, addDays, startOfDay, isEqual } from 'date-fns';
import api, { setAuthErrorCallback } from '../services/api';
import axios from 'axios';
import NavigateBefore from '@mui/icons-material/NavigateBefore';
import NavigateNext from '@mui/icons-material/NavigateNext';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import { useNavigate, useLocation } from 'react-router-dom';
// ↓ このパスの import エラーを防ぐためにコメントアウトまたは適切なパスに修正してください
// import { useSnackbar } from '../contexts/SnackbarContext';
import styled from '@emotion/styled';

// ★★★ getProjectName/getUserName 関数定義をコンポーネント外に移動 ★★★
const getProjectName = (projectId: number | null, projectList: Project[]): string => {
  if (projectId === null) return 'Unknown Project'; // null チェックを追加
  const project = projectList.find(p => p.id === projectId);
  return project ? project.name : `Project ${projectId}`;
};

const getUserName = (userId: number | null, userList: User[]): string => {
  if (userId === null) return 'Unassigned'; // null チェックを追加
  const user = userList.find(u => u.id === userId);
  // full_name が null の場合に username を使う、両方なければ ID を表示
  return user ? (user.full_name || user.username || `User ${userId}`) : `User ${userId}`;
};
// ★★★ ここまで移動 ★★★

// グローバル関数の型定義
declare global {
  interface Window {
    scrollGanttLeft: (amount?: number) => void;
    scrollGanttRight: (amount?: number) => void;
    scrollGanttUp: (amount?: number) => void;
    scrollGanttDown: (amount?: number) => void;
    ganttScrollRef: {
      horizontal: HTMLElement | null;
      vertical: HTMLElement | null;
    };
    // ガントチャート修正用のグローバル変数
    __GANTT_FIX_APPLIED?: boolean;
    __REACT_PATCHED?: boolean;
    __DISABLE_DEPENDENCY_CONSTRAINTS?: boolean;
    __DRAGGING_TASK?: boolean;
    React?: any; // ★★★ 重複を削除 ★★★
    handleWheel2?: any;
    TaskItem2?: any;
    TaskGanttContent2?: any;
    onGanttPatchApplied?: () => void;
    __ganttCleanupData?: any; // クリーンアップ用データ
    // React?: any; // Reactのグローバル参照 (パッチ用) // ★★★ 削除 ★★★
    __LAYOUT_EFFECT_PATCHED?: boolean; // useLayoutEffect パッチフラグ
    taskItemFixed?: boolean; // TaskItem修正フラグ
    ganttDateRange?: (tasks: any[]) => Date[]; // ganttDateRange関数の型
    __GANTT_DATE_RANGE_PATCHED?: boolean; // ganttDateRange パッチフラグ
  }
}

// 拡張したTask型をgantt-task-reactの型と互換性を持たせる
interface CustomGtrTask extends GtrTask {
  project?: string;
  assignee?: string;
  styles?: {
    backgroundColor?: string;
    backgroundSelectedColor?: string;
    progressColor?: string;
    progressSelectedColor?: string;
  };
  projectId?: string;
  dependencies?: string[];
  isDisabled?: boolean;
  fullName?: string; // ★ 元のフルネームを保持するプロパティ
}

// イベントハンドラの型を拡張、イベントハンドラとは、イベントが発生した時に呼び出される関数です。
type CustomTaskEventHandler = (
  task: GtrTask,
  start: Date,
  end: Date
) => void;//voidとは、何も返さないことを意味する型です。これが無いと、エラーが発生します。

type CustomProgressEventHandler = (
  task: GtrTask,
  progress: number
) => void;

type CustomSelectEventHandler = (task: GtrTask) => void;
type CustomExpanderEventHandler = () => void;
type CustomTaskDoubleClickHandler = (task: GtrTask) => void;

// カスタムイベントハンドラの型定義を追加
type TaskMoveHandler = (
  task: GtrTask,
  fromRow: number,
  toRow: number
) => void;

type TaskDateChangeHandler = (
  task: GtrTask,
  startDate: Date,
  endDate: Date
) => void;

// Helper function to calculate progress (can be reused or adapted)
const calculateProgress = (task: Task): number => {
  if (task.status === 'completed') { // ★★★ Fix: taskStatus -> status, 'done' -> 'completed' ★★★
    return 100;
  }
  if (task.progress) { // ★★★ Fix: taskProgress -> progress ★★★
    return task.progress; // ★★★ Fix: taskProgress -> progress ★★★
  }
  if (task.status === 'in-progress') return 50; // 仮 ★★★ Fix: taskStatus -> status ★★★
  return 0;
};



// task_status_redesign_plan.md §6.2 の系統色を利用して gantt-task-react 向けに
// (background / backgroundSelected / progress / progressSelected) の 4 段階へ展開する。
// 濃淡は同じ色から HSL の lightness をずらして作る簡易実装。
const _hexToHsl = (hex: string): [number, number, number] => {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return [0, 0, 50];
  const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
};
const _hslCss = (h: number, s: number, l: number) => `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.max(0, Math.min(100, Math.round(l)))}%)`;

// ステータスに基づいてタスクのスタイルを決定する関数、ガントチャートの色を決定するための関数です。
const getTaskStyle = (task: Task) => {
  const status = migrateLegacyStatus(task.status || '') ?? (task.status || '');
  const base = getTaskStatusColor(status);
  const [h, s, l] = _hexToHsl(base);
  return {
    backgroundColor: _hslCss(h, s, Math.min(85, l + 15)),          // 明るめ
    backgroundSelectedColor: base,                                  // ベース色
    progressColor: _hslCss(h, s, Math.max(15, l - 15)),            // 暗め
    progressSelectedColor: _hslCss(h, s, Math.max(10, l - 25)),    // より暗め
  };
};

// 列幅の状態を共有するためのコンテキスト、コンテキストとは、どこからでもアクセスできるようにするためのオブジェクトです。関数の外で宣言して、他の関数でも使用できるようにするために使用します。
const ColumnWidthContext = createContext<{
  colWidths: { project: number, name: number, from: number, to: number };
  setColWidths: React.Dispatch<React.SetStateAction<{ project: number, name: number, from: number, to: number }>>;
  listCellWidth: string;
  setListCellWidth: React.Dispatch<React.SetStateAction<string>>;
}>({
  colWidths: { project: 40, name: 35, from: 20, to: 20 },//colWidthsとは、列幅の状態を管理するオブジェクトです。
  setColWidths: () => { },//setColWidthsとは、列幅の状態を設定するための関数です。
  listCellWidth: "500px",
  setListCellWidth: () => { }
});




// ★★★ カスタムタスクリストヘッダー with リサイズハンドル ★★★
const CustomTaskListHeader: React.FC<any> = ({ headerHeight, rowWidth }) => {
  const { colWidths, setColWidths, listCellWidth, setListCellWidth } = useContext(ColumnWidthContext);

  const startResize = (
    e: React.MouseEvent,
    column: 'project' | 'name' | 'from' | 'to' | 'gantt'
  ) => {
    e.preventDefault();
    const startX = e.pageX;

    if (column === 'gantt') {
      // ガントチャート部分とリスト部分のバランス調整
      const startListWidth = parseInt(listCellWidth);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.pageX - startX;
        const newWidth = Math.max(200, Math.min(600, startListWidth + deltaX)); // 最大幅調整
        setListCellWidth(`${newWidth}px`);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return;
    }

    // リスト内の列幅調整
    const startWidths = { ...colWidths }; // 現在の幅をコピー
    const totalWidth = 100; // 合計%

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const currentX = moveEvent.pageX;
      const deltaXPercentage = ((currentX - startX) / (document.body.clientWidth * (parseInt(listCellWidth) / 100))) * totalWidth; // デルタを%に変換

      let newWidths = { ...startWidths };
      let changed = false;

      switch (column) {
        case 'project':
          newWidths.project = Math.max(10, Math.min(70, startWidths.project + deltaXPercentage));
          newWidths.name = Math.max(10, startWidths.name - deltaXPercentage);
          break;
        case 'name':
          newWidths.name = Math.max(10, Math.min(70, startWidths.name + deltaXPercentage));
          newWidths.from = Math.max(10, startWidths.from - deltaXPercentage);
          break;
        case 'from':
          newWidths.from = Math.max(10, Math.min(70, startWidths.from + deltaXPercentage));
          newWidths.to = Math.max(10, startWidths.to - deltaXPercentage);
          break;
      }

      // 合計が100%になるように正規化 (project+name+from+to)
      let currentTotal = newWidths.project + newWidths.name + newWidths.from + newWidths.to;
      if (currentTotal > totalWidth) {
        // はみ出した分を調整（ここでは単純に最後の要素から引く）
        newWidths.to -= (currentTotal - totalWidth);
        newWidths.to = Math.max(10, newWidths.to); // 最小幅保証
        // 再度合計を計算し、必要なら前の要素も調整
        currentTotal = newWidths.project + newWidths.name + newWidths.from + newWidths.to;
        if (currentTotal > totalWidth) newWidths.from -= (currentTotal - totalWidth);
        // ... 必要に応じて name, project も調整
      } else if (currentTotal < totalWidth) {
        // 足りない分を調整（ここでは最後の要素に追加）
        newWidths.to += (totalWidth - currentTotal);
      }

      // 最小幅を再度保証
      newWidths.project = Math.max(10, newWidths.project);
      newWidths.name = Math.max(10, newWidths.name);
      newWidths.from = Math.max(10, newWidths.from);
      newWidths.to = Math.max(10, newWidths.to);


      setColWidths(newWidths);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      className="widget-task-list-header"
      style={{
        height: headerHeight,
        display: 'flex',
        alignItems: 'center',
        fontSize: '0.7rem',
        width: listCellWidth,
        borderBottom: '1px solid #e0e0e0', // 区切り線
        boxSizing: 'border-box',
        overflow: 'hidden', // はみ出し防止
      }}
    >
      {/* プロジェクト */}
      <div style={{ width: `${colWidths.project}%`, textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', boxSizing: 'border-box', padding: '0 2px' }}>Project</div>

      {/* リサイズハンドル（タッチで押しやすい幅 8px） */}
      <div
        style={{ width: '8px', minWidth: 8, height: '100%', cursor: 'col-resize', backgroundColor: '#eee', flexShrink: 0 }}
        onMouseDown={(e) => startResize(e, 'project')}
        role="separator"
        aria-label="プロジェクト列の幅を調整"
      />

      {/* タスク名 */}
      <div style={{ width: `${colWidths.name}%`, textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', boxSizing: 'border-box', padding: '0 2px' }}>Name</div>

      {/* リサイズハンドル */}
      <div
        style={{ width: '8px', minWidth: 8, height: '100%', cursor: 'col-resize', backgroundColor: '#eee', flexShrink: 0 }}
        onMouseDown={(e) => startResize(e, 'name')}
        role="separator"
        aria-label="タスク名列の幅を調整"
      />

      {/* 開始日 */}
      <div style={{ width: `${colWidths.from}%`, textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', boxSizing: 'border-box', padding: '0 2px' }}>
        From
        <Tooltip title="タスクの開始予定日" arrow>
          <IconButton size="small" sx={{ ml: 0.2, p: 0 }}><HelpOutlineIcon sx={{ fontSize: '0.8rem' }} /></IconButton>
        </Tooltip>
      </div>

      {/* リサイズハンドル */}
      <div
        style={{ width: '8px', minWidth: 8, height: '100%', cursor: 'col-resize', backgroundColor: '#eee', flexShrink: 0 }}
        onMouseDown={(e) => startResize(e, 'from')}
        role="separator"
        aria-label="開始日列の幅を調整"
      />

      {/* 終了日 */}
      <div style={{ width: `${colWidths.to}%`, textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', boxSizing: 'border-box', padding: '0 2px' }}>
        To
        <Tooltip title="タスクの完了予定日（期限）" arrow>
          <IconButton size="small" sx={{ ml: 0.2, p: 0 }}><HelpOutlineIcon sx={{ fontSize: '0.8rem' }} /></IconButton>
        </Tooltip>
      </div>

      {/* ガントチャート部分との境界リサイズハンドル */}
      <div
        style={{ width: '8px', minWidth: 8, height: '100%', cursor: 'col-resize', backgroundColor: '#ccc', flexShrink: 0, marginLeft: 'auto' }}
        onMouseDown={(e) => startResize(e, 'gantt')}
        role="separator"
        aria-label="リスト幅を調整"
      />
    </div>
  );
};

// Helper function to extract core task name (Robust version)
const getCoreTaskName = (fullName: string | undefined): string => {
  if (!fullName) return ''; // Handle undefined case
  const separator = ' - ';
  // Split, trim parts, filter empty ones, take the last part
  const parts = fullName.split(separator).map(p => p.trim()).filter(p => p !== '');
  if (parts.length > 1) {
    // Try returning the last part first, as it's likely the core name
    return parts[parts.length - 1];
    // If the above isn't desired, use the previous logic:
    // return parts.slice(1).join(separator);
  }
  // If splitting didn't work as expected, return the original (trimmed)
  return fullName.trim();
};

// Helper function to trim suffixes (★ 追加)
const trimProjectSuffix = (projectName: string | undefined): string => {
  if (!projectName) return '';
  const suffixes = [' Online', ' Offline', ' Archived']; // 削除したい接尾辞リスト
  for (const suffix of suffixes) {
    if (projectName.endsWith(suffix)) {
      return projectName.substring(0, projectName.length - suffix.length);
    }
  }
  return projectName; // 接尾辞がなければそのまま返す
};


// ★★★ 依存関係を考慮したスマートソート関数 ★★★
// Start Dateを優先しつつ、依存関係がある場合は「親→子」の順で並べ、かつ親子を近くに配置する
const smartSortTasks = (tasks: CustomGtrTask[]): CustomGtrTask[] => {
  // 1. ID -> Task マップとIDセット
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const taskIds = new Set(tasks.map(t => t.id));

  // 2. 隣接リスト (親 -> 子) と 入次数 (In-Degree) マップの構築
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // 初期化
  tasks.forEach(t => {
    adj.set(t.id, []);
    inDegree.set(t.id, 0);
  });

  // データ構築
  tasks.forEach(t => {
    if (t.dependencies) {
      t.dependencies.forEach(depId => {
        if (taskIds.has(depId)) {
          // depId -> t.id (Edge from Dependency to Task)
          adj.get(depId)?.push(t.id);
          inDegree.set(t.id, (inDegree.get(t.id) || 0) + 1);
        }
      });
    }
  });

  // 3. 入次数0のタスクをキューに入れる (処理可能タスク)
  let readyQueue: CustomGtrTask[] = tasks.filter(t => (inDegree.get(t.id) || 0) === 0);

  const result: CustomGtrTask[] = [];
  let lastProcessedId: string | null = null;

  while (readyQueue.length > 0) {
    // 戦略:
    // 1. readyQueue の中で「最も早い開始日」を見つける
    // 2. その日付(Same Day)のタスク郡を候補とする
    // 3. 候補の中で、直前に処理したタスク(lastProcessedId)の子があればそれを優先する (チェーンをつなぐ)
    // 4. なければ候補の中で最も早いもの(or ID順)を選ぶ

    // 最も早い時間を探す
    let minTime = Infinity;
    readyQueue.forEach(t => {
      const tTime = t.start.getTime();
      if (tTime < minTime) minTime = tTime;
    });

    // 日付 (0:00:00) でグルーピングするための基準
    // minTime がある日のタスクをすべて候補にする
    // ※ 厳密には「minTimeの日」と「それ以前の未処理タスク」も候補に含めるべきだが、
    //   readyQueueは常に更新されるので、minTimeは常に現存する中で最古。
    const minDateStartOfDay = new Date(minTime).setHours(0, 0, 0, 0);

    // 候補のフィルタリング (同じ日のもの)
    const candidates = readyQueue.filter(t => {
      return new Date(t.start).setHours(0, 0, 0, 0) === minDateStartOfDay;
    });

    // もしタイムゾーン等の関係で空なら、厳密一致でフォールバック
    if (candidates.length === 0) {
      candidates.push(...readyQueue.filter(t => t.start.getTime() === minTime));
    }

    let bestTask: CustomGtrTask | undefined;

    // ヒューリスティック: 直前のタスクの子が候補にいればそれを優先
    if (lastProcessedId) {
      bestTask = candidates.find(t =>
        lastProcessedId &&
        t.dependencies &&
        t.dependencies.includes(lastProcessedId)
      );
    }

    // いなければ、標準的な優先順位 (時間 -> ID)
    if (!bestTask) {
      bestTask = candidates.reduce((prev, curr) => {
        if (prev.start.getTime() < curr.start.getTime()) return prev;
        if (curr.start.getTime() < prev.start.getTime()) return curr;
        // 時間が同じならID/名前で安定ソート
        return prev.name.localeCompare(curr.name) < 0 ? prev : curr;
      });
    }

    // 確定したタスクをresultに追加
    result.push(bestTask);
    lastProcessedId = bestTask.id;

    // Queueから削除
    readyQueue = readyQueue.filter(t => t.id !== bestTask!.id);

    // 依存関係の更新 (子タスクの入次数を減らす)
    const children = adj.get(bestTask.id);
    if (children) {
      children.forEach(childId => {
        const currentDeg = inDegree.get(childId) || 0;
        inDegree.set(childId, currentDeg - 1);

        // 入次数が0になったらReadyQueueへ
        if (currentDeg - 1 === 0) {
          const childTask = taskMap.get(childId);
          if (childTask) readyQueue.push(childTask);
        }
      });
    }
  }

  // 循環参照などで残ったタスクがあれば末尾に追加
  if (result.length !== tasks.length) {
    console.warn("SmartSort: Cycle detected or unreachable tasks. Appending dependencies.");
    const processedIds = new Set(result.map(t => t.id));
    const remaining = tasks.filter(t => !processedIds.has(t.id));
    // 残りは開始日順で並べる
    remaining.sort((a, b) => a.start.getTime() - b.start.getTime());
    result.push(...remaining);
  }

  return result;
};

// ★★★ 依存関係を再帰的に取得するヘルパー関数 ★★★
const getAllRelatedTaskIds = (rootId: string, tasks: CustomGtrTask[]): Set<string> => {
  const related = new Set<string>();
  const queue = [rootId];
  related.add(rootId);

  const taskMap = new Map(tasks.map(t => [t.id, t]));

  // 逆引き用マップ (Dependants)
  const dependantsMap = new Map<string, string[]>();
  tasks.forEach(t => {
    t.dependencies?.forEach(depId => {
      if (!dependantsMap.has(depId)) dependantsMap.set(depId, []);
      dependantsMap.get(depId)?.push(t.id);
    });
  });

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const task = taskMap.get(currentId); // taskMapから取得

    // 1. 上流 (Dependencies)
    if (task && task.dependencies) {
      task.dependencies.forEach(depId => {
        if (!related.has(depId)) {
          related.add(depId);
          queue.push(depId);
        }
      });
    }

    // 2. 下流 (Dependants)
    const children = dependantsMap.get(currentId);
    if (children) {
      children.forEach(childId => {
        if (!related.has(childId)) {
          related.add(childId);
          queue.push(childId);
        }
      });
    }
  }

  return related;
};

/** 選択タスクと直接だけつながっているID（親・子のみ。その先の関連は含めない） */
const getDirectlyRelatedTaskIds = (selectedId: string, tasks: CustomGtrTask[]): Set<string> => {
  const direct = new Set<string>([selectedId]);
  const selected = tasks.find(t => t.id === selectedId);
  if (!selected) return direct;
  selected.dependencies?.forEach(depId => direct.add(depId));
  tasks.forEach(t => {
    if (t.dependencies?.includes(selectedId)) direct.add(t.id);
  });
  return direct;
};

// ★★★ 依存関係ハイライト用オーバーレイコンポーネント ★★★
const DependencyHighlighter: React.FC<{
  tasks: CustomGtrTask[];
  selectedTaskId: string | null;
  columnWidth: number;
  rowHeight: number;
  currentStartDate: Date;
  viewMode: ViewMode;
  listCellWidth: string;
}> = ({ tasks, selectedTaskId, columnWidth, rowHeight, currentStartDate, viewMode, listCellWidth }) => {
  const [lines, setLines] = useState<React.ReactNode[]>([]);
  const [scrollX, setScrollX] = useState(0);

  // 横スクロールの追従
  useEffect(() => {
    const findContainer = () => {
      // gantt-task-reactの構造上、横スクロールは内部divで管理されている可能性が高い
      // ヘッダーとボディが同期する場合、ボディ側のスクロールを取得する
      // クラス名に頼らず、横スクロールを持つ要素を探す
      const allDivs = document.querySelectorAll('.gantt-container div');
      for (let i = 0; i < allDivs.length; i++) {
        const div = allDivs[i] as HTMLElement;
        if (div.scrollWidth > div.clientWidth && div.style.overflowX !== 'hidden') {
          return div;
        }
      }
      return null;
    };

    const scrollContainer = findContainer();

    if (scrollContainer) {
      const handleScroll = () => {
        setScrollX(scrollContainer.scrollLeft);
      };
      // 初期値設定
      setScrollX(scrollContainer.scrollLeft);
      scrollContainer.addEventListener('scroll', handleScroll);
      return () => scrollContainer.removeEventListener('scroll', handleScroll);
    } else {
      console.warn("DependencyHighlighter: Could not find scroll container.");
    }
  }, []);

  useEffect(() => {
    if (!selectedTaskId) {
      setLines([]);
      return;
    }

    const selectedTask = tasks.find(t => t.id === selectedTaskId);
    if (!selectedTask) return;

    const newLines: React.ReactNode[] = [];
    const listWidth = parseInt(listCellWidth);

    // 座標計算ヘルパー
    const getTaskCoordinates = (task: CustomGtrTask) => {
      // Y座標: DOMから取得 (リストの行を探す)
      const listRow = document.querySelector(`.widget-task-list-item[data-task-id="${task.id}"]`);
      if (!listRow) return null;

      const listRect = listRow.getBoundingClientRect();
      const container = document.querySelector('.gantt-container');
      if (!container) return null;
      const containerRect = container.getBoundingClientRect();

      // コンテナ相対Y座標
      const y = listRect.top - containerRect.top + (listRect.height / 2);

      // X座標: 日付から計算
      const diffStart = differenceInCalendarDays(task.start, currentStartDate);
      const diffEnd = differenceInCalendarDays(task.end, currentStartDate);

      const xOffset = diffStart * columnWidth;
      const width = (diffEnd - diffStart) * columnWidth;

      const adjustedX = listWidth + xOffset - scrollX;
      const adjustedXEnd = listWidth + xOffset + width - scrollX;

      return { x: adjustedX, y, width: width, xEnd: adjustedXEnd };
    };

    // 描画済みエッジの追跡（重複防止）
    const processedEdges = new Set<string>();

    // 選択されたタスクに接続されている矢印だけ描画（選択タスクから出る／選択タスクに入る）
    tasks.forEach(task => {
      task.dependencies?.forEach(depId => {
        // 矢印を描くのは「選択タスク → 子」または「親 → 選択タスク」のみ
        const isOutgoingFromSelected = depId === selectedTaskId; // 選択タスクから出る矢印
        const isIncomingToSelected = task.id === selectedTaskId; // 選択タスクに入る矢印
        if (!isOutgoingFromSelected && !isIncomingToSelected) return;

        const edgeKey = `${depId}-${task.id}`;
        if (processedEdges.has(edgeKey)) return;
        processedEdges.add(edgeKey);

        const sourceTask = tasks.find(t => t.id === depId);
        const targetTask = task;

        if (sourceTask && targetTask) {
          const start = getTaskCoordinates(sourceTask);
          const end = getTaskCoordinates(targetTask);

          if (start && end) {
            const p1 = { x: start.xEnd, y: start.y };
            const p2 = { x: end.x, y: end.y };

            const path = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;

            newLines.push(
              <g key={edgeKey}>
                <path d={path} stroke="white" strokeWidth="4" fill="none" opacity="0.8" />
                <path
                  d={path}
                  stroke="#e91e63"
                  strokeWidth="2.5"
                  fill="none"
                  markerEnd="url(#arrowhead)"
                />
                <circle cx={p1.x} cy={p1.y} r="3" fill="#e91e63" />
              </g>
            );
          }
        }
      });
    });

    setLines(newLines);
  }, [selectedTaskId, tasks, columnWidth, rowHeight, currentStartDate, viewMode, listCellWidth, scrollX]);

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 99999, // ★★★ 最前面に表示 (以前は 100) ★★★
        overflow: 'visible'
      }}
    >
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#e91e63" />
        </marker>
      </defs>
      {lines}
    </svg>
  );
};

// ★★★ 依存関係チェーンごとのスタッガリング関数 ★★★
const applyDependencyStaggering = (tasks: CustomGtrTask[]): CustomGtrTask[] => {
  // 1. 全タスクのIDマップと無向グラフ（双方向関係）の構築
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const adj = new Map<string, string[]>(); // ID -> Neighbor IDs

  // 初期化
  tasks.forEach(t => adj.set(t.id, []));

  // エッジの追加
  tasks.forEach(t => {
    if (t.dependencies) {
      t.dependencies.forEach(depId => {
        if (taskMap.has(depId)) {
          // A depends on B -> Connect A and B
          adj.get(t.id)?.push(depId);
          adj.get(depId)?.push(t.id);
        }
      });
    }
  });

  // 2. 連結成分（Chain）の検出とグループ化
  const visited = new Set<string>();
  const groups: string[][] = [];

  tasks.forEach(t => {
    if (t.id && !visited.has(t.id)) {
      const group: string[] = [];
      const queue: string[] = [t.id];
      visited.add(t.id);

      while (queue.length > 0) {
        const currId = queue.shift()!;
        group.push(currId);

        const neighbors = adj.get(currId) || [];
        neighbors.forEach(neighborId => {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            queue.push(neighborId);
          }
        });
      }
      groups.push(group);
    }
  });

  // 3. グループごとにオフセットを割り当てて時間をずらす
  // 同時に並走するチェーンが重ならないように、グループIDに基づいてオフセットを決定
  const STAGGER_MINUTES = 20; // 20分ずつずらす
  const MAX_OFFSETS = 5; // 最大5段階（0~80分）

  // タスクID -> オフセット値 のマップを作成
  const offsetMap = new Map<string, number>();

  groups.forEach((group, index) => {
    // 孤立したタスク（グループサイズ1で依存関係なし）はオフセット0にする
    const leaderTask = taskMap.get(group[0]);
    const isIsolated = group.length === 1 && (!leaderTask?.dependencies || leaderTask.dependencies.length === 0);

    // グループインデックスに基づいてオフセットを計算 (孤立してなければ)
    const offsetLevel = isIsolated ? 0 : (index % MAX_OFFSETS);
    const offsetTime = offsetLevel * STAGGER_MINUTES * 60 * 1000; // ミリ秒

    group.forEach(taskId => {
      offsetMap.set(taskId, offsetTime);
    });
  });

  // 4. 新しいタスクリストを生成（ソート順は維持）
  return tasks.map(t => {
    const offset = offsetMap.get(t.id) || 0;
    if (offset === 0) return t;

    return {
      ...t,
      // 開始日と終了日をオフセット分ずらす
      start: new Date(t.start.getTime() + offset),
      end: new Date(t.end.getTime() + offset)
    };
  });
};

// ★★★ カスタムタスクリスト (プロジェクト名を表示) ★★★、ガントチャートのタスクリストを表示するためのコンポーネントです。
const CustomTaskList: React.FC<any> = ({
  tasks,
  rowHeight,
  // rowWidth, // rowWidth は listCellWidth から計算されるため、直接は使わないことが多い
  selectedTaskId, //selectedTaskIdとは、選択されたタスクのIDです。
  setSelectedTask, //setSelectedTaskとは、選択されたタスクを設定するための関数です。
  // onExpanderClick, // 現在未使用
  projectsData
}) => {
  const { colWidths, listCellWidth } = useContext(ColumnWidthContext);

  return (
    <div
      className="widget-task-list"
      style={{
        width: listCellWidth, // ヘッダーと合わせる
        overflow: 'hidden',
        flexShrink: 0,
        boxSizing: 'border-box',
      }}
    >
      {tasks.map((task: CustomGtrTask) => {
        const displayName = getCoreTaskName(task.name);
        const displayProjectName = trimProjectSuffix(projectsData.find((p: Project) => String(p.id) === task.projectId)?.name);

        return (
          <div
            key={task.id}
            data-task-id={task.id} // ★★★ 座標計算用にIDを追加 ★★★
            className={`widget-task-list-item ${selectedTaskId === task.id ? 'selected' : ''}`}
            style={{
              height: rowHeight,
              display: 'flex',
              alignItems: 'center',
              backgroundColor: selectedTaskId === task.id ? 'rgba(33, 150, 243, 0.15)' : undefined,
              fontSize: '0.7rem',
              borderBottom: '1px solid #eee',
              cursor: 'pointer',
              boxSizing: 'border-box', // 各行も border-box
            }}
            onClick={() => setSelectedTask(task)}
          >
            {/* プロジェクト名 */}
            <div style={{
              width: `${colWidths.project}%`,
              padding: '0 2px', // ヘッダーに合わせる
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              boxSizing: 'border-box' // 必須
            }}>
              {displayProjectName}
            </div>

            {/* スペーサー (リサイズハンドルに対応する箇所) */}
            {/* <div style={{ width: '5px', flexShrink: 0, backgroundColor: 'transparent' }} /> */} {/* ← 一旦コメントアウトまたは幅0 */}

            {/* タスク名 (Tooltipなしのバージョン) */}
            <div style={{
              width: `${colWidths.name}%`,
              padding: '0 2px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              boxSizing: 'border-box',
              textAlign: 'center' // ★ 中央揃えを追加
            }}>
              {displayName}
            </div>

            {/* スペーサー */}
            {/* <div style={{ width: '5px', flexShrink: 0, backgroundColor: 'transparent' }} /> */} {/* ← 一旦コメントアウトまたは幅0 */}

            {/* 開始日 */}
            <div style={{
              width: `${colWidths.from}%`,
              padding: '0 2px', // ヘッダーに合わせる
              textAlign: 'center', // ヘッダーに合わせる
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              boxSizing: 'border-box' // 必須
            }}>
              {task.start ? formatDate(task.start, 'MM/dd') : ''}
            </div>

            {/* スペーサー */}
            {/* <div style={{ width: '5px', flexShrink: 0, backgroundColor: 'transparent' }} /> */} {/* ← 一旦コメントアウトまたは幅0 */}

            {/* 終了日 */}
            <div style={{
              width: `${colWidths.to}%`,
              padding: '0 2px', // ヘッダーに合わせる
              textAlign: 'center', // ヘッダーに合わせる
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              boxSizing: 'border-box' // 必須
            }}>
              {task.end ? formatDate(task.end, 'MM/dd') : ''}
            </div>

            {/* 右端のスペーサー (ガントチャート部分との境界ハンドルに対応) */}
            {/* <div style={{ width: '5px', marginLeft: 'auto', flexShrink: 0, backgroundColor: 'transparent' }} /> */} {/* ← 一旦コメントアウトまたは幅0 */}
          </div>
        );
      })}
    </div>
  );
};

interface GanttViewProps {
  tasks: Task[];
  projects: Project[];
  users: User[]; // users は現時点では直接使用しない
  initialViewMode?: ViewMode;
  onTaskSelect?: (task: GtrTask) => void;
  handleOpenCreateTask?: () => void;
  readOnly?: boolean;
}

// MemoizedGanttをuseMemoで生成するように変更
const MemoizedGantt = React.memo(ReactGantt, (prevProps, nextProps) => {
  // タスクデータの検証
  if (!prevProps.tasks || !nextProps.tasks) {
    return prevProps.tasks === nextProps.tasks;
  }

  // 空の配列の場合は同じとみなす
  if (prevProps.tasks.length === 0 && nextProps.tasks.length === 0) {
    return prevProps.viewMode === nextProps.viewMode && prevProps.columnWidth === nextProps.columnWidth;
  }

  // タスクデータの構造を検証
  const prevTasksValid = prevProps.tasks.every(t => t && t.id && t.start && t.end);
  const nextTasksValid = nextProps.tasks.every(t => t && t.id && t.start && t.end);

  if (!prevTasksValid || !nextTasksValid) {
    return false; // 無効なデータの場合は再レンダリング
  }

  if (
    prevProps.tasks === nextProps.tasks &&
    prevProps.viewMode === nextProps.viewMode &&
    prevProps.columnWidth === nextProps.columnWidth
  ) return true;

  if (prevProps.tasks.length !== nextProps.tasks.length) {
    return false;
  }

  const sampleSize = Math.min(5, prevProps.tasks.length);
  for (let i = 0; i < sampleSize; i++) {
    if (prevProps.tasks[i].id !== nextProps.tasks[i].id) {
      return false;
    }
  }
  return false;
});

const GanttWrapper = styled.div`
  overflow: hidden; /* 横スクロールの二重化を防ぐ */
  width: 100%;
  height: 100%;
  // ... existing styles ...

  /* ★★★ Adjust timeline header text font size ★★★ */
  .gantt-container .calendar svg text {
      font-size: 0.65rem !important; /* Adjust font size */
      /* fill: #555; */ /* Optional: adjust color */
  }
  /* --------------------------------------------- */
  
  /* 親要素の横スクロールバーを非表示 */
  &::-webkit-scrollbar {
    display: none;
  }
  -ms-overflow-style: none;
  scrollbar-width: none;

  /* タスク一覧エリアの縦スクロールバーを非表示（スクロールは可能） */
  .gantt-container {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .gantt-container::-webkit-scrollbar {
    width: 0;
    display: none;
  }

  /* ★★★ タスクリスト: 選択時・ホバー時をはっきり表示 ★★★ */
  .widget-task-list-item {
    transition: background-color 0.15s ease, box-shadow 0.15s ease;
  }
  .widget-task-list-item:hover {
    background-color: rgba(33, 150, 243, 0.08) !important;
  }
  .widget-task-list-item.selected {
    background-color: rgba(33, 150, 243, 0.15) !important;
    box-shadow: inset 3px 0 0 #2196f3;
  }
  .widget-task-list-item.selected:hover {
    background-color: rgba(33, 150, 243, 0.2) !important;
  }
  /* ダークモード: タスク一覧のホバー・選択を明るい色で表示 */
  &.theme-dark .widget-task-list-item:hover {
    background-color: rgba(255, 255, 255, 0.1) !important;
  }
  &.theme-dark .widget-task-list-item.selected {
    background-color: rgba(255, 255, 255, 0.16) !important;
    box-shadow: inset 3px 0 0 #90caf9;
  }
  &.theme-dark .widget-task-list-item.selected:hover {
    background-color: rgba(255, 255, 255, 0.22) !important;
  }

  /* ガントバー選択時をはっきり表示（ライブラリのバー用） */
  .gantt-container .bar.selected,
  .gantt-container .bar[data-selected="true"] {
    filter: brightness(1.05);
    stroke: #1976d2;
    stroke-width: 2;
  }

  // ... existing styles ...
`;

// ★ TooltipWrapper の定義を CustomTaskList の前に移動
const TooltipWrapper = forwardRef<HTMLSpanElement, { children: React.ReactNode }>((props, ref) => {
  return <span ref={ref} {...props} style={{ display: 'inline-block', width: '100%' }} />;
});

// タスクバー用ツールチップ：Progress の代わりに担当者を表示
const CustomTooltipContent: React.FC<{
  task: CustomGtrTask & { start: Date; end: Date };
  fontSize?: string;
  fontFamily?: string;
}> = ({ task, fontSize = '12px', fontFamily = '"Roboto", "Helvetica", "Arial", sans-serif' }) => {
  const assigneeLabel = (task.assignee && task.assignee !== 'Unassigned') ? task.assignee : '担当者なし';
  const style = { fontSize, fontFamily };
  return (
    <div
      style={{
        ...style,
        padding: 12,
        background: 'rgba(33, 33, 33, 0.96)',
        color: '#fff',
        boxShadow: '0 3px 6px rgba(0,0,0,0.4), 0 3px 6px rgba(0,0,0,0.6)',
      }}
    >
      <b style={{ fontSize: '14px' }}>
        {task.name}: {formatDate(task.start, 'yyyy/MM/dd')} - {formatDate(task.end, 'yyyy/MM/dd')}
      </b>
      <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#666' }}>
        担当者: {assigneeLabel}
      </p>
    </div>
  );
};

const GanttView: React.FC<GanttViewProps> = memo(
  ({ tasks: initialTasks, initialViewMode = ViewMode.Week, onTaskSelect, handleOpenCreateTask, readOnly = false, projects, users }) => {

    // ================= HOOKS =================
    const theme = useTheme();
    const isDarkMode = theme.palette.mode === 'dark';
    const [colWidths, setColWidths] = useState({
      project: 25,
      name: 35,
      from: 20,
      to: 20
    });
    const [listCellWidth, setListCellWidth] = useState("250px");
    // タスク選択用のState
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [forceUpdateState, forceUpdate] = useState<object>({});
    const ganttContainerRef = useRef<HTMLDivElement | null>(null);
    const scrollPositionRef = useRef<{ left: number, top: number } | null>(null);
    const [isMountedState, setIsMountedState] = useState(false);
    const horizontalContainerRef = useRef<HTMLElement | null>(null);
    const verticalContainerRef = useRef<HTMLElement | null>(null);
    /** gantt-task-react はハッシュ化クラスを使用。横スクロール=_CZjuD, 縦スクロール=_2B2zv（左リスト・右チャートの2つある） */
    const getScrollContainers = useCallback(() => {
      const root = document.getElementById('gantt-container');
      const h = horizontalContainerRef.current
        || (document.querySelector('.gantt-horizontal-container') as HTMLElement)
        || (root?.querySelector('._CZjuD') as HTMLElement);
      const v = verticalContainerRef.current
        || (document.querySelector('.gantt-vertical-scroll-container') as HTMLElement)
        || (root?.querySelector('._2B2zv') as HTMLElement);
      return { hContainer: h, vContainer: v };
    }, []);
    /** 縦スクロールする2つのパネル（タスクリストとチャート）をまとめて取得。行ずれ防止で両方に同じ scrollTop を適用する */
    const getAllVerticalContainers = useCallback((): HTMLElement[] => {
      const root = document.getElementById('gantt-container');
      if (!root) return [];
      const list = root.querySelectorAll('._2B2zv');
      return Array.from(list) as HTMLElement[];
    }, []);
    const renderCountRef = useRef(0);
    const [isLoadingData, setIsLoadingData] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const navigate = useNavigate();
    const location = useLocation();
    const [authErrorOpen, setAuthErrorOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editedTask, setEditedTask] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode || ViewMode.Week);
    const [currentStartDate, setCurrentStartDate] = useState<Date>(new Date());
    const [currentColumnWidth, setCurrentColumnWidth] = useState<number>(60);
    const debounceTimeoutRef = useRef<number | null>(null);

    const [isGanttReady, setIsGanttReady] = useState(false);

    // Snackbar用のstate
    const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' | 'warning' }>({
      open: false,
      message: '',
      severity: 'info',
    });

    const showSuccess = useCallback((message: string) => {
      setSnackbar({ open: true, message, severity: 'success' });
    }, []);

    const showError = useCallback((message: string) => {
      setSnackbar({ open: true, message, severity: 'error' });
    }, []);

    const showInfo = useCallback((message: string) => {
      setSnackbar({ open: true, message, severity: 'info' });
    }, []);

    const handleCloseSnackbar = useCallback(() => {
      setSnackbar(prev => ({ ...prev, open: false }));
    }, []);

    const [helpAnchorEl, setHelpAnchorEl] = useState<HTMLElement | null>(null);

    // tasksRef の代わりに localTasks state を使用
    const [localTasks, setLocalTasks] = useState<Task[]>(initialTasks);
    // ★★★ tasksRef は削除 ★★★
    // const tasksRef = useRef<Task[]>(initialTasks);

    // ★★★ viewMode変更時に列幅をリセットするuseEffect ★★★
    useEffect(() => {
      const defaultWidth = viewMode === ViewMode.Day ? 30 : 60;
      console.log(`ビューモード変更: 列幅をデフォルト (${defaultWidth}) にリセット`);
      setCurrentColumnWidth(defaultWidth);
    }, [viewMode]);
    // ★★★ ここまで ★★★

    // useCallback フック
    // useCallback フック
    const saveScrollPosition = useCallback(() => {
      const { hContainer, vContainer } = getScrollContainers();
      if (hContainer || vContainer) {
        // 縦は1つ目で代表（両パネルは同期している想定）
        scrollPositionRef.current = {
          left: hContainer?.scrollLeft || 0,
          top: vContainer?.scrollTop || 0
        };
        console.log(`[GanttView] Saved scroll position: L=${scrollPositionRef.current.left}, T=${scrollPositionRef.current.top}`);
      }
    }, [getScrollContainers]);

    const restoreScrollPosition = useCallback(() => {
      const { hContainer } = getScrollContainers();
      const allVertical = getAllVerticalContainers();
      if (scrollPositionRef.current) {
        const savedLeft = scrollPositionRef.current.left;
        const savedTop = scrollPositionRef.current.top;

        (window as any).__ganttIsRestoringScroll = true;

        const restore = () => {
          if (hContainer && savedLeft !== undefined) {
            if (Math.abs(hContainer.scrollLeft - savedLeft) > 1) {
              hContainer.scrollLeft = savedLeft;
            }
          }
          if (savedTop !== undefined && allVertical.length > 0) {
            const targetTop = Math.max(0, Math.min(savedTop, allVertical[0].scrollHeight - allVertical[0].clientHeight));
            allVertical.forEach(el => { el.scrollTop = targetTop; });
          }
        };

        // 即座に復元
        restore();

        // requestAnimationFrameで復元（ブラウザの描画後に確実に復元）
        requestAnimationFrame(() => {
          restore();
          // さらに少し遅延させて復元（ライブラリの再レンダリング後に確実に復元）
          setTimeout(restore, 10);
          setTimeout(() => {
            restore();
            // 復元完了後にフラグを解除
            setTimeout(() => {
              (window as any).__ganttIsRestoringScroll = false;
            }, 50);
          }, 50);
        });
      }
    }, [getScrollContainers, getAllVerticalContainers]);

    // タスク選択変更時にスクロール位置を復元する
    // useLayoutEffect を使用して、ブラウザが描画する前にスクロール位置を戻すことでちらつきを防ぐ
    React.useLayoutEffect(() => {
      // スクロール位置が保存されている場合のみ復元
      if (scrollPositionRef.current) {
        const savedLeft = scrollPositionRef.current.left;
        const savedTop = scrollPositionRef.current.top;

        const { hContainer } = getScrollContainers();
        const allVertical = getAllVerticalContainers();
        if (!hContainer && allVertical.length === 0) {
          return;
        }

        const restore = () => {
          if (hContainer && savedLeft !== undefined) {
            if (Math.abs(hContainer.scrollLeft - savedLeft) > 1) {
              hContainer.scrollLeft = savedLeft;
            }
          }
          if (savedTop !== undefined && allVertical.length > 0) {
            const targetTop = Math.max(0, Math.min(savedTop, allVertical[0].scrollHeight - allVertical[0].clientHeight));
            allVertical.forEach(el => { el.scrollTop = targetTop; });
          }
        };

        // 即座に復元
        restore();

        // 複数回試行して確実に復元
        requestAnimationFrame(() => {
          restore();
          setTimeout(restore, 10);
          setTimeout(restore, 50);
          setTimeout(restore, 100);
          setTimeout(restore, 200);
          setTimeout(restore, 300);
        });

        // MutationObserverでDOMの変更を監視
        const observer = new MutationObserver(() => {
          restore();
        });

        if (hContainer) {
          observer.observe(hContainer, { attributes: true, attributeFilter: ['style'], childList: false, subtree: false });
        }
        allVertical.forEach(v => {
          observer.observe(v, { attributes: true, attributeFilter: ['style'], childList: false, subtree: false });
        });

        // クリーンアップ
        return () => {
          observer.disconnect();
        };
      }
    }, [selectedTaskId, getScrollContainers, getAllVerticalContainers]);

    const handleAuthError = useCallback(() => {
      setAuthErrorOpen(true);
    }, []);

    // ★★★ ズームインハンドラ ★★★
    const handleZoomIn = useCallback(() => {
      setCurrentColumnWidth(prev => Math.min(prev + 10, 200)); // 上限200px
    }, []);

    // ★★★ ズームアウトハンドラ ★★★
    const handleZoomOut = useCallback(() => {
      setCurrentColumnWidth(prev => Math.max(prev - 10, 20)); // 下限20px
    }, []);

    const handleRelogin = useCallback(() => {
      setAuthErrorOpen(false);
      localStorage.removeItem('token');
      navigate('/login', { state: { from: location.pathname } });
    }, [navigate, location.pathname]);

    // ★★★ initialTasks prop の変更を localTasks state に反映 ★★★
    useEffect(() => {
      console.log(`[GanttView] Props changed - Tasks: ${initialTasks.length}, Projects: ${projects.length}`);
      if (initialTasks.length > 0) {
        console.log(`[GanttView] Project IDs in tasks:`, [...new Set(initialTasks.map(t => t.project_id))]);
        console.log(`[GanttView] Available project IDs:`, projects.map(p => p.id));
      }
      setLocalTasks(initialTasks); // ★★★ setLocalTasks を使用 ★★★
    }, [initialTasks, projects]);

    // fetchData の成功時に setLocalTasks を呼ぶ (修正済み)
    const fetchData = useCallback(() => {
      setIsLoadingData(true);
      setFetchError(null);
      console.log("fetchData 実行: 最新データを取得します...");
      Promise.all([
        api.get<Task[]>('/tasks'),
      ])
        .then(([tasksResponse]) => {
          const loadedTasks = tasksResponse.data;
          console.log("DEBUG: APIから取得したタスクデータ:", JSON.stringify(loadedTasks, null, 2));
          // ★ 追加: APIから取得したデータで dependsOn を持つものをログ出力
          console.log("DEBUG: API tasks with dependsOn:", JSON.stringify(loadedTasks.filter(task => task.dependsOn && task.dependsOn.length > 0), null, 2));
          console.log("DEBUG: APIから取得したプロジェクトデータ:", JSON.stringify(projects, null, 2));
          console.log("DEBUG: APIから取得したユーザーデータ:", JSON.stringify(users, null, 2));
          console.log(`最新データ取得成功: Tasks=${loadedTasks.length}`);
          setLocalTasks(loadedTasks); // ★★★ setLocalTasks を使用 ★★★
          if (loadedTasks && loadedTasks.length > 0) { // ★ データがあれば準備完了
            setIsGanttReady(true);
          } else {
            setIsGanttReady(false); // データが空なら準備未完了（またはエラー表示など）
          }
        })
        .catch((error) => {
          console.error('データ読み込みエラー:', error);
          setFetchError('データの読み込みに失敗しました。');
          if (error.response && error.response.status === 401) {
            handleAuthError();
          }
        })
        .finally(() => {
          setIsLoadingData(false);
        });
    }, [handleAuthError, projects, users]); // ★★★ 依存配列修正 ★★★

    const initializeScrollHandlers = useCallback(() => {
      console.log('初期化: スクロールハンドラー');
      const verticalSyncState = { cleanup: null as (() => void) | null };
      const setupScrollContainers = () => {
        const root = document.getElementById('gantt-container');
        const horizontalContainer = document.querySelector('.gantt-horizontal-container') as HTMLElement
          || (root?.querySelector('._CZjuD') as HTMLElement);
        const verticalContainers = root ? (Array.from(root.querySelectorAll('._2B2zv')) as HTMLElement[]) : [];
        const verticalContainer = document.querySelector('.gantt-vertical-scroll-container') as HTMLElement
          || verticalContainers[0];
        if (horizontalContainer) {
          horizontalContainerRef.current = horizontalContainer;
          window.ganttScrollRef.horizontal = horizontalContainer;
          horizontalContainer.style.overflowX = 'auto';
          horizontalContainer.style.touchAction = 'pan-x';
        }
        if (verticalContainer) {
          verticalContainerRef.current = verticalContainer;
          window.ganttScrollRef.vertical = verticalContainer;
          verticalContainers.forEach(el => {
            el.style.overflowY = 'auto';
            el.style.touchAction = 'pan-y';
          });
        }
        verticalSyncState.cleanup?.();
        if (verticalContainers.length >= 2) {
          let isSyncing = false;
          const onVerticalScroll = function (this: HTMLElement) {
            if (isSyncing) return;
            isSyncing = true;
            const top = this.scrollTop;
            const rootEl = document.getElementById('gantt-container');
            const allV = rootEl ? (Array.from(rootEl.querySelectorAll('._2B2zv')) as HTMLElement[]) : [];
            allV.forEach(el => { if (el !== this) el.scrollTop = top; });
            requestAnimationFrame(() => { isSyncing = false; });
          };
          verticalContainers.forEach(el => el.addEventListener('scroll', onVerticalScroll, { passive: true }));
          verticalSyncState.cleanup = () => {
            verticalContainers.forEach(el => el.removeEventListener('scroll', onVerticalScroll));
            verticalSyncState.cleanup = null;
          };
        }
      };
      setupScrollContainers();
      const handleWheel = (e: WheelEvent) => {
        const root = document.getElementById('gantt-container');
        const horizontalContainer = horizontalContainerRef.current || (root?.querySelector('._CZjuD') as HTMLElement);
        const allVertical: HTMLElement[] = root ? Array.from(root.querySelectorAll('._2B2zv')) as HTMLElement[] : ([] as HTMLElement[]);
        if (!horizontalContainer || allVertical.length === 0) {
          setupScrollContainers();
          return;
        }

        const horizontalStep = e.deltaX * 0.8;
        const verticalStep = e.deltaY * 0.8;

        if (e.shiftKey && e.deltaY !== 0) {
          try { e.preventDefault(); } catch (_) { }
          requestAnimationFrame(() => { horizontalContainer.scrollLeft += verticalStep; });
          return;
        }

        try { e.preventDefault(); } catch (_) { }

        requestAnimationFrame(() => {
          if (e.deltaX !== 0) horizontalContainer.scrollLeft += horizontalStep;
          if (e.deltaY !== 0 && allVertical.length > 0) {
            const first = allVertical[0];
            const maxTop = Math.max(0, first.scrollHeight - first.clientHeight);
            const newTop = Math.max(0, Math.min(maxTop, first.scrollTop + verticalStep));
            allVertical.forEach(el => { el.scrollTop = newTop; });
          }
        });
      };
      const handleKeyDown = (e: KeyboardEvent) => {
        if (document.activeElement?.tagName === 'INPUT' ||
          document.activeElement?.tagName === 'TEXTAREA' ||
          (document.activeElement as HTMLElement)?.isContentEditable) {
          return;
        }
        const root = document.getElementById('gantt-container');
        const horizontalContainer = horizontalContainerRef.current || (root?.querySelector('._CZjuD') as HTMLElement);
        const allVertical: HTMLElement[] = root ? Array.from(root.querySelectorAll('._2B2zv')) as HTMLElement[] : ([] as HTMLElement[]);
        if (!horizontalContainer || allVertical.length === 0) return;
        switch (e.key) {
          case 'ArrowLeft': e.preventDefault(); requestAnimationFrame(() => { horizontalContainer.scrollLeft -= 50; }); break;
          case 'ArrowRight': e.preventDefault(); requestAnimationFrame(() => { horizontalContainer.scrollLeft += 50; }); break;
          case 'ArrowUp': e.preventDefault(); requestAnimationFrame(() => {
            const newTop = Math.max(0, allVertical[0].scrollTop - 30);
            allVertical.forEach(el => { el.scrollTop = newTop; });
          }); break;
          case 'ArrowDown': e.preventDefault(); requestAnimationFrame(() => {
            const maxTop = Math.max(0, allVertical[0].scrollHeight - allVertical[0].clientHeight);
            const newTop = Math.min(maxTop, allVertical[0].scrollTop + 30);
            allVertical.forEach(el => { el.scrollTop = newTop; });
          }); break;
        }
      };
      const handleResize = () => { setupScrollContainers(); };
      window.scrollGanttLeft = (amount = 100) => { const c = horizontalContainerRef.current; if (c) requestAnimationFrame(() => { c.scrollLeft -= amount; }); };
      window.scrollGanttRight = (amount = 100) => { const c = horizontalContainerRef.current; if (c) requestAnimationFrame(() => { c.scrollLeft += amount; }); };
      window.scrollGanttUp = (amount = 50) => {
        const root = document.getElementById('gantt-container');
        const allV: HTMLElement[] = root ? Array.from(root.querySelectorAll('._2B2zv')) as HTMLElement[] : ([] as HTMLElement[]);
        if (allV.length) requestAnimationFrame(() => { const t = Math.max(0, allV[0].scrollTop - amount); allV.forEach(el => { el.scrollTop = t; }); });
      };
      window.scrollGanttDown = (amount = 50) => {
        const root = document.getElementById('gantt-container');
        const allV: HTMLElement[] = root ? Array.from(root.querySelectorAll('._2B2zv')) as HTMLElement[] : ([] as HTMLElement[]);
        if (allV.length) requestAnimationFrame(() => {
          const maxT = Math.max(0, allV[0].scrollHeight - allV[0].clientHeight);
          const t = Math.min(maxT, allV[0].scrollTop + amount);
          allV.forEach(el => { el.scrollTop = t; });
        });
      };
      const ganttElement = document.querySelector('.gantt');
      if (ganttElement) {
        // より互換性の高いイベントリスナーの設定
        try {
          ganttElement.addEventListener('wheel', handleWheel as EventListenerOrEventListenerObject, { passive: false, capture: true });
        } catch (err) {
          // 古いブラウザやpassive: falseが使えない場合のフォールバック
          ganttElement.addEventListener('wheel', handleWheel as EventListenerOrEventListenerObject, true);
        }
      }
      document.addEventListener('keydown', handleKeyDown);
      window.addEventListener('resize', handleResize);
      const cleanupData = {
        ganttElement,
        wheelHandler: handleWheel,
        keyHandler: handleKeyDown,
        resizeHandler: handleResize,
        verticalSyncState,
      };
      window.__ganttCleanupData = cleanupData;
    }, []);

    const cleanupScrollHandlers = useCallback(() => {
      console.log('クリーンアップ: スクロールハンドラー');
      const cleanupData = window.__ganttCleanupData;
      if (!cleanupData) return;
      const { ganttElement, wheelHandler, keyHandler, resizeHandler, verticalSyncState } = cleanupData;
      verticalSyncState?.cleanup?.();
      if (ganttElement) ganttElement.removeEventListener('wheel', wheelHandler, { capture: true });
      document.removeEventListener('keydown', keyHandler);
      window.removeEventListener('resize', resizeHandler);
      window.scrollGanttLeft = () => { };
      window.scrollGanttRight = () => { };
      window.scrollGanttUp = () => { };
      window.scrollGanttDown = () => { };
      delete window.__ganttCleanupData;
      horizontalContainerRef.current = null;
      verticalContainerRef.current = null;
    }, []);

    const handlePrevious = useCallback(() => {
      const newDate = new Date(currentStartDate);
      switch (viewMode) {
        case ViewMode.Day: newDate.setDate(newDate.getDate() - 1); break;
        case ViewMode.Week: newDate.setDate(newDate.getDate() - 7); break;
        case ViewMode.Month: newDate.setMonth(newDate.getMonth() - 1); break;
        case ViewMode.Year: newDate.setFullYear(newDate.getFullYear() - 1); break;
        default: newDate.setDate(newDate.getDate() - 7);
      }
      saveScrollPosition();
      setCurrentStartDate(newDate);
      setTimeout(restoreScrollPosition, 50);
      console.log(`前の期間に移動: ${formatDate(newDate, 'yyyy-MM-dd')}`);
    }, [viewMode, currentStartDate, saveScrollPosition, restoreScrollPosition]);

    const handleNext = useCallback(() => {
      const newDate = new Date(currentStartDate);
      switch (viewMode) {
        case ViewMode.Day: newDate.setDate(newDate.getDate() + 1); break;
        case ViewMode.Week: newDate.setDate(newDate.getDate() + 7); break;
        case ViewMode.Month: newDate.setMonth(newDate.getMonth() + 1); break;
        case ViewMode.Year: newDate.setFullYear(newDate.getFullYear() + 1); break;
        default: newDate.setDate(newDate.getDate() + 7);
      }
      saveScrollPosition();
      setCurrentStartDate(newDate);
      setTimeout(restoreScrollPosition, 50);
      console.log(`次の期間に移動: ${formatDate(newDate, 'yyyy-MM-dd')}`);
    }, [viewMode, currentStartDate, saveScrollPosition, restoreScrollPosition]);

    const dummyCallback = useCallback(() => { }, []); // 不変のダミー関数

    // ================= END HOOKS =================

    // レンダリングカウンタを更新（無限ループ検出用）
    useEffect(() => {
      renderCountRef.current += 1;
      const count = renderCountRef.current;

      // 異常な再レンダリングを検出
      if (count > 10 && count % 10 === 0) {
        console.warn(`⚠️ 多数の再レンダリングを検出: ${count}回。無限ループの可能性があります。`);
      }

      // ★★★ tasksRef の参照更新は不要。localTasks への直接代入も削除 ★★★
      // localTasks = initialTasks; // この行を削除
    }, [initialTasks]);

    // 無限ループ修正パッチのステータスを確認
    useEffect(() => {
      if (!window.__GANTT_FIX_APPLIED) {
        console.warn('ガントチャート修正パッチが適用されていません。index.htmlに記述したパッチが動作していない可能性があります。');
      }

      if (!window.__REACT_PATCHED) {
        console.warn('React修正パッチが適用されていません。');

        // ここでバックアップパッチを適用
        if (window.React && window.React.useEffect) {
          const originalUseEffect = window.React.useEffect;
          window.React.useEffect = function (effect: React.EffectCallback, deps?: React.DependencyList) {
            const stack = new Error().stack || '';
            if (stack.includes('TaskItem') || stack.includes('GanttContent')) {
              console.log('バックアップパッチ: ガントチャートコンポーネントのuseEffectを修正');
              return originalUseEffect(function () {
                try { return effect(); } catch (e) { console.error(e); }
              }, []);
            }
            return originalUseEffect(effect, deps);
          };
          window.__REACT_PATCHED = true;
        }
      }
    }, []);

    // 別のパッチ方法：componentDidUpdateに影響するuseLayoutEffectを修正
    useEffect(() => {
      if (window.React && window.React.useLayoutEffect && !window.React.__LAYOUT_EFFECT_PATCHED) {
        const originalUseLayoutEffect = window.React.useLayoutEffect;
        window.React.useLayoutEffect = function (effect: React.EffectCallback, deps?: React.DependencyList) {
          const stack = new Error().stack || '';
          if (stack.includes('TaskItem') || stack.includes('GanttContent')) {
            console.log('TaskItemのuseLayoutEffectを修正');
            return originalUseLayoutEffect(function () {
              try { return effect(); } catch (e) { console.error(e); }
            }, []);
          }
          return originalUseLayoutEffect(effect, deps);
        };
        window.React.__LAYOUT_EFFECT_PATCHED = true;
      }
    }, []);

    // ガントチャートライブラリの改善スクリプトを直接DOMに挿入
    useEffect(() => {
      // スクリプトが既に読み込まれているか確認
      if (window.__GANTT_FIX_APPLIED) {
        console.log('ガントチャート修正スクリプトは既に適用されています');
        return;
      }

      // 内部パッチ関数 - ReactのsetStateを特定の状況で無効化
      const patchReactInternals = () => {
        try {
          // Reactは既にグローバル変数として利用可能
          const React = (window as any).React;
          if (!React) return;

          console.log('Reactの内部関数にパッチを適用します');

          // オリジナルのuseEffectを保存
          const originalUseEffect = React.useEffect;

          // useEffectをオーバーライド
          React.useEffect = function (effect: React.EffectCallback, deps?: React.DependencyList) {
            // エラースタックを取得して発信元をチェック
            const stack = new Error().stack || '';

            // ガントチャート関連コンポーネントからの呼び出しの場合
            if (stack.includes('TaskItem') || stack.includes('GanttContent')) {
              // 空の依存配列を強制
              return originalUseEffect(function () {
                try { return effect(); } catch (e) { console.error(e); }
              }, []);
            }

            // その他の通常の呼び出しはそのまま
            return originalUseEffect(effect, deps);
          };
        } catch (error) {
          console.error('Reactの内部関数のパッチ適用に失敗しました:', error);
        }
      };

      // ページ読み込み完了時にパッチを適用
      if (document.readyState === 'complete') {
        patchReactInternals();
      } else {
        window.addEventListener('load', patchReactInternals);
      }

      return () => {
        window.removeEventListener('load', patchReactInternals);
      };
    }, []);

    // グローバル参照を設定（デバッグやライブラリとの連携用）
    useEffect(() => {
      // グローバル参照オブジェクト
      window.ganttScrollRef = {
        horizontal: null,
        vertical: null
      };

      return () => {
        // クリーンアップ
        window.ganttScrollRef = {
          horizontal: null,
          vertical: null
        };
      };
    }, []);

    // スクロール関連の初期化・クリーンアップを集約した関数
    useEffect(() => {
      console.log('初期化: スクロールハンドラー');

      // scrollIntoViewをオーバーライドして自動スクロールを防ぐ
      const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
      (window as any).__ganttIsRestoringScroll = false;
      (window as any).__ganttOriginalScrollIntoView = originalScrollIntoView;

      HTMLElement.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
        // スクロール位置を復元中の場合は、scrollIntoViewを無視
        if ((window as any).__ganttIsRestoringScroll) {
          console.log('[GanttView] scrollIntoView blocked during scroll restoration');
          return;
        }

        // ガントチャートコンテナ内の要素の場合は、scrollIntoViewを無視
        const ganttContainer = this.closest('.gantt-container, .gantt-horizontal-container, .gantt-vertical-scroll-container');
        if (ganttContainer && scrollPositionRef.current) {
          console.log('[GanttView] scrollIntoView blocked for gantt element to preserve scroll position');
          return;
        }

        // その他の場合は通常通り実行
        return originalScrollIntoView.call(this, options);
      };

      const setupScrollContainers = () => {
        const root = document.getElementById('gantt-container');
        const horizontalContainer = document.querySelector('.gantt-horizontal-container') as HTMLElement
          || (root?.querySelector('._CZjuD') as HTMLElement);
        const verticalContainers = root ? (Array.from(root.querySelectorAll('._2B2zv')) as HTMLElement[]) : [];
        const verticalContainer = document.querySelector('.gantt-vertical-scroll-container') as HTMLElement
          || verticalContainers[0];

        if (horizontalContainer) {
          horizontalContainerRef.current = horizontalContainer;
          window.ganttScrollRef.horizontal = horizontalContainer;
          horizontalContainer.style.overflowX = 'auto';
          horizontalContainer.style.touchAction = 'pan-x';
        }
        if (verticalContainer) {
          verticalContainerRef.current = verticalContainer;
          window.ganttScrollRef.vertical = verticalContainer;
          verticalContainers.forEach(el => {
            el.style.overflowY = 'auto';
            el.style.touchAction = 'pan-y';
          });
        }
      };

      setupScrollContainers();

      const handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        const root = document.getElementById('gantt-container');
        const horizontalContainer = horizontalContainerRef.current || (root?.querySelector('._CZjuD') as HTMLElement);
        const allVertical: HTMLElement[] = root ? Array.from(root.querySelectorAll('._2B2zv')) as HTMLElement[] : ([] as HTMLElement[]);
        if (!horizontalContainer || allVertical.length === 0) {
          setupScrollContainers();
          return;
        }
        const horizontalStep = e.deltaX * 0.8;
        const verticalStep = e.deltaY * 0.8;
        requestAnimationFrame(() => {
          if (e.shiftKey) {
            horizontalContainer.scrollLeft += verticalStep;
          } else {
            if (e.deltaX !== 0) horizontalContainer.scrollLeft += horizontalStep;
            if (e.deltaY !== 0 && allVertical.length > 0) {
              const first = allVertical[0];
              const maxTop = Math.max(0, first.scrollHeight - first.clientHeight);
              const newTop = Math.max(0, Math.min(maxTop, first.scrollTop + verticalStep));
              allVertical.forEach(el => { el.scrollTop = newTop; });
            }
          }
        });
      };

      const handleKeyDown = (e: KeyboardEvent) => {
        if (document.activeElement?.tagName === 'INPUT' ||
          document.activeElement?.tagName === 'TEXTAREA' ||
          (document.activeElement as HTMLElement)?.isContentEditable) {
          return;
        }
        const root = document.getElementById('gantt-container');
        const horizontalContainer = horizontalContainerRef.current || (root?.querySelector('._CZjuD') as HTMLElement);
        const allVertical: HTMLElement[] = root ? Array.from(root.querySelectorAll('._2B2zv')) as HTMLElement[] : ([] as HTMLElement[]);
        if (!horizontalContainer || allVertical.length === 0) return;
        switch (e.key) {
          case 'ArrowLeft':
            e.preventDefault();
            requestAnimationFrame(() => { horizontalContainer.scrollLeft -= 50; });
            break;
          case 'ArrowRight':
            e.preventDefault();
            requestAnimationFrame(() => { horizontalContainer.scrollLeft += 50; });
            break;
          case 'ArrowUp':
            e.preventDefault();
            requestAnimationFrame(() => {
              const newTop = Math.max(0, allVertical[0].scrollTop - 30);
              allVertical.forEach(el => { el.scrollTop = newTop; });
            });
            break;
          case 'ArrowDown':
            e.preventDefault();
            requestAnimationFrame(() => {
              const maxTop = Math.max(0, allVertical[0].scrollHeight - allVertical[0].clientHeight);
              const newTop = Math.min(maxTop, allVertical[0].scrollTop + 30);
              allVertical.forEach(el => { el.scrollTop = newTop; });
            });
            break;
        }
      };

      // リサイズ時にコンテナを再取得
      const handleResize = () => {
        setupScrollContainers();
      };

      // グローバルスクロール関数を定義
      window.scrollGanttLeft = (amount = 100) => {
        const container = horizontalContainerRef.current;
        if (container) {
          requestAnimationFrame(() => {
            container.scrollLeft -= amount;
          });
        }
      };

      window.scrollGanttRight = (amount = 100) => {
        const container = horizontalContainerRef.current;
        if (container) {
          requestAnimationFrame(() => {
            container.scrollLeft += amount;
          });
        }
      };

      window.scrollGanttUp = (amount = 50) => {
        const container = verticalContainerRef.current;
        if (container) {
          requestAnimationFrame(() => {
            container.scrollTop -= amount;
          });
        }
      };

      window.scrollGanttDown = (amount = 50) => {
        const container = verticalContainerRef.current;
        if (container) {
          requestAnimationFrame(() => {
            container.scrollTop += amount;
          });
        }
      };

      // イベントリスナーの登録
      const ganttElement = document.querySelector('.gantt');
      if (ganttElement) {
        // より互換性の高いイベントリスナーの設定
        try {
          ganttElement.addEventListener('wheel', handleWheel as EventListenerOrEventListenerObject, { passive: false, capture: true });
        } catch (err) {
          // 古いブラウザやpassive: falseが使えない場合のフォールバック
          ganttElement.addEventListener('wheel', handleWheel as EventListenerOrEventListenerObject, true);
        }
      }
      document.addEventListener('keydown', handleKeyDown);
      window.addEventListener('resize', handleResize);

      // イベントリスナーとコンテナの参照を保存（後でクリーンアップ用）
      const cleanupData = { ganttElement, wheelHandler: handleWheel, keyHandler: handleKeyDown, resizeHandler: handleResize }; // <<< resizeHandler を追加
      window.__ganttCleanupData = cleanupData; // <<< クリーンアップ関数から参照できるように window に保存

      // ★★★ クリーンアップ関数の中身を一時的にコメントアウト ★★★
      return () => {
        console.log('クリーンアップ: スクロールハンドラー (useEffect内)');

        // scrollIntoViewを元に戻す
        if ((window as any).__ganttOriginalScrollIntoView) {
          HTMLElement.prototype.scrollIntoView = (window as any).__ganttOriginalScrollIntoView;
          delete (window as any).__ganttOriginalScrollIntoView;
        }
        delete (window as any).__ganttIsRestoringScroll;

        // const savedCleanupData = window.__ganttCleanupData; // 保存したデータを取得
        // if (!savedCleanupData) return;
        // const { ganttElement: el, wheelHandler: wh, keyHandler: kh, resizeHandler: rh } = savedCleanupData; // 分割代入

        // if (el) el.removeEventListener('wheel', wh as EventListenerOrEventListenerObject, { capture: true });
        // document.removeEventListener('keydown', kh);
        // window.removeEventListener('resize', rh);

        // グローバル関数もクリーンアップ
        // window.scrollGanttLeft = () => {};
        // window.scrollGanttRight = () => {};
        // window.scrollGanttUp = () => {};
        // window.scrollGanttDown = () => {};
        // delete window.__ganttCleanupData; // 不要になったデータを削除
        // horizontalContainerRef.current = null; // Ref もクリア
        // verticalContainerRef.current = null;
      };
    }, []); // ★★★ 依存配列を空にする ★★★

    // コンポーネントがマウントされたことを確認
    useEffect(() => {
      console.log('マウント処理開始');
      // マウント後、少し遅延させてからレンダリング許可
      const timer = setTimeout(() => {
        console.log('マウント状態をtrueに設定');
        setIsMountedState(true);
        initializeScrollHandlers();
      }, 300);

      return () => {
        clearTimeout(timer);
        setIsMountedState(false);
        // cleanupScrollHandlers(); // ★★★ 一時的にコメントアウト ★★★
      };
      // }, [initializeScrollHandlers, cleanupScrollHandlers]); // 依存配列も調整が必要な場合がある
    }, [initializeScrollHandlers]); // cleanupScrollHandlers を使わないので依存配列から削除

    // ★★★ selectedProjectIdRef を使っていた useEffect を削除 ★★★
    // useEffect(() => {
    //   selectedProjectIdRef.current = selectedProjectId;
    // }, [selectedProjectId]);

    // ★★★ エラー/ローディング状態を追加 (必要に応じて) ★★★
    // ★★★ 移動済みのため削除 ★★★
    // const [isLoadingData, setIsLoadingData] = useState(false);
    // const [fetchError, setFetchError] = useState<string | null>(null);

    // ★★★ handleAuthError が未定義の場合に定義 (既存のものを確認) ★★★
    // ★★★ 移動済みのため削除 ★★★
    // const navigate = useNavigate(); // useNavigateフックを取得
    // const location = useLocation(); // useLocation を使用
    // const [authErrorOpen, setAuthErrorOpen] = useState(false);
    // 認証エラーダイアログの表示ロジックも必要...

    // データ取得関数 (既存の fetchData を useCallback でラップ)


    // ★★★ マウント時に最新データを取得する useEffect を追加 ★★★
    // ただし、親から既にタスクが渡されている場合（MetricsPageからの使用など）はfetchしない
    useEffect(() => {
      // 初期タスクが空の場合のみfetchData（独立ページとして使用される場合）
      if (initialTasks.length === 0) {
        console.log("GanttView マウント: initialTasksが空なので、最新データを取得します...");
        fetchData();
      } else {
        console.log(`GanttView マウント: 親から${initialTasks.length}件のタスクを受け取りました。fetchDataはスキップします。`);
        setIsGanttReady(true); // データは既にあるので準備完了
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // ★★★ マウント時のみ実行 ★★★

    // 既存の initialTasks 変更時の useEffect はコメントアウトまたは削除
    /*
    useEffect(() => {
        console.log("Initial tasks prop が変更されました:", initialTasks);
        // マウント時にfetchDataするので、これは不要になる可能性が高い
        // tasksRef.current = initialTasks;
        // setLocalTasks(initialTasks);
      }, [initialTasks]);
    */

    // ★★★ gtrTasks の useMemo (変更なし、内部の getProjectName/getUserName 呼び出しは有効になる) ★★★
    const gtrTasks = useMemo((): CustomGtrTask[] => {
      // isMountedState チェックは削除（マウント後にデータ取得するため）
      // if (!isMountedState) { ... }

      // ★★★ initialTasks を直接使用 ★★★
      if (!localTasks || localTasks.length === 0) {
        console.log('gtrTasks生成: localTasks が空です。空配列を返します。');
        return [];
      }

      console.log('gtrTasks生成: localTasks数 =', localTasks.length);
      console.log("DEBUG: useMemo フィルタリング前: localTasks=", JSON.stringify(localTasks.map(t => ({ id: t.id, name: t.name, project_id: t.project_id, start_date: t.start_date, due_date: t.due_date, dependsOn: t.dependsOn })), null, 2));
      console.log("DEBUG: useMemo フィルタリング前: projects=", JSON.stringify(projects, null, 2)); // projects確認用
      console.log("DEBUG: useMemo フィルタリング前: users=", JSON.stringify(users, null, 2)); // users確認用

      // 1. 上位でフィルター済みのタスクをそのまま使用
      const projectFilteredTasks = localTasks;
      console.log(`フィルタリング後のタスク数: ${projectFilteredTasks.length}個`);

      // 2. GtrTask への変換と検証
      const mappedTasks = projectFilteredTasks
        .map((task): CustomGtrTask | null => {
          // 日付の存在チェック
          if (!task.start_date || !task.due_date) {
            console.warn(`Task ${task.id} (${task.name}) skipped: Missing start_date or due_date.`);
            return null;
          }
          try {
            const startDate = parseISO(task.start_date);
            const endDate = parseISO(task.due_date);

            // 日付の有効性チェック
            if (!isValid(startDate) || !isValid(endDate)) {
              console.warn(`Task ${task.id} (${task.name}) skipped: Invalid date format. Start: ${task.start_date}, End: ${task.due_date}`);
              return null;
            }

            // 終了日が開始日より前の場合のチェック（調整はしない、スキップする）
            if (endDate < startDate) {
              console.warn(`Task ${task.id} (${task.name}) skipped: End date (${formatDate(endDate, 'yyyy-MM-dd')}) is before start date (${formatDate(startDate, 'yyyy-MM-dd')}).`);
              return null;
            }

            // ★★★ 依存関係IDの解決 (簡略版 - task.id がモックIDの数値部分と一致すると仮定) ★★★
            let resolvedDependencies: string[] | undefined = undefined;
            if (task.dependsOn && task.dependsOn.length > 0) {
              resolvedDependencies = [];
              for (const mockDepId of task.dependsOn) { // mockDepId は "task-1" のような形式
                const numericIdMatch = mockDepId.match(/\d+$/); // "task-123" から "123" を抽出
                if (numericIdMatch) {
                  const numericDepIdStr = numericIdMatch[0]; // "1", "2", ...
                  resolvedDependencies.push(numericDepIdStr);
                } else {
                  console.warn(`Could not parse numeric ID from dependency: Mock ID "${mockDepId}" for task "${task.name}" (ID: ${task.id})`);
                }
              }
              if (resolvedDependencies.length === 0) {
                resolvedDependencies = undefined;
              }
            }
            // ★★★ ここまで依存関係IDの解決 ★★★

            const coreName = getCoreTaskName(task.name);
            const originalFullName = task.name || '';

            const gtrTask: CustomGtrTask = {
              id: String(task.id),
              name: coreName,
              start: parseISO(task.start_date as string), // nullチェック済みなのでas string
              end: parseISO(task.due_date as string),   // nullチェック済みなのでas string
              progress: calculateProgress(task),
              type: 'task' as const,
              projectId: String(task.project_id),
              project: getProjectName(task.project_id ?? null, projects || []),
              assignee: getUserName(task.assigned_to ?? null, users || []),
              dependencies: resolvedDependencies, // ★ 解決済みの依存関係を使用
              styles: getTaskStyle(task),
              isDisabled: readOnly,
              fullName: originalFullName,
            };
            return gtrTask;
          } catch (e) {
            console.error(`Error mapping task ${task.id} (${task.name}):`, e, task);
            return null;
          }
        })
        .filter((task): task is CustomGtrTask => task !== null);

      console.log("Mapped and validated ganttTasks (raw):", mappedTasks);
      console.log("Mapped and validated ganttTasks (with dependencies):", JSON.stringify(mappedTasks.filter(t => t.dependencies && t.dependencies.length > 0).map(t => ({ id: t.id, name: t.name, dependencies: t.dependencies })), null, 2));

      const taskIds = new Set(mappedTasks.map(t => t.id));
      const finalTasks = mappedTasks.filter(task => {
        if (task.dependencies && task.dependencies.length > 0) {
          const validDependencies = task.dependencies.filter(depId => {
            const dependencyExists = taskIds.has(depId);
            if (!dependencyExists) { // logEnabled を考慮せず、常に警告を表示
              console.warn(
                `Task "${task.name}" (ID: ${task.id}) has a dependency on a non-existent or filtered task ID: "${depId}". ` +
                `This dependency will be ignored. Check if the dependent task is part of the current project/date filter.`
              );
            }
            return dependencyExists;
          });
          task.dependencies = validDependencies.length > 0 ? validDependencies : undefined;
        }
        return true;
      });

      // ★★★ デバッグログ追加 ★★★
      console.log("DEBUG: Final GTR tasks for Gantt (with dependencies):", JSON.stringify(finalTasks.filter(t => t.dependencies && t.dependencies.length > 0), null, 2));
      const exampleTaskWithDeps = finalTasks.find(t => t.id === "2"); // 例: ID "2" のタスク (タスク2)
      if (exampleTaskWithDeps) {
        console.log("DEBUG: Example Task (ID '2') details for Gantt:", JSON.stringify(exampleTaskWithDeps, null, 2));
      }
      // ★★★ ここまで ★★★

      // logEnabled の条件を削除し、常にログ出力
      console.log(`[GanttView] gtrTasks useMemo: Mapped ${mappedTasks.length} tasks to GtrTasks, Final ${finalTasks.length} tasks after dependency validation.`, { localTasksLength: localTasks.length });

      if (finalTasks.length === 0 && projectFilteredTasks.length > 0) {
        console.warn('All tasks were filtered out during mapping/validation. Check date formats, start/end order, and dependencies.');
      }

      // ★★★ スマートソートの適用 ★★★
      // 依存関係と日付を考慮して並び替えることで、矢印の重なりを軽減する
      const sortedTasks = smartSortTasks(finalTasks);

      // ★★★ 依存関係チェーンごとのスタッガリング（時間のずらし）適用 ★★★
      // 依存関係の線が重ならないように、つながりのあるタスク群ごとに少し時間をずらす
      const staggeredTasks = applyDependencyStaggering(sortedTasks);

      // ★★★ デバッグログ追加 ★★★
      console.log("DEBUG: Final GTR tasks for Gantt (sorted & staggered):", JSON.stringify(staggeredTasks.filter(t => t.dependencies && t.dependencies.length > 0).map(t => ({ name: t.name, start: t.start })), null, 2));

      return staggeredTasks;


    }, [localTasks, projects, users, readOnly]); // ★★★ 依存配列から selectedProjectId を削除 ★★★

    // フィルター処理用の useMemo は削除 (未使用のため)

    // ★★★ 依存関係を再帰的に取得するヘルパー関数 ★★★


    // ★★★ ライブラリ表示用タスクリスト：選択タスクと直接つながりのみハイライトし、矢印も選択タスクの出入りのみ ★★★
    const gtrTasksForDisplay = useMemo(() => {
      // タスクデータの検証
      if (!gtrTasks || gtrTasks.length === 0) {
        return [];
      }

      // 各タスクのstartとendプロパティを検証
      const validatedTasks = gtrTasks.filter((t: CustomGtrTask) => {
        if (!t || !t.start || !t.end) {
          console.warn(`Invalid task data: ${t?.id || 'unknown'} - missing start or end date`);
          return false;
        }
        if (!(t.start instanceof Date) || !(t.end instanceof Date)) {
          console.warn(`Invalid task data: ${t.id} - start or end is not a Date object`);
          return false;
        }
        if (isNaN(t.start.getTime()) || isNaN(t.end.getTime())) {
          console.warn(`Invalid task data: ${t.id} - start or end is an invalid date`);
          return false;
        }
        return true;
      });

      if (!selectedTaskId) {
        return validatedTasks;
      }

      const directIds = getDirectlyRelatedTaskIds(selectedTaskId, validatedTasks);

      return validatedTasks.map((t: CustomGtrTask) => {
        if (directIds.has(t.id)) {
          // 選択タスクに直接つながるタスク：矢印は「選択タスクに入る／選択タスクから出る」だけにする
          let dependencies: string[] | undefined;
          if (t.id === selectedTaskId) {
            dependencies = t.dependencies ?? []; // 選択タスク → そのまま（親→選択の矢印）
          } else if (t.dependencies?.includes(selectedTaskId)) {
            dependencies = [selectedTaskId]; // 選択の子 → 選択だけ（選択→子の矢印）
          } else {
            dependencies = []; // 選択の親など → 他矢印は出さない
          }
          return { ...t, dependencies };
        }

        // 直接つながっていないタスクは薄くし、矢印なし
        return {
          ...t,
          dependencies: [],
          styles: {
            ...t.styles,
            backgroundColor: '#eeeeee',
            backgroundSelectedColor: '#bdbdbd',
            progressColor: '#e0e0e0',
            progressSelectedColor: '#bdbdbd'
          }
        };
      });
    }, [gtrTasks, selectedTaskId]);

    // チャート左端の日付（依存関係オーバーレイのX座標用）
    const chartStartDate = useMemo(() => {
      const list = gtrTasks?.length ? gtrTasks : [];
      if (!list.length) return new Date();
      const min = Math.min(...list.flatMap(t => [t.start.getTime(), t.end.getTime()]));
      return new Date(min);
    }, [gtrTasks]);

    // コンポーネント内の状態変数を追加
    // ★★★ 移動済みのため削除 ★★★
    // const [isSaving, setIsSaving] = useState(false);
    // const [error, setError] = useState<string | null>(null);
    // const [editedTask, setEditedTask] = useState<string | null>(null);
    // const [localTasks, setLocalTasks] = useState<Task[]>([]);

    // useEffectでタスクが変更されたときの処理
    //useEffect(() => {
    //    console.log("タスクが更新されました:", initialTasks);
    //    localTasks = initialTasks;
    //    // setLocalTasks(initialTasks); // localTasksを更新
    //  }, [initialTasks]);

    // ★★★ 実際の更新処理 (デバウンス後に呼ばれる) ★★★
    const runTaskDateUpdate = useCallback((task: GtrTask, startDate: Date, endDate: Date) => {
      // isSaving チェックはデバウンス後の処理開始時に行う
      if (isSaving) {
        console.warn("Debounced task date change skipped: Save operation already in progress.");
        return;
      }
      console.log("Executing debounced task date change for:", task.id);

      // --- ここから元々の handleTaskDateChange 内のロジック (日付比較以降) ---
      try {
        // 終了日が開始日より前の調整
        let endDateToUse = new Date(endDate.getTime()); // コピーを作成
        if (endDateToUse < startDate) {
          let originalDurationDays = 0;
          // ★★★ localTasks を参照 ★★★
          const originalTask = localTasks.find(t => t.id.toString() === task.id.toString());
          if (originalTask && originalTask.start_date && originalTask.due_date) {
            const origStart = parseISO(originalTask.start_date);
            const origEnd = parseISO(originalTask.due_date);
            if (isValid(origStart) && isValid(origEnd) && origEnd >= origStart) {
              originalDurationDays = differenceInCalendarDays(origEnd, origStart);
            }
          } else {
            console.warn(`Task ${task.id}: Cannot find original task data in localTasks to calculate duration. Using current task duration.`);
            const currentTaskStart = new Date(task.start);
            const currentTaskEnd = new Date(task.end);
            if (isValid(currentTaskStart) && isValid(currentTaskEnd) && currentTaskEnd >= currentTaskStart) {
              originalDurationDays = differenceInCalendarDays(currentTaskEnd, currentTaskStart);
            } else {
              originalDurationDays = 0; // 最低0日
            }
          }
          console.warn(`End date was before start date. Adjusting end date using duration (${originalDurationDays} days).`);
          endDateToUse = addDays(startDate, originalDurationDays);
          console.log(`  -> Adjusted End Date: ${formatDate(endDateToUse, 'yyyy-MM-dd HH:mm:ss')}`);
        }

        // 日付変更チェック
        let datesChanged = true;
        // ★★★ localTasks を参照 ★★★
        const currentTaskState = localTasks.find(t => t.id.toString() === task.id.toString());
        if (currentTaskState && currentTaskState.start_date && currentTaskState.due_date) {
          // ★★★ parseISO を使う ★★★
          const currentStart = startOfDay(parseISO(currentTaskState.start_date));
          const currentEnd = startOfDay(parseISO(currentTaskState.due_date));
          const newStartDay = startOfDay(startDate); // 引数の startDate を使用
          const newEndDay = startOfDay(endDateToUse); // 調整後の endDateToUse を使用

          console.log(`Comparing dates for Task ID=${task.id}:`);
          console.log(`  - New Start (UI): ${formatDate(newStartDay, 'yyyy-MM-dd')}`);
          console.log(`  - New End (UI):   ${formatDate(newEndDay, 'yyyy-MM-dd')}`);
          console.log(`  - Current Start (DB): ${formatDate(currentStart, 'yyyy-MM-dd')} (from ${currentTaskState.start_date})`);
          console.log(`  - Current End (DB):   ${formatDate(currentEnd, 'yyyy-MM-dd')} (from ${currentTaskState.due_date})`);

          if (isEqual(newStartDay, currentStart) && isEqual(newEndDay, currentEnd)) {
            console.log(`  -> No change detected compared to current data. Skipping API call.`);
            datesChanged = false;
            return; // API呼び出しスキップ
          }
        } else {
          console.warn(`  -> Current task state not found in localTasks for ID ${task.id}. Assuming change.`);
          datesChanged = true;
        }

        if (datesChanged) {
          console.log(`  -> Dates changed. Preparing API update...`);
          console.log(`     New Start: ${formatDate(startDate, 'yyyy-MM-dd')}, New End: ${formatDate(endDateToUse, 'yyyy-MM-dd')}`);

          const taskId = task.id.toString();
          saveScrollPosition();

          const formattedStartDate = formatDate(startDate, 'yyyy-MM-dd');
          const formattedEndDate = formatDate(endDateToUse, 'yyyy-MM-dd'); // 調整後の日付を使用

          const updateData: Partial<Task> = {
            start_date: formattedStartDate,
            due_date: formattedEndDate
          };

          setIsSaving(true); // ★★★ API呼び出し直前に true に設定 ★★★
          setError(null);
          setEditedTask(taskId);

          api.put(`/tasks/${taskId}`, updateData)
            .then((response) => {
              console.log(`  -> API Update Success for task ${taskId}:`, response.data);
              const updatedTaskData = response.data as Task;

              // ★★★ 日付正規化 ★★★
              let normalizedStartDate: string | null = null;
              if (updatedTaskData.start_date) { try { normalizedStartDate = formatDate(parseISO(updatedTaskData.start_date), 'yyyy-MM-dd'); } catch (e) { console.error("Error parsing start_date..."); } }
              let normalizedDueDate: string | null = null;
              if (updatedTaskData.due_date) { try { normalizedDueDate = formatDate(parseISO(updatedTaskData.due_date), 'yyyy-MM-dd'); } catch (e) { console.error("Error parsing due_date..."); } }
              console.log(`  -> Normalized Dates: Start=${normalizedStartDate}, End=${normalizedDueDate}`);

              // ★★★ localTasks state を更新 ★★★
              const updatedTasks = localTasks.map(t => {
                if (t.id.toString() === taskId) {
                  return { ...updatedTaskData, start_date: normalizedStartDate, due_date: normalizedDueDate };
                }
                return t;
              });
              setLocalTasks(updatedTasks); // ★★★ ここで state を更新 ★★★
              // tasksRef.current = updatedTasks; // 不要
              // forceUpdate({}); // setLocalTasks が再レンダリングをトリガーするので不要
              restoreScrollPosition();
            })
            .catch(error => {
              console.error(`  -> API Update Error for task ${taskId}:`, error);
              setError(`タスク ${taskId} の日付更新に失敗しました。`);
              if (error.response && error.response.status === 401) { handleAuthError(); }
              restoreScrollPosition();
              forceUpdate({});
            })
            .finally(() => {
              setIsSaving(false); // ★★★ 成功/失敗に関わらず false に戻す ★★★
              setEditedTask(null);
            });
        } else {
          // datesChanged が false の場合、isSaving は true になっていないはず
        }

      } catch (error) {
        console.error('Unexpected error during debounced date change handling:', error);
        setError('予期せぬエラーが発生しました。');
        restoreScrollPosition();
        forceUpdate({});
        setIsSaving(false); // ★★★ catch ブロックでも false に戻す ★★★
      }
      // --- ここまで更新処理 --- 
    }, [isSaving, localTasks, readOnly, saveScrollPosition, restoreScrollPosition, handleAuthError, setError, setEditedTask, forceUpdate]); // ★★★ 依存配列を localTasks ベースに修正 ★★★

    // ★★★ デバウンス関数 (変更なし、内部の clearTimeout/setTimeout はブラウザ API を使用) ★★★
    const debouncedUpdateTaskDate = useCallback((task: GtrTask, startDate: Date, endDate: Date) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      // setTimeout はブラウザ環境では number を返す
      debounceTimeoutRef.current = window.setTimeout(() => {
        runTaskDateUpdate(task, startDate, endDate); // 実際の処理を呼び出す
      }, 500); // 500ms待機
    }, [runTaskDateUpdate]);

    // ★★★ Gantt イベントハンドラ (ラッパー) ★★★
    const handleGanttDateChangeEvent = useCallback((task: GtrTask) => {
      console.log("Gantt onDateChange triggered (pre-debounce):", task.id, task.start, task.end);
      // イベント引数の task オブジェクトの日付を信頼する
      const taskStartDate = new Date(task.start);
      const taskEndDate = new Date(task.end);
      if (isValid(taskStartDate) && isValid(taskEndDate)) {
        debouncedUpdateTaskDate(task, taskStartDate, taskEndDate); // デバウンス関数を呼び出す
      } else {
        console.error("Invalid dates received in handleGanttDateChangeEvent:", task);
      }
    }, [debouncedUpdateTaskDate]); // debouncedUpdateTaskDate を依存関係に追加

    // ★★★ 元の handleTaskDateChange は削除 ★★★
    /*
    const handleTaskDateChange = useCallback((...) => { ... }, [...]);
    */

    // タスクの進捗更新ハンドラ - any型を使用して互換性を確保
    const handleProgressChange: CustomProgressEventHandler = (task, progress) => {
      // タスクの進捗状態を更新
      // ★★★ API に渡すデータも type.ts の Task 型に合わせるか、バックエンドの期待値に合わせる ★★★
      const updatedTask: Partial<Task> = { // Task型の一部として定義
        // name: task.name, // name は変更しない想定
        progress: progress,
        status: progress === 100 ? 'completed' : (progress > 0 ? 'in-progress' : 'todo') // status を使用
      };

      // API呼び出し (api.updateTaskではなくapi.putを使用)
      api.put(`/tasks/${task.id}`, updatedTask)
        .then((response) => {
          console.log('タスク進捗の更新成功:', response.data);
          // タスク一覧を更新
          // ★★★ 移動済みのため削除 ★★★
          // fetchData(); 
        })
        .catch((error) => {
          console.error('タスク進捗の更新に失敗:', error);
          // 認証エラー（401）の場合、ダイアログを表示
          if (error.response && error.response.status === 401) {
            handleAuthError();
          }
        });
    };

    // ダブルクリック時のハンドラ（タスク詳細表示・編集など）
    const handleTaskDoubleClick: CustomTaskDoubleClickHandler = (task) => {
      // 詳細表示をコンソールログに変更
      console.log(`タスク詳細：${task.name}`, {
        開始日: formatDate(task.start, 'yyyy/MM/dd'),
        終了日: formatDate(task.end, 'yyyy/MM/dd'),
        進捗: `${task.progress}%`
      });
    };

    // タスク選択ハンドラ
    // const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null); // 上部に移動済み

    const handleTaskSelect = (task: any, isSelected: boolean) => {
      // 選択状態の切り替え (同じタスクなら解除、違うなら選択)
      saveScrollPosition(); // ★★★ State更新前にスクロール位置を保存 ★★★

      const savedScrollLeft = scrollPositionRef.current?.left ?? 0;
      const savedScrollTop = scrollPositionRef.current?.top ?? 0;

      console.log(`[GanttView] Task selected: ${task.id}, Saved scroll position: L=${savedScrollLeft}, T=${savedScrollTop}`);

      setSelectedTaskId(prevId => {
        const newId = prevId === String(task.id) ? null : String(task.id);
        return newId;
      });

      const { hContainer } = getScrollContainers();
      const allVertical = getAllVerticalContainers();
      if (!hContainer && allVertical.length === 0) {
        console.warn('[GanttView] Scroll containers not found');
        return;
      }

      const forceRestoreScroll = () => {
        if (hContainer && savedScrollLeft !== undefined) {
          if (Math.abs(hContainer.scrollLeft - savedScrollLeft) > 1) {
            hContainer.scrollLeft = savedScrollLeft;
          }
        }
        if (savedScrollTop !== undefined && allVertical.length > 0) {
          const targetTop = Math.max(0, Math.min(savedScrollTop, allVertical[0].scrollHeight - allVertical[0].clientHeight));
          allVertical.forEach(el => { el.scrollTop = targetTop; });
        }
      };

      // 即座に復元＋再レンダ直後の数回だけ復元（スクロールをロックしない）
      forceRestoreScroll();
      const restoreDelays = [0, 16, 50, 100];
      restoreDelays.forEach((delay) => {
        setTimeout(forceRestoreScroll, delay);
      });
    };


    // カスタムタスクリストを使用するための関数
    const renderCustomTaskList = (listProps: any) => {
      return (
        <CustomTaskList
          {...listProps}
          projectsData={projects}
          selectedTaskId={selectedTaskId}
          setSelectedTask={handleTaskSelect}
        />
      );
    };

    // ★★★ ディープクローンとJSON変換用ヘルパー関数 ★★★
    const safeCloneWithDates = (obj: any): any => {
      if (!obj) return obj;

      // 配列の場合は各要素に対して再帰的に処理
      if (Array.isArray(obj)) {
        return obj.map(item => safeCloneWithDates(item));
      }

      // オブジェクトの場合はプロパティごとに処理
      if (typeof obj === 'object') {
        const result: any = {};

        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            // Dateオブジェクトの場合はISO文字列に変換
            if (obj[key] instanceof Date) {
              result[key] = formatDate(obj[key], 'yyyy-MM-dd');
            } else {
              result[key] = safeCloneWithDates(obj[key]);
            }
          }
        }

        return result;
      }

      // プリミティブ値はそのまま返す
      return obj;
    };

    // ガントチャートライブラリとの互換性向上のための効果
    useEffect(() => {
      const enhanceGanttEvents = () => {
        // ... (コンテナ取得など)
        // ganttContainer.addEventListener(\'mouseup\', (e) => {
        //   // ドラッグ操作後のマウスアップイベントで、タスクの更新が必要かをチェック
        //   console.log(\'ガントチャートでマウスアップイベントを検出しました\');
        //   // ここで最新のタスクリストを再取得する
        //   // APIコールを直接行うのではなく、次回のレンダリングサイクルで変更を検出するように
        //   // setTimeout(() => {
        //   //   forceUpdate({}); // ★★★ この forceUpdate が複数呼び出しの原因の可能性 -> コメントアウト ★★★
        //   // }, 100);
        // });
        // ... (try-catch)
      };

      // ... (マウント後の呼び出し)

      return () => {
        // ... (クリーンアップ)
      };
      // }, [isMountedState, forceUpdate]); // ★★★ forceUpdate を依存配列から削除 (コメントアウトしたため) ★★★
    }, [isMountedState]); // ★★★ isMountedState のみに変更 ★★★

    // 保存処理の改善
    const handleSaveCurrentState = async () => {
      try {
        console.log('状態の保存を開始します...');

        // 1. 現在のデータをエクスポート
        const exportResponse = await api.post('/admin/mock-data/export');
        const currentData = exportResponse.data;
        console.log('現在のデータをエクスポートしました。');

        // 2. タスクを更新
        const updatedTasks = safeCloneWithDates(localTasks);
        console.log('タスクデータを安全にクローンしました。');

        // 変更検出カウンター
        let updatedCount = 0;

        // 最終的な更新対象のタスク
        interface TaskUpdate {
          id: string;
          start_date: string;
          due_date: string;
          status?: string;
        }

        const tasksToUpdate: TaskUpdate[] = [];

        // オリジナルタスクと現在のガントチャートタスクの比較を直接行う
        // ★★★ 型アノテーションを追加 ★★★
        gtrTasks.forEach((gtrTask: CustomGtrTask) => {
          if (!gtrTask.id || gtrTask.id.startsWith('dummy') || gtrTask.id.startsWith('placeholder')) {
            return; // ダミータスクはスキップ
          }

          // 対応するタスクを検索
          const originalTaskIndex = updatedTasks.findIndex((t: any) => t.id === gtrTask.id);
          if (originalTaskIndex >= 0) {
            // 開始日・終了日を更新
            const newStartDate = formatDate(gtrTask.start, 'yyyy-MM-dd');
            const newEndDate = formatDate(gtrTask.end, 'yyyy-MM-dd');

            // 現在の値と異なる場合のみ更新
            if (updatedTasks[originalTaskIndex].start_date !== newStartDate ||
              updatedTasks[originalTaskIndex].due_date !== newEndDate) {

              // 更新対象としてマーク
              const taskToUpdate: TaskUpdate = {
                id: gtrTask.id,
                start_date: newStartDate,
                due_date: newEndDate
              };

              // もし進捗も変更されていれば追加
              if (gtrTask.progress === 100 && updatedTasks[originalTaskIndex].status !== 'completed') {
                taskToUpdate.status = 'completed';
              } else if (gtrTask.progress > 0 &&
                updatedTasks[originalTaskIndex].status !== 'in-progress' &&
                updatedTasks[originalTaskIndex].status !== 'completed') {
                taskToUpdate.status = 'in-progress';
              }

              tasksToUpdate.push(taskToUpdate);
              updatedCount++;

              // ローカルタスクデータも更新
              updatedTasks[originalTaskIndex].start_date = newStartDate;
              updatedTasks[originalTaskIndex].due_date = newEndDate;

              console.log(`タスク ${gtrTask.id} の日付を更新:`, {
                start: newStartDate,
                end: newEndDate
              });
            }
          }
        });

        // 変更がない場合
        if (updatedCount === 0) {
          console.log('変更が検出されませんでした。保存をスキップします。');
          showInfo('変更はありませんでした。保存をスキップします。');
          return;
        }

        console.log(`合計 ${updatedCount} 個のタスク更新を検出しました。更新を実行します。`);

        // 各タスクを個別に更新
        for (const task of tasksToUpdate) {
          try {
            console.log(`タスク ${task.id} を更新中...`, task);
            const response = await api.put(`/tasks/${task.id}`, task);
            console.log(`タスク ${task.id} の更新成功:`, response.data);
          } catch (err) {
            console.error(`タスク ${task.id} の更新失敗:`, err);
            throw err; // エラーを上位に伝播
          }
        }

        // 成功メッセージを表示
        showSuccess(`タスク状態が正常に保存されました。${updatedCount}個のタスクが更新されました。`);
        console.log(`${updatedCount}個のタスクの永続化に成功しました。`);

        // ★★★ setLocalTasks を使用して State を更新 ★★★
        setLocalTasks(updatedTasks);
        // localTasks = updatedTasks; // この行を setLocalTasks に置き換え
        // forceUpdate({}); // setLocalTasks で再レンダリングされるため不要
      } catch (error: any) {
        console.error('タスク状態の永続化に失敗:', error);

        // エラーレスポンスを適切に処理
        if (error.response) {
          if (error.response.status === 401) {
            showError('認証エラーが発生しました。再ログインが必要です。');
          } else if (error.response.status === 403) {
            showError('このアクションを実行する権限がありません。');
          } else {
            showError(`サーバーエラーが発生しました (${error.response.status}): ${error.response.data?.detail || 'エラー詳細不明'}`);
          }
        } else if (error.request) {
          showError('サーバーに接続できませんでした。ネットワーク接続を確認してください。');
        } else {
          showError(`エラーが発生しました: ${error.message}`);
        }
      }
    };

    // 表示モード変更時の処理
    const handleViewModeChange = (event: SelectChangeEvent<string>) => {
      const newViewMode = event.target.value as ViewMode;
      console.log(`表示モードを変更: ${newViewMode}`);

      // スクロール位置をリセット
      saveScrollPosition();

      // 表示モードを更新
      setViewMode(newViewMode);

      // スクロール位置を復元（少し遅延させる）
      setTimeout(restoreScrollPosition, 50);
    };

    // useEffectを使用して、コンポーネントマウント時に依存関係制約を無効化
    useEffect(() => {
      // ガントチャートの依存関係制約を無効化
      if (window) {
        window.__DISABLE_DEPENDENCY_CONSTRAINTS = true;
        console.log('依存関係の制約を無効化しました');
      }

      // コンポーネントがアンマウントされる際にクリーンアップ
      return () => {
        // 必要に応じてクリーンアップを実行
      };
    }, []);

    // Ganttコンポーネントをレンダリング
    return (
      <ColumnWidthContext.Provider value={{ colWidths, setColWidths, listCellWidth, setListCellWidth }}>
        {/* 認証エラーダイアログ */}
        <Dialog
          open={authErrorOpen}
          onClose={() => setAuthErrorOpen(false)}
          aria-labelledby="auth-error-dialog-title"
        >
          <DialogTitle id="auth-error-dialog-title">セッション期限切れ</DialogTitle>
          <DialogContent>
            <DialogContentText>
              セッションの期限が切れました。再度ログインしてください。
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAuthErrorOpen(false)} color="primary">
              閉じる
            </Button>
            <Button onClick={handleRelogin} color="primary" autoFocus>
              ログイン画面へ
            </Button>
          </DialogActions>
        </Dialog>

        <Popover
          open={!!helpAnchorEl}
          anchorEl={helpAnchorEl}
          onClose={() => setHelpAnchorEl(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <Box sx={{ p: 2, minWidth: 240 }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 700 }}>キーボードショートカット</Typography>
            <Stack spacing={0.75}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip label="Esc" size="small" sx={{ fontFamily: 'monospace' }} /> 選択解除
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip label="←" size="small" sx={{ fontFamily: 'monospace' }} />
                <Chip label="→" size="small" sx={{ fontFamily: 'monospace' }} /> 横スクロール
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip label="↑" size="small" sx={{ fontFamily: 'monospace' }} />
                <Chip label="↓" size="small" sx={{ fontFamily: 'monospace' }} /> 縦スクロール
              </Box>
            </Stack>
          </Box>
        </Popover>


        <Paper sx={{ p: 2, height: '100%', width: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1, flexShrink: 0 }}>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 'bold' }}>
              ガントチャート
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Tooltip title="表示単位（日/週/月）">
                <Box component="span" sx={{ display: 'inline-flex' }}>
                  <FormControl size="small" sx={{ minWidth: 90 }}>
                    <InputLabel sx={{ fontSize: '0.7rem' }}>表示</InputLabel>
                    <Select value={viewMode} label="表示" onChange={handleViewModeChange} sx={{ fontSize: '0.7rem' }}>
                      <MenuItem value={ViewMode.Day} sx={{ fontSize: '0.7rem' }}>日</MenuItem>
                      <MenuItem value={ViewMode.Week} sx={{ fontSize: '0.7rem' }}>週</MenuItem>
                      <MenuItem value={ViewMode.Month} sx={{ fontSize: '0.7rem' }}>月</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
              </Tooltip>
              {/* ★★★ ズームボタンを追加 ★★★ */}
              <Tooltip title="拡大 (+)">
                <IconButton onClick={handleZoomIn} size="small">
                  <AddIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="縮小 (-)">
                <IconButton onClick={handleZoomOut} size="small">
                  <RemoveIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="キーボードショートカット">
                <IconButton onClick={(e) => setHelpAnchorEl(e.currentTarget)} size="small">
                  <KeyboardIcon />
                </IconButton>
              </Tooltip>
              {/* ナビゲーション */}
              {/* <IconButton onClick={handlePrevious} size="small"><NavigateBefore /></IconButton> */}
              {/* <IconButton onClick={handleNext} size="small"><NavigateNext /></IconButton> */}
              {/* 保存ボタン */}
              {/* <Button onClick={handleSaveCurrentState} variant="outlined" size="small" disabled={isSaving}>
              {isSaving ? <CircularProgress size={16} sx={{mr: 1}}/> : null} 保存
            </Button> */}
            </Stack>
          </Stack>

          {/* タスクステータスの凡例 */}
          <Stack direction="row" spacing={1.5} sx={{ mb: 1, ml: 1, flexShrink: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Box sx={{ width: 16, height: 16, backgroundColor: '#4dabf5', mr: 0.5 }} />
              <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>未着手</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Box sx={{ width: 16, height: 16, backgroundColor: '#ffb74d', mr: 0.5 }} />
              <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>進行中</Typography>
            </Box>
            {/* ★ レビュー中の凡例を追加 ★ */}
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Box sx={{ width: 16, height: 16, backgroundColor: '#ba68c8', mr: 0.5 }} />
              <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>レビュー中</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Box sx={{ width: 16, height: 16, backgroundColor: '#f6685e', mr: 0.5 }} />
              <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>遅延</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Box sx={{ width: 16, height: 16, backgroundColor: '#81c784', mr: 0.5 }} />
              <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>完了</Typography>
            </Box>
          </Stack>

          {/* エラー表示 */}
          {fetchError && <Alert severity="error" sx={{ mb: 1 }}>{fetchError}</Alert>}
          {error && <Alert severity="warning" sx={{ mb: 1 }}>{error}</Alert>} {/* ★★★ 保存エラー表示を追加 ★★★ */}

          <GanttWrapper
            className={isDarkMode ? 'theme-dark' : ''}
            style={{
              flexGrow: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              width: '100%',
              backgroundColor: isDarkMode ? '#121212' : undefined,
            }}
          >
            <div
              id="gantt-container"
              className="gantt-container"
              style={{
                height: '100%', // 親要素に追従
                width: '100%',
                overflowY: 'auto', // ★★★ 縦方向のスクロールを自動に ★★★
                overflowX: 'hidden', // ★★★ 横方向はGantt内部に任せるためhiddenのまま ★★★
                position: 'relative', // スクロールバー用
                flexGrow: 1, // 残りのスペースを埋める
                boxSizing: 'border-box', // パディングとボーダーを幅に含める
              }}
              ref={ganttContainerRef} // Ref を設定
            >
              {isLoadingData || !isGanttReady ? (
                <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                  <CircularProgress />
                </Box>
              ) : (() => {
                // タスクデータの最終検証
                if (!gtrTasksForDisplay || gtrTasksForDisplay.length === 0) {
                  return (
                    <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" height="100%" gap={2} sx={{ p: 3 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                        表示可能なタスクがありません。タスクに開始日と終了日を設定してください。
                      </Typography>
                      {handleOpenCreateTask && (
                        <Button variant="outlined" size="small" onClick={handleOpenCreateTask} sx={{ textTransform: 'none' }}>
                          タスクを追加
                        </Button>
                      )}
                    </Box>
                  );
                }

                // タスクデータの構造を検証
                const invalidTasks = gtrTasksForDisplay.filter(t => {
                  if (!t || !t.id) return true;
                  if (!t.start || !t.end) return true;
                  if (!(t.start instanceof Date) || !(t.end instanceof Date)) return true;
                  if (isNaN(t.start.getTime()) || isNaN(t.end.getTime())) return true;
                  return false;
                });

                if (invalidTasks.length > 0) {
                  console.error('Invalid task data detected:', invalidTasks);
                  return (
                    <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" height="100%" gap={2} sx={{ p: 3 }}>
                      <Alert severity="error" sx={{ mb: 2 }}>
                        <Typography variant="body2">
                          タスクデータの形式に問題があります。{invalidTasks.length}個のタスクが無効です。
                        </Typography>
                      </Alert>
                      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                        ブラウザのコンソールで詳細を確認してください。
                      </Typography>
                    </Box>
                  );
                }

                // 有効なタスクのみをフィルタリング
                const validTasks = gtrTasksForDisplay.filter(t => {
                  return t && t.id && t.start && t.end &&
                    (t.start instanceof Date) && (t.end instanceof Date) &&
                    !isNaN(t.start.getTime()) && !isNaN(t.end.getTime());
                });

                if (validTasks.length === 0) {
                  return (
                    <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" height="100%" gap={2} sx={{ p: 3 }}>
                      <Alert severity="warning" sx={{ mb: 2 }}>
                        <Typography variant="body2">
                          すべてのタスクデータが無効です。
                        </Typography>
                      </Alert>
                      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                        タスクに開始日と終了日を設定してください。
                      </Typography>
                    </Box>
                  );
                }

                return (
                  <MemoizedGantt // Memoizedコンポーネントを使用
                    key="stable-gantt-key" // ★★★ 安定したキーを試す ★★★
                    tasks={validTasks} // ★★★ 検証済みの有効なタスクのみを渡す ★★★
                    viewMode={viewMode}
                    viewDate={new Date()} // ★ 再度追加: 今日の日付を指定
                    listCellWidth={listCellWidth}
                    columnWidth={currentColumnWidth} // ★★★ state を使用 ★★★
                    ganttHeight={400}
                    fontFamily='"Roboto", "Helvetica", "Arial", sans-serif'
                    fontSize='0.65rem'
                    headerHeight={45}
                    rowHeight={30}
                    barCornerRadius={3}
                    barFill={75}
                    handleWidth={8}
                    arrowColor="#37474f"
                    arrowIndent={24}
                    onDateChange={handleGanttDateChangeEvent}
                    onProgressChange={handleProgressChange as any} // 型互換性のためのanyキャスト
                    onDoubleClick={handleTaskDoubleClick}
                    onSelect={handleTaskSelect}
                    TaskListHeader={CustomTaskListHeader}
                    TaskListTable={renderCustomTaskList}
                    TooltipContent={CustomTooltipContent}
                  />
                );
              })()}
            </div>
          </GanttWrapper>
        </Paper>

        {/* Snackbar通知 */}
        <Snackbar
          open={snackbar.open}
          autoHideDuration={6000}
          onClose={handleCloseSnackbar}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
            {snackbar.message}
          </Alert>
        </Snackbar>
      </ColumnWidthContext.Provider>
    );
  }
);

// コンポーネント全体をメモ化して最適化
export default GanttView; // ★★★ この行を残す ★★★

