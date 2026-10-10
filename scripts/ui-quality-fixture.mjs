// Owns synthetic account and product data for repeatable interface audits without live user content

import { fluoAccountFixtureResponse } from './fluo-account-fixture.mjs';
import {
	currentSessionId,
	encryptedCommunity,
	encryptedMessage,
	encryptedPost,
	openPost,
	openShared,
	postText,
	privateRecords
} from './encryption-fixture.mjs';

export const fixtureId = (n) => `01999111-2222-7333-8444-${String(n).padStart(12, '0')}`;
const now = '2026-10-07T10:00:00Z';
export const viewer = {
	id: fixtureId(1),
	username: 'writer',
	displayName: 'Alex Morgan',
	createdAt: now,
	isAdmin: true
};
const partner = {
	...viewer,
	id: fixtureId(2),
	username: 'reader',
	displayName: 'Sam Rivera',
	isAdmin: false
};
const document = (text) => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
});
const image = { id: fixtureId(3), altText: 'An illustrated mountain landscape' };
const readablePost = (n, text, own = false) => ({
	id: fixtureId(n),
	author: { ...(own ? viewer : partner), following: false },
	content: document(text),
	text,
	visibility: 'public',
	parentId: null,
	quoteId: null,
	quoteDeleted: false,
	quote: null,
	media: [],
	counts: { good: 12, bad: 1, comments: 2, quotes: 1, saves: 0 },
	myReaction: null,
	saved: false,
	createdAt: now,
	updatedAt: now
});
// Posts are sealed with their authors' audience keys exactly as a device would publish them
const post = (n, text, own = false) =>
	encryptedPost(readablePost(n, text, own), { images: n === 10 ? [image] : [] });
const members = [viewer.id, partner.id];

// Keycloak's account API: this browser, a tablet and a laptop signed in to the same account
async function installAccountSessions(page) {
	const seconds = (offset) => Math.floor(Date.parse(now) / 1000) + offset;
	const sessions = [
		{
			id: currentSessionId,
			browser: 'Chrome/129.0.6668',
			os: 'Mac OS X',
			osVersion: '10.15.7',
			device: 'Mac',
			mobile: false,
			current: true
		},
		{
			id: 'session-tablet',
			browser: 'Mobile Safari/18.0',
			os: 'iOS',
			osVersion: '18.0',
			device: 'iPad',
			mobile: true
		},
		{
			id: 'session-laptop',
			browser: 'Firefox/131.0',
			os: 'Windows',
			osVersion: '11',
			device: 'Other',
			mobile: false
		}
	].map((session, index) => ({
		...session,
		ipAddress: `192.0.2.${10 + index}`,
		started: seconds(-86_400 * (index + 1)),
		lastAccess: seconds(-600 * index),
		expires: seconds(86_400 * 30)
	}));
	await page.route('**/realms/*/account/sessions**', async (route) => {
		const request = route.request();
		if (request.method() === 'GET') {
			await route.fulfill({
				json: sessions.map(({ os, osVersion, device, mobile, ...session }) => ({
					os,
					osVersion,
					device,
					mobile,
					sessions: [session]
				}))
			});
			return;
		}
		const ended = new URL(request.url()).pathname.split('/sessions/')[1];
		const kept = sessions.filter((session) =>
			ended ? session.id !== decodeURIComponent(ended) : session.current
		);
		sessions.splice(0, sessions.length, ...kept);
		await route.fulfill({ status: 204 });
	});
}

export async function installQualityFixture(page, app, { uploadOrigin, devices } = {}) {
	const posts = [
		post(10, 'A quiet moment between the mountains and the sky.'),
		post(11, 'Small steps, shared ideas and a little time to learn.', true)
	];
	const conversation = {
		id: fixtureId(60),
		kind: 'duo',
		title: '',
		createdBy: viewer.id,
		members: [viewer, partner],
		lastMessage: null,
		unreadCount: 2,
		createdAt: now,
		updatedAt: now
	};
	const community = encryptedCommunity(
		{
			id: fixtureId(70),
			name: 'The common room',
			description: 'A place to share ideas and make things together.',
			access: 'private',
			ownerId: viewer.id,
			memberCount: 2,
			joined: true,
			createdAt: now
		},
		[
			{
				id: fixtureId(71),
				serverId: fixtureId(70),
				conversationId: conversation.id,
				name: 'general',
				position: 0,
				createdAt: now
			}
		],
		members
	);
	const {
		server,
		channels: [channel]
	} = community;
	const messages = Array.from({ length: 15 }, (_, i) =>
		encryptedMessage(
			{
				id: fixtureId(100 + i),
				clientId: fixtureId(200 + i),
				conversationId: conversation.id,
				sender: i % 2 ? viewer : partner,
				text:
					i === 14
						? 'Sounds good! See you tomorrow.'
						: i === 13
							? 'Shall we meet at the café tomorrow? We can bring our notes and spend some time on the new ideas.'
							: `A thought for our next conversation ${i + 1}.`,
				media: [],
				reactions: i === 14 ? [{ emoji: '❤️', count: 1, mine: true }] : [],
				status: 'read',
				editedAt: null,
				deleted: false,
				systemNotice: false,
				createdAt: now
			},
			members,
			i === 12 ? [image] : []
		)
	);
	let settings = {
		notifications: {
			likes: 'all',
			dislikes: 'off',
			replies: 'all',
			follows: 'all',
			unfollows: 'off',
			quotes: 'all'
		},
		privacy: { accountVisibility: 'public', showLikes: true, presenceVisibility: 'all' }
	};
	let notifications = [
		{
			id: fixtureId(90),
			kind: 'like',
			actor: partner,
			post: posts[0],
			readAt: null,
			createdAt: now
		},
		{ id: fixtureId(91), kind: 'follow', actor: partner, post: null, readAt: now, createdAt: now }
	];
	const dictionary = {
		id: fixtureId(80),
		learningLanguage: 'de',
		nativeLanguage: 'en',
		dailyGoal: 20,
		timeZone: 'Europe/Berlin',
		createdAt: now
	};
	const folders = [{ id: fixtureId(81), dictionaryId: dictionary.id, name: 'Everyday German' }];
	const card = (n, kind, term, translation) => ({
		id: fixtureId(n),
		dictionaryId: dictionary.id,
		kind,
		term,
		translation,
		partOfSpeech: kind === 'word' ? 'noun' : '',
		article: kind === 'word' ? 'das' : '',
		plural: kind === 'word' ? 'die Bücher' : '',
		grammar: '',
		example: kind === 'word' ? 'Ich lese ein Buch.' : '',
		exampleTranslation: kind === 'word' ? 'I am reading a book.' : '',
		notes: '',
		folderId: folders[0].id,
		status: 'active',
		sourceKey: null,
		revision: 1,
		createdAt: now,
		schedule: {
			due: now,
			stability: 0,
			difficulty: 0,
			scheduledDays: 0,
			reps: 0,
			lapses: 0,
			state: 0,
			lastReview: null,
			learningSteps: 0
		}
	});
	const cards = [
		card(82, 'word', 'Buch', 'book'),
		card(83, 'phrase', 'Einen Kaffee, bitte.', 'A coffee, please.')
	];
	const catalog = {
		items: [
			{
				id: 'everyday-words',
				kind: 'word',
				level: 'A1',
				title: 'Everyday essentials',
				description: 'Useful words for your first conversations.',
				cards: [cards[0]]
			},
			{
				id: 'cafe-phrases',
				kind: 'phrase',
				level: 'A1',
				title: 'At the café',
				description: 'Order a coffee and start a conversation.',
				cards: [cards[1]]
			}
		]
	};
	// Lingvo state lives only in owner-encrypted records, as written by a previously approved device
	const lingvo = privateRecords(viewer.id, 'lingvo');
	const records = [
		lingvo.seal('dictionaries', [dictionary]),
		lingvo.seal(`${dictionary.id}/dictionary`, {
			version: 1,
			dictionary,
			folders,
			cards: cards.map((item) => ({ id: item.id, revision: 1 })),
			activity: [{ day: '2026-10-07', reviews: 4 }],
			totalReviews: 24,
			reviewMonths: []
		}),
		...cards.map((item) => lingvo.seal(`${dictionary.id}/card/${item.id}`, item))
	];
	const memoroDays = new Map();
	const failures = new Map();
	const requests = [];
	await installAccountSessions(page);
	await page.route('**/v1/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname;
		const method = request.method();
		const entry = {
			path,
			method,
			body: request.headers()['content-type']?.includes('application/json')
				? request.postDataJSON()
				: null
		};
		requests.push(entry);
		if (path.startsWith('/v1/uploads/')) {
			if (!uploadOrigin) throw new Error('Media submission requires an owned HTTP upload fixture');
			await route.continue({ url: new URL(path, uploadOrigin).href });
			return;
		}
		if (path.startsWith('/v1/media/') && uploadOrigin) {
			await route.continue();
			return;
		}
		if (path.endsWith('/events')) {
			await route.fulfill({ status: 403, json: {} });
			return;
		}
		if (path.startsWith('/v1/ligo/') && (path.endsWith('/read') || path.endsWith('/delivered'))) {
			await route.fulfill({ status: 204 });
			return;
		}
		if (failures.has(path)) {
			await route.fulfill({ status: 503, json: { error: failures.get(path) } });
			return;
		}
		let body = fluoAccountFixtureResponse(request, [viewer, partner], {
			viewerId: viewer.id,
			privacy: settings.privacy,
			records,
			devices
		});
		if (body) {
			await route.fulfill({ json: body });
			return;
		}
		if (entry.body?.content?.keyring) entry.opened = openPost(entry.body.content);
		else if (entry.body?.text?.startsWith('kaordo:e2ee:v1:'))
			entry.opened = openShared(entry.body.text);
		const media = (ids) =>
			(ids ?? []).map((id) => ({
				id,
				kind: 'file',
				mimeType: 'application/octet-stream',
				filename: id + '.bin',
				width: 0,
				height: 0,
				size: 0,
				altText: '',
				url: uploadOrigin + '/v1/media/' + id
			}));
		if (path === '/v1/session' || path === '/v1/me') body = viewer;
		else if (path === '/v1/accounts') body = { items: [partner], nextCursor: null };
		else if (path === '/v1/fluo/settings') {
			if (method === 'PATCH') {
				const input = request.postDataJSON();
				settings = {
					notifications: { ...settings.notifications, ...input.notifications },
					privacy: { ...settings.privacy, ...input.privacy }
				};
			}
			body = settings;
		} else if (path === '/v1/fluo/notifications/unread-count')
			body = { unreadCount: notifications.filter((item) => !item.readAt).length };
		else if (path === '/v1/fluo/notifications/read') {
			const input = request.postDataJSON();
			notifications = notifications.map((item) =>
				input.through || item.id === input.id ? { ...item, readAt: now } : item
			);
			body = { unreadCount: notifications.filter((item) => !item.readAt).length, readAt: now };
		} else if (/^\/v1\/fluo\/notifications\/[^/]+\/read$/.test(path)) {
			notifications = notifications.map((item) =>
				item.id === path.split('/')[4] ? { ...item, readAt: now } : item
			);
			body = { unreadCount: notifications.filter((item) => !item.readAt).length, readAt: now };
		} else if (path === '/v1/fluo/notifications')
			body = {
				items: notifications,
				nextCursor: null,
				through: fixtureId(91),
				unreadCount: notifications.filter((item) => !item.readAt).length
			};
		else if (path === '/v1/fluo/posts' && method === 'POST') {
			body = {
				...readablePost(30 + posts.length, 'New post', true),
				...entry.body,
				text: postText(entry.body.content),
				media: media(entry.body.attachmentIds)
			};
			posts.unshift(body);
			await route.fulfill({ status: 201, json: body });
			return;
		} else if (path === '/v1/fluo/posts') {
			const feed = url.searchParams.get('feed');
			const authorId = url.searchParams.get('authorId');
			const search = url.searchParams.get('q')?.toLowerCase();
			const items = posts
				.filter((item) => feed !== 'mine' || item.author.id === viewer.id)
				.filter((item) => !authorId || item.author.id === authorId)
				.filter((item) => feed !== 'saved' || item.saved)
				.filter(
					(item) =>
						!search ||
						(item.text + item.author.displayName + item.author.username)
							.toLowerCase()
							.includes(search)
				);
			body = { items, nextCursor: null };
		} else if (path.endsWith('/comments'))
			body = { items: [post(12, 'A beautiful place to take a breath.')], nextCursor: null };
		else if (path.endsWith('/thread')) body = { posts: [posts[0]] };
		else if (path.startsWith('/v1/fluo/posts/')) {
			body = posts.find((item) => item.id === path.split('/')[4]);
			if (path.endsWith('/reaction')) {
				const input = request.postDataJSON();
				body.myReaction = input.value;
			}
			if (path.endsWith('/saved')) {
				body.saved = method === 'PUT';
				await route.fulfill({ status: 204 });
				return;
			}
		} else if (path === '/v1/ligo/conversations')
			body = { items: [conversation], nextCursor: null };
		else if (path === `/v1/ligo/conversations/${conversation.id}`) body = conversation;
		else if (path === `/v1/ligo/conversations/${conversation.id}/messages` && method === 'POST') {
			const input = request.postDataJSON();
			body = {
				...messages.at(-1),
				id: fixtureId(100 + messages.length),
				clientId: input.clientId,
				sender: viewer,
				text: input.text,
				media: media(input.attachmentIds),
				reactions: [],
				status: 'sent'
			};
			messages.push(body);
			await route.fulfill({ status: 201, json: body });
			return;
		} else if (path === `/v1/ligo/conversations/${conversation.id}/messages`)
			body = { items: [...messages].reverse(), nextCursor: null };
		else if (path === '/v1/rondo/servers') body = { items: [server] };
		else if (path === `/v1/rondo/servers/${server.id}`)
			body = { server, channels: [channel], members: [viewer, partner] };
		else if (path === '/v1/lingvo/catalog') body = catalog;
		else if (path === '/v1/memoro/month') body = { items: [] };
		else if (path.startsWith('/v1/memoro/days/') && method === 'GET') {
			// Network latency keeps a superseded day request in flight while the next one starts
			await new Promise((resolve) => setTimeout(resolve, 150));
			body = { day: memoroDays.get(path.split('/').at(-1)) ?? null };
		} else if (path.startsWith('/v1/memoro/days/') && method === 'PUT') {
			const dayTag = path.split('/').at(-1);
			body = {
				dayTag,
				monthTag: entry.body.monthTag,
				revision: entry.body.revision + 1,
				nonce: entry.body.nonce,
				ciphertext: entry.body.ciphertext,
				media: []
			};
			memoroDays.set(dayTag, body);
		} else throw new Error(`Unexpected ${app} quality fixture request: ${method} ${path}`);
		if (!body) throw new Error(`Missing ${app} quality fixture response: ${method} ${path}`);
		await route.fulfill({ json: body });
	});
	return { dictionary, conversation, server, channel, posts, failures, requests };
}
