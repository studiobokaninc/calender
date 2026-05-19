/**
 * Google カレンダー連携ロジックを CalendarPage.tsx から分離したカスタムフック
 */
import { useState, useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

interface GoogleStatus {
    configured: boolean;
    connected: boolean;
    synced_task_ids: number[];
    synced_event_ids: number[];
}

interface GoogleSnackbar {
    open: boolean;
    message: string;
    severity: 'success' | 'error';
}

const INITIAL_STATUS: GoogleStatus = {
    configured: false,
    connected: false,
    synced_task_ids: [],
    synced_event_ids: [],
};

export const useGoogleCalendar = () => {
    const { user } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();

    const [googleStatus, setGoogleStatus] = useState<GoogleStatus>(INITIAL_STATUS);
    const [googleSnackbar, setGoogleSnackbar] = useState<GoogleSnackbar>({
        open: false,
        message: '',
        severity: 'success',
    });

    // 連携状態の取得
    const fetchGoogleStatus = useCallback(async () => {
        try {
            const res = await api.get<GoogleStatus>('/google/status');
            setGoogleStatus({
                configured: res.data.configured,
                connected: res.data.connected,
                synced_task_ids: res.data.synced_task_ids ?? [],
                synced_event_ids: res.data.synced_event_ids ?? [],
            });
        } catch {
            setGoogleStatus(INITIAL_STATUS);
        }
    }, []);

    useEffect(() => {
        fetchGoogleStatus();
    }, [fetchGoogleStatus]);

    // OAuth コールバック後のメッセージ処理
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const google = params.get('google');
        if (google !== 'connected' && google !== 'error') return;

        if (google === 'connected') {
            const isSyncDisabled = user?.role === 'admin';
            const msg = isSyncDisabled
                ? 'Google カレンダーと連携しました。管理者はタスク一覧から個別に同期対象を選択できます。'
                : 'Google カレンダーと連携しました。あなたに関連するタスク・プロジェクト・イベントが自動で同期されました！';
            setGoogleSnackbar({ open: true, message: msg, severity: 'success' });
        } else {
            const reason = params.get('reason');
            const reasonMessages: Record<string, string> = {
                missing_params: '認証パラメータが不足しています。',
                invalid_state: '認証状態が無効です。再度お試しください。',
                token_exchange_failed: 'トークンの交換に失敗しました。',
                token_exchange_exception: 'トークンの交換中にエラーが発生しました。',
                save_failed: 'トークンの保存に失敗しました。',
            };
            const detail = reason ? (reasonMessages[reason] || `理由: ${reason}`) : '';
            setGoogleSnackbar({
                open: true,
                message: `Google カレンダーとの連携に失敗しました。${detail}`,
                severity: 'error',
            });
        }
        navigate('/calendar', { replace: true });
    }, [location.search, navigate, user]);

    // 連携開始
    const handleGoogleConnect = useCallback(async () => {
        try {
            const res = await api.get<{ url: string }>('/google/authorize');
            if (res.data?.url) {
                window.location.href = res.data.url;
            } else {
                setGoogleSnackbar({ open: true, message: 'Google認証URLの取得に失敗しました', severity: 'error' });
            }
        } catch (err: any) {
            const msg = err?.response?.data?.detail || err?.message || 'Google 連携の開始に失敗しました';
            setGoogleSnackbar({ open: true, message: `Google連携エラー: ${msg}`, severity: 'error' });
        }
    }, []);

    // 同期トグル（イベント単位）
    const handleGoogleSyncEventToggle = useCallback(async (eventId: number, currentSynced: boolean) => {
        try {
            await api.post(`/google/sync/event/${eventId}`, { sync: !currentSynced });
            await fetchGoogleStatus();
            setGoogleSnackbar({
                open: true,
                message: currentSynced ? 'Google カレンダーから解除しました' : 'Google カレンダーに追加しました',
                severity: 'success',
            });
        } catch (err: any) {
            const msg = err?.response?.data?.detail || err?.message || '同期の更新に失敗しました';
            setGoogleSnackbar({ open: true, message: `Google同期エラー: ${msg}`, severity: 'error' });
        }
    }, [fetchGoogleStatus]);

    // 連携解除
    const handleGoogleDisconnect = useCallback(async () => {
        try {
            await api.delete('/google/disconnect');
            await fetchGoogleStatus();
            setGoogleSnackbar({ open: true, message: 'Google 連携を解除しました', severity: 'success' });
        } catch (err: any) {
            const msg = err?.response?.data?.detail || err?.message || 'Google 連携の解除に失敗しました';
            setGoogleSnackbar({ open: true, message: `Google連携解除エラー: ${msg}`, severity: 'error' });
        }
    }, [fetchGoogleStatus]);

    const closeSnackbar = useCallback(() => {
        setGoogleSnackbar(prev => ({ ...prev, open: false }));
    }, []);

    return {
        googleStatus,
        googleSnackbar,
        closeSnackbar,
        handleGoogleConnect,
        handleGoogleSyncEventToggle,
        handleGoogleDisconnect,
    };
};
