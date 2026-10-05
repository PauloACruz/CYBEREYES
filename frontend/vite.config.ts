import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:5080';

/** Commit exibido no rodape: APP_COMMIT (build da imagem) ou o HEAD local. */
function appCommit(): string {
  const fromEnv = process.env.APP_COMMIT?.trim();
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_COMMIT__: JSON.stringify(appCommit()),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/health': { target: apiTarget, changeOrigin: false },
      '/hubs': { target: apiTarget, changeOrigin: false, ws: true },
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    testTimeout: 15000,
  },
});
