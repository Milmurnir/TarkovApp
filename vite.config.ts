import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Both upstreams are proxied in dev so the browser never hits a CORS wall.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api/wiki': {
        target: 'https://escapefromtarkov.fandom.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/wiki/, '/api.php'),
      },
      '/api/tarkov': {
        target: 'https://api.tarkov.dev',
        changeOrigin: true,
        rewrite: () => '/graphql',
      },
      // The GraphQL API has been down for a month; json.tarkov.dev is the
      // maintainers' recommended replacement and is what their own site uses.
      '/api/json': {
        target: 'https://json.tarkov.dev',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/json/, ''),
      },
    },
  },
});
