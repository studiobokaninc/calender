import React, { useMemo, useState, useEffect, createContext, useContext, useRef, useCallback, memo, forwardRef } from 'react';
import { Task as GtrTask, Gantt as ReactGantt, ViewMode, StylingOption, DisplayOption } from 'gantt-task-react'; // ★★★ Gantt を ReactGantt としてインポート ★★★
import "gantt-task-react/dist/index.css"; // ★★★ ライブラリのCSSをインポート ★★★
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
  Alert
} from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { Task, Project, User } from '../types'; // ★★★ パス修正 ../../types -> ../types ★★★
import { parseISO, format as formatDate, isValid, differenceInCalendarDays, addDays, startOfDay, isEqual } from 'date-fns';
import api, { setAuthErrorCallback } from '../services/api';
import axios from 'axios';
import NavigateBefore from '@mui/icons-material/NavigateBefore';
import NavigateNext from '@mui/icons-material/NavigateNext';
import AddIcon from '@mui/icons-material/Add'; // ★★★ 追加 ★★★
import RemoveIcon from '@mui/icons-material/Remove'; // ★★★ 追加 ★★★
import { useNavigate, useLocation } from 'react-router-dom'; // useLocation をインポート
import styled from 'styled-components';

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

// イベントハンドラの型を拡張
type CustomTaskEventHandler = (
  task: GtrTask,
  start: Date,
  end: Date
) => void;

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

// ステータスに基づいてタスクのスタイルを決定する関数
const getTaskStyle = (task: Task) => {
  switch(task.status) { // ★★★ Fix: taskStatus -> status ★★★
    case 'todo':
      return { 
        backgroundColor: '#4dabf5', 
        backgroundSelectedColor: '#2196f3',
        progressColor: '#1769aa',
        progressSelectedColor: '#115293'
      };
    case 'in-progress':
      return { 
        backgroundColor: '#ffb74d', 
        backgroundSelectedColor: '#ff9800',
        progressColor: '#f57c00',
        progressSelectedColor: '#e65100'
      };
    case 'review':      // ★ 'review' ケースを追加 ★
      return { 
        backgroundColor: '#ba68c8', // 例: 紫系
        backgroundSelectedColor: '#ab47bc',
        progressColor: '#8e24aa',
        progressSelectedColor: '#6a1b9a'
      };
    case 'delayed': // ★★★ Add 'delayed' case if needed, or handle in default ★★★
      return { 
        backgroundColor: '#f6685e', 
        backgroundSelectedColor: '#f44336',
        progressColor: '#aa2e25',
        progressSelectedColor: '#7f1f1a'
      };
    case 'completed': // ★★★ Fix: 'done' -> 'completed' ★★★
      return { 
        backgroundColor: '#81c784', 
        backgroundSelectedColor: '#4caf50',
        progressColor: '#357a38',
        progressSelectedColor: '#1b5e20'
      };
    default:
      // null や予期せぬステータスの場合
      console.warn(`Unknown task status for styling: ${task.status}`); // ★ 警告ログ追加
      return { 
        backgroundColor: '#9e9e9e', 
        backgroundSelectedColor: '#757575',
        progressColor: '#616161',
        progressSelectedColor: '#424242'
      };
  }
};

// 列幅の状態を共有するためのコンテキスト
const ColumnWidthContext = createContext<{
  colWidths: { project: number, name: number, from: number, to: number };
  setColWidths: React.Dispatch<React.SetStateAction<{ project: number, name: number, from: number, to: number }>>;
  listCellWidth: string;
  setListCellWidth: React.Dispatch<React.SetStateAction<string>>;
}>({
  colWidths: { project: 25, name: 35, from: 20, to: 20 },
  setColWidths: () => {},
  listCellWidth: "250px",
  setListCellWidth: () => {}
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
        const newWidth = Math.max(150, Math.min(600, startListWidth + deltaX)); // 最大幅調整
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
            if(currentTotal > totalWidth) newWidths.from -= (currentTotal - totalWidth);
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
      
      {/* リサイズハンドル */}
      <div 
        style={{ width: '5px', height: '100%', cursor: 'col-resize', backgroundColor: '#eee', flexShrink: 0 }}
        onMouseDown={(e) => startResize(e, 'project')}
      />
      
      {/* タスク名 */}
      <div style={{ width: `${colWidths.name}%`, textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', boxSizing: 'border-box', padding: '0 2px' }}>Name</div>
      
      {/* リサイズハンドル */}
      <div 
        style={{ width: '5px', height: '100%', cursor: 'col-resize', backgroundColor: '#eee', flexShrink: 0 }}
        onMouseDown={(e) => startResize(e, 'name')}
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
        style={{ width: '5px', height: '100%', cursor: 'col-resize', backgroundColor: '#eee', flexShrink: 0 }}
        onMouseDown={(e) => startResize(e, 'from')}
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
        style={{ width: '5px', height: '100%', cursor: 'col-resize', backgroundColor: '#ccc', flexShrink: 0, marginLeft: 'auto' }}
        onMouseDown={(e) => startResize(e, 'gantt')}
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

// ★★★ カスタムタスクリスト (プロジェクト名を表示) ★★★
const CustomTaskList: React.FC<any> = ({ 
  tasks, 
  rowHeight, 
  // rowWidth, // rowWidth は listCellWidth から計算されるため、直接は使わないことが多い
  selectedTaskId, 
  setSelectedTask,
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
          className={`widget-task-list-item ${selectedTaskId === task.id ? 'selected' : ''}`}
          style={{ 
            height: rowHeight, 
            display: 'flex', 
            alignItems: 'center',
            backgroundColor: selectedTaskId === task.id ? 'rgba(0, 0, 0, 0.05)' : undefined,
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
  // columnWidth, viewMode も比較
  if (!prevProps.tasks || !nextProps.tasks) return true;
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
  // ... existing styles ...

  /* ★★★ Adjust timeline header text font size ★★★ */
  .gantt-container .calendar svg text {
      font-size: 0.65rem !important; /* Adjust font size */
      /* fill: #555; */ /* Optional: adjust color */
  }
  /* --------------------------------------------- */

  // ... existing styles ...
`;

// ★ TooltipWrapper の定義を CustomTaskList の前に移動
const TooltipWrapper = forwardRef<HTMLSpanElement, { children: React.ReactNode }>((props, ref) => {
  return <span ref={ref} {...props} style={{ display: 'inline-block', width: '100%' }} />;
});

const GanttView: React.FC<GanttViewProps> = memo(
  ({ tasks: initialTasks, initialViewMode = ViewMode.Week, onTaskSelect, handleOpenCreateTask, readOnly = false, projects, users }) => {

  // ================= HOOKS =================
  const [colWidths, setColWidths] = useState({
    project: 25,
    name: 35,
    from: 20,
    to: 20
  });
  const [listCellWidth, setListCellWidth] = useState("250px");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");
  const [forceUpdateState, forceUpdate] = useState<object>({});
  const ganttContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollPositionRef = useRef<{left: number, top: number} | null>(null);
  const [isMountedState, setIsMountedState] = useState(false);
  const horizontalContainerRef = useRef<HTMLElement | null>(null);
  const verticalContainerRef = useRef<HTMLElement | null>(null);
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

  const [isGanttReady, setIsGanttReady] = useState(false); // ★ 新しいstate

  // ★★★ tasksRef の代わりに localTasks state を使用 ★★★
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
  const saveScrollPosition = useCallback(() => {
    const ganttContainer = document.querySelector('.gantt-scroll-container') as HTMLElement;
    if (ganttContainer) {
      scrollPositionRef.current = {
        left: ganttContainer.scrollLeft,
        top: ganttContainer.scrollTop
      };
    }
  }, []);

  const restoreScrollPosition = useCallback(() => {
    const ganttContainer = document.querySelector('.gantt-scroll-container') as HTMLElement;
    if (ganttContainer && scrollPositionRef.current) {
      setTimeout(() => {
        ganttContainer.scrollLeft = scrollPositionRef.current?.left || 0;
        ganttContainer.scrollTop = scrollPositionRef.current?.top || 0;
      }, 50);
    }
  }, []);

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
    console.log("initialTasks prop changed, updating localTasks.");
    setLocalTasks(initialTasks); // ★★★ setLocalTasks を使用 ★★★
  }, [initialTasks]);

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
    const setupScrollContainers = () => {
      const horizontalContainer = document.querySelector('.gantt-horizontal-container');
      const verticalContainer = document.querySelector('.gantt-vertical-scroll-container');
      if (horizontalContainer) {
        const hContainer = horizontalContainer as HTMLElement;
        horizontalContainerRef.current = hContainer;
        window.ganttScrollRef.horizontal = hContainer;
        hContainer.style.overflowX = 'auto';
        hContainer.style.touchAction = 'pan-x';
      }
      if (verticalContainer) {
        const vContainer = verticalContainer as HTMLElement;
        verticalContainerRef.current = vContainer;
        window.ganttScrollRef.vertical = vContainer;
        vContainer.style.overflowY = 'auto';
        vContainer.style.touchAction = 'pan-y';
      }
    };
    setupScrollContainers();
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const horizontalContainer = horizontalContainerRef.current;
      const verticalContainer = verticalContainerRef.current;
      if (!horizontalContainer || !verticalContainer) {
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
          if (e.deltaY !== 0) verticalContainer.scrollTop += verticalStep;
        }
      });
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' ||
          document.activeElement?.tagName === 'TEXTAREA' ||
          (document.activeElement as HTMLElement)?.isContentEditable) {
        return;
      }
      const horizontalContainer = horizontalContainerRef.current;
      const verticalContainer = verticalContainerRef.current;
      if (!horizontalContainer || !verticalContainer) return;
      switch(e.key) {
        case 'ArrowLeft': e.preventDefault(); requestAnimationFrame(() => { horizontalContainer.scrollLeft -= 50; }); break;
        case 'ArrowRight': e.preventDefault(); requestAnimationFrame(() => { horizontalContainer.scrollLeft += 50; }); break;
        case 'ArrowUp': e.preventDefault(); requestAnimationFrame(() => { verticalContainer.scrollTop -= 30; }); break;
        case 'ArrowDown': e.preventDefault(); requestAnimationFrame(() => { verticalContainer.scrollTop += 30; }); break;
      }
    };
    const handleResize = () => { setupScrollContainers(); };
    window.scrollGanttLeft = (amount = 100) => { const c = horizontalContainerRef.current; if (c) requestAnimationFrame(() => { c.scrollLeft -= amount; }); };
    window.scrollGanttRight = (amount = 100) => { const c = horizontalContainerRef.current; if (c) requestAnimationFrame(() => { c.scrollLeft += amount; }); };
    window.scrollGanttUp = (amount = 50) => { const c = verticalContainerRef.current; if (c) requestAnimationFrame(() => { c.scrollTop -= amount; }); };
    window.scrollGanttDown = (amount = 50) => { const c = verticalContainerRef.current; if (c) requestAnimationFrame(() => { c.scrollTop += amount; }); };
    const ganttElement = document.querySelector('.gantt');
    if (ganttElement) ganttElement.addEventListener('wheel', handleWheel as EventListenerOrEventListenerObject, { passive: false, capture: true });
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    const cleanupData = { ganttElement, wheelHandler: handleWheel, keyHandler: handleKeyDown, resizeHandler: handleResize };
    window.__ganttCleanupData = cleanupData;
  }, []);

  const cleanupScrollHandlers = useCallback(() => {
    console.log('クリーンアップ: スクロールハンドラー');
    const cleanupData = window.__ganttCleanupData;
    if (!cleanupData) return;
    const { ganttElement, wheelHandler, keyHandler, resizeHandler } = cleanupData;
    if (ganttElement) ganttElement.removeEventListener('wheel', wheelHandler, { capture: true });
    document.removeEventListener('keydown', keyHandler);
    window.removeEventListener('resize', resizeHandler);
    window.scrollGanttLeft = () => {};
    window.scrollGanttRight = () => {};
    window.scrollGanttUp = () => {};
    window.scrollGanttDown = () => {};
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
  
  const dummyCallback = useCallback(() => {}, []); // 不変のダミー関数

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
        window.React.useEffect = function(effect: React.EffectCallback, deps?: React.DependencyList) {
          const stack = new Error().stack || '';
          if (stack.includes('TaskItem') || stack.includes('GanttContent')) {
            console.log('バックアップパッチ: ガントチャートコンポーネントのuseEffectを修正');
            return originalUseEffect(function() {
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
      window.React.useLayoutEffect = function(effect: React.EffectCallback, deps?: React.DependencyList) {
        const stack = new Error().stack || '';
        if (stack.includes('TaskItem') || stack.includes('GanttContent')) {
          console.log('TaskItemのuseLayoutEffectを修正');
          return originalUseLayoutEffect(function() {
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
        React.useEffect = function(effect: React.EffectCallback, deps?: React.DependencyList) {
          // エラースタックを取得して発信元をチェック
          const stack = new Error().stack || '';
          
          // ガントチャート関連コンポーネントからの呼び出しの場合
          if (stack.includes('TaskItem') || stack.includes('GanttContent')) {
            // 空の依存配列を強制
            return originalUseEffect(function() {
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
    
    // スクロールコンテナを見つけてスクロール可能にする
    const setupScrollContainers = () => {
      const horizontalContainer = document.querySelector('.gantt-horizontal-container');
      const verticalContainer = document.querySelector('.gantt-vertical-scroll-container');
      
      if (horizontalContainer) {
        const hContainer = horizontalContainer as HTMLElement;
        horizontalContainerRef.current = hContainer;
        window.ganttScrollRef.horizontal = hContainer;
        hContainer.style.overflowX = 'auto';
        hContainer.style.touchAction = 'pan-x';
      }
      
      if (verticalContainer) {
        const vContainer = verticalContainer as HTMLElement;
        verticalContainerRef.current = vContainer;
        window.ganttScrollRef.vertical = vContainer;
        vContainer.style.overflowY = 'auto';
        vContainer.style.touchAction = 'pan-y';
      }
    };
    
    // コンテナの初期設定
    setupScrollContainers();
    
    // ホイールイベントハンドラ - キャプチャフェーズで処理
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      const horizontalContainer = horizontalContainerRef.current;
      const verticalContainer = verticalContainerRef.current;
      
      if (!horizontalContainer || !verticalContainer) {
        // コンテナが見つからない場合は再取得を試みる
        setupScrollContainers();
        return;
      }
      
      const horizontalStep = e.deltaX * 0.8;
      const verticalStep = e.deltaY * 0.8;
      
      // requestAnimationFrameを使用してスムーズなスクロールを実現
      requestAnimationFrame(() => {
        // シフトキーが押されていると水平スクロールが優先
        if (e.shiftKey) {
          horizontalContainer.scrollLeft += verticalStep;
        } else {
          // 通常は垂直/水平の両方に対応
          if (e.deltaX !== 0) {
            horizontalContainer.scrollLeft += horizontalStep;
          }
          if (e.deltaY !== 0) {
            verticalContainer.scrollTop += verticalStep;
          }
        }
      });
    };
    
    // キーボードイベントハンドラ
    const handleKeyDown = (e: KeyboardEvent) => {
      // アクティブな要素がテキスト入力の場合はスキップ
      if (document.activeElement?.tagName === 'INPUT' || 
          document.activeElement?.tagName === 'TEXTAREA' || 
          (document.activeElement as HTMLElement)?.isContentEditable) {
        return;
      }
      
      const horizontalContainer = horizontalContainerRef.current;
      const verticalContainer = verticalContainerRef.current;
      
      if (!horizontalContainer || !verticalContainer) return;
      
      // 矢印キーによるスクロール
      switch(e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          requestAnimationFrame(() => {
            horizontalContainer.scrollLeft -= 50;
          });
          break;
        case 'ArrowRight':
          e.preventDefault();
          requestAnimationFrame(() => {
            horizontalContainer.scrollLeft += 50;
          });
          break;
        case 'ArrowUp':
          e.preventDefault();
          requestAnimationFrame(() => {
            verticalContainer.scrollTop -= 30;
          });
          break;
        case 'ArrowDown':
          e.preventDefault();
          requestAnimationFrame(() => {
            verticalContainer.scrollTop += 30;
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
      ganttElement.addEventListener('wheel', handleWheel as EventListenerOrEventListenerObject, { passive: false, capture: true });
    }
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    
    // イベントリスナーとコンテナの参照を保存（後でクリーンアップ用）
    const cleanupData = { ganttElement, wheelHandler: handleWheel, keyHandler: handleKeyDown, resizeHandler: handleResize }; // <<< resizeHandler を追加
    window.__ganttCleanupData = cleanupData; // <<< クリーンアップ関数から参照できるように window に保存
    
    // ★★★ クリーンアップ関数の中身を一時的にコメントアウト ★★★
    return () => {
      console.log('クリーンアップ: スクロールハンドラー (useEffect内) - 現在無効化中');
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

  // プロジェクト選択ハンドラー
  const handleProjectChange = (event: SelectChangeEvent<string>) => {
    setSelectedProjectId(event.target.value);
  };

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
  useEffect(() => {
    console.log("GanttView マウント: 最新データを取得します...");
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData]); // ★★★ fetchData を依存配列に追加 ★★★

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

    console.log('gtrTasks生成: プロジェクトID = ', selectedProjectId, ', localTasks数 =', localTasks.length);
    console.log("DEBUG: useMemo フィルタリング前: selectedProjectId=", selectedProjectId);
    console.log("DEBUG: useMemo フィルタリング前: localTasks=", JSON.stringify(localTasks.map(t => ({id: t.id, name: t.name, project_id: t.project_id, start_date: t.start_date, due_date: t.due_date, dependsOn: t.dependsOn})), null, 2));
    console.log("DEBUG: useMemo フィルタリング前: projects=", JSON.stringify(projects, null, 2)); // projects確認用
    console.log("DEBUG: useMemo フィルタリング前: users=", JSON.stringify(users, null, 2)); // users確認用

    // 1. プロジェクトフィルター
    const projectFilteredTasks = selectedProjectId === "all"
        ? localTasks
        : localTasks.filter(task => String(task.project_id) === String(selectedProjectId));
    console.log(`プロジェクトフィルタリング後 (${selectedProjectId}): ${projectFilteredTasks.length}個`);

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
    console.log(`[GanttView] gtrTasks useMemo: Mapped ${mappedTasks.length} tasks to GtrTasks, Final ${finalTasks.length} tasks after dependency validation.`, { selectedProjectId, localTasksLength: localTasks.length });

    if (finalTasks.length === 0 && projectFilteredTasks.length > 0) {
         console.warn('All tasks were filtered out during mapping/validation. Check date formats, start/end order, and dependencies.');
    }

    return finalTasks;
  }, [localTasks, selectedProjectId, projects, users, readOnly]); // ★★★ 依存配列から logEnabled を削除 ★★★

  // ★★★ フィルター処理用の useMemo (現状はダミー) ★★★
  const filteredTasks = useMemo(() => {
      let tempTasks = gtrTasks; // gtrTasks をベースにする
      // ここに実際のフィルターロジックを追加する
      // 例:
      // if (searchTerm) {
      //   tempTasks = tempTasks.filter(task => task.name.toLowerCase().includes(searchTerm.toLowerCase()));
      // }
      // if (selectedAssignee !== 'all') {
      //   tempTasks = tempTasks.filter(task => getUserName(task.assigneeId, users) === selectedAssignee) // assigneeId が必要
      // }
      console.log("Filtered tasks (currently same as mapped):", tempTasks.length);
      return tempTasks;
  }, [gtrTasks /* , searchTerm, selectedAssignee */]); // ★★★ 依存配列に gtrTasks とフィルター条件を追加 ★★★

  // メモ化したタスクリスト
  const memoizedGtrTasks = useMemo(() => {
    return [...gtrTasks];
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
              if (updatedTaskData.start_date) { try { normalizedStartDate = formatDate(parseISO(updatedTaskData.start_date), 'yyyy-MM-dd'); } catch(e){ console.error("Error parsing start_date..."); } }
              let normalizedDueDate: string | null = null;
              if (updatedTaskData.due_date) { try { normalizedDueDate = formatDate(parseISO(updatedTaskData.due_date), 'yyyy-MM-dd'); } catch(e){ console.error("Error parsing due_date..."); } }
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
  const handleTaskSelect: CustomSelectEventHandler = (task) => {
    console.log('Selected task:', task);
    // 選択状態の管理が必要な場合はここで実装
  };

  // カスタムタスクリストを使用するための関数
  const renderCustomTaskList = (listProps: any) => {
    return <CustomTaskList {...listProps} projectsData={projects} />;
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
        alert('変更はありませんでした。保存をスキップします。');
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
      alert(`タスク状態が正常に保存されました。${updatedCount}個のタスクが更新されました。`);
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
          alert('認証エラーが発生しました。再ログインが必要です。');
        } else if (error.response.status === 403) {
          alert('このアクションを実行する権限がありません。');
        } else {
          alert(`サーバーエラーが発生しました (${error.response.status}): ${error.response.data?.detail || 'エラー詳細不明'}`);
        }
      } else if (error.request) {
        alert('サーバーに接続できませんでした。ネットワーク接続を確認してください。');
      } else {
        alert(`エラーが発生しました: ${error.message}`);
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
        
      <Paper sx={{ p: 2, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1, flexShrink: 0 }}>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 'bold' }}>
            ガントチャート
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
          {/* プロジェクトフィルター */}
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel sx={{ fontSize: '0.7rem' }}>プロジェクト</InputLabel>
              <Select value={selectedProjectId} label="プロジェクト" onChange={handleProjectChange} sx={{ fontSize: '0.7rem' }}>
                <MenuItem value="all" sx={{ fontSize: '0.7rem' }}>全プロジェクト</MenuItem>
                {projects.map((project: Project) => (
                  <MenuItem key={project.id} value={project.id} sx={{ fontSize: '0.7rem' }}>{project.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
            {/* 表示モード選択 */}
            <FormControl size="small" sx={{ minWidth: 90 }}>
              <InputLabel sx={{ fontSize: '0.7rem' }}>表示</InputLabel>
              <Select value={viewMode} label="表示" onChange={handleViewModeChange} sx={{ fontSize: '0.7rem' }}>
                <MenuItem value={ViewMode.Day} sx={{ fontSize: '0.7rem' }}>日</MenuItem>
                <MenuItem value={ViewMode.Week} sx={{ fontSize: '0.7rem' }}>週</MenuItem>
                <MenuItem value={ViewMode.Month} sx={{ fontSize: '0.7rem' }}>月</MenuItem>
              </Select>
            </FormControl>
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
            {/* ★★★ ここまで ★★★ */}
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
            }}
            ref={ganttContainerRef} // Ref を設定
          >
            {isLoadingData || !isGanttReady ? ( // ★ isGanttReady も条件に追加
              <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                <CircularProgress />
            </Box>
            ) : (
              // ★★★ デバッグログ追加: Ganttに渡すcolumnWidthを確認 ★★★
              console.log(`DEBUG: Rendering MemoizedGantt with columnWidth=${currentColumnWidth}`),
              // ★★★ ここまで ★★★
              <MemoizedGantt // Memoizedコンポーネントを使用
                key="stable-gantt-key" // ★★★ 安定したキーを試す ★★★
                tasks={memoizedGtrTasks} // メモ化されたタスク
                viewMode={viewMode}
                viewDate={new Date()} // ★ 再度追加: 今日の日付を指定
                listCellWidth={listCellWidth}
                columnWidth={currentColumnWidth} // ★★★ state を使用 ★★★
                ganttHeight={400}
                fontFamily='"Roboto", "Helvetica", "Arial", sans-serif'
                fontSize='0.65rem' // ★★★ Set base font size (adjust from 0.75rem) ★★★

                // Styling options (more granular control)
                headerHeight={45} // ヘッダー高さ調整
              rowHeight={30}
                barCornerRadius={3}
                barFill={75} // バーの塗りつぶし率
                // barProgressColor="#a3a3ff" // スタイルは getTaskStyle で設定
                // barProgressSelectedColor="#8282f3"
                handleWidth={8}
                onDateChange={handleGanttDateChangeEvent}
                onProgressChange={handleProgressChange as any} // 型互換性のためのanyキャスト
                onDoubleClick={handleTaskDoubleClick}
                onSelect={handleTaskSelect}
              TaskListHeader={CustomTaskListHeader} 
              TaskListTable={renderCustomTaskList}
              />
            )}
          </div>
      </Paper>
    </ColumnWidthContext.Provider>
  );
  }
);

// コンポーネント全体をメモ化して最適化
export default GanttView; // ★★★ この行を残す ★★★