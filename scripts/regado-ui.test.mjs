// Exercises Regado navigation, accessible storage evidence, and guarded administrator actions
import assert from "node:assert/strict";
import test from "node:test";
import AxeBuilder from "@axe-core/playwright";
import { startAppFixture } from "./ui-fixture.mjs";

const actor = {
	id: "01999111-2222-7333-8444-555555555551",
	username: "operator",
	displayName: "Operator",
	createdAt: "2026-10-03T10:00:00Z",
	isAdmin: true,
};
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

async function accessibility(page, section) {
	const { violations } = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.analyze();
	assert.deepEqual(
		violations.map((item) => ({
			id: item.id,
			targets: item.nodes.map(({ target, html, failureSummary }) => ({ target, html, failureSummary })),
		})),
		[],
		`${section}: automated accessibility`,
	);
}

test(
	"Regado renders all sections, admin controls and responsive charts",
	{ timeout: 90000 },
	async (t) => {
		const { page, origin, errors } = await startAppFixture(t, "regado");
		const mutations = [];
		const systemActions = [];
		const layoutActions = [];
		const journalChanges = [];
		let retentionDays = 14;
		let layoutState = "idle";
		let layoutReads = 0;
		let failFirstRoleChange = true;
		let closed = false;
		let releaseStaleLogs;
		const staleLogGate = new Promise((resolve) => (releaseStaleLogs = resolve));
		let staleLogsStarted;
		const staleLogStarted = new Promise((resolve) => (staleLogsStarted = resolve));
		const contentReads = [];
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
			let body;
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
					openCases: 0,
					mediaByKind: [{ kind: "image", objects: 1, bytes: 1024 }],
				};
			else if (url.pathname.endsWith("/system")) {
				if (copyState !== "complete" && ++runningReads > 1) copyState = "complete";
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
							unallocated: index === 1 ? [{ start: 3145728, size: 68719476736 }] : [],
							systemDisk: index === 0,
							storageState: index < 2 ? "working" : "unconfigured",
							configureEligible: index === 2,
							configureReason: index === 2 ? "Ready to join a storage pool" : "Already belongs to a mounted Btrfs pool",
							health,
							children: index === 0
								? [
										{ name: "sda2", path: "/dev/sda2", label: null, partitionLabel: null, fsType: "ext4", size: 68719476736, type: "part", model: null, serial: null, wwn: null, mountpoints: ["/"], systemDisk: false, storageState: "working", configureEligible: false, configureReason: "System volume" },
										{ name: "sda3", path: "/dev/sda3", label: null, partitionLabel: null, fsType: "btrfs", size: 931481518080, type: "part", model: null, serial: null, wwn: null, mountpoints: ["/srv/kaordo"], systemDisk: false, storageState: "working", configureEligible: false, configureReason: "In pool" },
									]
									: index === 1
										? [{ name: "sdb3", path: "/dev/sdb3", label: null, partitionLabel: null, fsType: "btrfs", size: 931481518080, type: "part", model: null, serial: null, wwn: null, mountpoints: [], systemDisk: false, storageState: "working", configureEligible: false, configureReason: "In pool" }]
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
					layoutReports: layoutState === "idle" ? [] : [{ device: "/dev/sdc", state: ++layoutReads > 2 ? "complete" : layoutState, stage: "Volumes available", startedAt: now, error: "", progress: { completed: 1, total: 2, unit: "steps" } }],
					replicationReports: [{ progress: { completed: 50, total: 100, unit: "bytes" }, path: "/srv/kaordo", state: copyState, stage: copyState === "complete" ? "complete" : "checksums", startedAt: now, checkedAt: now, files: 100, bytes: 10000000, unreadable: 0, duplication: "duplicated", checksumState: "passed", error: "" }],
					mediaMaintenance: { directory: "/srv/kaordo/media", state: copyState, startedAt: now, checkedAt: now, files: 10, bytes: 1024, surplusFiles: 1, surplusBytes: 100, unverifiedFiles: 1, missingFiles: 0, removedFiles: 0, removedBytes: 0, error: "" },
					swapDevices: [{ name: "zram0", path: "/dev/zram0", kind: "compressed RAM", size: 4294967296, used: 1048576, priority: 100 }],
					services: services.map((id) => ({
						id,
						active: id === "ddclient" ? "inactive" : id === "prometheus" ? "failed" : "active",
						substate: id === "ddclient" ? "dead" : id === "prometheus" ? "failed" : "running",
						loaded: "loaded",
						type: id === "ddclient" ? "oneshot" : "simple",
						result: id === "prometheus" ? "exit-code" : "success",
						exitCode: id === "prometheus" ? 1 : 0,
						finishedAt: now,
						...(id === "ddclient" ? { timer: { id: "ddclient.timer", active: "active", substate: "waiting", lastRunAt: now, nextRunAt: new Date(Date.now() + 60000).toISOString() } } : {}),
					})),
				};
			}
			else if (url.pathname.endsWith("/metrics")) {
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
						await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Stale log failure" }) });
					} catch { /* The obsolete request was cancelled. */ }
					return;
				}
				body = {
					service: url.searchParams.get("service"),
					journal: { totalBytes: 33554432, diskBytes: 33554432, runtimeBytes: 0, maxUseBytes: 268435456, retentionDays, managed: true },
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
                body = { ...change, fingerprint: "a".repeat(64), supported: true, backend: "disko", declaration: "{ disko.devices = {}; }", issues: [], warnings: [], availableBytes: 1000204886016 - 4 * 2**20, steps: [
                    ...(change.systemBytes ? [{ kind: "create", role: "system", number: 0, start: 0, size: change.systemBytes, previousSize: 0, source: "" }] : []),
                    ...(change.storageBytes ? [{ kind: "create", role: "storage", number: 0, start: 0, size: change.storageBytes, previousSize: 0, source: "" }] : [])
                ] };
            } else if (url.pathname.endsWith("/storage/apply")) {
                layoutActions.push(request.postDataJSON()); layoutState = "running"; layoutReads = 0;
                body = { action: "apply-layout", target: "/dev/sdc", output: "Device layout queued.", accepted: true };
            } else if (url.pathname.endsWith("/logs/retention") && request.method() === "PATCH") {
                const change = request.postDataJSON(); journalChanges.push(change); retentionDays = change.retentionDays;
                body = { totalBytes: 16777216, diskBytes: 16777216, runtimeBytes: 0, maxUseBytes: 268435456, retentionDays, managed: true };
            } else if (url.pathname.endsWith("/actions/restart-ddclient")) {
                systemActions.push({ path: url.pathname, change: request.postDataJSON() });
                body = { action: "restart-ddclient", output: "DNS check completed. Automatic updates remain scheduled.", accepted: true };
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
				systemActions.push({ path: url.pathname, change: request.postDataJSON() });
				copyState = url.pathname.endsWith("/check-storage") ? "checking" : "repairing";
				runningReads = 0;
				body = { action: copyState, target: "/srv/kaordo", output: "Storage operation started.", accepted: true };
			} else if (url.pathname.endsWith("/cases"))
				body = {
					id: "01999111-2222-7333-8444-555555555553",
					targetUserId: target.id,
					targetUsername: target.username,
					reason: request.postDataJSON().reason,
					createdAt: now,
					expiresAt: new Date(Date.now() + 900000).toISOString(),
				};
			else if (url.pathname.endsWith("/content")) {
				contentReads.push(url.searchParams.get("kind"));
				body = {
					items: [
						{
							id: target.id,
							text: "Audited fixture content",
							context: "private",
							createdAt: now,
							media: [],
						},
					],
					nextCursor: null,
				};
			} else if (url.pathname.endsWith("/close")) {
				closed = true;
				await route.fulfill({ status: 204 });
				return;
			} else throw new Error(`Unmocked Regado request: ${url.pathname}`);
			await route.fulfill({
				contentType: "application/json",
				body: JSON.stringify(body),
			});
		});
		await page.goto(origin + "/regado/");
		await page
			.getByRole("heading", { name: "System overview", exact: true })
			.waitFor();
		await page.locator(".uplot canvas").first().waitFor();
		assert.equal(await page.locator(".u-legend:visible").count(), 0, "No empty cursor legend is shown");
		await page.getByRole("button", { name: "About CPU", exact: true }).click();
		await page.getByText(/horizontal axis is local time/).waitFor();
		await page.keyboard.press("Escape");
		await accessibility(page, "Overview");
		const theme = page.getByRole("button", { name: "Dark mode", exact: true });
		await theme.click();
		assert.equal(await theme.getAttribute("aria-pressed"), "true");
		await accessibility(page, "Dark overview");
		await theme.click();
		for (const section of ["Storage", "Logs", "Users", "Audit", "System"]) {
			await page.getByRole("button", { name: section, exact: true }).click();
			await page.waitForTimeout(100);
			await accessibility(page, section);
			await theme.click();
			await accessibility(page, `Dark ${section}`);
			await page.setViewportSize({ width: 320, height: 700 });
			await page.evaluate(
				() =>
					new Promise((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(resolve)),
					),
			);
			assert.ok(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth + 1,
				),
				`${section}: no page horizontal overflow at 320px`,
			);
			await page.setViewportSize({ width: 1440, height: 900 });
			await theme.click();
		}
		await page.getByRole("button", { name: "Logs", exact: true }).click();
		await page.getByText("32.0 MiB", { exact: true }).waitFor();
		await page.getByLabel("Log lifetime", { exact: true }).selectOption("7");
		await page.getByRole("button", { name: "Apply retention", exact: true }).click();
		await page.getByRole("dialog").getByText(/entire host journal/).waitFor();
		await page.getByRole("textbox", { name: "Reason", exact: true }).fill("Limit journal retention to seven days");
		await page.getByRole("button", { name: "Confirm", exact: true }).click();
		await page.getByText("Journal retention updated.", { exact: true }).waitFor();
		assert.deepEqual(journalChanges, [{ retentionDays: 7, reason: "Limit journal retention to seven days" }]);
		assert.equal(await page.getByLabel("Log lifetime", { exact: true }).inputValue(), "7");
		await page.getByRole("button", { name: "System", exact: true }).click();
		await page.getByRole("region", { name: "DNS maintenance", exact: true }).getByText("Scheduled", { exact: true }).waitFor();
		await page.getByRole("region", { name: "Prometheus service", exact: true }).getByText("Failed", { exact: true }).waitFor();
		await page.getByRole("button", { name: "About Keycloak", exact: true }).click();
		await page.getByText(/Handles registration, login, TOTP/).waitFor();
		await page.keyboard.press("Escape");
		await page.getByRole("region", { name: "DNS maintenance", exact: true }).getByRole("button", { name: "Update now", exact: true }).click();
		await page.getByRole("textbox", { name: "Reason", exact: true }).fill("Verify the current public IP and DNS");
		await page.getByRole("button", { name: "Confirm", exact: true }).click();
		await page.getByText("DNS check completed. Automatic updates remain scheduled.", { exact: true }).waitFor();
		assert.equal(systemActions.at(-1).path, "/v1/admin/actions/restart-ddclient");
		await page.getByRole("region", { name: "Storage maintenance", exact: true }).getByRole("button", { name: "Open storage", exact: true }).click();
		await page.getByRole("heading", { name: "NixOS system", exact: true }).waitFor();
		systemActions.length = 0;
		await page.getByRole("button", { name: "Storage", exact: true }).click();
		await page.getByRole("heading", { name: "NixOS system", exact: true }).waitFor();
		await page.getByRole("heading", { name: "Compressed RAM swap", exact: true }).waitFor();
		await page.getByText("zram0 · 1.0 MiB of 4.0 GiB in use", { exact: true }).waitFor();
		await page.getByText("Available to allocate", { exact: true }).locator("..").getByText("64.0 GiB", { exact: true }).waitFor();
		await page.getByText("Physical pool capacity", { exact: true }).waitFor();
		await page.getByText("98.0%", { exact: true }).waitFor();
		await page.getByText("Mirrored · healthy", { exact: true }).waitFor();
		assert.equal(await page.getByRole("heading", { name: "Mounted filesystems", exact: true }).count(), 0);
		assert.equal(await page.getByText("No filesystem errors reported", { exact: true }).count(), 0);
		assert.equal(await page.getByText(/Scrub device \/dev\//).count(), 0);
        const newDisk = page.getByRole("article", { name: "Device /dev/sdc", exact: true });
        await newDisk.getByRole("button", { name: "Manage partitions", exact: true }).click();
        await page.getByLabel("System · GiB", { exact: true }).fill("64");
        await page.getByLabel("Storage · GiB", { exact: true }).fill("867");
        await page.getByRole("button", { name: "Preview layout", exact: true }).click();
        await page.getByText("Layout engine: disko", { exact: true }).waitFor();
        await accessibility(page, "Partition layout dialog");
        await page.setViewportSize({ width: 320, height: 700 });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => { const r=el.getBoundingClientRect(); return r.width && (r.right>window.innerWidth+1 || r.left< -1); }).map((el) => ({tag:el.tagName, classes:el.className, text:el.textContent.slice(0,50)})).slice(0,8));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Partition dialog has no horizontal overflow: ${JSON.stringify(overflow)}`);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.getByLabel("Reason", { exact: true }).fill("Allocate operating-system and file-storage areas");
        await page.getByLabel("Type /dev/sdc to confirm", { exact: true }).fill("/dev/sdc");
        await page.getByRole("button", { name: "Apply layout", exact: true }).click();
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        assert.deepEqual(layoutActions[0], {
            device: "/dev/sdc", identity: "serial:fixture-sdc", filesystem: "/srv/kaordo", systemBytes: 64 * 2**30, storageBytes: 867 * 2**30,
            fingerprint: "a".repeat(64), confirmation: "/dev/sdc", reason: "Allocate operating-system and file-storage areas"
        });
        await page.getByText("50.0%", { exact: true }).first().waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "Check copies" && !button.disabled));

		await page.getByRole("button", { name: "Check copies", exact: true }).click();
		await page.getByText("Scanning disk checksums…", { exact: true }).waitFor();
		await page.getByRole("button", { name: "Repair and clean up", exact: true }).waitFor({ state: "visible" });
		await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "Repair and clean up" && !button.disabled));
		assert.equal(systemActions[0].change.target, "/srv/kaordo");
		await page.getByRole("button", { name: "Repair and clean up", exact: true }).click();
		await page.getByRole("dialog").getByText(/removes only uploads older than 24 hours/).waitFor();
		await page.getByRole("button", { name: "Confirm", exact: true }).click();
		await page.getByText("Scanning disk checksums…", { exact: true }).waitFor();
		assert.equal(systemActions[1].change.target, "/srv/kaordo");
		await page.getByRole("button", { name: "Logs", exact: true }).click();
		await page.getByLabel("Service", { exact: true }).selectOption("nodo");
		await staleLogStarted;
		await page.getByRole("button", { name: "Users", exact: true }).click();
		releaseStaleLogs();
		await page.getByRole("heading", { name: "Accounts", exact: true }).waitFor();
		await page.waitForTimeout(100);
		assert.equal(await page.getByText("Stale log failure", { exact: true }).count(), 0, "A late log failure cannot affect Users");
		await page
			.getByRole("button", { name: "Grant admin", exact: true })
			.click();
		await page
			.getByRole("textbox", { name: "Reason", exact: true })
			.fill("Assign administrator responsibilities");
		await page.getByRole("button", { name: "Confirm", exact: true }).click();
		await page
			.getByRole("alert")
			.filter({ hasText: "Fixture role update failed." })
			.waitFor();
		assert.ok(
			await page.getByRole("dialog").isVisible(),
			"Action failure stays visible in the active dialog",
		);
		await page.getByRole("button", { name: "Confirm", exact: true }).click();
		await page
			.getByRole("button", { name: "Revoke admin", exact: true })
			.waitFor();
		assert.equal(mutations[0].change.isAdmin, true);
		await page
			.getByRole("button", { name: "Access case", exact: true })
			.click();
		await page
			.getByRole("textbox", { name: "Reason", exact: true })
			.fill("Investigating a documented policy violation");
		await page.getByRole("button", { name: "Confirm", exact: true }).click();
		await page.getByText("Audited fixture content", { exact: true }).waitFor();
		assert.deepEqual(contentReads, ["posts"], "Opening a case fetches one audited page");
		await page
			.getByRole("button", { name: "Close access case", exact: true })
			.click();
		await page.getByText("Access case closed.", { exact: true }).waitFor();
		assert.equal(closed, true);
		await page.evaluate(() => document.documentElement.classList.add("dark"));
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(resolve)),
				),
		);
		await accessibility(page, "Dark users");
		assert.deepEqual(errors, [], "No client runtime errors");
	},
);
