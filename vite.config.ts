import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = `http://localhost:${process.env.PORT || 3001}`;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  resolve: { alias: { '@custom': path.resolve(__dirname, 'workspace/custom') } },
  server: {
    host: true,
    allowedHosts: true, // allow access via any hostname (LAN name, Tailscale MagicDNS, reverse proxy)
    port: Number(process.env.WEB_PORT || 5180),
    fs: { allow: [path.resolve(__dirname)] },
    watch: { ignored: ['**/library/**', '**/models/**', '**/.venv-tts/**', '**/workspace/media/**', '**/workspace/exports/**', '**/workspace/.cache/**', '**/workspace/project.json', '**/workspace/projects/**'] },
    proxy: {
      '/api': { target: API, xfwd: true },
      '/media': { target: API, xfwd: true },
      '/exports': { target: API, xfwd: true },
      '/cache': { target: API, xfwd: true },
      '/library': { target: API, xfwd: true },
      '/ws': { target: API.replace('http', 'ws'), ws: true, xfwd: true },
    },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
