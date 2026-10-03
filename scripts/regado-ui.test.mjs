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
			targets: item.nodes.map((node) => node.target),
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
		let failFirstRoleChange = true;
		let closed = false;
		let releaseStaleLogs;
		const staleLogGate = new Promise((resolve) => (releaseStaleLogs = resolve));
		let staleLogsStarted;
		const staleLogStarted = new Promise((resolve) => (staleLogsStarted = resolve));
		const contentReads = [];
		const now = new Date().toISOString();
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
			else if (url.pathname.endsWith("/system"))
				body = {
					hostname: "fixture-server",
					time: now,
					host: {
						cpuModel: "Fixture CPU",
						logicalCores: 2,
						memoryTotalBytes: 2147483648,
						uptimeSeconds: 3600,
						kernel: "6.18",
					},
					disks: ["sda", "sdb"].map((name) => ({
						name,
						path: `/dev/${name}`,
						label: null,
						fsType: null,
						size: 1000204886016,
						type: "disk",
						model: "Fixture disk",
						mountpoints: [],
						health,
						children: [],
					})),
					mounts: [
						{
							path: "/",
							total: 68719476736,
							used: 4000000000,
							free: 64719476736,
						},
						{
							path: "/srv/kaordo",
							total: 931481518080,
							used: 100000000,
							free: 931381518080,
						},
					],
					mirror: {
						dataProfile: "RAID1",
						metadataProfile: "RAID1",
						systemProfile: "RAID1",
						mirroredPercent: 100,
						deviceErrors: 0,
						devicesOnline: 2,
						healthy: true,
						scrub: "No errors found",
					},
					services: services.map((id) => ({
						id,
						active: "active",
						substate: "running",
						loaded: "loaded",
					})),
				};
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
							action: "system.scrub-data",
							reason: "Scheduled filesystem verification",
							detail: {},
							createdAt: now,
						},
					],
				};
			else if (request.method() === "PATCH") {
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
		await accessibility(page, "Overview");
		for (const section of ["Storage", "Logs", "Users", "Audit", "System"]) {
			await page.getByRole("button", { name: section, exact: true }).click();
			await page.waitForTimeout(100);
			await accessibility(page, section);
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
		}
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
