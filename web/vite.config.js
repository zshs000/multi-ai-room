import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      // 开发时把 API 请求转发到后端 Node 服务
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    // 构建产物直接输出到后端托管的 public 目录
    outDir: '../public',
    emptyOutDir: true,
  },
})
