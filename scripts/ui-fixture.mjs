// Reuses worker-owned Vite servers while Playwright isolates each test's browser state

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test as base, expect } from '@playwright/test';
import { createPageServer } from './serve-pages.mjs';

const root = resolve(import.meta.dirname, '..');

async function startServer(app) {
  const socket = createServer();
  await new Promise((resolveListen) => socket.listen(0, '127.0.0.1', resolveListen));
  const port = socket.address().port;
  await new Promise((resolveClose) => socket.close(resolveClose));
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [
    resolve(root, `apps/${app}/node_modules/vite/bin/vite.js`),
    '--host', '127.0.0.1', '--port', String(port), '--strictPort',
  ], {
    cwd: resolve(root, `apps/${app}`),
    env: {
      ...process.env,
      KAORDO_LOCAL_DEV: '0',
      VITE_KAORDO_AUTH_URL: origin,
      VITE_KAORDO_AUTH_REALM: 'fixture',
      VITE_KAORDO_AUTH_CLIENT_ID: 'fixture',
      VITE_KAORDO_API_URL: origin,
      VITE_KAORDO_NODO_URL: origin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let startError;
  server.on('error', (error) => { startError = error; });
  server.stdout.on('data', (chunk) => { output = (output + chunk).slice(-64_000); });
  server.stderr.on('data', (chunk) => { output = (output + chunk).slice(-64_000); });
  async function stop() {
    if (server.exitCode !== null || server.signalCode !== null || startError) return;
    const stopped = once(server, 'close');
    const force = setTimeout(() => server.kill('SIGKILL'), 5_000);
    server.kill('SIGTERM');
    try { await stopped; } finally { clearTimeout(force); }
  }
  try {
    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (startError || server.exitCode !== null || server.signalCode !== null) break;
      try {
        ready = (await fetch(`${origin}/${app}/`, { signal: AbortSignal.timeout(1_000) })).status === 200;
      } catch { /* Vite may still be starting */ }
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, `${app} fixture server must start: ${startError?.message ?? output}`);
    return { origin, stop, log: () => output };
  } catch (error) {
    await stop();
    throw error;
  }
}

export const test = base.extend({
  staticOrigin: [async ({}, use) => {
    assert.ok(existsSync(resolve(root, 'dist/pages/index.html')), 'Run pnpm build:pages first');
    const server = createPageServer();
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    try {
      await use(`http://127.0.0.1:${server.address().port}`);
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  }, { scope: 'worker' }],
  fixtureServers: [async ({}, use) => {
    const servers = new Map();
    try {
      await use(async (app) => {
        if (!servers.has(app)) servers.set(app, await startServer(app));
        return servers.get(app);
      });
    } finally {
      await Promise.all([...servers.values()].map((server) => server.stop()));
    }
  }, { scope: 'worker' }],
  startAppFixture: async ({ page, fixtureServers }, use, testInfo) => {
    let server;
    try {
      await use(async (app) => {
        assert.ok(!server, 'Each browser test owns one app fixture');
        server = await fixtureServers(app);
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/*keycloak-js*', (route) => route.fulfill({
          contentType: 'text/javascript',
          body: `export default class { authenticated=true; token='fixture'; tokenParsed={sub:'fixture'}; async init(){return true} async updateToken(){return false} }`,
        }));
        return { page, origin: server.origin, errors };
      });
    } finally {
      if (server && testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('Vite server log', { body: server.log(), contentType: 'text/plain' });
      }
    }
  },
});

export { expect };
