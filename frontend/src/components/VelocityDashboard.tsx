import React from 'react';
import { Box, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow, Tooltip } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

export interface VelocityUser {
  user_id: number;
  user_name: string;
  assigned_hours: number;
  free_hours: number;
  labor_hours_passed?: number;
  remaining_cost_hours?: number;
  weekdays_passed?: number;
}

export interface VelocityDashboardProps {
  users: VelocityUser[];
  maxHoursPerWeek?: number;
  hoursPerDay?: number;
}

/**
 * ベロシティ・ダッシュボード: 処理能力の把握
 * - 稼働率: 今、どれだけ予定が埋まっているか (assigned / max)
 * - 残キャパシティ: あと何時間分の仕事を引き受けられるか (free_hours)
 * - 消化効率: 経過した平日枠に対してどれだけ消化したか（データがある場合のみ表示）
 */
const VelocityDashboard: React.FC<VelocityDashboardProps> = ({
  users,
  maxHoursPerWeek = 40,
  hoursPerDay = 8,
}) => {
  const rows = users.map((u) => {
    const utilization = maxHoursPerWeek > 0 ? (u.assigned_hours / maxHoursPerWeek) * 100 : 0;
    const weekdaysPassed = u.weekdays_passed ?? 0;
    const expectedPassed = weekdaysPassed * hoursPerDay;
    const digestionRatio =
      expectedPassed > 0 && u.labor_hours_passed != null
        ? (u.labor_hours_passed / expectedPassed) * 100
        : null;

    return {
      ...u,
      utilization: Math.round(utilization * 10) / 10,
      digestionRatio: digestionRatio != null ? Math.round(digestionRatio * 10) / 10 : null,
    };
  });

  if (rows.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography color="text.secondary">表示するデータがありません。</Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1rem' }}>
          ベロシティ・ダッシュボード
        </Typography>
        <Tooltip
          title={
            <Box sx={{ fontSize: '0.75rem' }}>
              <strong>稼働率</strong>: 今週の予定工数が稼働上限の何%か。<br />
              <strong>残キャパシティ</strong>: 今週あと何時間分の仕事を引き受けられるか。<br />
              <strong>消化効率</strong>: 経過した平日の枠に対して、どれだけ工数を消化したか（100%で計画どおり）。
            </Box>
          }
        >
          <HelpOutlineIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
        </Tooltip>
      </Box>
      <Table size="small" sx={{ '& .MuiTableCell-root': { py: 0.75 } }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>担当者</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>
              稼働率
            </TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>
              残キャパシティ
            </TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>
              消化効率
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.user_id} hover>
              <TableCell component="th" scope="row" sx={{ fontWeight: 500 }}>
                {row.user_name || `User ${row.user_id}`}
              </TableCell>
              <TableCell align="right">
                <Typography
                  variant="body2"
                  sx={{
                    color: row.utilization >= 100 ? 'error.main' : row.utilization >= 80 ? 'warning.main' : 'text.primary',
                  }}
                >
                  {row.utilization}%
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {row.assigned_hours.toFixed(1)}h / {maxHoursPerWeek}h
                </Typography>
              </TableCell>
              <TableCell align="right">
                <Typography variant="body2" sx={{ color: row.free_hours > 0 ? 'success.main' : 'text.secondary' }}>
                  {row.free_hours.toFixed(1)} h
                </Typography>
              </TableCell>
              <TableCell align="right">
                {row.digestionRatio != null ? (
                  <Typography variant="body2">{row.digestionRatio}%</Typography>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    —
                  </Typography>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
};

export default VelocityDashboard;
