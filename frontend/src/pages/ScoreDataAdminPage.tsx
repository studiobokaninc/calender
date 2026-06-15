import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Alert,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Breadcrumbs,
  Link,
  Chip,
} from '@mui/material';
import { OpenInNew as OpenInNewIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import {
  fetchAdminTimecards,
  fetchAdminRoutines,
  fetchAdminNotifications,
  fetchAdminUserMessages,
  fetchAdminDeliveries,
  fetchAdminReferenceMaterials,
  fetchAdminDMThreads,
} from '../services/api';

const PAGE_LIMIT = 50;

const cellSx = { fontSize: '0.8rem', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 };
const headerSx = { fontSize: '0.75rem', fontWeight: 700, bgcolor: 'grey.100' };

function TruncatedCell({ value }: { value: unknown }) {
  const text = value == null ? '—' : String(value);
  return (
    <TableCell sx={cellSx} title={text}>
      {text}
    </TableCell>
  );
}

function DataTable({ rows, columns }: { rows: Record<string, unknown>[]; columns: string[] }) {
  if (!rows || rows.length === 0) {
    return <Typography sx={{ p: 2, color: 'text.secondary', fontSize: '0.85rem' }}>データなし</Typography>;
  }
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 480 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <TableCell key={col} sx={headerSx}>{col}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i} hover>
              {columns.map((col) => (
                <TruncatedCell key={col} value={row[col]} />
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

interface SectionState {
  data: Record<string, unknown>[];
  loading: boolean;
  error: string | null;
}

function useSection(fetcher: (p: { limit: number; offset: number }) => Promise<any[]>) {
  const [state, setState] = useState<SectionState>({ data: [], loading: false, error: null });
  const load = () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher({ limit: PAGE_LIMIT, offset: 0 })
      .then((data) => setState({ data: data ?? [], loading: false, error: null }))
      .catch((e) => setState({ data: [], loading: false, error: e?.response?.data?.detail ?? e.message ?? '取得エラー' }));
  };
  return { ...state, load };
}

const TABS = [
  { label: 'Notification', key: 'notification' },
  { label: 'Timecard', key: 'timecard' },
  { label: 'Routine', key: 'routine' },
  { label: 'UserMessage', key: 'user_message' },
  { label: 'Delivery', key: 'delivery' },
  { label: 'Reference Material', key: 'reference_material' },
  { label: 'DM Threads', key: 'dm_thread' },
];

export default function ScoreDataAdminPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);

  const notifications = useSection(fetchAdminNotifications);
  const timecards = useSection(fetchAdminTimecards);
  const routines = useSection(fetchAdminRoutines);
  const userMessages = useSection(fetchAdminUserMessages);
  const deliveries = useSection(fetchAdminDeliveries);
  const referenceMaterials = useSection(fetchAdminReferenceMaterials);
  const dmThreads = useSection(fetchAdminDMThreads);

  const sections = [notifications, timecards, routines, userMessages, deliveries, referenceMaterials, dmThreads];

  useEffect(() => {
    sections[tab].load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const { data, loading, error } = sections[tab];
  const columns = data.length > 0 ? Object.keys(data[0]) : [];

  return (
    <Box sx={{ p: 3, maxWidth: 1200 }}>
      <Breadcrumbs sx={{ mb: 1, fontSize: '0.8rem' }}>
        <Link component="button" onClick={() => navigate('/metrics')} underline="hover" sx={{ fontSize: '0.8rem' }}>
          管理
        </Link>
        <Typography sx={{ fontSize: '0.8rem', color: 'text.primary' }}>Score連携データ管理</Typography>
      </Breadcrumbs>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1rem' }}>
          Score連携データ管理 (Phase1: 閲覧のみ)
        </Typography>
        <Button
          size="small"
          variant="outlined"
          endIcon={<OpenInNewIcon fontSize="small" />}
          onClick={() => navigate('/production-tracker')}
          sx={{ fontSize: '0.8rem' }}
        >
          制作データ (ProductionTracker)
        </Button>
      </Box>

      <Alert severity="info" sx={{ mb: 2, fontSize: '0.8rem' }}>
        このページは管理者専用の閲覧ページです。制作系データ (Shot / Retake / Trouble 等) は
        <Button size="small" onClick={() => navigate('/production-tracker')} sx={{ fontSize: '0.8rem', p: 0, ml: 0.5, textTransform: 'none' }}>
          ProductionTracker
        </Button>
        をご利用ください。
      </Alert>

      <Paper variant="outlined">
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { fontSize: '0.8rem', minHeight: 40 } }}
        >
          {TABS.map((t) => (
            <Tab key={t.key} label={t.label} />
          ))}
        </Tabs>

        <Box sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>
              {TABS[tab].label}
            </Typography>
            {!loading && !error && (
              <Chip label={`${data.length}件`} size="small" sx={{ fontSize: '0.75rem', height: 20 }} />
            )}
            <Button size="small" onClick={() => sections[tab].load()} sx={{ fontSize: '0.75rem', ml: 'auto' }}>
              再取得
            </Button>
          </Box>

          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={28} />
            </Box>
          )}

          {!loading && error && (
            <Alert severity="warning" sx={{ fontSize: '0.8rem' }}>
              {error}
              {(tab >= 4) && ' (BE未実装のEPは接続後に利用可能になります)'}
            </Alert>
          )}

          {!loading && !error && (
            <DataTable rows={data as Record<string, unknown>[]} columns={columns} />
          )}
        </Box>
      </Paper>
    </Box>
  );
}
