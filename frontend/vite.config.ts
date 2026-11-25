import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['.e2b.app'],
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8000', timeout: 90000, proxyTimeout: 90000 } },
  },
  preview: {
    // Accept Arena live-preview subdomains when running `vite preview` on 0.0.0.0.
    allowedHosts: ['.e2b.app'],
  },
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'], include: ['tests/**/*.test.{ts,tsx}'] },
});
