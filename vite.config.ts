import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT ?? 3000}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${process.env.PORT ?? 3000}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
});
