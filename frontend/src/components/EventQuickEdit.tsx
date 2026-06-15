import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Divider, TextField, Button, FormControlLabel,
    Switch, IconButton, useTheme
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import CloseIcon from '@mui/icons-material/Close';
import EventIcon from '@mui/icons-material/Event';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { parseISO, isValid, format as dateFnsFormat } from 'date-fns';
import { ja } from 'date-fns/locale';
import { CalendarEvent } from '../types';

interface EventQuickEditProps {
    event: CalendarEvent;
    onUpdate: (eventId: number, updates: any) => Promise<void>;
    onClose?: () => void;
}

const parseDate = (val: string | Date | null | undefined): Date | null => {
    if (!val) return null;
    if (val instanceof Date) return isValid(val) ? val : null;
    try {
        const d = parseISO(val);
        return isValid(d) ? d : null;
    } catch { return null; }
};

const formatForApi = (d: Date | null, allDay: boolean): string | null => {
    if (!d || !isValid(d)) return null;
    return allDay
        ? dateFnsFormat(d, 'yyyy-MM-dd')
        : dateFnsFormat(d, "yyyy-MM-dd'T'HH:mm:ssxxx");
};

export const EventQuickEdit: React.FC<EventQuickEditProps> = ({ event, onUpdate, onClose }) => {
    const theme = useTheme();
    const isDark = theme.palette.mode === 'dark';

    const eventId = Number(event.id.replace('event-', ''));

    const [title, setTitle] = useState(event.title || '');
    const [description, setDescription] = useState(event.extendedProps?.description || '');
    const [location, setLocation] = useState(event.extendedProps?.location || '');
    const [allDay, setAllDay] = useState(event.allDay ?? false);
    const [startDate, setStartDate] = useState<Date | null>(parseDate(event.start));
    const [endDate, setEndDate] = useState<Date | null>(parseDate(event.end));
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setTitle(event.title || '');
        setDescription(event.extendedProps?.description || '');
        setLocation(event.extendedProps?.location || '');
        setAllDay(event.allDay ?? false);
        setStartDate(parseDate(event.start));
        setEndDate(parseDate(event.end));
    }, [event.id]);

    const handleSave = async () => {
        if (!title.trim()) {
            alert('タイトルは必須です。');
            return;
        }
        setSaving(true);
        try {
            const updates: any = {
                title: title.trim(),
                description: description || null,
                location: location || null,
                allDay: allDay,
                start_time: formatForApi(startDate, allDay),
                end_time: formatForApi(endDate, allDay),
            };
            await onUpdate(eventId, updates);
            if (onClose) onClose();
        } finally {
            setSaving(false);
        }
    };

    const inputSx = {
        '& .MuiInputBase-root': { fontSize: '0.85rem' },
        '& .MuiInputLabel-root': { fontSize: '0.85rem' },
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ja}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <EventIcon fontSize="small" color="action" />
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1 }}>イベント編集</Typography>
                    {onClose && (
                        <IconButton size="small" onClick={onClose}>
                            <CloseIcon fontSize="small" />
                        </IconButton>
                    )}
                </Box>

                <TextField
                    label="タイトル"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    fullWidth
                    size="small"
                    required
                    sx={inputSx}
                />

                <FormControlLabel
                    control={
                        <Switch
                            size="small"
                            checked={allDay}
                            onChange={(e) => setAllDay(e.target.checked)}
                        />
                    }
                    label={<Typography variant="body2">終日</Typography>}
                />

                {allDay ? (
                    <>
                        <DatePicker
                            label="開始日"
                            value={startDate}
                            onChange={(d) => setStartDate(d)}
                            slotProps={{ textField: { size: 'small', fullWidth: true, sx: inputSx } }}
                        />
                        <DatePicker
                            label="終了日"
                            value={endDate}
                            onChange={(d) => setEndDate(d)}
                            slotProps={{ textField: { size: 'small', fullWidth: true, sx: inputSx } }}
                        />
                    </>
                ) : (
                    <>
                        <DateTimePicker
                            label="開始日時"
                            value={startDate}
                            onChange={(d) => setStartDate(d)}
                            slotProps={{ textField: { size: 'small', fullWidth: true, sx: inputSx } }}
                        />
                        <DateTimePicker
                            label="終了日時"
                            value={endDate}
                            onChange={(d) => setEndDate(d)}
                            slotProps={{ textField: { size: 'small', fullWidth: true, sx: inputSx } }}
                        />
                    </>
                )}

                <TextField
                    label="説明"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    fullWidth
                    size="small"
                    multiline
                    minRows={2}
                    sx={inputSx}
                />

                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <LocationOnIcon fontSize="small" color="action" sx={{ mt: 1 }} />
                    <TextField
                        label="場所"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        fullWidth
                        size="small"
                        sx={inputSx}
                    />
                </Box>

                <Divider />

                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                    {onClose && (
                        <Button size="small" onClick={onClose} disabled={saving}>
                            キャンセル
                        </Button>
                    )}
                    <Button
                        size="small"
                        variant="contained"
                        startIcon={<SaveIcon fontSize="small" />}
                        onClick={handleSave}
                        disabled={saving}
                    >
                        {saving ? '保存中...' : '保存'}
                    </Button>
                </Box>
            </Box>
        </LocalizationProvider>
    );
};
