import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Alert,
  Chip,
  List,
  ListItem,
  ListItemText,
  Divider,
  Avatar,
} from '@mui/material';
import { MailOutline as MailIcon } from '@mui/icons-material';
import { fetchAdminDMThreads } from '../../services/api';

interface DmViewProps {
  userMap: Record<number, string>;
}

/**
 * Score 連携の DM スレッド一覧を表示する。
 * BE のレスポンス形が確定していないため、参加者・最新メッセージ・未読数を
 * 複数のフィールド名候補から防御的に解決する。BE未実装時はエラーを graceful に表示。
 */
const DmView: React.FC<DmViewProps> = ({ userMap }) => {
  const [threads, setThreads] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchAdminDMThreads({ limit: 200 })
      .then((rows) => {
        if (alive) setThreads(Array.isArray(rows) ? rows : []);
      })
      .catch((e: any) => {
        if (alive) setError(e?.response?.data?.detail ?? 'DMの取得に失敗しました（BE未実装の可能性があります）');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const nameOf = (id: any) => (id != null && userMap[id] ? userMap[id] : id != null ? `#${id}` : '—');

  const participantsOf = (t: any): string => {
    const p = t.participants ?? t.participant_ids ?? t.members ?? [];
    if (!Array.isArray(p) || p.length === 0) return '—';
    return (
      p
        .map((x: any) => (typeof x === 'object' && x != null ? x.name || nameOf(x.user_id ?? x.id) : nameOf(x)))
        .join(', ') || '—'
    );
  };

  const lastMsgOf = (t: any): string => {
    const lm =
      t.last_message ?? t.latest_message ?? (Array.isArray(t.messages) ? t.messages[t.messages.length - 1] : null);
    if (!lm) return '';
    return typeof lm === 'string' ? lm : lm.body || lm.content || '';
  };

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
  if (threads.length === 0) {
    return (
      <Box sx={{ p: 5, textAlign: 'center' }}>
        <MailIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
        <Typography color="text.secondary">DMスレッドはありません。</Typography>
      </Box>
    );
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2 }}>
      <List disablePadding>
        {threads.map((t: any, i: number) => {
          const unread = t.unread_count ?? t.unread ?? 0;
          const ts = t.updated_at || t.created_at || (t.last_message && t.last_message.created_at);
          return (
            <React.Fragment key={t.id ?? t.thread_id ?? i}>
              {i > 0 && <Divider component="li" />}
              <ListItem
                alignItems="flex-start"
                sx={{ py: 1.2 }}
                secondaryAction={
                  unread > 0 ? (
                    <Chip size="small" color="primary" label={`未読 ${unread}`} sx={{ height: 20, fontSize: '0.65rem' }} />
                  ) : undefined
                }
              >
                <Avatar sx={{ width: 32, height: 32, mr: 1.5, mt: 0.5, bgcolor: 'primary.light' }}>
                  <MailIcon fontSize="small" />
                </Avatar>
                <ListItemText
                  primary={
                    <Typography sx={{ fontWeight: 700, fontSize: '0.85rem' }} noWrap>
                      {participantsOf(t)}
                    </Typography>
                  }
                  secondary={
                    <>
                      <Typography
                        component="span"
                        sx={{ fontSize: '0.78rem', color: 'text.secondary', display: 'block' }}
                        noWrap
                      >
                        {lastMsgOf(t) || '（メッセージなし）'}
                      </Typography>
                      {ts && (
                        <Typography component="span" sx={{ fontSize: '0.68rem', color: 'text.disabled' }}>
                          {new Date(ts).toLocaleString()}
                        </Typography>
                      )}
                    </>
                  }
                />
              </ListItem>
            </React.Fragment>
          );
        })}
      </List>
    </Paper>
  );
};

export default DmView;
