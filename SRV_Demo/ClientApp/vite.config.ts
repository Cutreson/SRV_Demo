import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built output goes to ../wwwroot/app and is served by the ASP.NET host at /app/ (same origin as /api and /hubs).
// During `npm run dev` Vite serves the UI at http://localhost:5173/app/ and proxies API + SignalR to the ASP.NET dev server.
const API_TARGET = process.env.SORA_API_TARGET ?? 'http://localhost:5267';

export default defineConfig({
  base: '/app/',
  plugins: [react()],
  build: {
    outDir: '../wwwroot/app',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
      '/hubs': { target: API_TARGET, changeOrigin: false, ws: true },
    },
  },
});
