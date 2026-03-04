import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { GridSortModel } from '@mui/x-data-grid';

// ページごとの状態を管理する型定義
interface PageStates {
  tasks: {
    statusFilter: string;
    projectFilter: string;
    assigneeFilter: string;
    paginationModel: {
      page: number;
      pageSize: number;
    };
    sortModel: GridSortModel;
  };
  metrics: {
    selectedTab: number;
    dateRange: string;
    projectNameFilter: string | null;
    statusFilter: string;
    selectedDisplayStatuses: string[];
  };
  projects: {
    // プロジェクトページの状態があれば追加
  };
  calendar: {
    viewType: string;
    selectedDate: string | null;
    selectedEvent: any | null;
    filterStatus: string;
    filterProject: string;
    filterAssignee: string;
    /** 表示する予定の種類（キー: project/task/milestone/deadline/meeting/workshop/generic） */
    eventTypeFilter: Record<string, boolean>;
  };
  dashboard: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    conversationId: string | null;
    currentMessageId: string | null;
  };
  notes: {
    selectedProjectId: number | null | 'other';
  };
}

/** ダッシュボードチャットの最初のメッセージ（唯一の定義場所） */
export const DASHBOARD_WELCOME_MESSAGE: { role: 'assistant'; content: string } = {
  role: 'assistant',
  content: 'タスクについてお気軽にご相談ください！',
};

// デフォルト状態
const defaultStates: PageStates = {
  tasks: {
    statusFilter: '',
    projectFilter: '',
    assigneeFilter: '',
    paginationModel: {
      page: 0,
      pageSize: 15,
    },
    sortModel: [],
  },
  metrics: {
    selectedTab: 0,
    dateRange: 'all',
    projectNameFilter: null,
    statusFilter: 'all',
    selectedDisplayStatuses: [],
  },
  projects: {},
  calendar: {
    viewType: 'dayGridMonth',
    selectedDate: null,
    selectedEvent: null,
    filterStatus: 'all',
    filterProject: '',
    filterAssignee: '',
    eventTypeFilter: {
      project: false,
      task: true,
      milestone: true,
      deadline: true,
      meeting: true,
      workshop: true,
      generic: true,
    },
  },
  dashboard: {
    messages: [DASHBOARD_WELCOME_MESSAGE],
    conversationId: null,
    currentMessageId: null,
  },
  notes: {
    selectedProjectId: 'other',
  },
};

// グローバルデータ状態
export interface GlobalDataState {
  tasks: any[];
  projects: any[];
  users: any[];
  groups: any[];
  events: any[];
  lastFetched: number;
}

// Context型定義
interface PageStateContextType {
  pageStates: PageStates;
  updatePageState: <K extends keyof PageStates>(
    page: K,
    updates: Partial<PageStates[K]>
  ) => void;
  resetPageState: (page: keyof PageStates) => void;
  isInitialLoad: boolean;
  globalData: GlobalDataState;
  updateGlobalData: (data: Partial<GlobalDataState>) => void;
  refreshGlobalData: () => Promise<void>;
}

const PageStateContext = createContext<PageStateContextType | undefined>(undefined);

// ブラウザ更新を検知するためのフラグ
const SESSION_STORAGE_KEY = 'page_state_initialized';
const REFRESH_FLAG_KEY = 'page_state_refresh_flag';

interface PageStateProviderProps {
  children: ReactNode;
}

export const PageStateProvider: React.FC<PageStateProviderProps> = ({ children }) => {
  const [pageStates, setPageStates] = useState<PageStates>(defaultStates);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [globalData, setGlobalData] = useState<GlobalDataState>({
    tasks: [],
    projects: [],
    users: [],
    groups: [],
    events: [],
    lastFetched: 0,
  });

  useEffect(() => {
    // セッションストレージに保存された状態があれば常に復元し、なければデフォルトを使用
    try {
      const savedStates = sessionStorage.getItem('page_states');
      if (savedStates) {
        const parsedStates = JSON.parse(savedStates);
        console.log('Restoring saved states:', parsedStates);
        setPageStates(parsedStates);
      } else {
        setPageStates(defaultStates);
      }
      sessionStorage.setItem(SESSION_STORAGE_KEY, 'true');
      sessionStorage.removeItem(REFRESH_FLAG_KEY);
    } catch (error) {
      console.error('Failed to restore page states:', error);
      setPageStates(defaultStates);
    } finally {
      setIsInitialLoad(false);
    }
  }, []);

  // ブラウザ更新を検知するためのイベントリスナー
  useEffect(() => {
    const handleBeforeUnload = (_event: BeforeUnloadEvent) => {
      // ページが更新される前にフラグを設定
      console.log('Before unload - setting refresh flag');
      sessionStorage.setItem(REFRESH_FLAG_KEY, 'true');
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      // ページが表示される際に、キャッシュから復元された場合はフラグを設定
      console.log('Page show event:', { persisted: event.persisted });
      if (event.persisted) {
        sessionStorage.setItem(REFRESH_FLAG_KEY, 'true');
      }
    };

    const handleVisibilityChange = () => {
      // ページが非表示になった時にフラグを設定（ブラウザ更新の可能性）
      if (document.visibilityState === 'hidden') {
        console.log('Page hidden - setting refresh flag');
        sessionStorage.setItem(REFRESH_FLAG_KEY, 'true');
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // 状態更新時にsessionStorageに保存
  useEffect(() => {
    if (!isInitialLoad) {
      sessionStorage.setItem('page_states', JSON.stringify(pageStates));
    }
  }, [pageStates, isInitialLoad]);

  const updatePageState = useCallback(<K extends keyof PageStates>(
    page: K,
    updates: Partial<PageStates[K]>
  ) => {
    setPageStates(prev => {
      const newPageState = {
        ...prev[page],
        ...updates,
      };

      // 状態が実際に変更された場合のみ更新
      if (JSON.stringify(prev[page]) !== JSON.stringify(newPageState)) {
        return {
          ...prev,
          [page]: newPageState,
        };
      }

      return prev;
    });
  }, []);

  const resetPageState = (page: keyof PageStates) => {
    setPageStates(prev => ({
      ...prev,
      [page]: defaultStates[page],
    }));
  };

  const updateGlobalData = useCallback((data: Partial<GlobalDataState>) => {
    setGlobalData(prev => ({
      ...prev,
      ...data,
      lastFetched: Date.now(),
    }));
  }, []);

  const refreshGlobalData = useCallback(async () => {
    try {
      console.log('[PageStateContext] Starting global data refresh...');

      // データを再取得するためのAPI呼び出し
      const { fetchTasks, fetchProjects, fetchUsers, fetchGroups } = await import('../services/api');

      const [tasks, projects, users, groups] = await Promise.all([
        fetchTasks(),
        fetchProjects(),
        fetchUsers(),
        fetchGroups()
      ]);

      console.log('[PageStateContext] Fetched data:', {
        tasks: tasks.length,
        projects: projects.length,
        users: users.length,
        groups: groups.length
      });

      updateGlobalData({
        tasks,
        projects,
        users,
        groups,
        events: [], // イベントは各ページで生成されるため空配列
        lastFetched: Date.now(),
      });

      console.log('[PageStateContext] Global data updated successfully');

      // カスタムイベントを発火して、各ページにデータ更新を通知
      console.log('[PageStateContext] Dispatching globalDataRefreshed event with data:', {
        tasks: tasks.length,
        projects: projects.length,
        users: users.length,
        groups: groups.length
      });
      window.dispatchEvent(new CustomEvent('globalDataRefreshed', {
        detail: { tasks, projects, users, groups }
      }));
    } catch (error) {
      console.error('Failed to refresh global data:', error);
    }
  }, [updateGlobalData]);

  const value: PageStateContextType = {
    pageStates,
    updatePageState,
    resetPageState,
    isInitialLoad,
    globalData,
    updateGlobalData,
    refreshGlobalData,
  };

  return (
    <PageStateContext.Provider value={value}>
      {children}
    </PageStateContext.Provider>
  );
};

// カスタムフック
export const usePageState = () => {
  const context = useContext(PageStateContext);
  if (context === undefined) {
    throw new Error('usePageState must be used within a PageStateProvider');
  }
  return context;
};

// ページごとの専用フック
export const useTasksPageState = () => {
  const { pageStates, updatePageState, isInitialLoad, globalData, updateGlobalData } = usePageState();

  const updateTasksState = useCallback((updates: Partial<PageStates['tasks']>) => {
    updatePageState('tasks', updates);
  }, [updatePageState]);

  return {
    tasksState: pageStates.tasks,
    updateTasksState,
    isInitialLoad,
    globalData,
    updateGlobalData,
  };
};

export const useMetricsPageState = () => {
  const { pageStates, updatePageState, isInitialLoad, globalData, updateGlobalData } = usePageState();

  const updateMetricsState = useCallback((updates: Partial<PageStates['metrics']>) => {
    updatePageState('metrics', updates);
  }, [updatePageState]);

  return {
    metricsState: pageStates.metrics,
    updateMetricsState,
    isInitialLoad,
    globalData,
    updateGlobalData,
  };
};

export const useCalendarPageState = () => {
  const { pageStates, updatePageState, isInitialLoad, globalData, updateGlobalData } = usePageState();

  const updateCalendarState = useCallback((updates: Partial<PageStates['calendar']>) => {
    updatePageState('calendar', updates);
  }, [updatePageState]);

  return {
    calendarState: pageStates.calendar,
    updateCalendarState,
    isInitialLoad,
    globalData,
    updateGlobalData,
  };
};

export const useDashboardPageState = () => {
  const { pageStates, updatePageState, isInitialLoad, globalData, updateGlobalData } = usePageState();

  const updateDashboardState = useCallback((updates: Partial<PageStates['dashboard']>) => {
    updatePageState('dashboard', updates);
  }, [updatePageState]);

  return {
    dashboardState: pageStates.dashboard,
    updateDashboardState,
    isInitialLoad,
    globalData,
    updateGlobalData,
  };
};
