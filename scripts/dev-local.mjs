import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { assertAvailablePorts } from './local-ports.mjs';
import { syncKeycloak } from './sync-keycloak.mjs';

const root = resolve(import.meta.dirname, '..');
const compose = ['compose', '--env-file', 'deploy/local/.env', '-f', 'deploy/local/compose.yaml'];
const siteOrigin = 'http://localhost:8765';
const children = new Set();
const startErrors = new WeakMap();
let stopping = false;

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function ensureConfiguration() {
  const publicEnv = resolve(root, '.env');
  if (!(await exists(publicEnv))) {
    await copyFile(resolve(root, '.env.example'), publicEnv);
    console.log('Created local public configuration: .env');
  }

  const privateEnv = resolve(root, 'deploy/local/.env');
  if (!(await exists(privateEnv))) {
    const password = () => randomBytes(24).toString('hex');
    const values = [
      `KAORDO_DB_PASSWORD=${password()}`,
      `KEYCLOAK_DB_PASSWORD=${password()}`,
      'KEYCLOAK_ADMIN_USERNAME=admin',
      `KEYCLOAK_ADMIN_PASSWORD=${password()}`,
      `KAORDO_SITE_ORIGIN=${siteOrigin}`,
      ''
    ].join('\n');
    await writeFile(privateEnv, values, { mode: 0o600, flag: 'wx' });
    console.log('Created ignored local credentials: deploy/local/.env');
  }

  const privateConfig = parseEnv(await readFile(privateEnv, 'utf8'));
  for (const name of ['KAORDO_DB_PASSWORD', 'KEYCLOAK_DB_PASSWORD', 'KEYCLOAK_ADMIN_PASSWORD']) {
    if (!privateConfig[name] || privateConfig[name].startsWith('REPLACE_')) {
      throw new Error(`${name} must be a real value in deploy/local/.env.`);
    }
  }
  if (!privateConfig.KEYCLOAK_ADMIN_USERNAME) {
    throw new Error('KEYCLOAK_ADMIN_USERNAME is missing from deploy/local/.env.');
  }
  return privateConfig;
}

function start(command, args, environment = process.env) {
  const child = spawn(command, args, { cwd: root, env: environment, stdio: 'inherit' });
  children.add(child);
  child.once('error', (error) => startErrors.set(child, error));
  child.once('close', () => children.delete(child));
  return child;
}

function run(command, args, environment = process.env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = start(command, args, environment);
    child.once('error', rejectRun);
    child.once('exit', (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} ${args[0] ?? ''} exited with status ${code}.`));
    });
  });
}

async function waitFor(url, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !stopping) {
    assertRunning(child, url);
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    } catch {
      // A service may still be starting.
    }
    if (response?.ok) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      assertRunning(child, url);
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function assertRunning(child, url) {
  if (!child) return;
  const error = startErrors.get(child);
  if (error) throw new Error(`Could not start the service for ${url}: ${error.message}`);
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(`The service for ${url} exited before it was ready (${child.exitCode ?? child.signalCode}).`);
  }
}

function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  await assertAvailablePorts([
    { name: 'Kerno', port: 8081 },
    { name: 'Kaordo site', port: 8765 }
  ]);
  const privateConfig = await ensureConfiguration();
  try {
    await run('docker', ['compose', 'version']);
  } catch {
    throw new Error('Docker Compose is required for sign-in. Install/start Docker, then run pnpm dev. For the UI only, run pnpm dev:web.');
  }

  const localEnv = { ...process.env, ...privateConfig, KAORDO_SITE_ORIGIN: siteOrigin };
  console.log('Starting PostgreSQL and Keycloak…');
  await run('docker', [...compose, 'up', '-d', '--wait'], localEnv);
  await waitFor('http://127.0.0.1:8080/realms/kaordo/.well-known/openid-configuration', 180_000);
  await syncKeycloak(privateConfig);

  console.log('Building Kerno…');
  await mkdir(resolve(root, 'dist/local'), { recursive: true });
  await run('go', ['build', '-o', 'dist/local/kerno', './services/kerno/cmd/kerno']);
  const kernoEnv = {
    ...process.env,
    DATABASE_URL: `postgres://kaordo:${encodeURIComponent(privateConfig.KAORDO_DB_PASSWORD)}@127.0.0.1:5432/kaordo?sslmode=disable`,
    OIDC_ISSUER: 'http://localhost:8080/realms/kaordo',
    OIDC_AUDIENCE: 'kerno-api',
    KAORDO_ALLOWED_ORIGINS: `${siteOrigin},http://localhost:5173`
  };
  const kerno = start(resolve(root, 'dist/local/kerno'), [], kernoEnv);
  await waitFor('http://127.0.0.1:8081/healthz', 30_000, kerno);

  console.log('Building the five application routes…');
  await run('pnpm', ['build:pages']);
  const web = start(process.execPath, ['scripts/serve-pages.mjs']);
  await waitFor('http://127.0.0.1:8765/login/', 10_000, web);
  console.log('Ready: http://localhost:8765/login/');
  console.log('Press Ctrl+C to stop Kerno and the site. Run pnpm dev:stop to stop Docker services.');

  await new Promise((resolveDone, rejectDone) => {
    const onStop = () => resolveDone();
    const onExit = (name) => (code, signal) => {
      if (stopping) resolveDone();
      else rejectDone(new Error(`${name} exited unexpectedly (${code ?? signal}).`));
    };
    if (kerno.exitCode !== null || kerno.signalCode !== null) {
      rejectDone(new Error(`Kerno exited unexpectedly (${kerno.exitCode ?? kerno.signalCode}).`));
      return;
    }
    if (web.exitCode !== null || web.signalCode !== null) {
      rejectDone(new Error(`Kaordo site exited unexpectedly (${web.exitCode ?? web.signalCode}).`));
      return;
    }
    process.once('SIGINT', onStop);
    process.once('SIGTERM', onStop);
    kerno.once('exit', onExit('Kerno'));
    web.once('exit', onExit('Kaordo site'));
  });
  stop();
} catch (error) {
  stop();
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
