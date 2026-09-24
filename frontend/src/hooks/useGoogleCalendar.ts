/**
 * Google カレンダー連携ロジックを CalendarPage.tsx から分離したカスタムフック
 */
import { useState, useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api';

interface GoogleStatus {
    configured: boolean;
    shared_account_connected: boolean;
    shared_account_email: string | null;
    shared_account_error: string | null;
    my_calendar_connected: boolean;
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
    shared_account_connected: false,
    shared_account_email: null,
    shared_account_error: null,
    my_calendar_connected: false,
    synced_task_ids: [],
    synced_event_ids: [],
};

export const useGoogleCalendar = () => {
    const location = useLocation();
    const navigate = useNavigate();

    const [googleStatus, setGoogleStatus] = useState<GoogleStatus>(INITIAL_STATUS);
    const [connecting, setConnecting] = useState(false);
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
                shared_account_connected: res.data.shared_account_connected,
                shared_account_email: res.data.shared_account_email ?? null,
                shared_account_error: res.data.shared_account_error ?? null,
                my_calendar_connected: res.data.my_calendar_connected,
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

    // 管理者向け: 共有アカウントOAuthコールバック後のメッセージ処理（/admin/google?google=connected|error）
    useEffect(() => {
        if (!location.pathname.startsWith('/admin/google')) return;
        const params = new URLSearchParams(location.search);
        const google = params.get('google');
        if (google !== 'connected' && google !== 'error') return;

        if (google === 'connected') {
            setGoogleSnackbar({ open: true, message: '共有Googleアカウントを連携しました。', severity: 'success' });
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
            setGoogleSnackbar({ open: true, message: `共有アカウントの連携に失敗しました。${detail}`, severity: 'error' });
        }
        fetchGoogleStatus();
        navigate('/admin/google', { replace: true });
    }, [location.pathname, location.search, navigate, fetchGoogleStatus]);

    // 個人カレンダー接続（OAuth不要、直接APIを叩くだけ）
    const handleConnectMyCalendar = useCallback(async () => {
        setConnecting(true);
        try {
            await api.post('/google/my-calendar/connect');
            await fetchGoogleStatus();
            setGoogleSnackbar({
                open: true,
                message: 'Google カレンダーと連携しました。あなたに関連するタスク・プロジェクト・イベントが自動で同期されます！',
                severity: 'success',
            });
        } catch (err: any) {
            const msg = err?.response?.data?.detail || err?.message || 'Google 連携の開始に失敗しました';
            setGoogleSnackbar({ open: true, message: `Google連携エラー: ${msg}`, severity: 'error' });
        } finally {
            setConnecting(false);
        }
    }, [fetchGoogleStatus]);

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

    // 個人カレンダーの連携解除
    const handleGoogleDisconnect = useCallback(async () => {
        try {
            await api.post('/google/my-calendar/disconnect');
            await fetchGoogleStatus();
            setGoogleSnackbar({ open: true, message: 'Google 連携を解除しました', severity: 'success' });
        } catch (err: any) {
            const msg = err?.response?.data?.detail || err?.message || 'Google 連携の解除に失敗しました';
            setGoogleSnackbar({ open: true, message: `Google連携解除エラー: ${msg}`, severity: 'error' });
        }
    }, [fetchGoogleStatus]);

    // 管理者向け: 共有アカウントの接続
    const handleAdminConnectSharedAccount = useCallback(async () => {
        try {
            const res = await api.get<{ url: string }>('/google/admin/authorize');
            if (res.data?.url) {
                window.location.href = res.data.url;
            } else {
                setGoogleSnackbar({ open: true, message: 'Google認証URLの取得に失敗しました', severity: 'error' });
            }
        } catch (err: any) {
            const msg = err?.response?.data?.detail || err?.message || '共有アカウントの連携開始に失敗しました';
            setGoogleSnackbar({ open: true, message: `Google連携エラー: ${msg}`, severity: 'error' });
        }
    }, []);

    // 管理者向け: 共有アカウントの解除（全社員分の個人カレンダーが一括で消える）
    const handleAdminDisconnectSharedAccount = useCallback(async () => {
        try {
            await api.delete('/google/admin/disconnect', { params: { confirm: true } });
            await fetchGoogleStatus();
            setGoogleSnackbar({ open: true, message: '共有アカウントの連携解除を開始しました', severity: 'success' });
        } catch (err: any) {
            const msg = err?.response?.data?.detail || err?.message || '共有アカウントの解除に失敗しました';
            setGoogleSnackbar({ open: true, message: `Google連携解除エラー: ${msg}`, severity: 'error' });
        }
    }, [fetchGoogleStatus]);

    const closeSnackbar = useCallback(() => {
        setGoogleSnackbar(prev => ({ ...prev, open: false }));
    }, []);

    return {
        googleStatus,
        connecting,
        googleSnackbar,
        closeSnackbar,
        handleConnectMyCalendar,
        handleGoogleSyncEventToggle,
        handleGoogleDisconnect,
        handleAdminConnectSharedAccount,
        handleAdminDisconnectSharedAccount,
        fetchGoogleStatus,
    };
};
