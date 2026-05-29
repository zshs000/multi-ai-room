import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      // 开发时把 API 请求转发到后端 Node 服务
      '/api': apiProxyTarget,
    },
  },
  build: {
    // 构建产物直接输出到后端托管的 public 目录
    outDir: '../public',
    emptyOutDir: true,
  },
})
