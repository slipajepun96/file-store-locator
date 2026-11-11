import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  build: {
    rollupOptions: {
      output: {
        // PDF.js's worker ships as .mjs. Browsers only start a module worker served as JavaScript, and many servers
        // and proxies don't know .mjs, so it's emitted as .js, which every server serves correctly.
        assetFileNames: (asset) =>
          asset.names?.[0]?.endsWith('.mjs') || asset.name?.endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    // Keep the browser's Host (localhost:5173) so the API builds the Google redirect URL for the address you opened.
    // The string shorthand would set changeOrigin: true and rewrite it to localhost:3001.
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: false } },
  },
});
