import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Paper, Button, List, ListItem, ListItemText,
    IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, CircularProgress,
    Accordion, AccordionSummary, AccordionDetails,
    Alert, Snackbar, Grid, Chip, Link, useMediaQuery, useTheme
} from '@mui/material';
import {
    CloudUpload as CloudUploadIcon,
    Delete as DeleteIcon,
    ExpandMore as ExpandMoreIcon,
    Mic as MicIcon,
    EventNote as EventNoteIcon,
    Description as DescriptionIcon,
    CheckCircle as CheckCircleIcon,
    Assignment as AssignmentIcon,
    Help as HelpIcon,
    Schedule as ScheduleIcon
} from '@mui/icons-material';
import api from '../services/api';
import { Meeting } from '../types';

interface ProjectMeetingsProps {
    projectId: number;
}

const ProjectMeetings: React.FC<ProjectMeetingsProps> = ({ projectId }) => {
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [loading, setLoading] = useState(true);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

    useEffect(() => {
        fetchMeetings();

        // 10秒ごとに自動更新（解析中のものがある場合）
        const interval = setInterval(() => {
            setMeetings(prev => {
                const hasProcessing = prev.some(m => !m.transcript || m.status === 'processing' || m.status === 'pending');
                if (hasProcessing) {
                    fetchMeetings(false); // サイレント更新
                }
                return prev;
            });
        }, 10000);

        return () => clearInterval(interval);
    }, [projectId]);

    const fetchMeetings = async (showLoading = true) => {
        if (showLoading) setLoading(true);
        try {
            const res = await api.get<Meeting[]>(`/projects/${projectId}/meetings`);
            setMeetings(res.data);
        } catch (err) {
            console.error('Failed to fetch meetings:', err);
        } finally {
            if (showLoading) setLoading(false);
        }
    };

    const handleDelete = async (meetingId: number) => {
        if (!window.confirm('この会議データを削除してもよろしいですか？')) return;
        try {
            await api.delete(`/projects/${projectId}/meetings/${meetingId}`);
            setMeetings(meetings.filter(m => m.id !== meetingId));
            setSnackbar({ open: true, message: '削除しました', severity: 'success' });
        } catch (err) {
            console.error('Delete failed:', err);
            setSnackbar({ open: true, message: '削除に失敗しました', severity: 'error' });
        }
    };

    const handleOpenExplorer = async (path: string) => {
        try {
            await api.post('/meetings/open-explorer', { path });
        } catch (err) {
            console.error('Failed to open explorer:', err);
            setSnackbar({ open: true, message: 'エクスプローラーを開けませんでした', severity: 'error' });
        }
    };

    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    return (
        <Box>
            <Box sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: isMobile ? 'flex-start' : 'center',
                mb: 2,
                flexDirection: isMobile ? 'column' : 'row',
                gap: isMobile ? 1.5 : 0
            }}>
                <Typography variant="h6" sx={{ fontSize: isMobile ? '1.1rem' : '1.25rem', fontWeight: 600 }}>
                    会議音声・AI議事録
                </Typography>
            </Box>

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                    <CircularProgress />
                </Box>
            ) : meetings.length === 0 ? (
                <Paper sx={{ p: 4, textAlign: 'center', bgcolor: 'background.default', border: '2px dashed', borderColor: 'divider' }}>
                    <MicIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1, opacity: 0.5 }} />
                    <Typography color="text.secondary">会議データがありません。定例会議の音声をアップロードして、AIで議事録を自動生成しましょう。</Typography>
                </Paper>
            ) : (
                <Box>
                    {meetings.map((meeting) => (
                        <Accordion key={meeting.id} sx={{ mb: 1.5, borderRadius: '8px !important', overflow: 'hidden', '&:before': { display: 'none' }, boxShadow: 1 }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', pr: 2 }}>
                                    <EventNoteIcon sx={{ mr: 2, color: 'primary.main' }} />
                                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>{meeting.title}</Typography>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                                            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                                                実施日: {new Date(meeting.date).toLocaleDateString('ja-JP')}
                                            </Typography>
                                            {meeting.audio_url && (
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                                                    <Typography
                                                        variant="caption"
                                                        color="text.secondary"
                                                        sx={{
                                                            display: 'inline-block',
                                                            maxWidth: isMobile ? '150px' : '400px',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            whiteSpace: 'nowrap',
                                                            fontFamily: 'monospace'
                                                        }}
                                                        title={meeting.audio_url}
                                                    >
                                                        {meeting.audio_url}
                                                    </Typography>
                                                    {(meeting.audio_url.startsWith('X:') || meeting.audio_url.includes('\\')) && (
                                                        <Button
                                                            size="small"
                                                            variant="text"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleOpenExplorer(meeting.audio_url!);
                                                            }}
                                                            sx={{
                                                                minWidth: 'auto',
                                                                p: 0,
                                                                fontSize: '0.65rem',
                                                                textTransform: 'none',
                                                                color: 'primary.main',
                                                                '&:hover': { textDecoration: 'underline' }
                                                            }}
                                                        >
                                                            [開く]
                                                        </Button>
                                                    )}
                                                </Box>
                                            )}
                                        </Box>
                                    </Box>
                                    {meeting.status === 'failed' ? (
                                        <Chip size="small" label="解析失敗" color="error" variant="outlined" sx={{ mr: 2 }} />
                                    ) : (!meeting.transcript && (meeting.status === 'processing' || meeting.status === 'pending')) && (
                                        <Chip
                                            size="small"
                                            label={meeting.status === 'processing' ? 'AI解析中...' : '解析待ち...'}
                                            color="info"
                                            variant="outlined"
                                            sx={{ mr: 2 }}
                                            icon={meeting.status === 'processing' ? <CircularProgress size={12} /> : undefined}
                                        />
                                    )}
                                    <IconButton
                                        size="small"
                                        color="error"
                                        onClick={(e) => { e.stopPropagation(); handleDelete(meeting.id); }}
                                    >
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                </Box>
                            </AccordionSummary>
                            <AccordionDetails sx={{ bgcolor: 'background.paper', borderTop: '1px solid', borderColor: 'divider', p: 3 }}>
                                <Grid container spacing={3}>
                                    <Grid item xs={12}>
                                        {/* Audio download removed by request */}
                                    </Grid>

                                    {meeting.transcript ? (
                                        <>
                                            <Grid item xs={12} md={7}>
                                                <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', fontWeight: 'bold' }}>
                                                    <DescriptionIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> 内容要約・文字起こし
                                                </Typography>
                                                <Paper sx={{
                                                    p: 2,
                                                    maxHeight: 400,
                                                    overflow: 'auto',
                                                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'background.default' : 'grey.50',
                                                    border: '1px solid',
                                                    borderColor: 'divider'
                                                }}>
                                                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                                                        {meeting.transcript}
                                                    </Typography>
                                                </Paper>
                                            </Grid>
                                            <Grid item xs={12} md={5}>
                                                <Box sx={{ mb: 3 }}>
                                                    <Typography variant="subtitle2" color="success.main" gutterBottom sx={{ display: 'flex', alignItems: 'center', fontWeight: 'bold' }}>
                                                        <CheckCircleIcon fontSize="small" sx={{ mr: 1 }} /> 決定事項
                                                    </Typography>
                                                    <Paper sx={{
                                                        p: 1.5,
                                                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(76, 175, 80, 0.1)' : 'success.50',
                                                        border: '1px solid',
                                                        borderColor: (theme) => theme.palette.mode === 'dark' ? 'success.dark' : 'success.100'
                                                    }}>
                                                        {meeting.decisions && meeting.decisions.length > 0 ? (
                                                            <List dense disablePadding>
                                                                {meeting.decisions.map((d, i) => (
                                                                    <ListItem key={i} disableGutters>
                                                                        <ListItemText primary={`• ${d}`} primaryTypographyProps={{ variant: 'body2' }} />
                                                                    </ListItem>
                                                                ))}
                                                            </List>
                                                        ) : <Typography variant="caption" color="text.secondary">抽出されませんでした</Typography>}
                                                    </Paper>
                                                </Box>

                                                <Box sx={{ mb: 3 }}>
                                                    <Typography variant="subtitle2" color="primary.main" gutterBottom sx={{ display: 'flex', alignItems: 'center', fontWeight: 'bold' }}>
                                                        <AssignmentIcon fontSize="small" sx={{ mr: 1 }} /> 課題・タスク
                                                    </Typography>
                                                    <Paper sx={{
                                                        p: 1.5,
                                                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(33, 150, 243, 0.1)' : 'primary.50',
                                                        border: '1px solid',
                                                        borderColor: (theme) => theme.palette.mode === 'dark' ? 'primary.dark' : 'primary.100'
                                                    }}>
                                                        {meeting.tasks && meeting.tasks.length > 0 ? (
                                                            <List dense disablePadding>
                                                                {meeting.tasks.map((t, i) => (
                                                                    <ListItem key={i} disableGutters>
                                                                        <ListItemText primary={`• ${t}`} primaryTypographyProps={{ variant: 'body2' }} />
                                                                    </ListItem>
                                                                ))}
                                                            </List>
                                                        ) : <Typography variant="caption" color="text.secondary">抽出されませんでした</Typography>}
                                                    </Paper>
                                                </Box>

                                                <Box sx={{ mb: 3 }}>
                                                    <Typography variant="subtitle2" color="warning.dark" gutterBottom sx={{ display: 'flex', alignItems: 'center', fontWeight: 'bold' }}>
                                                        <HelpIcon fontSize="small" sx={{ mr: 1 }} /> 主要な論点
                                                    </Typography>
                                                    <Paper sx={{
                                                        p: 1.5,
                                                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255, 152, 0, 0.1)' : '#fff3e0',
                                                        border: '1px solid',
                                                        borderColor: (theme) => theme.palette.mode === 'dark' ? 'warning.dark' : '#ffe0b2'
                                                    }}>
                                                        {meeting.discussion_points && meeting.discussion_points.length > 0 ? (
                                                            <List dense disablePadding>
                                                                {meeting.discussion_points.map((p, i) => (
                                                                    <ListItem key={i} disableGutters>
                                                                        <ListItemText primary={`• ${p}`} primaryTypographyProps={{ variant: 'body2' }} />
                                                                    </ListItem>
                                                                ))}
                                                            </List>
                                                        ) : <Typography variant="caption" color="text.secondary">抽出されませんでした</Typography>}
                                                    </Paper>
                                                </Box>

                                                <Box>
                                                    <Typography variant="subtitle2" color="secondary.main" gutterBottom sx={{ display: 'flex', alignItems: 'center', fontWeight: 'bold' }}>
                                                        <ScheduleIcon fontSize="small" sx={{ mr: 1 }} /> 期限・日程候補
                                                    </Typography>
                                                    <Paper sx={{
                                                        p: 1.5,
                                                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(156, 39, 176, 0.1)' : 'secondary.50',
                                                        border: '1px solid',
                                                        borderColor: (theme) => theme.palette.mode === 'dark' ? 'secondary.dark' : 'secondary.100'
                                                    }}>
                                                        {meeting.deadlines && meeting.deadlines.length > 0 ? (
                                                            <List dense disablePadding>
                                                                {meeting.deadlines.map((d, i) => (
                                                                    <ListItem key={i} disableGutters>
                                                                        <ListItemText primary={`• ${d}`} primaryTypographyProps={{ variant: 'body2' }} />
                                                                    </ListItem>
                                                                ))}
                                                            </List>
                                                        ) : <Typography variant="caption" color="text.secondary">抽出されませんでした</Typography>}
                                                    </Paper>
                                                </Box>
                                            </Grid>
                                        </>
                                    ) : meeting.status === 'failed' ? (
                                        <Grid item xs={12}>
                                            <Alert severity="error" sx={{ my: 2 }}>
                                                AI解析に失敗しました。AIが解答を返さなかったか、形式が不適切だった可能性があります。
                                            </Alert>
                                        </Grid>
                                    ) : (meeting.status === 'processing' || meeting.status === 'pending' || !meeting.transcript) ? (
                                        <Grid item xs={12}>
                                            <Box sx={{ p: 4, textAlign: 'center' }}>
                                                <CircularProgress size={32} sx={{ mb: 2 }} />
                                                <Typography variant="body1" sx={{ fontWeight: 500 }}>
                                                    {meeting.status === 'processing' ? 'AIが音声を解析中です...' : '解析の順番待ちです...'}
                                                </Typography>
                                                <Typography variant="body2" color="text.secondary">文字起こし、決定事項、課題の抽出を行っています。完了まで数分かかる場合があります。</Typography>
                                            </Box>
                                        </Grid>
                                    ) : null}
                                </Grid>
                            </AccordionDetails>
                        </Accordion>
                    ))}
                </Box>
            )}

            {/* アップロードダイアログ */}
            {/* Upload Dialog removed. Automation via Network Drive is now used. */}

            <Snackbar
                open={snackbar.open}
                autoHideDuration={6000}
                onClose={() => setSnackbar({ ...snackbar, open: false })}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} sx={{ width: '100%' }}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default ProjectMeetings;
