import React from 'react';
import { Tooltip, Typography } from '@mui/material';
import { formatTaskLabel } from '../../utils/taskLabel';

interface TaskLabelProps {
  shotId?: string | null;
  title: string;
  fontSize?: string;
  maxWidth?: string | number;
}

export function TaskLabel({ shotId, title, fontSize = '0.85rem', maxWidth }: TaskLabelProps) {
  const label = formatTaskLabel(shotId, title);
  return (
    <Tooltip title={label} placement="top">
      <Typography
        component="span"
        sx={{
          fontSize,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          display: 'block',
          maxWidth: maxWidth ?? '100%',
        }}
      >
        {label}
      </Typography>
    </Tooltip>
  );
}
