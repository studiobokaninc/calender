import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Paper, Button, List, ListItem, ListItemText,
    IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, CircularProgress,
    Accordion, AccordionSummary, AccordionDetails,
    Alert, Snackbar, Grid, Chip
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
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [uploadTitle, setUploadTitle] = useState('');
    const [uploadDate, setUploadDate] = useState(new Date().toISOString().split('T')[0]);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

    const fetchMeetings = async () => {
        setLoading(true);
        try {
            const res = await api.get<Meeting[]>(`/projects/${projectId}/meetings`);
            setMeetings(res.data);
        } catch (err) {
            console.error('Failed to fetch meetings:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMeetings();
    }, [projectId]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedFile(e.target.files[0]);
        }
    };

    const handleUpload = async () => {
        if (!selectedFile) return;
        setUploading(true);
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('title', uploadTitle || '新規会議');
        formData.append('date', uploadDate);

        try {
            await api.post(`/projects/${projectId}/meetings/upload`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            });
            setSnackbar({ open: true, message: 'アップロードを開始しました。解析には数分かかる場合があります。', severity: 'success' });
            setIsUploadOpen(false);
            setUploadTitle('');
            setSelectedFile(null);

            // 数秒後に一度更新してみる
            setTimeout(fetchMeetings, 3000);
        } catch (err) {
            console.error('Upload failed:', err);
            setSnackbar({ open: true, message: 'アップロードに失敗しました', severity: 'error' });
        } finally {
            setUploading(false);
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

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">会議音声・AI議事録</Typography>
                <Button
                    variant="contained"
                    startIcon={<CloudUploadIcon />}
                    onClick={() => setIsUploadOpen(true)}
                >
                    会議オーディオを追加
                </Button>
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
                                    <Box sx={{ flexGrow: 1 }}>
                                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{meeting.title}</Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            実施日: {new Date(meeting.date).toLocaleDateString('ja-JP')}
                                        </Typography>
                                    </Box>
                                    {!meeting.transcript && (
                                        <Chip size="small" label="AI解析中..." color="info" variant="outlined" sx={{ mr: 2 }} />
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
                                        {meeting.audio_url && (
                                            <Box sx={{ mb: 2, p: 1, bgcolor: 'action.hover', borderRadius: 2 }}>
                                                <audio controls src={`${api.defaults.baseURL}${meeting.audio_url}`} style={{ width: '100%' }} />
                                            </Box>
                                        )}
                                    </Grid>

                                    {meeting.transcript ? (
                                        <>
                                            <Grid item xs={12} md={7}>
                                                <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', fontWeight: 'bold' }}>
                                                    <DescriptionIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> 内容要約・文字起こし
                                                </Typography>
                                                <Paper sx={{ p: 2, maxHeight: 400, overflow: 'auto', bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider' }}>
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
                                                    <Paper sx={{ p: 1.5, bgcolor: 'success.50', border: '1px solid', borderColor: 'success.100' }}>
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
                                                    <Paper sx={{ p: 1.5, bgcolor: 'primary.50', border: '1px solid', borderColor: 'primary.100' }}>
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
                                                    <Paper sx={{ p: 1.5, bgcolor: 'orange.50', border: '1px solid', borderColor: 'warning.100' }}>
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
                                                    <Paper sx={{ p: 1.5, bgcolor: 'secondary.50', border: '1px solid', borderColor: 'secondary.100' }}>
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
                                    ) : (
                                        <Grid item xs={12}>
                                            <Box sx={{ p: 4, textAlign: 'center' }}>
                                                <CircularProgress size={32} sx={{ mb: 2 }} />
                                                <Typography variant="body1" sx={{ fontWeight: 500 }}>AIが音声を解析中です...</Typography>
                                                <Typography variant="body2" color="text.secondary">文字起こし、決定事項、課題の抽出を行っています。完了まで数分かかる場合があります。</Typography>
                                            </Box>
                                        </Grid>
                                    )}
                                </Grid>
                            </AccordionDetails>
                        </Accordion>
                    ))}
                </Box>
            )}

            {/* アップロードダイアログ */}
            <Dialog open={isUploadOpen} onClose={() => setIsUploadOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CloudUploadIcon color="primary" /> 会議オーディオのアップロード
                </DialogTitle>
                <DialogContent dividers>
                    <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <TextField
                            label="会議名"
                            fullWidth
                            value={uploadTitle}
                            onChange={(e) => setUploadTitle(e.target.value)}
                            placeholder="例: 第12回 プロジェクト定例"
                            variant="outlined"
                        />
                        <TextField
                            label="実施日"
                            type="date"
                            fullWidth
                            value={uploadDate}
                            onChange={(e) => setUploadDate(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                            variant="outlined"
                        />

                        <Box>
                            <Typography variant="subtitle2" gutterBottom>音声ファイル</Typography>
                            <Button
                                variant="outlined"
                                component="label"
                                fullWidth
                                startIcon={<CloudUploadIcon />}
                                sx={{ py: 4, borderStyle: 'dashed', borderWidth: 2, bgcolor: 'action.hover' }}
                            >
                                {selectedFile ? 'ファイルを変更' : 'クリックして音声ファイルを選択'}
                                <input type="file" hidden accept="audio/*" onChange={handleFileChange} />
                            </Button>
                            {selectedFile && (
                                <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <MicIcon color="primary" fontSize="small" />
                                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                        {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(1)}MB)
                                    </Typography>
                                </Box>
                            )}
                        </Box>

                        <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
                            アップロード後、AIが自動的に文字起こしと議事録作成（決定事項、課題等の抽出）を行います。
                            300MB以下のオーディオファイルを推奨します。
                        </Alert>
                    </Box>
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button onClick={() => setIsUploadOpen(false)} color="inherit">キャンセル</Button>
                    <Button
                        onClick={handleUpload}
                        variant="contained"
                        disabled={!selectedFile || uploading}
                        startIcon={uploading ? <CircularProgress size={20} color="inherit" /> : <CheckCircleIcon />}
                    >
                        {uploading ? 'アップロード中...' : 'アップロードして解析開始'}
                    </Button>
                </DialogActions>
            </Dialog>

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
