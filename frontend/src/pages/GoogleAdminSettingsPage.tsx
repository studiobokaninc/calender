import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Paper, Breadcrumbs, Link, Button, Chip, Alert, Stack, Snackbar } from '@mui/material';
import GoogleIcon from '@mui/icons-material/Google';
import { useGoogleCalendar } from '../hooks/useGoogleCalendar';

export default function GoogleAdminSettingsPage() {
  const navigate = useNavigate();
  const {
    googleStatus,
    googleSnackbar,
    closeSnackbar,
    handleAdminConnectSharedAccount,
    handleAdminDisconnectSharedAccount,
  } = useGoogleCalendar();

  return (
    <Box sx={{ p: 3, maxWidth: 720 }}>
      <Breadcrumbs sx={{ mb: 1, fontSize: '0.8rem' }}>
        <Link component="button" onClick={() => navigate('/dashboard')} underline="hover" sx={{ fontSize: '0.8rem' }}>
          管理
        </Link>
        <Typography sx={{ fontSize: '0.8rem', color: 'text.primary' }}>Google連携設定</Typography>
      </Breadcrumbs>

      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <GoogleIcon /> Google連携設定
      </Typography>

      <Alert severity="info" sx={{ mb: 3, fontSize: '0.85rem' }}>
        ここで1つの共有Googleアカウントを連携すると、そのアカウント内に社員ごとの個人専用カレンダーが自動作成され、
        本人のメールアドレスに共有されます。各社員はOAuth認証をせず、カレンダーページの「Googleカレンダー連携」ボタンを押すだけで、
        自分に関係するタスク・イベントだけが自分のGoogleカレンダーに表示されるようになります。
      </Alert>

      {!googleStatus.configured && (
        <Alert severity="warning" sx={{ mb: 3, fontSize: '0.85rem' }}>
          バックエンドにGoogle連携が設定されていません。.envのGOOGLE_CLIENT_ID等を確認してください。
        </Alert>
      )}

      <Paper sx={{ p: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>共有アカウントの状態</Typography>

        {googleStatus.shared_account_connected ? (
          <Stack spacing={2}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Chip size="small" label="連携済み" color="success" sx={{ fontWeight: 600 }} />
              {googleStatus.shared_account_email && (
                <Typography variant="body2" color="text.secondary">{googleStatus.shared_account_email}</Typography>
              )}
            </Box>
            <Box>
              <Button
                variant="outlined"
                color="error"
                onClick={handleAdminDisconnectSharedAccount}
                sx={{ textTransform: 'none' }}
              >
                共有アカウントを解除する
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                解除すると、全社員分の個人カレンダーが一括で削除されます。
              </Typography>
            </Box>
          </Stack>
        ) : (
          <Stack spacing={2}>
            <Chip size="small" label="未連携" variant="outlined" sx={{ width: 'fit-content' }} />
            <Button
              variant="contained"
              onClick={handleAdminConnectSharedAccount}
              disabled={!googleStatus.configured}
              sx={{ textTransform: 'none', fontWeight: 600, width: 'fit-content' }}
            >
              Googleアカウントを連携する
            </Button>
          </Stack>
        )}

        {googleStatus.shared_account_error && (
          <Alert severity="error" sx={{ mt: 3, fontSize: '0.85rem' }}>
            {googleStatus.shared_account_error}
          </Alert>
        )}
      </Paper>

      <Snackbar
        open={googleSnackbar.open}
        autoHideDuration={5000}
        onClose={closeSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={closeSnackbar} severity={googleSnackbar.severity} sx={{ width: '100%' }}>
          {googleSnackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
