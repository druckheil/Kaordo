// Exercises native identity forms, account bootstrap, media workflows, and cross-app sessions
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv, promisify } from 'node:util';
import { assertAccessible as checkAccessibility } from './ui-accessibility.mjs';
import { openPublishedPost } from './encryption-fixture.mjs';
import { test, expect } from '@playwright/test';

const run = promisify(execFile);
const site = 'http://localhost:8765';
const identity = 'http://localhost:8080';

test.afterEach(async ({ browser }) => {
  await Promise.all(browser.contexts().map((context) => context.close()));
});

async function identityContext(browser, options = {}) {
  const context = await browser.newContext({
    locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce', ...options,
  });
  context.setDefaultTimeout(10_000);
  context.setDefaultNavigationTimeout(15_000);
  return context;
}

async function checkSoundStorageFallback(page) {
  const errors = [];
  const rememberError = error => errors.push(error.message);
  page.on('pageerror', rememberError);
  await page.evaluate(() => {
    const persist = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'kaordo-rondo-sounds') throw new DOMException('Browser storage is unavailable', 'QuotaExceededError');
      return persist.call(this, key, value);
    };
    window.restoreSoundStorage = () => { Storage.prototype.setItem = persist; delete window.restoreSoundStorage; };
  });
  try {
    await page.getByRole('button', { name: 'Mute interface sounds', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Enable interface sounds', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Enable interface sounds', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mute interface sounds', exact: true })).toBeVisible();
    assert.deepEqual(errors, [], 'Live sound controls keep working when the browser cannot save a preference');
  } finally {
    await page.evaluate(() => window.restoreSoundStorage());
    page.off('pageerror', rememberError);
  }
}

function identityEntryURL() {
  const url = new URL(`${identity}/realms/kaordo/protocol/openid-connect/auth`);
  url.search = new URLSearchParams({
    client_id: 'kaordo-web', redirect_uri: `${site}/`, response_type: 'code', scope: 'openid',
    code_challenge: randomBytes(32).toString('base64url'), code_challenge_method: 'S256',
  });
  return url.href;
}

async function capture(page, name) {
  if (process.env.KAORDO_UI_SNAPSHOTS !== '1') return;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
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

async function waitForRestoredScroll(page, target) {
  const restored = (requestedScroll) => {
    return Math.abs(window.scrollY - requestedScroll) < window.innerHeight / 2;
  };
  try {
    await page.waitForFunction(restored, target, { timeout: 1_000 });
  } catch {
    const state = await page.evaluate((requestedScroll) => ({
      requestedScroll,
      actualScroll: window.scrollY,
      tolerance: window.innerHeight / 2
    }), target);
    assert.fail(`The feed must restore its scroll position within the available range: ${JSON.stringify(state)}`);
  }
}

function hasApiPath(url, path) {
  return new URL(url).pathname.replace(/\/+$/, '').endsWith(path);
}

function isApiResponse(response, path, method) {
  return hasApiPath(response.url(), path) && response.request().method() === method;
}

function isApiRequest(request, path, method) {
  return hasApiPath(request.url(), path) && request.method() === method;
}

// Cloned fetch bodies are streamed, so network events omit them; route interception still sees the bytes
const ciphertextBodies = new WeakMap();
async function recordCiphertextCommits(page) {
  await page.route('**/v1/crypto/records/commit', async (route) => {
    ciphertextBodies.set(route.request(), route.request().postDataJSON());
    await route.continue();
  });
}

async function inspectCiphertextCommit(response, purpose, expectedWrites) {
  assert.equal(response.status(), 200, `${purpose} must persist an atomic ciphertext transaction`);
  const input = ciphertextBodies.get(response.request());
  assert.ok(input, `${purpose} must send an observable ciphertext transaction`);
  assert.equal(input.writes.length, expectedWrites);
  assert.deepEqual(input.deletes, []);
  const result = await response.json();
  assert.equal(result.items.length, expectedWrites);
  for (const write of input.writes) {
    assert.match(write.tag, /^[0-9a-f]{64}$/);
    assert.equal(Buffer.from(write.nonce, 'base64').length, 12);
    assert.ok(Buffer.from(write.ciphertext, 'base64').length >= 16);
    assert.equal(result.items.find(item => item.tag === write.tag)?.revision, write.revision + 1,
      `${purpose} must preserve compare-and-swap revisions`);
  }
  return { input, result };
}

async function openPostFromCardGap(page, card, username, postText) {
  await card.scrollIntoViewIfNeeded();
  const textBox = await card.getByText(postText, { exact: true }).boundingBox();
  const galleryBox = await card.getByRole('region', { name: 'Post media' }).boundingBox();
  const cardBox = await card.boundingBox();
  assert.ok(textBox && galleryBox && cardBox && galleryBox.y > textBox.y + textBox.height,
    'A post with media must expose a clickable gap between its text and gallery');
  const point = { x: cardBox.x + cardBox.width / 2, y: textBox.y + textBox.height + (galleryBox.y - textBox.y - textBox.height) / 2 };
  const openLink = card.getByRole('link', { name: `Open post by @${username}` });
  const href = await openLink.getAttribute('href');
  assert.equal(await page.evaluate(({ x, y, target }) => document.elementFromPoint(x, y)?.closest('a')?.getAttribute('href') === target,
    { ...point, target: href }), true, 'The free gap must be handled by the post-opening link');
  await page.mouse.click(point.x, point.y);
}

async function checkCredentialInputs(page, form) {
  const formSelector = form === 'login' ? '#kc-form-login' : '#kc-register-form';
  const inputs = await page.locator(`${formSelector} input`).evaluateAll((elements) =>
    elements
      .filter((input) => ['username', 'password'].includes(input.name))
      .map((input) => ({
        name: input.name,
        type: input.type,
        autocomplete: input.autocomplete,
        required: input.required,
        label: [...(input.labels ?? [])].map((label) => label.textContent.trim()).join(' '),
        describedBy: input.getAttribute('aria-describedby'),
      }))
  );
  assert.deepEqual(inputs.map(({ name }) => name), ['username', 'password']);
  assert.ok(inputs.every(({ label }) => label), `${form} fields have associated visible labels`);
  assert.equal(inputs[0].type, 'text');
  assert.equal(inputs[0].autocomplete, 'username');
  assert.equal(inputs[1].type, 'password');
  assert.equal(inputs[1].autocomplete, form === 'login' ? 'current-password' : 'new-password');
  if (form !== 'login') assert.equal(inputs[1].required, true);
  return inputs;
}

async function checkCredentialErrorStyles(page) {
  await checkInvalidInputAppearance(page.locator('#kc-form-login [name="username"]'));
  const styles = await page.evaluate(() => {
    const username = document.querySelector('#kc-form-login [name="username"]');
    const password = document.querySelector('#kc-form-login [name="password"]');
    const group = password?.closest('.pf-c-input-group');
    const visibility = group?.querySelector('[data-password-toggle]');
    const error = document.querySelector('#kc-form-login .kc-feedback-text');
    const expectedError = document.createElement('span');
    expectedError.style.color = 'var(--destructive)';
    document.body.append(expectedError);
    const destructiveColor = getComputedStyle(expectedError).color;
    expectedError.remove();
    return {
      usernameInvalid: username?.getAttribute('aria-invalid'),
      usernameBackground: getComputedStyle(username).backgroundImage,
      passwordInvalid: password?.getAttribute('aria-invalid'),
      passwordBackground: getComputedStyle(password).backgroundImage,
      groupRadius: getComputedStyle(group).borderRadius,
      groupBorderWidth: getComputedStyle(group).borderTopWidth,
      buttonBorderTopWidth: getComputedStyle(visibility).borderTopWidth,
      buttonBorderLeftWidth: getComputedStyle(visibility).borderLeftWidth,
      destructiveColor,
      errorColor: getComputedStyle(error).color,
      errorText: error?.textContent.trim(),
    };
  });
  assert.equal(styles.usernameInvalid, 'true');
  assert.equal(styles.passwordInvalid, 'true');
  assert.equal(styles.usernameBackground, 'none', 'Invalid username has no repeating PatternFly icon');
  assert.equal(styles.passwordBackground, 'none', 'Invalid password has no repeating PatternFly icon');
  assert.equal(styles.groupRadius, '12px', 'Password and visibility button share a single rounded shell');
  assert.equal(styles.groupBorderWidth, '1px');
  assert.equal(styles.buttonBorderTopWidth, '0px', 'Visibility button has no second outer border');
  assert.equal(styles.buttonBorderLeftWidth, '0px', 'The ghost visibility control has no separate frame');
  assert.equal(styles.errorColor, styles.destructiveColor, 'Credential errors use the themed destructive color');
  assert.equal(styles.errorText, 'Invalid username or password.');
  await page.locator('#kc-form-login [name="password"]').focus();
  const innerField = await page.locator('#kc-form-login [name="password"]').evaluate((input) => {
    const style = getComputedStyle(input);
    return { outline: style.outlineStyle, shadow: style.boxShadow, widths: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth] };
  });
  assert.equal(innerField.outline, 'none', 'The password group owns its focus indicator');
  assert.equal(innerField.shadow, 'none', 'The inner password must not add a second error ring');
  assert.deepEqual(innerField.widths, ['0px', '0px', '0px', '0px']);
}

async function checkInvalidInputAppearance(input) {
  await input.blur();
  const unfocusedShadow = await input.evaluate(async (element) => {
    getComputedStyle(element).boxShadow;
    await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
    return getComputedStyle(element).boxShadow;
  });
  await input.focus();
  const style = await input.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      invalid: element.getAttribute('aria-invalid'),
      outline: computed.outlineStyle,
      shadow: computed.boxShadow,
      background: computed.backgroundImage,
      widths: [computed.borderTopWidth, computed.borderRightWidth, computed.borderBottomWidth, computed.borderLeftWidth],
    };
  });
  assert.equal(style.invalid, 'true', 'The server reports the field validation error');
  assert.equal(style.outline, 'solid', 'An invalid field retains a distinct keyboard focus outline');
  assert.equal(style.shadow, unfocusedShadow, 'Focusing an invalid field preserves its single error indicator');
  assert.equal(style.background, 'none', 'Validation must not paint a background icon over the text');
  assert.deepEqual(style.widths, ['1px', '1px', '1px', '1px'], 'Validation must not thicken the bottom border');
}

async function checkPasswordAppearance(page) {
  const toggle = page.locator('[data-password-toggle]');
  for (const state of ['idle', 'hover', 'keyboard']) {
    if (state === 'hover') await toggle.hover();
    if (state === 'keyboard') {
      await page.locator('#password').focus();
      await page.keyboard.press('Tab');
    }
    const appearance = await toggle.evaluate((button) => {
      const pseudo = getComputedStyle(button, '::after');
      return {
        after: pseudo.content,
        outline: getComputedStyle(button).outlineStyle,
        focused: document.activeElement === button && button.matches(':focus-visible'),
      };
    });
    assert.equal(appearance.after, 'none', `Password visibility has no inherited white border while ${state}`);
    assert.equal(appearance.outline, state === 'keyboard' ? 'solid' : 'none', `Password visibility has a distinct keyboard focus indicator while ${state}`);
    if (state === 'keyboard') assert.equal(appearance.focused, true, 'Visibility remains accessible with the keyboard');
  }
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
  const accountResponse = page.waitForResponse((response) => isApiResponse(response, '/v1/session', 'POST'));
  const accountRequest = page.waitForRequest((request) => isApiRequest(request, '/v1/session', 'POST'));
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

async function cleanupTemporaryUser(browser, username, { applicationData = true } = {}) {
  await Promise.all(browser.contexts().map((context) => context.close()));
  const headers = await administrator();
  const response = await fetch(`${identity}/admin/realms/kaordo/users?username=${encodeURIComponent(username)}&exact=true`, { headers });
  assert.equal(response.status, 200, 'Temporary identity lookup must succeed');
  const users = (await response.json()).filter((user) => user.username === username);
  for (const user of users) {
    const subject = user.id;
    assert.match(subject, /^[0-9a-f-]{36}$/i);
    const deletion = await fetch(`${identity}/admin/realms/kaordo/users/${subject}`, { method: 'DELETE', headers });
    assert.equal(deletion.status, 204, 'Temporary identity deletion must succeed');
    if (!applicationData) continue;
    await run('docker', [
      'exec', 'local-app-db-1', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'kaordo', '-d', 'kaordo', '-tAc',
      `BEGIN; DELETE FROM rondo_channels WHERE server_id IN (SELECT id FROM rondo_servers WHERE owner_id IN (SELECT id FROM users WHERE keycloak_sub = '${subject}')); DELETE FROM rondo_servers WHERE owner_id IN (SELECT id FROM users WHERE keycloak_sub = '${subject}'); DELETE FROM ligo_conversations WHERE created_by IN (SELECT id FROM users WHERE keycloak_sub = '${subject}'); DELETE FROM users WHERE keycloak_sub = '${subject}' RETURNING id; COMMIT;`
    ]);
  }
}

test('remembered OIDC sessions survive browser restart, rotate independently, and end on logout', async ({ browser }) => {
  const username = `test_sessions_${randomBytes(6).toString('hex')}`;
  const password = `Qa!${randomBytes(18).toString('hex')}`;
  const headers = await administrator();
  const tokenEndpoint = `${identity}/realms/kaordo/protocol/openid-connect/token`;
  const claims = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

  async function tokenRequest(parameters) {
    return fetch(tokenEndpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: 'kaordo-web', ...parameters }),
      signal: AbortSignal.timeout(10_000)
    });
  }

  async function authorize(context, app, interactive = false) {
    const page = await context.newPage();
    const verifier = randomBytes(32).toString('base64url');
    const state = randomUUID();
    const redirectUri = `${site}/${app}/`;
    const url = new URL(`${identity}/realms/kaordo/protocol/openid-connect/auth`);
    url.search = new URLSearchParams({
      client_id: 'kaordo-web', redirect_uri: redirectUri, response_type: 'code', scope: 'openid profile',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256', state, nonce: randomUUID()
    });
    await page.goto(url.href);
    if (interactive) {
      await page.locator('#kc-form-login').waitFor();
      const remembered = page.getByRole('checkbox', { name: 'Stay signed in' });
      assert.ok(await remembered.isChecked(), 'Persistent sign-in defaults on');
      await page.locator('[name=username]').fill(username);
      await page.locator('[name=password]').fill(password);
      await page.locator('#kc-login').click();
      await page.locator('[name=totpSecret]').waitFor({ state: 'attached' });
      const secret = await page.locator('[name=totpSecret]').inputValue();
      await page.locator('[name=totp]').fill(codeFor(secret));
      await page.locator('#kc-totp-settings-form input[type=submit]').click();
      await page.waitForLoadState('domcontentloaded');
      if (await page.locator('#kc-recovery-codes-list').count()) {
        await page.locator('[name=kcRecoveryCodesConfirmationCheck]').check();
        await page.locator('#saveRecoveryAuthnCodesBtn').click();
      }
    }
    try {
      await page.waitForURL(`${redirectUri}**`);
    } catch (cause) {
      const heading = await page.locator('#kc-page-title').textContent();
      throw new Error(`Session callback did not complete; identity form: ${heading?.trim()}`, { cause });
    }
    const callback = new URL(page.url());
    assert.equal(callback.searchParams.get('state'), state);
    const response = await tokenRequest({
      grant_type: 'authorization_code', code: callback.searchParams.get('code'),
      code_verifier: verifier, redirect_uri: redirectUri
    });
    assert.equal(response.status, 200, 'PKCE code exchange must succeed');
    await page.close();
    return response.json();
  }

  async function createContext(cookies = []) {
    const context = await identityContext(browser);
    await context.addCookies(cookies);
    await context.route(`${site}/**`, (route) => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>Session test callback</title>'
    }));
    return context;
  }

  try {
    const creation = await fetch(`${identity}/admin/realms/kaordo/users`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username, enabled: true, requiredActions: [], credentials: [
          { type: 'password', value: password, temporary: false }
        ]
      }),
      signal: AbortSignal.timeout(10_000)
    });
    assert.equal(creation.status, 201, 'Temporary identity must be created for native TOTP setup');

    const first = await createContext();
    let fluo = await authorize(first, 'fluo', true);
    const month = 30 * 24 * 60 * 60;
    assert.ok(fluo.expires_in > 0 && fluo.expires_in <= 300, 'Access tokens stay short');
    assert.ok(fluo.refresh_expires_in >= month - 5 && fluo.refresh_expires_in <= month,
      'Refresh expiry must be governed by a month of inactivity');
    assert.equal(claims(fluo.refresh_token).typ, 'Refresh', 'Sign-in must use ordinary revocable sessions');
    const initialExpiry = claims(fluo.refresh_token).exp;
    const cookies = (await first.cookies()).filter((cookie) => cookie.expires > 0);
    const identityCookie = cookies.find((cookie) => cookie.name === 'KEYCLOAK_IDENTITY');
    assert.ok(identityCookie?.httpOnly, 'The persistent identity credential must be HttpOnly');
    assert.ok(identityCookie.expires > Date.now() / 1000 + month - 5, 'Sign-in survives browser closure');
    await first.close();

    const resumed = await createContext(cookies);
    let ligo = await authorize(resumed, 'ligo');
    assert.equal(claims(ligo.access_token).sid, claims(fluo.access_token).sid,
      'Another app must resume the existing SSO session without credentials');
    const usedRefresh = fluo.refresh_token;
    const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: usedRefresh });
    assert.equal(refreshed.status, 200);
    fluo = await refreshed.json();
    assert.ok(fluo.refresh_token !== usedRefresh, 'Refresh tokens must rotate');

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const responses = await Promise.all([fluo, ligo].map((tokens) =>
      tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })));
    assert.ok(responses.every((response) => response.status === 200), 'Separate app token chains must not invalidate each other');
    [fluo, ligo] = await Promise.all(responses.map((response) => response.json()));
    assert.ok(claims(fluo.refresh_token).exp > initialExpiry, 'Using the app extends the idle expiry');

    const replay = await tokenRequest({ grant_type: 'refresh_token', refresh_token: usedRefresh });
    assert.equal(replay.status, 400, 'A consumed refresh token must not be reusable');
    // Keycloak invalidates the client session after replay detection; a valid
    // identity cookie can still obtain fresh app token chains through SSO.
    fluo = await authorize(resumed, 'fluo');
    ligo = await authorize(resumed, 'ligo');

    const logout = await fetch(`${identity}/realms/kaordo/protocol/openid-connect/logout`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: 'kaordo-web', refresh_token: fluo.refresh_token }),
      signal: AbortSignal.timeout(10_000)
    });
    assert.equal(logout.status, 204, 'Ordinary Keycloak logout must still end the session');
    const rejected = await Promise.all([fluo, ligo].map((tokens) =>
      tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })));
    assert.ok(rejected.every((response) => response.status === 400), 'Logout must revoke every app token chain');
    const page = await resumed.newPage();
    await page.goto(identityEntryURL());
    await page.locator('#kc-form-login').waitFor();
    await resumed.close();
  } finally {
    await cleanupTemporaryUser(browser, username, { applicationData: false });
  }
});

test('identity theme follows persisted color mode on native credential forms', async ({ browser }) => {
  for (const mode of ['light', 'dark']) {
    const context = await identityContext(browser, { colorScheme: mode === 'dark' ? 'light' : 'dark' });
    await context.addInitScript((preference) => localStorage.setItem('kaordo.color-mode', preference), mode);
    const page = await context.newPage();
    const url = identityEntryURL();
    await page.goto(url);
    await page.locator('#kc-form-login').waitFor();
    await checkCredentialInputs(page, 'login');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), mode === 'dark',
      'Saved preference overrides the opposite system setting before the form is shown');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'deep-purple');
    for (const form of ['login', 'registration']) {
      if (form === 'registration') {
        await page.getByRole('link', { name: 'Register', exact: true }).click();
        await page.locator('#kc-register-form').waitFor();
      }
      const inputs = await checkCredentialInputs(page, form === 'login' ? 'login' : 'register');
      if (form === 'registration') {
        const passwordVisibility = page.locator('#kc-register-form [data-password-toggle]');
        assert.equal(await passwordVisibility.getAttribute('aria-controls'), 'password');
        const originalLabel = await passwordVisibility.getAttribute('aria-label');
        await passwordVisibility.click();
        assert.equal(await page.locator('#password').getAttribute('type'), 'text',
          'Keycloak visibility control reveals the registration password');
        assert.notEqual(await passwordVisibility.getAttribute('aria-label'), originalLabel,
          'Password visibility exposes its changed action to assistive technology');
        await passwordVisibility.click();
        assert.equal(await page.locator('#password').getAttribute('type'), 'password');
        assert.ok(inputs[1].autocomplete === 'new-password');
      }
      await checkPasswordAppearance(page);
      await capture(page, `identity-${form}-${mode}`);
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 800 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          `${form} reflows at ${width}px in ${mode} mode`);
        await checkAccessibility(page, `${form} ${mode} ${width}px`);
      }
    }
    await page.goto(url);
    await page.locator('#kc-form-login').waitFor();
    await page.locator('[name=username]').fill(`invalid_${randomBytes(5).toString('hex')}`);
    await page.locator('[name=password]').fill('incorrect-password');
    await page.locator('#kc-login').click();
    await page.locator('#input-error').waitFor();
    await checkCredentialErrorStyles(page);
    await context.close();
  }
});

test('identity OTP errors keep one input boundary in both color modes', async ({ browser }) => {
  const username = `test_identity_${randomBytes(6).toString('hex')}`;
  const password = `Qa!${randomBytes(18).toString('hex')}`;
  try {
    const context = await identityContext(browser, { colorScheme: 'dark' });
    const page = await context.newPage();
    // Finish Keycloak's setup without bootstrapping an application account.
    await page.route(`${site}/**`, (route) => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>Identity test callback</title>',
    }));
    await page.goto(identityEntryURL());
    await page.getByRole('link', { name: 'Register', exact: true }).click();
    await page.locator('#kc-register-form [name=username]').fill(username);
    await page.locator('#kc-register-form [name=password]').fill(password);
    await page.locator('#kc-register-form input[type=submit]').click();
    await page.locator('[name=totpSecret]').waitFor({ state: 'attached' });
    const secret = await page.locator('[name=totpSecret]').inputValue();
    await page.locator('[name=totp]').fill(codeFor(secret));
    await page.locator('#kc-totp-settings-form input[type=submit]').click();
    await page.locator('#kc-recovery-codes-list li').first().waitFor();
    await page.locator('[name=kcRecoveryCodesConfirmationCheck]').check();
    await page.locator('#saveRecoveryAuthnCodesBtn').click();
    await page.waitForURL(`${site}/**`);
    await context.clearCookies();

    await page.goto(identityEntryURL());
    await page.locator('#kc-form-login [name=username]').fill(username);
    await page.locator('#kc-form-login [name=password]').fill(password);
    await page.locator('#kc-login').click();
    await page.locator('[name=otp]').fill('not-a-code');
    await page.locator('input[name=login]').click();
    const otp = page.locator('[name=otp][aria-invalid=true]');
    await otp.waitFor();
    for (const mode of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction((dark) => document.documentElement.classList.contains('dark') === dark, mode === 'dark');
      await checkInvalidInputAppearance(otp);
      await checkAccessibility(page, `Invalid OTP ${mode}`);
      await capture(page, `identity-invalid-otp-${mode}`);
    }
  } finally {
    await cleanupTemporaryUser(browser, username, { applicationData: false });
  }
});

test('registration, TOTP and recovery login, Kerno account, Fluo posting, Rondo, Lingvo and app SSO', async ({ browser }) => {
  test.setTimeout(120_000);
  const username = `test_${randomBytes(6).toString('hex')}`;
  const password = `Qa!${randomBytes(18).toString('hex')}`;
  try {
    const context = await identityContext(browser);
    const page = await context.newPage();
    const pageErrors = [];
    const voiceTokenResponses = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.url().includes('/voice-token')) voiceTokenResponses.push(response);
    });
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
    const accountResponse = page.waitForResponse((response) => isApiResponse(response, '/v1/session', 'POST'));
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
    const recoveredResponse = page.waitForResponse((response) => isApiResponse(response, '/v1/session', 'POST'));
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
    const totpResponse = page.waitForResponse((response) => isApiResponse(response, '/v1/session', 'POST'));
    await page.locator('input[name=login]').click();
    const signedIn = await totpResponse;
    assert.equal(signedIn.status(), 200, 'A current TOTP must sign in');
    assert.equal((await signedIn.json()).id, account.id);
    const mainNavigations = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) mainNavigations.push(frame.url());
    });
    for (const app of ['ligo', 'fluo', 'rondo', 'lingvo', 'memoro', 'regado']) {
      await test.step(`${app} SSO, access and product interactions`, async () => {
        if (app === 'ligo') {
          await checkCachedPreview(page, () => page.goto(`${site}/${app}/`), `Welcome back, ${username}.`);
        } else {
          const appResponse = page.waitForResponse((response) => isApiResponse(response, '/v1/session', 'POST'));
          await page.goto(`${site}/${app}/`);
          assert.equal((await appResponse).status(), 200);
        }
        if (app === 'fluo') {
          await page.getByRole('navigation', { name: 'Fluo navigation' }).waitFor();
        } else if (app === 'ligo') {
          await page.getByRole('heading', { name: 'Chats' }).waitFor();
        } else if (app === 'rondo') {
          await page.getByRole('navigation', { name: 'Servers' }).waitFor();
        } else if (app === 'lingvo') {
          await page.getByRole('button', { name: 'Open my dictionary', exact: true }).waitFor();
        } else if (app === 'memoro') {
          await page.getByRole('heading', { name: 'Memoro', exact: true }).waitFor();
        } else {
          await page.getByRole("heading", { name: "Administrator access required", exact: true }).waitFor();
        }
        await checkAccessibility(page, `${app} account gate`);
        await page.setViewportSize({ width: 320, height: 768 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          `${app} must reflow at 320 CSS pixels`);
        await checkAccessibility(page, `${app} at 320px`);
        await page.setViewportSize({ width: 1280, height: 720 });
        if (app === 'lingvo') {
          await recordCiphertextCommits(page);
          await page.getByRole('radiogroup', { name: 'My native language' }).getByRole('radio', { name: /English/ }).check();
          const dictionaryResponse = page.waitForResponse(response => isApiResponse(response, '/v1/crypto/records/commit', 'POST'));
          await page.getByRole('button', { name: 'Open my dictionary', exact: true }).click();
          const createdDictionary = await dictionaryResponse;
          await inspectCiphertextCommit(createdDictionary, 'Creating a language pair', 2);
          await page.getByRole('button', { name: 'Add card', exact: true }).click();
          assert.match(new URL(page.url()).searchParams.get('dictionary') ?? '', /^[0-9a-f-]{36}$/i,
            'A language pair must have a stable dictionary link');
          await expect(page.getByRole('button', { name: 'Select language pair' })).toContainText('German');
          await expect(page.getByRole('button', { name: 'Select language pair' })).toContainText('English');
          const editor = page.getByRole('dialog', { name: 'Add a card', exact: true });
          await editor.getByLabel('German word', { exact: true }).fill('Buch');
          await editor.getByLabel('English translation', { exact: true }).fill('book');
          await editor.getByRole('button', { name: 'Part of speech', exact: true }).click();
          await page.getByRole('menuitemradio', { name: 'Noun', exact: true }).click();
          await editor.getByRole('radiogroup', { name: 'Article', exact: true }).getByRole('radio', { name: 'das', exact: true }).check();
          const cardResponse = page.waitForResponse(response => isApiResponse(response, '/v1/crypto/records/commit', 'POST'));
          await editor.getByRole('button', { name: 'Add card', exact: true }).click();
          const createdCard = await cardResponse;
          const cardCommit = await inspectCiphertextCommit(createdCard, 'Creating a German card', 2);
          const cardRecord = cardCommit.input.writes.find(write => write.revision === 0);
          assert.ok(cardRecord, 'Creating a card must add a new encrypted record');
          await editor.waitFor({ state: 'detached' });
          const navigation = page.getByRole('navigation', { name: 'Lingvo', exact: true });
          await navigation.getByRole('link', { name: 'My dictionary', exact: true }).click();
          await page.getByRole('heading', { name: 'My dictionary', exact: true }).waitFor();
          await page.getByText('book', { exact: true }).waitFor();
          await expect(page.getByText('das', { exact: true })).toBeVisible();
          await page.reload();
          await page.getByText('book', { exact: true }).waitFor();
          await expect(page.getByText('1 word', { exact: true })).toBeVisible();
          await checkAccessibility(page, 'Lingvo saved dictionary');
          await navigation.getByRole('link', { name: 'Learn words', exact: true }).click();
          await page.getByRole('button', { name: /^Start learning/ }).click();
          await page.getByRole('button', { name: 'Show answer', exact: true }).click();
          const reviewResponse = page.waitForResponse(response => isApiResponse(response, '/v1/crypto/records/commit', 'POST'));
          await page.getByRole('button', { name: /^Good ·/ }).click();
          const savedReview = await reviewResponse;
          const reviewCommit = await inspectCiphertextCommit(savedReview, 'Saving a local FSRS review', 4);
          assert.equal(reviewCommit.result.items.find(item => item.tag === cardRecord.tag)?.revision, 2);
          await page.getByRole('heading', { name: 'Good work for today.', exact: true }).waitFor();
          const undoResponse = page.waitForResponse(response => isApiResponse(response, '/v1/crypto/records/commit', 'POST'));
          await page.getByRole('button', { name: 'Undo', exact: true }).click();
          const undoneReview = await undoResponse;
          const undoCommit = await inspectCiphertextCommit(undoneReview, 'Undoing a persisted review', 3);
          assert.equal(undoCommit.result.items.find(item => item.tag === cardRecord.tag)?.revision, 3);
          await page.getByRole('button', { name: 'Show answer', exact: true }).waitFor();
          await expect(page.getByRole('group', { name: 'Question', exact: true })).toContainText('Buch');
          await checkAccessibility(page, 'Lingvo restored flashcard practice');
        }
        if (app === 'memoro') {
          // Day writes are observed in transit: Kerno must receive only ciphertext for tasks and the journal.
          const dayWrites = [];
          await page.route('**/v1/memoro/days/*', async (route) => {
            if (route.request().method() === 'PUT') dayWrites.push(route.request().postData() ?? '');
            await route.continue();
          });
          const savedDay = () => page.waitForResponse((response) => response.url().includes('/v1/memoro/days/') && response.request().method() === 'PUT');
          await page.getByRole('button', { name: 'Add task', exact: true }).click();
          const taskDialog = page.getByRole('dialog', { name: 'Add task' });
          await taskDialog.getByRole('textbox', { name: 'Task text' }).fill('Buy fresh bread');
          const taskSaved = savedDay();
          await taskDialog.getByRole('button', { name: 'Add task', exact: true }).click();
          assert.ok((await taskSaved).ok(), 'A Memoro task must be saved');
          await taskDialog.waitFor({ state: 'detached' });
          const journal = page.getByRole('textbox', { name: 'Daily journal text' });
          await journal.fill('A calm and private day.');
          const journalSaved = savedDay();
          await page.getByRole('button', { name: 'Save entry', exact: true }).click();
          assert.ok((await journalSaved).ok(), 'A Memoro journal entry must be saved');
          assert.equal(dayWrites.length, 2);
          assert.ok(dayWrites.every((body) => body && !body.includes('fresh bread') && !body.includes('private day')),
            'Memoro must send only encrypted day documents');
          await page.unroute('**/v1/memoro/days/*');
          await page.reload();
          await page.getByText('Buy fresh bread', { exact: true }).waitFor();
          await expect(page.getByRole('textbox', { name: 'Daily journal text' })).toContainText('A calm and private day.');
          await checkAccessibility(page, 'Memoro saved day');
        }
        if (app === 'rondo') {
          await page.getByRole('button', { name: 'Create server' }).click();
          const serverDialog = page.getByRole('dialog', { name: 'Create a server' });
          const serverName = `UI community ${randomBytes(3).toString('hex')}`;
          await serverDialog.getByLabel('Server name').fill(serverName);
          await serverDialog.getByRole('button', { name: 'Create server' }).click();
          await serverDialog.waitFor({ state: 'detached' });
          const closingDialogText = await page.locator('[data-slot="dialog-content"]').allTextContents();
          assert.ok(closingDialogText.every((text) => !text.includes('Invite a member')),
            'A closing server dialog must not morph into a different dialog during its exit animation');
          await page.getByRole('heading', { name: serverName }).waitFor();
          await page.getByRole('textbox', { name: 'Write a message' }).waitFor();
          await page.waitForTimeout(180);
          await capture(page, 'rondo-channel');
          await checkAccessibility(page, 'Rondo channel');
          await page.getByRole('button', { name: 'Hide servers' }).click();
          assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Show servers',
            'Collapsing a panel must keep keyboard focus on its replacement control');
          await page.getByRole('button', { name: 'Show servers' }).click();
          assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Hide servers');
          await page.getByRole('button', { name: 'Hide channels' }).click();
          assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Show channels');
          await page.getByRole('button', { name: 'Show channels' }).click();
          assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Hide channels');
          const messageText = `Rondo UI check ${randomBytes(3).toString('hex')}`;
          await page.getByRole('textbox', { name: 'Write a message' }).fill(messageText);
          await page.getByRole('button', { name: 'Send message' }).click();
          await page.getByRole('log', { name: 'Messages' }).getByText(messageText).waitFor();
          await page.getByRole('button', { name: 'Join voice' }).click();
          const voiceControls = page.getByRole('group', { name: 'Voice controls' });
          try {
            await voiceControls.waitFor({ timeout: 15_000 });
          } catch (cause) {
            const voiceErrorText = await page.getByRole('alert').allTextContents();
            const voiceResponses = await Promise.all(voiceTokenResponses.map(async (response) => ({
              status: response.status(),
              error: response.ok() ? undefined : await response.text()
            })));
            throw new Error(`Rondo voice controls were not rendered: ${JSON.stringify({
              voiceErrorText, voiceResponses, pageErrors, currentUrl: page.url(), mainNavigations
            })}`, { cause });
          }
          await checkSoundStorageFallback(page);
          await page.getByRole('button', { name: 'Turn on camera' }).click();
          await page.getByLabel('Live video streams').locator('video').waitFor({ timeout: 15_000 });
          await capture(page, 'rondo-voice');
          await checkAccessibility(page, 'Rondo voice and video');
          if (await page.evaluate(() => document.fullscreenEnabled)) {
            const videoTile = page.locator('[data-voice-video-id]').first();
            await videoTile.getByRole('button', { name: 'Fullscreen your camera' }).click();
            await page.waitForFunction(() => document.fullscreenElement?.hasAttribute('data-voice-video-id'));
            assert.equal(await videoTile.locator('video').evaluate((video) => getComputedStyle(video).objectFit), 'contain');
            await videoTile.getByRole('button', { name: 'Exit fullscreen your camera' }).click();
            await page.waitForFunction(() => !document.fullscreenElement);
            await page.getByRole('button', { name: 'Fullscreen voice panel' }).click();
            await page.waitForFunction(() => document.fullscreenElement?.classList.contains('voice-stage'));
            await page.keyboard.press('Escape');
            // Headless Chromium does not always deliver Escape to its native fullscreen controller.
            // Exit through the browser API in that case; the app observes the same fullscreenchange.
            await page.evaluate(async () => {
              if (document.fullscreenElement) await document.exitFullscreen();
            });
            await page.waitForFunction(() => !document.fullscreenElement);
            assert.equal(await page.getByText('Fullscreen unavailable.', { exact: true }).count(), 0,
              'Exiting fullscreen must not show an error');
          }
          await page.setViewportSize({ width: 320, height: 768 });
          await page.waitForFunction(() => window.matchMedia('(max-width: 639px)').matches &&
            document.querySelector('#rondo-channels') === null,
          null, { timeout: 5_000 });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
            'Rondo channel must reflow at 320 CSS pixels');
          await capture(page, 'rondo-channel-mobile');
          const channelHeader = await page.locator('section[aria-label="Channel conversation"] > header').evaluate((header) => {
            const title = header.querySelector('h2').getBoundingClientRect();
            const action = [...header.querySelectorAll('button, span')].find((item) =>
              item.textContent?.trim() === 'Voice connected' || item.textContent?.trim() === 'Join voice');
            return { titleBottom: title.bottom, actionTop: action?.getBoundingClientRect().top,
              overflow: header.scrollWidth - header.clientWidth,
              children: [...header.children].map((item) => ({ text: item.textContent?.trim(),
                width: item.getBoundingClientRect().width, left: item.getBoundingClientRect().left,
                right: item.getBoundingClientRect().right })) };
          });
          assert.ok(channelHeader.actionTop >= channelHeader.titleBottom - 1 && channelHeader.overflow <= 1,
            `Rondo's mobile voice action must sit below the channel title without overlap: ${JSON.stringify(channelHeader)}`);
          await checkAccessibility(page, 'Rondo channel at 320px');
          await page.evaluate(() => document.documentElement.classList.add('dark'));
          await page.waitForTimeout(220);
          await checkAccessibility(page, 'Rondo voice at 320px in dark mode');
          await capture(page, 'rondo-channel-dark-mobile');
          await page.evaluate(() => document.documentElement.classList.remove('dark'));
          await page.waitForTimeout(220);
          const voiceStage = await page.locator('.voice-stage').evaluate((stage) => ({
            height: stage.getBoundingClientRect().height, overflow: stage.scrollHeight - stage.clientHeight
          }));
          assert.ok(voiceStage.height < 330 && voiceStage.overflow <= 1,
            `The compact mobile voice stage must not take over the conversation: ${JSON.stringify(voiceStage)}`);
          await page.getByRole('button', { name: 'Show members' }).click();
          await page.getByRole('dialog', { name: 'Server members' }).waitFor();
          await checkAccessibility(page, 'Rondo mobile members panel');
          await page.keyboard.press('Escape');
          await page.getByRole('dialog', { name: 'Server members' }).waitFor({ state: 'detached' });
          assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Show members',
            'Closing the mobile members panel must restore focus to its trigger');
          await page.setViewportSize({ width: 1280, height: 720 });
          await page.getByRole('button', { name: 'Disconnect from voice' }).click();
        }
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
          await page.getByRole('button', { name: 'New conversation' }).click();
          const newChatDialog = page.getByRole('dialog', { name: 'New conversation' });
          await newChatDialog.waitFor();
          await page.keyboard.press('Escape');
          await newChatDialog.waitFor({ state: 'detached' });
          assert.ok((await page.locator('[data-slot="dialog-content"]').allTextContents())
            .every((text) => !text.includes('Add people')),
            'Closing the new-chat dialog must not change its content during the exit animation');
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
            const response = page.waitForResponse(response => isApiResponse(response, `/v1/ligo/conversations/${conversationId}/messages`, 'POST'));
            await page.getByRole('textbox', { name: 'Write a message' }).fill(body);
            await page.getByRole('button', { name: 'Send message' }).click();
            const created = await response;
            assert.equal(created.status(), 201, `Scrollable message ${index + 1} must be created`);
            assert.match((await created.json()).text, /^kaordo:e2ee:v1:/, 'Kerno stores only the message ciphertext');
            await expect(page.getByRole('textbox', { name: 'Write a message' })).toHaveValue('');
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
          await expect.poll(async () => (await chatPosition()).distance).toBeLessThanOrEqual(2);
          const fastScrollPosition = await chatPosition();
          assert.ok(fastScrollPosition.distance >= -1 && fastScrollPosition.distance <= 2,
            `Fast scrolling must reach and stay at the bottom: ${JSON.stringify(fastScrollPosition)}`);
          await page.mouse.wheel(0, 4000);
          await expect.poll(async () => (await chatPosition()).distance).toBeLessThanOrEqual(2);
          const overscrollPosition = await chatPosition();
          assert.ok(overscrollPosition.distance >= -1 && overscrollPosition.distance <= 2,
            `Overscrolling must not move the chat upward: ${JSON.stringify(overscrollPosition)}`);
          await page.mouse.wheel(0, 4000);
          await page.mouse.wheel(0, -1200);
          await expect.poll(async () => (await chatPosition()).distance).toBeGreaterThan(50);
          const readingPosition = await chatPosition();
          assert.ok(readingPosition.distance > 50,
            `Scrolling upward must cancel end pinning: ${JSON.stringify(readingPosition)}`);
          await messageLog.evaluate((element) => { element.scrollTop = 0; });
          await page.mouse.wheel(0, 12_000);
          await expect.poll(async () => (await chatPosition()).distance).toBeLessThanOrEqual(2);
          const secondFastScrollPosition = await chatPosition();
          assert.ok(secondFastScrollPosition.distance >= -1 && secondFastScrollPosition.distance <= 2,
            `A second fast scroll must also remain at the bottom: ${JSON.stringify(secondFastScrollPosition)}`);
        }
        assert.equal(await page.getByRole('link', { name: 'Sign in' }).count(), 0);
      });
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
    await composer.getByRole('button', { name: 'Post visibility', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Only me', exact: true }).click();
    await composer.getByRole('button', { name: 'Post visibility', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Public', exact: true }).click();
    await composer.getByRole('button', { name: 'Close post options' }).click();
    const postText = `Fluo image test ${randomBytes(4).toString('hex')}`;
    await composer.locator('[contenteditable=true]').fill(postText);
    assert.equal(await composer.getByRole('button', { name: 'Post visibility', exact: true }).count(), 0,
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
      const publish = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Post');
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
    const publishedResponse = await test.step('Upload four images and publish a post', async () => {
      const uploadResponses = [];
      const recordUpload = response => {
        const url = new URL(response.url());
        if (url.pathname.startsWith('/v1/uploads')) uploadResponses.push({ method: response.request().method(), path: url.pathname, status: response.status() });
      };
      page.on('response', recordUpload);
      const response = page.waitForResponse((response) => isApiResponse(response, '/v1/fluo/posts', 'POST'), { timeout: 20_000 });
      try {
        const [published] = await Promise.all([response, composer.getByRole('button', { name: 'Post', exact: true }).click()]);
        assert.equal(published.status(), 201, 'The publish request must create the post');
        return published;
      } catch (cause) {
        throw new Error(`Publishing failed: ${JSON.stringify({ alerts: await composer.getByRole('alert').allTextContents(),
          status: await composer.getByRole('status').allTextContents(), uploadResponses, pageErrors })}`, { cause });
      } finally { page.off('response', recordUpload); }
    });
    const postBearer = (await publishedResponse.request().allHeaders()).authorization;
    assert.match(postBearer ?? '', /^Bearer /, 'Publishing must carry the signed-in account');
    const identityResponse = await fetch('http://localhost:8081/v1/crypto/identity', {
      headers: { Authorization: postBearer, Origin: site }
    });
    assert.equal(identityResponse.status, 200);
    const { signingPublicKey } = (await identityResponse.json()).identity;
    // Public posts are readable by anyone holding the published audience keys, including the server operator.
    const openPublicPost = async (value) => {
      const envelope = typeof value === 'string' ? JSON.parse(value.slice('kaordo:fluo:v1:'.length)) : value;
      const refs = envelope.keyring.map((ref) => `${ref.ownerId}:${ref.version}`).join(',');
      const keys = await fetch(`http://localhost:8081/v1/fluo/keys?refs=${encodeURIComponent(refs)}`, { headers: { Authorization: postBearer, Origin: site } });
      assert.equal(keys.status, 200);
      return openPublishedPost(envelope, signingPublicKey, (await keys.json()).items);
    };
    const publishedPost = await publishedResponse.json();
    await composer.waitFor({ state: 'detached' });
    const publishedCard = page.locator('article[data-post-id]').filter({ hasText: postText });
    await publishedCard.waitFor();
    const postId = await publishedCard.getAttribute('data-post-id');
    assert.match(postId ?? '', /^[0-9a-f-]{36}$/i, 'The published post must have a stable identifier');
    const card = page.locator(`article[data-post-id="${postId}"]`);
    await capture(page, 'fluo-before-carousel');
    const carousel = card.getByRole('region', { name: 'Post media' });
    const media = await carousel.locator('[data-pswp-item]').evaluateAll((items) => items.map((item) => {
      const image = item.querySelector('img');
      return {
        width: Number(item.getAttribute('data-pswp-width')),
        height: Number(item.getAttribute('data-pswp-height')),
        url: image?.src ?? '',
        altText: image?.alt ?? ''
      };
    }));
    assert.equal(media.length, 4, 'The published post must render all four uploaded images');
    assert.ok(media.every((item) => item.width === 8 && item.height === 6),
      'Uploaded image dimensions must be retained in the carousel');
    assert.equal(media[0].altText, 'A solid black test image',
      'Image descriptions must be retained in the rendered attachment');
    const mediaCount = media.length;
    const reservedSize = await carousel.locator(':scope > div').first().evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height, aspectRatio: Number.parseFloat(getComputedStyle(element).aspectRatio) };
    });
    assert.ok(reservedSize.aspectRatio > 0 &&
      Math.abs(reservedSize.height - reservedSize.width / reservedSize.aspectRatio) < 4,
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
    assert.equal(await carousel.locator('[aria-live="polite"]').count(), 0,
      'Multi-image carousels must not show the removed position counter');
    const firstSlide = carousel.getByRole('group', { name: '1 of 4' });
    const initialSlide = await firstSlide.boundingBox();
    assert.ok(initialSlide, 'The first media slide must have a measurable frame');
    const waitForFirstSlideAt = async (left) => page.waitForFunction(({ postId, expectedLeft }) => {
      const slide = document.querySelector(`article[data-post-id="${postId}"] [aria-label="1 of 4"]`);
      return slide && Math.abs(slide.getBoundingClientRect().left - expectedLeft) < 2;
    }, { postId, expectedLeft: left });
    const waitForFirstSlideBefore = async (left) => page.waitForFunction(({ postId, previousLeft }) => {
      const slide = document.querySelector(`article[data-post-id="${postId}"] [aria-label="1 of 4"]`);
      return slide && slide.getBoundingClientRect().left < previousLeft - 2;
    }, { postId, previousLeft: left });
    await nextArrow.click();
    await waitForFirstSlideBefore(initialSlide.x);
    const nextSlideLeft = (await firstSlide.boundingBox()).x;
    assert.equal(await carousel.getByRole('button', { name: 'Previous attachment' }).count(), 1);
    await carousel.getByRole('button', { name: 'Previous attachment' }).click();
    await waitForFirstSlideAt(initialSlide.x);
    await carousel.getByRole('button', { name: 'Next attachment' }).focus();
    await page.keyboard.press('Enter');
    await waitForFirstSlideBefore(initialSlide.x);
    await waitForFirstSlideAt(nextSlideLeft);
    for (let step = 0; step < mediaCount; step += 1) {
      const nextButton = carousel.getByRole('button', { name: 'Next attachment' });
      if (!(await nextButton.count())) break;

      const currentLeft = (await firstSlide.boundingBox()).x;
      await nextButton.click();
      await waitForFirstSlideBefore(currentLeft);
    }
    assert.equal(await carousel.getByRole('button', { name: 'Next attachment' }).count(), 0,
      'The carousel must not render a next arrow at its last item');
    assert.ok((await firstSlide.boundingBox()).x < nextSlideLeft,
      'The carousel must advance through its remaining media');
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
    await carousel.getByRole('button', { name: 'Next attachment' }).waitFor({ state: 'visible' });
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
    const twoPhotoResponsePromise = page.waitForResponse((response) => isApiResponse(response, '/v1/fluo/posts', 'POST'));
    await twoPhotoComposer.getByRole('button', { name: 'Post', exact: true }).click();
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
      const videoPostResponsePromise = page.waitForResponse((response) => isApiResponse(response, '/v1/fluo/posts', 'POST'));
      await videoComposer.getByRole('button', { name: 'Post', exact: true }).click();
      const videoPostResponse = await videoPostResponsePromise;
      assert.equal(videoPostResponse.status(), 201, 'Fluo must publish a video attachment');
      const videoPost = await videoPostResponse.json();
      await videoComposer.waitFor({ state: 'detached' });
      videoPostId = videoPost.id;
      const videoContent = await openPublicPost(videoPost.content);
      assert.equal(videoContent.media[0].kind, 'video');
      assert.equal(videoContent.media[0].width, 320);
      assert.equal(videoContent.media[0].height, 180);
      assert.equal(videoPost.media[0].kind, 'file', 'The server must retain opaque file metadata');
      assert.equal(videoPost.media[0].width, 0);
      const videoCard = page.locator(`article[data-post-id="${videoPost.id}"]`);
      await videoCard.getByRole('button', { name: 'Load encrypted video', exact: true }).click();
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
    const searchResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/v1/fluo/posts' && !url.searchParams.has('q');
    });
    await search.fill(postText);
    const searchResponse = await searchResponsePromise;
    assert.equal(searchResponse.status(), 200, 'Post search must succeed');
    assert.ok((await searchResponse.json()).items.some((item) => item.id === postId),
      'Post search must include the matching post');
    await card.waitFor();
    await fluoNav.getByRole('button', { name: 'Feed', exact: true }).click();
    await card.waitFor();
    await page.waitForFunction((text) => {
      const article = [...document.querySelectorAll('article')].find((item) => item.textContent.includes(text));
      const image = article?.querySelector('img');
      return image?.complete && image.naturalWidth === 8;
    }, postText);
    const likeResponsePromise = page.waitForResponse((response) =>
      isApiResponse(response, `/v1/fluo/posts/${postId}/reaction`, 'PUT'));
    await card.getByRole('button', { name: 'Like, 0', exact: true }).click();
    assert.equal((await likeResponsePromise).status(), 200, 'Liking a post must succeed');
    const liked = card.getByRole('button', { name: 'Like, 1', exact: true });
    await expect(liked).toBeEnabled();
    await expect(liked).toHaveAttribute('aria-pressed', 'true');
    await liked.focus();
    await page.keyboard.press('Tab');
    const reactionOptions = card.getByRole('button', { name: 'Reaction options', exact: true });
    await expect(reactionOptions).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitemradio', { name: 'Dislike, 0', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(reactionOptions).toBeFocused();
    const replyText = `Reply ${randomBytes(3).toString('hex')}`;
    await card.getByRole('button', { name: 'Reply, 0', exact: true }).click();
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
    assert.equal(await replyComposer.getByRole('button', { name: 'Post visibility', exact: true }).isDisabled(), true,
      'Replies must inherit the original post visibility');
    await replyComposer.getByRole('button', { name: 'Close post options' }).click();
    await replyEditor.fill(replyText);
    const replyResponsePromise = page.waitForResponse((response) => isApiResponse(response, '/v1/fluo/posts', 'POST'));
    await replyComposer.getByRole('button', { name: 'Reply', exact: true }).click();
    const replyResponse = await replyResponsePromise;
    assert.equal(replyResponse.status(), 201);
    assert.equal((await replyResponse.json()).parentId, postId,
      'Reply composition must publish a reply linked to its parent post');
    await replyComposer.waitFor({ state: 'detached' });
    await page.locator('[data-slot="dialog-overlay"]').waitFor({ state: 'detached' });
    await card.getByRole('button', { name: 'Reply, 1', exact: true }).waitFor();
    const replyReturnScroll = await page.evaluate(() => window.scrollY);
    await openPostFromCardGap(page, card, username, postText);
    const postFocus = page.getByRole('region', { name: 'Post', exact: true });
    const focusedPost = postFocus.locator(`article[data-post-id="${postId}"]`);
    await focusedPost.waitFor();
    const comments = postFocus.getByRole('region', { name: 'Replies' });
    await comments.getByText(replyText).waitFor();
    await page.evaluate(() => Promise.all(document.getAnimations({ subtree: true })
      .map((animation) => animation.finished.catch(() => undefined))));
    if (process.env.KAORDO_UI_SNAPSHOTS === '1') {
      await page.screenshot({ path: join(tmpdir(), 'kaordo-ui-fluo-comments.png') });
    }
    await checkAccessibility(page, 'Fluo focused post with replies');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await card.waitFor();
    await waitForRestoredScroll(page, replyReturnScroll);
    assert.equal(new URL(page.url()).hash, '#feed', 'Returning from a focused post restores the feed route');

    const quoteText = `Quote ${randomBytes(3).toString('hex')}`;
    await card.getByRole('button', { name: 'Quote, 0', exact: true }).click();
    const quoteComposer = page.getByRole('dialog', { name: 'Quote post' });
    const quotedContext = quoteComposer.getByRole('region', { name: 'Quoted post' });
    await quoteComposer.locator('[contenteditable=true]').waitFor();
    const quoteEditorBox = await quoteComposer.locator('[contenteditable=true]').boundingBox();
    const quotedContextBox = await quotedContext.boundingBox();
    assert.ok(quoteEditorBox && quotedContextBox && quoteEditorBox.y + quoteEditorBox.height <= quotedContextBox.y + 1,
      'A quote must be written above the quoted post');
    await quoteComposer.locator('[contenteditable=true]').fill(quoteText);
    const quoteResponsePromise = page.waitForResponse((response) => isApiResponse(response, '/v1/fluo/posts', 'POST'));
    await quoteComposer.getByRole('button', { name: 'Quote', exact: true }).click();
    const quoteResponse = await quoteResponsePromise;
    assert.equal(quoteResponse.status(), 201);
    const quotedPost = await quoteResponse.json();
    await quoteComposer.waitFor({ state: 'detached' });
    await page.locator('[data-slot="dialog-overlay"]').waitFor({ state: 'detached' });
    assert.equal(quotedPost.quote?.id, postId,
      `The new post must reference the quoted post: ${JSON.stringify({ quoteId: quotedPost.quoteId, quote: quotedPost.quote, source: postId })}`);
    assert.equal(quotedPost.quote.media.length, 4, 'A quoted post must include its original media');
    const quotedContent = await openPublicPost(quotedPost.quote.text);
    assert.equal(quotedContent.media[0].altText, 'A solid black test image',
      'Quoted media must retain the original accessible description');
    assert.equal(quotedPost.quote.media[0].altText, '', 'Attachment descriptions must stay inside ciphertext');
    assert.ok(quotedPost.quote.media.every((item) => item.url.startsWith('http')),
      'Quoted media must have signed URLs');
    const quoteCard = page.locator(`article[data-post-id="${quotedPost.id}"]`);
    await quoteCard.waitFor();
    const quotePreview = quoteCard.getByRole('button', { name: `Open quoted post by ${username}` });
    assert.equal(await quotePreview.locator('img').count(), 4);
    await quotePreview.scrollIntoViewIfNeeded();
    const quoteReturnScroll = await page.evaluate(() => window.scrollY);
    await quotePreview.click();
    await focusedPost.waitFor();
    await page.waitForFunction((id) => location.hash === `#post/${id}`, postId);
    const detailLayout = await postFocus.evaluate((section) => {
      const article = section.querySelector('article');
      const gallery = article?.querySelector('[aria-label="Post media attachments"]');
      return {
        postWidth: article?.getBoundingClientRect().width,
        postRight: article?.getBoundingClientRect().right,
        galleryRight: gallery?.getBoundingClientRect().right,
        sectionRight: section.getBoundingClientRect().right,
        overflow: section.scrollWidth - section.clientWidth
      };
    });
    assert.ok(detailLayout.overflow <= 1 && detailLayout.postRight <= detailLayout.sectionRight + 1 &&
      detailLayout.galleryRight <= detailLayout.postRight + 1,
    'The focused post and its media must fit the content column without horizontal scrolling');
    assert.equal(await page.getByRole('dialog', { name: 'Post', exact: true }).count(), 0,
      'Opening a quoted post replaces the feed without opening a modal');
    await page.evaluate(() => Promise.all(document.getAnimations({ subtree: true })
      .map((animation) => animation.finished.catch(() => undefined))));
    await checkAccessibility(page, 'Fluo focused quoted post');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await quoteCard.waitFor();
    await waitForRestoredScroll(page, quoteReturnScroll);
    assert.equal(new URL(page.url()).hash, '#feed');

    await page.setViewportSize({ width: 390, height: 844 });
    await openPostFromCardGap(page, card, username, postText);
    await focusedPost.waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'A focused post must reflow without horizontal overflow on mobile');
    assert.equal(await page.getByRole('button', { name: 'Back', exact: true }).count(), 0,
      'The in-app Back action is reserved for the web layout');
    await page.evaluate(() => Promise.all(document.getAnimations({ subtree: true })
      .map((animation) => animation.finished.catch(() => undefined))));
    await checkAccessibility(page, 'Fluo focused post on mobile');
    await page.goBack();
    await page.waitForFunction(() => location.hash === '#feed');
    await card.waitFor();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForFunction(() => window.scrollY === 0);
    await capture(page, 'fluo');
    await checkAccessibility(page, 'Fluo feed with media, reply and quote');
    assert.ok(media.every((item) => item.url.startsWith('blob:')), 'Images render from device-decrypted copies');
    for (const item of publishedPost.media) {
      assert.equal((await fetch(item.url)).status, 200, 'published media must be available with its signed URL');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await fluoNav.getByRole('button', { name: 'Feed', exact: true }).waitFor();
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
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.evaluate(() => Promise.all(document.getAnimations({ subtree: true })
      .map((animation) => animation.finished.catch(() => undefined))));
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
    await card.hover();
    await card.getByRole('button', { name: 'Post actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete post', exact: true }).click();
    const deleteDialog = page.getByRole('dialog', { name: 'Delete post?' });
    await deleteDialog.waitFor();
    await deleteDialog.evaluate((dialog) => Promise.all(dialog.getAnimations().map((animation) => animation.finished)));
    await checkAccessibility(page, 'Delete confirmation');
    assert.match(await deleteDialog.textContent(), /removes its replies and attachments/);
    await deleteDialog.getByRole('button', { name: 'Cancel' }).click();
    await deleteDialog.waitFor({ state: 'hidden' });
    await card.waitFor();
    await card.hover();
    await card.getByRole('button', { name: 'Post actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete post', exact: true }).click();
    const [deletedPost] = await Promise.all([
      page.waitForResponse((response) => isApiResponse(response, `/v1/fluo/posts/${postId}`, 'DELETE')),
      deleteDialog.getByRole('button', { name: 'Delete post' }).click()
    ]);
    assert.equal(deletedPost.status(), 204);
    assert.equal((await fetch(`http://localhost:8081/v1/fluo/posts/${postId}`, {
      headers: { Authorization: postBearer }
    })).status, 404, 'the deleted post must be absent from Kerno');
    await card.waitFor({ state: 'detached' });
    assert.deepEqual(pageErrors, [], 'The Fluo feed must render without browser exceptions after deletion');
    for (const item of publishedPost.media) {
      assert.equal((await fetch(item.url)).status, 404,
        'deleting a post must purge its media, even while the former signed URL is valid');
    }
    await fluoNav.getByRole('button', { name: 'Profile', exact: true }).click();
    const twoPhotoCard = page.locator(`article[data-post-id="${twoPhotoPost.id}"]`);
    await twoPhotoCard.waitFor();
    const twoPhotoGallery = twoPhotoCard.getByLabel('Post media attachments');
    await twoPhotoGallery.scrollIntoViewIfNeeded();
    const twoPhotoPair = twoPhotoGallery.getByRole('group', { name: 'Post media' });
    const twoPhotoViewport = await twoPhotoPair.boundingBox();
    const twoPhotoFrames = await twoPhotoPair.locator(':scope > div').all();
    assert.equal(twoPhotoFrames.length, 2);
    const firstPortrait = await twoPhotoFrames[0].boundingBox();
    const secondPortrait = await twoPhotoFrames[1].boundingBox();
    assert.ok(twoPhotoViewport && firstPortrait && secondPortrait &&
      firstPortrait.width < twoPhotoViewport.width * 0.55 &&
      secondPortrait.x + secondPortrait.width <= twoPhotoViewport.x + twoPhotoViewport.width + 1,
      'Two portrait photos must both fit the gallery without full-width placeholders');
    assert.equal(await twoPhotoGallery.getByRole('button', { name: 'Previous attachment' }).count(), 0);
    assert.equal(await twoPhotoGallery.getByRole('button', { name: 'Next attachment' }).count(), 0);
    assert.equal(await twoPhotoCard.locator('[aria-live="polite"]').count(), 0,
      'The paired-photo layout must not show a carousel position counter');
    assert.equal(await twoPhotoGallery.getByRole('link', { name: 'Open image 2 of 2' }).count(), 1,
      'The second visible portrait photo must remain accessible');
    const singlePhotoComposer = await openComposer();
    await singlePhotoComposer.locator('[contenteditable=true]')
      .fill(`Single-photo frame ${randomBytes(4).toString('hex')}`);
    await singlePhotoComposer.getByLabel('Choose photos or videos').setInputFiles({
      name: 'single-photo.png', mimeType: 'image/png', buffer: Buffer.from(imageBase64, 'base64')
    });
    const singlePhotoResponsePromise = page.waitForResponse((response) => isApiResponse(response, '/v1/fluo/posts', 'POST'));
    await singlePhotoComposer.getByRole('button', { name: 'Post', exact: true }).click();
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
    const threadPath = `/v1/fluo/posts/${singlePhotoPost.id}/thread`;
    const singlePostRequested = page.waitForRequest((request) => new URL(request.url()).pathname === threadPath);
    await page.route(`**${threadPath}`, async (route) => {
      await new Promise((resolve) => { releaseSinglePost = resolve; });
      await route.continue();
    });
    await page.evaluate((id) => { window.location.hash = `post/${id}`; }, singlePhotoPost.id);
    await singlePostRequested;
    await postFocus.getByText('Loading post…').waitFor();
    assert.equal(await postFocus.locator(`article[data-post-id="${singlePhotoPost.id}"]`).count(), 0,
      'Post content must wait for its data instead of showing a partial card');
    releaseSinglePost();
    await postFocus.locator(`article[data-post-id="${singlePhotoPost.id}"]`).waitFor();
    await page.unroute(`**${threadPath}`);
    const singlePhotoDetail = await postFocus.evaluate((section) => {
      const article = section.querySelector('article');
      const gallery = article?.querySelector('[aria-label="Post media attachments"]');
      const frame = gallery?.firstElementChild;
      return {
        postRight: article?.getBoundingClientRect().right,
        galleryRight: gallery?.getBoundingClientRect().right,
        frameRight: frame?.getBoundingClientRect().right,
        frameWidth: frame?.getBoundingClientRect().width
      };
    });
    assert.ok(singlePhotoDetail.frameWidth > 0 && singlePhotoDetail.galleryRight <= singlePhotoDetail.postRight + 1 &&
      singlePhotoDetail.frameRight <= singlePhotoDetail.postRight + 1,
    `A single-photo focused post must keep its frame within the card: ${JSON.stringify(singlePhotoDetail)}`);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForFunction(() => location.hash === '#profile');
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
    const aspectResponsePromise = page.waitForResponse((response) => isApiResponse(response, '/v1/fluo/posts', 'POST'));
    await aspectComposer.getByRole('button', { name: 'Post', exact: true }).click();
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
    const frameInset = await aspectCarousel.evaluate((element) => {
      const viewport = element.firstElementChild;
      const firstSlide = viewport?.querySelector('[role="group"]');
      if (!firstSlide || !viewport) return null;
      return {
        gap: firstSlide.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
        expected: Number.parseFloat(getComputedStyle(firstSlide).getPropertyValue('--media-frame-inset'))
      };
    });
    assert.ok(frameInset && Math.abs(frameInset.gap - frameInset.expected) < 1,
      `The photo gallery must not add space beyond its intentional frame inset: ${JSON.stringify(frameInset)}`);
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
      'Dragging a photo must scroll the carousel without opening its lightbox');
    for (let step = 0; step < aspectPost.media.length; step += 1) {
      const nextButton = aspectCarousel.getByRole('button', { name: 'Next attachment' });
      if (!(await nextButton.count())) break;

      const previousX = (await aspectFrames[0].boundingBox()).x;
      await nextButton.click();
      await page.waitForFunction(({ id, before }) => {
        const slide = document.querySelector(`article[data-post-id="${id}"] [aria-label="Post media"] [role="group"]`);
        return slide && slide.getBoundingClientRect().x < before - 40;
      }, { id: aspectPost.id, before: previousX }, { timeout: 5_000 });
    }
    const widePhotoBox = await aspectFrames[3].boundingBox();
    assert.ok(widePhotoBox && widePhotoBox.x + widePhotoBox.width / 2 >= aspectViewport.x &&
      widePhotoBox.x + widePhotoBox.width / 2 <= aspectViewport.x + aspectViewport.width,
    'The carousel controls must bring the wide photo into the interactive viewport');
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
    await cleanupTemporaryUser(browser, username);
  }
});
