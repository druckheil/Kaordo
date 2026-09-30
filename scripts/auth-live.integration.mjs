import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
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
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

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
      'exec', 'local-app-db-1', 'psql', '-U', 'kaordo', '-d', 'kaordo', '-tAc',
      `DELETE FROM users WHERE keycloak_sub = '${subject}' RETURNING id;`
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
        await checkCachedPreview(page, () => page.goto(`${site}/${app}/`), `Welcome, ${username}.`);
      } else {
        const appResponse = page.waitForResponse((response) =>
          response.url().endsWith('/v1/session') && response.request().method() === 'POST');
        await page.goto(`${site}/${app}/`);
        assert.equal((await appResponse).status(), 200);
      }
      if (app === 'fluo') {
        await page.getByRole('navigation', { name: 'Fluo navigation' }).waitFor();
      } else {
        await page.getByText(`Welcome, ${username}.`, { exact: false }).waitFor();
      }
      await checkAccessibility(page, `${app} account gate`);
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
    assert.equal(await page.getByRole('region', { name: 'Create a post' }).getByRole('button', { name: 'Publish' }).count(), 0,
      'The initial composer must leave room for the feed until the editor is focused');
    const postText = `Fluo image test ${randomBytes(4).toString('hex')}`;
    await page.locator('[contenteditable=true]').fill(postText);
    const imageBase64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 6;
      canvas.getContext('2d').fillRect(0, 0, 8, 6);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.getByLabel('Choose photos or videos').setInputFiles(
      Array.from({ length: 4 }, (_, index) => ({
        name: `fluo-test-${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(imageBase64, 'base64')
      }))
    );
    const attachments = page.getByRole('list', { name: 'Attachments' });
    assert.equal(await attachments.locator('li').count(), 4);
    await attachments.getByRole('button', { name: 'Remove fluo-test-4.png' }).click();
    assert.equal(await attachments.locator('li').count(), 3);
    await page.getByLabel('Choose photos or videos').setInputFiles({
      name: 'fluo-test-4.png', mimeType: 'image/png', buffer: Buffer.from(imageBase64, 'base64')
    });
    assert.equal(await attachments.locator('li').count(), 4);
    await capture(page, 'fluo-composer');
    const createdPost = page.waitForResponse((response) => response.url().endsWith('/v1/fluo/posts') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Publish' }).click();
    const postResponse = await createdPost;
    assert.equal(postResponse.status(), 201, 'Fluo must publish the post with an image');
    const post = await postResponse.json();
    assert.equal(post.media.length, 4);
    for (const item of post.media) {
      assert.equal(item.width, 8);
      assert.equal(item.height, 6);
    }
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
    await page.locator('[contenteditable=true]').fill(`Two-photo carousel ${randomBytes(4).toString('hex')}`);
    await page.getByLabel('Choose photos or videos').setInputFiles(
      [1, 2].map((index) => ({
        name: `two-photo-${index}.png`, mimeType: 'image/png', buffer: Buffer.from(portraitBase64, 'base64')
      }))
    );
    const twoPhotoResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/v1/fluo/posts') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Publish' }).click();
    const twoPhotoResponse = await twoPhotoResponsePromise;
    assert.equal(twoPhotoResponse.status(), 201);
    const twoPhotoPost = await twoPhotoResponse.json();

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
      await page.locator('[contenteditable=true]').fill(videoText);
      await page.getByLabel('Choose photos or videos').setInputFiles({
        name: 'fluo-test.mp4', mimeType: 'video/mp4', buffer: await readFile(videoPath)
      });
      const videoPostResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith('/v1/fluo/posts') && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Publish' }).click();
      const videoPostResponse = await videoPostResponsePromise;
      assert.equal(videoPostResponse.status(), 201, 'Fluo must publish a video attachment');
      const videoPost = await videoPostResponse.json();
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
    const search = page.getByRole('searchbox', { name: 'Search posts and people' });
    await search.fill(postText);
    await card.waitFor();
    await fluoNav.getByRole('button', { name: 'Feed', exact: true }).click();
    await card.waitFor();
    await page.waitForFunction((text) => {
      const article = [...document.querySelectorAll('article')].find((item) => item.textContent.includes(text));
      const image = article?.querySelector('img');
      return image?.complete && image.naturalWidth === 8;
    }, postText);
    await card.getByRole('button', { name: 'Good, 0' }).click();
    await card.getByRole('button', { name: 'Good, 1' }).waitFor();
    await card.getByRole('button', { name: 'Good, 1' }).hover();
    await page.waitForFunction((postId) => {
      const dislike = document.querySelector(`article[data-post-id="${postId}"] [aria-label="Bad, 0"]`);
      return dislike && Number(getComputedStyle(dislike).opacity) > 0.5;
    }, post.id, { timeout: 2_000 });
    await page.mouse.move(0, 0);
    await card.getByRole('button', { name: 'Good, 1' }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Bad, 0',
      'Keyboard focus must reach the dislike action after Like');
    const replyText = `Reply ${randomBytes(3).toString('hex')}`;
    await card.getByRole('button', { name: 'Comments, 0' }).click();
    const comments = card.getByRole('region', { name: 'Comments' });
    await comments.locator('[contenteditable=true]').fill(replyText);
    await comments.getByRole('button', { name: 'Reply', exact: true }).click();
    await comments.getByText(replyText).waitFor();
    if (process.env.KAORDO_UI_SNAPSHOTS === '1') {
      await card.screenshot({ path: join(tmpdir(), 'kaordo-ui-fluo-comments.png') });
    }
    const quoteText = `Quote ${randomBytes(3).toString('hex')}`;
    await card.getByRole('button', { name: 'Quote post' }).click();
    await page.getByRole('region', { name: 'Create a post' }).locator('[contenteditable=true]').fill(quoteText);
    await page.getByRole('region', { name: 'Create a post' }).getByRole('button', { name: 'Publish' }).click();
    await page.getByText(quoteText).first().waitFor();
    await capture(page, 'fluo');
    await checkAccessibility(page, 'Fluo feed with media, reply and quote');
    for (const item of post.media) {
      assert.equal((await fetch(item.url)).status, 200, 'published media must be available with its signed URL');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await fluoNav.getByRole('button', { name: 'Feed', exact: true }).waitFor();
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
    await page.setViewportSize({ width: 1280, height: 720 });
    await fluoNav.getByRole('button', { name: 'Profile', exact: true }).click();
    await card.waitFor();
    page.once('dialog', (dialog) => { void dialog.accept(); });
    const [deletedPost] = await Promise.all([
      page.waitForResponse((response) =>
        response.url().endsWith(`/v1/fluo/posts/${post.id}`) && response.request().method() === 'DELETE'),
      card.getByRole('button', { name: 'Delete post' }).click()
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
    await page.getByRole('region', { name: 'Create a post' }).locator('[contenteditable=true]')
      .fill(`Single-photo frame ${randomBytes(4).toString('hex')}`);
    await page.getByLabel('Choose photos or videos').setInputFiles({
      name: 'single-photo.png', mimeType: 'image/png', buffer: Buffer.from(imageBase64, 'base64')
    });
    const singlePhotoResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/v1/fluo/posts') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Publish' }).click();
    const singlePhotoResponse = await singlePhotoResponsePromise;
    assert.equal(singlePhotoResponse.status(), 201);
    const singlePhotoPost = await singlePhotoResponse.json();
    const singlePhotoCard = page.locator(`article[data-post-id="${singlePhotoPost.id}"]`);
    const singlePhotoGallery = singlePhotoCard.getByLabel('Post attachments');
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
    await page.getByRole('region', { name: 'Create a post' }).locator('[contenteditable=true]')
      .fill(`Aspect-ratio gallery ${randomBytes(4).toString('hex')}`);
    await page.getByLabel('Choose photos or videos').setInputFiles(aspectImages.map((item) => ({
      name: item.name, mimeType: 'image/png', buffer: Buffer.from(item.data, 'base64')
    })));
    const aspectResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith('/v1/fluo/posts') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Publish' }).click();
    const aspectResponse = await aspectResponsePromise;
    assert.equal(aspectResponse.status(), 201);
    const aspectPost = await aspectResponse.json();
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
  } finally {
    await browser.close();
    await removeTemporaryUser(username);
  }
});
