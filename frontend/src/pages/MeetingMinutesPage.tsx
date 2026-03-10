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
        <Box sx={{ p: 3 }}>
            <Box sx={{ mb: 3 }}>
                <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} aria-label="breadcrumb">
                    <Link color="inherit" href="/" onClick={(e) => e.preventDefault()}>
                        ダッシュボード
                    </Link>
                    <Typography color="text.primary">議事録管理</Typography>
                </Breadcrumbs>
                <Typography variant="h4" sx={{ mt: 2, fontWeight: 'bold' }}>
                    議事録管理
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    プロジェクトを選択して、会議音声のアップロードやAI解析結果を確認できます。
                </Typography>
            </Box>

            <Grid container spacing={3}>
                {/* 左側：プロジェクト選択 */}
                <Grid item xs={12} md={4}>
                    <Paper sx={{ p: 2 }}>
                        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
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

                {/* 右側：選択したプロジェクトの会議一覧 */}
                <Grid item xs={12} md={8}>
                    {selectedProjectId ? (
                        <Paper sx={{ p: 3, minHeight: '600px' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                                <DescriptionIcon sx={{ mr: 1, color: 'secondary.main' }} />
                                <Typography variant="h6">
                                    {projects.find(p => p.id === selectedProjectId)?.name} - 議事録一覧
                                </Typography>
                            </Box>
                            <ProjectMeetings projectId={selectedProjectId} />
                        </Paper>
                    ) : (
                        <Paper
                            sx={{
                                p: 3,
                                minHeight: '600px',
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center',
                                alignItems: 'center',
                                bgcolor: 'action.hover'
                            }}
                        >
                            <DescriptionIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                            <Typography variant="h6" color="text.secondary">
                                左側のリストからプロジェクトを選択してください
                            </Typography>
                        </Paper>
                    )}
                </Grid>
            </Grid>
        </Box>
    );
};

export default MeetingMinutesPage;
