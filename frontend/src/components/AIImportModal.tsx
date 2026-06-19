import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  CircularProgress,
  Typography,
  Box,
  Alert,
  FormHelperText,
} from '@mui/material';
import { parseAIImport, AIImportResult } from '../services/api';
import api from '../services/api';

interface AIImportModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

type Step = 'input' | 'loading' | 'preview';
type KindOption = 'task' | 'event';

interface Fields {
  title_or_name: string;
  description: string;
  event_type: string;
  task_priority: string;
  start: string;
  end_or_due: string;
  location: string;
}

const EVENT_TYPES = ['Meeting', 'Deadline', 'Milestone', 'Workshop', 'Generic', 'Task'];
const TASK_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];

const INITIAL_FIELDS: Fields = {
  title_or_name: '',
  description: '',
  event_type: 'Generic',
  task_priority: '',
  start: '',
  end_or_due: '',
  location: '',
};

const toDateTimeLocal = (s: string | null): string => {
  if (!s) return '';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(T(\d{2}:\d{2}))?/);
  if (!m) return '';
  return m[3] ? `${m[1]}T${m[3]}` : `${m[1]}T00:00`;
};

const toApiDateTime = (s: string): string => {
  if (!s) return s;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return `${s}:00+09:00`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00+09:00`;
  return s;
};

const AIImportModal: React.FC<AIImportModalProps> = ({ open, onClose, onSaved }) => {
  const [step, setStep] = useState<Step>('input');
  const [text, setText] = useState('');
  const [result, setResult] = useState<AIImportResult | null>(null);
  const [kind, setKind] = useState<KindOption>('event');
  const [fields, setFields] = useState<Fields>(INITIAL_FIELDS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetState = () => {
    setStep('input');
    setText('');
    setResult(null);
    setFields(INITIAL_FIELDS);
    setError(null);
    setSaving(false);
  };

  const handleClose = () => {
    if (saving) return;
    resetState();
    onClose();
  };

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    setStep('loading');
    setError(null);
    try {
      const res = await parseAIImport(text.trim());
      setResult(res);
      const detectedKind: KindOption = res.kind === 'task' ? 'task' : 'event';
      setKind(detectedKind);
      const p = res.payload;
      setFields({
        title_or_name: p.title_or_name || '',
        description: p.description || '',
        event_type: p.event_type || 'Generic',
        task_priority: p.task_priority || '',
        start: toDateTimeLocal(p.start),
        end_or_due: toDateTimeLocal(p.end_or_due),
        location: p.location || '',
      });
      setStep('preview');
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || 'AI解析に失敗しました');
      setStep('input');
    }
  };

  const handleFieldChange = (key: keyof Fields, value: string) => {
    setFields(prev => ({ ...prev, [key]: value }));
  };

  const isTaskValid = () => !!fields.title_or_name.trim();
  const isEventValid = () => !!fields.title_or_name.trim() && !!fields.event_type;
  const canSave = kind === 'task' ? isTaskValid() : isEventValid();

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (kind === 'task') {
        const priorityUpper = fields.task_priority.toUpperCase();
        const priority = TASK_PRIORITIES.includes(priorityUpper) ? priorityUpper : undefined;
        await api.post('/tasks', {
          name: fields.title_or_name.trim(),
          description: fields.description.trim() || undefined,
          status: 'todo',
          due_date: fields.end_or_due ? toApiDateTime(fields.end_or_due) : undefined,
          priority,
        });
      } else {
        await api.post('/calendar/events', {
          title: fields.title_or_name.trim(),
          type: fields.event_type || 'Generic',
          description: fields.description.trim() || undefined,
          start_time: fields.start ? toApiDateTime(fields.start) : undefined,
          end_time: fields.end_or_due ? toApiDateTime(fields.end_or_due) : undefined,
          location: fields.location.trim() || undefined,
          allDay: false,
        });
      }
      onSaved();
      resetState();
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const lowConfidence = result && (result.confidence < 0.5 || result.kind === 'unknown');
  const confidencePct = result ? Math.round(result.confidence * 100) : 0;
  const kindLabel = result?.kind === 'task' ? 'タスク' : result?.kind === 'event' ? 'イベント' : '判別不能';

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>AIで取り込み</DialogTitle>
      <DialogContent dividers>
        {step === 'input' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <Typography variant="body2" color="text.secondary">
              議事録・メモ等を貼り付けてください。AIが種別（タスク/イベント）を判定し、フィールドを自動抽出します。内容はAIサービスに送信されます。
            </Typography>
            <TextField
              multiline
              minRows={6}
              maxRows={14}
              fullWidth
              placeholder="議事録・メモ等を貼り付けてください"
              value={text}
              onChange={e => setText(e.target.value)}
              variant="outlined"
              inputProps={{ maxLength: 4000 }}
            />
            <Typography variant="caption" color="text.secondary" align="right">
              {text.length} / 4000
            </Typography>
          </Box>
        )}

        {step === 'loading' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 5 }}>
            <CircularProgress />
            <Typography color="text.secondary">AI解析中...</Typography>
          </Box>
        )}

        {step === 'preview' && result && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {lowConfidence ? (
              <Alert severity="warning">
                AI判定: {kindLabel}（確信度 {confidencePct}%）— 確信度が低めです。内容を確認・補正してください。
                {result.notes && <Box component="span"> {result.notes}</Box>}
              </Alert>
            ) : (
              <Alert severity="info">
                AI判定: {kindLabel}（確信度 {confidencePct}%）
                {result.notes && <Box component="span"> — {result.notes}</Box>}
              </Alert>
            )}
            {error && <Alert severity="error">{error}</Alert>}

            <FormControl fullWidth size="small">
              <InputLabel>種別</InputLabel>
              <Select
                value={kind}
                label="種別"
                onChange={e => setKind(e.target.value as KindOption)}
              >
                <MenuItem value="task">タスク</MenuItem>
                <MenuItem value="event">イベント</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label={kind === 'task' ? '名前 *' : 'タイトル *'}
              fullWidth
              size="small"
              value={fields.title_or_name}
              onChange={e => handleFieldChange('title_or_name', e.target.value)}
              error={!fields.title_or_name.trim()}
              helperText={!fields.title_or_name.trim() ? '要入力' : undefined}
            />

            <TextField
              label="説明"
              fullWidth
              size="small"
              multiline
              minRows={2}
              value={fields.description}
              onChange={e => handleFieldChange('description', e.target.value)}
            />

            {kind === 'event' && (
              <>
                <FormControl fullWidth size="small" error={!fields.event_type}>
                  <InputLabel>イベント種別 *</InputLabel>
                  <Select
                    value={fields.event_type}
                    label="イベント種別 *"
                    onChange={e => handleFieldChange('event_type', e.target.value)}
                  >
                    {EVENT_TYPES.map(t => (
                      <MenuItem key={t} value={t}>{t}</MenuItem>
                    ))}
                  </Select>
                  {!fields.event_type && <FormHelperText>要入力</FormHelperText>}
                </FormControl>
                <TextField
                  label="開始日時"
                  fullWidth
                  size="small"
                  type="datetime-local"
                  value={fields.start}
                  onChange={e => handleFieldChange('start', e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="終了日時"
                  fullWidth
                  size="small"
                  type="datetime-local"
                  value={fields.end_or_due}
                  onChange={e => handleFieldChange('end_or_due', e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="場所"
                  fullWidth
                  size="small"
                  value={fields.location}
                  onChange={e => handleFieldChange('location', e.target.value)}
                />
              </>
            )}

            {kind === 'task' && (
              <>
                <FormControl fullWidth size="small">
                  <InputLabel>優先度</InputLabel>
                  <Select
                    value={fields.task_priority}
                    label="優先度"
                    onChange={e => handleFieldChange('task_priority', e.target.value)}
                  >
                    <MenuItem value="">未設定</MenuItem>
                    {TASK_PRIORITIES.map(p => (
                      <MenuItem key={p} value={p}>{p}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  label="期限"
                  fullWidth
                  size="small"
                  type="datetime-local"
                  value={fields.end_or_due}
                  onChange={e => handleFieldChange('end_or_due', e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>キャンセル</Button>
        {step === 'preview' && (
          <Button onClick={() => { setStep('input'); setError(null); }} disabled={saving}>
            やり直す
          </Button>
        )}
        {step === 'input' && (
          <Button
            variant="contained"
            onClick={handleAnalyze}
            disabled={!text.trim()}
          >
            AIで分析
          </Button>
        )}
        {step === 'preview' && (
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!canSave || saving}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            確定して保存
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default AIImportModal;
