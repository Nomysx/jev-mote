import { defineConfig } from 'vite';

const apiPort = Number(process.env.MOTE_PORT) || 5174;

export default defineConfig({
  root: 'client',
  publicDir: false,
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    // Everything (fonts, three.js) is bundled locally. No CDN.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 800,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
  preview: {
    host: '127.0.0.1',
  },
});
