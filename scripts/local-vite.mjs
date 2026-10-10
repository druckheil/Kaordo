// Defines local Vite topology and Svelte-aware dependency discovery

import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';

export const localFrontendServers = [
	{ id: 'portal', name: 'Portal', port: 8765, base: '', readyPath: '/login/' },
	{ id: 'fluo', name: 'Fluo', port: 18766, base: '/fluo', readyPath: '/fluo/' },
	{ id: 'ligo', name: 'Ligo', port: 18767, base: '/ligo', readyPath: '/ligo/' },
	{ id: 'rondo', name: 'Rondo', port: 18768, base: '/rondo', readyPath: '/rondo/' },
	{ id: 'regado', name: 'Regado', port: 18769, base: '/regado', readyPath: '/regado/' },
	{ id: 'lingvo', name: 'Lingvo', port: 18770, base: '/lingvo', readyPath: '/lingvo/' },
	{ id: 'memoro', name: 'Memoro', port: 18771, base: '/memoro', readyPath: '/memoro/' }
];

export const localDevelopmentPorts = [
	{ name: 'Kerno', port: 8081 },
	{ name: 'Nodo', port: 8082 },
	...localFrontendServers.map(({ name, port }) => ({ name: `${name} Vite`, port }))
];

/**
 * @param {string} appId
 * @returns {undefined | {
 *   host: string;
 *   port: number;
 *   strictPort: boolean;
 *   proxy?: Record<string, { target: string; ws: boolean }>;
 *   ws?: { path: string; clientPort: number };
 * }}
 */
export function localViteServer(appId) {
	const environment =
		/** @type {{ process?: { env?: Record<string, string | undefined> } }} */ (globalThis).process
			?.env ?? {};
	if (environment.KAORDO_LOCAL_DEV !== '1') return undefined;

	const app = localFrontendServers.find(({ id }) => id === appId);
	if (!app) throw new Error(`Unknown local Vite app: ${appId}`);

	const common = {
		host: '127.0.0.1',
		port: app.port,
		strictPort: true
	};

	if (app.id === 'portal') {
		return {
			...common,
			proxy: Object.fromEntries(
				localFrontendServers
					.filter(({ id }) => id !== 'portal')
					.map(({ base, port }) => [base, { target: `http://127.0.0.1:${port}`, ws: true }])
			)
		};
	}

	return {
		...common,
		ws: {
			path: '/__vite_hmr',
			clientPort: localFrontendServers[0].port
		}
	};
}

/** @type {import('vite').DepOptimizationOptions} */
export const localViteDependencies = {
	// The complete component graph is known to the scan; publish its bundles as soon as ready
	holdUntilCrawlEnd: false,
	rolldownOptions: {
		plugins: [
			{
				name: 'kaordo:svelte-dependency-scan',
				load: {
					filter: { id: /\.svelte$/ },
					handler(filename) {
						// Vite normally scans only script blocks, losing template imports and
						// functions called by actions. Compile linked source components for the scan;
						// node_modules components remain owned by the Svelte optimizer plugin
						if (filename.split(/[/\\]/).includes('node_modules')) return;
						return {
							code: compile(readFileSync(filename, 'utf8'), {
								filename,
								generate: 'client',
								css: 'external',
								runes: true
							}).js.code,
							moduleType: 'js'
						};
					}
				}
			}
		]
	}
};
