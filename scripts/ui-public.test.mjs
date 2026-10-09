// Checks public entry reflow, accessibility, and color-mode persistence across independent apps
import assert from 'node:assert/strict';
import { assertAccessible as accessible } from './ui-accessibility.mjs';
import { test, expect, installSignedOutIdentity } from './ui-fixture.mjs';

test.beforeEach(async ({ context }) => {
	await installSignedOutIdentity(context);
});

async function colorMode(page, expected) {
	await page.waitForFunction(
		(mode) =>
			document.documentElement.classList.contains('dark') === (mode === 'dark') &&
			document.documentElement.style.colorScheme === mode,
		expected
	);
}

async function themePreference(browser, base) {
	const context = await browser.newContext({ colorScheme: 'light', reducedMotion: 'reduce' });
	await installSignedOutIdentity(context);
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(base);
	const toggle = page.getByRole('button', { name: 'Dark mode', exact: true });
	await toggle.waitFor();
	await colorMode(page, 'light');
	assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
	await page.emulateMedia({ colorScheme: 'dark' });
	await colorMode(page, 'dark');
	assert.equal(
		await toggle.getAttribute('aria-pressed'),
		'true',
		'Initial mode follows the system'
	);
	await toggle.click();
	await colorMode(page, 'light');
	await page.emulateMedia({ colorScheme: 'light' });
	await page.emulateMedia({ colorScheme: 'dark' });
	await colorMode(page, 'light');
	assert.equal(
		await page.evaluate(() => localStorage.getItem('kaordo.color-mode')),
		'light',
		'An explicit preference overrides later system changes'
	);
	await toggle.focus();
	await page.keyboard.press('Space');
	await colorMode(page, 'dark');
	assert.equal(
		await toggle.getAttribute('aria-pressed'),
		'true',
		'Keyboard toggling updates button state'
	);
	assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'deep-purple');

	// Blocking hydration verifies that the inline head script applies the preference independently
	const prepaint = await context.newPage();
	await prepaint.route('**/*.js', (route) => route.abort());
	for (const route of ['/', '/fluo/', '/ligo/', '/rondo/', '/lingvo/', '/regado/']) {
		await prepaint.goto(base + route, { waitUntil: 'domcontentloaded' });
		await colorMode(prepaint, 'dark');
		const primary = await prepaint.evaluate(() =>
			getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
		);
		assert.match(primary, /^oklch\(/);
		const [lightness, chroma, hue] = primary.match(/[\d.]+%?/g);
		assert.ok(
			Math.abs(parseFloat(lightness) / (lightness.endsWith('%') ? 100 : 1) - 0.65) < 0.0001,
			`${route} applies the dark primary token before hydration`
		);
		assert.ok(Math.abs(Number(chroma) - 0.2172) < 0.0001);
		assert.ok(Math.abs(Number(hue) - 297.1153) < 0.001);
	}
	await prepaint.close();
	await page.reload();
	await toggle.waitFor();
	assert.equal(
		await toggle.getAttribute('aria-pressed'),
		'true',
		'Reload preserves the toggle state'
	);
	const other = await context.newPage();
	await other.goto(base + '/fluo/');
	await colorMode(other, 'dark');
	await toggle.click();
	await colorMode(other, 'light');
	assert.equal(
		await other
			.getByRole('button', { name: 'Dark mode', exact: true })
			.getAttribute('aria-pressed'),
		'false',
		'Preference changes propagate to another app tab'
	);
	assert.deepEqual(errors, [], 'Color-mode changes produce no client runtime errors');
	await context.close();
}

for (const route of ['/', '/fluo/', '/ligo/', '/rondo/', '/lingvo/', '/regado/']) {
	test(`${route} public entry reflows and meets automated WCAG 2.2 A/AA checks`, async ({
		page,
		staticOrigin,
		browserName
	}) => {
		await page.goto(staticOrigin + route);
		await page.getByRole('heading', { level: 1 }).first().waitFor();
		await page.getByRole('link', { name: 'Sign in', exact: true }).first().waitFor();
		await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
		await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.locator('main')).toBeFocused();
		for (const width of [320, 768, 1280]) {
			await page.setViewportSize({ width, height: 800 });
			await expect
				.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
					message: `${route} must reflow at ${width}px`
				})
				.toBeLessThanOrEqual(1);
			await accessible(page, `${route} at ${width}px`);
		}
		await page.setViewportSize({ width: 320, height: 800 });
		await page.evaluate(() => localStorage.setItem('kaordo.color-mode', 'dark'));
		await page.reload();
		await colorMode(page, 'dark');
		await page.getByRole('link', { name: 'Sign in', exact: true }).first().waitFor();
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
				message: `${route} dark entry must reflow at 320px`
			})
			.toBeLessThanOrEqual(1);
		await accessible(page, `${route} dark at 320px`);
	});
}

test('Portal supports skip navigation and color preferences persist across independent apps', async ({
	page,
	browser,
	staticOrigin,
	browserName
}) => {
	await page.goto(staticOrigin);
	await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
	assert.equal(
		await page.evaluate(() => document.activeElement?.textContent?.trim()),
		'Skip to main content'
	);
	await page.keyboard.press('Enter');
	assert.equal(await page.evaluate(() => document.activeElement?.id), 'main-content');
	await expect(page.getByRole('link', { name: /Open Ligo/ })).toHaveAttribute('href', '/ligo/');
	await themePreference(browser, staticOrigin);
});
