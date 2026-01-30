import React from 'react';
import { Box, Typography } from '@mui/material';
import EventManagementConsole from '../components/EventManagementConsole';

const EventManagementPage: React.FC = () => {
  return (
    <Box sx={{ height: 'calc(100vh - 70px)', display: 'flex', flexDirection: 'column', px: 2, py: 2 }}>
      <Typography variant="h5" component="h1" fontWeight={600} gutterBottom>
        イベント管理
      </Typography>
      <Box sx={{ flexGrow: 1, overflow: 'hidden', minHeight: 0 }}>
        <EventManagementConsole />
      </Box>
    </Box>
  );
};

export default EventManagementPage; 