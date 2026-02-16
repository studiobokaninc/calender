import React, { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  ComposedChart,
} from 'recharts';
import { Box, Typography, Paper, useTheme, Popover, List, ListItem, ListItemText } from '@mui/material';

export interface WeeklyTaskItem {
  task_id: number;
  task_name: string;
  cost: number;
  start_date?: string | null;
  due_date?: string | null;
  hours_per_weekday?: number;
  total_weekdays?: number;
}

export interface WeeklyUserLoad {
  user_id: number;
  user_name: string;
  assigned_hours: number;
  free_hours: number;
  base_load_hours_per_week?: number;
  task_assigned_hours?: number;
  tasks?: WeeklyTaskItem[];
}

export interface ResourceStackBarProps {
  /** 今週のユーザー別割当工数（週合計） */
  users: WeeklyUserLoad[];
  /** 稼働限界（時間/週）。この値を横線で表示する */
  maxHoursPerWeek?: number;
  /** オーバーした場合のバーの色 */
  overColor?: string;
  /** 適正以下のバーの色 */
  normalColor?: string;
  /** グラフのタイトル */
  title?: string;
}

/**
 * リソース・スタックバー: 誰に負担が集中しているかを週合計工数で比較し、
 * 稼働限界ライン（例: 週40時間）を横線で表示する。
 */
const ResourceStackBar: React.FC<ResourceStackBarProps> = ({
  users,
  maxHoursPerWeek = 40,
  overColor,
  normalColor,
  title,
}) => {
  const theme = useTheme();
  const over = overColor ?? theme.palette.error.main;
  const normal = normalColor ?? theme.palette.primary.main;
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [selectedPayload, setSelectedPayload] = useState<{ name: string; userId: number; tasks: WeeklyTaskItem[] } | null>(null);

  const data = users.map((u) => {
    const baseLoad = u.base_load_hours_per_week || 0;
    const taskAssigned = u.task_assigned_hours ?? (u.assigned_hours - baseLoad);
    const totalAssigned = u.assigned_hours;
    return {
      name: u.user_name || `User ${u.user_id}`,
      userId: u.user_id,
      hours: Math.round(totalAssigned * 10) / 10,
      baseLoad: Math.round(baseLoad * 10) / 10,
      taskHours: Math.round(taskAssigned * 10) / 10,
      free: Math.round(u.free_hours * 10) / 10,
      isOver: totalAssigned >= maxHoursPerWeek,
      tasks: u.tasks ?? [],
    };
  });

  if (data.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography color="text.secondary">表示するデータがありません。</Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        {title || 'リソース・スタックバー（今週の合計工数）'}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        棒の高さ＝その週の合計工数（コストを稼働日で按分）。横線＝稼働限界（{maxHoursPerWeek}h/週）。棒をクリックでタスク内訳を表示。
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, mb: 1, fontSize: '0.75rem' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 16, height: 16, bgcolor: theme.palette.primary.main, borderRadius: 0.5 }} />
          <Typography variant="caption">プロジェクトタスク</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 16, height: 16, bgcolor: theme.palette.grey[400], borderRadius: 0.5 }} />
          <Typography variant="caption">ベースロード（定常業務）</Typography>
        </Box>
      </Box>
      <Box sx={{ width: '100%', height: Math.max(320, data.length * 32) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 32, right: 56, left: 8, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              domain={[0, Math.max(maxHoursPerWeek * 1.2, ...data.map((d) => d.hours), 1)]}
              tickFormatter={(v) => `${v}h`}
            />
            <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value: number, name: string) => {
                if (name === 'baseLoad') return [`${value} h`, 'ベースロード'];
                if (name === 'taskHours') return [`${value} h`, 'プロジェクトタスク'];
                return [`${value} h`, '割当工数'];
              }}
              labelFormatter={(label, payload) => {
                const p = payload?.[0]?.payload;
                if (p) {
                  return `${p.name} — 残り余裕: ${p.free.toFixed(1)} h（ベースロード: ${p.baseLoad.toFixed(1)}h + タスク: ${p.taskHours.toFixed(1)}h）`;
                }
                return label;
              }}
            />
            <ReferenceLine
              x={maxHoursPerWeek}
              stroke={theme.palette.warning.main}
              strokeWidth={2}
              strokeDasharray="4 4"
              label={{ value: `稼働限界 ${maxHoursPerWeek}h`, position: 'right', fill: theme.palette.warning.dark }}
            />
            {/* ベースロード（グレー） */}
            <Bar dataKey="baseLoad" name="ベースロード" stackId="a" barSize={24} radius={[0, 0, 0, 0]}>
              {data.map((entry, index) => (
                <Cell
                  key={`base-${index}`}
                  fill={theme.palette.grey[400]}
                />
              ))}
            </Bar>
            {/* プロジェクトタスク（青） */}
            <Bar dataKey="taskHours" name="プロジェクトタスク" stackId="a" barSize={24} radius={[0, 4, 4, 0]}>
              {data.map((entry, index) => (
                <Cell
                  key={`task-${index}`}
                  fill={entry.isOver ? over : normal}
                  style={{ cursor: (entry.tasks?.length ?? 0) > 0 ? 'pointer' : 'default' }}
                  onClick={(e: React.MouseEvent) => {
                    const payload = data[index];
                    if (payload && (payload.tasks?.length ?? 0) > 0) {
                      setAnchorEl(e.currentTarget as HTMLElement);
                      setSelectedPayload({ name: payload.name, userId: payload.userId, tasks: payload.tasks ?? [] });
                    }
                  }}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
      <Popover
        open={Boolean(anchorEl && selectedPayload)}
        anchorEl={anchorEl ?? undefined}
        onClose={() => { setAnchorEl(null); setSelectedPayload(null); }}
        anchorOrigin={{ vertical: 'center', horizontal: 'left' }}
        transformOrigin={{ vertical: 'center', horizontal: 'right' }}
      >
        <Box sx={{ p: 2, maxWidth: 360, maxHeight: 400, overflow: 'auto' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>{selectedPayload?.name} — 今週のタスク内訳</Typography>
          <List dense disablePadding>
            {selectedPayload?.tasks.map((t) => (
              <ListItem key={t.task_id} disablePadding sx={{ py: 0.25 }}>
                <ListItemText
                  primary={t.task_name || `タスク #${t.task_id}`}
                  secondary={`${t.cost.toFixed(1)}h${t.start_date && t.due_date ? `（${t.start_date} 〜 ${t.due_date}）` : ''}`}
                  primaryTypographyProps={{ fontSize: '0.8rem' }}
                  secondaryTypographyProps={{ fontSize: '0.75rem' }}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      </Popover>
    </Paper>
  );
};

export default ResourceStackBar;
