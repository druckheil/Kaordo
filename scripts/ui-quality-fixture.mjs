// Owns synthetic account and product data for repeatable interface audits without live user content

export const fixtureId = (n) => `01999111-2222-7333-8444-${String(n).padStart(12, '0')}`;
const now = '2026-10-07T10:00:00Z';
export const viewer = { id: fixtureId(1), username: 'writer', displayName: 'Alex Morgan', createdAt: now, isAdmin: true };
const partner = { ...viewer, id: fixtureId(2), username: 'reader', displayName: 'Sam Rivera', isAdmin: false };
const document = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const image = { id: fixtureId(3), kind: 'image', mimeType: 'image/svg+xml', width: 960, height: 640, size: 200, altText: 'An illustrated mountain landscape', url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="#dbe8e9"/><circle cx="750" cy="150" r="65" fill="#e6b985"/><path d="M0 640L320 160L650 640Z" fill="#578276"/><path d="M330 640L710 250L960 640Z" fill="#345b61"/></svg>') };
const post = (n, text, own = false) => ({ id: fixtureId(n), author: { ...(own ? viewer : partner), following: false }, content: document(text), text, visibility: 'public', parentId: null, quoteId: null, quoteDeleted: false, quote: null, media: n === 10 ? [image] : [], counts: { good: 12, bad: 1, comments: 2, quotes: 1, saves: 0 }, myReaction: null, saved: false, createdAt: now, updatedAt: now });

export async function installQualityFixture(page, app, { uploadOrigin } = {}) {
  const posts = [post(10, 'A quiet moment between the mountains and the sky.'), post(11, 'Small steps, shared ideas and a little time to learn.', true)];
  const conversation = { id: fixtureId(60), kind: 'duo', title: '', createdBy: viewer.id, members: [viewer, partner], lastMessage: null, unreadCount: 2, createdAt: now, updatedAt: now };
  const server = { id: fixtureId(70), name: 'The common room', description: 'A place to share ideas and make things together.', access: 'private', ownerId: viewer.id, memberCount: 2, joined: true, createdAt: now };
  const channel = { id: fixtureId(71), serverId: server.id, conversationId: conversation.id, name: 'general', position: 0, createdAt: now };
  const messages = Array.from({ length: 15 }, (_, i) => ({ id: fixtureId(100 + i), clientId: fixtureId(200 + i), conversationId: conversation.id, sender: i % 2 ? viewer : partner, text: i === 14 ? 'Sounds good! See you tomorrow.' : i === 13 ? 'Shall we meet at the café tomorrow? We can bring our notes and spend some time on the new ideas.' : `A thought for our next conversation ${i + 1}.`, media: i === 12 ? [image] : [], reactions: i === 14 ? [{ emoji: '❤️', count: 1, mine: true }] : [], status: 'read', editedAt: null, deleted: false, systemNotice: false, createdAt: now }));
  let settings = { notifications: { likes: 'all', dislikes: 'off', replies: 'all', follows: 'all', unfollows: 'off', quotes: 'all' }, privacy: { accountVisibility: 'public', showLikes: true } };
  let notifications = [{ id: fixtureId(90), kind: 'like', actor: partner, post: posts[0], readAt: null, createdAt: now }, { id: fixtureId(91), kind: 'follow', actor: partner, post: null, readAt: now, createdAt: now }];
  const dictionary = { id: fixtureId(80), learningLanguage: 'de', nativeLanguage: 'en', dailyGoal: 20, timeZone: 'Europe/Berlin', createdAt: now };
  const folders = [{ id: fixtureId(81), dictionaryId: dictionary.id, name: 'Everyday German' }];
  const card = (n, kind, term, translation) => ({ id: fixtureId(n), dictionaryId: dictionary.id, kind, term, translation, partOfSpeech: kind === 'word' ? 'noun' : '', article: kind === 'word' ? 'das' : '', plural: kind === 'word' ? 'die Bücher' : '', grammar: '', example: kind === 'word' ? 'Ich lese ein Buch.' : '', exampleTranslation: kind === 'word' ? 'I am reading a book.' : '', notes: '', folderId: folders[0].id, status: 'active', sourceKey: null, revision: 1, createdAt: now, schedule: { due: now, stability: 0, difficulty: 0, scheduledDays: 0, reps: 0, lapses: 0, state: 0, lastReview: null, learningSteps: 0 } });
  const cards = [card(82, 'word', 'Buch', 'book'), card(83, 'phrase', 'Einen Kaffee, bitte.', 'A coffee, please.')];
  const catalog = { items: [{ id: 'everyday-words', kind: 'word', level: 'A1', title: 'Everyday essentials', description: 'Useful words for your first conversations.', cards: [cards[0]] }, { id: 'cafe-phrases', kind: 'phrase', level: 'A1', title: 'At the café', description: 'Order a coffee and start a conversation.', cards: [cards[1]] }] };
  const failures = new Map();
  const requests = [];
  const reviews = new Map();
  const overview = () => ({ dictionary, folders, counts: ['word', 'phrase'].map(kind => ({ kind, total: cards.filter(card => card.kind === kind).length, due: 1, new: 1, learning: 0, review: 0, known: 0, suspended: 0, nextDue: null })), activity: [{ day: '2026-10-07', reviews: 4 }], studiedToday: 4, totalReviews: 24, streak: 3, today: '2026-10-07' });
  await page.route('**/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    requests.push({ path, method, body: request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null });
    if (path.startsWith('/v1/uploads/')) {
      if (!uploadOrigin) throw new Error('Media submission requires an owned HTTP upload fixture');
      await route.continue({ url: new URL(path, uploadOrigin).href });
      return;
    }
    if (failures.has(path)) { await route.fulfill({ status: 503, json: { error: failures.get(path) } }); return; }
    if (path.endsWith('/events')) { await route.fulfill({ status: 403, json: {} }); return; }
    if (path.startsWith('/v1/ligo/') && (path.endsWith('/read') || path.endsWith('/delivered'))) { await route.fulfill({ status: 204 }); return; }
    let body;
    if (path === '/v1/session' || path === '/v1/me') body = viewer;
    else if (path === '/v1/accounts') body = { items: [partner], nextCursor: null };
    else if (path === '/v1/fluo/settings') {
      if (method === 'PATCH') { const input = request.postDataJSON(); settings = { notifications: { ...settings.notifications, ...input.notifications }, privacy: { ...settings.privacy, ...input.privacy } }; }
      body = settings;
    } else if (path === '/v1/fluo/notifications/unread-count') body = { unreadCount: notifications.filter(item => !item.readAt).length };
    else if (path === '/v1/fluo/notifications/read') {
      const input = request.postDataJSON();
      notifications = notifications.map(item => input.through || item.id === input.id ? { ...item, readAt: now } : item);
      body = { unreadCount: notifications.filter(item => !item.readAt).length, readAt: now };
    } else if (/^\/v1\/fluo\/notifications\/[^/]+\/read$/.test(path)) {
      notifications = notifications.map(item => item.id === path.split('/')[4] ? { ...item, readAt: now } : item);
      body = { unreadCount: notifications.filter(item => !item.readAt).length, readAt: now };
    } else if (path === '/v1/fluo/notifications') body = { items: notifications, nextCursor: null, through: fixtureId(91), unreadCount: notifications.filter(item => !item.readAt).length };
    else if (path === '/v1/fluo/posts' && method === 'POST') {
      body = { ...post(30 + posts.length, 'New post', true), ...request.postDataJSON() }; posts.unshift(body);
      await route.fulfill({ status: 201, json: body });
      return;
    }
    else if (path === '/v1/fluo/posts') {
      const feed = url.searchParams.get('feed');
      const search = url.searchParams.get('q')?.toLowerCase();
      const items = posts.filter(item => feed !== 'mine' || item.author.id === viewer.id)
        .filter(item => feed !== 'saved' || item.saved)
        .filter(item => !search || (item.text + item.author.displayName + item.author.username).toLowerCase().includes(search));
      body = { items, nextCursor: null };
    }
    else if (path.endsWith('/comments')) body = { items: [post(12, 'A beautiful place to take a breath.')], nextCursor: null };
    else if (path.endsWith('/thread')) body = { posts: [posts[0]] };
    else if (path.startsWith('/v1/fluo/posts/')) {
      body = posts.find(item => item.id === path.split('/')[4]);
      if (path.endsWith('/reaction')) { const input = request.postDataJSON(); body.myReaction = input.value; }
      if (path.endsWith('/saved')) { body.saved = method === 'PUT'; await route.fulfill({ status: 204 }); return; }
    } else if (path === '/v1/ligo/conversations') body = { items: [conversation], nextCursor: null };
    else if (path === `/v1/ligo/conversations/${conversation.id}`) body = conversation;
    else if (path === `/v1/ligo/conversations/${conversation.id}/messages` && method === 'POST') {
      const input = request.postDataJSON();
      body = { ...messages.at(-1), id: fixtureId(100 + messages.length), clientId: input.clientId,
        sender: viewer, text: input.text, media: [], reactions: [], status: 'sent' };
      messages.push(body);
      await route.fulfill({ status: 201, json: body });
      return;
    }
    else if (path === `/v1/ligo/conversations/${conversation.id}/messages`) body = { items: [...messages].reverse(), nextCursor: null };
    else if (path === '/v1/rondo/servers') body = { items: [server] };
    else if (path === `/v1/rondo/servers/${server.id}`) body = { server, channels: [channel], members: [viewer, partner] };
    else if (path === '/v1/lingvo/dictionaries') body = { items: [dictionary] };
    else if (path === `/v1/lingvo/dictionaries/${dictionary.id}`) { if (method === 'PATCH') Object.assign(dictionary, request.postDataJSON()); body = method === 'PATCH' ? dictionary : overview(); }
    else if (path.endsWith('/settings') && method === 'PUT') { Object.assign(dictionary, request.postDataJSON()); body = dictionary; }
    else if (path.endsWith('/folders') && method === 'POST') { body = { id: fixtureId(85 + folders.length), dictionaryId: dictionary.id, ...request.postDataJSON() }; folders.push(body); }
    else if (path.endsWith('/imports') && method === 'POST') body = { added: 1, skipped: 0 };
    else if (path.endsWith('/reviews') && method === 'POST') {
      const target = cards.find(card => card.id === path.split('/')[6]);
      const input = request.postDataJSON();
      reviews.set(input.id, structuredClone(target));
      target.schedule = { ...target.schedule, reps: target.schedule.reps + 1, due: '2026-10-08T10:00:00Z', state: 2 };
      target.revision += 1;
      body = { id: input.id, card: target };
    } else if (path.endsWith('/undo') && method === 'POST') {
      body = reviews.get(path.split('/')[6]);
      const target = cards.find(card => card.id === body.id);
      Object.assign(target, body, { revision: target.revision + 1 });
      body = target;
    }
    else if (path === '/v1/lingvo/catalog') body = catalog;
    else if (path.endsWith('/cards') && method === 'POST') { body = { ...card(84, 'word', '', ''), ...request.postDataJSON() }; cards.push(body); }
    else if (path.endsWith('/cards') || path.endsWith('/study')) {
      const items = cards.filter(card => !url.searchParams.get('kind') || card.kind === url.searchParams.get('kind')).filter(card => !url.searchParams.get('q') || (card.term + card.translation).toLowerCase().includes(url.searchParams.get('q').toLowerCase())).filter(card => !path.endsWith('/study') || card.schedule.due <= now);
      body = { items, total: items.length };
    } else throw new Error(`Unexpected ${app} quality fixture request: ${method} ${path}`);
    if (!body) throw new Error(`Missing ${app} quality fixture response: ${method} ${path}`);
    await route.fulfill({ json: body });
  });
  return { dictionary, conversation, server, channel, posts, cards, failures, requests };
}
