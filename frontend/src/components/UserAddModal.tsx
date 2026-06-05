import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  Typography,
} from '@mui/material';

// Define the shape of the data the modal will handle and pass back
export interface NewUserData {
  username: string;
  email: string;
  password?: string;
  role?: string;
}

interface UserAddModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (newUserData: NewUserData) => Promise<void>;
}

const UserAddModal: React.FC<UserAddModalProps> = ({ open, onClose, onSave }) => {
  const initialFormData: NewUserData = {
    username: '',
    email: '',
    password: '',
    role: 'user',
  };
  const [formData, setFormData] = useState<NewUserData>(initialFormData);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof NewUserData | 'confirmPassword' | 'form', string>>>({});
  const [isSaving, setIsSaving] = useState(false);

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof NewUserData | 'confirmPassword', string>> = {};
    if (!formData.username.trim()) newErrors.username = 'ユーザー名は必須です。';
    if (!formData.email.trim()) newErrors.email = 'メールアドレスは必須です。';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) newErrors.email = '有効なメールアドレスを入力してください。';
    if (!formData.password) newErrors.password = 'パスワードは必須です。';
    else if (formData.password.length < 8) newErrors.password = 'パスワードは8文字以上である必要があります。';
    if (formData.password !== confirmPassword) newErrors.confirmPassword = 'パスワードが一致しません。';
    if (!formData.role) newErrors.role = '役割は必須です。';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement | { name?: string; value: unknown }>) => {
    const { name, value } = event.target;
    setFormData(prev => ({ ...prev, [name as keyof NewUserData]: value as string }));
    if (errors[name as keyof typeof errors]) {
      setErrors(prev => ({ ...prev, [name as keyof typeof errors]: undefined }));
    }
  };

  const handleConfirmPasswordChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setConfirmPassword(event.target.value);
    if (errors.confirmPassword) {
      setErrors(prev => ({ ...prev, confirmPassword: undefined }));
    }
  };

  const handleSaveClick = async () => {
    if (!validateForm()) return;

    setIsSaving(true);
    try {
      const { password, ...dataToSave } = formData;
      await onSave({ ...dataToSave, password });
      handleClose();
    } catch (error) {
      console.error("Error saving user:", error);
      setErrors(prev => ({ ...prev, form: 'ユーザーの保存に失敗しました。' }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setFormData(initialFormData);
    setConfirmPassword('');
    setErrors({});
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>新規ユーザー追加</DialogTitle>
      <DialogContent>
        <Box component="form" noValidate sx={{ mt: 1 }}>
          <TextField
            margin="normal"
            required
            fullWidth
            id="username"
            label="ユーザー名"
            name="username"
            autoComplete="username"
            autoFocus
            value={formData.username}
            onChange={handleChange}
            error={!!errors.username}
            helperText={errors.username}
          />
          <TextField
            margin="normal"
            required
            fullWidth
            id="email"
            label="メールアドレス"
            name="email"
            autoComplete="email"
            value={formData.email}
            onChange={handleChange}
            error={!!errors.email}
            helperText={errors.email}
          />
          <TextField
            margin="normal"
            required
            fullWidth
            name="password"
            label="パスワード (8文字以上)"
            type="password"
            id="password"
            autoComplete="new-password"
            value={formData.password}
            onChange={handleChange}
            error={!!errors.password}
            helperText={errors.password}
          />
          <TextField
            margin="normal"
            required
            fullWidth
            name="confirmPassword"
            label="パスワード (確認用)"
            type="password"
            id="confirmPassword"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={handleConfirmPasswordChange}
            error={!!errors.confirmPassword}
            helperText={errors.confirmPassword}
          />
          <FormControl fullWidth margin="normal" required error={!!errors.role}>
            <InputLabel id="role-label">役割</InputLabel>
            <Select
              labelId="role-label"
              id="role"
              name="role"
              value={formData.role || 'user'}
              label="役割"
              onChange={handleChange as any}
            >
              <MenuItem value="admin">管理者</MenuItem>
              <MenuItem value="user">一般ユーザー</MenuItem>
            </Select>
            {errors.role && <FormHelperText>{errors.role}</FormHelperText>}
          </FormControl>

          {errors.form && <Typography color="error" sx={{ mt: 1 }}>{errors.form}</Typography>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} color="inherit">キャンセル</Button>
        <Button onClick={handleSaveClick} variant="contained" disabled={isSaving}>
          {isSaving ? '保存中...' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UserAddModal;
