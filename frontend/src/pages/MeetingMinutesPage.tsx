import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box,
    Typography,
    Paper,
    Grid,
    Card,
    CardContent,
    CardActionArea,
    Breadcrumbs,
    Link,
    CircularProgress,
    Divider,
    useMediaQuery,
    useTheme,
    Button,
} from '@mui/material';
import {
    Description as DescriptionIcon,
    Folder as FolderIcon,
} from '@mui/icons-material';
import { Project } from '../types';
import api from '../services/api';
import ProjectMeetings from '../components/ProjectMeetings';

const MeetingMinutesPage: React.FC = () => {
    const navigate = useNavigate();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchProjects = async () => {
            try {
                const res = await api.get<Project[]>('/projects');
                // オンラインのプロジェクトのみを表示
                const onlineProjects = res.data.filter(p => p.display_status === 'online');
                setProjects(onlineProjects);
                setLoading(false);
            } catch (err) {
                console.error('Failed to fetch projects:', err);
                setLoading(false);
            }
        };
        fetchProjects();
    }, []);

    const handleProjectChange = (projectId: number) => {
        setSelectedProjectId(projectId);
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ p: isMobile ? 2 : 3, pb: isMobile ? 10 : 3 }}>
            <Box sx={{ mb: 4 }}>
                <Breadcrumbs sx={{ mb: 1.5 }}>
                    <Link color="inherit" onClick={() => navigate('/dashboard')} sx={{ cursor: 'pointer', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                        App
                    </Link>
                    <Typography color="text.primary" sx={{ fontWeight: 500 }}>Meetings</Typography>
                </Breadcrumbs>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <DescriptionIcon sx={{ fontSize: '2rem', color: '#4CAF50' }} />
                            <Typography
                                variant="h4"
                                sx={{
                                    fontWeight: 800,
                                    background: 'linear-gradient(45deg, #4CAF50 30%, #8BC34A 90%)',
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                    fontSize: { xs: '1.75rem', sm: '2.25rem' }
                                }}
                            >
                                Meetings & Minutes
                            </Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.95rem' }}>
                            録音データからのAI解析、決定事項、タスクの抽出を一元管理します。
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 2, borderLeft: '4px solid', borderColor: 'primary.main', minWidth: 'fit-content' }}>
                            <Typography variant="caption" color="text.primary" sx={{ display: 'block', fontWeight: 'bold', mb: 0.5 }}>
                                [ネットワークドライブ]
                            </Typography>
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                                X:\cg\proj\kikaku\MTG_audio
                            </Typography>
                        </Box>
                        <Button
                            variant="contained"
                            startIcon={<DescriptionIcon />}
                            onClick={async () => {
                                if (window.confirm('Xドライブのスキャンを開始しますか？')) {
                                    try {
                                        await api.post('/meetings/scan');
                                        alert('スキャンを開始しました。新しい会議が順次追加されます。');
                                    } catch (err) {
                                        console.error('Scan failed:', err);
                                        alert('スキャンに失敗しました。');
                                    }
                                }
                            }}
                            sx={{
                                textTransform: 'none',
                                borderRadius: 2,
                                px: 3,
                                fontWeight: 600,
                                boxShadow: '0 4px 12px rgba(255, 82, 82, 0.2)',
                                bgcolor: '#FF5252',
                                '&:hover': {
                                    bgcolor: '#FF1744',
                                    boxShadow: '0 6px 16px rgba(255, 82, 82, 0.3)',
                                }
                            }}
                        >
                            ネットワークドライブをスキャン
                        </Button>
                    </Box>
                </Box>
            </Box>

            <Grid container spacing={isMobile ? 2 : 3}>
                {/* 左側：プロジェクト選択 */}
                {(!isMobile || !selectedProjectId) && (
                    <Grid item xs={12} md={4} sx={{ position: { md: 'sticky' }, top: { md: 24 }, alignSelf: { md: 'flex-start' } }}>
                        <Paper sx={{
                            p: 2,
                            borderRadius: 3,
                            display: 'flex',
                            flexDirection: 'column',
                            maxHeight: { md: 'calc(100vh - 160px)' }, // Paper自体の高さを制限し、画面内に収まるように調整
                            boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
                        }}>
                            <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', fontSize: isMobile ? '1rem' : '1.25rem' }}>
                                <FolderIcon sx={{ mr: 1, color: 'primary.main' }} />
                                プロジェクト選択
                            </Typography>
                            <Divider sx={{ mb: 2 }} />

                            <Box sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 1,
                                overflowY: 'auto',
                                pr: 1,
                                pb: 2, // 下部が絶対に見切れないよう十分な余白を確保
                                '&::-webkit-scrollbar': {
                                    width: '6px',
                                },
                                '&::-webkit-scrollbar-thumb': {
                                    backgroundColor: 'rgba(0,0,0,0.1)',
                                    borderRadius: '3px',
                                }
                            }}>
                                {projects.length === 0 ? (
                                    <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                                        プロジェクトがありません。
                                    </Typography>
                                ) : (
                                    projects.map((project) => (
                                        <Card
                                            key={project.id}
                                            variant="outlined"
                                            sx={{
                                                borderRadius: 2,
                                                borderColor: selectedProjectId === project.id ? 'primary.main' : 'divider',
                                                bgcolor: selectedProjectId === project.id
                                                    ? (theme) => theme.palette.mode === 'dark' ? 'rgba(33, 150, 243, 0.2)' : 'primary.50'
                                                    : 'inherit',
                                                transition: '0.2s',
                                                '&:hover': {
                                                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)',
                                                }
                                            }}
                                        >
                                            <CardActionArea onClick={() => handleProjectChange(project.id)}>
                                                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                                                    <Typography variant="subtitle2" noWrap>
                                                        {project.name}
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        ステータス: {project.status}
                                                    </Typography>
                                                </CardContent>
                                            </CardActionArea>
                                        </Card>
                                    ))
                                )}
                            </Box>
                        </Paper>
                    </Grid>
                )}

                {/* 右側：選択したプロジェクトの会議一覧 */}
                {(!isMobile || selectedProjectId) && (
                    <Grid item xs={12} md={8}>
                        {selectedProjectId ? (
                            <Paper sx={{ p: isMobile ? 2 : 3, minHeight: isMobile ? 'auto' : '600px', borderRadius: 3 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, justifyContent: 'space-between' }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                                        <DescriptionIcon sx={{ mr: 1, color: 'secondary.main', flexShrink: 0 }} />
                                        <Typography variant="h6" noWrap sx={{ fontSize: isMobile ? '1rem' : '1.25rem' }}>
                                            {projects.find(p => p.id === selectedProjectId)?.name}
                                        </Typography>
                                    </Box>
                                    {isMobile && (
                                        <Button
                                            size="small"
                                            onClick={() => setSelectedProjectId(null)}
                                            variant="outlined"
                                            sx={{ borderRadius: 2, ml: 1, flexShrink: 0 }}
                                        >
                                            戻る
                                        </Button>
                                    )}
                                </Box>
                                <ProjectMeetings projectId={selectedProjectId} />
                            </Paper>
                        ) : !isMobile && (
                            <Paper
                                sx={{
                                    p: 3,
                                    minHeight: '600px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    bgcolor: 'action.hover',
                                    borderRadius: 3
                                }}
                            >
                                <DescriptionIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                                <Typography variant="h6" color="text.secondary">
                                    左側のリストからプロジェクトを選択してください
                                </Typography>
                            </Paper>
                        )}
                    </Grid>
                )}
            </Grid>
        </Box>
    );
};

export default MeetingMinutesPage;
