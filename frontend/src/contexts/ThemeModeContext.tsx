import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { useAuth } from './AuthContext';

type ThemeMode = 'light' | 'dark';

interface ThemeModeContextType {
  mode: ThemeMode;
  toggleMode: () => void;
}

const ThemeModeContext = createContext<ThemeModeContextType | undefined>(undefined);

const STORAGE_KEY_PREFIX = 'calendar_theme_mode_';

const getStorageKey = (userId: string | number | null): string => {
  return userId != null ? `${STORAGE_KEY_PREFIX}${userId}` : `${STORAGE_KEY_PREFIX}guest`;
};

const readModeFromStorage = (storageKey: string): ThemeMode => {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
    // システム設定を初期値にする
    const prefersDark = window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

interface ThemeModeProviderProps {
  children: ReactNode;
}

export const ThemeModeProvider: React.FC<ThemeModeProviderProps> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const storageKey = getStorageKey(userId);

  const [mode, setMode] = useState<ThemeMode>(() => readModeFromStorage(storageKey));

  // ユーザー切り替え時（ログイン/ログアウト）に、そのユーザーの保存済みテーマを読み込む
  useEffect(() => {
    setMode(readModeFromStorage(storageKey));
  }, [storageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, mode);
    } catch {
      // localStorage が使えない場合は何もしない
    }

    // body に現在のテーマ属性を付与（外部CSSの上書き用）
    try {
      document.body.setAttribute('data-theme', mode);
    } catch {
      // サーバーサイドや古いブラウザ環境では無視
    }
  }, [mode, storageKey]);

  const toggleMode = useCallback(() => {
    setMode(prev => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode,
          ...(mode === 'dark'
            ? {
                background: {
                  default: '#121212',
                  paper: '#1e1e1e',
                },
              }
            : {}),
        },
        components: {
          MuiPaper: {
            styleOverrides: {
              root: {
                borderRadius: 8,
              },
            },
          },
        },
      }),
    [mode],
  );

  const value: ThemeModeContextType = useMemo(
    () => ({
      mode,
      toggleMode,
    }),
    [mode, toggleMode],
  );

  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
};

export const useThemeMode = (): ThemeModeContextType => {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) {
    throw new Error('useThemeMode must be used within a ThemeModeProvider');
  }
  return ctx;
};

