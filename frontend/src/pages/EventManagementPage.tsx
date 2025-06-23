import React from 'react';
import { Box, Typography } from '@mui/material';
import EventManagementConsole from '../components/EventManagementConsole';

const EventManagementPage: React.FC = () => {
  return (
    <Box sx={{ height: 'calc(100vh - 70px)', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h4" component="h1" gutterBottom>
        イベント管理
      </Typography>
      <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
        <EventManagementConsole />
      </Box>
    </Box>
  );
};

export default EventManagementPage; 