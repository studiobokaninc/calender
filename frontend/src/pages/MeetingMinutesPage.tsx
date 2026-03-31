import React, { useState, useEffect } from 'react';
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
    NavigateNext as NavigateNextIcon,
} from '@mui/icons-material';
import { Project } from '../types';
import api from '../services/api';
import ProjectMeetings from '../components/ProjectMeetings';

const MeetingMinutesPage: React.FC = () => {
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
            <Box sx={{ mb: 3 }}>
                {!isMobile && (
                    <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} aria-label="breadcrumb">
                        <Link color="inherit" href="/" onClick={(e) => e.preventDefault()}>
                            ダッシュボード
                        </Link>
                        <Typography color="text.primary">議事録管理</Typography>
                    </Breadcrumbs>
                )}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: isMobile ? 0 : 2 }}>
                    <Typography variant={isMobile ? "h5" : "h4"} sx={{ fontWeight: 'bold' }}>
                        議事録管理
                    </Typography>
                    <Button
                        variant="outlined"
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
                        sx={{ borderRadius: 2 }}
                    >
                        ネットワークドライブをスキャン
                    </Button>
                </Box>
                {!isMobile && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, display: 'flex', alignItems: 'center' }}>
                        プロジェクトを選択して、AI解析結果を確認できます。スキャンボタンをクリックするとXドライブ
                        (<span style={{ fontFamily: 'monospace', margin: '0 4px', color: theme.palette.primary.main }}>X:\cg\proj\kikaku\MTG_audio</span>)
                        内の音声データが自動的に同期されます。
                        <Button
                            size="small"
                            variant="text"
                            onClick={async () => {
                                try {
                                    await api.post('/meetings/open-explorer', { path: 'X:\\cg\\proj\\kikaku\\MTG_audio' });
                                } catch (err) {
                                    console.error('Failed to open explorer:', err);
                                    alert('エクスプローラーを開けませんでした');
                                }
                            }}
                            sx={{ minWidth: 'auto', p: 0.5, ml: 1, fontSize: '0.75rem', textTransform: 'none' }}
                            title="このフォルダをエクスプローラで開く"
                        >
                            [フォルダを開く]
                        </Button>
                    </Typography>
                )}
            </Box>

            <Grid container spacing={isMobile ? 2 : 3}>
                {/* 左側：プロジェクト選択 */}
                {(!isMobile || !selectedProjectId) && (
                    <Grid item xs={12} md={4}>
                        <Paper sx={{ p: 2, borderRadius: 3 }}>
                            <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', fontSize: isMobile ? '1rem' : '1.25rem' }}>
                                <FolderIcon sx={{ mr: 1, color: 'primary.main' }} />
                                プロジェクト選択
                            </Typography>
                            <Divider sx={{ mb: 2 }} />

                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
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
                                                transition: '0.2s'
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
