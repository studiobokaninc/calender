/**
 * 実タスク文脈での許可次状態を取得するフック (殿要求(b)/F-9)。
 * GET /tasks/{task_id}/allowed-transitions (backend/app/routers/tasks.py) を叩き、
 * ステータスピッカーのグレーアウト判定 (taskStatus.ts getGatedStatusOptions) に渡す。
 */
import { useEffect, useState } from 'react';
import api from '../services/api';
import { AllowedTransitionEntry } from '../utils/taskStatus';

export interface AllowedTransitionsResult {
  taskId: number;
  status: string;
  actorRole: string | null;
  isAdmin: boolean;
  allowedNext: AllowedTransitionEntry[];
}

// enabled=false の間は取得しない(ダイアログ/ポップオーバーが開いている時のみ取得する用途)。
export function useAllowedTransitions(taskId: number | null | undefined, enabled: boolean) {
  const [data, setData] = useState<AllowedTransitionsResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !taskId) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.get(`/tasks/${taskId}/allowed-transitions`)
      .then(res => {
        if (cancelled) return;
        setData({
          taskId: res.data.task_id,
          status: res.data.status,
          actorRole: res.data.actor_role,
          isAdmin: res.data.is_admin,
          allowedNext: res.data.allowed_next || [],
        });
      })
      .catch(() => {
        // 取得失敗時は data=null のまま = getGatedStatusOptions が全選択可へフォールバックする
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, enabled]);

  return { data, loading };
}
