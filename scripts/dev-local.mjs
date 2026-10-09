// Starts the local Kaordo services and prepares their development configuration
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv, promisify } from 'node:util';
import { assertAvailablePorts } from './local-ports.mjs';
import { startLocalSession } from './local-session.mjs';
import { localDevelopmentPorts, localFrontendServers } from './local-vite.mjs';
import { syncKeycloak } from './sync-keycloak.mjs';

const root = resolve(import.meta.dirname, '..');
const staticFrontend = process.argv.includes('--static');
const compose = ['compose', '--env-file', 'deploy/local/.env', '-f', 'deploy/local/compose.yaml'];
const siteOrigin = 'http://localhost:8765';
const children = new Set();
const startErrors = new WeakMap();
let stopping = false;
let notifyStop;
const stopRequested = new Promise((resolveStop) => {
	notifyStop = resolveStop;
});
let closeSession;

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error?.code === 'ENOENT') return false;
		throw error;
	}
}

function createPrivateConfiguration() {
	const password = () => randomBytes(24).toString('hex');
	return [
		`KAORDO_DB_PASSWORD=${password()}`,
		`KEYCLOAK_DB_PASSWORD=${password()}`,
		'KEYCLOAK_ADMIN_USERNAME=admin',
		`KEYCLOAK_ADMIN_PASSWORD=${password()}`,
		`KAORDO_SITE_ORIGIN=${siteOrigin}`,
		`NODO_MEDIA_SIGNING_KEY=${randomBytes(32).toString('hex')}`,
		''
	].join('\n');
}

async function ensurePublicConfiguration() {
	const publicEnv = resolve(root, '.env');
	if (!(await exists(publicEnv))) {
		await copyFile(resolve(root, '.env.example'), publicEnv);
		console.log('Created local public configuration: .env');
	}
	const publicConfig = parseEnv(await readFile(publicEnv, 'utf8'));
	if (!publicConfig.VITE_KAORDO_NODO_URL) {
		await writeFile(publicEnv, '\nVITE_KAORDO_NODO_URL=http://127.0.0.1:8082\n', { flag: 'a' });
	}
}

async function ensurePrivateConfiguration() {
	const privateEnv = resolve(root, 'deploy/local/.env');
	if (!(await exists(privateEnv))) {
		await writeFile(privateEnv, createPrivateConfiguration(), { mode: 0o600, flag: 'wx' });
		console.log('Created ignored local credentials: deploy/local/.env');
	}
	await chmod(privateEnv, 0o600);

	const privateConfig = parseEnv(await readFile(privateEnv, 'utf8'));
	if (!privateConfig.NODO_MEDIA_SIGNING_KEY) {
		privateConfig.NODO_MEDIA_SIGNING_KEY = randomBytes(32).toString('hex');
		await writeFile(
			privateEnv,
			`\nNODO_MEDIA_SIGNING_KEY=${privateConfig.NODO_MEDIA_SIGNING_KEY}\n`,
			{ flag: 'a' }
		);
	}
	await ensureLiveKitCredentials(privateEnv, privateConfig);
	validatePrivateConfiguration(privateConfig);
	return privateConfig;
}

async function ensureLiveKitCredentials(privateEnv, privateConfig) {
	for (const name of ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']) {
		if (!privateConfig[name] || privateConfig[name].startsWith('REPLACE_')) {
			privateConfig[name] = randomBytes(name === 'LIVEKIT_API_KEY' ? 16 : 32).toString('hex');
			await writeFile(privateEnv, `\n${name}=${privateConfig[name]}\n`, { flag: 'a' });
		}
	}
}

function validatePrivateConfiguration(privateConfig) {
	for (const name of ['KAORDO_DB_PASSWORD', 'KEYCLOAK_DB_PASSWORD', 'KEYCLOAK_ADMIN_PASSWORD']) {
		if (!privateConfig[name] || privateConfig[name].startsWith('REPLACE_')) {
			throw new Error(`${name} must be a real value in deploy/local/.env.`);
		}
	}
	if (!privateConfig.KEYCLOAK_ADMIN_USERNAME) {
		throw new Error('KEYCLOAK_ADMIN_USERNAME is missing from deploy/local/.env.');
	}
	if (!/^[0-9a-f]{64}$/i.test(privateConfig.NODO_MEDIA_SIGNING_KEY)) {
		throw new Error('NODO_MEDIA_SIGNING_KEY must be 64 hexadecimal characters.');
	}
	if (
		!/^[0-9a-f]{32}$/.test(privateConfig.LIVEKIT_API_KEY) ||
		!/^[0-9a-f]{64}$/.test(privateConfig.LIVEKIT_API_SECRET)
	) {
		throw new Error(
			'LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be generated hexadecimal credentials.'
		);
	}
}

async function ensureConfiguration() {
	await ensurePublicConfiguration();
	return ensurePrivateConfiguration();
}

function start(command, args, environment = process.env, cwd = root) {
	const child = spawn(command, args, { cwd, env: environment, stdio: 'inherit' });
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
		throw new Error(
			`The service for ${url} exited before it was ready (${child.exitCode ?? child.signalCode}).`
		);
	}
}

function stop() {
	if (stopping) return;
	stopping = true;
	for (const child of children) child.kill('SIGTERM');
	notifyStop();
}

async function waitForChildren() {
	const pending = [...children].map(
		(child) =>
			new Promise((resolveClose) => {
				if (child.exitCode !== null || child.signalCode !== null) resolveClose();
				else child.once('close', resolveClose);
			})
	);
	let timeout;
	await Promise.race([
		Promise.all(pending),
		new Promise((resolveTimeout) => {
			timeout = setTimeout(resolveTimeout, 5000);
		})
	]);
	clearTimeout(timeout);
	for (const child of children) child.kill('SIGKILL');
}

async function ensureDockerAvailable() {
	try {
		await run('docker', ['compose', 'version']);
	} catch {
		throw new Error(
			'Docker Compose is required for sign-in. Install/start Docker, then run pnpm dev. For the UI only, run pnpm dev:web.'
		);
	}
}

// Kerno applies its migrations on start. A database created by the pre-Goose SQL files cannot be
// upgraded in place, so its disposable local schema is recreated once.
async function resetPreGooseSchema(environment) {
	const psql = [
		...compose,
		'exec',
		'-T',
		'app-db',
		'psql',
		'-X',
		'-q',
		'-At',
		'-U',
		'kaordo',
		'-d',
		'kaordo'
	];
	const { stdout } = await promisify(execFile)(
		'docker',
		[
			...psql,
			'-c',
			"SELECT to_regclass('public.users') IS NOT NULL AND to_regclass('public.goose_db_version') IS NULL"
		],
		{ cwd: root, env: environment }
	);
	if (stdout.trim() !== 't') return;
	console.log('Recreating the local application schema for versioned migrations…');
	await run(
		'docker',
		[...psql, '-v', 'ON_ERROR_STOP=1', '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'],
		environment
	);
}

async function buildAndStartKerno(privateConfig) {
	console.log('Building Kerno…');
	await mkdir(resolve(root, 'dist/local'), { recursive: true });
	await run('go', ['build', '-o', 'dist/local/kerno', './services/kerno/cmd/kerno']);
	const environment = {
		...process.env,
		DATABASE_URL: `postgres://kaordo:${encodeURIComponent(privateConfig.KAORDO_DB_PASSWORD)}@127.0.0.1:5432/kaordo?sslmode=disable`,
		OIDC_ISSUER: 'http://localhost:8080/realms/kaordo',
		OIDC_AUDIENCE: 'kerno-api',
		KAORDO_ALLOWED_ORIGINS: `${siteOrigin},http://localhost:5173`,
		NODO_INTERNAL_URL: 'http://127.0.0.1:8082',
		NODO_PUBLIC_URL: 'http://127.0.0.1:8082',
		NODO_MEDIA_SIGNING_KEY: privateConfig.NODO_MEDIA_SIGNING_KEY,
		LIVEKIT_URL: 'http://127.0.0.1:7880',
		LIVEKIT_PUBLIC_URL: 'ws://127.0.0.1:7880',
		LIVEKIT_API_KEY: privateConfig.LIVEKIT_API_KEY,
		LIVEKIT_API_SECRET: privateConfig.LIVEKIT_API_SECRET
	};
	const child = start(resolve(root, 'dist/local/kerno'), [], environment);
	await waitFor('http://127.0.0.1:8081/healthz', 30_000, child);
	return child;
}

async function buildAndStartNodo(privateConfig) {
	console.log('Building Nodo…');
	await mkdir(resolve(root, 'deploy/local/media'), { recursive: true });
	await run('go', ['build', '-o', 'dist/local/nodo', './services/nodo/cmd/nodo']);
	const environment = {
		...process.env,
		KERNO_INTERNAL_URL: 'http://127.0.0.1:8081',
		NODO_DATA_DIR: resolve(root, 'deploy/local/media'),
		NODO_ALLOWED_ORIGINS: `${siteOrigin},http://localhost:5173,http://localhost:5175`,
		NODO_MEDIA_SIGNING_KEY: privateConfig.NODO_MEDIA_SIGNING_KEY
	};
	const child = start(resolve(root, 'dist/local/nodo'), [], environment);
	await waitFor('http://127.0.0.1:8082/healthz', 30_000, child);
	return child;
}

async function startFrontendApplications() {
	if (staticFrontend) {
		console.log('Serving the built static applications without HMR…');
		const child = start(process.execPath, [resolve(root, 'scripts/serve-pages.mjs')]);
		await waitFor(`${siteOrigin}/login/`, 10_000, child);
		return [['Static applications', child]];
	}
	console.log(`Starting ${localFrontendServers.length} Vite development servers with HMR…`);
	const environment = { ...process.env, KAORDO_LOCAL_DEV: '1' };
	const applications = localFrontendServers.map((application) => {
		const appDirectory = resolve(root, 'apps', application.id);
		const viteCli = resolve(appDirectory, 'node_modules/vite/bin/vite.js');
		const child = start(process.execPath, [viteCli, 'dev'], environment, appDirectory);
		return { application, child };
	});

	await Promise.all(
		applications.map(({ application, child }) =>
			waitFor(`http://127.0.0.1:${application.port}${application.readyPath}`, 60_000, child)
		)
	);

	return applications.map(({ application, child }) => [`${application.name} Vite`, child]);
}

async function waitForApplicationExit(services) {
	await new Promise((resolveDone, rejectDone) => {
		for (const [name, child] of services) {
			if (child.exitCode !== null || child.signalCode !== null) {
				rejectDone(
					new Error(`${name} exited unexpectedly (${child.exitCode ?? child.signalCode}).`)
				);
				return;
			}
		}

		for (const [name, child] of services) {
			child.once('exit', (code, signal) => {
				if (stopping) resolveDone();
				else rejectDone(new Error(`${name} exited unexpectedly (${code ?? signal}).`));
			});
		}
		void stopRequested.then(resolveDone);
	});
}

async function startApplicationServices(privateConfig) {
	const kerno = await buildAndStartKerno(privateConfig);
	const nodo = await buildAndStartNodo(privateConfig);
	const frontendServices = await startFrontendApplications();
	const services = [['Kerno', kerno], ['Nodo', nodo], ...frontendServices];
	console.log('Ready: http://localhost:8765/login/');
	console.log(
		'Press Ctrl+C to stop local processes, or run pnpm dev:stop to stop them and Docker services.'
	);
	await waitForApplicationExit(services);
}

async function startLocalDevelopment() {
	if (staticFrontend && !(await exists(resolve(root, 'dist/pages/login/index.html')))) {
		throw new Error(
			'Static applications are missing. Run pnpm build:pages before pnpm dev:integration.'
		);
	}
	await assertAvailablePorts(
		staticFrontend
			? localDevelopmentPorts.filter(({ port }) => port < 10_000)
			: localDevelopmentPorts
	);
	closeSession = await startLocalSession(stop);
	const privateConfig = await ensureConfiguration();
	await ensureDockerAvailable();

	const localEnv = { ...process.env, ...privateConfig, KAORDO_SITE_ORIGIN: siteOrigin };
	console.log('Starting PostgreSQL, Keycloak and LiveKit…');
	await run('docker', [...compose, 'up', '-d', '--wait'], localEnv);
	await resetPreGooseSchema(localEnv);
	await waitFor('http://127.0.0.1:8080/realms/kaordo/.well-known/openid-configuration', 180_000);
	await syncKeycloak(privateConfig);
	await startApplicationServices(privateConfig);
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

async function main() {
	try {
		await startLocalDevelopment();
		stop();
	} catch (error) {
		const wasStopping = stopping;
		stop();
		if (!wasStopping) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		}
	} finally {
		stop();
		await waitForChildren();
		await closeSession?.();
	}
}

await main();
