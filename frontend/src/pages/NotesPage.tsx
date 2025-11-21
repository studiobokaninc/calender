import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  IconButton,
  CircularProgress,
  Alert,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { notesApi } from '../services/api';
import api from '../services/api';
import { Note, NoteCreate, NoteUpdate, Project } from '../types';
import { usePageState } from '../contexts/PageStateContext';

interface ImageItem {
  url: string;
  width: number;
  height: number;
  x: number;
  y: number;
  aspectRatio?: number; // 画像のアスペクト比（幅/高さ）
}

const NotesPage: React.FC = () => {
  const { pageStates, updatePageState, isInitialLoad } = usePageState();
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [images, setImages] = useState<ImageItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null | 'other'>('other');
  const [stateRestored, setStateRestored] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [draggingImageIndex, setDraggingImageIndex] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
  const [resizingImageIndex, setResizingImageIndex] = useState<number | null>(null);
  const [resizeStart, setResizeStart] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // プロジェクト一覧を取得
  const fetchProjects = async () => {
    try {
      const response = await api.get<Project[]>('/projects');
      setProjects(response.data.filter((p: Project) => p.display_status === 'online'));
    } catch (err: any) {
      console.error('プロジェクトの取得に失敗しました:', err);
    }
  };

  // メモを取得（プロジェクトフィルター適用）
  const fetchNote = useCallback(async (projectId: number | null | 'other' | undefined) => {
    try {
      console.log('fetchNote called with projectId:', projectId);
      setLoading(true);
      setError(null);
      
      // projectIdが'other'の場合はnullに変換（project_id_is_null=trueを送信）
      // projectIdがnullの場合はnullのまま（project_id_is_null=trueを送信）
      // projectIdがundefinedの場合はundefinedのまま（全件取得）
      // projectIdがnullの場合、「その他」（project_id_is_null=true）として扱う
      const apiProjectId = projectId === 'other' || projectId === null ? null : projectId;
      const shouldFetchOther = projectId === 'other' || projectId === null;
      console.log('Calling notesApi.getNotes with project_id:', apiProjectId, 'shouldFetchOther:', shouldFetchOther);
      const data = await notesApi.getNotes(0, 1, shouldFetchOther ? null : apiProjectId);
      console.log('Notes data received:', data);
      
      if (data && data.length > 0) {
        const note = data[0];
        console.log('Setting note:', note);
        setCurrentNote(note);
        setContent(note.content || '');
        // 画像データを変換（既存のURLからImageItemに変換、位置情報も読み込み）
        const imageItems: ImageItem[] = await Promise.all(
          (note.image_urls || []).map(async (url: string, index: number) => {
            const position = note.image_positions?.[url];
            let aspectRatio: number;
            
            // 位置情報にアスペクト比が保存されている場合はそれを使用、なければ画像から取得
            if (position?.width && position?.height) {
              aspectRatio = position.width / position.height;
            } else {
              try {
                aspectRatio = await getImageAspectRatio(url);
              } catch {
                aspectRatio = 1; // デフォルト値
              }
            }
            
            let width: number;
            let height: number;
            
            if (position?.width && position?.height) {
              // 保存された位置情報がある場合はそれを使用
              width = position.width;
              height = position.height;
            } else {
              // 新規読み込み時：アスペクト比に合わせてサイズを計算
              const baseWidth = 200;
              if (aspectRatio >= 1) {
                // 横長または正方形：幅を基準にする
                width = baseWidth;
                height = width / aspectRatio;
              } else {
                // 縦長：高さを基準にする
                height = baseWidth;
                width = height * aspectRatio;
              }
            }
            
            return {
              url,
              width,
              height,
              x: position?.x ?? (50 + (index % 3) * 250),
              y: position?.y ?? (50 + Math.floor(index / 3) * 250),
              aspectRatio,
            };
          })
        );
        setImages(imageItems);
        // projectIdがnullの場合は「その他」として表示
        setSelectedProjectId(projectId === undefined ? 'other' : (projectId === null ? 'other' : projectId));
      } else {
        console.log('No note found, setting to new note mode');
        // メモが存在しない場合は新規作成モード
        setCurrentNote(null);
        setContent('');
        setImages([]);
        setSelectedProjectId(projectId === undefined ? null : projectId);
      }
    } catch (err: any) {
      console.error('メモの取得に失敗しました:', err);
      console.error('Error details:', err.response?.data || err.message);
      setError(`メモの取得に失敗しました: ${err.response?.data?.detail || err.message || '不明なエラー'}`);
    } finally {
      console.log('fetchNote completed, setting loading to false');
      setLoading(false);
    }
  }, []);

  // ページ状態から選択されたプロジェクトIDを復元
  useEffect(() => {
    if (!isInitialLoad && !stateRestored && pageStates.notes?.selectedProjectId !== undefined) {
      const savedProjectId = pageStates.notes.selectedProjectId;
      setSelectedProjectId(savedProjectId);
      setStateRestored(true);
    } else if (isInitialLoad) {
      // 初回ロード時はデフォルト値を使用
      setStateRestored(true);
    }
  }, [isInitialLoad, pageStates.notes, stateRestored]);

  useEffect(() => {
    let isMounted = true;
    const initialize = async () => {
      try {
        await fetchProjects();
        // プロジェクト一覧取得後、保存された状態があればそれを使用、なければ「その他」を取得
        if (isMounted) {
          const projectIdToFetch = !isInitialLoad && pageStates.notes?.selectedProjectId !== undefined
            ? pageStates.notes.selectedProjectId
            : 'other';
          await fetchNote(projectIdToFetch);
        }
      } catch (err) {
        console.error('初期化エラー:', err);
      }
    };
    initialize();
    return () => {
      isMounted = false;
    };
  }, [fetchNote, isInitialLoad, pageStates.notes]);

  // プロジェクトフィルター変更時
  const handleProjectChange = (projectId: number | null | 'other') => {
    setSelectedProjectId(projectId);
    // ページ状態に保存
    updatePageState('notes', { selectedProjectId: projectId });
    fetchNote(projectId);
  };

  // ドラッグアンドドロップ処理
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));
    if (files.length === 0) return;

    // 複数の画像を並列でアップロード
    const uploadPromises = files.map(file => handleImageUpload(file));
    await Promise.all(uploadPromises);
  };

  // 画像のアスペクト比を取得
  const getImageAspectRatio = (url: string): Promise<number> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const aspectRatio = img.width / img.height;
        resolve(aspectRatio);
      };
      img.onerror = () => {
        reject(new Error('画像の読み込みに失敗しました'));
      };
      img.src = url.startsWith('http') ? url : `${window.location.origin}${url}`;
    });
  };

  // 画像アップロード
  const handleImageUpload = async (file: File) => {
    try {
      setUploadingImage(true);
      setError(null);
      const result = await notesApi.uploadImage(file);
      if (result && result.url) {
        // 画像のアスペクト比を取得
        const aspectRatio = await getImageAspectRatio(result.url);
        // 幅を200pxに固定し、アスペクト比に合わせて高さを計算（アスペクト比が1より大きい場合は横長、小さい場合は縦長）
        const baseWidth = 200;
        let width: number;
        let height: number;
        
        if (aspectRatio >= 1) {
          // 横長または正方形：幅を基準にする
          width = baseWidth;
          height = width / aspectRatio;
        } else {
          // 縦長：高さを基準にする
          height = baseWidth;
          width = height * aspectRatio;
        }
        
        // 現在の画像数を取得して、重ならないように配置
        setImages(prevImages => {
          const currentCount = prevImages.length;
          const spacing = 250; // 画像間の間隔
          const cols = 3; // 1行あたりの画像数
          const x = 50 + (currentCount % cols) * spacing;
          const y = 50 + Math.floor(currentCount / cols) * spacing;
          
          const newImage: ImageItem = {
            url: result.url,
            width,
            height,
            x,
            y,
            aspectRatio,
          };
          return [...prevImages, newImage];
        });
      }
    } catch (err: any) {
      console.error('画像のアップロードに失敗しました:', err);
      setError('画像のアップロードに失敗しました');
    } finally {
      setUploadingImage(false);
    }
  };

  // 画像削除（データベースからも削除）
  const handleRemoveImage = async (index: number) => {
    const newImages = images.filter((_, i) => i !== index);
    setImages(newImages);
    
    if (selectedImageIndex === index) {
      setSelectedImageIndex(null);
    } else if (selectedImageIndex !== null && selectedImageIndex > index) {
      setSelectedImageIndex(selectedImageIndex - 1);
    }
    
    // メモが存在する場合、データベースを更新
    if (currentNote) {
      try {
        const imageUrls = newImages.map(img => img.url);
        // 画像の位置情報を保存
        const imagePositions: { [url: string]: { x: number; y: number; width: number; height: number } } = {};
        newImages.forEach(img => {
          imagePositions[img.url] = {
            x: img.x,
            y: img.y,
            width: img.width,
            height: img.height,
          };
        });
        
        const noteData: NoteUpdate = {
          title: null,
          content: content.trim() || null,
          image_urls: imageUrls.length > 0 ? imageUrls : null,
          image_positions: Object.keys(imagePositions).length > 0 ? imagePositions : null,
          project_id: selectedProjectId === 'other' ? null : (selectedProjectId === null ? null : selectedProjectId),
        };
        await notesApi.updateNote(currentNote.id, noteData);
        // 再取得して最新状態を反映
        await fetchNote(selectedProjectId);
      } catch (err: any) {
        console.error('画像の削除に失敗しました:', err);
        setError('画像の削除に失敗しました');
        // エラー時は元に戻す
        setImages(images);
      }
    }
  };

  // 画像ドラッグ開始
  const handleImageDragStart = (index: number, e: React.MouseEvent) => {
    // リサイズハンドルをクリックした場合はドラッグしない
    if ((e.target as HTMLElement).classList.contains('resize-handle')) {
      return;
    }
    
    if (selectedImageIndex !== index) {
      setSelectedImageIndex(index);
    }
    setDraggingImageIndex(index);
    const container = dropZoneRef.current;
    if (!container) return;
    // 画像の左上角を基準にドラッグオフセットを計算
    const imageRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDragOffset({
      x: e.clientX - imageRect.left,
      y: e.clientY - imageRect.top,
    });
  };

  // 画像ドラッグ中
  const handleImageDrag = (e: React.MouseEvent) => {
    if (draggingImageIndex === null || dragOffset === null) return;
    e.preventDefault();
    
    const container = dropZoneRef.current;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    // ドラッグオフセットを考慮して画像の位置を計算
    const newX = e.clientX - rect.left - dragOffset.x;
    const newY = e.clientY - rect.top - dragOffset.y;
    
    setImages(images.map((img, i) => 
      i === draggingImageIndex 
        ? { ...img, x: Math.max(0, Math.min(newX, rect.width - img.width)), y: Math.max(0, Math.min(newY, rect.height - img.height)) }
        : img
    ));
  };

  // 画像ドラッグ終了
  const handleImageDragEnd = () => {
    setDraggingImageIndex(null);
    setDragOffset(null);
  };

  // 画像リサイズ開始
  const handleImageResizeStart = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setResizingImageIndex(index);
    const image = images[index];
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: image.width,
      height: image.height,
    });
  };

  // 画像リサイズ中
  const handleImageResize = (e: React.MouseEvent) => {
    if (resizingImageIndex === null || resizeStart === null) return;
    e.preventDefault();
    
    const image = images[resizingImageIndex];
    const aspectRatio = image.aspectRatio || (resizeStart.width / resizeStart.height);
    
    const deltaX = e.clientX - resizeStart.x;
    const deltaY = e.clientY - resizeStart.y;
    // 対角線方向の移動量を計算
    const delta = Math.sqrt(deltaX * deltaX + deltaY * deltaY) * (deltaX > 0 || deltaY > 0 ? 1 : -1);
    
    const newWidth = Math.max(50, Math.min(800, resizeStart.width + delta));
    const newHeight = newWidth / aspectRatio; // アスペクト比を維持
    
    setImages(images.map((img, i) => 
      i === resizingImageIndex 
        ? { ...img, width: newWidth, height: newHeight }
        : img
    ));
  };

  // 画像リサイズ終了
  const handleImageResizeEnd = () => {
    setResizingImageIndex(null);
    setResizeStart(null);
  };


  // メモ削除
  const handleDelete = async () => {
    if (!currentNote) return;
    
    try {
      await notesApi.deleteNote(currentNote.id);
      setCurrentNote(null);
      setContent('');
      setImages([]);
      setSelectedProjectId(null);
    } catch (err: any) {
      console.error('メモの削除に失敗しました:', err);
      setError('メモの削除に失敗しました');
    } finally {
      setDeleteDialogOpen(false);
    }
  };

  // 自動保存（デバウンス付き）
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialLoadRef = useRef(true);
  
  useEffect(() => {
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      return;
    }
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // 初回ロード時は保存しない
    if (loading) return;
    
    saveTimeoutRef.current = setTimeout(async () => {
      if (currentNote || content || images.length > 0) {
        try {
          setError(null);
          
          const imageUrls = images.map(img => img.url);
          // 画像の位置情報を保存
          const imagePositions: { [url: string]: { x: number; y: number; width: number; height: number } } = {};
          images.forEach(img => {
            imagePositions[img.url] = {
              x: img.x,
              y: img.y,
              width: img.width,
              height: img.height,
            };
          });
          
          const noteData: NoteCreate | NoteUpdate = {
            title: null, // タイトルは不要
            content: content.trim() || null,
            image_urls: imageUrls.length > 0 ? imageUrls : null,
            image_positions: Object.keys(imagePositions).length > 0 ? imagePositions : null,
            project_id: selectedProjectId === 'other' ? null : (selectedProjectId === null ? null : selectedProjectId),
          };

          if (currentNote) {
            await notesApi.updateNote(currentNote.id, noteData);
          } else {
            await notesApi.createNote(noteData);
            // 新規作成後は再取得
            await fetchNote(selectedProjectId);
          }
        } catch (err: any) {
          console.error('メモの自動保存に失敗しました:', err);
          setError('メモの自動保存に失敗しました');
        }
      }
    }, 2000); // 2秒後に自動保存

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [content, images, selectedProjectId, currentNote?.id]);

  return (
    <Box sx={{ height: 'calc(100vh - 70px)', display: 'flex', flexDirection: 'column', p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h4" component="h1">
            メモ
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            個人メモ（作成者のみ閲覧・編集可能）
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>プロジェクト</InputLabel>
            <Select
              value={selectedProjectId === null || selectedProjectId === 'other' ? 'other' : selectedProjectId}
              label="プロジェクト"
              onChange={(e) => {
                const value = e.target.value;
                if (value === 'other') {
                  handleProjectChange('other');
                } else if (value === '') {
                  handleProjectChange(null);
                } else {
                  handleProjectChange(Number(value));
                }
              }}
            >
              {projects.map((project) => (
                <MenuItem key={project.id} value={project.id}>
                  {project.name}
                </MenuItem>
              ))}
              <MenuItem value="other">その他</MenuItem>
            </Select>
          </FormControl>
          {currentNote && (
            <IconButton
              onClick={() => setDeleteDialogOpen(true)}
              color="error"
              size="small"
            >
              <DeleteIcon />
            </IconButton>
          )}
        </Box>
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
      ) : (
        <Paper
          ref={dropZoneRef}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={(e) => {
            // 画像やその子要素をクリックした場合は何もしない
            const target = e.target as HTMLElement;
            if (target.closest('[data-image-box]')) {
              return;
            }
            
            // 背景（Paper）またはテキストエリアをクリックしたときのみ画像の選択を解除
            if (e.target === e.currentTarget || target.tagName === 'TEXTAREA' || target.closest('textarea')) {
              setSelectedImageIndex(null);
            }
          }}
          sx={{
            flexGrow: 1,
            position: 'relative',
            overflow: 'auto',
            p: 3,
            backgroundColor: '#ffffff',
            minHeight: 'calc(100vh - 200px)',
            cursor: draggingImageIndex !== null ? 'grabbing' : 'text',
          }}
          onMouseMove={(e) => {
            if (draggingImageIndex !== null) {
              handleImageDrag(e);
            } else if (resizingImageIndex !== null) {
              handleImageResize(e);
            }
          }}
          onMouseUp={(e) => {
            // 背景のonClickが発火しないようにstopPropagation
            if (draggingImageIndex !== null) {
              e.stopPropagation();
            }
            handleImageResizeEnd();
          }}
          onMouseLeave={() => {
            handleImageResizeEnd();
          }}
        >
          {/* 本文入力（ページ全体がメモエディタ） */}
          <TextField
            fullWidth
            multiline
            variant="standard"
            placeholder="メモの内容を入力してください..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onClick={() => setSelectedImageIndex(null)} // テキストエリアをクリックしたときに画像の選択を解除
            sx={{ 
              position: 'relative',
              zIndex: 1,
              '& .MuiInput-underline:before': { borderBottom: 'none' },
              '& .MuiInput-underline:after': { borderBottom: 'none' },
              '& .MuiInput-underline:hover:not(.Mui-disabled):before': { borderBottom: 'none' },
              '& .MuiInputBase-input': {
                padding: 0,
              },
              '& textarea': { 
                minHeight: 'calc(100vh - 250px)',
                fontSize: '1rem',
                lineHeight: 1.6,
                padding: 0,
                border: 'none',
                outline: 'none',
                resize: 'none',
                backgroundColor: 'transparent',
              },
              '& .MuiInputBase-root': {
                padding: 0,
                border: 'none',
                backgroundColor: 'transparent',
                '&:before': { borderBottom: 'none' },
                '&:after': { borderBottom: 'none' },
                '&:hover:not(.Mui-disabled):before': { borderBottom: 'none' },
              },
              '& fieldset': { border: 'none' },
            }}
          />

          {/* 画像表示エリア */}
          {images.map((image, index) => {
            const imageUrl = image.url.startsWith('http') ? image.url : `${window.location.origin}${image.url}`;
            const isSelected = selectedImageIndex === index;
            
            return (
              <Box
                key={index}
                data-image-box
                onMouseDown={(e) => {
                  e.stopPropagation();
                  handleImageDragStart(index, e);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  // クリック時は選択のみ（解除はしない）
                  setSelectedImageIndex(index);
                }}
                onMouseUp={(e) => {
                  e.stopPropagation();
                  handleImageDragEnd();
                }}
                sx={{
                  position: 'absolute',
                  left: `${image.x}px`,
                  top: `${image.y}px`,
                  width: `${image.width}px`,
                  height: `${image.height}px`,
                  border: isSelected ? '3px solid #1976d2' : '2px solid #e0e0e0',
                  borderRadius: 1,
                  overflow: 'visible', // 削除ボタンとリサイズハンドルが見えるように
                  cursor: draggingImageIndex === index ? 'grabbing' : 'move',
                  backgroundColor: 'transparent',
                  boxShadow: isSelected ? 4 : 2,
                  zIndex: 2,
                  transition: (draggingImageIndex === index || resizingImageIndex === index) ? 'none' : 'box-shadow 0.2s',
                  '&:hover': {
                    boxShadow: 4,
                    borderColor: isSelected ? '#1976d2' : '#bdbdbd',
                  },
                }}
              >
                <Box
                  sx={{
                    width: '100%',
                    height: '100%',
                    overflow: 'hidden', // 画像だけはボックス内に収める
                    borderRadius: 1,
                  }}
                >
                  <img
                    src={imageUrl}
                    alt={`画像 ${index + 1}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain', // 画像全体を表示（アスペクト比を維持、余白は許容）
                      pointerEvents: 'none',
                      userSelect: 'none',
                      backgroundColor: 'transparent',
                    }}
                    draggable={false}
                  />
                </Box>
                {isSelected && (
                  <>
                    {/* 削除ボタン */}
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveImage(index);
                      }}
                      sx={{
                        position: 'absolute',
                        top: -12,
                        right: -12,
                        backgroundColor: 'error.main',
                        color: 'white',
                        width: 24,
                        height: 24,
                        boxShadow: 2,
                        '&:hover': {
                          backgroundColor: 'error.dark',
                        },
                      }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                    
                    {/* リサイズハンドル（右下） */}
                    <Box
                      className="resize-handle"
                      onMouseDown={(e) => handleImageResizeStart(index, e)}
                      sx={{
                        position: 'absolute',
                        bottom: -6,
                        right: -6,
                        width: 16,
                        height: 16,
                        backgroundColor: '#1976d2',
                        border: '2px solid white',
                        borderRadius: '50%',
                        cursor: 'nwse-resize',
                        boxShadow: 2,
                        zIndex: 10,
                        '&:hover': {
                          backgroundColor: '#1565c0',
                          transform: 'scale(1.2)',
                        },
                      }}
                    />
                  </>
                )}
              </Box>
            );
          })}


          {uploadingImage && (
            <Box
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                textAlign: 'center',
              }}
            >
              <CircularProgress />
              <Typography variant="body2" sx={{ mt: 2 }}>
                アップロード中...
              </Typography>
            </Box>
          )}
        </Paper>
      )}

      {/* 削除確認ダイアログ */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>メモの削除</DialogTitle>
        <DialogContent>
          <Typography>
            このメモを削除しますか？
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>
            キャンセル
          </Button>
          <Button onClick={handleDelete} color="error" variant="contained">
            削除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default NotesPage;
