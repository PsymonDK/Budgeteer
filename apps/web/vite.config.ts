import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // API routes have no /api prefix; strip it like nginx does in Docker.
        rewrite: (path) => path.replace(/^\/api/, ''),
      }
    }
  }
})