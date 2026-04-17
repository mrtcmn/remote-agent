import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 13591,
    proxy: {
      '/api': {
        target: 'http://localhost:13590',
        changeOrigin: false,  // Keep origin as localhost:13591
        cookieDomainRewrite: 'localhost',  // Rewrite cookie domain
        secure: false,
      },
      '/ws': {
        target: 'ws://localhost:13590',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
