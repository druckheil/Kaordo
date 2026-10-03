// Starts an isolated app with fixture identity for headless interaction checks

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function unusedPort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

export async function startAppFixture(t, app) {
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [resolve(root, `apps/${app}/node_modules/vite/bin/vite.js`), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: resolve(root, `apps/${app}`),
    env: {
      ...process.env,
      VITE_KAORDO_AUTH_URL: origin,
      VITE_KAORDO_AUTH_REALM: 'fixture',
      VITE_KAORDO_AUTH_CLIENT_ID: 'fixture',
      VITE_KAORDO_API_URL: origin,
      VITE_KAORDO_NODO_URL: origin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });
  t.after(async () => {
    await browser?.close();
    if (server.exitCode !== null || server.signalCode !== null) return;
    const stopped = once(server, 'exit');
    server.kill('SIGTERM');
    await stopped;
  });
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { ready = (await fetch(`${origin}/${app}/`)).status === 200; } catch {}
    if (ready || server.exitCode !== null) break;
    await delay(100);
  }
  assert.ok(ready, `${app} test server starts: ${output}`);
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN || (existsSync(macChrome) ? macChrome : undefined),
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*keycloak-js*', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `export default class { authenticated=true; token='fixture'; tokenParsed={sub:'fixture'}; async init(){return true} async updateToken(){return false} }`,
  }));
  return { page, origin, errors };
}
