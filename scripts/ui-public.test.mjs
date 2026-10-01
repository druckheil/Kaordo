import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import test from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright-core';
import sirv from 'sirv';

const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pages = resolve(import.meta.dirname, '../dist/pages');

test('public app entry screens reflow and meet automated WCAG 2.2 A/AA checks', async (context) => {
  if (!existsSync(chrome)) return context.skip(`Chrome is unavailable at ${chrome}`);
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
    const ligo = page.getByRole('link', { name: /Open Ligo/ });
    assert.equal(await ligo.getAttribute('href'), '/ligo/', 'portal must link to the available Ligo app');
  } finally {
    await browser?.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
