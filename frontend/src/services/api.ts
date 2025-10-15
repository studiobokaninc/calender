import axios from 'axios';
import { MockDataImport, TaskCreate } from '../types'; // ★★★ MockDataImport 型をインポート ★★★

// APIクライアントの設定
const baseURL = '/api'; // 相対パスに変更
const api = axios.create({
  baseURL,
  timeout: 30000, // タイムアウトを30秒に延長
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // ← これを追加
});

// グローバル認証エラーコールバック（アプリ全体で一貫した認証エラー処理のため）
type AuthErrorCallback = () => void;
let globalAuthErrorCallback: AuthErrorCallback | null = null;

// 認証エラーコールバックの設定関数
export const setAuthErrorCallback = (callback: AuthErrorCallback) => {
  globalAuthErrorCallback = callback;
};

// ★★★ リクエストインターセプター - ログを追加して認証を確認 ★★★
api.interceptors.request.use(
  (config) => {
    // APIリクエスト情報をログ出力（デバッグ用）
    console.log(`Request: ${config.method?.toUpperCase()} ${config.url}`);
    
    // トークンが存在すれば、リクエストヘッダーに追加
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    } else {
      console.warn('トークンがありません - 認証なしでリクエストを送信');
    }
    
    return config;
  },
  (error) => {
    console.error('Request interceptor error:', error);
    return Promise.reject(error);
  }
);

// ★★★ レスポンスインターセプター - より詳細なエラーログを追加 ★★★
api.interceptors.response.use(
  (response) => {
    console.log(`Response: ${response.status} ${response.config.url}`);
    return response;
  },
  (error) => {
    // エラーの詳細情報をログ出力
    console.error('Response Error Interceptor:', error);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Response data:', error.response.data);
      
      // 422エラーの場合、バリデーションエラーの詳細を表示
      if (error.response.status === 422) {
        const validationErrors = error.response.data.detail;
        if (Array.isArray(validationErrors)) {
          const errorMessages = validationErrors.map(err => {
            if (typeof err === 'object' && err.loc && err.msg) {
              return `${err.loc.join('.')}: ${err.msg}`;
            }
            return err;
          }).join('\n');
          error.message = `バリデーションエラー:\n${errorMessages}`;
        } else if (typeof validationErrors === 'string') {
          error.message = validationErrors;
        }
      }
      
      // 401エラーの場合、ログアウト処理（トークン無効の場合）
      if (error.response.status === 401) {
        console.warn('認証エラー - トークンを削除します');
        localStorage.removeItem('token');
        
        // グローバル認証エラーコールバックが設定されていれば呼び出し
        if (globalAuthErrorCallback) {
          console.log('認証エラーコールバックを実行します');
          globalAuthErrorCallback();
        } else {
          console.warn('認証エラーが発生しましたが、グローバルコールバックが設定されていません');
        }
      }
    }
    return Promise.reject(error);
  }
);

// モックデータのインポート/エクスポート関連の機能
export const mockDataApi = {
  // モックデータのエクスポート（全データ）
  exportMockData: async () => {
    try {
      const response = await api.post('/admin/mock-data/export');
      return response.data;
    } catch (error) {
      console.error('モックデータのエクスポートに失敗しました:', error);
      throw error;
    }
  },

  // モックデータのインポート（全データ）
  importMockData: async (data: any) => {
    try {
      const response = await api.post('/admin/mock-data/import', data);
      return response.data;
    } catch (error) {
      console.error('モックデータのインポートに失敗しました:', error);
      throw error;
    }
  },

  // ユーザーデータのみをエクスポート
  exportUserData: async () => {
    try {
      const response = await api.post('/admin/mock-data/export');
      // 全データから必要な部分だけを抽出
      const { users } = response.data;
      return { users };
    } catch (error) {
      console.error('ユーザーデータのエクスポートに失敗しました:', error);
      throw error;
    }
  },

  // イベントデータのみをエクスポート
  exportEventData: async () => {
    try {
      const response = await api.post('/admin/mock-data/export');
      // 全データから必要な部分だけを抽出
      const { events } = response.data;
      return { events };
    } catch (error) {
      console.error('イベントデータのエクスポートに失敗しました:', error);
      throw error;
    }
  },

  // ユーザーデータとイベントデータを結合してインポート
  importCombinedData: async (userData: any, eventData: any) => {
    try {
      // 現在のデータを取得
      const currentData = await mockDataApi.exportMockData();
      
      // 更新データを準備（結合）
      const combinedData = {
        ...currentData,
        // ユーザーデータとイベントデータで上書き
        ...(userData.users ? { users: userData.users } : {}),
        ...(eventData.events ? { events: eventData.events } : {})
      };
      
      // 結合したデータをインポート
      const response = await api.post('/admin/mock-data/import', combinedData);
      return response.data;
    } catch (error) {
      console.error('データのインポートに失敗しました:', error);
      throw error;
    }
  },

  // CSVデータのインポート
  importCsvData: async (formData: FormData) => {
    try {
      const response = await api.post('/admin/mock-data/import-csv', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error) {
      console.error('CSVデータのインポートに失敗しました:', error);
      throw error;
    }
  },

  // プロジェクト名からIDへのマッピングを取得
  getProjectMapping: async () => {
    try {
      const response = await api.get('/admin/projects/mapping');
      return response.data;
    } catch (error) {
      console.error('プロジェクトマッピングの取得に失敗しました:', error);
      throw error;
    }
  },

  // プロジェクト削除
  deleteProject: async (projectId: number) => {
    try {
      const response = await api.delete(`/projects/${projectId}`);
      return response.data;
    } catch (error) {
      console.error('プロジェクトの削除に失敗しました:', error);
      throw error;
    }
  },
};

// --- モックデータ管理API ---

/**
 * 全てのモックデータ（ユーザー、プロジェクト、タスク等）をエクスポートします。
 * 要管理者権限。
 */
export const exportMockData = async (): Promise<MockDataImport> => {
  try {
    const response = await api.post<MockDataImport>('/admin/mock-data/export');
    return response.data;
  } catch (error) {
    console.error('Error exporting mock data:', error);
    throw error; // エラーを呼び出し元に伝える
  }
};

/**
 * モックデータをインポートします。
 * 要管理者権限。
 * @param data インポートするデータ (MockDataImport形式)
 */
export const importMockData = async (data: MockDataImport): Promise<any> => {
  try {
    // バリデーションは辞書ベースを要求するため、変換せずそのまま送信
    const response = await api.post('/admin/mock-data/import', data);
    return response.data;
  } catch (error) {
    console.error('Error importing mock data:', error);
    throw error;
  }
};

export async function fetchUsers() {
  const response = await api.get('/api/users');
  return response.data;
}

export async function fetchTasks() {
  const response = await api.get('/tasks');
  return response.data;
}

export async function fetchProjects() {
  const response = await api.get('/projects');
  return response.data;
}

export async function fetchGroups() {
  const response = await api.get('/api/groups');
  return response.data;
}

export async function fetchEvents() {
  const response = await api.get('/calendar/events');
  return response.data;
}

export default api; 

// --- Chat API ---
export const chatApi = {
  send: async (query: string): Promise<{ answer: string; conversation_id?: string; message_id?: string }> => {
    const res = await api.post('/chat', { query })
    return res.data
  },
}