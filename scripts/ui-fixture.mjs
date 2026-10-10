// Reuses worker-owned Vite servers while Playwright isolates each test's browser state

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test as base, expect } from '@playwright/test';
import { createPageServer } from './serve-pages.mjs';
import { createUploadServer } from './ui-upload-fixture.mjs';

const root = resolve(import.meta.dirname, '..');

export async function installSignedOutIdentity(context) {
	// Static UI tests own the guest boundary; the live suite owns the actual identity service
	await context.route('**/protocol/openid-connect/3p-cookies/step1.html', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: "<script>parent.postMessage('supported', '*')</script>"
		})
	);
	await context.route('**/protocol/openid-connect/auth**', (route) => {
		const url = new URL(route.request().url());
		assert.equal(
			url.searchParams.get('prompt'),
			'none',
			'Public UI fixtures only resolve silent guest sessions'
		);
		const callback = new URL(url.searchParams.get('redirect_uri'));
		callback.hash = new URLSearchParams({
			error: 'login_required',
			state: url.searchParams.get('state')
		}).toString();
		// WebKit's route backend cannot fulfill redirects; Chromium needs a real redirect for local-network navigation
		if (context.browser()?.browserType().name() !== 'webkit') {
			return route.fulfill({ status: 302, headers: { location: callback.href } });
		}
		return route.fulfill({
			contentType: 'text/html',
			body: `<script>location.replace(${JSON.stringify(callback.href)})</script>`
		});
	});
}

async function startServer(app) {
	const socket = createServer();
	await new Promise((resolveListen) => socket.listen(0, '127.0.0.1', resolveListen));
	const port = socket.address().port;
	await new Promise((resolveClose) => socket.close(resolveClose));
	const origin = `http://127.0.0.1:${port}`;
	const workspace = await mkdtemp(join(tmpdir(), 'kaordo-ui-vite-'));
	const config = join(workspace, 'vite.config.mjs');
	await writeFile(
		config,
		`// Isolates a fixture server's dependency cache from development and other workers\nimport config from ${JSON.stringify(resolve(root, `apps/${app}/vite.config.ts`))};\nexport default { ...config, cacheDir: ${JSON.stringify(join(workspace, 'cache'))} };\n`
	).catch(async (error) => {
		await rm(workspace, { recursive: true, force: true });
		throw error;
	});
	const server = spawn(
		process.execPath,
		[
			resolve(root, `apps/${app}/node_modules/vite/bin/vite.js`),
			'--config',
			config,
			'--host',
			'127.0.0.1',
			'--port',
			String(port),
			'--strictPort'
		],
		{
			cwd: resolve(root, `apps/${app}`),
			env: {
				...process.env,
				KAORDO_LOCAL_DEV: '0',
				VITE_KAORDO_AUTH_URL: origin,
				VITE_KAORDO_AUTH_REALM: 'fixture',
				VITE_KAORDO_AUTH_CLIENT_ID: 'fixture',
				VITE_KAORDO_API_URL: origin,
				VITE_KAORDO_NODO_URL: origin
			},
			stdio: ['ignore', 'pipe', 'pipe']
		}
	);
	let output = '';
	let startError;
	server.on('error', (error) => {
		startError = error;
	});
	server.stdout.on('data', (chunk) => {
		output = (output + chunk).slice(-64_000);
	});
	server.stderr.on('data', (chunk) => {
		output = (output + chunk).slice(-64_000);
	});
	async function stop() {
		try {
			if (server.exitCode !== null || server.signalCode !== null || startError) return;
			const stopped = once(server, 'close');
			const force = setTimeout(() => server.kill('SIGKILL'), 5_000);
			server.kill('SIGTERM');
			try {
				await stopped;
			} finally {
				clearTimeout(force);
			}
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	}
	try {
		const deadline = Date.now() + 30_000;
		let ready = false;
		while (Date.now() < deadline) {
			if (startError || server.exitCode !== null || server.signalCode !== null) break;
			try {
				ready =
					(
						await fetch(origin + (app === 'portal' ? '/' : `/${app}/`), {
							signal: AbortSignal.timeout(1_000)
						})
					).status === 200;
			} catch {
				/* Vite may still be starting */
			}
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
	staticOrigin: [
		async ({}, use) => {
			assert.ok(existsSync(resolve(root, 'dist/pages/index.html')), 'Run pnpm build:pages first');
			const server = createPageServer();
			await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
			try {
				// Built local apps use localhost for identity; keep callback navigation on that host too
				await use(`http://localhost:${server.address().port}`);
			} finally {
				await new Promise((resolveClose) => server.close(resolveClose));
			}
		},
		{ scope: 'worker' }
	],
	fixtureServers: [
		async ({}, use) => {
			const servers = new Map();
			try {
				await use(async (app, { fresh = false } = {}) => {
					if (fresh && servers.has(app)) {
						await servers.get(app).stop();
						servers.delete(app);
					}
					if (!servers.has(app)) servers.set(app, await startServer(app));
					return servers.get(app);
				});
			} finally {
				await Promise.all([...servers.values()].map((server) => server.stop()));
			}
		},
		{ scope: 'worker' }
	],
	startUploadFixture: async ({ context }, use) => {
		let server;
		try {
			await use(async (origin) => {
				assert.ok(!server, 'Each upload scenario owns one HTTP server');
				server = await createUploadServer(origin);
				return server;
			});
		} finally {
			// Release the browser's speculative connections before draining the HTTP listener
			await context.close();
			await server?.stop();
		}
	},
	startAppFixture: async ({ page, fixtureServers }, use, testInfo) => {
		let server;
		try {
			await use(async (app, options) => {
				assert.ok(!server, 'Each browser test owns one app fixture');
				server = await fixtureServers(app, options);
				const errors = [];
				page.on('pageerror', (error) => errors.push(error.message));
				await page.route('**/*keycloak-js*', (route) =>
					route.fulfill({
						contentType: 'text/javascript',
						body: `export default class { authenticated=true; token='fixture'; tokenParsed={sub:'fixture'}; async init(){return true} async updateToken(){return false} }`
					})
				);
				return { page, origin: server.origin, errors };
			});
		} finally {
			if (server) {
				const output = server.log();
				const dependencyFailure =
					/optimized dependencies changed[^\n]*reloading|Failed to run dependency scan|Failed to resolve dependency/;
				if (testInfo.status !== testInfo.expectedStatus || dependencyFailure.test(output)) {
					await testInfo.attach('Vite server log', { body: output, contentType: 'text/plain' });
				}
				assert.doesNotMatch(
					output,
					dependencyFailure,
					'Fixture dependencies must be discovered before interaction, without a page reload'
				);
			}
		}
	}
});

export { expect };
