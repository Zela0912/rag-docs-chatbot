import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the API runs separately; the proxy makes it same-origin, so no CORS setup is needed.
    proxy: { '/api': 'http://localhost:3001' },
  },
  build: { sourcemap: true },
});
