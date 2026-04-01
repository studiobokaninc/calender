import React from 'react'
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Box,
    Divider,
} from '@mui/material'

interface VoiceHelpDialogProps {
    open: boolean
    onClose: () => void
}

export const VoiceHelpDialog: React.FC<VoiceHelpDialogProps> = ({ open, onClose }) => {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ fontWeight: 'bold' }}>音声機能の権限設定について</DialogTitle>
            <DialogContent>
                <Typography variant="body2" paragraph>
                    ブラウザのセキュリティ制限により、<b>HTTPS</b> でのアクセスまたは <b>localhost</b> 以外では音声認識（マイク）が自動的にブロックされます。
                </Typography>
                <Typography variant="body2" paragraph>
                    プライバシー設定がグレーアウトしていて変更できない場合は、以下のフラグ設定を行うことで利用可能になります。
                </Typography>

                <Box sx={{ bgcolor: 'action.hover', p: 1.5, borderRadius: 1.5, border: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 0.5, color: 'primary.main' }}>
                        Chrome / Edge の設定手順 (開発・LAN内用)
                    </Typography>
                    <Box component="ol" sx={{ m: 0, pl: 2.5, fontSize: '0.85rem' }}>
                        <li>
                            アドレスバーに <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code> を入力（Edgeの場合は <code>edge://...</code>）
                        </li>
                        <li>
                            <b>Insecure origins treated as secure</b> を <b>Enabled</b> に変更
                        </li>
                        <li>
                            その下に入力欄が出るので、現在のURL（例: <code>http://192.168.x.x:5175</code>）を入力
                        </li>
                        <li>
                            ブラウザを再起動（Relaunch）して完了
                        </li>
                    </Box>
                </Box>

                <Divider sx={{ my: 2 }} />
                <Typography variant="caption" color="text.secondary">
                    ※これは開発や検証のための暫定的な回避策です。本番運用では HTTPS（SSL証明書）の使用が推奨されます。
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} variant="contained" autoFocus>
                    閉じる
                </Button>
            </DialogActions>
        </Dialog>
    )
}
