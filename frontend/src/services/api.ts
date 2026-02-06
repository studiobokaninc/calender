import axios from 'axios';
import { MockDataImport, TaskCreate, NoteCreate, NoteUpdate } from '../types';

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

// ★★★ リクエストインターセプター - 認証を確認 ★★★
api.interceptors.request.use(
  (config) => {
    // FormDataを使用する場合、Content-Typeを自動設定するため、手動で設定しない
    if (config.data instanceof FormData) {
      // FormDataの場合、Content-Typeヘッダーを削除（ブラウザが自動設定）
      // axiosのheadersオブジェクトからContent-Typeを削除
      if (config.headers) {
        delete config.headers['Content-Type'];
        // または、delete演算子で削除
        if ('Content-Type' in config.headers) {
          delete (config.headers as any)['Content-Type'];
        }
      }
    }
    
    // トークンが存在すれば、リクエストヘッダーに追加
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// ★★★ レスポンスインターセプター - エラー処理 ★★★
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response) {
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
      // チャットのタスクアクションの 401 はログアウトせず、Dashboard でメッセージ表示する
      const requestUrl = error.config?.url ?? '';
      const isChatAction = String(requestUrl).includes('chat/actions/task');
      if (error.response.status === 401 && !isChatAction) {
        localStorage.removeItem('token');
        if (globalAuthErrorCallback) {
          globalAuthErrorCallback();
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
      throw error;
    }
  },

  // モックデータのインポート（全データ）
  importMockData: async (data: any) => {
    try {
      const response = await api.post('/admin/mock-data/import', data);
      return response.data;
    } catch (error) {
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
      throw error;
    }
  },

  // プロジェクト名からIDへのマッピングを取得
  getProjectMapping: async () => {
    try {
      const response = await api.get('/admin/projects/mapping');
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // プロジェクト削除
  deleteProject: async (projectId: number) => {
    try {
      const response = await api.delete(`/projects/${projectId}`);
      return response.data;
    } catch (error) {
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

// --- Notes API ---
export const notesApi = {
  // メモ一覧を取得（プロジェクトフィルター対応）
  getNotes: async (skip: number = 0, limit: number = 100, projectId?: number | null) => {
    const params = new URLSearchParams({ skip: skip.toString(), limit: limit.toString() })
    if (projectId !== undefined && projectId !== null && typeof projectId === 'number') {
      // 数値のプロジェクトIDの場合
      params.append('project_id', projectId.toString())
    } else if (projectId === null) {
      // projectIdが明示的にnullの場合、「その他」（project_idがnullのメモ）を取得
      params.append('project_id_is_null', 'true')
    }
    // projectIdがundefinedの場合は何も追加しない（全件取得）
    const response = await api.get(`/notes?${params.toString()}`)
    return response.data
  },

  // メモを取得
  getNote: async (noteId: number) => {
    const response = await api.get(`/notes/${noteId}`)
    return response.data
  },

  // メモを作成
  createNote: async (note: NoteCreate) => {
    const response = await api.post('/notes', note)
    return response.data
  },

  // メモを更新
  updateNote: async (noteId: number, note: NoteUpdate) => {
    const response = await api.put(`/notes/${noteId}`, note)
    return response.data
  },

  // メモを削除
  deleteNote: async (noteId: number) => {
    const response = await api.delete(`/notes/${noteId}`)
    return response.data
  },

  // 画像をアップロード
  uploadImage: async (file: File): Promise<{ url: string }> => {
    const formData = new FormData()
    formData.append('file', file)
    const headers: any = {}
    const response = await api.post('/notes/upload-image', formData, {
      headers,
    })
    return response.data
  },

  // PDFをアップロード
  uploadPdf: async (file: File): Promise<{ url: string }> => {
    const formData = new FormData()
    formData.append('file', file)
    const headers: any = {}
    const response = await api.post('/notes/upload-pdf', formData, {
      headers,
    })
    return response.data
  },
}

// --- UserActivity API ---
export const userActivityApi = {
  // アクティビティを記録
  recordActivity: async () => {
    const response = await api.post('/api/user-activities', {})
    return response.data
  },

  // アクティビティを取得
  getActivities: async (params?: { user_id?: number; cycle_date?: string }) => {
    const response = await api.get('/api/user-activities', { params })
    return response.data
  },
}