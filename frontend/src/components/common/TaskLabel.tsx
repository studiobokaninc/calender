import React from 'react';
import { Tooltip, Typography } from '@mui/material';
import { formatTaskLabel } from '../../utils/taskLabel';

interface TaskLabelProps {
  shotId?: string | null;
  title: string;
  fontSize?: string;
  maxWidth?: string | number;
  whiteSpace?: 'normal' | 'nowrap' | 'pre-wrap';
}

export function TaskLabel({ shotId, title, fontSize = '0.85rem', maxWidth, whiteSpace = 'nowrap' }: TaskLabelProps) {
  const label = formatTaskLabel(shotId, title);
  return (
    <Tooltip title={label} placement="top" disableHoverListener={whiteSpace !== 'nowrap'}>
      <Typography
        component="span"
        sx={{
          fontSize,
          overflow: whiteSpace === 'nowrap' ? 'hidden' : 'visible',
          textOverflow: whiteSpace === 'nowrap' ? 'ellipsis' : 'clip',
          whiteSpace: whiteSpace,
          display: 'block',
          maxWidth: maxWidth ?? '100%',
        }}
      >
        {label}
      </Typography>
    </Tooltip>
  );
}
