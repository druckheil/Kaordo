import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const localSessionFile = resolve(import.meta.dirname, '../dist/local/dev-session.json');

function validSession(value) {
  return value && Number.isInteger(value.pid) && value.pid > 0 &&
    Number.isInteger(value.port) && value.port > 0 && value.port < 65536 &&
    typeof value.token === 'string' && /^[0-9a-f]{64}$/.test(value.token);
}

async function readSession(file) {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    if (!validSession(value)) throw new Error('The Kaordo local session file is invalid.');
    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function sessionRequest(session, path, method, timeout = 2000) {
  return fetch(`http://127.0.0.1:${session.port}${path}`, {
    method,
    headers: { Authorization: `Bearer ${session.token}` },
    signal: AbortSignal.timeout(timeout)
  });
}

export async function startLocalSession(onStop, file = localSessionFile) {
  const token = randomBytes(32).toString('hex');
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403).end();
      return;
    }
    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(204).end();
      return;
    }
    if (request.method === 'POST' && request.url === '/stop') {
      response.writeHead(204).end();
      queueMicrotask(onStop);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const session = { pid: process.pid, port: server.address().port, token };
  try {
    await mkdir(dirname(file), { recursive: true });
    try {
      await writeFile(file, JSON.stringify(session), { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const previous = await readSession(file);
      try {
        const response = await sessionRequest(previous, '/healthz', 'GET');
        if (response.status === 204) {
          throw new Error('Kaordo is already running. Use pnpm dev:stop before starting another session.');
        }
      } catch (cause) {
        if (cause?.message?.startsWith('Kaordo is already running.')) throw cause;
      }
      await rm(file);
      await writeFile(file, JSON.stringify(session), { mode: 0o600, flag: 'wx' });
    }
  } catch (error) {
    server.close();
    throw error;
  }
  return async () => {
    const current = await readSession(file);
    if (current?.token === token) await rm(file);
    await new Promise((resolveClose) => server.close(resolveClose));
  };
}

export async function stopLocalSession(file = localSessionFile) {
  const session = await readSession(file);
  if (!session) return false;
  let response;
  try {
    response = await sessionRequest(session, '/stop', 'POST');
  } catch {
    await rm(file, { force: true });
    return false;
  }
  if (response.status !== 204) {
    throw new Error(`Kaordo refused its local stop request (${response.status}).`);
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const health = await sessionRequest(session, '/healthz', 'GET', 1000);
      if (health.status !== 204) return true;
    } catch {
      return true;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Kaordo did not stop within 10 seconds. Docker containers were left running.');
}
