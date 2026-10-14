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
    port: Number(process.env.WEB_PORT || 5180),
    fs: { allow: [path.resolve(__dirname)] },
    watch: { ignored: ['**/workspace/media/**', '**/workspace/exports/**', '**/workspace/.cache/**', '**/workspace/project.json'] },
    proxy: {
      '/api': API,
      '/media': API,
      '/exports': API,
      '/cache': API,
      '/ws': { target: API.replace('http', 'ws'), ws: true },
    },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
