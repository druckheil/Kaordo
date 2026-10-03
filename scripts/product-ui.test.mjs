// Exercises post history, composing, and native message scrolling after refactoring

import assert from 'node:assert/strict';
import test from 'node:test';
import { startAppFixture } from './ui-fixture.mjs';

const id = (n) => `01999111-2222-7333-8444-${String(n).padStart(12, '0')}`;
const now = '2026-10-03T10:00:00Z';
const actor = { id: id(1), username: 'writer', displayName: 'Writer', createdAt: now };
const partner = { id: id(2), username: 'reader', displayName: 'Reader' };
const image = { id: id(3), kind: 'image', mimeType: 'image/png', width: 640, height: 480, size: 200, altText: 'Fixture photo', url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#b7d9c5"/></svg>') };
const document = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const post = (n, text, media = []) => ({ id: id(n), author: { ...partner, following: false }, content: document(text), text, visibility: 'public', parentId: null, quoteId: null, quote: null, media, counts: { good: 0, bad: 0, comments: 0 }, myReaction: null, saved: false, createdAt: now, updatedAt: now });

test('Fluo preserves post history after reload and composes replies and quotes', { timeout: 60000 }, async (t) => {
  const { page, origin, errors } = await startAppFixture(t, 'fluo');
  const parent = { ...post(9, 'Nested original'), author: { ...actor, following: false } };
  const original = { ...post(10, 'Original with media', [image]), quoteId: parent.id, quote: parent };
  const quoted = { ...post(11, 'Quotation'), quoteId: original.id, quote: original };
  const posts = [quoted, ...Array.from({ length: 12 }, (_, i) => post(20 + i, `Feed item ${i}`))];
  const writes = [];
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body;
    if (path === '/v1/session' || path === '/v1/me') body = actor;
    else if (path.endsWith('/comments')) body = { items: [], nextCursor: null };
    else if (path === '/v1/fluo/posts' && request.method() === 'POST') {
      const input = request.postDataJSON();
      writes.push(input);
      body = { ...post(50 + writes.length, 'Created'), ...input, author: { ...actor, following: false } };
    } else if (path === '/v1/fluo/posts') {
      const search = new URL(request.url()).searchParams.get('q');
      body = { items: search ? posts.filter((item) => item.text.includes(search)) : posts, nextCursor: null };
    }
    else if (path === `/v1/fluo/posts/${original.id}`) body = original;
    else if (path === `/v1/fluo/posts/${parent.id}`) body = parent;
    else throw new Error(`Unexpected Fluo fixture request: ${request.method()} ${path}`);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  const quoteLink = page.getByRole('button', { name: 'Open quoted post by reader' });
  const dialog = page.getByRole('dialog');
  await page.goto(`${origin}/fluo/`);
  await quoteLink.waitFor();
  await quoteLink.click();
  await dialog.getByRole('heading', { name: 'Post', exact: true }).waitFor();
  await page.reload();
  await dialog.getByRole('heading', { name: 'Post', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => location.hash === '#feed');
  await quoteLink.click();
  await dialog.getByRole('heading', { name: 'Post', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => location.hash === '#feed');
  await page.waitForTimeout(100);
  assert.equal(await dialog.count(), 0, 'History events cannot reopen a dismissed post');

  await quoteLink.click();
  await dialog.getByRole('heading', { name: 'Post', exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Open quoted post by writer' }).click();
  await dialog.getByText('Nested original', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction((id) => location.hash === `#post/${id}`, original.id);
  await dialog.getByText('Original with media', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Open quoted post by writer' }).click();
  await dialog.getByText('Nested original', { exact: true }).waitFor();
  await page.reload();
  await dialog.getByText('Nested original', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => location.hash === '#feed');

  const navigation = page.getByRole('navigation', { name: 'Fluo navigation' });
  await navigation.getByRole('button', { name: 'Saved', exact: true }).click();
  await page.getByRole('region', { name: 'Saved posts', exact: true }).waitFor();
  await navigation.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.locator('div[aria-label="Profile posts"] article').first().waitFor();
  await navigation.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search posts' }).fill('Quotation');
  await page.locator(`article[data-post-id="${quoted.id}"]`).waitFor();
  await navigation.getByRole('button', { name: 'Feed', exact: true }).click();
  await quoteLink.waitFor();

  await page.getByRole('button', { name: 'Reply to post', exact: true }).first().click();
  await dialog.getByRole('heading', { name: 'Reply to post', exact: true }).waitFor();
  const editor = dialog.locator('[contenteditable="true"]');
  await editor.fill('Reply after refactor');
  assert.equal(await dialog.getByRole('button', { name: 'Post options', exact: true }).getAttribute('aria-expanded'), 'false', 'Typing does not open advanced controls');
  await dialog.getByRole('button', { name: 'Reply', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(writes[0].parentId, quoted.id);
  assert.equal(writes[0].content.content[0].content[0].text, 'Reply after refactor');

  await page.getByRole('button', { name: 'Quote post', exact: true }).first().click();
  await dialog.getByRole('heading', { name: 'Quote post', exact: true }).waitFor();
  await editor.fill('Quote after refactor');
  const positions = await dialog.evaluate((el) => ({
    editor: el.querySelector('[contenteditable]').getBoundingClientRect().top,
    quoted: el.querySelector('[aria-label="Quoted post"]').getBoundingClientRect().top,
  }));
  assert.ok(positions.editor < positions.quoted, 'Quote text is above the original post');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(writes[1].quoteId, quoted.id);
  assert.deepEqual(errors, [], 'No client runtime errors');
});

test('Ligo starts at the bottom, keeps rapid scrolling native and shares the composer', { timeout: 60000 }, async (t) => {
  const { page, origin, errors } = await startAppFixture(t, 'ligo');
  const conversation = { id: id(60), kind: 'duo', title: '', createdBy: actor.id, members: [actor, partner], lastMessage: null, unreadCount: 0, createdAt: now, updatedAt: now };
  const messages = Array.from({ length: 45 }, (_, i) => ({ id: id(100 + i), clientId: id(200 + i), conversationId: conversation.id, sender: i % 2 ? actor : partner, text: `Message ${i}`, media: i === 44 ? [image] : [], reactions: [], status: 'read', editedAt: null, deleted: false, systemNotice: false, createdAt: now }));
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body;
    if (path === '/v1/session' || path === '/v1/me') body = actor;
    else if (path.endsWith('/events')) { await route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }); return; }
    else if (path.endsWith('/read') || path.endsWith('/delivered')) { await route.fulfill({ status: 204 }); return; }
    else if (path.endsWith('/messages') && request.method() === 'POST') {
      body = { ...messages.at(-1), ...request.postDataJSON(), id: id(500), sender: actor, media: [] };
      messages.push(body);
    } else if (path.endsWith('/messages')) body = { items: [...messages].reverse(), nextCursor: null };
    else if (path === '/v1/ligo/conversations') body = { items: [conversation], nextCursor: null };
    else if (path === `/v1/ligo/conversations/${conversation.id}`) body = conversation;
    else throw new Error(`Unexpected Ligo fixture request: ${request.method()} ${path}`);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`${origin}/ligo/#c/${conversation.id}`);
  const log = page.getByRole('log', { name: 'Messages' });
  await log.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const el = document.querySelector('[role="log"]');
    return el && el.scrollHeight > el.clientHeight && Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 2;
  });
  for (let i = 0; i < 4; i++) {
    await log.evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(30);
    await log.hover();
    await page.mouse.wheel(0, 100000);
    await page.waitForTimeout(80);
    const distance = await log.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
    assert.ok(distance <= 2, `Rapid bottom scroll ${i} remains at the end (${distance}px)`);
  }
  assert.equal(await log.getByText('Reader', { exact: true }).count(), 0, 'Duo messages do not repeat sender names');
  const input = page.getByRole('textbox', { name: 'Write a message' });
  await input.fill('Sent after refactor');
  await input.press('Enter');
  await log.locator('p').filter({ hasText: 'Sent after refactor' }).first().waitFor();
  const oneLineHeight = await input.evaluate((el) => el.clientHeight);
  await input.fill(Array.from({ length: 15 }, () => 'A longer draft').join('\n'));
  const expanded = await input.evaluate((el) => ({ height: el.clientHeight, scroll: el.scrollHeight }));
  assert.ok(expanded.height > oneLineHeight && expanded.scroll > expanded.height, 'Composer grows then scrolls');
  await page.getByLabel('Choose files', { exact: true }).setInputFiles({ name: 'preview.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1c8AAAAASUVORK5CYII=', 'base64') });
  await page.getByRole('img', { name: 'Preview of preview.png', exact: true }).waitFor();
  assert.deepEqual(errors, [], 'No client runtime errors');
});
