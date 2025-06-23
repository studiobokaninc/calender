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
  FormControlLabel,
  RadioGroup,
  Radio,
} from '@mui/material';
import { User } from '../types'; // Assuming User type might be needed for data structure
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { ja } from 'date-fns/locale';

// Define the shape of the data the modal will handle and pass back
export interface NewUserData {
  username: string;
  full_name?: string;
  email: string;
  password?: string; // Password should be handled securely, only set on creation
  role?: string;
  language?: string;
  iconUrl?: string;
  birthday?: string | null; // Allow null for DatePicker
  phoneNumber?: string;
  gender?: string;
}

interface UserAddModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (newUserData: NewUserData) => Promise<void>; // Make onSave async
}

const UserAddModal: React.FC<UserAddModalProps> = ({ open, onClose, onSave }) => {
  const initialFormData: NewUserData = {
    username: '',
    email: '',
    full_name: '',
    password: '',
    role: 'user',
    language: 'ja',
    iconUrl: '',
    birthday: null,
    phoneNumber: '',
    gender: '',
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
    // Clear error when user starts typing
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

  const handleBirthdayChange = (newValue: Date | null) => {
    setFormData(prev => ({
      ...prev,
      birthday: newValue ? newValue.toISOString().split('T')[0] : null
    }));
  };

  const handleSaveClick = async () => {
    if (!validateForm()) return;

    setIsSaving(true);
    try {
      // Exclude confirmPassword before saving
      const { password, ...dataToSave } = formData;
      await onSave({ ...dataToSave, password }); // Pass password separately if needed by API
      handleClose(); // Close modal on successful save
    } catch (error) {
      console.error("Error saving user:", error);
      // Display error to user (e.g., using a Snackbar or Alert within the modal)
      setErrors(prev => ({...prev, form: 'ユーザーの保存に失敗しました。'})); // Example generic form error
    } finally {
      setIsSaving(false);
    }
  };

  // Reset form and errors when closing
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
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ja}>
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
              fullWidth
              id="full_name"
              label="氏名"
              name="full_name"
              autoComplete="name"
              value={formData.full_name}
              onChange={handleChange}
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

            <FormControl fullWidth margin="normal">
              <InputLabel id="language-label">言語</InputLabel>
              <Select
                labelId="language-label"
                id="language"
                name="language"
                value={formData.language || 'ja'}
                label="言語"
                onChange={handleChange as any}
              >
                <MenuItem value="ja">日本語</MenuItem>
                <MenuItem value="en">English</MenuItem>
              </Select>
            </FormControl>

            <TextField
              margin="normal"
              fullWidth
              id="iconUrl"
              label="アイコンURL"
              name="iconUrl"
              value={formData.iconUrl}
              onChange={handleChange}
            />

            <DatePicker
              label="誕生日"
              value={formData.birthday ? new Date(formData.birthday) : null}
              onChange={handleBirthdayChange}
              sx={{ display: 'block', mt: 2, mb: 1 }}
              slotProps={{ textField: { fullWidth: true, margin: 'normal' } }}
            />

            <TextField
              margin="normal"
              fullWidth
              id="phoneNumber"
              label="電話番号"
              name="phoneNumber"
              type="tel"
              autoComplete="tel"
              value={formData.phoneNumber}
              onChange={handleChange}
              error={!!errors.phoneNumber}
              helperText={errors.phoneNumber}
            />
            
            <FormControl fullWidth margin="normal">
              <InputLabel id="gender-label">性別</InputLabel>
              <Select
                labelId="gender-label"
                id="gender"
                name="gender"
                value={formData.gender || ''}
                label="性別"
                onChange={handleChange as any}
                displayEmpty
              >
                <MenuItem value=""><em>選択しない</em></MenuItem>
                <MenuItem value="male">男性</MenuItem>
                <MenuItem value="female">女性</MenuItem>
                <MenuItem value="other">その他</MenuItem>
              </Select>
            </FormControl>

            {errors.form && <Typography color="error" sx={{ mt: 1 }}>{errors.form}</Typography>}
          </Box>
        </LocalizationProvider>
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
