import React, { useState, useEffect, useCallback } from 'react';
import {
    Box,
    Typography,
    Paper,
    Button,
    Grid,
    Card,
    CardContent,
    Chip,
    IconButton,
    TextField,
    CircularProgress,
} from '@mui/material';
import {
    CloudUpload as UploadIcon,
    Delete as DeleteIcon,
    Description as DocIcon,
    PictureAsPdf as PdfIcon,
    InsertChart as ExcelIcon,
    Slideshow as PptIcon,
    Image as ImageIcon,
    Audiotrack as AudioIcon,
    Refresh as RefreshIcon,
} from '@mui/icons-material';
import api from '../services/api';

interface KnowledgeTag {
    id: number;
    name: string;
}

interface KnowledgeItem {
    id: number;
    title: string;
    file_name: string;
    file_type: string;
    status: string;
    summary?: string;
    tags: KnowledgeTag[];
    created_at: string;
}

const KnowledgePage: React.FC = () => {
    const [items, setItems] = useState<KnowledgeItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [title, setTitle] = useState('');

    const fetchItems = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const res = await api.get<KnowledgeItem[]>('/knowledge');
            // Sort by created_at desc
            const sorted = res.data.sort((a, b) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
            setItems(sorted);
        } catch (err) {
            console.error('Failed to fetch knowledge items:', err);
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchItems();
    }, [fetchItems]);

    useEffect(() => {
        const hasProcessing = items.some(item => item.status === 'processing');
        if (hasProcessing) {
            const interval = setInterval(() => {
                fetchItems(true);
            }, 5000);
            return () => clearInterval(interval);
        }
    }, [items, fetchItems]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            if (!title) {
                // Remove extension for title
                const name = e.target.files[0].name.split('.').slice(0, -1).join('.') || e.target.files[0].name;
                setTitle(name);
            }
        }
    };

    const handleUpload = async () => {
        if (!file || !title) return;
        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', title);

        try {
            await api.post('/knowledge/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            setFile(null);
            setTitle('');
            fetchItems();
        } catch (err) {
            console.error('Upload failed:', err);
            alert('アップロードに失敗しました');
        } finally {
            setUploading(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!window.confirm('このアイテムを削除してもよろしいですか？')) return;
        try {
            await api.delete(`/knowledge/${id}`);
            fetchItems();
        } catch (err) {
            console.error('Delete failed:', err);
        }
    };

    const getFileIcon = (type: string) => {
        switch (type) {
            case 'pdf': return <PdfIcon color="error" />;
            case 'excel': return <ExcelIcon color="success" />;
            case 'ppt': return <PptIcon color="warning" />;
            case 'image': return <ImageIcon color="primary" />;
            case 'audio': return <AudioIcon color="secondary" />;
            default: return <DocIcon color="action" />;
        }
    };

    return (
        <Box sx={{ p: { xs: 2, sm: 3 }, height: '100%', overflow: 'auto' }}>
            <Box sx={{ mb: 4 }}>
                <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold' }}>
                    ナレッジ基盤
                </Typography>
                <Typography variant="body1" color="text.secondary">
                    PDF、Excel、音声、画像などをアップロードしてAIに整理・検索させることができます。
                    チャットでの回答精度が向上します。
                </Typography>
            </Box>

            <Grid container spacing={3}>
                {/* Upload Section */}
                <Grid item xs={12} lg={4}>
                    <Paper sx={{ p: 3, borderRadius: 3, boxShadow: 3, height: 'fit-content' }}>
                        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <UploadIcon color="primary" /> ファイルをアップロード
                        </Typography>
                        <Box sx={{ mt: 3 }}>
                            <Typography variant="body2" sx={{ mb: 1, ml: 0.5, fontWeight: 'bold' }}>
                                ナレッジ名
                            </Typography>
                            <TextField
                                fullWidth
                                placeholder="例: 2024年度営業戦略資料"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                sx={{ mb: 3 }}
                                size="small"
                            />

                            <Box
                                sx={{
                                    border: '2px dashed',
                                    borderColor: file ? 'primary.main' : 'divider',
                                    borderRadius: 2,
                                    p: 3,
                                    textAlign: 'center',
                                    mb: 3,
                                    bgcolor: file ? 'primary.50' : 'transparent',
                                    transition: 'all 0.2s'
                                }}
                            >
                                <input
                                    type="file"
                                    id="file-upload"
                                    hidden
                                    onChange={handleFileChange}
                                />
                                <label htmlFor="file-upload">
                                    <IconButton color="primary" component="span" sx={{ mb: 1 }}>
                                        <DocIcon fontSize="large" />
                                    </IconButton>
                                    <Typography variant="body2" color="text.secondary" sx={{ cursor: 'pointer' }}>
                                        {file ? file.name : 'クリックしてファイルを選択'}
                                    </Typography>
                                </label>
                            </Box>

                            <Button
                                variant="contained"
                                fullWidth
                                disabled={!file || !title || uploading}
                                onClick={handleUpload}
                                sx={{
                                    py: 1.5,
                                    borderRadius: 2,
                                    fontWeight: 'bold',
                                    boxShadow: 2
                                }}
                            >
                                {uploading ? <CircularProgress size={24} color="inherit" /> : 'アップロードして解析開始'}
                            </Button>
                        </Box>
                    </Paper>
                </Grid>

                {/* List Section */}
                <Grid item xs={12} lg={8}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                            ナレッジ一覧 ({items.length})
                        </Typography>
                        <IconButton onClick={() => fetchItems()} disabled={loading} size="small">
                            <RefreshIcon />
                        </IconButton>
                    </Box>

                    {loading && items.length === 0 ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                            <CircularProgress />
                        </Box>
                    ) : items.length === 0 ? (
                        <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 3, bgcolor: 'action.hover', border: '1px dashed divider' }}>
                            <DocIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
                            <Typography color="text.secondary">
                                ナレッジがまだ登録されていません。<br />左側のパネルからアップロードしてください。
                            </Typography>
                        </Paper>
                    ) : (
                        <Grid container spacing={2}>
                            {items.map((item) => (
                                <Grid item xs={12} key={item.id}>
                                    <Card sx={{
                                        display: 'flex',
                                        borderRadius: 2,
                                        boxShadow: 1,
                                        '&:hover': { boxShadow: 4, transition: '0.3s' },
                                        position: 'relative'
                                    }}>
                                        <Box sx={{
                                            p: 2,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            bgcolor: 'action.selected',
                                            minWidth: 80
                                        }}>
                                            {getFileIcon(item.file_type)}
                                        </Box>
                                        <CardContent sx={{ flex: 1, py: 2 }}>
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5 }}>
                                                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', lineHeight: 1.2 }}>
                                                    {item.title}
                                                </Typography>
                                                <Chip
                                                    label={item.status === 'completed' ? '処理完了' : item.status === 'processing' ? '解析中...' : '失敗'}
                                                    size="small"
                                                    color={item.status === 'completed' ? 'success' : item.status === 'processing' ? 'primary' : 'error'}
                                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                                />
                                            </Box>
                                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                                                {item.file_name} • {new Date(item.created_at).toLocaleDateString()}
                                            </Typography>

                                            {item.summary && (
                                                <Typography
                                                    variant="body2"
                                                    sx={{
                                                        color: 'text.secondary',
                                                        fontSize: '0.875rem',
                                                        display: '-webkit-box',
                                                        WebkitLineClamp: 2,
                                                        WebkitBoxOrient: 'vertical',
                                                        overflow: 'hidden',
                                                        mb: 1
                                                    }}
                                                >
                                                    {item.summary}
                                                </Typography>
                                            )}

                                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                                {item.tags.map((tag) => (
                                                    <Chip
                                                        key={tag.id}
                                                        label={`#${tag.name}`}
                                                        size="small"
                                                        variant="outlined"
                                                        sx={{ height: 20, fontSize: '0.7rem' }}
                                                    />
                                                ))}
                                            </Box>
                                        </CardContent>
                                        <Box sx={{ p: 1, display: 'flex', alignItems: 'center' }}>
                                            <IconButton onClick={() => handleDelete(item.id)} color="error" size="small">
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Box>
                                    </Card>
                                </Grid>
                            ))}
                        </Grid>
                    )}
                </Grid>
            </Grid>
        </Box>
    );
};

export default KnowledgePage;
