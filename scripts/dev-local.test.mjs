// Checks local startup isolation and cleanup without modifying an existing development stack
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createConnection, createServer } from 'node:net';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { assertAvailablePorts } from './local-ports.mjs';
import { startLocalSession, stopLocalSession } from './local-session.mjs';

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

test('local port preflight rejects occupied ports and its blocker releases readiness connections', async () => {
	const blocker = createServer((socket) => socket.destroy());
	await listen(blocker, 0);
	const port = blocker.address().port;
	try {
		const probe = createConnection({ port, host: '127.0.0.1' });
		try {
			await once(probe, 'close', { signal: AbortSignal.timeout(1_000) });
		} finally {
			probe.destroy();
		}
		await assert.rejects(
			assertAvailablePorts([{ name: 'Test service', port }]),
			/Test service cannot start: 127\.0\.0\.1:.* is already in use/
		);
	} finally {
		await close(blocker);
	}
	await assertAvailablePorts([{ name: 'Test service', port }]);
});

test('a managed local session stops its own process through an authenticated control channel', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'kaordo-dev-session-'));
	const file = join(directory, 'dev-session.json');
	let closeSession;
	let closed = false;
	const closeOnce = async () => {
		if (closed || !closeSession) return;
		closed = true;
		await closeSession();
	};
	let reportStopped;
	let reportFailure;
	const stopped = new Promise((resolveStopped, rejectStopped) => {
		reportStopped = resolveStopped;
		reportFailure = rejectStopped;
	});
	try {
		closeSession = await startLocalSession(() => {
			void closeOnce().then(reportStopped, reportFailure);
		}, file);
		assert.equal((await stat(file)).mode & 0o777, 0o600);
		await assert.rejects(
			startLocalSession(() => {}, file),
			/Kaordo is already running/
		);
		assert.equal(await stopLocalSession(file), true);
		await stopped;
		assert.equal(await stopLocalSession(file), false);
	} finally {
		await closeOnce();
		await rm(directory, { recursive: true, force: true });
	}
});

test('a second pnpm dev fails before starting Docker or reporting ready', async () => {
	const blocker = createServer((socket) => socket.destroy());
	try {
		await listen(blocker, 8081);
	} catch (error) {
		// An existing local service provides the same occupied-port condition
		if (error?.code !== 'EADDRINUSE') throw error;
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
		if (blocker.listening) await close(blocker);
	}
});

test('the standalone site reports an occupied port without an uncaught exception', async () => {
	const blocker = createServer((socket) => socket.destroy());
	try {
		await listen(blocker, 8765);
	} catch (error) {
		if (error?.code !== 'EADDRINUSE') throw error;
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
		if (blocker.listening) await close(blocker);
	}
});
