// Exercises focused post navigation, composing, and native message scrolling

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, expect } from './ui-fixture.mjs';
import { fluoAccountFixtureResponse } from './fluo-account-fixture.mjs';
import {
	encryptedCommunity,
	encryptedMessage,
	encryptedPost,
	openPost,
	postText,
	privateRecords
} from './encryption-fixture.mjs';

const id = (n) => `01999111-2222-7333-8444-${String(n).padStart(12, '0')}`;
const now = '2026-10-03T10:00:00Z';
const actor = { id: id(1), username: 'writer', displayName: 'Writer', createdAt: now };
const partner = { id: id(2), username: 'reader', displayName: 'Reader' };
const image = { id: id(3), altText: 'Fixture photo', width: 640, height: 480 };
const document = (text) => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
});
const readablePost = (n, text) => ({
	id: id(n),
	author: { ...partner, following: false },
	content: document(text),
	text,
	visibility: 'public',
	parentId: null,
	quoteId: null,
	quoteDeleted: false,
	quote: null,
	media: [],
	counts: { good: 0, bad: 0, comments: 0, quotes: 0, saves: 0 },
	myReaction: null,
	saved: false,
	createdAt: now,
	updatedAt: now
});
const post = (n, text) => encryptedPost(readablePost(n, text));

test('Memoro renews expired media links and shares the metadata refresh', async ({
	startAppFixture
}) => {
	const { page, origin, errors } = await startAppFixture('memoro', { fresh: true });
	const reloads = [];
	page.on('websocket', (socket) =>
		socket.on('framereceived', (frame) => {
			const payload = JSON.parse(String(frame.payload));
			if (payload.type === 'full-reload') reloads.push(payload);
		})
	);
	const date = '2026-10-09';
	const cipher = privateRecords(actor.id, 'memoro');
	const png = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1c8AAAAASUVORK5CYII=',
		'base64'
	);
	const attachments = [1, 2].map((index) => {
		const context = `${date}/media/${id(900 + index)}`;
		return { id: id(910 + index), context, ...cipher.sealBytes(png, context) };
	});
	const dayTag = cipher.tag(`day:${date}`);
	const day = {
		version: 1,
		date,
		tasks: [],
		journal: {
			content: document('Diary with images'),
			media: attachments.map(({ id, nonce, context }, index) => ({
				id,
				nonce,
				context,
				kind: 'image',
				mimeType: 'image/png',
				width: 640,
				height: 480,
				size: png.length,
				altText: `Renewed diary image ${index}`
			}))
		}
	};
	const encrypted = {
		...cipher.seal(`day:${dayTag}`, day),
		dayTag,
		monthTag: cipher.tag(`month:${date.slice(0, 7)}`)
	};
	let dayReads = 0;
	let mediaReads = 0;
	await page.route(`${origin}/private-media/**`, async (route) => {
		const url = new URL(route.request().url());
		assert.ok(
			Number(url.searchParams.get('exp')) > Date.now() / 1000,
			'Expired media URLs must be renewed before downloading'
		);
		mediaReads++;
		const attachment = attachments.find((item) => item.id === url.pathname.split('/').at(-1));
		await route.fulfill({ contentType: 'application/octet-stream', body: attachment.bytes });
	});
	await page.route('**/v1/**', async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		let body = fluoAccountFixtureResponse(request, [actor, partner], { viewerId: actor.id });
		if (body) return route.fulfill({ json: body });
		if (path === '/v1/session' || path === '/v1/me') body = actor;
		else if (path === '/v1/memoro/month') body = { items: [] };
		else if (path === `/v1/memoro/days/${dayTag}`) {
			dayReads++;
			body = {
				day: {
					...encrypted,
					media: attachments.map((item) => ({
						id: item.id,
						size: item.bytes.length,
						url: `${origin}/private-media/${item.id}?exp=${dayReads === 1 ? 0 : Math.floor(Date.now() / 1000) + 540}`
					}))
				}
			};
		} else throw new Error(`Unexpected Memoro media request: ${request.method()} ${path}`);
		return route.fulfill({ json: body });
	});
	await page.goto(`${origin}/memoro/?date=${date}`);
	for (let index = 0; index < 2; index++) {
		const image = page.getByRole('img', { name: `Renewed diary image ${index}`, exact: true });
		await image.scrollIntoViewIfNeeded();
		await expect(image).toHaveAttribute('src', /^blob:/);
		await expect(image).toHaveJSProperty('naturalWidth', 1);
	}
	await page.getByRole('link', { name: 'Open image 1 of 2', exact: true }).click();
	const viewer = page.locator('.pswp--open');
	await expect(viewer).toBeVisible();
	await viewer.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(viewer).toHaveCount(0);
	assert.equal(dayReads, 2, 'Concurrent media share one expired-link metadata refresh');
	assert.equal(mediaReads, 2);
	assert.deepEqual(reloads, [], 'Opening diary media cannot reload a cold application');
	assert.deepEqual(errors, []);
});

test('Fluo opens only visible images and releases them when leaving the feed', async ({
	startAppFixture
}) => {
	const { page, origin, errors } = await startAppFixture('fluo');
	const posts = Array.from({ length: 20 }, (_, index) =>
		encryptedPost(readablePost(600 + index, `Media lifecycle ${index}`), {
			images: [
				{ ...image, id: id(700 + index), altText: `Lifecycle photo ${index}` },
				...(index === 0
					? Array.from({ length: 3 }, (_, extra) => ({
							...image,
							id: id(901 + extra),
							altText: `Lifecycle extra ${extra}`
						}))
					: [])
			]
		})
	);
	let mediaVersion = 1;
	const mediaBytes = new Map(
		posts.flatMap((post) =>
			post.media.map((item) => [item.id, Buffer.from(item.url.split(',')[1], 'base64')])
		)
	);
	const wirePosts = () =>
		posts.map((post, index) => ({
			...post,
			...(index === 0 && mediaVersion > 1
				? { counts: { ...post.counts, good: 1 }, myReaction: 'good' }
				: {}),
			media: post.media.map((item) => ({
				...item,
				url: `${origin}/fixture-media/${item.id}?version=${mediaVersion}`
			}))
		}));
	await page.route(`${origin}/fixture-media/**`, async (route) => {
		const url = new URL(route.request().url());
		assert.equal(Number(url.searchParams.get('version')), mediaVersion, 'Use renewed media links');
		await route.fulfill({
			contentType: 'application/octet-stream',
			body: mediaBytes.get(url.pathname.split('/').at(-1))
		});
	});
	await page.addInitScript(() => {
		const create = URL.createObjectURL;
		window.createdMediaURLs = [];
		URL.createObjectURL = (blob) => {
			const url = create.call(URL, blob);
			window.createdMediaURLs.push(url);
			return url;
		};
	});
	await page.route('**/v1/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		let body = fluoAccountFixtureResponse(request, [actor, partner], { viewerId: actor.id });
		if (body) return route.fulfill({ json: body });
		if (url.pathname === '/v1/session' || url.pathname === '/v1/me') body = actor;
		else if (url.pathname.endsWith('/unread-count')) body = { unreadCount: 0 };
		else if (url.pathname === '/v1/fluo/posts')
			body = {
				items: url.searchParams.get('feed') === 'saved' ? [] : wirePosts(),
				nextCursor: null
			};
		else if (url.pathname === `/v1/fluo/posts/${posts[0].id}/reaction`) {
			assert.equal(request.method(), 'PUT');
			mediaVersion++;
			body = wirePosts()[0];
		} else throw new Error(`Unexpected media fixture request: ${request.method()} ${url.pathname}`);
		return route.fulfill({ json: body });
	});
	await page.goto(`${origin}/fluo/`);
	const imageView = page.getByRole('img', { name: 'Lifecycle photo 0', exact: true });
	await expect(imageView).toHaveAttribute('src', /^blob:/);
	const url = await imageView.getAttribute('src');
	assert.ok(
		await page.evaluate(() => window.createdMediaURLs.length < 20),
		'Offscreen media must not be decrypted eagerly'
	);
	const canRead = (source) =>
		page.evaluate(async (value) => {
			try {
				return (await fetch(value)).ok;
			} catch {
				return false;
			}
		}, source);
	assert.equal(await canRead(url), true);
	await expect(
		page.getByRole('img', { name: 'Lifecycle extra 2', exact: true })
	).not.toHaveAttribute('src', /^blob:/);
	await page.getByRole('link', { name: 'Open image 1 of 4', exact: true }).click();
	const viewer = page.locator('.pswp--open');
	await expect(viewer).toBeVisible();
	for (let index = 1; index <= 3; index++) {
		await viewer.getByRole('button', { name: 'Next', exact: true }).click();
		await expect(viewer.locator('.pswp__counter')).toHaveText(new RegExp(`${index + 1}\\s*/\\s*4`));
	}
	await page.waitForFunction(() => {
		const image = window.pswp?.currSlide?.content.element;
		return (
			image instanceof HTMLImageElement && image.naturalWidth > 0 && image.src.startsWith('blob:')
		);
	});
	const viewerURL = await page.evaluate(() => window.pswp.currSlide.content.element.src);
	assert.equal(
		await canRead(viewerURL),
		true,
		'The viewer opens hidden encrypted slides on demand'
	);
	await viewer.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(viewer).toHaveCount(0);
	assert.equal(
		await canRead(viewerURL),
		false,
		'Closing the viewer releases media without a mounted thumbnail'
	);
	assert.equal(await canRead(url), true, 'Closing the viewer preserves the mounted thumbnail');
	await page.getByRole('button', { name: 'Like, 0', exact: true }).first().click();
	await expect(page.getByRole('button', { name: 'Like, 1', exact: true })).toBeEnabled();
	assert.equal(
		await imageView.getAttribute('src'),
		url,
		'Metadata refresh preserves mounted bytes'
	);
	await page.getByRole('button', { name: 'Next attachment', exact: true }).first().click();
	const deferredImage = page.getByRole('img', { name: 'Lifecycle extra 1', exact: true });
	await expect(deferredImage).toHaveAttribute('src', /^blob:/);
	await expect(deferredImage).toHaveJSProperty('naturalWidth', 6);
	const navigation = page.getByRole('navigation', { name: 'Fluo navigation', exact: true });
	await navigation.getByRole('button', { name: 'Saved', exact: true }).click();
	await expect(imageView).toHaveCount(0);
	assert.equal(await canRead(url), false, 'Leaving the view revokes its decrypted URL');
	await navigation.getByRole('button', { name: 'Feed', exact: true }).click();
	await expect(imageView).toHaveAttribute('src', /^blob:/);
	const reopened = await imageView.getAttribute('src');
	assert.notEqual(reopened, url, 'A cached post reacquires released media bytes');
	assert.equal(await canRead(reopened), true);
	assert.deepEqual(errors, []);
});

test('Fluo bounds encrypted search and continues through older posts on request', async ({
	startAppFixture
}) => {
	const { page, origin, errors } = await startAppFixture('fluo');
	const cursors = [];
	await page.route('**/v1/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		let body = fluoAccountFixtureResponse(request, [actor, partner], { viewerId: actor.id });
		if (body) return route.fulfill({ json: body });
		if (url.pathname === '/v1/session' || url.pathname === '/v1/me') body = actor;
		else if (url.pathname.endsWith('/unread-count')) body = { unreadCount: 0 };
		else if (url.pathname === '/v1/fluo/posts') {
			const cursor = url.searchParams.get('cursor');
			cursors.push(cursor);
			const index = Number(cursor ?? 0);
			body = {
				items: [
					post(800 + index, index === 4 ? 'Needle in older posts' : `Unrelated page ${index}`)
				],
				nextCursor: index < 8 ? String(index + 1) : null
			};
		} else
			throw new Error(`Unexpected search fixture request: ${request.method()} ${url.pathname}`);
		return route.fulfill({ json: body });
	});
	await page.goto(`${origin}/fluo/#search`);
	await expect(
		page.getByText('Enter at least two characters to search.', { exact: true })
	).toBeVisible();
	const initialRequests = cursors.length;
	await page.getByRole('searchbox', { name: 'Search posts' }).fill('needle');
	await expect(page.getByText('No matches in these posts.', { exact: true })).toBeVisible();
	assert.deepEqual(
		cursors.slice(initialRequests),
		[null, '1', '2'],
		'A missing term scans at most three pages before yielding'
	);
	await page.getByRole('button', { name: 'Search older posts', exact: true }).click();
	await expect(page.getByText('Needle in older posts', { exact: true })).toBeVisible();
	assert.deepEqual(cursors.slice(initialRequests), [null, '1', '2', '3', '4', '5']);
	assert.deepEqual(errors, []);
});

test('Fluo preserves post history after reload and composes replies and quotes', async ({
	startAppFixture
}) => {
	const { page, origin, errors } = await startAppFixture('fluo');
	const navigations = [];
	page.on('framenavigated', (frame) => {
		if (frame === page.mainFrame()) navigations.push(frame.url());
	});
	const parent = encryptedPost({
		...readablePost(9, 'Nested original'),
		author: { ...actor, following: false }
	});
	const original = encryptedPost(
		{ ...readablePost(10, 'Original with media'), quoteId: parent.id, quote: parent },
		{ images: [image] }
	);
	const quoted = encryptedPost({
		...readablePost(11, 'Quotation'),
		quoteId: original.id,
		quote: original
	});
	const posts = [quoted, ...Array.from({ length: 12 }, (_, i) => post(20 + i, `Feed item ${i}`))];
	const postsById = new Map([parent, original, ...posts].map((item) => [item.id, item]));
	const writes = [];
	await page.route('**/v1/**', async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		let body = fluoAccountFixtureResponse(request, [actor, partner], { viewerId: actor.id });
		if (body) {
			await route.fulfill({ json: body });
			return;
		}
		if (path === '/v1/session' || path === '/v1/me') body = actor;
		else if (path === '/v1/fluo/notifications/unread-count') body = { unreadCount: 0 };
		else if (path === '/v1/fluo/notifications')
			body = { items: [], nextCursor: null, through: null, unreadCount: 0 };
		else if (path.endsWith('/comments')) body = { items: [], nextCursor: null };
		else if (path.endsWith('/thread')) {
			const thread = [];
			let current = postsById.get(path.split('/').at(-2));
			while (current) {
				thread.unshift(current);
				current = current.parentId ? postsById.get(current.parentId) : undefined;
			}
			body = { posts: thread };
		} else if (path === '/v1/fluo/posts' && request.method() === 'POST') {
			const input = request.postDataJSON();
			writes.push({ ...input, opened: openPost(input.content) });
			body = {
				...readablePost(50 + writes.length, 'Created'),
				...input,
				text: postText(input.content),
				author: { ...actor, following: false }
			};
		} else if (path === '/v1/fluo/posts') {
			const search = new URL(request.url()).searchParams.get('q');
			body = {
				items: search ? posts.filter((item) => item.text.includes(search)) : posts,
				nextCursor: null
			};
		} else if (path === `/v1/fluo/posts/${original.id}`) body = original;
		else if (path === `/v1/fluo/posts/${parent.id}`) body = parent;
		else throw new Error(`Unexpected Fluo fixture request: ${request.method()} ${path}`);
		await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
	});
	const quoteLink = page.getByRole('button', { name: 'Open quoted post by reader' });
	const composerDialog = page.getByRole('dialog');
	await page.goto(`${origin}/fluo/`);
	await quoteLink.waitFor();
	const navigationsBeforeComposer = navigations.length;
	const replyAction = page.getByRole('button', { name: 'Reply, 0', exact: true }).first();
	await replyAction.click();
	await composerDialog.getByRole('heading', { name: 'Reply to post', exact: true }).waitFor();
	const editor = composerDialog.locator('[contenteditable="true"]');
	await editor.waitFor({ state: 'visible', timeout: 10_000 }).catch(async (cause) => {
		const state = await page.evaluate(() => ({
			url: location.href,
			dialogs: [...document.querySelectorAll('[role="dialog"]')].map((dialog) => dialog.innerText),
			page: document.body.innerText.slice(-1_000)
		}));
		throw new Error(
			`Composer editor did not mount: ${JSON.stringify(state)}; navigations: ${navigations.join('; ')}; client errors: ${errors.join('; ')}`,
			{ cause }
		);
	});
	assert.equal(
		navigations.length,
		navigationsBeforeComposer,
		'Opening the lazy editor does not reload the page'
	);
	await editor.fill('Reply after refactor');
	assert.equal(
		await composerDialog
			.getByRole('button', { name: 'Post options', exact: true })
			.getAttribute('aria-expanded'),
		'false',
		'Typing does not open advanced controls'
	);
	await composerDialog.getByRole('button', { name: 'Reply', exact: true }).click();
	await composerDialog.waitFor({ state: 'hidden' });
	assert.equal(writes[0].parentId, quoted.id);
	assert.equal(writes[0].content.version, 1, 'Post writes contain a signed ciphertext envelope');
	assert.equal(writes[0].opened.content.content[0].content[0].text, 'Reply after refactor');

	await page.getByRole('button', { name: 'Quote, 0', exact: true }).first().click();
	await composerDialog.getByRole('heading', { name: 'Quote post', exact: true }).waitFor();
	await editor.fill('Quote after refactor');
	const positions = await composerDialog.evaluate((el) => ({
		editor: el.querySelector('[contenteditable]').getBoundingClientRect().top,
		quoted: el.querySelector('[aria-label="Quoted post"]').getBoundingClientRect().top
	}));
	assert.ok(positions.editor < positions.quoted, 'Quote text is above the original post');
	await composerDialog.getByRole('button', { name: 'Quote', exact: true }).click();
	await composerDialog.waitFor({ state: 'hidden' });
	assert.equal(writes[1].quoteId, quoted.id);

	await quoteLink.click();
	await page.getByText('Original with media', { exact: true }).waitFor();
	await page.waitForFunction((postId) => location.hash === `#post/${postId}`, original.id);
	await page.reload();
	await page.getByText('Original with media', { exact: true }).waitFor();
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await page.waitForFunction(() => location.hash === '#feed');
	await quoteLink.click();
	await page.getByText('Original with media', { exact: true }).waitFor();
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await page.waitForFunction(() => location.hash === '#feed');
	await expect(
		page.locator('[aria-label="Post"] article'),
		'Back returns to the feed without reopening the focused post'
	).toHaveCount(0);

	await quoteLink.click();
	await page.getByText('Original with media', { exact: true }).waitFor();
	await page.getByRole('button', { name: 'Open quoted post by writer' }).click();
	await page.getByText('Nested original', { exact: true }).waitFor();
	await page.waitForFunction((postId) => location.hash === `#post/${postId}`, parent.id);
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await page.waitForFunction((postId) => location.hash === `#post/${postId}`, original.id);
	await page.getByText('Original with media', { exact: true }).waitFor();
	await page.getByRole('button', { name: 'Back', exact: true }).click();
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
	assert.deepEqual(errors, [], 'No client runtime errors');
});

test('Fluo pastes media into the shared attachment queue and preserves text paste', async ({
	startAppFixture
}) => {
	const { page, origin, errors } = await startAppFixture('fluo');
	await page.route('**/v1/**', async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		const body =
			fluoAccountFixtureResponse(request, [actor, partner], { viewerId: actor.id }) ??
			(path === '/v1/session' || path === '/v1/me'
				? actor
				: path === '/v1/fluo/notifications/unread-count'
					? { unreadCount: 0 }
					: { items: [], nextCursor: null, through: null, unreadCount: 0 });
		await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
	});
	await page.goto(`${origin}/fluo/`);
	await page.getByRole('button', { name: 'Post', exact: true }).first().click();
	const dialog = page.getByRole('dialog');
	const editor = dialog.getByRole('textbox', { name: 'Post text', exact: true });
	await editor.waitFor();
	const attachments = dialog
		.getByRole('list', { name: 'Attachments', exact: true })
		.getByRole('listitem');
	const png = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1c8AAAAASUVORK5CYII=',
		'base64'
	);
	const clipboardImage = (name) => ({ name, type: 'image/png', bytes: [...png] });
	const paste = (files = [], text = '', html = '', itemsOnly = false) =>
		editor.evaluate(
			(element, input) => {
				const clipboardData = new DataTransfer();
				for (const { name, type, bytes } of input.files) {
					clipboardData.items.add(new File([new Uint8Array(bytes)], name, { type }));
				}
				if (input.text) clipboardData.setData('text/plain', input.text);
				if (input.html) clipboardData.setData('text/html', input.html);
				if (input.itemsOnly) Object.defineProperty(clipboardData, 'files', { value: [] });
				const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
				Object.defineProperty(event, 'clipboardData', { value: clipboardData });
				element.dispatchEvent(event);
			},
			{ files, text, html, itemsOnly }
		);

	await paste([], 'Pasted text');
	await expect(editor, 'Text-only paste follows the editor behavior').toHaveText('Pasted text');
	await paste(
		[clipboardImage('clipboard.png')],
		' Caption bold',
		'<p> Caption <strong>bold</strong></p>',
		true
	);
	await dialog.getByRole('button', { name: 'Remove clipboard.png', exact: true }).waitFor();
	assert.equal(await attachments.count(), 1, 'A pasted image is attached once');
	await expect(
		editor.locator('strong'),
		'Rich text accompanying media retains its formatting'
	).toHaveText('bold');
	assert.equal(
		await editor.locator('img').count(),
		0,
		'Media uses attachment previews rather than embedded editor nodes'
	);

	await paste([
		{ name: 'clipboard.webm', type: 'video/webm', bytes: [1, 2, 3] },
		{ name: 'notes.pdf', type: 'application/pdf', bytes: [4, 5, 6] }
	]);
	await dialog.getByRole('button', { name: 'Remove clipboard.webm', exact: true }).waitFor();
	assert.equal(
		await attachments.count(),
		2,
		'Supported videos are attached and unrelated files are ignored'
	);

	await dialog.getByLabel('Choose photos or videos', { exact: true }).setInputFiles([
		{ name: 'selected-1.png', mimeType: 'image/png', buffer: png },
		{ name: 'selected-2.png', mimeType: 'image/png', buffer: png }
	]);
	assert.equal(await attachments.count(), 4, 'File selection and paste share one queue');
	await paste([clipboardImage('overflow.png')]);
	await dialog.getByRole('alert').waitFor();
	assert.equal(await dialog.getByRole('alert').textContent(), 'Add at most 4 files.');
	assert.equal(await attachments.count(), 4, 'Pasting cannot bypass the attachment limit');

	await dialog.getByRole('button', { name: 'Remove clipboard.png', exact: true }).click();
	await paste([clipboardImage('replacement.png')]);
	await dialog.getByRole('button', { name: 'Remove replacement.png', exact: true }).waitFor();
	assert.equal(await attachments.count(), 4, 'Removing an attachment frees a slot for paste');
	assert.equal(
		await dialog.getByRole('alert').count(),
		0,
		'Successful paste clears the previous selection error'
	);
	assert.deepEqual(errors, [], 'No client runtime errors');
});

test('Ligo starts at the bottom, keeps rapid scrolling native and shares the composer', async ({
	startAppFixture
}) => {
	const { page, origin, errors } = await startAppFixture('ligo');
	const conversation = {
		id: id(60),
		kind: 'duo',
		title: '',
		createdBy: actor.id,
		members: [actor, partner],
		lastMessage: null,
		unreadCount: 0,
		createdAt: now,
		updatedAt: now
	};
	const messages = Array.from({ length: 45 }, (_, i) =>
		encryptedMessage(
			{
				id: id(100 + i),
				clientId: id(200 + i),
				conversationId: conversation.id,
				sender: i % 2 ? actor : partner,
				text: `Message ${i}`,
				media: [],
				reactions: [],
				status: 'read',
				editedAt: null,
				deleted: false,
				systemNotice: false,
				createdAt: now
			},
			[actor.id, partner.id],
			i === 44
				? [image]
				: i === 43
					? [
							{
								id: id(4),
								kind: 'file',
								mimeType: 'text/plain',
								filename: 'fixture.txt',
								width: 0,
								height: 0,
								data: Buffer.from('Device-decrypted download')
							}
						]
					: []
		)
	);
	await page.route('**/v1/**', async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		let body = fluoAccountFixtureResponse(request, [actor, partner], { viewerId: actor.id });
		if (body) {
			await route.fulfill({ json: body });
			return;
		}
		if (path === '/v1/session' || path === '/v1/me') body = actor;
		else if (path.endsWith('/events')) {
			await route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
			return;
		} else if (path.endsWith('/read') || path.endsWith('/delivered')) {
			await route.fulfill({ status: 204 });
			return;
		} else if (path.endsWith('/messages') && request.method() === 'POST') {
			body = {
				...messages.at(-1),
				...request.postDataJSON(),
				id: id(500),
				sender: actor,
				media: []
			};
			messages.push(body);
		} else if (path.endsWith('/messages'))
			body = { items: [...messages].reverse(), nextCursor: null };
		else if (path === '/v1/ligo/conversations') body = { items: [conversation], nextCursor: null };
		else if (path === `/v1/ligo/conversations/${conversation.id}`) body = conversation;
		else throw new Error(`Unexpected Ligo fixture request: ${request.method()} ${path}`);
		await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
	});
	await page.goto(`${origin}/ligo/#c/${conversation.id}`);
	const log = page.getByRole('log', { name: 'Messages' });
	await log.waitFor({ state: 'visible' });
	const downloadAction = log.getByRole('button', { name: 'Download fixture.txt', exact: true });
	await expect(downloadAction).toBeVisible();
	const downloadPromise = page.waitForEvent('download');
	await downloadAction.click();
	const downloaded = await downloadPromise;
	assert.equal(downloaded.suggestedFilename(), 'fixture.txt');
	assert.equal(await readFile(await downloaded.path(), 'utf8'), 'Device-decrypted download');
	await page.waitForFunction(() => {
		const el = document.querySelector('[role="log"]');
		return (
			el &&
			el.scrollHeight > el.clientHeight &&
			Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 2
		);
	});
	for (let i = 0; i < 4; i++) {
		await log.evaluate(
			(el) =>
				new Promise((resolve) => {
					el.scrollTop = 0;
					requestAnimationFrame(() => requestAnimationFrame(resolve));
				})
		);
		await log.hover();
		const { clientHeight, scrollHeight } = await log.evaluate((el) => ({
			clientHeight: el.clientHeight,
			scrollHeight: el.scrollHeight
		}));
		for (let step = 0; step < Math.ceil(scrollHeight / clientHeight) + 2; step++)
			await page.mouse.wheel(0, clientHeight);
		await page.waitForFunction(
			() => {
				const el = document.querySelector('[role="log"]');
				return el && el.scrollHeight - el.clientHeight - el.scrollTop <= 2;
			},
			null,
			{ timeout: 3000 }
		);
		const distance = await log.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
		assert.ok(distance <= 2, `Rapid bottom scroll ${i} remains at the end (${distance}px)`);
	}
	assert.equal(
		await log.getByText('Reader', { exact: true }).count(),
		0,
		'Duo messages do not repeat sender names'
	);
	const input = page.getByRole('textbox', { name: 'Write a message' });
	await input.fill('Sent after refactor');
	await input.press('Enter');
	await log.locator('p').filter({ hasText: 'Sent after refactor' }).first().waitFor();
	const oneLineHeight = await input.evaluate((el) => el.clientHeight);
	await input.fill(Array.from({ length: 15 }, () => 'A longer draft').join('\n'));
	const expanded = await input.evaluate((el) => ({
		height: el.clientHeight,
		scroll: el.scrollHeight
	}));
	assert.ok(
		expanded.height > oneLineHeight && expanded.scroll > expanded.height,
		'Composer grows then scrolls'
	);
	await page.getByLabel('Choose files', { exact: true }).setInputFiles({
		name: 'preview.png',
		mimeType: 'image/png',
		buffer: Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1c8AAAAASUVORK5CYII=',
			'base64'
		)
	});
	await page.getByRole('img', { name: 'Preview of preview.png', exact: true }).waitFor();
	assert.deepEqual(errors, [], 'No client runtime errors');
});

for (const app of ['ligo', 'rondo']) {
	test(`${app} pastes clipboard media and captions within the shared attachment limit`, async ({
		startAppFixture
	}) => {
		const { page, origin, errors } = await startAppFixture(app);
		const conversation = {
			id: id(60),
			kind: 'duo',
			title: '',
			createdBy: actor.id,
			members: [actor, partner],
			lastMessage: null,
			unreadCount: 0,
			createdAt: now,
			updatedAt: now
		};
		const {
			server,
			channels: [channel]
		} = encryptedCommunity(
			{
				id: id(70),
				name: 'Clipboard community',
				description: '',
				access: 'private',
				ownerId: actor.id,
				memberCount: 1,
				joined: true,
				createdAt: now
			},
			[
				{
					id: id(71),
					serverId: id(70),
					conversationId: conversation.id,
					name: 'general',
					position: 0,
					createdAt: now
				}
			],
			[actor.id, partner.id]
		);
		await page.route('**/v1/**', async (route) => {
			const request = route.request();
			const path = new URL(request.url()).pathname;
			let body = fluoAccountFixtureResponse(request, [actor, partner], { viewerId: actor.id });
			if (body) {
				await route.fulfill({ json: body });
				return;
			}
			if (path === '/v1/session' || path === '/v1/me') body = actor;
			else if (path.endsWith('/events')) {
				await route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
				return;
			} else if (path.endsWith('/read') || path.endsWith('/delivered')) {
				await route.fulfill({ status: 204 });
				return;
			} else if (path === '/v1/ligo/conversations')
				body = { items: [conversation], nextCursor: null };
			else if (path === `/v1/ligo/conversations/${conversation.id}`) body = conversation;
			else if (path === `/v1/ligo/conversations/${conversation.id}/messages`)
				body = { items: [], nextCursor: null };
			else if (path === '/v1/rondo/servers') body = { items: [server] };
			else if (path === `/v1/rondo/servers/${server.id}`)
				body = { server, channels: [channel], members: [actor] };
			else
				throw new Error(`Unexpected ${app} clipboard fixture request: ${request.method()} ${path}`);
			await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
		});
		await page.goto(
			`${origin}/${app}/${app === 'ligo' ? `#c/${conversation.id}` : `#s/${server.id}`}`
		);
		if (app === 'rondo') await page.getByRole('button', { name: 'general', exact: true }).click();
		const input = page.getByRole('textbox', { name: 'Write a message', exact: true });
		await input.waitFor();
		await input.fill('Existing draft');

		// A real user gesture owns the clipboard write in engines without Chromium's permission API
		await page.evaluate(() => {
			const trigger = document.createElement('button');
			trigger.dataset.testid = 'fixture-clipboard';
			trigger.textContent = 'Prepare clipboard fixture';
			trigger.onclick = () => {
				const canvas = document.createElement('canvas');
				canvas.width = canvas.height = 2;
				const png = new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
				navigator.clipboard
					.write([
						new ClipboardItem({
							'image/png': png,
							'text/plain': new Blob([' pasted caption'], { type: 'text/plain' })
						})
					])
					.then(
						() => {
							trigger.dataset.state = 'ready';
						},
						(error) => {
							trigger.dataset.state = error.message;
						}
					);
			};
			document.body.append(trigger);
		});
		const clipboardTrigger = page.getByTestId('fixture-clipboard');
		await clipboardTrigger.click();
		await expect(clipboardTrigger).toHaveAttribute('data-state', 'ready');
		await clipboardTrigger.evaluate((element) => element.remove());
		await input.focus();
		await input.press('ControlOrMeta+V');
		const selected = page.getByLabel('Selected attachments', { exact: true });
		await selected.getByRole('img').waitFor();
		assert.equal(
			await input.inputValue(),
			'Existing draft pasted caption',
			'Native paste preserves the caption and existing draft'
		);

		const pasteFile = (name, type) =>
			input.evaluate(
				(element, file) => {
					const clipboardData = new DataTransfer();
					clipboardData.items.add(
						new File([new Uint8Array([1, 2, 3])], file.name, { type: file.type })
					);
					Object.defineProperty(clipboardData, 'files', { value: [] });
					const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
					Object.defineProperty(event, 'clipboardData', { value: clipboardData });
					element.dispatchEvent(event);
				},
				{ name, type }
			);
		await pasteFile('clipboard.webm', 'video/webm');
		await selected.getByLabel('Preview of clipboard.webm', { exact: true }).waitFor();
		assert.equal(
			await input.inputValue(),
			'Existing draft pasted caption',
			'Media-only paste keeps the draft'
		);

		const png = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1c8AAAAASUVORK5CYII=',
			'base64'
		);
		await page.getByLabel('Choose files', { exact: true }).setInputFiles(
			Array.from({ length: 6 }, (_, index) => ({
				name: `selected-${index}.png`,
				mimeType: 'image/png',
				buffer: png
			}))
		);
		const removeButtons = selected.getByRole('button', { name: /^Remove / });
		assert.equal(await removeButtons.count(), 8, 'Pasted and selected files share the same queue');
		await pasteFile('overflow.webm', 'video/webm');
		const limitError = page
			.getByRole('alert')
			.filter({ hasText: 'Attach at most 8 files.' })
			.first();
		await limitError.waitFor();
		assert.equal(await limitError.textContent(), 'Attach at most 8 files.');
		assert.equal(await removeButtons.count(), 8, 'Paste respects the attachment limit');

		await selected.getByRole('button', { name: 'Remove clipboard.webm', exact: true }).click();
		await pasteFile('replacement.webm', 'video/webm');
		await selected.getByLabel('Preview of replacement.webm', { exact: true }).waitFor();
		assert.equal(await removeButtons.count(), 8, 'Removing an attachment frees a slot for paste');
		assert.equal(
			await page.getByRole('alert').count(),
			0,
			'Successful paste clears the selection error'
		);
		assert.deepEqual(errors, [], 'No client runtime errors');
	});
}
