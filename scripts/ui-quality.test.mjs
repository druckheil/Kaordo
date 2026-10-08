// Checks representative authenticated screens, themes and accessible interaction across Kaordo apps

import { readFileSync } from 'node:fs';
import { test, expect } from './ui-fixture.mjs';
import { accessibilityViolations, interfaceGeometry, semanticContrast, settleInterface } from './ui-accessibility.mjs';
import { installQualityFixture } from './ui-quality-fixture.mjs';
import { openFixtureMedia } from './encryption-fixture.mjs';

async function auditScreen(page, testInfo, stage) {
  await settleInterface(page);
  if (process.env.KAORDO_UI_SCREENSHOTS === '1') {
    const touch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    await page.screenshot({ path: testInfo.outputPath(stage.replaceAll(/[^\w-]/g, '-') + '.png'), fullPage: !touch });
  }
  const geometry = await interfaceGeometry(page);
  expect.soft(geometry.overflow, stage + ' reflows without page overflow').toBeLessThanOrEqual(1);
  expect.soft(geometry.small, stage + ' controls have at least 24 CSS pixels or an associated label').toEqual([]);
  if (geometry.dialog) {
    expect.soft(geometry.dialog.top, stage + ' dialog stays below the viewport top').toBeGreaterThanOrEqual(0);
    expect.soft(geometry.dialog.bottom, stage + ' dialog stays above the viewport bottom').toBeLessThanOrEqual(geometry.dialog.viewportHeight + 1);
    expect.soft(geometry.dialog.left, stage + ' dialog fits horizontally').toBeGreaterThanOrEqual(0);
    expect.soft(geometry.dialog.right, stage + ' dialog fits horizontally').toBeLessThanOrEqual(geometry.dialog.viewportWidth + 1);
  }
  const violations = await accessibilityViolations(page);
  if (violations.length || geometry.overflow > 1 || geometry.small.length) await testInfo.attach(stage, { body: JSON.stringify({ geometry, violations }, null, 2), contentType: 'application/json' });
  expect.soft(violations, stage + ' has no automated WCAG 2.2 A/AA violations').toEqual([]);
}

async function responsiveAudit(page, testInfo, stage) {
  for (const { width, height, mode } of [
    { width: 1440, height: 900, mode: 'light' },
    { width: 320, height: 640, mode: 'light' },
    { width: 390, height: 844, mode: 'dark' },
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(mode => { localStorage.setItem('kaordo.color-mode', mode); }, mode);
    await page.emulateMedia({ colorScheme: mode });
    // The same document owns the preference, so notify mode-watcher as another tab would
    await page.evaluate(mode => window.dispatchEvent(new StorageEvent('storage', { key: 'kaordo.color-mode', newValue: mode })), mode);
    await auditScreen(page, testInfo, `${stage}-${width}-${mode}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await settleInterface(page);
}

test('Fluo feed, notifications, settings and composer stay usable across viewports', async ({ startAppFixture }, testInfo) => {
  const { page, origin, errors } = await startAppFixture('fluo');
  await installQualityFixture(page, 'fluo');
  await page.goto(origin + '/fluo/');
  await page.locator('article[data-post-id]').first().waitFor();
  await responsiveAudit(page, testInfo, 'fluo-feed');
  for (const [hash, heading] of [['#notifications', 'Notifications'], ['#settings/notifications', 'Notifications'], ['#settings/privacy', 'Privacy']]) {
    await page.goto(origin + '/fluo/' + hash);
    await page.getByRole('heading', { name: heading, exact: true, level: 1 }).waitFor();
    await (hash === '#notifications' ? page.getByRole('list', { name: 'Notifications' }) : page.getByRole('radiogroup').first()).waitFor();
    await responsiveAudit(page, testInfo, 'fluo-' + hash.slice(1).replace('/', '-'));
    if (hash === '#notifications') {
      const top = await page.getByRole('list', { name: 'Notifications' }).evaluate(element => element.getBoundingClientRect().top);
      await page.getByRole('button', { name: 'Mark all as read', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Mark all as read', exact: true })).toBeHidden();
      expect(await page.getByRole('list', { name: 'Notifications' }).evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(top, 0);
    }
  }
  await page.getByRole('button', { name: 'Post', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').waitFor();
  await dialog.getByRole('textbox').fill('A short draft with a clear place to start.');
  await dialog.getByRole('button', { name: 'Post options', exact: true }).click();
  await responsiveAudit(page, testInfo, 'fluo-composer-options');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test('Fluo profile, search, saved posts and ownership menus remain clear across viewports', async ({ startAppFixture }, testInfo) => {
  const { page, origin, errors } = await startAppFixture('fluo');
  const state = await installQualityFixture(page, 'fluo');
  await page.goto(origin + '/fluo/#profile');
  const ownPost = page.locator(`article[data-post-id="${state.posts[1].id}"]`);
  await expect(ownPost).toBeVisible();
  await expect(page.getByRole('list', { name: 'Profile posts' }).getByRole('listitem')).toHaveCount(1);
  await responsiveAudit(page, testInfo, 'fluo-profile');
  await ownPost.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Delete post', exact: true })).toBeVisible();
  await auditScreen(page, testInfo, 'fluo-owner-menu');
  await page.keyboard.press('Escape');
  const navigation = page.getByRole('navigation', { name: 'Fluo navigation' });
  await navigation.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Enter at least two characters' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search posts', exact: true }).fill('quiet');
  await expect(page.getByRole('list', { name: 'Search results' }).getByRole('listitem')).toHaveCount(1);
  await responsiveAudit(page, testInfo, 'fluo-search-results');
  await page.getByRole('searchbox', { name: 'Search posts', exact: true }).fill('not in this dictionary');
  await expect(page.getByText('No matching posts.', { exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(page.getByText('No saved posts yet.', { exact: true })).toBeVisible();
  await responsiveAudit(page, testInfo, 'fluo-saved-empty');
  await navigation.getByRole('button', { name: 'Feed', exact: true }).click();
  await page.locator(`article[data-post-id="${state.posts[0].id}"]`).getByRole('button', { name: /^Save post,/ }).click();
  await expect.poll(() => state.posts[0].saved).toBe(true);
  await navigation.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Saved posts' }).getByRole('listitem')).toHaveCount(1);
  await responsiveAudit(page, testInfo, 'fluo-saved-posts');
  expect(errors).toEqual([]);
});

for (const app of ['fluo', 'ligo', 'rondo']) {
  test(`${app} submits queued images on the first upload without reloading the draft`, async ({ startAppFixture, startUploadFixture }) => {
    const { page, origin, errors } = await startAppFixture(app, { fresh: true });
    const upload = await startUploadFixture(origin);
    const state = await installQualityFixture(page, app, { uploadOrigin: upload.origin });
    const reloads = [];
    page.on('websocket', socket => socket.on('framereceived', frame => {
      let payload;
      try { payload = JSON.parse(String(frame.payload)); } catch { return; }
      if (payload.type === 'full-reload') reloads.push(payload);
    }));
    const hash = app === 'ligo' ? '#c/' + state.conversation.id : app === 'rondo' ? '#s/' + state.server.id : '';
    await page.goto(origin + '/' + app + '/' + hash);
    if (app === 'rondo') await page.getByRole('button', { name: 'general', exact: true }).click();
    if (app === 'fluo') await page.getByRole('button', { name: 'Post', exact: true }).first().click();
    const composer = app === 'fluo' ? page.getByRole('dialog', { name: 'Create a post' }) : page;
    const editor = composer.getByRole('textbox', { name: app === 'fluo' ? 'Post text' : 'Write a message' });
    const draft = 'A draft that survives its first media upload.';
    await editor.fill(draft);
    const navigations = [];
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 6;
      canvas.getContext('2d').fillRect(0, 0, 8, 6);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await composer.getByLabel(app === 'fluo' ? 'Choose photos or videos' : 'Choose files').setInputFiles(
      Array.from({ length: 4 }, (_, i) => ({ name: `cold-${i}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })));
    const path = app === 'fluo' ? '/v1/fluo/posts' : `/v1/ligo/conversations/${state.conversation.id}/messages`;
    const submitted = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST');
    await composer.getByRole('button', { name: app === 'fluo' ? 'Post' : 'Send message', exact: true }).click();
    try { expect((await submitted).status()).toBe(201); }
    catch (cause) { throw new Error(JSON.stringify({ navigations, reloads, errors,
      alerts: await composer.getByRole('alert').allTextContents() }), { cause }); }
    const submittedRequest = state.requests.find(request => request.path === path && request.method === 'POST');
    const payload = submittedRequest.body;
    const opened = submittedRequest.opened;
    expect(payload.attachmentIds).toHaveLength(4);
    expect(upload.uploads.size).toBe(4);
    for (const [id, { size, data }] of upload.uploads) {
      expect(data.length, 'The HTTP fixture receives every declared upload byte').toBe(size);
      expect(data.subarray(0, 8).toString()).toBe('Kaordo01');
      const descriptor = opened.media.find(item => item.id === id);
      const plain = openFixtureMedia(data, descriptor);
      try {
        expect(plain.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        expect([plain.readUInt32BE(16), plain.readUInt32BE(20)]).toEqual([8, 6]);
      } finally { plain.fill(0); }
    }
    if (app === 'fluo') {
      await expect(composer).toBeHidden();
      expect(payload.content.version).toBe(1);
      expect(opened.content.content[0].content[0].text).toBe(draft);
    } else {
      await expect(editor).toHaveValue('');
      await expect(page.getByRole('log').getByRole('paragraph').filter({ hasText: draft })).toBeVisible();
      expect(payload.text.startsWith('kaordo:e2ee:v1:')).toBe(true);
      expect(opened.text).toBe(draft);
    }
    expect(navigations, 'Lazy upload dependencies cannot reload a draft').toEqual([]);
    expect(reloads, 'Cold dependency preparation cannot request a full reload').toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const app of ['ligo', 'rondo']) {
  test(`${app} conversation, menus and settings stay usable across viewports`, async ({ startAppFixture }, testInfo) => {
    const { page, origin, errors } = await startAppFixture(app);
    const state = await installQualityFixture(page, app);
    await page.goto(origin + '/' + app + '/' + (app === 'ligo' ? '#c/' + state.conversation.id : '#s/' + state.server.id));
    if (app === 'rondo') await page.getByRole('button', { name: 'general', exact: true }).click();
    await page.getByRole('textbox', { name: 'Write a message' }).waitFor();
    await page.getByRole('log').getByText('Sounds good! See you tomorrow.', { exact: false }).waitFor();
    await responsiveAudit(page, testInfo, app + '-conversation');
    const composer = page.getByRole('textbox', { name: 'Write a message' });
    await composer.fill('Keep this draft while reconnecting.');
    await page.getByRole('button', { name: 'Reconnect live updates' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Messages refresh automatically' })).toBeVisible();
    await expect(composer).toHaveValue('Keep this draft while reconnecting.');
    const messagePath = `/v1/ligo/conversations/${state.conversation.id}/messages`;
    const reads = () => state.requests.filter(request => request.path === messagePath && request.method === 'GET').length;
    const previousReads = reads();
    await expect.poll(reads, { timeout: 6000, message: 'Disconnected live updates retain automatic message refresh' }).toBeGreaterThan(previousReads);
    await page.getByRole('button', { name: 'Message actions', exact: true }).last().click();
    await page.getByRole('menu').waitFor();
    await auditScreen(page, testInfo, app + '-message-menu');
    await page.keyboard.press('Escape');
    if (app === 'rondo') {
      await page.getByRole('button', { name: 'Rondo settings', exact: true }).click();
      await page.getByRole('heading', { name: 'Voice & video', exact: true }).waitFor();
      await responsiveAudit(page, testInfo, 'rondo-settings');
    } else {
      await page.getByRole('button', { name: 'New conversation', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await responsiveAudit(page, testInfo, 'ligo-new-conversation');
    }
    expect(errors).toEqual([]);
  });
}

test('Memoro opens a day without reporting superseded requests and saves the journal', async ({ startAppFixture }, testInfo) => {
  const { page, origin, errors } = await startAppFixture('memoro');
  const state = await installQualityFixture(page, 'memoro');
  await page.goto(origin + '/memoro/');
  await expect(page.getByRole('heading', { name: 'Memoro', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add your first task' })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await auditScreen(page, testInfo, 'memoro-day');
  await page.getByRole('textbox', { name: 'Daily journal text' }).fill('A quiet evening walk.');
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  const write = state.requests.find(request => request.method === 'PUT' && request.path.startsWith('/v1/memoro/days/'));
  expect(JSON.stringify(write.body)).not.toContain('quiet evening');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

const lingvoTest = test.extend({
  lingvo: async ({ startAppFixture }, use) => {
    const { page, origin, errors } = await startAppFixture('lingvo');
    const state = await installQualityFixture(page, 'lingvo');
    await page.goto(origin + '/lingvo/?dictionary=' + state.dictionary.id);
    await expect(page.getByRole('heading', { name: 'Make it stick.' })).toBeVisible();
    await use({ page, origin, state });
    expect(errors).toEqual([]);
  },
});

lingvoTest('Lingvo learning dashboard reflows across viewports', async ({ lingvo: { page } }, testInfo) => {
  await responsiveAudit(page, testInfo, 'lingvo-learn');
});

lingvoTest('Lingvo card form supports articles and applies AI input without saving', async ({ lingvo: { page, state } }, testInfo) => {
  const writes = () => state.requests.filter(request => request.method === 'POST' && request.path === '/v1/crypto/records/commit').length;
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Add a card' })).toBeVisible();
  await responsiveAudit(page, testInfo, 'lingvo-add-card');
  const beforeApply = writes();
  await dialog.getByRole('radio', { name: 'der', exact: true }).click();
  await expect(dialog.getByRole('radio', { name: 'der', exact: true })).toBeChecked();
  await dialog.getByRole('textbox', { name: 'AI input', exact: true }).fill('word||Baum||tree||||noun||der||die Bäume||||Der Baum ist groß.||The tree is tall.||||active');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'German word', exact: true })).toHaveValue('Baum');
  await responsiveAudit(page, testInfo, 'lingvo-ai-details');
  expect(writes()).toBe(beforeApply);
});

lingvoTest('Lingvo dictionary presents saved words with a clear responsive hierarchy', async ({ lingvo: { page } }, testInfo) => {
  await page.getByRole('navigation', { name: 'Lingvo', exact: true }).getByRole('link', { name: 'My dictionary', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My dictionary' })).toBeVisible();
  await expect(page.getByText('book', { exact: true })).toBeVisible();
  await expect(page.getByText('1 word', { exact: true })).toBeVisible();
  await responsiveAudit(page, testInfo, 'lingvo-dictionary');
});

lingvoTest('Lingvo library and set preview reflow across viewports', async ({ lingvo: { page } }, testInfo) => {
  await page.getByRole('navigation', { name: 'Lingvo', exact: true }).getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'A little library of German' })).toBeVisible();
  await expect(page.getByText('Everyday essentials', { exact: true })).toBeVisible();
  await responsiveAudit(page, testInfo, 'lingvo-library');
  await page.getByRole('button', { name: 'Preview Everyday essentials' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Everyday essentials' })).toBeVisible();
  await responsiveAudit(page, testInfo, 'lingvo-set-preview');
});

lingvoTest('Lingvo word practice keeps the question and answer accessible', async ({ lingvo: { page, origin, state } }, testInfo) => {
  await page.goto(origin + '/lingvo/?dictionary=' + state.dictionary.id + '&view=study&kind=word');
  await expect(page.getByRole('button', { name: 'Show answer', exact: true })).toBeVisible();
  await responsiveAudit(page, testInfo, 'lingvo-study-question');
  await page.getByRole('button', { name: 'Show answer', exact: true }).click();
  await responsiveAudit(page, testInfo, 'lingvo-study-answer');
});

lingvoTest('Lingvo preferences support keyboard goal adjustment and explicit saving', async ({ lingvo: { page, state } }, testInfo) => {
  await page.getByRole('button', { name: 'Dictionary settings' }).click();
  await page.getByRole('menuitem', { name: 'Learning preferences', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Find your rhythm' })).toBeVisible();
  await responsiveAudit(page, testInfo, 'lingvo-learning');
  const goal = dialog.getByRole('slider', { name: 'Daily review goal' });
  await goal.focus();
  await page.keyboard.press('ArrowRight');
  await expect(goal).toHaveAttribute('aria-valuenow', '25');
  await dialog.getByRole('button', { name: 'Save preferences' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Dictionary settings' }).click();
  await page.getByRole('menuitem', { name: 'Learning preferences', exact: true }).click();
  await expect(dialog.getByRole('slider', { name: 'Daily review goal' })).toHaveAttribute('aria-valuenow', '25');
});

lingvoTest('Lingvo import and export forms remain accessible across viewports', async ({ lingvo: { page } }, testInfo) => {
  await page.getByRole('button', { name: 'Dictionary settings' }).click();
  await page.getByRole('menuitem', { name: 'Import / export cards', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Bring your words with you' })).toBeVisible();
  await responsiveAudit(page, testInfo, 'lingvo-import');
  await dialog.getByRole('radio', { name: 'Export', exact: true }).click();
  await responsiveAudit(page, testInfo, 'lingvo-export');
});

lingvoTest('Lingvo folder management reflows across viewports', async ({ lingvo: { page } }, testInfo) => {
  await page.getByRole('navigation', { name: 'Lingvo' }).getByRole('link', { name: 'My dictionary', exact: true }).click();
  await page.getByRole('button', { name: 'Manage folders' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Your folders' })).toBeVisible();
  await responsiveAudit(page, testInfo, 'lingvo-folders');
});

lingvoTest('Lingvo phrase tiles, writing and answer feedback support keyboard input', async ({ lingvo: { page, origin, state } }, testInfo) => {
  await page.goto(origin + '/lingvo/?dictionary=' + state.dictionary.id + '&view=study&kind=phrase');
  await expect(page.getByRole('button', { name: 'Check answer', exact: true })).toBeVisible();
  await responsiveAudit(page, testInfo, 'lingvo-phrase-tiles');
  await page.getByRole('radio', { name: 'Write it', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your German answer' }).fill('Einen Kaffee, bitte.');
  await responsiveAudit(page, testInfo, 'lingvo-phrase-written');
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect(page.getByText('That is right.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Again ·/ })).toBeFocused();
  await auditScreen(page, testInfo, 'lingvo-phrase-answer');
});

test('Lingvo preserves drafts on errors and scopes review shortcuts to the focused practice', async ({ startAppFixture }, testInfo) => {
  const { page, origin, errors } = await startAppFixture('lingvo');
  const state = await installQualityFixture(page, 'lingvo');
  await page.goto(origin + '/lingvo/?dictionary=' + state.dictionary.id);
  await page.getByRole('heading', { name: 'Make it stick.' }).waitFor();
  const navigations = [];
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url()); });
  const opener = page.getByRole('button', { name: 'Add card', exact: true });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'Add a card' }).waitFor();
  await dialog.getByRole('textbox', { name: 'German word', exact: true }).fill('Baum');
  await dialog.getByRole('textbox', { name: 'English translation', exact: true }).fill('tree');
  const path = '/v1/crypto/records/commit';
  state.failures.set(path, 'Your card could not be saved. Please try again.');
  await dialog.getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Your card could not be saved. Please try again.');
  await expect(dialog.getByRole('textbox', { name: 'German word', exact: true })).toHaveValue('Baum');
  await responsiveAudit(page, testInfo, 'lingvo-card-save-error');
  state.failures.delete(path);
  await dialog.getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(navigations).toEqual([]);
  await expect(opener).toBeFocused();
  await page.goto(origin + '/lingvo/?dictionary=' + state.dictionary.id + '&view=study&kind=word');
  await page.getByRole('button', { name: 'Show answer', exact: true }).waitFor();
  await page.getByRole('group', { name: 'Question', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /^Again ·/ })).toBeFocused();
  await page.getByRole('link', { name: 'Kaordo home', exact: true }).focus();
  await page.keyboard.press('3');
  const reviewWrites = () => state.requests.filter(request => request.path === '/v1/crypto/records/commit' && request.body?.writes?.length === 4);
  expect(reviewWrites()).toHaveLength(0);
  await page.getByRole('button', { name: /^Good ·/ }).focus();
  await page.keyboard.press('3');
  await expect(page.getByRole('group', { name: 'Question', exact: true })).toBeFocused();
  expect(reviewWrites()).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Question', exact: true })).toBeFocused();
  await auditScreen(page, testInfo, 'lingvo-restored-card');
  expect(errors).toEqual([]);
});

test('Portal, release history and appearance support keyboard focus, enlarged text and short viewports', async ({ startAppFixture, browserName }, testInfo) => {
  const { page, origin, errors } = await startAppFixture('portal');
  await installQualityFixture(page, 'portal');
  await page.goto(origin);
  await page.getByText(/Welcome, Alex Morgan/).waitFor();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  for (const [path, title] of [['/', 'Your connected space.'], ['/changelog/', 'Release history'], ['/agordoj/', 'Appearance']]) {
    await page.goto(origin + path);
    await page.getByRole('heading', { name: title, level: 1, exact: true }).waitFor();
    if (path === '/') await page.getByText(/Welcome, Alex Morgan/).waitFor();
    await responsiveAudit(page, testInfo, 'portal-' + (path.split('/')[1] || 'home'));
    await page.setViewportSize({ width: 667, height: 375 });
    await auditScreen(page, testInfo, 'portal-short-' + title);
  }
  await page.addStyleTag({ content: 'body { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important } p { margin-bottom: 2em !important }' });
  await page.setViewportSize({ width: 320, height: 640 });
  await auditScreen(page, testInfo, 'appearance-text-spacing');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await auditScreen(page, testInfo, 'appearance-enlarged-text');
  expect(errors).toEqual([]);
});

test('Fluo shares a public link and offers a focused manual fallback when clipboard access fails', async ({ startAppFixture }, testInfo) => {
  const { page, origin, errors } = await startAppFixture('fluo');
  const state = await installQualityFixture(page, 'fluo');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedPostLink = value; } } });
  });
  await page.goto(origin + '/fluo/');
  const share = page.getByRole('button', { name: 'Share post', exact: true }).first();
  await share.click();
  await expect(page.getByRole('status').filter({ hasText: 'Post link copied to clipboard.' })).toBeVisible();
  expect(await page.evaluate(() => window.copiedPostLink)).toBe(origin + '/fluo/#post/' + state.posts[0].id);
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new DOMException('Clipboard unavailable', 'NotAllowedError'); }; });
  const fallbackOpener = page.getByRole('button', { name: 'Share post', exact: true }).last();
  await fallbackOpener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: 'Post link' })).toHaveValue(origin + '/fluo/#post/' + state.posts[1].id);
  await responsiveAudit(page, testInfo, 'fluo-share-fallback');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(fallbackOpener).toBeFocused();
  expect(errors).toEqual([]);
});

test.describe('Touch interaction', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  for (const app of ['portal', 'fluo', 'ligo', 'rondo', 'lingvo']) {
    test(`${app} keeps primary touch targets comfortable and supports forced colors`, async ({ startAppFixture }, testInfo) => {
      const { page, origin, errors } = await startAppFixture(app);
      const state = await installQualityFixture(page, app);
      const hash = app === 'ligo' ? '#c/' + state.conversation.id : app === 'rondo' ? '#s/' + state.server.id : '';
      await page.goto(origin + (app === 'portal' ? '/' : '/' + app + '/') + hash);
      if (app === 'portal') await page.getByText(/Welcome, Alex Morgan/).waitFor();
      else if (app === 'fluo') await page.locator('article[data-post-id]').first().waitFor();
      else if (app === 'lingvo') await page.getByRole('heading', { name: 'Make it stick.' }).waitFor();
      else {
        if (app === 'rondo') await page.getByRole('button', { name: 'general', exact: true }).click();
        await page.getByRole('textbox', { name: 'Write a message' }).waitFor();
      }
      await auditScreen(page, testInfo, app + '-touch');
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      expect((await interfaceGeometry(page, 44)).small, app + ' touch targets meet our 44px comfort target').toEqual([]);
      await page.emulateMedia({ forcedColors: 'active' });
      await page.keyboard.press('Tab');
      await page.getByRole('link', { name: 'Kaordo home', exact: true }).focus();
      const outline = await page.getByRole('link', { name: 'Kaordo home', exact: true }).evaluate(element => {
        const style = getComputedStyle(element);
        return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
      });
      expect(outline.style).toBe('solid');
      expect(outline.width).toBeGreaterThanOrEqual(2);
      await auditScreen(page, testInfo, app + '-forced-colors');
      expect(errors).toEqual([]);
    });
  }
});

for (const app of ['portal', 'fluo', 'ligo', 'rondo', 'lingvo']) {
  test(`${app} supports enlarged text and user-defined text spacing`, async ({ startAppFixture }, testInfo) => {
    const { page, origin, errors } = await startAppFixture(app);
    const state = await installQualityFixture(page, app);
    const hash = app === 'ligo' ? '#c/' + state.conversation.id : app === 'rondo' ? '#s/' + state.server.id : '';
    await page.goto(origin + (app === 'portal' ? '/' : '/' + app + '/') + hash);
    if (app === 'portal') await page.getByText(/Welcome, Alex Morgan/).waitFor();
    else if (app === 'fluo') await page.locator('article[data-post-id]').first().waitFor();
    else if (app === 'lingvo') await page.getByRole('heading', { name: 'Make it stick.' }).waitFor();
    else {
      if (app === 'rondo') await page.getByRole('button', { name: 'general', exact: true }).click();
      await page.getByRole('textbox', { name: 'Write a message' }).waitFor();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await auditScreen(page, testInfo, app + '-enlarged-text');
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.addStyleTag({ content: '* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important } p { margin-bottom: 2em !important }' });
    await page.setViewportSize({ width: 320, height: 640 });
    await auditScreen(page, testInfo, app + '-text-spacing');
    expect(errors).toEqual([]);
  });
}

test('Fluo composer grows within its dialog and keeps its footer available with normal motion', async ({ startAppFixture }, testInfo) => {
  const { page, origin, errors } = await startAppFixture('fluo');
  await installQualityFixture(page, 'fluo');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(origin + '/fluo/');
  await page.locator('article[data-post-id]').first().waitFor();
  await page.getByRole('button', { name: 'Post', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  const editor = dialog.getByRole('textbox', { name: 'Post text' });
  await editor.fill('A short draft.');
  const viewport = dialog.locator('.draft-viewport');
  await editor.click();
  await settleInterface(page);
  expect(await editor.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
  expect(await viewport.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
  await dialog.getByRole('button', { name: 'Add media', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(editor).toBeFocused();
  await settleInterface(page);
  expect(await editor.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
  const focus = await viewport.evaluate(element => ({ style: getComputedStyle(element).outlineStyle,
    width: parseFloat(getComputedStyle(element).outlineWidth), radius: parseFloat(getComputedStyle(element).borderRadius) }));
  expect(focus.style).toBe('solid');
  expect(focus.width).toBeGreaterThanOrEqual(2);
  expect(focus.radius).toBeGreaterThan(0);
  await auditScreen(page, testInfo, 'fluo-normal-motion-short-draft');
  await editor.fill(Array.from({ length: 40 }, (_, index) => `Line ${index + 1}: a longer draft that keeps the publishing controls within reach.`).join('\n'));
  for (const optionsOpen of [true, false]) {
    await dialog.getByRole('button', { name: 'Post options', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Post options', exact: true })).toHaveAttribute('aria-expanded', String(optionsOpen));
    await auditScreen(page, testInfo, 'fluo-normal-motion-long-draft-options-' + optionsOpen);
    const bounds = await dialog.evaluate(element => {
      const footer = element.querySelector('button[aria-label="Post options"]').getBoundingClientRect();
      const editor = element.querySelector('[contenteditable=true]').getBoundingClientRect();
      const viewport = element.querySelector('[role=presentation]');
      const rect = viewport.getBoundingClientRect();
      return { footerTop: footer.top, viewportBottom: rect.bottom, editorScrollHeight: editor.height, availableHeight: viewport.clientHeight };
    });
    expect(bounds.viewportBottom).toBeLessThanOrEqual(bounds.footerTop);
    expect(bounds.editorScrollHeight).toBeGreaterThan(bounds.availableHeight);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test('All themes keep semantic text, field boundaries and keyboard focus distinguishable', async ({ startAppFixture }, testInfo) => {
  const { page, origin, errors } = await startAppFixture('portal');
  const catalog = JSON.parse(readFileSync(new URL('../packages/ui/src/lib/themes/catalog.json', import.meta.url), 'utf8'));
  await page.goto(origin + '/agordoj/');
  await page.getByRole('heading', { level: 1 }).waitFor();
  const themes = Array.isArray(catalog) ? catalog : catalog.themes;
  for (const theme of themes) {
    for (const mode of ['light', 'dark']) {
      await page.evaluate(({ theme, mode }) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.classList.toggle('dark', mode === 'dark');
        document.documentElement.style.colorScheme = mode;
      }, { theme: theme.id, mode });
      await auditScreen(page, testInfo, 'theme-' + theme.id + '-' + mode);
      const contrasts = await semanticContrast(page);
      await testInfo.attach(theme.id + '-' + mode + '-contrast', { body: JSON.stringify(contrasts, null, 2), contentType: 'application/json' });
      expect.soft(contrasts.filter(pair => pair.ratio < pair.minimum), theme.id + '-' + mode + ' meets text and control contrast').toEqual([]);
    }
  }
  expect(errors).toEqual([]);
});
