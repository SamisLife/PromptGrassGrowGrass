import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Keep builds inside the frontend workspace. A deployment can explicitly use
// `vite build --outDir ../app/assets`; base './' works at any host/port/prefix.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: { host: true, port: 5173 },
});
