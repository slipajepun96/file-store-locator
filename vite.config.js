import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: 5173,
    // Keep the browser's Host (localhost:5173) so the API builds the Google redirect URL for the address you opened.
    // The string shorthand would set changeOrigin: true and rewrite it to localhost:3001.
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: false } },
  },
});
