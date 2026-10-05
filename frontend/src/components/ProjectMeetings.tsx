import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Paper, Button, List, ListItem, ListItemText,
    IconButton, CircularProgress, LinearProgress,
    Accordion, AccordionSummary, AccordionDetails,
    Alert, Snackbar, Grid, Chip, useMediaQuery, useTheme,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField
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
    Schedule as ScheduleIcon,
    Download as DownloadIcon,
    People as PeopleIcon
} from '@mui/icons-material';
import api from '../services/api';
import { Meeting } from '../types';
import MeetingRecorder, { AttendeesInput } from './MeetingRecorder';

interface ProjectMeetingsProps {
    projectId: number;
}

// 議事録生成の所要時間(秒)を「X分Y秒」表記にする
const fmtDuration = (sec?: number | null): string => {
    if (sec == null) return '';
    if (sec < 60) return `${sec}秒`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m}分${s}秒` : `${m}分`;
};

// 議事録を生成中（順番待ち含む）か。再生成中は旧 transcript が残るため transcript の有無では判定しない
const isGenerating = (m: Meeting): boolean => m.status === 'processing' || m.status === 'pending';

// 進捗率（0-100）。エージェント経由のときだけ届くので、無ければ null
const progressOf = (m: Meeting): number | null =>
    m.status === 'processing' && m.analysis_progress != null ? Math.max(0, Math.min(100, m.analysis_progress)) : null;

const generatingLabel = (m: Meeting): string => {
    if (m.status === 'pending') return '生成待ち…';
    const p = progressOf(m);
    return p != null ? `議事録生成中 ${p}%` : '議事録生成中…';
};

// 展開部に出す「生成中」パネル
const GeneratingPanel: React.FC<{ meeting: Meeting }> = ({ meeting }) => {
    const p = progressOf(meeting);
    const pending = meeting.status === 'pending';
    return (
        <Paper variant="outlined" sx={{ p: 2.5, borderColor: 'info.main', bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(33, 150, 243, 0.08)' : 'info.50' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                <CircularProgress size={22} />
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {pending ? '議事録生成の順番待ちです' : 'AIが議事録を生成しています'}
                </Typography>
                {p != null && (
                    <Typography variant="subtitle1" color="primary" sx={{ ml: 'auto', fontWeight: 700 }}>{p}%</Typography>
                )}
            </Box>
            <LinearProgress
                variant={p != null ? 'determinate' : 'indeterminate'}
                value={p ?? undefined}
                sx={{ height: 8, borderRadius: 4, mb: 1.5 }}
            />
            <Typography variant="body2" color="text.secondary">
                音声の文字起こし → 決定事項・課題・期限の抽出 の順に処理しています。
                録音の長さによって数分〜数十分かかります。完了すると自動で表示されるので、このページを離れても問題ありません。
            </Typography>
        </Paper>
    );
};

const ProjectMeetings: React.FC<ProjectMeetingsProps> = ({ projectId }) => {
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [loading, setLoading] = useState(true);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

    // アップロード確認ダイアログ（タイトル＋参加者）
    const [pendingUpload, setPendingUpload] = useState<{ file: File; detectedDate: string | null } | null>(null);
    const [uploadTitle, setUploadTitle] = useState('');
    const [uploadAttendees, setUploadAttendees] = useState<string[]>([]);

    // 再生成（reanalyze）確認ダイアログ
    const [reanalyzeTarget, setReanalyzeTarget] = useState<Meeting | null>(null);
    const [reanalyzeAttendees, setReanalyzeAttendees] = useState<string[]>([]);

    // 参加者の後からの編集ダイアログ
    const [editAttendeesTarget, setEditAttendeesTarget] = useState<Meeting | null>(null);
    const [editAttendeesValue, setEditAttendeesValue] = useState<string[]>([]);

    const generatingCount = meetings.filter(isGenerating).length;
    const needsPolling = meetings.some(m => isGenerating(m) || (!m.transcript && m.status !== 'failed'));

    useEffect(() => {
        fetchMeetings();
    }, [projectId]);

    // 生成中は5秒、それ以外で未完了のものがあれば10秒ごとにサイレント更新
    useEffect(() => {
        if (!needsPolling) return;
        const interval = setInterval(() => fetchMeetings(false), generatingCount > 0 ? 5000 : 10000);
        return () => clearInterval(interval);
    }, [projectId, needsPolling, generatingCount > 0]);

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

    // 失敗/中断した議事録を、サーバに残っている録音データ（結合済み音声 or 録音チャンク）から再生成する
    const handleReanalyze = (meeting: Meeting) => {
        setReanalyzeAttendees((meeting.attendees || []).map(a => a.name));
        setReanalyzeTarget(meeting);
    };

    const handleConfirmReanalyze = async () => {
        if (!reanalyzeTarget) return;
        const meetingId = reanalyzeTarget.id;
        setReanalyzeTarget(null);
        try {
            const formData = new FormData();
            formData.append('attendees', JSON.stringify(reanalyzeAttendees.map(a => a.trim()).filter(Boolean)));
            await api.post(`/projects/${projectId}/meetings/${meetingId}/reanalyze`, formData);
            setSnackbar({ open: true, message: '再生成を開始しました。完了までしばらくお待ちください。', severity: 'success' });
            fetchMeetings(false);
        } catch (err: any) {
            console.error('Reanalyze failed:', err);
            const detail = err?.response?.data?.detail;
            setSnackbar({ open: true, message: detail || '再生成に失敗しました', severity: 'error' });
        }
    };

    // 参加者だけを後から編集する（既存の PATCH /api/meetings/{id} を利用）
    const handleOpenEditAttendees = (meeting: Meeting) => {
        setEditAttendeesValue((meeting.attendees || []).map(a => a.name));
        setEditAttendeesTarget(meeting);
    };

    const handleSaveAttendees = async () => {
        if (!editAttendeesTarget) return;
        const meetingId = editAttendeesTarget.id;
        const names = editAttendeesValue.map(a => a.trim()).filter(Boolean);
        setEditAttendeesTarget(null);
        try {
            await api.patch(`/meetings/${meetingId}`, {
                attendees: names.map(n => ({ name: n }))
            });
            setSnackbar({ open: true, message: '参加者を更新しました', severity: 'success' });
            fetchMeetings(false);
        } catch (err) {
            console.error('Failed to update attendees:', err);
            setSnackbar({ open: true, message: '参加者の更新に失敗しました', severity: 'error' });
        }
    };

    const handleConfirmUpload = async () => {
        if (!pendingUpload) return;
        const { file, detectedDate } = pendingUpload;
        setPendingUpload(null);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', uploadTitle.trim() || file.name.split('.')[0]);
        formData.append('attendees', JSON.stringify(uploadAttendees.map(a => a.trim()).filter(Boolean)));
        if (detectedDate) {
            // サーバー側でパース可能な ISO format で送信
            formData.append('date', `${detectedDate}T00:00:00Z`);
        }

        try {
            setLoading(true);
            await api.post(`/projects/${projectId}/meetings/upload`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setSnackbar({ open: true, message: 'アップロードが完了しました。解析を開始します。', severity: 'success' });
            fetchMeetings(); // 一覧を再取得
        } catch (err) {
            console.error('Upload failed:', err);
            setSnackbar({ open: true, message: 'アップロードに失敗しました。', severity: 'error' });
        } finally {
            setLoading(false);
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
                <Box>
                    <input
                        type="file"
                        id="meeting-upload-input"
                        accept="audio/*"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = ''; // 同じファイルを連続選択しても onChange が発火するように
                            if (!file) return;

                            // --- 会議実施日の自動検出ロジック ---
                            let detectedDateStr: string | null = null;

                            // 1. ファイル名から日付パターンを抽出 (例: 20260520 や 2026-05-20)
                            const yyyymmddMatch = file.name.match(/(\d{4})(\d{2})(\d{2})/);
                            const separatorMatch = file.name.match(/(\d{4})[-/_](\d{2})[-/_](\d{2})/);

                            if (yyyymmddMatch) {
                                const year = yyyymmddMatch[1];
                                const month = yyyymmddMatch[2];
                                const day = yyyymmddMatch[3];
                                const m = parseInt(month, 10);
                                const d = parseInt(day, 10);
                                if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
                                    detectedDateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                                }
                            }

                            if (!detectedDateStr && separatorMatch) {
                                const year = separatorMatch[1];
                                const month = separatorMatch[2];
                                const day = separatorMatch[3];
                                const m = parseInt(month, 10);
                                const d = parseInt(day, 10);
                                if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
                                    detectedDateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                                }
                            }

                            // 2. なければファイルの最終更新日 (file.lastModified) を使用してフォールバック
                            if (!detectedDateStr && file.lastModified) {
                                const lastModDate = new Date(file.lastModified);
                                const year = lastModDate.getFullYear();
                                const month = String(lastModDate.getMonth() + 1).padStart(2, '0');
                                const day = String(lastModDate.getDate()).padStart(2, '0');
                                detectedDateStr = `${year}-${month}-${day}`;
                            }
                            // ------------------------------------

                            setUploadTitle(file.name.split('.')[0]);
                            setUploadAttendees([]);
                            setPendingUpload({ file, detectedDate: detectedDateStr });
                        }}
                    />
                    <Button
                        variant="contained"
                        startIcon={<CloudUploadIcon />}
                        size={isMobile ? "small" : "medium"}
                        onClick={() => document.getElementById('meeting-upload-input')?.click()}
                        sx={{ borderRadius: 2, textTransform: 'none', boxShadow: 2 }}
                    >
                        ファイルを選択して追加
                    </Button>
                </Box>
            </Box>

            <MeetingRecorder projectId={projectId} onRecordingComplete={() => fetchMeetings(true)} />

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
                    {generatingCount > 0 && (
                        <Alert
                            severity="info"
                            icon={<CircularProgress size={20} />}
                            sx={{ mb: 2, alignItems: 'center', '& .MuiAlert-message': { width: '100%' } }}
                        >
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                議事録を生成中です（{generatingCount}件）
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                                完了すると自動で表示されます。ページを離れても処理は続きます。
                            </Typography>
                            <LinearProgress sx={{ borderRadius: 2 }} />
                        </Alert>
                    )}
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
                                            {meeting.analysis_seconds != null && (
                                                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.3 }}>
                                                    <ScheduleIcon sx={{ fontSize: 14 }} /> 生成時間: {fmtDuration(meeting.analysis_seconds)}
                                                </Typography>
                                            )}
                                        </Box>
                                    </Box>
                                    {meeting.status === 'failed' ? (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 2 }}>
                                            <Chip size="small" label="解析失敗" color="error" variant="outlined" />
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                color="primary"
                                                onClick={(e) => { e.stopPropagation(); handleReanalyze(meeting); }}
                                                sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                                            >
                                                再生成
                                            </Button>
                                        </Box>
                                    ) : isGenerating(meeting) && (
                                        <Chip
                                            size="small"
                                            label={generatingLabel(meeting)}
                                            color="info"
                                            variant={meeting.status === 'processing' ? 'filled' : 'outlined'}
                                            sx={{ mr: 2, fontWeight: 600 }}
                                            icon={meeting.status === 'processing' ? <CircularProgress size={12} color="inherit" /> : undefined}
                                        />
                                    )}
                                    {meeting.audio_url && (
                                        <IconButton
                                            size="small"
                                            component="a"
                                            href={`${meeting.audio_url}?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
                                            download
                                            title="音声をダウンロード"
                                            onClick={(e) => e.stopPropagation()}
                                            sx={{ mr: 0.5 }}
                                        >
                                            <DownloadIcon fontSize="small" />
                                        </IconButton>
                                    )}
                                    <IconButton
                                        size="small"
                                        title="参加者を編集"
                                        onClick={(e) => { e.stopPropagation(); handleOpenEditAttendees(meeting); }}
                                        sx={{ mr: 0.5 }}
                                    >
                                        <PeopleIcon fontSize="small" />
                                    </IconButton>
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
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                startIcon={<DownloadIcon fontSize="small" />}
                                                component="a"
                                                href={`${meeting.audio_url}?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
                                                download
                                                onClick={(e) => e.stopPropagation()}
                                                sx={{ textTransform: 'none' }}
                                            >
                                                音声をダウンロード
                                            </Button>
                                        )}
                                    </Grid>

                                    {isGenerating(meeting) && (
                                        <Grid item xs={12}>
                                            <GeneratingPanel meeting={meeting} />
                                            {meeting.transcript && (
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                                                    ※ 再生成中のため、以下は前回の議事録です。
                                                </Typography>
                                            )}
                                        </Grid>
                                    )}

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
                                    ) : !isGenerating(meeting) ? (
                                        <Grid item xs={12}>
                                            <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                                                議事録はまだありません。
                                            </Typography>
                                        </Grid>
                                    ) : null}
                                </Grid>
                            </AccordionDetails>
                        </Accordion>
                    ))}
                </Box>
            )}

            {/* アップロード確認ダイアログ（タイトル＋参加者） */}
            <Dialog open={!!pendingUpload} onClose={() => setPendingUpload(null)} maxWidth="sm" fullWidth>
                <DialogTitle>音声をアップロード</DialogTitle>
                <DialogContent dividers>
                    <TextField
                        autoFocus
                        fullWidth
                        label="会議のタイトル"
                        value={uploadTitle}
                        onChange={(e) => setUploadTitle(e.target.value)}
                        sx={{ mb: 2 }}
                    />
                    <AttendeesInput value={uploadAttendees} onChange={setUploadAttendees} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPendingUpload(null)}>キャンセル</Button>
                    <Button variant="contained" onClick={handleConfirmUpload}>アップロード</Button>
                </DialogActions>
            </Dialog>

            {/* 再生成確認ダイアログ（参加者の追記・修正が可能） */}
            <Dialog open={!!reanalyzeTarget} onClose={() => setReanalyzeTarget(null)} maxWidth="sm" fullWidth>
                <DialogTitle>サーバに残っている録音データから議事録を再生成しますか？</DialogTitle>
                <DialogContent dividers>
                    <Typography variant="body2" sx={{ mb: 1 }} color="text.secondary">
                        参加者名を確認・追記してください。担当者名の抽出精度が上がります。
                    </Typography>
                    <AttendeesInput value={reanalyzeAttendees} onChange={setReanalyzeAttendees} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setReanalyzeTarget(null)}>キャンセル</Button>
                    <Button variant="contained" color="primary" onClick={handleConfirmReanalyze}>再生成</Button>
                </DialogActions>
            </Dialog>

            {/* 参加者の後からの編集ダイアログ */}
            <Dialog open={!!editAttendeesTarget} onClose={() => setEditAttendeesTarget(null)} maxWidth="sm" fullWidth>
                <DialogTitle>参加者を編集</DialogTitle>
                <DialogContent dividers>
                    <AttendeesInput value={editAttendeesValue} onChange={setEditAttendeesValue} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setEditAttendeesTarget(null)}>キャンセル</Button>
                    <Button variant="contained" onClick={handleSaveAttendees}>保存</Button>
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
