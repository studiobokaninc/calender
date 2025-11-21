import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

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
    port: 5175, // ★ ポート番号を 5175 に設定（実際に使用されているポート）
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
      // Other API endpoints: Forward and remove /api prefix
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
