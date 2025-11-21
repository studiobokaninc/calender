import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Card,
  CardContent,
  CardActions,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Chip,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Image as ImageIcon,
  Close as CloseIcon,
  SelectAll as SelectAllIcon,
} from '@mui/icons-material';
import { notesApi } from '../services/api';
import { Note, NoteCreate, NoteUpdate } from '../types';

const NotesPage: React.FC = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewingNote, setViewingNote] = useState<Note | null>(null);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<number | null>(null);

  // メモ一覧を取得
  const fetchNotes = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await notesApi.getNotes(0, 100);
      setNotes(data);
    } catch (err: any) {
      console.error('メモの取得に失敗しました:', err);
      setError('メモの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotes();
  }, []);

  // 新規メモ作成
  const handleCreate = () => {
    setEditingNote(null);
    setTitle('');
    setContent('');
    setImageUrls([]);
    setDialogOpen(true);
  };

  // メモ全文表示
  const handleView = (note: Note) => {
    setViewingNote(note);
    setViewDialogOpen(true);
  };

  // メモ編集
  const handleEdit = (note: Note) => {
    setEditingNote(note);
    setTitle(note.title || '');
    setContent(note.content || '');
    setImageUrls(note.image_urls || []);
    setDialogOpen(true);
  };

  // メモ削除確認ダイアログを開く
  const handleDeleteClick = (noteId: number) => {
    setNoteToDelete(noteId);
    setDeleteDialogOpen(true);
  };

  // メモ削除実行
  const handleDeleteConfirm = async () => {
    if (noteToDelete === null) return;
    
    try {
      await notesApi.deleteNote(noteToDelete);
      await fetchNotes();
      setDeleteDialogOpen(false);
      setNoteToDelete(null);
    } catch (err: any) {
      console.error('メモの削除に失敗しました:', err);
      setError('メモの削除に失敗しました');
      setDeleteDialogOpen(false);
      setNoteToDelete(null);
    }
  };

  // 画像アップロード
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 画像ファイルのみ許可
    if (!file.type.startsWith('image/')) {
      setError('画像ファイルのみアップロード可能です');
      return;
    }

    try {
      setUploadingImage(true);
      setError(null);
      console.log('画像アップロード開始:', file.name, file.type, file.size);
      const result = await notesApi.uploadImage(file);
      console.log('画像アップロード成功:', result);
      if (result && result.url) {
        setImageUrls([...imageUrls, result.url]);
      } else {
        throw new Error('アップロード結果にURLが含まれていません');
      }
    } catch (err: any) {
      console.error('画像のアップロードに失敗しました:', err);
      let errorMessage = '画像のアップロードに失敗しました';
      if (err?.response?.data?.detail) {
        // バリデーションエラーの場合、detailを適切に処理
        const detail = err.response.data.detail;
        if (Array.isArray(detail)) {
          errorMessage = detail.map((e: any) => e.msg || JSON.stringify(e)).join(', ');
        } else if (typeof detail === 'string') {
          errorMessage = detail;
        } else {
          errorMessage = JSON.stringify(detail);
        }
      } else if (err?.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 画像削除
  const handleRemoveImage = (index: number) => {
    setImageUrls(imageUrls.filter((_, i) => i !== index));
  };

  // メモ保存
  const handleSave = async () => {
    try {
      setError(null);
      const noteData: NoteCreate | NoteUpdate = {
        title: title.trim() || null,
        content: content.trim() || null,
        image_urls: imageUrls.length > 0 ? imageUrls : null,
      };

      if (editingNote) {
        await notesApi.updateNote(editingNote.id, noteData);
      } else {
        await notesApi.createNote(noteData);
      }

      setDialogOpen(false);
      await fetchNotes();
    } catch (err: any) {
      console.error('メモの保存に失敗しました:', err);
      setError('メモの保存に失敗しました');
    }
  };

  // 日時フォーマット
  const formatDateTime = (dateString: string | null | undefined) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Box sx={{ height: 'calc(100vh - 70px)', display: 'flex', flexDirection: 'column', p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" component="h1">
          メモ
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleCreate}
        >
          新規メモ
        </Button>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
          <CircularProgress />
        </Box>
      ) : notes.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
          <Typography variant="body1" color="text.secondary">
            メモがありません。新規メモを作成してください。
          </Typography>
        </Box>
      ) : (
        <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
          <Grid container spacing={2} sx={{ pt: 1 }}>
            {notes.map((note) => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={note.id}>
                <Card
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    backgroundColor: 'background.paper',
                    border: '1px solid',
                    borderColor: 'divider',
                    transition: 'transform 0.2s, box-shadow 0.2s',
                    cursor: 'pointer',
                    boxShadow: 1,
                    '&:hover': {
                      transform: 'translateY(-4px)',
                      boxShadow: 4,
                      borderColor: 'primary.light',
                    },
                  }}
                  onClick={() => handleView(note)}
                >
                  <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                    {note.title && (
                      <Typography variant="h6" component="h2" gutterBottom sx={{ fontWeight: 'bold' }}>
                        {note.title}
                      </Typography>
                    )}
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        flexGrow: 1,
                        mb: 1,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {note.content || '(内容なし)'}
                    </Typography>
                    {note.image_urls && note.image_urls.length > 0 && (
                      <Box sx={{ mb: 1 }}>
                        <Chip
                          icon={<ImageIcon />}
                          label={`${note.image_urls.length}枚の画像`}
                          size="small"
                          variant="outlined"
                        />
                      </Box>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {formatDateTime(note.created_at)}
                    </Typography>
                  </CardContent>
                  <CardActions sx={{ justifyContent: 'flex-end', pt: 0 }} onClick={(e) => e.stopPropagation()}>
                    <IconButton
                      size="small"
                      onClick={() => handleEdit(note)}
                      color="primary"
                    >
                      <EditIcon />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteClick(note.id);
                      }}
                      color="error"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </CardActions>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {/* メモ全文表示ダイアログ */}
      <Dialog
        open={viewDialogOpen}
        onClose={() => setViewDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: { maxHeight: '90vh' },
        }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ flexGrow: 1 }}>{viewingNote?.title || 'メモ'}</Box>
          <IconButton
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              
              // メモ本文を選択
              if (contentRef.current) {
                const range = document.createRange();
                range.selectNodeContents(contentRef.current);
                const selection = window.getSelection();
                if (selection) {
                  selection.removeAllRanges();
                  selection.addRange(range);
                }
              }
            }}
            color="primary"
            size="small"
            title="メモ本文を選択（Ctrl+Cでコピー）"
          >
            <SelectAllIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box
            ref={contentRef}
            component="pre"
            sx={{
              fontFamily: 'inherit',
              fontSize: '1rem',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              mb: 2,
              p: 1,
              border: '1px solid transparent',
              borderRadius: 1,
              cursor: 'text',
              userSelect: 'text',
              '&:hover': {
                backgroundColor: 'action.hover',
              },
            }}
            onClick={(e) => {
              // クリック時にテキストを選択
              const range = document.createRange();
              range.selectNodeContents(e.currentTarget);
              const selection = window.getSelection();
              if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
              }
            }}
          >
            {viewingNote?.content || '(内容なし)'}
          </Box>
          
          {/* 画像表示 */}
          {viewingNote?.image_urls && viewingNote.image_urls.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 2 }}>
              {viewingNote.image_urls.map((url, index) => {
                const imageUrl = url.startsWith('http') ? url : `${window.location.origin}${url}`;
                return (
                  <Box
                    key={index}
                    onClick={() => setExpandedImage(imageUrl)}
                    sx={{
                      position: 'relative',
                      maxWidth: 300,
                      maxHeight: 300,
                      border: '1px solid #ddd',
                      borderRadius: 1,
                      overflow: 'hidden',
                      cursor: 'pointer',
                      transition: 'transform 0.2s',
                      '&:hover': {
                        transform: 'scale(1.05)',
                        borderColor: 'primary.main',
                      },
                    }}
                  >
                    <img
                      src={imageUrl}
                      alt={`メモ画像 ${index + 1}`}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                      }}
                    />
                  </Box>
                );
              })}
            </Box>
          )}
          
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            作成日時: {formatDateTime(viewingNote?.created_at)}
            {viewingNote?.updated_at && viewingNote.updated_at !== viewingNote?.created_at && (
              <> / 更新日時: {formatDateTime(viewingNote.updated_at)}</>
            )}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            if (viewingNote) {
              handleEdit(viewingNote);
              setViewDialogOpen(false);
            }
          }} startIcon={<EditIcon />}>
            編集
          </Button>
          <Button onClick={() => setViewDialogOpen(false)} variant="contained">
            閉じる
          </Button>
        </DialogActions>
      </Dialog>

      {/* メモ作成/編集ダイアログ */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: { maxHeight: '90vh' },
        }}
      >
        <DialogTitle>
          {editingNote ? 'メモを編集' : '新規メモを作成'}
        </DialogTitle>
        <DialogContent dividers>
          <TextField
            label="タイトル"
            fullWidth
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            margin="normal"
            placeholder="メモのタイトル（任意）"
          />
          <TextField
            label="内容"
            fullWidth
            multiline
            rows={8}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            margin="normal"
            placeholder="メモの内容を入力してください"
          />
          
          {/* 画像アップロード */}
          <Box sx={{ mt: 2 }}>
            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
            <Button
              variant="outlined"
              startIcon={<ImageIcon />}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingImage}
              sx={{ mb: 2 }}
            >
              {uploadingImage ? 'アップロード中...' : '画像を添付'}
            </Button>

            {/* 画像プレビュー */}
            {imageUrls.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
                {imageUrls.map((url, index) => (
                  <Box
                    key={index}
                    sx={{
                      position: 'relative',
                      width: 150,
                      height: 150,
                      border: '1px solid #ddd',
                      borderRadius: 1,
                      overflow: 'hidden',
                    }}
                  >
                    <img
                      src={url.startsWith('http') ? url : `${window.location.origin}${url}`}
                      alt={`アップロード画像 ${index + 1}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const imageUrl = url.startsWith('http') ? url : `${window.location.origin}${url}`;
                        setExpandedImage(imageUrl);
                      }}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        cursor: 'pointer',
                      }}
                    />
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveImage(index);
                      }}
                      sx={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        bgcolor: 'rgba(0,0,0,0.5)',
                        color: 'white',
                        '&:hover': {
                          bgcolor: 'rgba(0,0,0,0.7)',
                        },
                      }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>キャンセル</Button>
          <Button onClick={handleSave} variant="contained">
            保存
          </Button>
        </DialogActions>
      </Dialog>

      {/* 画像拡大表示ダイアログ */}
      <Dialog
        open={!!expandedImage}
        onClose={() => setExpandedImage(null)}
        maxWidth={false}
        PaperProps={{
          sx: {
            maxWidth: '95vw',
            maxHeight: '95vh',
            m: 2,
          },
        }}
      >
        <DialogContent
          sx={{
            p: 0,
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minWidth: 'min(90vw, 800px)',
            minHeight: 'min(90vh, 600px)',
            bgcolor: 'rgba(0, 0, 0, 0.9)',
          }}
        >
          <IconButton
            onClick={() => setExpandedImage(null)}
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              bgcolor: 'rgba(255, 255, 255, 0.9)',
              zIndex: 1,
              '&:hover': {
                bgcolor: 'rgba(255, 255, 255, 1)',
              },
            }}
          >
            <CloseIcon />
          </IconButton>
          {expandedImage && (
            <img
              src={expandedImage}
              alt="拡大画像"
              style={{
                maxWidth: '100%',
                maxHeight: '95vh',
                objectFit: 'contain',
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 削除確認ダイアログ */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setNoteToDelete(null);
        }}
      >
        <DialogTitle>メモの削除</DialogTitle>
        <DialogContent>
          <Typography>
            このメモを削除しますか？
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDeleteDialogOpen(false);
              setNoteToDelete(null);
            }}
          >
            キャンセル
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
          >
            削除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default NotesPage;

