// Checks public entry reflow, accessibility, and color-mode persistence across independent apps
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import test from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright-core';
import sirv from 'sirv';

const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = process.env.CHROME_BIN || (existsSync(macChrome) ? macChrome : undefined);
const pages = resolve(import.meta.dirname, '../dist/pages');

async function colorMode(page, expected) {
  await page.waitForFunction((mode) =>
    document.documentElement.classList.contains('dark') === (mode === 'dark') &&
    document.documentElement.style.colorScheme === mode,
  expected);
}

async function themePreference(browser, base) {
  const context = await browser.newContext({ colorScheme: 'light', reducedMotion: 'reduce' });
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
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true', 'Initial mode follows the system');
  await toggle.click();
  await colorMode(page, 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await colorMode(page, 'light');
  assert.equal(await page.evaluate(() => localStorage.getItem('kaordo.color-mode')), 'light',
    'An explicit preference overrides later system changes');
  await toggle.focus();
  await page.keyboard.press('Space');
  await colorMode(page, 'dark');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true', 'Keyboard toggling updates button state');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'deep-purple');

  // Blocking hydration verifies that the inline head script applies the preference independently
  const prepaint = await context.newPage();
  await prepaint.route('**/*.js', (route) => route.abort());
  for (const route of ['/', '/fluo/', '/ligo/', '/rondo/', '/regado/']) {
    await prepaint.goto(base + route, { waitUntil: 'domcontentloaded' });
    await colorMode(prepaint, 'dark');
    const primary = await prepaint.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
    assert.match(primary, /^oklch\(/);
    const [lightness, chroma, hue] = primary.match(/[\d.]+%?/g);
    assert.ok(Math.abs(parseFloat(lightness) / (lightness.endsWith('%') ? 100 : 1) - 0.65) < 0.0001,
      `${route} applies the dark primary token before hydration`);
    assert.ok(Math.abs(Number(chroma) - 0.2172) < 0.0001);
    assert.ok(Math.abs(Number(hue) - 297.1153) < 0.001);
  }
  await prepaint.close();
  await page.reload();
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true', 'Reload preserves the toggle state');
  const other = await context.newPage();
  await other.goto(base + '/fluo/');
  await colorMode(other, 'dark');
  await toggle.click();
  await colorMode(other, 'light');
  assert.equal(await other.getByRole('button', { name: 'Dark mode', exact: true }).getAttribute('aria-pressed'), 'false',
    'Preference changes propagate to another app tab');
  assert.deepEqual(errors, [], 'Color-mode changes produce no client runtime errors');
  await context.close();
}

test('public app entry screens reflow and meet automated WCAG 2.2 A/AA checks', async () => {
  assert.ok(existsSync(resolve(pages, 'index.html')), 'run pnpm build:pages first');

  const assets = sirv(pages, { dev: true });
  const server = createServer((request, response) => assets(request, response));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: chrome });
    const browserContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await browserContext.newPage();
    for (const route of ['/', '/fluo/', '/ligo/', '/rondo/', '/regado/']) {
      await page.goto(base + route, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { level: 1 }).first().waitFor();
      await page.evaluate(() => document.documentElement.classList.remove('dark'));
      await page.waitForTimeout(220);
      for (const width of [320, 768, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 1, `${route} overflows ${width}px viewport by ${overflow}px`);
        const { violations } = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
          .analyze();
        assert.deepEqual(violations.map(({ id, nodes }) => ({
          id, targets: nodes.map(({ target, html, failureSummary }) => ({ target, html, failureSummary }))
        })), [], `${route} has automated accessibility violations at ${width}px`);
      }
      await page.setViewportSize({ width: 320, height: 800 });
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await page.waitForTimeout(220);
      const darkOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(darkOverflow <= 1, `${route} overflows dark 320px viewport by ${darkOverflow}px`);
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
        .analyze();
      assert.deepEqual(violations.map(({ id, nodes }) => ({
        id, targets: nodes.map(({ target, html, failureSummary }) => ({ target, html, failureSummary }))
      })), [], `${route} has automated dark-theme accessibility violations at 320px`);
    }

    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Skip to main content');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'main-content',
      'Keyboard users must be able to skip directly to the portal content');
    const ligo = page.getByRole('link', { name: /Open Ligo/ });
    assert.equal(await ligo.getAttribute('href'), '/ligo/', 'portal must link to the available Ligo app');
    await themePreference(browser, base);
  } finally {
    await browser?.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
