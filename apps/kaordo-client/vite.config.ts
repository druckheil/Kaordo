import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

const tauriHost = process.env.TAURI_DEV_HOST;
const apiOrigin = `https://${['veri', 'dimensio-api'].join('')}.pshenychnyi-ld.workers.dev`;

export default defineConfig({
  clearScreen: false,
  plugins: [svelte(), svelteTesting()],
  server: {
    host: tauriHost || false,
    port: 1420,
    proxy: {
      '/api': {
        changeOrigin: true,
        target: apiOrigin,
      },
    },
    strictPort: true,
    hmr: tauriHost
      ? {
          host: tauriHost,
          port: 1421,
          protocol: 'ws',
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  test: {
    environment: 'jsdom',
    fileParallelism: false,
    setupFiles: ['./src/vitest-setup.ts'],
  },
});
