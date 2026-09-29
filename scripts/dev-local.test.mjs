import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { assertAvailablePorts } from './local-ports.mjs';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');

async function listen(server, port) {
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', resolveListen);
  });
}

async function close(server) {
  await new Promise((resolveClose) => server.close(resolveClose));
}

test('local port preflight accepts a free loopback port and rejects an occupied one', async () => {
  const blocker = createServer();
  await listen(blocker, 0);
  const port = blocker.address().port;
  try {
    await assert.rejects(
      assertAvailablePorts([{ name: 'Test service', port }]),
      /Test service cannot start: 127\.0\.0\.1:.* is already in use/
    );
  } finally {
    await close(blocker);
  }
  await assertAvailablePorts([{ name: 'Test service', port }]);
});

test('a second pnpm dev fails before starting Docker or reporting ready', async (t) => {
  const blocker = createServer();
  try {
    await listen(blocker, 8081);
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      t.skip('Kerno port is already occupied by a running local server');
      return;
    }
    throw error;
  }
  try {
    await assert.rejects(
      exec(process.execPath, ['scripts/dev-local.mjs'], { cwd: root, timeout: 5_000 }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /Kerno cannot start: 127\.0\.0\.1:8081 is already in use/);
        assert.doesNotMatch(error.stdout, /Starting PostgreSQL|Ready:/);
        return true;
      }
    );
  } finally {
    await close(blocker);
  }
});

test('the standalone site reports an occupied port without an uncaught exception', async (t) => {
  const blocker = createServer();
  try {
    await listen(blocker, 8765);
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      t.skip('Site port is already occupied by a running local server');
      return;
    }
    throw error;
  }
  try {
    await assert.rejects(
      exec(process.execPath, ['scripts/serve-pages.mjs'], { cwd: root, timeout: 5_000 }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /Kaordo site cannot start: 127\.0\.0\.1:8765 is already in use/);
        assert.doesNotMatch(error.stderr, /Unhandled 'error' event/);
        return true;
      }
    );
  } finally {
    await close(blocker);
  }
});
