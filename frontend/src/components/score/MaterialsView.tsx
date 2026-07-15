import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Chip,
  Link,
  Card,
  CardContent,
  CardMedia,
  Tooltip,
} from '@mui/material';
import {
  PhotoLibrary as PhotoLibraryIcon,
  Link as LinkIcon,
  Notes as NotesIcon,
  Movie as MovieIcon,
  BrokenImage as BrokenImageIcon,
} from '@mui/icons-material';
import { fetchAdminReferenceMaterials } from '../../services/api';

interface MaterialsViewProps {
  userMap: Record<number, string>;
}

/**
 * Score 連携の参照素材（reference_materials）を画像中心にプレビュー表示する。
 * media_type: image / video / url / memo。BE未実装時はエラーを graceful に表示する。
 */
const MaterialsView: React.FC<MaterialsViewProps> = ({ userMap }) => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchAdminReferenceMaterials({ limit: 200 })
      .then((rows) => {
        if (alive) setItems(Array.isArray(rows) ? rows : []);
      })
      .catch((e: any) => {
        if (alive) setError(e?.response?.data?.detail ?? '資料の取得に失敗しました（BE未実装の可能性があります）');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const nameOf = (id: any) => (id != null && userMap[id] ? userMap[id] : id != null ? `#${id}` : '—');

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }
  if (error) {
    return (
      <Alert severity="warning" sx={{ fontSize: '0.8rem' }}>
        {error}
      </Alert>
    );
  }
  if (items.length === 0) {
    return (
      <Box sx={{ p: 5, textAlign: 'center' }}>
        <PhotoLibraryIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
        <Typography color="text.secondary">資料はありません。</Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 2,
      }}
    >
      {items.map((m, idx) => {
        const type = String(m.media_type || m.file_type || '').toLowerCase();
        const path = m.file_path || m.file_url || '';
        return (
          <Card key={m.id ?? idx} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
            {type === 'image' && path ? (
              <CardMedia
                component="img"
                image={path}
                alt={m.title || ''}
                sx={{ height: 140, objectFit: 'cover', bgcolor: 'action.hover' }}
                onError={(e: any) => {
                  e.target.style.display = 'none';
                }}
              />
            ) : (
              <Box
                sx={{
                  height: 140,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: 'action.hover',
                }}
              >
                {type === 'video' ? (
                  <MovieIcon sx={{ fontSize: 40, color: 'text.disabled' }} />
                ) : type === 'url' ? (
                  <LinkIcon sx={{ fontSize: 40, color: 'text.disabled' }} />
                ) : type === 'memo' ? (
                  <NotesIcon sx={{ fontSize: 40, color: 'text.disabled' }} />
                ) : (
                  <BrokenImageIcon sx={{ fontSize: 40, color: 'text.disabled' }} />
                )}
              </Box>
            )}
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Tooltip title={m.title || ''}>
                <Typography noWrap sx={{ fontWeight: 700, fontSize: '0.85rem' }}>
                  {m.title || '(無題)'}
                </Typography>
              </Tooltip>
              <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                {type && <Chip size="small" label={type} sx={{ height: 18, fontSize: '0.65rem' }} />}
                {m.shot_id != null && (
                  <Chip size="small" variant="outlined" label={`shot#${m.shot_id}`} sx={{ height: 18, fontSize: '0.65rem' }} />
                )}
                {m.task_id != null && (
                  <Chip size="small" variant="outlined" label={`task#${m.task_id}`} sx={{ height: 18, fontSize: '0.65rem' }} />
                )}
              </Box>
              {type === 'url' && path && (
                <Link
                  href={path}
                  target="_blank"
                  rel="noopener"
                  sx={{ fontSize: '0.7rem', display: 'block', mt: 0.5 }}
                  noWrap
                >
                  {path}
                </Link>
              )}
              <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.5 }}>
                {nameOf(m.created_by)}
                {m.created_at ? ` ・ ${new Date(m.created_at).toLocaleDateString()}` : ''}
              </Typography>
            </CardContent>
          </Card>
        );
      })}
    </Box>
  );
};

export default MaterialsView;
