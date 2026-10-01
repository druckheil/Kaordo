import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv, promisify } from 'node:util';
import test from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright-core';

const run = promisify(execFile);
const site = 'http://localhost:8765';
const identity = 'http://localhost:8080';
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = process.env.CHROME_BIN || (existsSync(macChrome) ? macChrome : undefined);

async function capture(page, name) {
  if (process.env.KAORDO_UI_SNAPSHOTS !== '1') return;
  const path = join(tmpdir(), `kaordo-ui-${name}.png`);
  await page.screenshot({ path });
  console.log(`UI snapshot: ${path}`);
}

function codeFor(secret) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', Buffer.from(secret, 'utf8')).update(counter).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function checkAccessibility(page, stage) {
  await page.waitForLoadState('load');
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
    .analyze();
  const summary = violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => ({ target: node.target, data: node.any.map((check) => check.data) }))
  }));
  assert.deepEqual(summary, [], `${stage} must have no automated WCAG A/AA violations`);
}

async function checkCachedPreview(page, navigate, expectedText) {
  let releaseRequest = () => {};
  let intercepted = false;
  let reportIntercepted;
  let reportContinued;
  const interceptedReady = new Promise((resolve) => { reportIntercepted = resolve; });
  const continued = new Promise((resolve) => { reportContinued = resolve; });
  const holdAccountRequest = async (route) => {
    try {
      if (!intercepted) {
        intercepted = true;
        reportIntercepted();
        await new Promise((resolve) => { releaseRequest = resolve; });
      }
      await route.continue();
    } finally {
      reportContinued();
    }
  };
  const accountResponse = page.waitForResponse((response) =>
    response.url().endsWith('/v1/session') && response.request().method() === 'POST');
  const accountRequest = page.waitForRequest((request) =>
    request.url().endsWith('/v1/session') && request.method() === 'POST');
  void accountResponse.catch(() => {});
  void accountRequest.catch(() => {});
  await page.route('**/v1/session', holdAccountRequest);
  try {
    await navigate();
    await page.locator('[data-kaordo-preview]').waitFor();
    await page.getByText(expectedText, { exact: false }).waitFor();
    await accountRequest;
    await interceptedReady;
    assert.equal(intercepted, true, 'Kerno account verification must run while the cached preview is visible');
  } finally {
    releaseRequest();
    if (intercepted) await continued;
    await page.unroute('**/v1/session', holdAccountRequest);
  }
  assert.equal((await accountResponse).status(), 200);
  await page.locator('[data-kaordo-preview]').waitFor({ state: 'detached' });
}

async function focusByTab(page, selector, stage) {
  for (let attempt = 0; attempt < 30; attempt++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((target) => document.activeElement?.matches(target), selector)) return;
  }
  assert.fail(`${stage} must be reachable with Tab`);
}

async function administrator() {
  const config = parseEnv(await readFile('deploy/local/.env', 'utf8'));
  const response = await fetch(`${identity}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'admin-cli', grant_type: 'password',
      username: config.KEYCLOAK_ADMIN_USERNAME, password: config.KEYCLOAK_ADMIN_PASSWORD
    })
  });
  assert.equal(response.status, 200, 'Administrator login must succeed for test cleanup');
  const { access_token: token } = await response.json();
  return { Authorization: `Bearer ${token}` };
}

async function removeTemporaryUser(username) {
  const headers = await administrator();
  const response = await fetch(`${identity}/admin/realms/kaordo/users?username=${encodeURIComponent(username)}&exact=true`, { headers });
  assert.equal(response.status, 200, 'Temporary identity lookup must succeed');
  const users = (await response.json()).filter((user) => user.username === username);
  for (const user of users) {
    const subject = user.id;
    assert.match(subject, /^[0-9a-f-]{36}$/i);
    const deletion = await fetch(`${identity}/admin/realms/kaordo/users/${subject}`, { method: 'DELETE', headers });
    assert.equal(deletion.status, 204, 'Temporary identity deletion must succeed');
    await run('docker', [
      'exec', 'local-app-db-1', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'kaordo', '-d', 'kaordo', '-tAc',
      `BEGIN; DELETE FROM ligo_conversations WHERE created_by IN (SELECT id FROM users WHERE keycloak_sub = '${subject}'); DELETE FROM users WHERE keycloak_sub = '${subject}' RETURNING id; COMMIT;`
    ]);
  }
}

test('registration, TOTP and recovery login, Kerno account, Fluo posting, and app SSO', { timeout: 150_000 }, async () => {
  const username = `test_${randomBytes(6).toString('hex')}`;
  const password = `Qa!${randomBytes(18).toString('hex')}`;
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${site}/register/`);
    await page.locator('#kc-register-form').waitFor();
    assert.ok(page.url().startsWith(identity), 'Registration must open the identity form without an extra click');
    await capture(page, 'register');
    await checkAccessibility(page, 'Keycloak registration');
    await page.setViewportSize({ width: 320, height: 768 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'Registration must reflow at 320 CSS pixels');
    await checkAccessibility(page, 'Keycloak registration at 320px');
    await page.setViewportSize({ width: 1280, height: 720 });
    const fields = await page.locator('#kc-register-form input:not([type=submit])').evaluateAll((inputs) =>
      inputs.filter((input) => input.type !== 'hidden').map((input) => input.name));
    assert.deepEqual(fields, ['username', 'password']);
    await page.locator('input[name=username]').fill(username);
    await page.locator('input[name=password]').fill(password);
    await focusByTab(page, '#kc-register-form input[type=submit]', 'Registration submit');
    await page.keyboard.press('Enter');
    await page.locator('input[name=totpSecret]').waitFor({ state: 'attached' });
    await checkAccessibility(page, 'TOTP setup');
    const secret = await page.locator('input[name=totpSecret]').inputValue();
    const setupCounter = Math.floor(Date.now() / 30_000);
    await page.locator('input[name=totp]').fill(codeFor(secret));
    await page.locator('#kc-totp-settings-form input[type=submit]').click();
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#kc-recovery-codes-list li').first().waitFor();
    await checkAccessibility(page, 'Recovery-code setup');
    const firstCode = await page.locator('#kc-recovery-codes-list li').first().textContent();
    assert.ok(firstCode?.trim(), 'Recovery setup must issue codes');
    await page.locator('input[name=kcRecoveryCodesConfirmationCheck]').check();
    const accountResponse = page.waitForResponse((response) => response.url().endsWith('/v1/session') && response.request().method() === 'POST');
    await page.locator('#saveRecoveryAuthnCodesBtn').click();
    const session = await accountResponse;
    assert.equal(session.status(), 200, 'Kerno must accept the new identity');
    const account = await session.json();
    assert.equal(account.username, username);
    assert.match(account.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const bearer = (await session.request().allHeaders()).authorization;
    assert.match(bearer, /^Bearer /);
    const me = await fetch('http://localhost:8081/v1/me', {
      headers: { Authorization: bearer, Origin: site }
    });
    assert.equal(me.status, 200);
    assert.equal(me.headers.get('Cache-Control'), 'no-store');
    assert.equal(me.headers.get('Access-Control-Allow-Origin'), site);
    assert.equal((await me.json()).id, account.id);
    assert.equal((await fetch('http://localhost:8081/v1/me')).status, 401);
    assert.equal((await fetch('http://localhost:8081/v1/me', {
      headers: { Authorization: bearer, Origin: 'https://untrusted.example' }
    })).status, 403);
    const timings = await Promise.all(Array.from({ length: 32 }, async () => {
      const started = performance.now();
      const response = await fetch('http://localhost:8081/v1/me', { headers: { Authorization: bearer, Origin: site } });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).id, account.id);
      return performance.now() - started;
    }));
    timings.sort((a, b) => a - b);
    const p95 = timings[Math.ceil(timings.length * 0.95) - 1];
    assert.ok(p95 < 2_000, `Local authenticated account lookup p95 exceeded 2 seconds (${Math.round(p95)} ms)`);
    console.log(`Kerno account lookup, 32 concurrent requests: p95 ${Math.round(p95)} ms`);
    await page.getByText(`Welcome, ${username}.`).waitFor();
    await capture(page, 'portal');
    const cachedAccount = await page.evaluate(() => sessionStorage.getItem('kaordo:account-preview:v1'));
    assert.ok(cachedAccount, 'A verified account should be available for a display-only preview');
    assert.doesNotMatch(cachedAccount, /accessToken|refreshToken|Bearer /);
    await checkAccessibility(page, 'Connected portal');
    await page.setViewportSize({ width: 320, height: 768 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'Connected portal must reflow at 320 CSS pixels');
    await checkAccessibility(page, 'Connected portal at 320px');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addInitScript(() => {
      window.__guestActionSeen = false;
      const check = () => {
        if (document.querySelector('a[href="/login/"]')) window.__guestActionSeen = true;
      };
      document.addEventListener('DOMContentLoaded', () => {
        check();
        new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true });
      }, { once: true });
    });
    await checkCachedPreview(page, () => page.reload(), `Welcome, ${username}.`);
    assert.equal(await page.evaluate(() => window.__guestActionSeen), false, 'Signed-in refresh must not flash guest actions');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('link', { name: 'Sign in', exact: true }).first().waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('kaordo:account-preview:v1')), null);
    await page.goto(`${site}/login/`);
    await page.locator('#kc-form-login').waitFor();
    assert.ok(page.url().startsWith(identity), 'Sign-in must open the identity form without an extra click');
    await checkAccessibility(page, 'Keycloak password login');
    await page.locator('input[name=username]').fill(username);
    await page.locator('input[name=password]').fill(password);
    await page.locator('#kc-login').click();
    await page.waitForLoadState('domcontentloaded');
    await page.locator('input[name=otp]').waitFor();
    await checkAccessibility(page, 'TOTP login');
    await page.getByRole('link', { name: 'Try Another Way' }).click();
    await page.getByRole('button', { name: /Recovery Authentication Code/ }).click();
    await page.locator('input[name=recoveryCodeInput]').waitFor();
    await checkAccessibility(page, 'Recovery-code login');
    const recoveryCode = firstCode.match(/[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]+/)?.[0];
    assert.ok(recoveryCode, 'Recovery code should have a supported format');
    await page.locator('input[name=recoveryCodeInput]').fill(recoveryCode);
    const recoveredResponse = page.waitForResponse((response) => response.url().endsWith('/v1/session') && response.request().method() === 'POST');
    await page.locator('input[name=login]').click();
    const recovered = await recoveredResponse;
    assert.equal(recovered.status(), 200, 'A recovery code must restore access');
    assert.equal((await recovered.json()).id, account.id);
    await page.getByText(`Welcome, ${username}.`).waitFor();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('link', { name: 'Sign in', exact: true }).first().waitFor();
    await page.goto(`${site}/login/`);
    await page.locator('#kc-form-login').waitFor();
    await page.locator('input[name=username]').fill(username);
    await page.locator('input[name=password]').fill(password);
    await page.locator('#kc-login').click();
    await page.locator('input[name=otp]').waitFor();
    const nextPeriod = (setupCounter + 1) * 30_000 + 500 - Date.now();
    if (nextPeriod > 0) await new Promise((resolve) => setTimeout(resolve, nextPeriod));
    await page.locator('input[name=otp]').fill(codeFor(secret));
    const totpResponse = page.waitForResponse((response) => response.url().endsWith('/v1/session') && response.request().method() === 'POST');
    await page.locator('input[name=login]').click();
    const signedIn = await totpResponse;
    assert.equal(signedIn.status(), 200, 'A current TOTP must sign in');
    assert.equal((await signedIn.json()).id, account.id);
    const mainNavigations = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) mainNavigations.push(frame.url());
    });
    for (const app of ['ligo', 'fluo', 'rondo', 'regado']) {
      if (app === 'ligo') {
        await checkCachedPreview(page, () => page.goto(`${site}/${app}/`), `Welcome back, ${username}.`);
      } else {
        const appResponse = page.waitForResponse((response) =>
          response.url().endsWith('/v1/session') && response.request().method() === 'POST');
        await page.goto(`${site}/${app}/`);
        assert.equal((await appResponse).status(), 200);
      }
      if (app === 'fluo') {
        await page.getByRole('navigation', { name: 'Fluo navigation' }).waitFor();
      } else if (app === 'ligo') {
        await page.getByRole('heading', { name: 'Chats' }).waitFor();
      } else {
        await page.getByText(`Welcome, ${username}.`, { exact: false }).waitFor();
      }
      await checkAccessibility(page, `${app} account gate`);
      await page.setViewportSize({ width: 320, height: 768 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${app} must reflow at 320 CSS pixels`);
      await checkAccessibility(page, `${app} at 320px`);
      await page.setViewportSize({ width: 1280, height: 720 });
      if (app === 'ligo') {
        await page.getByRole('button', { name: 'Saved messages', exact: true }).first().click();
        await page.getByRole('heading', { name: 'Saved messages' }).waitFor();
        const messageText = `Ligo UI check ${randomBytes(3).toString('hex')}`;
        await page.getByRole('textbox', { name: 'Write a message' }).fill(messageText);
        await page.getByRole('button', { name: 'Send message' }).click();
        const bubble = page.getByLabel(`Message from ${username}`).filter({ hasText: messageText });
        await bubble.waitFor();
        await capture(page, 'ligo-chat');
        await checkAccessibility(page, 'Ligo saved conversation');
        await bubble.click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Heart' }).click();
        await page.getByRole('button', { name: /❤️ reaction, 1/ }).waitFor();
        await page.setViewportSize({ width: 320, height: 768 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          'Ligo message view must reflow at 320 CSS pixels');
        await checkAccessibility(page, 'Ligo saved conversation at 320px');
        await page.setViewportSize({ width: 1280, height: 720 });
        const conversationId = /^#c\/([0-9a-f-]{36})$/i.exec(new URL(page.url()).hash)?.[1];
        assert.ok(conversationId, 'Saved conversation must have a stable link');
        for (let index = 0; index < 36; index++) {
          const body = index % 3 === 0
            ? Array.from({ length: 16 }, (_, line) => `Scroll row ${index + 1}, line ${line + 1}`).join('\n')
            : index % 3 === 1 ? `Scroll row ${index + 1}: ${'different message heights '.repeat(8)}`
              : `Scroll row ${index + 1}`;
          const response = await fetch(`http://localhost:8081/v1/ligo/conversations/${conversationId}/messages`, {
            method: 'POST',
            headers: { Authorization: bearer, Origin: site, 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: randomUUID(), text: body, attachmentIds: [] })
          });
          assert.equal(response.status, 201, `Scrollable message ${index + 1} must be created`);
        }
        await page.reload();
        await page.getByRole('log', { name: 'Messages' }).waitFor({ state: 'visible' });
        const historyText = Array.from({ length: 72 }, (_, index) => `History line ${index + 1}`).join('\n');
        await page.getByRole('textbox', { name: 'Write a message' }).fill(historyText);
        await page.getByRole('button', { name: 'Send message' }).click();
        await page.getByLabel(`Message from ${username}`).filter({ hasText: 'History line 72' }).waitFor();
        const lastMessageText = `Ligo media scroll check ${randomBytes(3).toString('hex')}`;
        const ligoImage = await page.evaluate(() => {
          const canvas = document.createElement('canvas');
          canvas.width = 128;
          canvas.height = 96;
          canvas.getContext('2d').fillRect(0, 0, 128, 96);
          return canvas.toDataURL('image/png').split(',')[1];
        });
        await page.getByLabel('Choose files').setInputFiles({
          name: 'ligo-scroll.png', mimeType: 'image/png', buffer: Buffer.from(ligoImage, 'base64')
        });
        await page.getByRole('textbox', { name: 'Write a message' }).fill(lastMessageText);
        await page.getByRole('button', { name: 'Send message' }).click();
        const lastBubble = page.getByLabel(`Message from ${username}`).filter({ hasText: lastMessageText });
        await lastBubble.locator('img').waitFor();
        await page.reload();
        const messageLog = page.getByRole('log', { name: 'Messages' });
        await messageLog.waitFor({ state: 'visible' });
        assert.equal(await messageLog.evaluate((element) => getComputedStyle(element).overscrollBehaviorY),
          'contain', 'Native boundary bounce must remain enabled inside the chat');
        const chatPosition = async () => messageLog.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const last = element.querySelector('[data-index]:last-child');
          return {
            distance: element.scrollHeight - element.clientHeight - element.scrollTop,
            scrollTop: element.scrollTop,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
            rows: element.querySelectorAll('[data-index]').length,
            lastBottom: last?.getBoundingClientRect().bottom ?? 0,
            viewportBottom: rect.bottom
          };
        });
        const initialPosition = await chatPosition();
        assert.ok(initialPosition.distance >= -1 && initialPosition.distance <= 2,
          `Ligo must open at the exact bottom, got ${JSON.stringify(initialPosition)}`);
        assert.ok(initialPosition.lastBottom <= initialPosition.viewportBottom + 1,
          'The latest media message must be fully inside the message viewport');
        await lastBubble.locator('img').evaluate((image) => image.decode());
        await page.waitForTimeout(250);
        const settledPosition = await chatPosition();
        assert.ok(settledPosition.distance >= -1 && settledPosition.distance <= 2,
          `Media loading must not move the chat away from the bottom: ${JSON.stringify(settledPosition)}`);
        await lastBubble.evaluate((element) => {
          const probe = document.createElement('div');
          probe.dataset.scrollResizeProbe = '';
          probe.style.height = '96px';
          element.append(probe);
        });
        await page.waitForTimeout(100);
        const grownPosition = await chatPosition();
        assert.ok(grownPosition.distance >= -1 && grownPosition.distance <= 2,
          `A growing media message must keep the bottom anchor: ${JSON.stringify(grownPosition)}`);
        await lastBubble.locator('[data-scroll-resize-probe]').evaluate((element) => element.remove());
        await page.waitForTimeout(100);
        const shrunkPosition = await chatPosition();
        assert.ok(shrunkPosition.distance >= -1 && shrunkPosition.distance <= 2,
          `A shrinking media message must keep the bottom anchor: ${JSON.stringify(shrunkPosition)}`);
        const messageDraft = page.getByRole('textbox', { name: 'Write a message' });
        await messageDraft.fill('Growing composer\n'.repeat(8));
        await page.waitForTimeout(100);
        const composerPosition = await chatPosition();
        assert.ok(composerPosition.distance >= -1 && composerPosition.distance <= 2,
          `Growing the composer must keep the newest message visible: ${JSON.stringify(composerPosition)}`);
        await messageDraft.fill('');
        await page.waitForTimeout(100);
        const clearedComposerPosition = await chatPosition();
        assert.ok(clearedComposerPosition.distance >= -1 && clearedComposerPosition.distance <= 2,
          `Shrinking the composer must keep the bottom anchor: ${JSON.stringify(clearedComposerPosition)}`);
        await messageLog.evaluate((element) => { element.scrollTop = 160; });
        await page.waitForTimeout(50);
        const readingOffset = await messageLog.evaluate((element) => element.scrollTop);
        await messageDraft.fill('Growing composer\n'.repeat(8));
        await page.waitForTimeout(100);
        const resizedReadingOffset = await messageLog.evaluate((element) => element.scrollTop);
        assert.ok(Math.abs(resizedReadingOffset - readingOffset) <= 2,
          `Composer resizing must preserve the reading position (${readingOffset} → ${resizedReadingOffset})`);
        await messageDraft.fill('');
        await messageLog.evaluate((element) => { element.scrollTop = 0; });
        const firstLoadedRow = await messageLog.locator('[data-index="0"]').elementHandle();
        assert.ok(firstLoadedRow, 'A message must be available for the history anchor check');
        const anchorBefore = await firstLoadedRow.evaluate((element) => element.getBoundingClientRect().top);
        await page.getByRole('button', { name: 'Load older messages' }).waitFor({ state: 'detached' });
        const anchorAfter = await firstLoadedRow.evaluate((element) => element.getBoundingClientRect().top);
        assert.ok(Math.abs(anchorAfter - anchorBefore) <= 2,
          `Loading older messages must retain the visible row (${anchorBefore} → ${anchorAfter})`);
        await messageLog.evaluate((element) => { element.scrollTop = 0; });
        await page.mouse.move(900, 300);
        const topPosition = await messageLog.evaluate((element) => element.scrollTop);
        assert.ok(topPosition <= 2, `Ligo must reach the first message before the fast-scroll test (${topPosition})`);
        await page.mouse.wheel(0, 12_000);
        await page.waitForTimeout(1000);
        const fastScrollPosition = await chatPosition();
        assert.ok(fastScrollPosition.distance >= -1 && fastScrollPosition.distance <= 2,
          `Fast scrolling must reach and stay at the bottom: ${JSON.stringify(fastScrollPosition)}`);
        await page.mouse.wheel(0, 4000);
        await page.waitForTimeout(1000);
        const overscrollPosition = await chatPosition();
        assert.ok(overscrollPosition.distance >= -1 && overscrollPosition.distance <= 2,
          `Overscrolling must not move the chat upward: ${JSON.stringify(overscrollPosition)}`);
        await page.mouse.wheel(0, 4000);
        await page.mouse.wheel(0, -1200);
        await page.waitForTimeout(1000);
        const readingPosition = await chatPosition();
        assert.ok(readingPosition.distance > 50,
          `Scrolling upward must cancel end pinning: ${JSON.stringify(readingPosition)}`);
        await messageLog.evaluate((element) => { element.scrollTop = 0; });
        await page.mouse.wheel(0, 12_000);
        await page.waitForTimeout(1000);
        const secondFastScrollPosition = await chatPosition();
        assert.ok(secondFastScrollPosition.distance >= -1 && secondFastScrollPosition.distance <= 2,
          `A second fast scroll must also remain at the bottom: ${JSON.stringify(secondFastScrollPosition)}`);
      }
      assert.equal(await page.getByRole('link', { name: 'Sign in' }).count(), 0);
    }
    await page.goto(`${site}/fluo/`);
    const fluoNav = page.getByRole('navigation', { name: 'Fluo navigation' });
    await fluoNav.waitFor();
    for (const item of ['Feed', 'Search', 'Notifications', 'Saved', 'Profile', 'Settings']) {
      await fluoNav.getByRole('button', { name: item, exact: true }).waitFor();
    }
    assert.equal(await page.getByRole('button', { name: 'My posts', exact: true }).count(), 0,
      'Own posts must be available from the profile, not as a feed tab');
    assert.equal(await page.getByRole('dialog', { name: 'Create a post' }).count(), 0,
      'The feed must stay visible until the Post action opens its dialog');
    const openComposer = async () => {
      await page.getByRole('button', { name: 'Post', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Create a post' });
      await dialog.locator('[contenteditable=true]').waitFor();
      return dialog;
    };
    const composer = await openComposer();
    assert.equal(await composer.getByRole('button', { name: 'Bold' }).count(), 0,
      'Formatting controls must stay closed until requested');
    await composer.getByRole('button', { name: 'Post options' }).click();
    await composer.getByRole('combobox', { name: 'Post visibility' }).selectOption('private');
    await composer.getByRole('combobox', { name: 'Post visibility' }).selectOption('public');
    await composer.getByRole('button', { name: 'Close post options' }).click();
    const postText = `Fluo image test ${randomBytes(4).toString('hex')}`;
    await composer.locator('[contenteditable=true]').fill(postText);
    assert.equal(await composer.getByRole('combobox', { name: 'Post visibility' }).count(), 0,
      'Typing must not reopen the optional post settings');
    const imageBase64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 6;
      canvas.getContext('2d').fillRect(0, 0, 8, 6);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await composer.getByLabel('Choose photos or videos').setInputFiles(
      Array.from({ length: 4 }, (_, index) => ({
        name: `fluo-test-${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(imageBase64, 'base64')
      }))
    );
    const attachments = composer.getByRole('list', { name: 'Attachments' });
    assert.equal(await attachments.locator('li').count(), 4);
    await attachments.getByRole('button', { name: 'Remove fluo-test-4.png' }).click();
    assert.equal(await attachments.locator('li').count(), 3);
    await composer.getByLabel('Choose photos or videos').setInputFiles({
      name: 'fluo-test-4.png', mimeType: 'image/png', buffer: Buffer.from(imageBase64, 'base64')
    });
    assert.equal(await attachments.locator('li').count(), 4);
    await attachments.locator('li').first().getByText('Add description').click();
    await attachments.getByLabel('Description for fluo-test-1.png').fill('A solid black test image');
    await capture(page, 'fluo-composer');
    await page.setViewportSize({ width: 320, height: 768 });
    assert.ok(await composer.evaluate((dialog) => {
      const scroller = dialog.querySelector('.kaordo-scrollbar');
      return scroller && scroller.scrollWidth <= scroller.clientWidth;
    }),
      'The composer with four attachments must not overflow at 320 CSS pixels');
    const compactActions = await composer.evaluate((dialog) => {
      const media = dialog.querySelector('button[aria-label="Add media"]');
      const options = dialog.querySelector('button[aria-label="Post options"]');
      const publish = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Publish');
      return media && options && publish && {
        mediaTop: media.getBoundingClientRect().top,
        optionsTop: options.getBoundingClientRect().top,
        publishTop: publish.getBoundingClientRect().top
      };
    });
    assert.ok(compactActions && Math.abs(compactActions.mediaTop - compactActions.publishTop) < 2 &&
      Math.abs(compactActions.optionsTop - compactActions.publishTop) < 2,
      'Media, options and publish must remain in one reachable footer row at 320px');
    await checkAccessibility(page, 'Fluo composer at 320px');
    await capture(page, 'fluo-composer-mobile');
    await page.setViewportSize({ width: 1280, height: 720 });
    const createdPost = page.waitForResponse((response) => response.url().endsWith('/v1/fluo/posts') && response.request().method() === 'POST');
    await composer.getByRole('button', { name: 'Publish' }).click();
    const postResponse = await createdPost;
    assert.equal(postResponse.status(), 201, 'Fluo must publish the post with an image');
    const post = await postResponse.json();
    await composer.waitFor({ state: 'detached' });
    assert.equal(post.media.length, 4);
    for (const item of post.media) {
      assert.equal(item.width, 8);
      assert.equal(item.height, 6);
    }
    assert.equal(post.media[0].altText, 'A solid black test image',
      'Image descriptions must be stored with the post attachment');
    const card = page.locator(`article[data-post-id="${post.id}"]`);
    await card.waitFor();
    await capture(page, 'fluo-before-carousel');
    const carousel = card.getByRole('region', { name: 'Post media' });
    const reservedSize = await carousel.locator(':scope > div').first().evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
    assert.ok(Math.abs(reservedSize.height - reservedSize.width * 6 / 8) < 4,
      'Stored media dimensions must reserve carousel height before decoding');
    assert.equal(await carousel.getByRole('button', { name: 'Previous attachment' }).count(), 0,
      'The carousel must not render a previous arrow at its first item');
    assert.equal(await carousel.getByRole('button', { name: 'Next attachment' }).count(), 1);
    const nextArrow = carousel.getByRole('button', { name: 'Next attachment' });
    await nextArrow.scrollIntoViewIfNeeded();
    const viewportBox = await carousel.locator(':scope > div').first().boundingBox();
    const nextArrowBox = await nextArrow.boundingBox();
    assert.ok(viewportBox && nextArrowBox && nextArrowBox.x + nextArrowBox.width / 2 > viewportBox.x + viewportBox.width / 2,
      'The sole next arrow must stay on the right side at the first slide');
    const nextArrowReceivesPointer = await nextArrow.evaluate((button) => {
      const box = button.getBoundingClientRect();
      const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return button.contains(target);
    });
    assert.equal(nextArrowReceivesPointer, true, 'The next arrow must receive pointer input over the media');
    await nextArrow.click();
    await card.getByText('2 / 4').waitFor();
    assert.equal(await carousel.getByRole('button', { name: 'Previous attachment' }).count(), 1);
    await carousel.getByRole('button', { name: 'Previous attachment' }).click();
    await card.getByText('1 / 4').waitFor();
    await carousel.getByRole('button', { name: 'Next attachment' }).focus();
    await page.keyboard.press('Enter');
    await card.getByText('2 / 4').waitFor();
    await carousel.getByRole('button', { name: 'Next attachment' }).click();
    await card.getByText('3 / 4').waitFor();
    await carousel.getByRole('button', { name: 'Next attachment' }).click();
    await card.getByText('4 / 4').waitFor();
    assert.equal(await carousel.getByRole('button', { name: 'Next attachment' }).count(), 0,
      'The carousel must not render a next arrow at its last item');
    assert.equal(await carousel.getByRole('button', { name: 'Previous attachment' }).count(), 1);
    const previousArrow = carousel.getByRole('button', { name: 'Previous attachment' });
    await previousArrow.scrollIntoViewIfNeeded();
    const previousArrowBox = await previousArrow.boundingBox();
    assert.ok(viewportBox && previousArrowBox && previousArrowBox.x + previousArrowBox.width / 2 < viewportBox.x + viewportBox.width / 2,
      'The sole previous arrow must stay on the left side at the last slide');
    assert.equal(await previousArrow.evaluate((button) => {
      const box = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }), true, 'The previous arrow must receive pointer input over the media');
    await previousArrow.click();
    await card.getByText('3 / 4').waitFor();
    assert.equal(await carousel.getByRole('button', { name: 'Next attachment' }).count(), 1,
      'The next arrow must return when leaving the last item');
    const portraitBase64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 6;
      canvas.height = 12;
      canvas.getContext('2d').fillRect(0, 0, 6, 12);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const twoPhotoComposer = await openComposer();
    await twoPhotoComposer.locator('[contenteditable=true]').fill(`Two-photo carousel ${randomBytes(4).toString('hex')}`);
    await twoPhotoComposer.getByLabel('Choose photos or videos').setInputFiles(
      [1, 2].map((index) => ({
        name: `two-photo-${index}.png`, mimeType: 'image/png', buffer: Buffer.from(portraitBase64, 'base64')
      }))
    );
    const twoPhotoResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/v1/fluo/posts') && response.request().method() === 'POST');
    await twoPhotoComposer.getByRole('button', { name: 'Publish' }).click();
    const twoPhotoResponse = await twoPhotoResponsePromise;
    assert.equal(twoPhotoResponse.status(), 201);
    const twoPhotoPost = await twoPhotoResponse.json();
    await twoPhotoComposer.waitFor({ state: 'detached' });

    let videoPostId;
    const videoDirectory = await mkdtemp(join(tmpdir(), 'kaordo-fluo-video-'));
    try {
      const videoPath = join(videoDirectory, 'preview.mp4');
      await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=12', '-t', '1', '-an',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath
      ]);
      const videoText = `Fluo video preview test ${randomBytes(4).toString('hex')}`;
      const videoComposer = await openComposer();
      await videoComposer.locator('[contenteditable=true]').fill(videoText);
      await videoComposer.getByLabel('Choose photos or videos').setInputFiles({
        name: 'fluo-test.mp4', mimeType: 'video/mp4', buffer: await readFile(videoPath)
      });
      const videoPostResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith('/v1/fluo/posts') && response.request().method() === 'POST');
      await videoComposer.getByRole('button', { name: 'Publish' }).click();
      const videoPostResponse = await videoPostResponsePromise;
      assert.equal(videoPostResponse.status(), 201, 'Fluo must publish a video attachment');
      const videoPost = await videoPostResponse.json();
      await videoComposer.waitFor({ state: 'detached' });
      videoPostId = videoPost.id;
      assert.equal(videoPost.media[0].kind, 'video');
      assert.equal(videoPost.media[0].width, 320);
      assert.equal(videoPost.media[0].height, 180);
      const videoCard = page.locator(`article[data-post-id="${videoPost.id}"]`);
      const videoPlayer = videoCard.locator('media-player[data-testid="fluo-video-player"]');
      await videoPlayer.waitFor();
      const video = videoPlayer.locator('video');
      await page.waitForFunction((postId) => {
        const element = document.querySelector(`article[data-post-id="${postId}"] media-player video`);
        return element instanceof HTMLVideoElement && element.videoWidth === 320 && element.videoHeight === 180 &&
          element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && element.paused;
      }, videoPost.id, { timeout: 20_000 });
      const previewState = await video.evaluate((element) => ({
        paused: element.paused,
        readyState: element.readyState,
        poster: element.poster
      }));
      assert.equal(previewState.paused, true, 'The first-frame video preview must not start playback');
      assert.ok(previewState.readyState >= 2, 'The browser must decode a preview frame before playback');
      assert.equal(previewState.poster, '', 'The preview must use the video frame instead of a generated poster');
    } finally {
      await rm(videoDirectory, { recursive: true, force: true });
    }

    await card.getByRole('button', { name: 'Save post' }).click();
    await card.getByRole('button', { name: 'Remove from saved posts' }).waitFor();
    await fluoNav.getByRole('button', { name: 'Saved', exact: true }).click();
    await card.waitFor();
    await fluoNav.getByRole('button', { name: 'Profile', exact: true }).click();
    await card.waitFor();
    await fluoNav.getByRole('button', { name: 'Search', exact: true }).click();
    const search = page.getByRole('searchbox', { name: 'Search posts' });
    await search.fill(postText);
    await card.waitFor();
    await fluoNav.getByRole('button', { name: 'Feed', exact: true }).click();
    await card.waitFor();
    await page.waitForFunction((text) => {
      const article = [...document.querySelectorAll('article')].find((item) => item.textContent.includes(text));
      const image = article?.querySelector('img');
      return image?.complete && image.naturalWidth === 8;
    }, postText);
    await card.getByRole('button', { name: 'Like, 0', exact: true }).click();
    await card.getByRole('button', { name: 'Like, 1', exact: true }).waitFor();
    await card.getByRole('button', { name: 'Like, 1', exact: true }).hover();
    await page.waitForFunction((postId) => {
      const dislike = document.querySelector(`article[data-post-id="${postId}"] [aria-label="Dislike, 0"]`);
      return dislike && Number(getComputedStyle(dislike).opacity) > 0.5;
    }, post.id, { timeout: 2_000 });
    await page.mouse.move(0, 0);
    await card.getByRole('button', { name: 'Like, 1', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Dislike, 0',
      'Keyboard focus must reach the dislike action after Like');
    const replyText = `Reply ${randomBytes(3).toString('hex')}`;
    await card.getByRole('button', { name: 'Reply to post' }).click();
    const replyComposer = page.getByRole('dialog', { name: 'Reply to post' });
    const replyEditor = replyComposer.locator('[contenteditable=true]');
    await replyEditor.waitFor();
    const replyContext = replyComposer.getByRole('region', { name: 'Post being replied to' });
    assert.equal(await replyContext.locator('img').count(), 4,
      'Reply composition must show the original post and its media');
    const replyContextBox = await replyContext.boundingBox();
    const replyEditorBox = await replyEditor.boundingBox();
    assert.ok(replyContextBox && replyEditorBox && replyContextBox.y + replyContextBox.height <= replyEditorBox.y + 1,
      'A reply must be written below the original post');
    assert.equal(await replyComposer.getByLabel('Choose photos or videos').count(), 1,
      'Replies must have the same media upload tool as posts');
    await replyComposer.getByRole('button', { name: 'Post options' }).click();
    assert.equal(await replyComposer.getByRole('button', { name: 'Bold' }).count(), 1,
      'Replies must have the same optional formatting tools as posts');
    assert.equal(await replyComposer.getByRole('combobox', { name: 'Post visibility' }).isDisabled(), true,
      'Replies must inherit the original post visibility');
    await replyComposer.getByRole('button', { name: 'Close post options' }).click();
    await replyEditor.fill(replyText);
    const replyResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/v1/fluo/posts') && response.request().method() === 'POST');
    await replyComposer.getByRole('button', { name: 'Reply', exact: true }).click();
    const replyResponse = await replyResponsePromise;
    assert.equal(replyResponse.status(), 201);
    assert.equal((await replyResponse.json()).parentId, post.id,
      'The modal must publish a reply linked to its parent post');
    await replyComposer.waitFor({ state: 'detached' });
    await card.getByRole('button', { name: 'View 1 reply' }).click();
    const comments = card.getByRole('region', { name: 'Replies' });
    await comments.getByText(replyText).waitFor();
    if (process.env.KAORDO_UI_SNAPSHOTS === '1') {
      await page.screenshot({ path: join(tmpdir(), 'kaordo-ui-fluo-comments.png') });
    }
    const quoteText = `Quote ${randomBytes(3).toString('hex')}`;
    await card.getByRole('button', { name: 'Quote post' }).click();
    const quoteComposer = page.getByRole('dialog', { name: 'Quote post' });
    const quotedContext = quoteComposer.getByRole('region', { name: 'Quoted post' });
    await quoteComposer.locator('[contenteditable=true]').waitFor();
    const quoteEditorBox = await quoteComposer.locator('[contenteditable=true]').boundingBox();
    const quotedContextBox = await quotedContext.boundingBox();
    assert.ok(quoteEditorBox && quotedContextBox && quoteEditorBox.y + quoteEditorBox.height <= quotedContextBox.y + 1,
      'A quote must be written above the quoted post');
    await quoteComposer.locator('[contenteditable=true]').fill(quoteText);
    const quoteResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/v1/fluo/posts') && response.request().method() === 'POST');
    await quoteComposer.getByRole('button', { name: 'Publish' }).click();
    const quoteResponse = await quoteResponsePromise;
    assert.equal(quoteResponse.status(), 201);
    const quotedPost = await quoteResponse.json();
    await quoteComposer.waitFor({ state: 'detached' });
    assert.equal(quotedPost.quote?.id, post.id,
      `The new post must reference the quoted post: ${JSON.stringify({ quoteId: quotedPost.quoteId, quote: quotedPost.quote, source: post.id })}`);
    assert.equal(quotedPost.quote.media.length, 4, 'A quoted post must include its original media');
    assert.equal(quotedPost.quote.media[0].altText, 'A solid black test image',
      'Quoted media must retain the original accessible description');
    assert.ok(quotedPost.quote.media.every((item) => item.url.startsWith('http')),
      'Quoted media must have signed URLs');
    const quoteCard = page.locator(`article[data-post-id="${quotedPost.id}"]`);
    await quoteCard.waitFor();
    const quotePreview = quoteCard.getByRole('button', { name: `Open quoted post by ${username}` });
    assert.equal(await quotePreview.locator('img').count(), 4);
    await quotePreview.scrollIntoViewIfNeeded();
    const feedCardWidth = (await quoteCard.boundingBox()).width;
    await quotePreview.click();
    const feedScroll = await page.evaluate(() => window.scrollY);
    const postDialog = page.getByRole('dialog', { name: 'Post', exact: true });
    await postDialog.locator(`article[data-post-id="${post.id}"]`).waitFor();
    await postDialog.evaluate((dialog) => Promise.all(dialog.getAnimations().map((animation) => animation.finished)));
    const detailLayout = await postDialog.evaluate((dialog) => {
      const scroller = dialog.querySelector('.post-detail-scroll');
      const post = dialog.querySelector('article');
      const gallery = post?.querySelector('[aria-label="Post media"]');
      const dialogRect = dialog.getBoundingClientRect();
      const scrollRect = scroller?.getBoundingClientRect();
      return {
        dialogWidth: dialogRect.width,
        postWidth: post?.getBoundingClientRect().width,
        postRight: post?.getBoundingClientRect().right,
        galleryRight: gallery?.getBoundingClientRect().right,
        dialogRight: dialogRect.right,
        overflow: scroller?.scrollWidth - scroller?.clientWidth,
        scrollbarWidth: getComputedStyle(scroller).scrollbarWidth,
        scrollbarInset: scrollRect && Math.min(
          scrollRect.top - dialogRect.top, dialogRect.right - scrollRect.right,
          dialogRect.bottom - scrollRect.bottom
        ),
        clipped: getComputedStyle(dialog).overflow === 'hidden'
      };
    });
    assert.ok(detailLayout.postWidth > feedCardWidth + 100,
      'The quoted post must be noticeably wider than a feed card');
    assert.ok(detailLayout.overflow <= 1 && detailLayout.postRight <= detailLayout.dialogRight + 1 &&
      detailLayout.galleryRight <= detailLayout.postRight + 1,
      'A multi-media post must fit the detail dialog without horizontal scrolling');
    assert.equal(detailLayout.scrollbarWidth, 'thin', 'The post dialog must use a compact vertical scrollbar');
    assert.ok(detailLayout.clipped && detailLayout.scrollbarInset >= 7,
      'The scrollbar must sit inside the rounded, clipped dialog edge');
    await postDialog.getByRole('button', { name: 'Delete post' }).click();
    const nestedDeleteDialog = page.getByRole('dialog', { name: 'Delete post?' });
    await nestedDeleteDialog.waitFor();
    await nestedDeleteDialog.getByRole('button', { name: 'Cancel' }).click();
    await nestedDeleteDialog.waitFor({ state: 'hidden' });
    assert.equal(await postDialog.isVisible(), true,
      'Canceling deletion from post detail must return to the same post');
    assert.equal(new URL(page.url()).hash, `#post/${post.id}`);
    const scrollBeforeBack = await page.evaluate(() => window.scrollY);
    await page.goBack();
    await postDialog.waitFor({ state: 'hidden' });
    await quotePreview.waitFor();
    await page.waitForFunction((target) => Math.abs(window.scrollY - target) < 3, feedScroll);
    const scrollAfterBack = await page.evaluate(() => window.scrollY);
    assert.ok(Math.abs(scrollAfterBack - feedScroll) < 3,
      `Returning from a quoted post must preserve the feed position: before ${feedScroll}, in dialog ${scrollBeforeBack}, after ${scrollAfterBack}`);
    await quotePreview.click();
    await postDialog.locator(`article[data-post-id="${post.id}"]`).waitFor();
    await postDialog.getByRole('button', { name: 'Back', exact: true }).click();
    await postDialog.waitFor({ state: 'hidden' });
    await page.waitForFunction((target) => Math.abs(window.scrollY - target) < 3, feedScroll);
    assert.ok(Math.abs((await page.evaluate(() => window.scrollY)) - feedScroll) < 3,
      'The in-app Back action must also preserve the feed position');
    await quotePreview.click();
    await postDialog.locator(`article[data-post-id="${post.id}"]`).waitFor();
    await postDialog.getByRole('button', { name: 'Reply to post' }).click();
    const detailReplyComposer = page.getByRole('dialog', { name: 'Reply to post' });
    await detailReplyComposer.locator('[contenteditable=true]').waitFor();
    assert.equal(await detailReplyComposer.getByRole('region', { name: 'Post being replied to' }).count(), 1,
      'Replying from a post detail must use the same contextual composer');
    await page.keyboard.press('Escape');
    await detailReplyComposer.waitFor({ state: 'hidden' });
    assert.equal(new URL(page.url()).hash, '#feed');
    await quotePreview.click();
    await postDialog.locator(`article[data-post-id="${post.id}"]`).waitFor();
    await page.reload();
    await postDialog.locator(`article[data-post-id="${post.id}"]`).waitFor();
    await page.keyboard.press('Escape');
    await postDialog.waitFor({ state: 'hidden' });
    assert.equal(new URL(page.url()).hash, '#feed',
      'Escape after a reload must clear the post URL together with the dialog');
    await quotePreview.scrollIntoViewIfNeeded();
    await quotePreview.click();
    await postDialog.locator(`article[data-post-id="${post.id}"]`).waitFor();
    await page.keyboard.press('Escape');
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));
    assert.equal(await postDialog.isVisible(), false,
      'Escape after reopening the post must leave the dialog closed');
    assert.equal(new URL(page.url()).hash, '#feed',
      'Escape after reopening the post must return to the feed URL');
    await page.reload();
    await quotePreview.scrollIntoViewIfNeeded();
    assert.equal(new URL(page.url()).hash, '#feed',
      'A closed post must stay closed after another reload');
    await page.evaluate((id) => window.history.replaceState(window.history.state, '', `#post/${id}`), post.id);
    await quotePreview.click();
    await postDialog.locator(`article[data-post-id="${post.id}"]`).waitFor();
    await page.keyboard.press('Escape');
    await postDialog.waitFor({ state: 'hidden' });
    assert.equal(new URL(page.url()).hash, '#feed',
      'A stale post URL must not prevent the same quote from reopening');
    await capture(page, 'fluo');
    await checkAccessibility(page, 'Fluo feed with media, reply and quote');
    for (const item of post.media) {
      assert.equal((await fetch(item.url)).status, 200, 'published media must be available with its signed URL');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await fluoNav.getByRole('button', { name: 'Feed', exact: true }).waitFor();
    await quotePreview.scrollIntoViewIfNeeded();
    await quotePreview.click();
    await postDialog.locator(`article[data-post-id="${post.id}"]`).waitFor();
    const mobileDetail = await postDialog.evaluate((dialog) => {
      const scroller = dialog.querySelector('.post-detail-scroll');
      const post = dialog.querySelector('article');
      const gallery = post?.querySelector('[aria-label="Post media"]');
      return {
        overflow: scroller?.scrollWidth - scroller?.clientWidth,
        postRight: post?.getBoundingClientRect().right,
        galleryRight: gallery?.getBoundingClientRect().right,
        dialogRight: dialog.getBoundingClientRect().right
      };
    });
    assert.ok(mobileDetail.overflow <= 1 && mobileDetail.postRight <= mobileDetail.dialogRight + 1 &&
      mobileDetail.galleryRight <= mobileDetail.postRight + 1,
      'A multi-media post must also fit the mobile detail dialog');
    await postDialog.evaluate((dialog) => Promise.all(dialog.getAnimations().map((animation) => animation.finished)));
    assert.equal(await postDialog.count(), 1, 'Reopening a post must leave one detail dialog');
    await capture(page, 'fluo-detail-mobile');
    await postDialog.getByRole('button', { name: 'Back', exact: true }).click();
    await postDialog.waitFor({ state: 'hidden' });
    const mobilePostButton = await page.getByRole('button', { name: 'Post', exact: true }).boundingBox();
    const mobileNavigation = await fluoNav.boundingBox();
    assert.ok(mobilePostButton && mobileNavigation && mobilePostButton.x < 390 / 2 &&
      mobilePostButton.y >= mobileNavigation.y &&
      mobilePostButton.y + mobilePostButton.height <= mobileNavigation.y + mobileNavigation.height,
      'The Post action must occupy the lower-left mobile navigation cell without covering feed actions');
    await capture(page, 'fluo-mobile');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'Mobile layout must not overflow horizontally');
    await checkAccessibility(page, 'Fluo mobile feed');
    await page.setViewportSize({ width: 320, height: 768 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await capture(page, 'fluo-320');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'Fluo must reflow without horizontal overflow at 320 CSS pixels');
    const mobileNav = await page.getByRole('navigation', { name: 'Fluo navigation' }).boundingBox();
    assert.ok(mobileNav && Math.abs(mobileNav.y + mobileNav.height - 768) < 2,
      'Mobile navigation must remain fixed to the viewport bottom');
    await checkAccessibility(page, 'Fluo 320px reflow');
    for (const [item, title] of [
      ['Search', 'Search'], ['Notifications', 'Notifications'], ['Saved', 'Saved posts'],
      ['Profile', 'Profile'], ['Settings', 'Settings']
    ]) {
      if (item === 'Notifications' || item === 'Settings') {
        await fluoNav.getByRole('button', { name: 'More Fluo sections' }).click();
        await page.getByRole('menuitem', { name: item, exact: true }).click();
      } else {
        await fluoNav.getByRole('button', { name: item, exact: true }).click();
      }
      await page.getByRole('region', { name: title, exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${item} must reflow without horizontal overflow at 320 CSS pixels`);
      await checkAccessibility(page, `Fluo ${item} at 320px`);
    }
    await fluoNav.getByRole('button', { name: 'Feed', exact: true }).click();
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForTimeout(300);
    await checkAccessibility(page, 'Fluo dark theme at 320px');
    await capture(page, 'fluo-dark-320');
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.setViewportSize({ width: 1280, height: 720 });
    await fluoNav.getByRole('button', { name: 'Profile', exact: true }).click();
    await card.waitFor();
    await card.getByRole('button', { name: 'Delete post' }).click();
    const deleteDialog = page.getByRole('dialog', { name: 'Delete post?' });
    await deleteDialog.waitFor();
    await deleteDialog.evaluate((dialog) => Promise.all(dialog.getAnimations().map((animation) => animation.finished)));
    await checkAccessibility(page, 'Delete confirmation');
    assert.match(await deleteDialog.textContent(), /removes its replies and attachments/);
    await deleteDialog.getByRole('button', { name: 'Cancel' }).click();
    await deleteDialog.waitFor({ state: 'hidden' });
    await card.waitFor();
    await card.getByRole('button', { name: 'Delete post' }).click();
    const [deletedPost] = await Promise.all([
      page.waitForResponse((response) =>
        response.url().endsWith(`/v1/fluo/posts/${post.id}`) && response.request().method() === 'DELETE'),
      deleteDialog.getByRole('button', { name: 'Delete post' }).click()
    ]);
    assert.equal(deletedPost.status(), 204);
    const postBearer = (await postResponse.request().allHeaders()).authorization;
    assert.equal((await fetch(`http://localhost:8081/v1/fluo/posts/${post.id}`, {
      headers: { Authorization: postBearer }
    })).status, 404, 'the deleted post must be absent from Kerno');
    await card.waitFor({ state: 'detached' });
    assert.deepEqual(pageErrors, [], 'The Fluo feed must render without browser exceptions after deletion');
    for (const item of post.media) {
      assert.equal((await fetch(item.url)).status, 404,
        'deleting a post must purge its media, even while the former signed URL is valid');
    }
    await fluoNav.getByRole('button', { name: 'Feed', exact: true }).click();
    const twoPhotoCard = page.locator(`article[data-post-id="${twoPhotoPost.id}"]`);
    const twoPhotoCarousel = twoPhotoCard.getByRole('region', { name: 'Post media' });
    await twoPhotoCarousel.scrollIntoViewIfNeeded();
    const twoPhotoViewport = await twoPhotoCarousel.locator(':scope > div').first().boundingBox();
    const twoPhotoFrames = await twoPhotoCarousel.getByRole('group').all();
    assert.equal(twoPhotoFrames.length, 2);
    const firstPortrait = await twoPhotoFrames[0].boundingBox();
    const secondPortrait = await twoPhotoFrames[1].boundingBox();
    assert.ok(twoPhotoViewport && firstPortrait && secondPortrait &&
      firstPortrait.width < twoPhotoViewport.width * 0.55 &&
      secondPortrait.x + secondPortrait.width <= twoPhotoViewport.x + twoPhotoViewport.width + 1,
      'Two portrait photos must both fit the gallery without full-width placeholders');
    assert.equal(await twoPhotoCarousel.getByRole('button', { name: 'Previous attachment' }).count(), 0);
    assert.equal(await twoPhotoCarousel.getByRole('button', { name: 'Next attachment' }).count(), 0);
    await twoPhotoCard.getByText('1–2 / 2').waitFor();
    assert.equal(await twoPhotoCarousel.getByRole('link', { name: 'Open image 2 of 2' }).count(), 1,
      'The second visible portrait photo must remain accessible');
    const singlePhotoComposer = await openComposer();
    await singlePhotoComposer.locator('[contenteditable=true]')
      .fill(`Single-photo frame ${randomBytes(4).toString('hex')}`);
    await singlePhotoComposer.getByLabel('Choose photos or videos').setInputFiles({
      name: 'single-photo.png', mimeType: 'image/png', buffer: Buffer.from(imageBase64, 'base64')
    });
    const singlePhotoResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/v1/fluo/posts') && response.request().method() === 'POST');
    await singlePhotoComposer.getByRole('button', { name: 'Publish' }).click();
    const singlePhotoResponse = await singlePhotoResponsePromise;
    assert.equal(singlePhotoResponse.status(), 201);
    const singlePhotoPost = await singlePhotoResponse.json();
    await singlePhotoComposer.waitFor({ state: 'detached' });
    const singlePhotoCard = page.locator(`article[data-post-id="${singlePhotoPost.id}"]`);
    const singlePhotoGallery = singlePhotoCard.getByLabel('Post media attachments');
    await singlePhotoGallery.scrollIntoViewIfNeeded();
    const singlePhotoAlignment = await singlePhotoGallery.evaluate((element) => {
      const frame = element.firstElementChild;
      const image = frame?.querySelector('img');
      if (!frame || !image) return null;
      const frameBox = frame.getBoundingClientRect();
      const imageBox = image.getBoundingClientRect();
      return {
        border: getComputedStyle(frame).borderTopWidth,
        fit: getComputedStyle(image).objectFit,
        top: imageBox.top - frameBox.top,
        left: imageBox.left - frameBox.left,
        right: frameBox.right - imageBox.right,
        bottom: frameBox.bottom - imageBox.bottom
      };
    });
    assert.ok(singlePhotoAlignment && singlePhotoAlignment.border === '0px' &&
      singlePhotoAlignment.fit === 'cover' &&
      [singlePhotoAlignment.top, singlePhotoAlignment.left, singlePhotoAlignment.right, singlePhotoAlignment.bottom]
        .every((gap) => Math.abs(gap) < 1),
    `A single photo must meet its rounded frame without a visible inner gap: ${JSON.stringify(singlePhotoAlignment)}`);
    let releaseSinglePost = () => {};
    let reportSinglePostRequest;
    const singlePostRequested = new Promise((resolve) => { reportSinglePostRequest = resolve; });
    await page.route(`**/v1/fluo/posts/${singlePhotoPost.id}`, async (route) => {
      reportSinglePostRequest();
      await new Promise((resolve) => { releaseSinglePost = resolve; });
      await route.continue();
    });
    await page.evaluate((id) => { window.location.hash = `post/${id}`; }, singlePhotoPost.id);
    await singlePostRequested;
    await page.getByText('Opening post…').waitFor();
    assert.equal(await postDialog.isVisible(), false,
      'Post detail must not open at a temporary width while media metadata is loading');
    releaseSinglePost();
    await postDialog.locator(`article[data-post-id="${singlePhotoPost.id}"]`).waitFor();
    await page.unroute(`**/v1/fluo/posts/${singlePhotoPost.id}`);
    await postDialog.evaluate((dialog) => Promise.all(dialog.getAnimations().map((animation) => animation.finished)));
    const singlePhotoDetail = await postDialog.evaluate((dialog) => {
      const post = dialog.querySelector('article');
      const frame = post?.querySelector('[aria-label="Post media attachments"] > div');
      const postRect = post?.getBoundingClientRect();
      return {
        dialogWidth: dialog.getBoundingClientRect().width,
        emptyRight: postRect && frame
          ? postRect.right - parseFloat(getComputedStyle(post).paddingRight) - frame.getBoundingClientRect().right
          : null
      };
    });
    assert.ok(singlePhotoDetail.dialogWidth < detailLayout.dialogWidth - 80 &&
      singlePhotoDetail.emptyRight !== null && singlePhotoDetail.emptyRight <= 32,
      `A single photo must use a narrower dialog without a broad empty strip beside it: ${JSON.stringify({ singlePhotoDetail, multiPhotoWidth: detailLayout.dialogWidth })}`);
    await postDialog.getByRole('button', { name: 'Back', exact: true }).click();
    await postDialog.waitFor({ state: 'hidden' });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const overlappingRows = await page.locator('[data-index]').evaluateAll((elements) => {
      const rows = elements.filter((element) => element.querySelector('article[data-post-id]'))
        .map((element) => ({ index: Number(element.getAttribute('data-index')), box: element.getBoundingClientRect() }))
        .sort((left, right) => left.index - right.index);
      const overlaps = [];
      for (let index = 1; index < rows.length; index++) {
        if (rows[index].box.top < rows[index - 1].box.bottom - 1) {
          overlaps.push([rows[index - 1].index, rows[index].index]);
        }
      }
      return overlaps;
    });
    assert.deepEqual(overlappingRows, [], 'Virtualized post cards must not overlap after new media posts appear');
    const aspectImages = await page.evaluate(() => [[6, 12], [6, 12], [8, 80], [80, 8]].map(([width, height], index) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').fillRect(0, 0, width, height);
      return { name: `aspect-${index + 1}.png`, data: canvas.toDataURL('image/png').split(',')[1] };
    }));
    const aspectComposer = await openComposer();
    await aspectComposer.locator('[contenteditable=true]')
      .fill(`Aspect-ratio gallery ${randomBytes(4).toString('hex')}`);
    await aspectComposer.getByLabel('Choose photos or videos').setInputFiles(aspectImages.map((item) => ({
      name: item.name, mimeType: 'image/png', buffer: Buffer.from(item.data, 'base64')
    })));
    const aspectResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/v1/fluo/posts') && response.request().method() === 'POST');
    await aspectComposer.getByRole('button', { name: 'Publish' }).click();
    const aspectResponse = await aspectResponsePromise;
    assert.equal(aspectResponse.status(), 201);
    const aspectPost = await aspectResponse.json();
    await aspectComposer.waitFor({ state: 'detached' });
    const aspectCard = page.locator(`article[data-post-id="${aspectPost.id}"]`);
    const aspectCarousel = aspectCard.getByRole('region', { name: 'Post media' });
    await aspectCarousel.scrollIntoViewIfNeeded();
    const aspectViewport = await aspectCarousel.locator(':scope > div').first().boundingBox();
    const aspectFrames = await aspectCarousel.getByRole('group').all();
    assert.equal(aspectFrames.length, 4);
    const firstAspect = await aspectFrames[0].boundingBox();
    const secondAspect = await aspectFrames[1].boundingBox();
    assert.ok(aspectViewport && firstAspect && secondAspect &&
      firstAspect.width < aspectViewport.width * 0.4 &&
      secondAspect.x + secondAspect.width <= aspectViewport.x + aspectViewport.width + 1,
      'Multiple portrait photos must be visible together in the scrolling gallery');
    const topGap = await aspectCarousel.evaluate((element) => {
      const viewport = element.firstElementChild;
      const firstSlide = viewport?.querySelector('[role="group"]');
      return firstSlide && viewport ? firstSlide.getBoundingClientRect().top - viewport.getBoundingClientRect().top : null;
    });
    assert.ok(topGap !== null && Math.abs(topGap) < 2,
      `A regular photo must begin at the top of its gallery without an empty strip (gap ${topGap}px)`);
    const imageStyles = await Promise.all(aspectFrames.map((frame) => frame.locator('img').evaluate((element) => {
      const styles = getComputedStyle(element);
      return { fit: styles.objectFit, position: styles.objectPosition };
    })));
    assert.deepEqual(imageStyles.map((item) => item.fit), ['cover', 'cover', 'cover', 'cover'],
      'Photos must fill their frames without letterboxing');
    assert.ok(imageStyles.every((item) => item.position === '50% 50%'),
      'Cropped photos must show their center');
    assert.equal(await aspectFrames[2].getByRole('link').getAttribute('data-pswp-height'), '80',
      'The lightbox must retain the complete original tall photo');
    assert.equal(await aspectFrames[3].getByRole('link').getAttribute('data-pswp-width'), '80',
      'The lightbox must retain the complete original wide photo');
    assert.equal(await aspectFrames[2].getByRole('link').getAttribute('data-cropped'), 'true',
      'PhotoSwipe must animate from the cropped tall thumbnail correctly');
    assert.equal(await aspectFrames[3].getByRole('link').getAttribute('data-cropped'), 'true',
      'PhotoSwipe must animate from the cropped wide thumbnail correctly');
    const dragX = firstAspect.x + firstAspect.width / 2;
    const dragY = firstAspect.y + firstAspect.height / 2;
    await page.mouse.move(dragX, dragY);
    await page.mouse.down();
    await page.mouse.move(dragX - Math.min(180, aspectViewport.width / 3), dragY, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(({ id, previousX }) => {
      const slide = document.querySelector(`article[data-post-id="${id}"] [aria-label="Post media"] [role="group"]`);
      return slide && slide.getBoundingClientRect().x < previousX - 40;
    }, { id: aspectPost.id, previousX: firstAspect.x }, { timeout: 5_000 });
    assert.equal(await page.locator('.pswp--open').count(), 0,
      'Dragging the photo strip must not open the image lightbox');
    await aspectFrames[3].getByRole('link').click();
    await page.locator('.pswp--open').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.pswp--open img.pswp__img')]
      .some((image) => image.naturalWidth === 80 && image.naturalHeight === 8));
    await page.waitForFunction(() => window.pswp?.opener?.isOpen && !window.pswp.opener.isOpening);
    await page.locator('.pswp--open').getByRole('button', { name: 'Close' }).click();
    try {
      await page.locator('.pswp--open').waitFor({ state: 'detached', timeout: 2_000 });
    } catch {
      const viewerState = await page.evaluate((postId) => ({
        cardPresent: !!document.querySelector(`article[data-post-id="${postId}"]`),
        rootCount: document.querySelectorAll('.pswp--open').length,
        isOpen: window.pswp?.isOpen,
        isDestroying: window.pswp?.isDestroying
      }), aspectPost.id);
      assert.fail(`PhotoSwipe did not close: ${JSON.stringify(viewerState)}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'The responsive photo strip must not overflow the mobile viewport');
    await page.setViewportSize({ width: 1280, height: 720 });
    for (const id of [twoPhotoPost.id, singlePhotoPost.id, videoPostId, aspectPost.id]) {
      const response = await fetch(`http://localhost:8081/v1/fluo/posts/${id}`, {
        method: 'DELETE', headers: { Authorization: postBearer }
      });
      assert.equal(response.status, 204, 'temporary carousel and video posts must be removed after the test');
    }
    assert.ok(mainNavigations.every((url) => url.startsWith(site)), 'Silent SSO must not redirect the main frame to Keycloak between apps');
    const failAccount = async (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: '{"error":"Account service unavailable"}'
    });
    await page.route('**/v1/session', failAccount);
    try {
      await page.goto(`${site}/ligo/`);
      await page.getByRole('heading', { name: 'Account service unavailable' }).waitFor();
      assert.equal(await page.locator('[data-kaordo-preview]').count(), 0,
        'A cached display hint must not keep protected content visible after API failure');
    } finally {
      await page.unroute('**/v1/session', failAccount);
    }
    await page.goto(`${site}/`);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('link', { name: 'Sign in', exact: true }).first().waitFor();
    await page.goto(`${site}/login/`);
    await page.locator('#kc-form-login').waitFor();
    await page.locator('input[name=username]').fill(username);
    await page.locator('input[name=password]').fill(password);
    await page.locator('#kc-login').click();
    await page.getByRole('link', { name: 'Try Another Way' }).click();
    await page.getByRole('button', { name: /Recovery Authentication Code/ }).click();
    await page.locator('input[name=recoveryCodeInput]').fill(recoveryCode);
    await page.locator('input[name=login]').click();
    await page.locator('input[name=recoveryCodeInput]').waitFor();
    const errors = await page.locator('[role=alert], .alert-error, [id^=input-error]').allTextContents();
    assert.match(errors.join(' '), /invalid recovery authentication code/i, 'Recovery codes must be single-use');
  } catch (error) {
    console.error('Live flow failed before temporary-user cleanup:', error);
    throw error;
  } finally {
    await browser.close();
    await removeTemporaryUser(username);
  }
});
