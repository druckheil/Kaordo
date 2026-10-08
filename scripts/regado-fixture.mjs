// Owns isolated Regado API state, pending requests and browser scenario teardown
import { test as base, expect } from "./ui-fixture.mjs";
import { fluoAccountFixtureResponse } from "./fluo-account-fixture.mjs";

const actor = {
	id: "01999111-2222-7333-8444-555555555551",
	username: "operator",
	displayName: "Operator",
	createdAt: "2026-10-03T10:00:00Z",
	isAdmin: true,
};
const services = [
	"kerno",
	"nodo",
	"keycloak",
	"postgresql",
	"caddy",
	"livekit",
	"ddclient",
	"prometheus",
	"prometheus-node-exporter",
	"regado-agent",
];

export const test = base.extend({
	regado: async ({ startAppFixture }, use) => {
		const target = {
			...actor,
			id: "01999111-2222-7333-8444-555555555552",
			username: "member",
			displayName: "Member",
			isAdmin: false,
			disabledAt: null,
			postCount: 2,
			messageCount: 3,
			mediaBytes: 1024,
			lastActivity: actor.createdAt,
		};
		const { page, origin, errors } = await startAppFixture("regado");
		const mutations = [];
		const systemActions = [];
		const layoutActions = [];
		const journalChanges = [];
		let retentionDays = 14;
		let layoutState = "idle";
		let layoutReads = 0;
		let failFirstRoleChange = true;
		let releaseStaleLogs;
		const staleLogGate = new Promise((resolve) => (releaseStaleLogs = resolve));
		let staleLogsStarted;
		const staleLogStarted = new Promise(
			(resolve) => (staleLogsStarted = resolve),
		);
		const now = new Date().toISOString();
		let copyState = "complete";
		let runningReads = 0;
		const health = {
			state: "passed",
			passed: true,
			temperatureC: 35,
			powerOnHours: 5000,
			reallocatedSectors: 0,
			pendingSectors: 0,
			uncorrectableSectors: 0,
			checkedAt: now,
		};
		await page.route("**/v1/**", async (route) => {
			const request = route.request();
			const url = new URL(request.url());
			let body = fluoAccountFixtureResponse(request, [actor, target], { viewerId: actor.id });
			if (body) { await route.fulfill({ json: body }); return; }
			if (url.pathname === "/v1/session" || url.pathname === "/v1/me")
				body = actor;
			else if (url.pathname.endsWith("/summary"))
				body = {
					users: 2,
					posts: 2,
					messages: 3,
					uploads: 1,
					mediaBytes: 1024,
					databaseBytes: 10485760,
					mediaByKind: [{ kind: "image", objects: 1, bytes: 1024 }],
				};
			else if (url.pathname.endsWith("/system")) {
				if (copyState !== "complete" && ++runningReads > 1)
					copyState = "complete";
				body = {
					hostname: "fixture-server",
					time: now,
					host: {
						cpuModel: "Fixture CPU",
						logicalCores: 2,
						memoryTotalBytes: 2147483648,
						uptimeSeconds: 3600,
						kernel: "6.18",
						osName: "NixOS",
						osVersion: "26.05",
						bootMode: "bios",
					},
					disks: ["sda", "sdb", "sdc"].map((name, index) => ({
						name,
						path: `/dev/${name}`,
						label: null,
						partitionLabel: null,
						fsType: null,
						size: 1000204886016,
						type: "disk",
						model: "Fixture disk",
						serial: `fixture-${name}`,
						wwn: null,
						mountpoints: [],
						layoutAvailable: index < 2,
						transport: "sata",
						address: `${index}:0:0:0`,
						unallocated:
							index === 1 ? [{ start: 3145728, size: 68719476736 }] : [],
						systemDisk: index === 0,
						storageState: index < 2 ? "working" : "unconfigured",
						configureEligible: index === 2,
						configureReason:
							index === 2
								? "Ready to join a storage pool"
								: "Already belongs to a mounted Btrfs pool",
						health,
						children:
							index === 0
								? [
										{
											name: "sda2",
											path: "/dev/sda2",
											label: null,
											partitionLabel: null,
											fsType: "ext4",
											size: 68719476736,
											type: "part",
											model: null,
											serial: null,
											wwn: null,
											mountpoints: ["/"],
											systemDisk: false,
											storageState: "working",
											configureEligible: false,
											configureReason: "System volume",
										},
										{
											name: "sda3",
											path: "/dev/sda3",
											label: null,
											partitionLabel: null,
											fsType: "btrfs",
											size: 931481518080,
											type: "part",
											model: null,
											serial: null,
											wwn: null,
											mountpoints: ["/srv/kaordo"],
											systemDisk: false,
											storageState: "working",
											configureEligible: false,
											configureReason: "In pool",
										},
									]
								: index === 1
									? [
											{
												name: "sdb3",
												path: "/dev/sdb3",
												label: null,
												partitionLabel: null,
												fsType: "btrfs",
												size: 931481518080,
												type: "part",
												model: null,
												serial: null,
												wwn: null,
												mountpoints: [],
												systemDisk: false,
												storageState: "working",
												configureEligible: false,
												configureReason: "In pool",
											},
										]
									: [],
					})),
					mounts: [
						{
							path: "/",
							source: "/dev/sda2",
							fsType: "ext4",
							total: 68719476736,
							used: 4000000000,
							free: 64719476736,
							available: true,
							integrity: null,
						},
						{
							path: "/srv/kaordo",
							source: "/dev/sda3",
							fsType: "btrfs",
							total: 931481518080,
							used: 100000000,
							free: 931381518080,
							available: true,
							integrity: {
								uuid: "btrfs-fixture-uuid",
								members: ["/dev/sda3", "/dev/sdb3"],
								dataProfile: "RAID1",
								metadataProfile: "RAID1",
								systemProfile: "RAID1",
								mirroredPercent: 100,
								deviceErrors: 0,
								devicesOnline: 2,
								devicesExpected: 2,
								healthy: true,
								balanceRunning: false,
								scrubState: "complete",
								scrubErrors: 0,
								physicalTotal: 1862963036160,
								physicalUsed: 200000000,
							},
						},
					],
					layoutReports:
						layoutState === "idle"
							? []
							: [
									{
										device: "/dev/sdc",
										state: ++layoutReads > 2 ? "complete" : layoutState,
										stage: "Volumes available",
										startedAt: now,
										error: "",
										progress: { completed: 1, total: 2, unit: "steps" },
									},
								],
					replicationReports: [
						{
							progress: { completed: 50, total: 100, unit: "bytes" },
							path: "/srv/kaordo",
							state: copyState,
							stage: copyState === "complete" ? "complete" : "checksums",
							startedAt: now,
							checkedAt: now,
							files: 100,
							bytes: 10000000,
							unreadable: 0,
							duplication: "duplicated",
							checksumState: "passed",
							error: "",
						},
					],
					mediaMaintenance: {
						directory: "/srv/kaordo/media",
						state: copyState,
						startedAt: now,
						checkedAt: now,
						files: 10,
						bytes: 1024,
						surplusFiles: 1,
						surplusBytes: 100,
						unverifiedFiles: 1,
						missingFiles: 0,
						removedFiles: 0,
						removedBytes: 0,
						error: "",
					},
					swapDevices: [
						{
							name: "zram0",
							path: "/dev/zram0",
							kind: "compressed RAM",
							size: 4294967296,
							used: 1048576,
							priority: 100,
						},
					],
					services: services.map((id) => ({
						id,
						active:
							id === "ddclient"
								? "inactive"
								: id === "prometheus"
									? "failed"
									: "active",
						substate:
							id === "ddclient"
								? "dead"
								: id === "prometheus"
									? "failed"
									: "running",
						loaded: "loaded",
						type: id === "ddclient" ? "oneshot" : "simple",
						result: id === "prometheus" ? "exit-code" : "success",
						exitCode: id === "prometheus" ? 1 : 0,
						finishedAt: now,
						...(id === "ddclient"
							? {
									timer: {
										id: "ddclient.timer",
										active: "active",
										substate: "waiting",
										lastRunAt: now,
										nextRunAt: new Date(Date.now() + 60000).toISOString(),
									},
								}
							: {}),
					})),
				};
			} else if (url.pathname.endsWith("/metrics")) {
				const values = Array.from({ length: 20 }, (_, i) => ({
					time: Math.floor(Date.now() / 1000) - (20 - i) * 15,
					value: 20 + i,
				}));
				body = {
					window: url.searchParams.get("window"),
					series: Object.fromEntries(
						[
							"cpuPercent",
							"memoryPercent",
							"load1",
							"diskReadBytesPerSecond",
							"diskWriteBytesPerSecond",
							"networkBytesPerSecond",
							"storagePercent",
						].map((key) => [key, values]),
					),
				};
			} else if (url.pathname.endsWith("/users")) body = { items: [target] };
			else if (url.pathname.endsWith("/logs")) {
				if (url.searchParams.get("service") === "nodo") {
					staleLogsStarted();
					await staleLogGate;
					try {
						await route.fulfill({
							status: 500,
							contentType: "application/json",
							body: JSON.stringify({ error: "Stale log failure" }),
						});
					} catch {
						/* The obsolete request was cancelled. */
					}
					return;
				}
				body = {
					service: url.searchParams.get("service"),
					journal: {
						totalBytes: 33554432,
						diskBytes: 33554432,
						runtimeBytes: 0,
						maxUseBytes: 268435456,
						retentionDays,
						managed: true,
					},
					items: [
						{
							time: String(Date.now() * 1000),
							priority: "6",
							message: "Fixture service is running",
						},
					],
				};
			} else if (url.pathname.endsWith("/audit"))
				body = {
					items: [
						{
							id: actor.id,
							actor: actor.username,
							target: null,
							action: "system.scrub-filesystem",
							reason: "Scheduled filesystem verification",
							detail: {},
							createdAt: now,
						},
					],
				};
			else if (url.pathname.endsWith("/storage/plan")) {
				const change = request.postDataJSON();
				body = {
					...change,
					fingerprint: "a".repeat(64),
					supported: true,
					backend: "disko",
					declaration: "{ disko.devices = {}; }",
					issues: [],
					warnings: [],
					availableBytes: 1000204886016 - 4 * 2 ** 20,
					steps: [
						...(change.systemBytes
							? [
									{
										kind: "create",
										role: "system",
										number: 0,
										start: 0,
										size: change.systemBytes,
										previousSize: 0,
										source: "",
									},
								]
							: []),
						...(change.storageBytes
							? [
									{
										kind: "create",
										role: "storage",
										number: 0,
										start: 0,
										size: change.storageBytes,
										previousSize: 0,
										source: "",
									},
								]
							: []),
					],
				};
			} else if (url.pathname.endsWith("/storage/apply")) {
				layoutActions.push(request.postDataJSON());
				layoutState = "running";
				layoutReads = 0;
				body = {
					action: "apply-layout",
					target: "/dev/sdc",
					output: "Device layout queued.",
					accepted: true,
				};
			} else if (
				url.pathname.endsWith("/logs/retention") &&
				request.method() === "PATCH"
			) {
				const change = request.postDataJSON();
				journalChanges.push(change);
				retentionDays = change.retentionDays;
				body = {
					totalBytes: 16777216,
					diskBytes: 16777216,
					runtimeBytes: 0,
					maxUseBytes: 268435456,
					retentionDays,
					managed: true,
				};
			} else if (url.pathname.endsWith("/actions/restart-ddclient")) {
				systemActions.push({
					path: url.pathname,
					change: request.postDataJSON(),
				});
				body = {
					action: "restart-ddclient",
					output: "DNS check completed. Automatic updates remain scheduled.",
					accepted: true,
				};
			} else if (request.method() === "PATCH") {
				const change = request.postDataJSON();
				if (url.pathname.endsWith("/role") && failFirstRoleChange) {
					failFirstRoleChange = false;
					await route.fulfill({
						status: 500,
						contentType: "application/json",
						body: JSON.stringify({ error: "Fixture role update failed." }),
					});
					return;
				}
				mutations.push({ path: url.pathname, change });
				if (url.pathname.endsWith("/role")) target.isAdmin = change.isAdmin;
				if (url.pathname.endsWith("/status"))
					target.disabledAt = change.disabled ? now : null;
				body = target;
			} else if (/\/actions\/(check|repair)-storage$/.test(url.pathname)) {
				systemActions.push({
					path: url.pathname,
					change: request.postDataJSON(),
				});
				copyState = url.pathname.endsWith("/check-storage")
					? "checking"
					: "repairing";
				runningReads = 0;
				body = {
					action: copyState,
					target: "/srv/kaordo",
					output: "Storage operation started.",
					accepted: true,
				};
			} else throw new Error(`Unmocked Regado request: ${url.pathname}`);
			await route.fulfill({
				contentType: "application/json",
				body: JSON.stringify(body),
			});
		});
		await page.goto(origin + "/regado/");
		await expect(
			page.getByRole("heading", { name: "System overview", exact: true }),
		).toBeVisible();
		try {
			await use({
				page,
				mutations,
				systemActions,
				layoutActions,
				journalChanges,
				staleLogStarted,
				releaseStaleLogs,
			});
			expect(errors, "No client runtime errors").toEqual([]);
		} finally {
			releaseStaleLogs();
		}
	},
});


export { expect };
