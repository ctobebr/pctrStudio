import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    // Node 17+ 在 Windows 上将 localhost 解析为 IPv6(::1)，vite 默认只绑定 ::1，
    // 导致 scripts/dev.cjs 轮询/加载 127.0.0.1 时连接被拒（Electron 无法拉起）。
    // 显式绑定 IPv4 回环地址，与 dev.cjs 保持一致。
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
})
