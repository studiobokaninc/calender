import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
    Box, IconButton, Checkbox, FormControlLabel
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import ja from 'date-fns/locale/ja';
import { format, parseISO } from 'date-fns';
import { CalendarEvent } from '../types';

interface PhaseEditModalProps {
    open: boolean;
    onClose: () => void;
    onSave: (updatedTask: any) => void;
    onDelete: () => void;
    eventToEdit: CalendarEvent | null;
}

const PhaseEditModal: React.FC<PhaseEditModalProps> = ({ open, onClose, onSave, onDelete, eventToEdit }) => {
    const [phaseName, setPhaseName] = useState('');
    const [phaseDate, setPhaseDate] = useState<string | null>(null);
    const [phaseCompleted, setPhaseCompleted] = useState(false);

    useEffect(() => {
        if (open && eventToEdit && eventToEdit.extendedProps?.isPhase) {
            // Phase information is derived from the event title and date
            // But extendedProps shoud have more specific info if we set it up correctly in CalendarPage.tsx
            // For now, let's assume we can edit the name and date.
            // Editing a phase implies updating the parent task's "phases" array.

            // title format is usually "{TaskName}: {PhaseName}"
            const titleParts = eventToEdit.title.split(': ');
            setPhaseName(titleParts.length > 1 ? titleParts[1] : eventToEdit.title);

            const dateStr = eventToEdit.start ?
                (eventToEdit.start instanceof Date ? format(eventToEdit.start, 'yyyy-MM-dd') : format(parseISO(eventToEdit.start as string), 'yyyy-MM-dd'))
                : null;
            setPhaseDate(dateStr);
            setPhaseCompleted(eventToEdit.extendedProps?.isCompleted || false);
        }
    }, [open, eventToEdit]);

    const handleSave = () => {
        if (!eventToEdit || !eventToEdit.extendedProps?.taskId) return;

        // We need to construct the update for the parent task.
        // This is tricky because we only have the single phase event here.
        // We effectively need to tell the parent component "Update phase X of task Y".
        // Since we don't have the full task context here easily without fetching,
        // we might need to rely on the parent component (CalendarPage) to handle the actual logic
        // of finding the task and updating the specific phase.

        // So we pass back the necessary info to identify the phase and the new values.
        // Using onSave with a special structure.

        const phaseIndex = eventToEdit.id.split('-').pop(); // id is task-{taskId}-phase-{index}

        onSave({
            taskId: eventToEdit.extendedProps.taskId,
            phaseIndex: Number(phaseIndex),
            newName: phaseName,
            newDate: phaseDate,
            isCompleted: phaseCompleted
        });
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>段階目標 (Phase) の編集</DialogTitle>
            <DialogContent sx={{ pt: 2 }}>
                <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ja}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                        <TextField
                            label="目標名"
                            value={phaseName}
                            onChange={(e) => setPhaseName(e.target.value)}
                            fullWidth
                            size="small"
                        />
                        <DatePicker
                            label="日付"
                            value={phaseDate ? parseISO(phaseDate) : null}
                            onChange={(newValue) => setPhaseDate(newValue ? format(newValue, 'yyyy-MM-dd') : null)}
                            slotProps={{ textField: { fullWidth: true, size: 'small' } }}
                        />
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={phaseCompleted}
                                    onChange={(e) => setPhaseCompleted(e.target.checked)}
                                    color="primary"
                                />
                            }
                            label="完了 (Completed)"
                        />
                    </Box>
                </LocalizationProvider>
            </DialogContent>
            <DialogActions>
                <IconButton onClick={onDelete} color="error" sx={{ mr: 'auto' }}>
                    <DeleteIcon />
                </IconButton>
                <Button onClick={onClose}>キャンセル</Button>
                <Button onClick={handleSave} variant="contained" color="primary">保存</Button>
            </DialogActions>
        </Dialog>
    );
};

export default PhaseEditModal;
