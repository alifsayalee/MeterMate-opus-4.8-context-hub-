import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev server on :5173, API proxied to the Express server on :4000 so the
// SPA can call /api/* with no CORS/host juggling during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
