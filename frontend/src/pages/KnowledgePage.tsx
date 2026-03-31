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
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
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
    ExpandMore as ExpandMoreIcon,
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
    content_text?: string;
    file_path: string;
    tags: KnowledgeTag[];
    created_at: string;
}

const KnowledgePage: React.FC = () => {
    const [items, setItems] = useState<KnowledgeItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [title, setTitle] = useState('');
    const [selectedItem, setSelectedItem] = useState<KnowledgeItem | null>(null);
    const [openDialog, setOpenDialog] = useState(false);

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

    const handleItemClick = (item: KnowledgeItem) => {
        setSelectedItem(item);
        setOpenDialog(true);
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
                                    <Card
                                        sx={{
                                            display: 'flex',
                                            borderRadius: 2,
                                            boxShadow: 1,
                                            cursor: 'pointer',
                                            '&:hover': { boxShadow: 4, transition: '0.3s' },
                                            position: 'relative'
                                        }}
                                        onClick={() => handleItemClick(item)}
                                    >
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
                                            <IconButton
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDelete(item.id);
                                                }}
                                                color="error"
                                                size="small"
                                            >
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

            {/* Item Detail Dialog */}
            <Dialog
                open={openDialog}
                onClose={() => setOpenDialog(false)}
                maxWidth="md"
                fullWidth
                PaperProps={{
                    sx: { borderRadius: 3 }
                }}
            >
                {selectedItem && (
                    <>
                        <DialogTitle sx={{ pb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                {getFileIcon(selectedItem.file_type)}
                                <Box>
                                    <Typography variant="h6" sx={{ fontWeight: 'bold', lineHeight: 1.1 }}>
                                        {selectedItem.title}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {selectedItem.file_name}
                                    </Typography>
                                </Box>
                            </Box>
                            <IconButton onClick={() => setOpenDialog(false)} size="small">
                                <ExpandMoreIcon sx={{ transform: 'rotate(180deg)' }} />
                            </IconButton>
                        </DialogTitle>
                        <DialogContent dividers sx={{ bgcolor: 'background.default', py: 3 }}>
                            <Grid container spacing={3}>
                                <Grid item xs={12}>
                                    <Typography variant="subtitle2" color="primary" gutterBottom sx={{ fontWeight: 'bold' }}>
                                        AI要約
                                    </Typography>
                                    <Paper sx={{ p: 2, borderRadius: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                                            {selectedItem.summary || '解析中、または要約が生成されませんでした。'}
                                        </Typography>
                                    </Paper>
                                </Grid>

                                <Grid item xs={12}>
                                    <Typography variant="subtitle2" color="primary" gutterBottom sx={{ fontWeight: 'bold' }}>
                                        解析内容 (フルテキスト)
                                    </Typography>
                                    <Paper sx={{
                                        p: 2,
                                        borderRadius: 2,
                                        bgcolor: 'background.paper',
                                        border: '1px solid',
                                        borderColor: 'divider',
                                        maxHeight: 400,
                                        overflow: 'auto'
                                    }}>
                                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontFamily: 'serif' }}>
                                            {selectedItem.content_text || '内容の抽出は行われませんでした。'}
                                        </Typography>
                                    </Paper>
                                </Grid>
                            </Grid>
                        </DialogContent>
                        <DialogActions sx={{ p: 2, justifyContent: 'space-between' }}>
                            <Box sx={{ ml: 1 }}>
                                {selectedItem.tags.map(tag => (
                                    <Chip key={tag.id} label={`#${tag.name}`} size="small" sx={{ mr: 0.5 }} />
                                ))}
                            </Box>
                            <Box>
                                <Button onClick={() => setOpenDialog(false)} sx={{ mr: 1 }}>
                                    閉じる
                                </Button>
                                <Button
                                    variant="contained"
                                    startIcon={<UploadIcon sx={{ transform: 'rotate(180deg)' }} />}
                                    component="a"
                                    href={selectedItem.file_path}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    ファイルを開く
                                </Button>
                            </Box>
                        </DialogActions>
                    </>
                )}
            </Dialog>
        </Box>
    );
};

export default KnowledgePage;
