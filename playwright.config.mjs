// Configures isolated browser checks and real-service journeys with bounded CI diagnostics

import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.CHROME_BIN || (existsSync(macChrome) ? macChrome : undefined);

export default defineConfig({
  testDir: './scripts',
  outputDir: './dist/test-results/browser',
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : 2,
  webServer: process.env.KAORDO_START_SERVICES === '1' ? {
    command: 'node scripts/dev-local.mjs --static',
    url: 'http://localhost:8765/login/',
    reuseExistingServer: false,
    timeout: 150_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    stdout: 'pipe',
    stderr: 'pipe',
  } : undefined,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: 'dist/test-results/report', open: 'never' }]]
    : 'list',
  use: {
    headless: true,
    launchOptions: { executablePath },
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'browser', testMatch: ['product-ui.test.mjs', 'regado-ui.test.mjs', 'ui-public.test.mjs', 'ui-quality.test.mjs'] },
    {
      name: 'live',
      outputDir: './dist/test-results/live',
      testMatch: ['auth-live.integration.mjs', 'backup-live.integration.mjs'],
      use: {
        trace: 'off', screenshot: 'off',
        launchOptions: { executablePath, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
      },
    },
  ],
});
