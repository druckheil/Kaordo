// Owns isolated Regado API state, pending requests and browser scenario teardown
import { test as base, expect } from './ui-fixture.mjs';
import { fluoAccountFixtureResponse } from './fluo-account-fixture.mjs';
import { createHostFixture } from './regado-host-fixture.mjs';

const actor = {
	id: '01999111-2222-7333-8444-555555555551',
	username: 'operator',
	displayName: 'Operator',
	createdAt: '2026-10-03T10:00:00Z',
	isAdmin: true
};
const services = [
	'kerno',
	'nodo',
	'keycloak',
	'postgresql',
	'caddy',
	'livekit',
	'ddclient',
	'prometheus',
	'prometheus-node-exporter',
	'regado-agent'
];

export const test = base.extend({
	regado: async ({ startAppFixture }, use) => {
		const target = {
			...actor,
			id: '01999111-2222-7333-8444-555555555552',
			username: 'member',
			displayName: 'Member',
			isAdmin: false,
			disabledAt: null,
			postCount: 2,
			messageCount: 3,
			mediaBytes: 1024,
			lastActivity: actor.createdAt
		};
		const { page, origin, errors } = await startAppFixture('regado');
		const mutations = [];
		const systemActions = [];
		const journalChanges = [];
		let retentionDays = 14;
		let failFirstRoleChange = true;
		let releaseStaleLogs;
		const staleLogGate = new Promise((resolve) => (releaseStaleLogs = resolve));
		let staleLogsStarted;
		const staleLogStarted = new Promise((resolve) => (staleLogsStarted = resolve));
		const now = new Date().toISOString();
		const host = createHostFixture(now);
		let mediaState = 'complete';
		let mediaReads = 0;
		await page.route('**/v1/**', async (route) => {
			const request = route.request();
			const url = new URL(request.url());
			let body = fluoAccountFixtureResponse(request, [actor, target], { viewerId: actor.id });
			body ??= host.handle(request, url);
			if (body) {
				await route.fulfill({ json: body });
				return;
			}
			if (url.pathname === '/v1/session' || url.pathname === '/v1/me') body = actor;
			else if (url.pathname.endsWith('/summary'))
				body = {
					users: 2,
					posts: 2,
					messages: 3,
					uploads: 1,
					mediaBytes: 1024,
					databaseBytes: 10485760,
					mediaByKind: [{ kind: 'image', objects: 1, bytes: 1024 }]
				};
			else if (url.pathname.endsWith('/system')) {
				if (mediaState !== 'complete' && ++mediaReads > 1) mediaState = 'complete';
				body = {
					hostname: 'fixture-server',
					time: now,
					host: {
						cpuModel: 'Fixture CPU',
						logicalCores: 2,
						memoryTotalBytes: 2147483648,
						uptimeSeconds: 3600,
						kernel: '6.18',
						osName: 'NixOS',
						osVersion: '26.05',
						bootMode: 'bios'
					},
					mediaMaintenance: {
						directory: '/srv/kaordo/media',
						state: mediaState,
						stage: mediaState === 'complete' ? 'complete' : 'references',
						progress: { completed: 5, total: 10, unit: 'uploads' },
						startedAt: now,
						checkedAt: mediaState === 'complete' ? now : null,
						files: 10,
						bytes: 1048576,
						surplusFiles: 1,
						surplusBytes: 4096,
						unverifiedFiles: 0,
						missingFiles: 0,
						removedFiles: 0,
						removedBytes: 0,
						error: ''
					},
					swapDevices: [
						{
							name: 'zram0',
							path: '/dev/zram0',
							kind: 'compressed RAM',
							size: 4294967296,
							used: 1048576,
							priority: 100
						}
					],
					services: services.map((id) => ({
						id,
						active: id === 'ddclient' ? 'inactive' : id === 'prometheus' ? 'failed' : 'active',
						substate: id === 'ddclient' ? 'dead' : id === 'prometheus' ? 'failed' : 'running',
						loaded: 'loaded',
						type: id === 'ddclient' ? 'oneshot' : 'simple',
						result: id === 'prometheus' ? 'exit-code' : 'success',
						exitCode: id === 'prometheus' ? 1 : 0,
						finishedAt: now,
						...(id === 'ddclient'
							? {
									timer: {
										id: 'ddclient.timer',
										active: 'active',
										substate: 'waiting',
										lastRunAt: now,
										nextRunAt: new Date(Date.now() + 60000).toISOString()
									}
								}
							: {})
					}))
				};
			} else if (url.pathname.endsWith('/metrics')) {
				const values = Array.from({ length: 20 }, (_, i) => ({
					time: Math.floor(Date.now() / 1000) - (20 - i) * 15,
					value: 20 + i
				}));
				body = {
					window: url.searchParams.get('window'),
					series: Object.fromEntries(
						[
							'cpuPercent',
							'memoryPercent',
							'load1',
							'diskReadBytesPerSecond',
							'diskWriteBytesPerSecond',
							'networkBytesPerSecond',
							'storagePercent'
						].map((key) => [key, values])
					)
				};
			} else if (url.pathname.endsWith('/users')) body = { items: [target] };
			else if (url.pathname.endsWith('/logs')) {
				if (url.searchParams.get('service') === 'nodo') {
					staleLogsStarted();
					await staleLogGate;
					try {
						await route.fulfill({
							status: 500,
							contentType: 'application/json',
							body: JSON.stringify({ error: 'Stale log failure' })
						});
					} catch {
						/* The obsolete request was cancelled. */
					}
					return;
				}
				body = {
					service: url.searchParams.get('service'),
					journal: {
						totalBytes: 33554432,
						diskBytes: 33554432,
						runtimeBytes: 0,
						maxUseBytes: 268435456,
						retentionDays,
						managed: true
					},
					items: [
						{
							time: String(Date.now() * 1000),
							priority: '6',
							message: 'Fixture service is running'
						}
					]
				};
			} else if (url.pathname.endsWith('/audit'))
				body = {
					items: [
						{
							id: actor.id,
							actor: actor.username,
							target: null,
							action: 'host.state.changed',
							reason: 'Add the third disk to the pool',
							detail: {},
							createdAt: now
						}
					]
				};
			else if (url.pathname.endsWith('/logs/retention') && request.method() === 'PATCH') {
				const change = request.postDataJSON();
				journalChanges.push(change);
				retentionDays = change.retentionDays;
				body = {
					totalBytes: 16777216,
					diskBytes: 16777216,
					runtimeBytes: 0,
					maxUseBytes: 268435456,
					retentionDays,
					managed: true
				};
			} else if (url.pathname.endsWith('/actions/restart-ddclient')) {
				systemActions.push({
					path: url.pathname,
					change: request.postDataJSON()
				});
				body = {
					action: 'restart-ddclient',
					output: 'DNS check completed. Automatic updates remain scheduled.',
					accepted: true
				};
			} else if (request.method() === 'PATCH') {
				const change = request.postDataJSON();
				if (url.pathname.endsWith('/role') && failFirstRoleChange) {
					failFirstRoleChange = false;
					await route.fulfill({
						status: 500,
						contentType: 'application/json',
						body: JSON.stringify({ error: 'Fixture role update failed.' })
					});
					return;
				}
				mutations.push({ path: url.pathname, change });
				if (url.pathname.endsWith('/role')) target.isAdmin = change.isAdmin;
				if (url.pathname.endsWith('/status')) target.disabledAt = change.disabled ? now : null;
				body = target;
			} else if (/\/actions\/(check|clean)-media$/.test(url.pathname)) {
				systemActions.push({ path: url.pathname, change: request.postDataJSON() });
				mediaState = url.pathname.endsWith('/check-media') ? 'checking' : 'repairing';
				mediaReads = 0;
				body = { action: url.pathname.split('/').at(-1), output: '', accepted: true };
			} else throw new Error(`Unmocked Regado request: ${url.pathname}`);
			await route.fulfill({
				contentType: 'application/json',
				body: JSON.stringify(body)
			});
		});
		await page.goto(origin + '/regado/');
		await expect(page.getByRole('heading', { name: 'System overview', exact: true })).toBeVisible();
		try {
			await use({
				page,
				mutations,
				systemActions,
				journalChanges,
				host,
				staleLogStarted,
				releaseStaleLogs
			});
			expect(errors, 'No client runtime errors').toEqual([]);
		} finally {
			releaseStaleLogs();
		}
	}
});

export { expect };
