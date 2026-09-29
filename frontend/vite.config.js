import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = process.env.API_PORT || 3433;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3333,
    strictPort: true,
    host: true,
    // The app's API base stays relative (/api) so no origin is ever compiled
    // into the bundle; dev traffic is proxied to the backend from here.
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  preview: { port: 3333, strictPort: true },
  build: { outDir: process.env.BUILD_DIR || 'dist' },
});
