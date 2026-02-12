import React from 'react';
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
} from 'recharts';
import { Box, Typography, Paper, useTheme } from '@mui/material';

export interface WeeklyUserLoad {
  user_id: number;
  user_name: string;
  assigned_hours: number;
  free_hours: number;
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
}) => {
  const theme = useTheme();
  const over = overColor ?? theme.palette.error.main;
  const normal = normalColor ?? theme.palette.primary.main;

  const data = users.map((u) => ({
    name: u.user_name || `User ${u.user_id}`,
    userId: u.user_id,
    hours: Math.round(u.assigned_hours * 10) / 10,
    free: Math.round(u.free_hours * 10) / 10,
    isOver: u.assigned_hours >= maxHoursPerWeek,
  }));

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
        リソース・スタックバー（今週の合計工数）
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        棒の高さ＝その週の合計工数。横線＝稼働限界（{maxHoursPerWeek}h/週）。超えている人は赤で表示。
      </Typography>
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
              formatter={(value: number) => [`${value} h`, '割当工数']}
              labelFormatter={(label, payload) => {
                const p = payload[0]?.payload;
                if (p) return `${p.name} — 残り余裕: ${p.free.toFixed(1)} h`;
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
            <Bar dataKey="hours" name="割当工数" barSize={24} radius={[0, 4, 4, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.isOver ? over : normal} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  );
};

export default ResourceStackBar;
