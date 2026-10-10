// Proves cold Vite scans prepare lazy Svelte dependencies without bundling workspace state

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const media = [
	'@uppy/core',
	'@uppy/tus',
	'pica',
	'tus-js-client',
	'cropperjs',
	'photoswipe/lightbox',
	'vidstack/player'
];
const editor = [
	'@tiptap/core',
	'@tiptap/starter-kit',
	'@tiptap/extension-placeholder',
	'@tiptap/extension-file-handler'
];
const scan = `
import { createServer } from 'vite';
const results = [];
for (const phase of ['cold', 'warm']) {
	const started = performance.now();
	let server;
	try {
		server = await createServer({
			cacheDir: process.argv[1],
			envFile: false,
			logLevel: 'error',
			server: { host: '127.0.0.1', port: 0 }
		});
		await server.listen();
		const optimizer = server.environments.client.depsOptimizer;
		const cached = Object.keys(optimizer.metadata.optimized).length;
		await optimizer.scanProcessing;
		await Promise.all(Object.values(optimizer.metadata.discovered).map(({ processing }) => processing));
		results.push({ phase, cached, milliseconds: Math.round(performance.now() - started), dependencies: Object.keys(optimizer.metadata.optimized).sort() });
	} finally {
		await server?.close();
	}
}
console.log(JSON.stringify(results));
`;

for (const [app, required] of Object.entries({
	portal: ['keycloak-js', 'libsodium-wrappers'],
	fluo: [...media, ...editor],
	ligo: media,
	rondo: [...media, 'livekit-client'],
	regado: ['uplot'],
	lingvo: ['papaparse', 'ts-fsrs'],
	memoro: [...media, ...editor]
})) {
	test(`${app} prepares its lazy libraries on a cold start and reuses them on restart`, async (context) => {
		const cache = await mkdtemp(join(tmpdir(), `kaordo-vite-${app}-`));
		try {
			// SvelteKit loads configuration from cwd; each app owns an isolated process and cache
			const { stdout, stderr } = await exec(
				process.execPath,
				['--input-type=module', '--eval', scan, cache],
				{
					cwd: resolve(root, 'apps', app),
					env: { ...process.env, KAORDO_LOCAL_DEV: '0' },
					timeout: 45_000
				}
			);
			assert.doesNotMatch(stderr, /Failed to (?:run dependency scan|resolve dependency)|Error:/);
			const [cold, warm] = JSON.parse(stdout);
			assert.equal(cold.cached, 0, 'The initial scan starts with an empty dependency cache');
			assert.ok(warm.cached > 0, 'Restart loads prepared dependencies from its own cache');
			assert.deepEqual(warm.dependencies, cold.dependencies, 'Restart retains the complete graph');
			for (const { phase, dependencies } of [cold, warm]) {
				for (const dependency of required) {
					assert.ok(dependencies.includes(dependency), `${app} ${phase} prepares ${dependency}`);
				}
				assert.deepEqual(
					dependencies.filter((dependency) => dependency.startsWith('@kaordo/')),
					[],
					'Linked workspace modules must retain one instance of in-memory auth and feature state'
				);
			}
			context.diagnostic(
				`${app} optimizer: cold ${cold.milliseconds} ms; cached restart ${warm.milliseconds} ms`
			);
		} finally {
			await rm(cache, { recursive: true, force: true });
		}
	});
}
