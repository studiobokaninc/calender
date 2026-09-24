// プロジェクトステータスの表示ラベル共有ユーティリティ。
// 編集ダイアログ側 (SearchEditDialogs.tsx 等) の MenuItem 表記と一致させること。

const PROJECT_STATUS_LABEL: Record<string, string> = {
  planning: '計画中',
  'in-progress': '進行中',
  completed: '完了',
  'on-hold': '保留中',
  cancelled: 'キャンセル',
  delayed: '遅延',
};

export const getProjectStatusLabel = (status?: string | null): string => {
  if (!status) return '-';
  return PROJECT_STATUS_LABEL[status] || status;
};
