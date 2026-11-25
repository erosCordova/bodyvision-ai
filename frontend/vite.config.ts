import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Explicit deployment hosts; never disable DNS-rebinding protection.
const allowedHosts = ['.e2b.app', 'bodyvision-ai-pruebas.onrender.com', 'bodyvision-ai-interfaz.onrender.com'];

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts,
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8000', timeout: 90000, proxyTimeout: 90000 } },
  },
  preview: {
    // Permit only the known Render hosts and Arena preview subdomains.
    allowedHosts,
  },
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'], include: ['tests/**/*.test.{ts,tsx}'] },
});
