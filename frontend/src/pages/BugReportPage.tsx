import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Box, Typography, TextField, Select, MenuItem, Button,
         Snackbar, Alert, Paper, FormControl, InputLabel, Collapse } from '@mui/material';
import { createBugReport, getBugReportsRecent, exportBugReportsCsv } from '../services/api';
import { getLog, appendLog } from '../utils/opLog';
import { useAuth } from '../contexts/AuthContext';

const SEVERITY_OPTIONS = ['low','medium','high','critical'];

const BugReportItem: React.FC<{ r: any }> = ({ r }) => {
  const [expanded, setExpanded] = useState(false);
  const desc = r.description || '';
  const isLong = desc.length > 120;
  return (
    <Paper sx={{ p: 1.5, mb: 1 }}>
      <Typography sx={{ fontSize: '0.9rem', fontWeight: 600 }}>
        #{r.id} [{r.severity}] {r.title} — {r.reporter_name}
      </Typography>
      <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary', mb: 0.5 }}>
        {r.status}{r.created_at ? ` · ${r.created_at.slice(0, 10)}` : ''}
      </Typography>
      {desc && (
        <>
          <Collapse in={expanded || !isLong}>
            <Typography sx={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', mt: 0.5 }}>
              {desc}
            </Typography>
          </Collapse>
          {isLong && (
            <Button size="small" onClick={() => setExpanded(!expanded)} sx={{ mt: 0.5, p: 0 }}>
              {expanded ? '閉じる' : '続きを見る'}
            </Button>
          )}
        </>
      )}
      {r.page_url && (
        <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mt: 0.5, wordBreak: 'break-all' }}>
          URL: {r.page_url}
        </Typography>
      )}
    </Paper>
  );
};

const BugReportPage: React.FC = () => {
  const location = useLocation();
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('medium');

  // SPA画面遷移に対応した遷移元URLの取得（sessionStorageから取得、無ければ標準フォールバック）
  const getInitialPageUrl = () => {
    const prevPath = sessionStorage.getItem('prevPath');
    if (prevPath) {
      return `${window.location.origin}${prevPath}`;
    }
    return document.referrer || window.location.href;
  };

  const [pageUrl, setPageUrl] = useState(getInitialPageUrl);
  const [sending, setSending] = useState(false);
  const [snackOpen, setSnackOpen] = useState(false);
  const [snackMsg, setSnackMsg] = useState('');
  const [snackSeverity, setSnackSeverity] = useState<'success' | 'error'>('success');
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    appendLog(`[nav] ${location.pathname}`);
    getBugReportsRecent().then(setRecent).catch(() => {});
  }, [location.pathname]);

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) return;
    setSending(true);
    try {
      const res = await createBugReport({
        title, description, severity,
        page_url: pageUrl || undefined,
        operation_log: getLog() || undefined,
      });
      setSnackMsg(`受付# ${res.id} を受け付けました`);
      setSnackSeverity('success');
      setSnackOpen(true);
      setTitle(''); setDescription(''); setSeverity('medium');
      setPageUrl(window.location.href);
      const updated = await getBugReportsRecent();
      setRecent(updated);
    } catch {
      setSnackMsg('送信に失敗しました');
      setSnackSeverity('error');
      setSnackOpen(true);
    } finally {
      setSending(false);
    }
  };

  const handleCsvExport = async () => {
    try {
      const blob = await exportBugReportsCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'bug_reports.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch { alert('CSV出力に失敗しました'); }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 700 }}>
      <Typography variant="h5" gutterBottom>バグ報告所</Typography>
      <Paper sx={{ p: 3, mb: 3 }}>
        <TextField fullWidth label="件名" value={title} onChange={e=>setTitle(e.target.value)}
          sx={{ mb: 2, fontSize: '0.9rem' }} required />
        <TextField fullWidth multiline rows={5} label="詳細" value={description}
          onChange={e=>setDescription(e.target.value)} sx={{ mb: 2 }} required />
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>重大度</InputLabel>
          <Select value={severity} label="重大度" onChange={e=>setSeverity(e.target.value as string)}>
            {SEVERITY_OPTIONS.map(s=><MenuItem key={s} value={s}>{s}</MenuItem>)}
          </Select>
        </FormControl>
        <TextField fullWidth label="発生URL" value={pageUrl}
          onChange={e=>setPageUrl(e.target.value)} sx={{ mb: 2 }} />
        <Box sx={{ display:'flex', gap:2 }}>
          <Button variant="contained" onClick={handleSubmit} disabled={sending || !title || !description}>
            送信
          </Button>
          {user?.role === 'admin' && (
            <Button variant="outlined" onClick={handleCsvExport}>CSVエクスポート</Button>
          )}
        </Box>
      </Paper>
      {recent.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb:1 }}>直近の報告</Typography>
          {recent.map((r: any) => <BugReportItem key={r.id} r={r} />)}
        </Box>
      )}
      <Snackbar open={snackOpen} autoHideDuration={4000} onClose={()=>setSnackOpen(false)}>
        <Alert severity={snackSeverity} onClose={()=>setSnackOpen(false)}>{snackMsg}</Alert>
      </Snackbar>
    </Box>
  );
};

export default BugReportPage;
