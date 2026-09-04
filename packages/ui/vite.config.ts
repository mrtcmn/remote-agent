import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Dev ports: the API on 13690, this server on 13692 (the desktop dev webview
// holds 13691). The installed app keeps 13590.
const API_PORT = process.env.RA_PORT ?? '13690';
const UI_PORT = Number(process.env.RA_UI_PORT ?? 13692);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: UI_PORT,
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: false,  // Keep the browser origin
        cookieDomainRewrite: 'localhost',  // Rewrite cookie domain
        secure: false,
      },
      '/ws': {
        target: `ws://localhost:${API_PORT}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
