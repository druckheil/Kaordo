// Exercises Regado navigation, pool changes, media maintenance and guarded administrator actions
import {
	assertAccessible as accessibility,
	assertInterfaceGeometry,
	settleInterface
} from './ui-accessibility.mjs';
import { test, expect } from './regado-fixture.mjs';

async function openSection(page, section) {
	const navigation = page.getByRole('button', { name: section, exact: true });
	await navigation.click();
	await expect(navigation).toHaveAttribute('aria-current', 'page');
	await expect(page).toHaveURL(new RegExp('view=' + section.toLowerCase()));
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		section === 'Overview' ? 'System overview' : section
	);
}

// Background maintenance deliberately polls rather than tying its lifetime to the action request
const maintenanceTimeout = 25_000;

test('Regado overview explains charts and supports both appearances', async ({
	regado: { page }
}) => {
	await page.locator('.uplot canvas').first().waitFor();
	await expect(page.locator('.u-legend:visible'), 'No empty cursor legend is shown').toHaveCount(0);
	await page.getByRole('button', { name: 'About CPU', exact: true }).click();
	await expect(page.getByText(/horizontal axis is local time/)).toBeVisible();
	await page.keyboard.press('Escape');
	await accessibility(page, 'Overview');
	const theme = page.getByRole('button', { name: 'Dark mode', exact: true });
	await theme.click();
	await expect(theme).toHaveAttribute('aria-pressed', 'true');
	await accessibility(page, 'Dark overview');
});

test('Regado charts follow repeated viewport changes without resize feedback', async ({
	regado: { page }
}) => {
	for (const [section, count] of [['Overview', 6]]) {
		await openSection(page, section);
		await expect(page.locator('.uplot')).toHaveCount(count);
		for (const width of [320, 1440, 390, 1024, 1440]) {
			await page.setViewportSize({ width, height: 900 });
			await expect
				.poll(
					() =>
						page.locator('.uplot').evaluateAll((charts) =>
							charts
								.map((chart) => ({
									width: chart.getBoundingClientRect().width,
									host: chart.parentElement.clientWidth
								}))
								.filter((size) => Math.abs(size.width - size.host) > 1)
						),
					{ message: `${section} charts fit their host at ${width}px` }
				)
				.toEqual([]);
		}
	}
});

for (const section of ['Storage', 'Usage', 'Logs', 'Users', 'Audit', 'System']) {
	test(`Regado ${section} has accessible desktop and mobile layouts`, async ({
		regado: { page }
	}, testInfo) => {
		await openSection(page, section);
		await accessibility(page, section);
		await assertInterfaceGeometry(page, section);
		await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
		await accessibility(page, `Dark ${section}`);
		await page.setViewportSize({ width: 320, height: 700 });
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
				message: `${section}: no page horizontal overflow at 320px`
			})
			.toBeLessThanOrEqual(1);
		await assertInterfaceGeometry(page, `Mobile ${section}`);
		await accessibility(page, `Mobile ${section}`);
		if (process.env.KAORDO_UI_SCREENSHOTS === '1') {
			await page.screenshot({
				path: testInfo.outputPath(`regado-${section.toLowerCase()}-mobile.png`),
				fullPage: true
			});
		}
	});
}

test('Regado history, reload, enlarged text and text spacing preserve the selected section', async ({
	regado: { page }
}, testInfo) => {
	await openSection(page, 'Audit');
	await openSection(page, 'System');
	await page.goBack();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Audit');
	await page.goForward();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('System');
	await page.reload();
	await expect(page.getByRole('button', { name: 'System', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await page.getByRole('region', { name: 'DNS maintenance', exact: true }).waitFor();
	await settleInterface(page);
	if (process.env.KAORDO_UI_SCREENSHOTS === '1') {
		await page.screenshot({
			path: testInfo.outputPath('regado-system-desktop.png'),
			fullPage: true
		});
	}
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.evaluate(() => {
		document.documentElement.style.fontSize = '200%';
	});
	await assertInterfaceGeometry(page, 'Regado enlarged text');
	await accessibility(page, 'Regado enlarged text');
	await page.evaluate(() => {
		document.documentElement.style.fontSize = '';
	});
	await page.addStyleTag({
		content:
			'* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important } p { margin-bottom: 2em !important }'
	});
	await page.setViewportSize({ width: 320, height: 700 });
	await assertInterfaceGeometry(page, 'Regado text spacing');
	await accessibility(page, 'Regado text spacing');
});

test('Regado journal retention has keyboard focus and an audited confirmation', async ({
	regado: { page, host }
}) => {
	await openSection(page, 'Logs');
	await expect(page.getByText('32.0 MiB', { exact: true })).toBeVisible();
	const retention = page.getByRole('combobox', {
		name: 'Log lifetime',
		exact: true
	});
	await retention.focus();
	await page.keyboard.press('Tab');
	await page.keyboard.press('Shift+Tab');
	await expect(retention).toBeFocused();
	await settleInterface(page);
	const focus = await retention.evaluate((element) => {
		const style = getComputedStyle(element);
		const probe = document.createElement('span');
		probe.style.color = 'var(--focus-color)';
		document.body.append(probe);
		const color = getComputedStyle(probe).color;
		probe.remove();
		return {
			style: style.outlineStyle,
			width: parseFloat(style.outlineWidth),
			color: style.outlineColor,
			expectedColor: color
		};
	});
	expect(focus.style).toBe('solid');
	expect(focus.width).toBeGreaterThanOrEqual(2);
	expect(focus.color, JSON.stringify(focus)).toBe(focus.expectedColor);
	await retention.selectOption('7');
	await page.getByRole('button', { name: 'Apply retention', exact: true }).click();
	await expect(page.getByRole('dialog').getByText(/desired journal retention/)).toBeVisible();
	await page
		.getByRole('textbox', { name: 'Reason', exact: true })
		.fill('Limit journal retention to seven days');
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	await expect(page.getByText(/Journal retention is being applied/)).toBeVisible();
	expect(host.changes).toEqual([
		{
			document: expect.objectContaining({
				cleanup: { nixGenerationsDays: 30, releasesKeep: 5, journalDays: 7 }
			}),
			confirmations: [],
			reason: 'Limit journal retention to seven days'
		}
	]);
	await page.getByRole('button', { name: 'Refresh', exact: true }).click();
	await expect(retention).toHaveValue('7');
});

test('Regado system explains service status and confirms DNS maintenance', async ({
	regado: { page, systemActions }
}) => {
	await openSection(page, 'System');
	await expect(
		page
			.getByRole('region', { name: 'DNS maintenance', exact: true })
			.getByText('Scheduled', { exact: true })
	).toBeVisible();
	await expect(
		page
			.getByRole('region', { name: 'Prometheus service', exact: true })
			.getByText('Failed', { exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'About Keycloak', exact: true }).click();
	await expect(page.getByText(/Handles registration, login, TOTP/)).toBeVisible();
	await page.keyboard.press('Escape');
	await page
		.getByRole('region', { name: 'DNS maintenance', exact: true })
		.getByRole('button', { name: 'Update now', exact: true })
		.click();
	await page
		.getByRole('textbox', { name: 'Reason', exact: true })
		.fill('Verify the current public IP and DNS');
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	await expect(
		page.getByText('DNS check completed. Automatic updates remain scheduled.', {
			exact: true
		})
	).toBeVisible();
	expect(systemActions.at(-1).path).toBe('/v1/admin/actions/restart-ddclient');
});

test('Regado storage adds a device through a planned, confirmed pool change', async ({
	regado: { page, host }
}) => {
	await openSection(page, 'Storage');
	const summary = page.getByRole('region', { name: 'fixture-server', exact: true });
	await expect(summary.getByText('Healthy', { exact: true })).toBeVisible();
	await expect(summary).toContainText('· 2 devices ·');
	await expect(
		summary.getByText('2 copies on separate devices', { exact: true }).first()
	).toBeVisible();
	const devices = page.getByRole('region', { name: 'Devices', exact: true });
	await expect(
		devices
			.getByRole('listitem', { name: 'WDC WD10EZRX · WD-A', exact: true })
			.getByText('SMART passed · 35 °C · 41,000 hours', { exact: true })
	).toBeVisible();

	await devices
		.getByRole('listitem', { name: 'WDC WD10EZRX · WD-C', exact: true })
		.getByRole('button', { name: 'Add to pool', exact: true })
		.click();
	const dialog = page.getByRole('dialog', { name: 'Change the storage pool', exact: true });
	await expect(
		dialog.getByRole('checkbox', { name: 'WDC WD10EZRX · WD-C', exact: true })
	).toBeChecked();
	await dialog.getByRole('radio', { name: '3 copies on separate devices', exact: true }).click();
	await expect(
		dialog.getByText('Erase WDC WD10EZRX (WD-C) and add it to the pool', { exact: true })
	).toBeVisible();
	await expect(dialog.getByText('Rewrite files with three copies', { exact: true })).toBeVisible();
	const apply = dialog.getByRole('button', { name: 'Apply', exact: true });
	await expect(dialog.getByLabel('Reason', { exact: true })).toHaveValue('');
	await expect(apply, 'Erasing needs the typed serial').toBeDisabled();
	await dialog.getByLabel('Type WD-C to confirm', { exact: true }).fill('WD-C');
	await accessibility(page, 'Pool change dialog');
	await page.setViewportSize({ width: 320, height: 700 });
	await settleInterface(page);
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
			message: 'Pool change dialog has no horizontal overflow'
		})
		.toBeLessThanOrEqual(1);
	await page.setViewportSize({ width: 1440, height: 900 });
	await apply.click();
	await expect(dialog).toBeHidden();
	expect(host.changes).toEqual([
		{
			document: expect.objectContaining({
				revision: 1,
				pool: {
					devices: ['wwn-0x50014ee0aaaa0001', 'wwn-0x50014ee0aaaa0002', 'wwn-0x50014ee0aaaa0003'],
					dataProfile: 'raid1c3',
					metadataProfile: 'auto'
				}
			}),
			confirmations: ['WD-C'],
			reason: '',
			converge: true
		}
	]);

	const operation = page.getByRole('listitem', {
		name: 'Apply desired state (revision 2)',
		exact: true
	});
	await expect(operation.getByText(/^Running · You ·/)).toBeVisible();
	await expect(operation.getByRole('progressbar')).toBeVisible();
	await expect(operation.getByText(/^Done · You ·/)).toBeVisible({ timeout: maintenanceTimeout });
	await expect(summary).toContainText('· 3 devices ·');
	await expect(
		devices
			.getByRole('listitem', { name: 'WDC WD10EZRX · WD-C', exact: true })
			.getByRole('button', { name: 'Remove from pool', exact: true })
	).toBeEnabled();
	await operation.getByRole('button', { name: 'Show log', exact: true }).click();
	await expect(operation.getByRole('list', { name: 'Operation log', exact: true })).toContainText(
		'Wiping signatures on /dev/sdc'
	);
});

test('Regado storage refuses a plan that would leave too few devices', async ({
	regado: { page, host }
}) => {
	await openSection(page, 'Storage');
	await page
		.getByRole('listitem', { name: 'WDC WD10EZRX · WD-B', exact: true })
		.getByRole('button', { name: 'Remove from pool', exact: true })
		.click();
	const dialog = page.getByRole('dialog', { name: 'Change the storage pool', exact: true });
	await expect(
		dialog.getByText(
			'Two copies need at least two devices; add a device before removing this one.',
			{
				exact: true
			}
		)
	).toBeVisible();
	await dialog.getByLabel('Reason', { exact: true }).fill('Retire the older disk from the pool');
	await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	expect(host.changes).toEqual([]);
});

test('Regado integrity checks run on request and follow an audited schedule', async ({
	regado: { page, host }
}) => {
	await openSection(page, 'Storage');
	const integrity = page.getByRole('region', { name: 'Integrity checks', exact: true });
	const scrub = integrity.getByRole('listitem', { name: 'Verify every copy', exact: true });
	await expect(scrub.getByText('Monthly · Not run yet', { exact: true })).toBeVisible();

	const polls = [];
	page.on('request', (request) => {
		if (
			request.method() === 'GET' &&
			new URL(request.url()).pathname.endsWith('/hosts/local/operations')
		)
			polls.push(Date.now());
	});
	await scrub.getByRole('button', { name: 'Run now', exact: true }).click();
	const run = page.getByRole('dialog', { name: 'Verify every copy', exact: true });
	await expect(run.getByText(/A damaged copy is rewritten from a good one/)).toBeVisible();
	await expect(run.getByLabel('Reason', { exact: true })).toHaveValue('');
	await expect(run.getByRole('button', { name: 'Run now', exact: true })).toBeEnabled();
	await run.getByRole('button', { name: 'Run now', exact: true }).click();
	await expect(run).toBeHidden();
	expect(host.checks).toEqual([{ kind: 'integrity.scrub', reason: '' }]);
	await expect(
		integrity.getByRole('button', { name: 'Run now', exact: true }).first(),
		'Only one check runs at a time'
	).toBeDisabled();
	await expect(scrub.getByText(/^Monthly · Running · \d+%$/)).toBeVisible();
	const activity = page.getByRole('region', { name: 'Activity', exact: true });
	const bar = activity.getByRole('progressbar');
	await expect(activity.getByText(/^\d+% · Updated \d+ s ago$/)).toBeVisible();
	const first = Number(await bar.getAttribute('aria-valuenow'));
	await expect
		.poll(async () => Number(await bar.getAttribute('aria-valuenow')), {
			message: 'The progress bar follows each five-second poll',
			timeout: 7_000
		})
		.toBeGreaterThan(first);
	await expect(scrub.getByText(/^Monthly · Passed /)).toBeVisible({ timeout: maintenanceTimeout });
	const gaps = polls.slice(1).map((time, index) => time - polls[index]);
	expect(polls.length, 'Operations were polled while the check ran').toBeGreaterThanOrEqual(3);
	expect(Math.max(...gaps), 'No poll gap exceeds the five-second interval').toBeLessThan(6_500);

	await integrity.getByRole('button', { name: 'Change schedule…', exact: true }).click();
	const schedule = page.getByRole('dialog', { name: 'Integrity schedule', exact: true });
	await accessibility(page, 'Integrity schedule dialog');
	const save = schedule.getByRole('button', { name: 'Save', exact: true });
	await schedule.getByLabel('Reason', { exact: true }).fill('x');
	await expect(save, 'An unchanged schedule is not saved').toBeDisabled();
	await schedule
		.getByRole('group', { name: 'Verify every copy', exact: true })
		.getByRole('radio', { name: 'Weekly', exact: true })
		.click();
	await save.click();
	await expect(schedule).toBeHidden();
	expect(host.changes).toEqual([
		{
			document: expect.objectContaining({
				integrity: { scrub: 'weekly', smartShort: 'weekly', smartLong: 'monthly' }
			}),
			confirmations: [],
			reason: 'x'
		}
	]);
	await expect(scrub.getByText(/^Weekly · Passed /)).toBeVisible();
});

test('Regado alerts are listed and push notifications are configured and tested', async ({
	regado: { page, host }
}) => {
	await expect(page.getByText('1 open alert · see Storage', { exact: true })).toBeVisible();
	await openSection(page, 'Storage');
	const alerts = page.getByRole('region', { name: 'Alerts', exact: true });
	await expect(
		alerts.getByRole('list', { name: 'Open alerts', exact: true }).getByRole('listitem')
	).toHaveCount(1);
	await expect(alerts.getByText(/Push notifications are off/)).toBeVisible();

	await alerts.getByRole('button', { name: 'Notifications…', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Notifications', exact: true });
	await dialog.getByRole('checkbox', { name: 'Push notifications with ntfy', exact: true }).click();
	await expect(dialog.getByLabel('Server', { exact: true })).toHaveValue('https://ntfy.sh');
	const topic = await dialog.getByLabel('Topic', { exact: true }).inputValue();
	expect(topic).toMatch(/^kaordo-[a-z2-9]{20}$/);
	await dialog.getByLabel('Warning at %', { exact: true }).fill('95');
	await expect(dialog.getByText(/Thresholds must satisfy/)).toBeVisible();
	await dialog.getByLabel('Warning at %', { exact: true }).fill('75');
	await expect(dialog.getByLabel('Reason', { exact: true })).toHaveValue('');
	await accessibility(page, 'Notifications dialog');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();
	expect(host.changes).toEqual([
		{
			document: expect.objectContaining({
				alerts: {
					poolWarningPercent: 75,
					poolCriticalPercent: 90,
					ntfy: { url: 'https://ntfy.sh', topic }
				}
			}),
			confirmations: [],
			reason: ''
		}
	]);
	await expect(alerts.getByText(`on ntfy topic ${topic}.`, { exact: false })).toBeVisible();

	await alerts.getByRole('button', { name: 'Notifications…', exact: true }).click();
	await dialog.getByRole('button', { name: 'Send test notice', exact: true }).click();
	await expect(
		dialog.getByText('Test notice sent to Saved messages · ntfy: sent', { exact: true })
	).toBeVisible();
	expect(host.tests).toEqual([{ url: 'https://ntfy.sh', topic }]);
});

test('Regado usage shows the whole pool, runaway growth, heavy accounts and lagging tables', async ({
	regado: { page, host }
}) => {
	await openSection(page, 'Usage');
	const overview = page.getByRole('region', { name: 'What fills the pool', exact: true });
	await expect(
		overview.getByRole('img', { name: /^Pool contents: Uploaded files 25\.\d%/ })
	).toBeVisible();
	const contents = overview.getByRole('list', { name: 'Pool contents', exact: true });
	await expect(contents.getByRole('listitem')).toHaveCount(11);
	await expect(
		contents.getByRole('listitem', { name: 'Logs', exact: true }).getByText(/^Unusual growth/)
	).toBeVisible();
	await expect(
		contents
			.getByRole('listitem', { name: 'Uploaded files', exact: true })
			.getByText(/1\.0 GiB are not linked to any content/)
	).toBeVisible();
	await expect(
		contents.getByRole('listitem', { name: 'Filesystem metadata', exact: true })
	).toBeVisible();
	await expect(
		contents
			.getByRole('listitem', { name: 'Unattributed pool usage', exact: true })
			.getByText('Large difference; inspect filesystem accounting', { exact: true })
	).toBeVisible();
	await expect(
		overview.getByText('Full in about 120 days at last week’s pace', { exact: true })
	).toBeVisible();

	const history = page.getByRole('region', { name: 'How it grew', exact: true });
	await expect(history.getByRole('img', { name: /over the last 7d/ })).toBeVisible();
	await history.getByRole('radio', { name: '30d', exact: true }).click();
	await expect(history.getByRole('img', { name: /over the last 30d/ })).toBeVisible();
	expect(host.usageWindows).toContain('30d');

	const accounts = page.getByRole('region', { name: 'Accounts', exact: true });
	await expect(
		accounts
			.getByRole('list', { name: 'Accounts by size', exact: true })
			.getByRole('listitem')
			.first()
	).toHaveAccessibleName('@member');
	await expect(
		accounts
			.getByRole('listitem', { name: '@member', exact: true })
			.getByText('Unusual this week: 2.0 GiB added', { exact: true })
	).toBeVisible();
	await expect(
		accounts.getByRole('listitem', { name: '@operator', exact: true }).getByText(/^Unusual/)
	).toHaveCount(0);

	const database = page.getByRole('region', { name: 'Database', exact: true });
	await expect(
		database.getByRole('row', { name: /ligo_messages/ }).getByLabel('Cleanup lags behind updates')
	).toBeVisible();
	await expect(
		database.getByRole('row', { name: /fluo_posts/ }).getByLabel('Cleanup lags behind updates')
	).toHaveCount(0);

	await overview.getByRole('button', { name: 'Measure now', exact: true }).click();
	await expect.poll(() => host.measurements()).toBe(1);
	// The agent reports the running measurement; the view checks again every 5 seconds
	await expect(overview.getByRole('button', { name: 'Measuring…', exact: true })).toBeDisabled();
	await accessibility(page, 'Usage');
});

test('Regado media checks and cleanup are confirmed and report progress', async ({
	regado: { page, systemActions }
}) => {
	await openSection(page, 'Storage');
	const media = page.getByRole('region', { name: 'Media files', exact: true });
	await expect(media.getByText('10 files · 1.0 MiB', { exact: true })).toBeVisible();
	await expect(media.getByText('1 file · 4.0 KiB', { exact: true })).toBeVisible();
	await media.getByRole('button', { name: 'Clean up', exact: true }).click();
	await expect(
		page.getByRole('dialog').getByText(/removes uploads older than 24 hours/)
	).toBeVisible();
	await expect(page.getByRole('textbox', { name: 'Reason', exact: true })).toHaveValue('');
	await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	await expect(media.getByText('Cleaning up · Checking references', { exact: true })).toBeVisible();
	await expect(media.getByRole('button', { name: 'Check', exact: true })).toBeEnabled({
		timeout: maintenanceTimeout
	});
	expect(systemActions).toEqual([
		{ path: '/v1/admin/actions/clean-media', change: { reason: '' } }
	]);
});

test('Regado discards obsolete log failures after switching to accounts', async ({
	regado: { page, staleLogStarted, releaseStaleLogs }
}) => {
	await openSection(page, 'Logs');
	await page.getByLabel('Service', { exact: true }).selectOption('nodo');
	await staleLogStarted;
	await openSection(page, 'Users');
	releaseStaleLogs();
	await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
	await expect(
		page.getByText('Stale log failure', { exact: true }),
		'A late log failure cannot affect Users'
	).toHaveCount(0);
});

test('Regado keeps failed role changes editable', async ({ regado: { page, mutations } }) => {
	await openSection(page, 'Users');
	await page.getByRole('button', { name: 'Grant admin', exact: true }).click();
	await page
		.getByRole('textbox', { name: 'Reason', exact: true })
		.fill('Assign administrator responsibilities');
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	await expect(
		page.getByRole('alert').filter({ hasText: 'Fixture role update failed.' })
	).toBeVisible();
	await expect(
		page.getByRole('dialog'),
		'Action failure stays visible in the active dialog'
	).toBeVisible();
	await page.getByRole('button', { name: 'Confirm', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Revoke admin', exact: true })).toBeVisible();
	expect(mutations[0].change.isAdmin).toBe(true);
	await page.evaluate(() => document.documentElement.classList.add('dark'));
	await settleInterface(page);
	await accessibility(page, 'Dark users');
});
