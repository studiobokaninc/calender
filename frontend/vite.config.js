import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': resolve(__dirname, './src'), // src ディレクトリへのエイリアス '@' を設定
        },
    },
    optimizeDeps: {
        exclude: ['gantt-task-react'], // 最適化から除外する依存関係
        include: [
            'react',
            'react-dom',
            'react-router-dom',
            '@mui/material',
            '@mui/icons-material',
            '@fullcalendar/react',
            '@fullcalendar/daygrid',
            '@fullcalendar/timegrid',
            '@fullcalendar/interaction',
            '@fullcalendar/list',
            'date-fns',
            'dayjs',
            'axios',
            'recharts'
        ]
    },
    server: {
        host: '0.0.0.0', // 外部アクセスを許可（すべてのネットワークインターフェースでリッスン）
        port: 5175, // ★ ポート番号を 5175 に設定（実際に使用されているポート）
        strictPort: true, // ポートが使用中の場合はエラーを出す
        proxy: {
            // 静的ファイル配信: /static をそのまま転送
            '/static': {
                target: 'http://127.0.0.1:8001',
                changeOrigin: true,
            },
            // Auth and User endpoints: Forward directly (includes /api)
            '/api/auth': {
                target: 'http://127.0.0.1:8001',
                changeOrigin: true,
            },
            '/api/users': {
                target: 'http://127.0.0.1:8001',
                changeOrigin: true,
            },
            // Groups endpoints: Forward directly (includes /api)
            '/api/groups': {
                target: 'http://127.0.0.1:8001',
                changeOrigin: true,
            },
            '/api/user_groups': {
                target: 'http://127.0.0.1:8001',
                changeOrigin: true,
            },
            // Google Calendar endpoints: Forward directly (includes /api)
            '/api/google': {
                target: 'http://127.0.0.1:8001',
                changeOrigin: true,
            },
            // Other API endpoints: Forward and remove /api prefix
            '/api': {
                target: 'http://127.0.0.1:8001',
                changeOrigin: true,
                rewrite: function (path) { return path.replace(/^\/api/, ''); },
            },
        },
    },
});
