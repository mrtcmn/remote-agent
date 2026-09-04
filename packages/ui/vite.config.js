var _a, _b;
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
// Dev ports: the API on 13690, this server on 13692 (the desktop dev webview
// holds 13691). The installed app keeps 13590.
var API_PORT = (_a = process.env.RA_PORT) !== null && _a !== void 0 ? _a : '13690';
var UI_PORT = Number((_b = process.env.RA_UI_PORT) !== null && _b !== void 0 ? _b : 13692);
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
                target: "http://localhost:".concat(API_PORT),
                changeOrigin: false, // Keep the browser origin
                cookieDomainRewrite: 'localhost', // Rewrite cookie domain
                secure: false,
            },
            '/ws': {
                target: "ws://localhost:".concat(API_PORT),
                ws: true,
            },
        },
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
});
