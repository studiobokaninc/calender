import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Breadcrumbs, Link } from '@mui/material';
import { EventNote as EventNoteIcon } from '@mui/icons-material';
import EventManagementConsole from '../components/EventManagementConsole';

const EventManagementPage: React.FC = () => {
  const navigate = useNavigate();
  return (
    <Box sx={{ height: 'calc(100vh - 70px)', display: 'flex', flexDirection: 'column', p: { xs: 1.5, sm: 3 } }}>
      <Box sx={{ mb: 4 }}>
        <Breadcrumbs sx={{ mb: 1.5 }}>
          <Link color="inherit" onClick={() => navigate('/dashboard')} sx={{ cursor: 'pointer', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
            App
          </Link>
          <Typography color="text.primary" sx={{ fontWeight: 500 }}>Events</Typography>
        </Breadcrumbs>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <EventNoteIcon sx={{ fontSize: '2rem', color: '#00BCD4' }} />
          <Typography
            variant="h4"
            sx={{
              fontWeight: 800,
              background: 'linear-gradient(45deg, #00BCD4 30%, #3F51B5 90%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontSize: { xs: '1.75rem', sm: '2.25rem' }
            }}
          >
            Event Management
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.95rem' }}>
          プロジェクトイベント、スケジュール、参加者の管理を一元化します。
        </Typography>
      </Box>
      <Box sx={{ flexGrow: 1, overflow: 'hidden', minHeight: 0 }}>
        <EventManagementConsole />
      </Box>
    </Box>
  );
};

export default EventManagementPage; 