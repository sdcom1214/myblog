import { defineConfig } from 'vite';
import { securityHeaders } from './server/security.js';

export default defineConfig({
  server: {
    host: '0.0.0.0', allowedHosts: ['terminal.local'], headers: securityHeaders({ development: true }),
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**', '**/.codex/**', '**/.agents/**'] },
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT || 4174}`, changeOrigin: false } },
  },
});
