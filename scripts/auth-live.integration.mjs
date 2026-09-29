import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseEnv, promisify } from 'node:util';
import test from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright-core';

const run = promisify(execFile);
const site = 'http://localhost:8765';
const identity = 'http://localhost:8080';
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function codeFor(secret) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', Buffer.from(secret, 'utf8')).update(counter).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function checkAccessibility(page, stage) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
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
      'exec', 'local-app-db-1', 'psql', '-U', 'kaordo', '-d', 'kaordo', '-tAc',
      `DELETE FROM users WHERE keycloak_sub = '${subject}' RETURNING id;`
    ]);
  }
}

test('registration, TOTP and recovery login, Kerno account, and app SSO', { timeout: 90_000 }, async () => {
  const username = `test_${randomBytes(6).toString('hex')}`;
  const password = `Qa!${randomBytes(18).toString('hex')}`;
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${site}/register/`);
    await page.getByRole('button', { name: /Continue to registration/ }).waitFor();
    await checkAccessibility(page, 'Portal registration entry');
    await focusByTab(page, 'button', 'Registration action');
    assert.match(await page.evaluate(() => document.activeElement?.textContent), /Continue to registration/);
    await page.keyboard.press('Enter');
    await page.locator('#kc-register-form').waitFor();
    await checkAccessibility(page, 'Keycloak registration');
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
    const cachedAccount = await page.evaluate(() => sessionStorage.getItem('kaordo:account-preview:v1'));
    assert.ok(cachedAccount, 'A verified account should be available for a display-only preview');
    assert.doesNotMatch(cachedAccount, /accessToken|refreshToken|Bearer /);
    await checkAccessibility(page, 'Connected portal');
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
    await page.getByRole('button', { name: /Continue to sign in/ }).click();
    await page.locator('#kc-form-login').waitFor();
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
    await page.getByRole('button', { name: /Continue to sign in/ }).click();
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
        await checkCachedPreview(page, () => page.goto(`${site}/${app}/`), `Welcome, ${username}.`);
      } else {
        const appResponse = page.waitForResponse((response) =>
          response.url().endsWith('/v1/session') && response.request().method() === 'POST');
        await page.goto(`${site}/${app}/`);
        assert.equal((await appResponse).status(), 200);
      }
      await page.getByText(`Welcome, ${username}.`, { exact: false }).waitFor();
      await checkAccessibility(page, `${app} account gate`);
      assert.equal(await page.getByRole('link', { name: 'Sign in' }).count(), 0);
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
    await page.getByRole('button', { name: /Continue to sign in/ }).click();
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
  } finally {
    await browser.close();
    await removeTemporaryUser(username);
  }
});
