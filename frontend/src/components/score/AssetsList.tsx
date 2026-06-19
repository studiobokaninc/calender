import React, { useState } from 'react';
import {
    Box,
    Typography,
    Stack,
    Paper,
    IconButton,
    Tooltip,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    alpha,
    useTheme,
    Chip,
} from '@mui/material';
import {
    Delete as DeleteIcon,
    Download as DownloadIcon,
    Image as ImageIcon,
    InsertDriveFile as FileIcon,
    Attachment as AttachmentIcon,
    ZoomIn as ZoomInIcon,
    PlayCircle as PlayCircleIcon,
} from '@mui/icons-material';
import { Asset } from '../../types';
import { deleteAsset } from '../../services/api';

interface AssetsListProps {
    assets: Asset[];
    compact?: boolean;
    onDeleted?: () => void;
    users?: { id: number; name?: string }[];
}

const getAssetUrl = (filePath: string): string => {
    const match = filePath.match(/\/static\/(.+)$/);
    if (match) return `/static/${match[1]}`;
    // fallback: use basename under /static/assets/
    const basename = filePath.split('/').pop() || filePath;
    return `/static/assets/${basename}`;
};

const getExt = (url: string): string => {
    try {
        return new URL(url).pathname.split('.').pop()?.toLowerCase() ?? '';
    } catch {
        return url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
    }
};

const isImage = (filePath: string): boolean =>
    /^(jpe?g|png|gif|webp|bmp|svg|tiff?)$/i.test(getExt(filePath));

const isPdf = (filePath: string): boolean => getExt(filePath) === 'pdf';

const isVideo = (filePath: string): boolean =>
    /^(mp4|webm|ogg|mov|avi|mkv|m4v|mpg|mpeg|ts)$/i.test(getExt(filePath));

const isText = (filePath: string): boolean =>
    /^(txt|md|csv|log|json|xml|yaml|yml|html?|css|js|ts)$/i.test(getExt(filePath));

const getBasename = (filePath: string): string =>
    filePath.split('/').pop() || filePath;

export const AssetsList: React.FC<AssetsListProps> = ({ assets, compact, onDeleted, users }) => {
    const theme = useTheme();
    const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [videoError, setVideoError] = useState(false);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [textContent, setTextContent] = useState<string | null>(null);
    const [textTitle, setTextTitle] = useState<string>('');
    const [deleting, setDeleting] = useState(false);

    const getUserName = (id: number) => users?.find(u => u.id === id)?.name ?? `#${id}`;

    const openTextModal = async (url: string, name: string) => {
        try {
            const res = await fetch(url);
            const text = await res.text();
            setTextTitle(name);
            setTextContent(text);
        } catch {
            window.open(url, '_blank');
        }
    };

    const handleDeleteConfirm = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await deleteAsset(deleteTarget.id);
            onDeleted?.();
        } finally {
            setDeleting(false);
            setDeleteTarget(null);
        }
    };

    if (assets.length === 0) {
        return (
            <Box sx={{ p: compact ? 2 : 5, textAlign: 'center', bgcolor: alpha(theme.palette.background.paper, 0.5), borderRadius: 3 }}>
                <AttachmentIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                <Typography color="text.secondary" variant={compact ? 'body2' : 'body1'}>
                    アセットはありません。
                </Typography>
            </Box>
        );
    }

    return (
        <>
            <Stack spacing={1.5}>
                {assets.map(asset => {
                    const url = getAssetUrl(asset.file_path);
                    const name = getBasename(asset.file_path);
                    const img = isImage(asset.file_path);

                    return (
                        <Paper
                            key={asset.id}
                            variant="outlined"
                            sx={{ p: 1.5, borderRadius: 1.5, bgcolor: alpha(theme.palette.background.paper, 0.8) }}
                        >
                            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                                {img ? (
                                    <Box
                                        component="img"
                                        src={url}
                                        alt={name}
                                        sx={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 1, flexShrink: 0, cursor: 'zoom-in' }}
                                        onClick={() => setPreviewAsset(asset)}
                                    />
                                ) : isVideo(asset.file_path) ? (
                                    <Tooltip title="動画を再生">
                                        <Box
                                            sx={{
                                                width: 56, height: 56, borderRadius: 1, flexShrink: 0,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                bgcolor: alpha(theme.palette.primary.main, 0.1),
                                                cursor: 'pointer',
                                                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.2) },
                                            }}
                                            onClick={() => { setVideoError(false); setVideoUrl(url); }}
                                        >
                                            <PlayCircleIcon color="primary" />
                                        </Box>
                                    </Tooltip>
                                ) : isPdf(asset.file_path) ? (
                                    <Tooltip title="PDFをプレビュー">
                                        <Box
                                            sx={{
                                                width: 56, height: 56, borderRadius: 1, flexShrink: 0,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                bgcolor: alpha(theme.palette.primary.main, 0.1),
                                                cursor: 'pointer',
                                                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.2) },
                                            }}
                                            onClick={() => setPdfUrl(url)}
                                        >
                                            <FileIcon color="primary" />
                                        </Box>
                                    </Tooltip>
                                ) : isText(asset.file_path) ? (
                                    <Tooltip title="テキストをプレビュー">
                                        <Box
                                            sx={{
                                                width: 56, height: 56, borderRadius: 1, flexShrink: 0,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                bgcolor: alpha(theme.palette.primary.main, 0.1),
                                                cursor: 'pointer',
                                                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.2) },
                                            }}
                                            onClick={() => openTextModal(url, name)}
                                        >
                                            <FileIcon color="primary" />
                                        </Box>
                                    </Tooltip>
                                ) : (
                                    <Tooltip title="新しいタブで開く">
                                        <a
                                            href={url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{ textDecoration: 'none' }}
                                        >
                                            <Box
                                                sx={{
                                                    width: 56, height: 56, borderRadius: 1, flexShrink: 0,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    bgcolor: alpha(theme.palette.primary.main, 0.1),
                                                    cursor: 'pointer',
                                                    '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.2) },
                                                }}
                                            >
                                                <FileIcon color="primary" />
                                            </Box>
                                        </a>
                                    </Tooltip>
                                )}

                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography variant="body2" sx={{ fontWeight: 700, wordBreak: 'break-all' }}>
                                        {name}
                                    </Typography>
                                    <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                                        <Chip label={`v${asset.version}`} size="small" sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700 }} />
                                        <Typography variant="caption" color="text.secondary">
                                            {getUserName(asset.created_by)} / {new Date(asset.created_at).toLocaleDateString('ja-JP')}
                                        </Typography>
                                    </Box>
                                </Box>

                                <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                                    {img && (
                                        <Tooltip title="プレビュー">
                                            <IconButton size="small" onClick={() => setPreviewAsset(asset)}>
                                                <ZoomInIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                    <Tooltip title="ダウンロード">
                                        <IconButton size="small" component="a" href={url} download={name} target="_blank">
                                            <DownloadIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="削除">
                                        <IconButton size="small" color="error" onClick={() => setDeleteTarget(asset)}>
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                            </Box>
                        </Paper>
                    );
                })}
            </Stack>

            {/* 動画再生ダイアログ */}
            <Dialog open={!!videoUrl} onClose={() => setVideoUrl(null)} maxWidth="lg" fullWidth>
                <DialogTitle sx={{ fontWeight: 700 }}>
                    {videoUrl ? getBasename(videoUrl) : ''}
                </DialogTitle>
                <DialogContent>
                    {videoUrl && (videoError ? (
                        <Box sx={{ p: 3, textAlign: 'center' }}>
                            <Typography variant="body1" color="text.secondary" gutterBottom>
                                このファイル形式はブラウザで再生できません。
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                ダウンロードボタンから取得して御確認ください。
                            </Typography>
                        </Box>
                    ) : (
                        <video
                            controls
                            autoPlay
                            style={{ width: '100%' }}
                            src={videoUrl ?? undefined}
                            onError={() => setVideoError(true)}
                        />
                    ))}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setVideoUrl(null)}>閉じる</Button>
                </DialogActions>
            </Dialog>

            {/* テキストプレビューダイアログ */}
            <Dialog open={textContent !== null} onClose={() => setTextContent(null)} maxWidth="md" fullWidth>
                <DialogTitle sx={{ fontWeight: 700 }}>{textTitle}</DialogTitle>
                <DialogContent>
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.85rem', margin: 0 }}>
                        {textContent}
                    </pre>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setTextContent(null)}>閉じる</Button>
                </DialogActions>
            </Dialog>

            {/* PDFプレビューダイアログ */}
            <Dialog open={!!pdfUrl} onClose={() => setPdfUrl(null)} maxWidth="lg" fullWidth>
                <DialogTitle sx={{ fontWeight: 700 }}>
                    {pdfUrl ? getBasename(pdfUrl) : ''}
                </DialogTitle>
                <DialogContent sx={{ p: 0 }}>
                    {pdfUrl && (
                        <iframe
                            src={pdfUrl}
                            style={{ width: '100%', height: '80vh', border: 'none' }}
                            title="PDF preview"
                        />
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPdfUrl(null)}>閉じる</Button>
                </DialogActions>
            </Dialog>

            {/* 画像プレビューダイアログ */}
            <Dialog open={!!previewAsset} onClose={() => setPreviewAsset(null)} maxWidth="md" fullWidth>
                <DialogTitle sx={{ fontWeight: 700 }}>
                    {previewAsset ? getBasename(previewAsset.file_path) : ''}
                </DialogTitle>
                <DialogContent>
                    {previewAsset && (
                        <Box sx={{ textAlign: 'center' }}>
                            <Box
                                component="img"
                                src={getAssetUrl(previewAsset.file_path)}
                                alt={getBasename(previewAsset.file_path)}
                                sx={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: 2 }}
                            />
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPreviewAsset(null)}>閉じる</Button>
                    {previewAsset && (
                        <Button
                            component="a"
                            href={getAssetUrl(previewAsset.file_path)}
                            download={getBasename(previewAsset.file_path)}
                            target="_blank"
                            startIcon={<DownloadIcon />}
                        >
                            ダウンロード
                        </Button>
                    )}
                </DialogActions>
            </Dialog>

            {/* 削除確認ダイアログ */}
            <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
                <DialogTitle sx={{ fontWeight: 700 }}>アセット削除の確認</DialogTitle>
                <DialogContent>
                    <Typography>
                        「{deleteTarget ? getBasename(deleteTarget.file_path) : ''}」を削除しますか？
                        この操作は取り消せません。
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>キャンセル</Button>
                    <Button color="error" variant="contained" onClick={handleDeleteConfirm} disabled={deleting}>
                        削除
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
