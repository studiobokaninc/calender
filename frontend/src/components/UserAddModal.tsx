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
  Divider,
} from '@mui/material';

// Define the shape of the data the modal will handle and pass back
export interface NewUserData {
  username: string;
  email: string;
  password?: string;
  role?: string;
  full_name?: string;
  furigana?: string;
  language?: string;
}

const LANGUAGE_OPTIONS = [
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ko', label: '한국어' },
  { value: 'other', label: 'その他' },
];

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
    full_name: '',
    furigana: '',
    language: 'ja',
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
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          新しく追加するメンバーの情報を入力してください。<Box component="span" sx={{ color: 'error.main' }}>*</Box> は必須項目です。
        </Typography>
        <Box component="form" noValidate sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'primary.main' }}>基本情報</Typography>
            <Divider sx={{ mb: 1.5 }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                fullWidth
                id="full_name"
                label="氏名"
                name="full_name"
                autoComplete="name"
                placeholder="例: 山田 太郎"
                value={formData.full_name}
                onChange={handleChange}
                error={!!errors.full_name}
                helperText={errors.full_name || 'ユーザー一覧やアイコン表示に使われる正式なお名前です。'}
              />
              <TextField
                fullWidth
                id="furigana"
                label="フリガナ"
                name="furigana"
                placeholder="例: ヤマダ タロウ"
                value={formData.furigana}
                onChange={handleChange}
                error={!!errors.furigana}
                helperText={errors.furigana || '五十音順の並び替えなどに使用します。任意項目です。'}
              />
            </Box>
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'primary.main' }}>ログイン情報</Typography>
            <Divider sx={{ mb: 1.5 }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                required
                fullWidth
                id="username"
                label="ユーザー名"
                name="username"
                autoComplete="username"
                autoFocus
                placeholder="例: yamada_taro"
                value={formData.username}
                onChange={handleChange}
                error={!!errors.username}
                helperText={errors.username || 'ログインやメンションで使うIDです。半角英数字が使えます。'}
              />
              <TextField
                required
                fullWidth
                id="email"
                label="メールアドレス"
                name="email"
                autoComplete="email"
                placeholder="例: taro.yamada@example.com"
                value={formData.email}
                onChange={handleChange}
                error={!!errors.email}
                helperText={errors.email || 'ログインおよび通知の送信先として使用します。'}
              />
              <TextField
                required
                fullWidth
                name="password"
                label="パスワード"
                type="password"
                id="password"
                autoComplete="new-password"
                value={formData.password}
                onChange={handleChange}
                error={!!errors.password}
                helperText={errors.password || '8文字以上で設定してください。'}
              />
              <TextField
                required
                fullWidth
                name="confirmPassword"
                label="パスワード（確認用）"
                type="password"
                id="confirmPassword"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={handleConfirmPasswordChange}
                error={!!errors.confirmPassword}
                helperText={errors.confirmPassword || '確認のためもう一度同じパスワードを入力してください。'}
              />
            </Box>
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'primary.main' }}>権限・言語設定</Typography>
            <Divider sx={{ mb: 1.5 }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControl fullWidth required error={!!errors.role}>
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
                <FormHelperText>{errors.role || '管理者はユーザー管理や各種設定の変更が行えます。'}</FormHelperText>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel id="language-label">使用言語</InputLabel>
                <Select
                  labelId="language-label"
                  id="language"
                  name="language"
                  value={formData.language || 'ja'}
                  label="使用言語"
                  onChange={handleChange as any}
                >
                  {LANGUAGE_OPTIONS.map(opt => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
                <FormHelperText>画面表示やAIとのやり取りで使用する言語です。</FormHelperText>
              </FormControl>
            </Box>
          </Box>

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
