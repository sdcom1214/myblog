import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '0.0.0.0', allowedHosts: ['terminal.local'], proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT || 4174}`, changeOrigin: false } } },
});
