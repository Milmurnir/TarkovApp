import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The upstreams are proxied in dev so the browser never hits a CORS wall.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api/wiki': {
        target: 'https://escapefromtarkov.fandom.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/wiki/, '/api.php'),
      },
      // json.tarkov.dev, not the tarkov.dev GraphQL API: see the README.
      '/api/json': {
        target: 'https://json.tarkov.dev',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/json/, ''),
      },
    },
  },
});
