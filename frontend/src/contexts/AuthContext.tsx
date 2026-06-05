import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import api from '../services/api';

interface User {
  id: string | number;
  username: string;
  full_name?: string;
  role?: string;
  email?: string;
  // Add other user properties if needed
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState<boolean>(true); // Check initial auth status

  // 初期認証状態のチェック - 画面表示時にトークンがあれば自動ログイン
  useEffect(() => {
    const checkAuthStatus = async () => {
      console.log("Checking auth status...");
      const storedToken = localStorage.getItem('token');
      
      try {
        if (storedToken) {
          console.log("Token found in localStorage, validating...");
          setToken(storedToken);
          
          try {
            // Verify token by fetching user data
            console.log("Calling /users/me endpoint...");
            const response = await api.get<User>('/users/me', { timeout: 10000 });
            console.log("User info retrieved successfully:", response.data);
            setUser(response.data);
          } catch (error: any) {
            console.error('Failed to verify token or fetch user:', error);
            console.error('Error details:', {
              code: error.code,
              message: error.message,
              response: error.response?.data,
              status: error.response?.status,
            });
            
            // タイムアウトエラーまたはネットワークエラーの場合
            if (error.code === 'ECONNABORTED' || 
                error.message?.includes('timeout') ||
                error.code === 'ERR_NETWORK' ||
                error.message?.includes('Network Error')) {
              console.warn('サーバーへの接続に失敗しました。バックエンドサーバーが起動しているか確認してください。');
              // トークンは保持（サーバーが起動したら再認証できるように）
            } else if (error.response?.status === 401 || error.response?.status === 403) {
              // 認証エラーの場合はトークンを削除
              console.warn('認証エラー: トークンを削除します');
              localStorage.removeItem('token');
              setToken(null);
              setUser(null);
            } else {
              // その他のエラーもトークンを削除（サーバーエラーなど）
              console.warn('予期しないエラー: トークンを削除します');
              localStorage.removeItem('token');
              setToken(null);
              setUser(null);
            }
          }
        } else {
          console.log("No token found in localStorage");
          // No token found
          setUser(null);
          setToken(null);
        }
      } catch (error: any) {
        console.error('Unexpected error in checkAuthStatus:', error);
        setUser(null);
        setToken(null);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuthStatus();
  }, []);

  const login = async (username: string, password: string) => {
    try {
      console.log(`Attempting login for user: ${username}`);
      
      // URLSearchParamsを使用して適切な形式のフォームデータを作成
      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', password);
      
      console.log(`Sending login request to: ${api.defaults.baseURL}/auth/token`);
      
      const response = await api.post<{ access_token: string; token_type: string }>(
        '/auth/token',
        formData.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );

      console.log("Login successful, token received");
      const { access_token } = response.data;
      
      // 受け取ったトークンをローカルストレージに保存
      localStorage.setItem('token', access_token);
      setToken(access_token);

      // ユーザー情報の取得
      console.log("Fetching user info...");
      const userResponse = await api.get<User>('/users/me');
      const userData = userResponse.data;
      
      console.log("User data retrieved:", userData);
      setUser(userData);

      return;
    } catch (error: any) {
      console.error('Login failed:', error);
      
      // エラーの詳細情報をログ出力
      if (error.response) {
        console.error(`Status: ${error.response.status}`);
        console.error('Response data:', error.response.data);
      }
      
      // 既存のトークンをクリア
      localStorage.removeItem('token');
      setToken(null);
      setUser(null);
      
      // タイムアウトエラーの場合
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        throw new Error('サーバーに接続できません。バックエンドサーバーが起動しているか確認してください。');
      }
      
      // ネットワークエラーの場合
      if (error.code === 'ERR_NETWORK' || error.message?.includes('Network Error')) {
        throw new Error('ネットワークエラーが発生しました。サーバーに接続できません。');
      }
      
      // Rethrow for UI error handling
      throw new Error(error.response?.data?.detail || 'ログインに失敗しました。ユーザー名またはパスワードを確認してください。');
    }
  };

  const logout = () => {
    console.log("Logging out...");
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    // Optionally redirect to login page
    window.location.href = '/login';
  };

  // トークンとユーザー情報の両方があれば認証済みとみなす
  const isAuthenticated = !!token && !!user;

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 