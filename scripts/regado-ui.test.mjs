// Exercises Regado navigation, accessible storage evidence, and guarded administrator actions
import {
	assertAccessible as accessibility,
	assertInterfaceGeometry,
	settleInterface,
} from "./ui-accessibility.mjs";
import { test, expect } from "./regado-fixture.mjs";

async function openSection(page, section) {
	const navigation = page.getByRole("button", { name: section, exact: true });
	await navigation.click();
	await expect(navigation).toHaveAttribute("aria-current", "page");
	await expect(page).toHaveURL(new RegExp("view=" + section.toLowerCase()));
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		section === "Overview" ? "System overview" : section,
	);
}

// Background maintenance deliberately polls rather than tying its lifetime to the action request
const maintenanceTimeout = 15_000;

test("Regado overview explains charts and supports both appearances", async ({
	regado: { page },
}) => {
	await page.locator(".uplot canvas").first().waitFor();
	await expect(
		page.locator(".u-legend:visible"),
		"No empty cursor legend is shown",
	).toHaveCount(0);
	await page.getByRole("button", { name: "About CPU", exact: true }).click();
	await expect(page.getByText(/horizontal axis is local time/)).toBeVisible();
	await page.keyboard.press("Escape");
	await accessibility(page, "Overview");
	const theme = page.getByRole("button", { name: "Dark mode", exact: true });
	await theme.click();
	await expect(theme).toHaveAttribute("aria-pressed", "true");
	await accessibility(page, "Dark overview");
});

test("Regado charts follow repeated viewport changes without resize feedback", async ({
	regado: { page },
}) => {
	for (const [section, count] of [
		["Overview", 6],
		["Storage", 1],
	]) {
		await openSection(page, section);
		await expect(page.locator(".uplot")).toHaveCount(count);
		for (const width of [320, 1440, 390, 1024, 1440]) {
			await page.setViewportSize({ width, height: 900 });
			await expect
				.poll(
					() =>
						page.locator(".uplot").evaluateAll((charts) =>
							charts
								.map((chart) => ({
									width: chart.getBoundingClientRect().width,
									host: chart.parentElement.clientWidth,
								}))
								.filter((size) => Math.abs(size.width - size.host) > 1),
						),
					{ message: `${section} charts fit their host at ${width}px` },
				)
				.toEqual([]);
		}
	}
});

for (const section of ["Storage", "Logs", "Users", "Audit", "System"]) {
	test(`Regado ${section} has accessible desktop and mobile layouts`, async ({
		regado: { page },
	}, testInfo) => {
		await openSection(page, section);
		await accessibility(page, section);
		await assertInterfaceGeometry(page, section);
		await page.getByRole("button", { name: "Dark mode", exact: true }).click();
		await accessibility(page, `Dark ${section}`);
		await page.setViewportSize({ width: 320, height: 700 });
		await expect
			.poll(
				() =>
					page.evaluate(
						() => document.documentElement.scrollWidth - window.innerWidth,
					),
				{ message: `${section}: no page horizontal overflow at 320px` },
			)
			.toBeLessThanOrEqual(1);
		await assertInterfaceGeometry(page, `Mobile ${section}`);
		await accessibility(page, `Mobile ${section}`);
		if (process.env.KAORDO_UI_SCREENSHOTS === "1") {
			await page.screenshot({
				path: testInfo.outputPath(`regado-${section.toLowerCase()}-mobile.png`),
				fullPage: true,
			});
		}
	});
}

test("Regado history, reload, enlarged text and text spacing preserve the selected section", async ({
	regado: { page },
}, testInfo) => {
	await openSection(page, "Audit");
	await openSection(page, "System");
	await page.goBack();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Audit");
	await page.goForward();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("System");
	await page.reload();
	await expect(
		page.getByRole("button", { name: "System", exact: true }),
	).toHaveAttribute("aria-current", "page");
	await page
		.getByRole("region", { name: "DNS maintenance", exact: true })
		.waitFor();
	await settleInterface(page);
	if (process.env.KAORDO_UI_SCREENSHOTS === "1") {
		await page.screenshot({
			path: testInfo.outputPath("regado-system-desktop.png"),
			fullPage: true,
		});
	}
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.evaluate(() => {
		document.documentElement.style.fontSize = "200%";
	});
	await assertInterfaceGeometry(page, "Regado enlarged text");
	await accessibility(page, "Regado enlarged text");
	await page.evaluate(() => {
		document.documentElement.style.fontSize = "";
	});
	await page.addStyleTag({
		content:
			"* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important } p { margin-bottom: 2em !important }",
	});
	await page.setViewportSize({ width: 320, height: 700 });
	await assertInterfaceGeometry(page, "Regado text spacing");
	await accessibility(page, "Regado text spacing");
});

test("Regado journal retention has keyboard focus and an audited confirmation", async ({
	regado: { page, journalChanges },
}) => {
	await openSection(page, "Logs");
	await expect(page.getByText("32.0 MiB", { exact: true })).toBeVisible();
	const retention = page.getByRole("combobox", {
		name: "Log lifetime",
		exact: true,
	});
	await retention.focus();
	await page.keyboard.press("Tab");
	await page.keyboard.press("Shift+Tab");
	await expect(retention).toBeFocused();
	await settleInterface(page);
	const focus = await retention.evaluate((element) => {
		const style = getComputedStyle(element);
		const probe = document.createElement("span");
		probe.style.color = "var(--focus-color)";
		document.body.append(probe);
		const color = getComputedStyle(probe).color;
		probe.remove();
		return {
			style: style.outlineStyle,
			width: parseFloat(style.outlineWidth),
			color: style.outlineColor,
			expectedColor: color,
		};
	});
	expect(focus.style).toBe("solid");
	expect(focus.width).toBeGreaterThanOrEqual(2);
	expect(focus.color, JSON.stringify(focus)).toBe(focus.expectedColor);
	await retention.selectOption("7");
	await page
		.getByRole("button", { name: "Apply retention", exact: true })
		.click();
	await expect(
		page.getByRole("dialog").getByText(/entire host journal/),
	).toBeVisible();
	await page
		.getByRole("textbox", { name: "Reason", exact: true })
		.fill("Limit journal retention to seven days");
	await page.getByRole("button", { name: "Confirm", exact: true }).click();
	await expect(
		page.getByText("Journal retention updated.", { exact: true }),
	).toBeVisible();
	expect(journalChanges).toEqual([
		{ retentionDays: 7, reason: "Limit journal retention to seven days" },
	]);
	await expect(retention).toHaveValue("7");
});

test("Regado system explains service status and confirms DNS maintenance", async ({
	regado: { page, systemActions },
}) => {
	await openSection(page, "System");
	await expect(
		page
			.getByRole("region", { name: "DNS maintenance", exact: true })
			.getByText("Scheduled", { exact: true }),
	).toBeVisible();
	await expect(
		page
			.getByRole("region", { name: "Prometheus service", exact: true })
			.getByText("Failed", { exact: true }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "About Keycloak", exact: true })
		.click();
	await expect(
		page.getByText(/Handles registration, login, TOTP/),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await page
		.getByRole("region", { name: "DNS maintenance", exact: true })
		.getByRole("button", { name: "Update now", exact: true })
		.click();
	await page
		.getByRole("textbox", { name: "Reason", exact: true })
		.fill("Verify the current public IP and DNS");
	await page.getByRole("button", { name: "Confirm", exact: true }).click();
	await expect(
		page.getByText("DNS check completed. Automatic updates remain scheduled.", {
			exact: true,
		}),
	).toBeVisible();
	expect(systemActions.at(-1).path).toBe("/v1/admin/actions/restart-ddclient");
	await page
		.getByRole("region", { name: "Storage maintenance", exact: true })
		.getByRole("button", { name: "Open storage", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "NixOS system", exact: true }),
	).toBeVisible();
});

test("Regado storage distinguishes physical capacity and applies a confirmed device layout", async ({
	regado: { page, layoutActions },
}) => {
	await openSection(page, "Storage");
	await expect(
		page.getByRole("heading", { name: "NixOS system", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Compressed RAM swap", exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("zram0 · 1.0 MiB of 4.0 GiB in use", { exact: true }),
	).toBeVisible();
	await expect(
		page
			.getByText("Available to allocate", { exact: true })
			.locator("..")
			.getByText("64.0 GiB", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("Physical pool capacity", { exact: true }),
	).toBeVisible();
	await expect(page.getByText("98.0%", { exact: true })).toBeVisible();
	await expect(
		page.getByText("Mirrored · healthy", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Mounted filesystems", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByText("No filesystem errors reported", { exact: true }),
	).toHaveCount(0);
	await expect(page.getByText(/Scrub device \/dev\//)).toHaveCount(0);
	const newDisk = page.getByRole("article", {
		name: "Device /dev/sdc",
		exact: true,
	});
	await newDisk
		.getByRole("button", { name: "Manage partitions", exact: true })
		.click();
	await page.getByLabel("System · GiB", { exact: true }).fill("64");
	await page.getByLabel("Storage · GiB", { exact: true }).fill("867");
	await page
		.getByRole("button", { name: "Preview layout", exact: true })
		.click();
	await expect(
		page.getByText("Layout engine: disko", { exact: true }),
	).toBeVisible();
	await accessibility(page, "Partition layout dialog");
	await page.setViewportSize({ width: 320, height: 700 });
	await settleInterface(page);
	await expect
		.poll(
			() =>
				page.evaluate(
					() => document.documentElement.scrollWidth - window.innerWidth,
				),
			{ message: "Partition dialog has no horizontal overflow" },
		)
		.toBeLessThanOrEqual(1);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page
		.getByLabel("Reason", { exact: true })
		.fill("Allocate operating-system and file-storage areas");
	await page
		.getByLabel("Type /dev/sdc to confirm", { exact: true })
		.fill("/dev/sdc");
	await page.getByRole("button", { name: "Apply layout", exact: true }).click();
	await expect(page.getByRole("dialog")).toBeHidden();
	expect(layoutActions[0]).toEqual({
		device: "/dev/sdc",
		identity: "serial:fixture-sdc",
		filesystem: "/srv/kaordo",
		systemBytes: 64 * 2 ** 30,
		storageBytes: 867 * 2 ** 30,
		fingerprint: "a".repeat(64),
		confirmation: "/dev/sdc",
		reason: "Allocate operating-system and file-storage areas",
	});
	await expect(page.getByText("50.0%", { exact: true }).first()).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Check copies", exact: true }),
	).toBeEnabled({ timeout: maintenanceTimeout });
});

test("Regado storage checks and repair explain bounded cleanup and report progress", async ({
	regado: { page, systemActions },
}) => {
	await openSection(page, "Storage");
	await page.getByRole("button", { name: "Check copies", exact: true }).click();
	await expect(
		page.getByText("Scanning disk checksums…", { exact: true }),
	).toBeVisible();
	const repair = page.getByRole("button", {
		name: "Repair and clean up",
		exact: true,
	});
	await expect(repair).toBeVisible();
	await expect(repair).toBeEnabled({ timeout: maintenanceTimeout });
	expect(systemActions[0].change.target).toBe("/srv/kaordo");
	await repair.click();
	await expect(
		page
			.getByRole("dialog")
			.getByText(/removes only uploads older than 24 hours/),
	).toBeVisible();
	await page.getByRole("button", { name: "Confirm", exact: true }).click();
	await expect(
		page.getByText("Scanning disk checksums…", { exact: true }),
	).toBeVisible();
	expect(systemActions[1].change.target).toBe("/srv/kaordo");
});

test("Regado discards obsolete log failures after switching to accounts", async ({
	regado: { page, staleLogStarted, releaseStaleLogs },
}) => {
	await openSection(page, "Logs");
	await page.getByLabel("Service", { exact: true }).selectOption("nodo");
	await staleLogStarted;
	await openSection(page, "Users");
	releaseStaleLogs();
	await expect(
		page.getByRole("heading", { name: "Accounts", exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("Stale log failure", { exact: true }),
		"A late log failure cannot affect Users",
	).toHaveCount(0);
});

test("Regado keeps failed role changes editable and audits a private access case once", async ({
	regado: { page, mutations, contentReads, isCaseClosed },
}) => {
	await openSection(page, "Users");
	await page.getByRole("button", { name: "Grant admin", exact: true }).click();
	await page
		.getByRole("textbox", { name: "Reason", exact: true })
		.fill("Assign administrator responsibilities");
	await page.getByRole("button", { name: "Confirm", exact: true }).click();
	await expect(
		page.getByRole("alert").filter({ hasText: "Fixture role update failed." }),
	).toBeVisible();
	await expect(
		page.getByRole("dialog"),
		"Action failure stays visible in the active dialog",
	).toBeVisible();
	await page.getByRole("button", { name: "Confirm", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Revoke admin", exact: true }),
	).toBeVisible();
	expect(mutations[0].change.isAdmin).toBe(true);
	await page.getByRole("button", { name: "Access case", exact: true }).click();
	await page
		.getByRole("textbox", { name: "Reason", exact: true })
		.fill("Investigating a documented policy violation");
	await page.getByRole("button", { name: "Confirm", exact: true }).click();
	await expect(
		page.getByText("Audited fixture content", { exact: true }),
	).toBeVisible();
	expect(contentReads, "Opening a case fetches one audited page").toEqual([
		"posts",
	]);
	await page
		.getByRole("button", { name: "Close access case", exact: true })
		.click();
	await expect(
		page.getByText("Access case closed.", { exact: true }),
	).toBeVisible();
	expect(isCaseClosed()).toBe(true);
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await settleInterface(page);
	await accessibility(page, "Dark users");
});
