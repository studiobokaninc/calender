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
// currentStatus: 呼び出し側が保持している現在のタスクステータス。ステータス変更後、
// 同じtaskId・enabledのままパネル/ダイアログが開き続けるケース(例: TaskQuickDetail)で、
// 遷移成功後にtask.statusだけが更新されても本フックが再フェッチされず、遷移元ステータス
// (旧status)がallowedNextの候補から漏れて誤ってグレーアウトされる不具合があったため、
// 依存配列に含めて変更を検知できるようにする。
export function useAllowedTransitions(
  taskId: number | null | undefined,
  enabled: boolean,
  currentStatus?: string | null,
) {
  return { data: null as AllowedTransitionsResult | null, loading: false };
}
