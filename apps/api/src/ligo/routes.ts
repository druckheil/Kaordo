import type { Env } from '../env';
import { finalizeAdminEraseUsers } from '../admin/moderation';
import { base64Url } from '../auth/encoding';
import { authenticate, unixNow } from '../auth/session';
import { json } from '../http/json';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const USERNAME = /^[a-z0-9](?:[a-z0-9_]{1,30}[a-z0-9])?$/u;
const MAX_BODY_BYTES = 4_096;
const ONLINE_SECONDS = 300;
const PUBLIC = 1;
const PUBLIC_DESTINATION = 'public';
const DEFAULT_STACK_BYTES = 100 * 1_048_576;
const MIN_STACK_BYTES = 1_048_576;
const MAX_PRIVATE_STACK_BYTES = 10 * 1_073_741_824;
const MAX_PUBLIC_STACK_BYTES = 1_073_741_824;
const PRUNE_BATCH = 64;
const MAX_RECEIPT_IDS = 64;

type ConversationRow = {
  id: ArrayBuffer;
  last_message_id: string;
  last_preview: string;
  last_sender_id: ArrayBuffer;
  last_seen_at: number;
  online: number;
  updated_at: number;
  username: string;
};

export async function ligoBootstrap(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  const url = new URL(request.url);
  const limit = pageLimit(url.searchParams.get('limit'), 30);
  const before = cursor(url.searchParams.get('before'));
  const [rows, storage] = await Promise.all([env.DB.prepare(
    `SELECT users.id, users.display_username AS username, users.last_seen_at, users.online,
            conversations.last_message_id, conversations.last_sender_id,
            conversations.last_preview, conversations.updated_at
       FROM ligo_conversations AS conversations
       JOIN users ON users.id = CASE
         WHEN conversations.user_low_id = ?1 THEN conversations.user_high_id
         ELSE conversations.user_low_id END
      WHERE (conversations.user_low_id = ?1 OR conversations.user_high_id = ?1)
        AND (?2 IS NULL OR conversations.updated_at < ?2 OR
          (conversations.updated_at = ?2 AND conversations.last_message_id < ?3))
      ORDER BY conversations.updated_at DESC, conversations.last_message_id DESC
      LIMIT ?4`,
  ).bind(session.userId, before?.at ?? null, before?.id ?? '', limit + 1).all<ConversationRow>(),
  storageForUser(env, session.userId),
  ]);
  const hasMore = rows.results.length > limit;
  const page = rows.results.slice(0, limit);
  return json({
    conversations: page.map((row) => conversation(row, session.userId)),
    nextCursor: hasMore && page.length
      ? `${page[page.length - 1]!.updated_at}:${page[page.length - 1]!.last_message_id}`
      : null,
    storage,
  });
}

export async function searchLigoUsers(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  const query = new URL(request.url).searchParams.get('q')?.trim().toLowerCase() ?? '';
  if (!query || query.length > 32 || !/^[a-z0-9_]+$/u.test(query)) return json({ users: [] });
  const rows = await env.DB.prepare(
    `SELECT id, display_username, online
       FROM users
      WHERE id != ?1 AND status = 1 AND username LIKE ?2 ESCAPE '\\'
      ORDER BY CASE WHEN username = ?3 THEN 0 WHEN username LIKE ?4 ESCAPE '\\' THEN 1 ELSE 2 END,
               length(username) ASC, username ASC
      LIMIT 8`,
  ).bind(session.userId, `%${escapeLike(query)}%`, query, `${escapeLike(query)}%`).all<{
    display_username: string;
    id: ArrayBuffer;
    online: number;
  }>();
  return json({ users: rows.results.map((row) => ({
    id: base64Url(row.id),
    online: Boolean(row.online),
    username: row.display_username,
  })) });
}

export async function ligoHistory(
  request: Request,
  env: Env,
  peerUsername: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!USERNAME.test(peerUsername)) return json({ error: 'Conversation not found.' }, 404);
  const url = new URL(request.url);
  const source = url.searchParams.get('owner');
  if (source !== 'peer' && source !== 'self') return json({ error: 'History source is invalid.' }, 400);
  const peer = await env.DB.prepare(
    'SELECT id, display_username, online FROM users WHERE username = ?1 AND status = 1 LIMIT 1',
  ).bind(peerUsername).first<{ display_username: string; id: ArrayBuffer; online: number }>();
  if (!peer || equalBytes(peer.id, session.userId)) return json({ error: 'Conversation not found.' }, 404);
  const ownerId = source === 'peer' ? peer.id : session.userId;
  const otherId = source === 'peer' ? session.userId : peer.id;
  const ownerUsername = source === 'peer' ? peer.display_username : session.publicUser.username;
  const otherUsername = source === 'peer' ? session.publicUser.username : peer.display_username;
  const before = cursor(url.searchParams.get('before'));
  const limit = pageLimit(url.searchParams.get('limit'), 40);
  const rows = await env.DB.prepare(
    `SELECT id, node_id, storage_kind, size_bytes, created_at, delivered_at, read_at
       FROM ligo_cloud_messages
      WHERE owner_id = ?1 AND peer_id = ?2
        AND (?3 IS NULL OR created_at < ?3 OR (created_at = ?3 AND id < ?4))
      ORDER BY created_at DESC, id DESC
      LIMIT ?5`,
  ).bind(ownerId, otherId, before?.at ?? null, before?.id ?? '', limit + 1).all<{
    created_at: number;
    id: string;
    delivered_at: number | null;
    node_id: string;
    read_at: number | null;
    size_bytes: number;
    storage_kind: number;
  }>();
  const hasMore = rows.results.length > limit;
  const page = rows.results.slice(0, limit);
  const last = page.at(-1);
  return json({
    messages: page.map((row) => ({
      createdAt: row.created_at,
      id: row.id,
      nodeId: row.node_id,
      recipient: { id: base64Url(otherId), username: otherUsername },
      sender: {
        id: base64Url(ownerId),
        online: source === 'peer' ? Boolean(peer.online) : true,
        username: ownerUsername,
      },
      sizeBytes: row.size_bytes,
      status: row.read_at !== null ? 'read' : row.delivered_at !== null ? 'delivered' : 'queued',
      storage: row.storage_kind === PUBLIC ? 'public' : 'private',
    })),
    nextCursor: hasMore && last ? `${last.created_at}:${last.id}` : null,
  });
}

export async function updateLigoStorage(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await body(request);
    const selectedNodeId = input.selectedNodeId;
    const stackLimitBytes = Number(input.stackLimitBytes);
    if (!Number.isSafeInteger(stackLimitBytes) || stackLimitBytes < MIN_STACK_BYTES ||
        stackLimitBytes > MAX_PRIVATE_STACK_BYTES ||
        (selectedNodeId !== PUBLIC_DESTINATION &&
          (typeof selectedNodeId !== 'string' || !ID.test(selectedNodeId)))) {
      throw new InputError('Ligo storage settings are invalid.');
    }
    const storageKind = selectedNodeId === PUBLIC_DESTINATION ? PUBLIC : 0;
    if (storageKind === PUBLIC && stackLimitBytes > MAX_PUBLIC_STACK_BYTES) {
      throw new InputError('Public Ligo storage can use up to 1 GB.');
    }
    if (storageKind === 0) {
      const node = await env.DB.prepare(
        `SELECT private_quota_bytes FROM nodes
          WHERE id = ?1 AND user_id = ?2 AND private_quota_bytes > 0 LIMIT 1`,
      ).bind(selectedNodeId, session.userId).first<{ private_quota_bytes: number }>();
      if (!node) return json({ error: 'Choose one of your private Nodo devices.' }, 409);
      if (stackLimitBytes > node.private_quota_bytes) {
        return json({ error: 'The cloud window cannot exceed this private space.' }, 409);
      }
    }
    const now = unixNow();
    await env.DB.prepare(
      `INSERT INTO ligo_storage_settings
        (user_id, storage_kind, node_id, stack_limit_bytes, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(user_id) DO UPDATE SET
         storage_kind = excluded.storage_kind,
         node_id = excluded.node_id,
         stack_limit_bytes = excluded.stack_limit_bytes,
         updated_at = excluded.updated_at`,
    ).bind(
      session.userId,
      storageKind,
      storageKind === PUBLIC ? null : selectedNodeId,
      stackLimitBytes,
      now,
    ).run();
    const evicted = await pruneCloudHistory(env, session.userId, stackLimitBytes, now);
    return json({ evicted, storage: await storageForUser(env, session.userId) });
  } catch (error) {
    return json({ error: error instanceof InputError ? error.message : 'Ligo storage settings are invalid.' }, 400);
  }
}

export async function confirmLigoCloudCleanup(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await body(request);
    const messageIds = requiredIds(input.messageIds);
    await acknowledgeCloudCleanup(env, messageIds, null, session.userId);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof InputError ? error.message : 'Ligo cleanup is invalid.' }, 400);
  }
}

export async function ligoInbox(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  const url = new URL(request.url);
  const limit = pageLimit(url.searchParams.get('limit'), 24);
  const after = cursor(url.searchParams.get('after'));
  const [rows, deletionRows, conversationDeletionRows] = await Promise.all([env.DB.prepare(
    `SELECT deliveries.id, deliveries.node_id, deliveries.storage_kind,
            deliveries.size_bytes, deliveries.created_at,
            users.id AS sender_id, users.display_username AS sender_username,
            users.online AS sender_online
       FROM ligo_deliveries AS deliveries
       JOIN users ON users.id = deliveries.sender_id
      WHERE deliveries.recipient_id = ?1
        AND (?2 IS NULL OR deliveries.created_at > ?2 OR
          (deliveries.created_at = ?2 AND deliveries.id > ?3))
      ORDER BY deliveries.created_at ASC, deliveries.id ASC
      LIMIT ?4`,
  ).bind(session.userId, after?.at ?? null, after?.id ?? '', limit + 1).all<{
    created_at: number;
    id: string;
    node_id: string;
    sender_id: ArrayBuffer;
    sender_online: number;
    sender_username: string;
    size_bytes: number;
    storage_kind: number;
  }>(), after ? Promise.resolve({ results: [] as Array<{ message_id: string; sender_id: ArrayBuffer }> }) : env.DB.prepare(
    `SELECT message_id, sender_id
       FROM ligo_message_deletions
      WHERE recipient_id = ?1
      ORDER BY created_at ASC, message_id ASC
      LIMIT ?2`,
  ).bind(session.userId, MAX_RECEIPT_IDS).all<{ message_id: string; sender_id: ArrayBuffer }>(), after
    ? Promise.resolve({ results: [] as Array<{ peer_id: ArrayBuffer; peer_username: string }> })
    : env.DB.prepare(
      `SELECT deletions.peer_id, users.display_username AS peer_username
         FROM ligo_conversation_deletions AS deletions
         JOIN users ON users.id = deletions.peer_id
        WHERE deletions.recipient_id = ?1
        ORDER BY deletions.created_at ASC, deletions.peer_id ASC
        LIMIT ?2`,
    ).bind(session.userId, MAX_RECEIPT_IDS).all<{ peer_id: ArrayBuffer; peer_username: string }>()]);
  const hasMore = rows.results.length > limit;
  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  return json({
    conversationDeletions: conversationDeletionRows.results.map((row) => ({
      peerId: base64Url(row.peer_id),
      peerUsername: row.peer_username,
    })),
    deletions: deletionRows.results.map((row) => ({
      messageId: row.message_id,
      senderId: base64Url(row.sender_id),
    })),
    deliveries: page.map((row) => ({
      createdAt: row.created_at * 1_000,
      id: row.id,
      nodeId: row.node_id,
      recipient: { id: base64Url(session.userId), username: session.publicUser.username },
      sender: {
        id: base64Url(row.sender_id),
        online: Boolean(row.sender_online),
        username: row.sender_username,
      },
      sizeBytes: row.size_bytes,
      status: 'queued',
      storage: row.storage_kind === PUBLIC ? 'public' : 'private',
    })),
    nextCursor: hasMore && last ? `${last.created_at}:${last.id}` : null,
  });
}

export async function acknowledgeLigoConversationDeletions(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await body(request);
    const peerUsernames = requiredUsernames(input.peerUsernames, MAX_RECEIPT_IDS);
    if (!peerUsernames.length) return json({ ok: true });
    const placeholders = peerUsernames.map((_, index) => `?${index + 2}`).join(', ');
    const pendingTargets = await env.DB.prepare(
      `SELECT peer_id FROM ligo_conversation_deletions
        WHERE recipient_id = ?1 AND peer_id IN (
          SELECT id FROM users WHERE username IN (${placeholders})
        )`,
    ).bind(session.userId, ...peerUsernames).all<{ peer_id: ArrayBuffer }>();
    await env.DB.prepare(
      `DELETE FROM ligo_conversation_deletions
        WHERE recipient_id = ?1 AND peer_id IN (
          SELECT id FROM users WHERE username IN (${placeholders})
        )`,
    ).bind(session.userId, ...peerUsernames).run();
    await finalizeAdminEraseUsers(env, pendingTargets.results.map((row) => row.peer_id));
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof InputError ? error.message : 'Conversation deletion receipt is invalid.' }, 400);
  }
}

export async function deleteLigoConversation(
  request: Request,
  env: Env,
  peerUsername: string,
  ctx: ExecutionContext,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!USERNAME.test(peerUsername)) return json({ error: 'Conversation not found.' }, 404);
  const peer = await env.DB.prepare(
    'SELECT id, display_username FROM users WHERE username = ?1 AND status = 1 LIMIT 1',
  ).bind(peerUsername).first<{ display_username: string; id: ArrayBuffer }>();
  if (!peer || equalBytes(peer.id, session.userId)) return json({ error: 'Conversation not found.' }, 404);
  const lowFirst = compareBytes(session.userId, peer.id) < 0;
  const low = lowFirst ? session.userId : peer.id;
  const high = lowFirst ? peer.id : session.userId;
  const [knownConversation, directCleanup] = await Promise.all([
    env.DB.prepare(
      `SELECT 1 AS found FROM ligo_conversations
        WHERE user_low_id = ?1 AND user_high_id = ?2
       UNION ALL
       SELECT 1 FROM ligo_conversation_deletions
        WHERE (recipient_id = ?1 AND peer_id = ?2) OR (recipient_id = ?2 AND peer_id = ?1)
       LIMIT 1`,
    ).bind(low, high).first<{ found: number }>(),
    env.DB.prepare(
      `SELECT id, node_id, storage_kind FROM ligo_cloud_messages
        WHERE owner_id = ?1 AND peer_id = ?2
        ORDER BY created_at ASC, id ASC LIMIT ?3`,
    ).bind(session.userId, peer.id, PRUNE_BATCH).all<{
      id: string;
      node_id: string;
      storage_kind: number;
    }>(),
  ]);
  if (!knownConversation) return json({ error: 'Conversation not found.' }, 404);
  const now = unixNow();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO ligo_cloud_tombstones
        (node_id, message_id, owner_id, storage_kind, created_at)
       SELECT node_id, id, owner_id, storage_kind, ?1
         FROM ligo_cloud_messages
        WHERE (owner_id = ?2 AND peer_id = ?3) OR (owner_id = ?3 AND peer_id = ?2)`,
    ).bind(now, session.userId, peer.id),
    env.DB.prepare(
      `DELETE FROM ligo_deliveries
        WHERE (sender_id = ?1 AND recipient_id = ?2) OR (sender_id = ?2 AND recipient_id = ?1)`,
    ).bind(session.userId, peer.id),
    env.DB.prepare(
      `DELETE FROM ligo_cloud_messages
        WHERE (owner_id = ?1 AND peer_id = ?2) OR (owner_id = ?2 AND peer_id = ?1)`,
    ).bind(session.userId, peer.id),
    env.DB.prepare(
      `DELETE FROM ligo_message_deletions
        WHERE (recipient_id = ?1 AND sender_id = ?2) OR (recipient_id = ?2 AND sender_id = ?1)`,
    ).bind(session.userId, peer.id),
    env.DB.prepare(
      'DELETE FROM ligo_conversations WHERE user_low_id = ?1 AND user_high_id = ?2',
    ).bind(low, high),
    env.DB.prepare(
      `INSERT INTO ligo_conversation_deletions (recipient_id, peer_id, created_at)
       VALUES (?1, ?2, ?3), (?2, ?1, ?3)
       ON CONFLICT(recipient_id, peer_id) DO UPDATE SET created_at = excluded.created_at`,
    ).bind(session.userId, peer.id, now),
  ]);
  const actorDeletion = { peerId: base64Url(peer.id), peerUsername: peer.display_username };
  const peerDeletion = { peerId: base64Url(session.userId), peerUsername: session.publicUser.username };
  ctx.waitUntil(env.LIGO_LIVE.getByName(base64Url(session.userId))
    .notifyConversationDeletions([actorDeletion]).catch(logLiveFailure('conversation deletion', peerUsername)));
  ctx.waitUntil(env.LIGO_LIVE.getByName(base64Url(peer.id))
    .notifyConversationDeletions([peerDeletion]).catch(logLiveFailure('conversation deletion', peerUsername)));
  return json({
    evicted: directCleanup.results.map((message) => ({
      id: message.id,
      nodeId: message.node_id,
      storage: message.storage_kind === PUBLIC ? 'public' as const : 'private' as const,
    })),
    storage: await storageForUser(env, session.userId),
  });
}

export async function acknowledgeLigoDeletions(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await body(request);
    const messageIds = requiredIds(input.messageIds, MAX_RECEIPT_IDS);
    if (!messageIds.length) return json({ ok: true });
    const placeholders = messageIds.map((_, index) => `?${index + 2}`).join(', ');
    await env.DB.prepare(
      `DELETE FROM ligo_message_deletions
        WHERE recipient_id = ?1 AND message_id IN (${placeholders})`,
    ).bind(session.userId, ...messageIds).run();
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof InputError ? error.message : 'Message deletion receipt is invalid.' }, 400);
  }
}

export async function deleteLigoMessage(
  request: Request,
  env: Env,
  messageId: string,
  ctx: ExecutionContext,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!ID.test(messageId)) return json({ error: 'Message not found.' }, 404);
  try {
    const input = await body(request);
    const peerUsername = requiredUsername(input.peerUsername);
    const peer = await env.DB.prepare(
      'SELECT id FROM users WHERE username = ?1 AND status = 1 LIMIT 1',
    ).bind(peerUsername).first<{ id: ArrayBuffer }>();
    if (!peer || equalBytes(peer.id, session.userId)) return json({ error: 'Conversation not found.' }, 404);
    const lowFirst = compareBytes(session.userId, peer.id) < 0;
    const low = lowFirst ? session.userId : peer.id;
    const high = lowFirst ? peer.id : session.userId;
    const [knownConversation, cloudMessage] = await Promise.all([
      env.DB.prepare(
        `SELECT 1 AS found FROM ligo_conversations
          WHERE user_low_id = ?1 AND user_high_id = ?2 LIMIT 1`,
      ).bind(low, high).first<{ found: number }>(),
      env.DB.prepare(
        `SELECT node_id, storage_kind FROM ligo_cloud_messages
          WHERE id = ?1 AND owner_id = ?2 AND peer_id = ?3 LIMIT 1`,
      ).bind(messageId, session.userId, peer.id).first<{ node_id: string; storage_kind: number }>(),
    ]);
    if (!knownConversation) return json({ error: 'Conversation not found.' }, 404);
    const now = unixNow();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO ligo_cloud_tombstones
          (node_id, message_id, owner_id, storage_kind, created_at)
         SELECT node_id, id, owner_id, storage_kind, ?1
           FROM ligo_cloud_messages
          WHERE id = ?2 AND owner_id = ?3 AND peer_id = ?4`,
      ).bind(now, messageId, session.userId, peer.id),
      env.DB.prepare(
        'DELETE FROM ligo_deliveries WHERE id = ?1 AND sender_id = ?2 AND recipient_id = ?3',
      ).bind(messageId, session.userId, peer.id),
      env.DB.prepare(
        'DELETE FROM ligo_cloud_messages WHERE id = ?1 AND owner_id = ?2 AND peer_id = ?3',
      ).bind(messageId, session.userId, peer.id),
      env.DB.prepare(
        `INSERT OR IGNORE INTO ligo_message_deletions
          (recipient_id, message_id, sender_id, created_at)
         VALUES (?1, ?2, ?3, ?4), (?3, ?2, ?3, ?4)`,
      ).bind(peer.id, messageId, session.userId, now),
      env.DB.prepare(
        `UPDATE ligo_conversations SET last_preview = 'Message deleted'
          WHERE user_low_id = ?1 AND user_high_id = ?2 AND last_message_id = ?3`,
      ).bind(low, high, messageId),
    ]);
    const deletion = { messageId, senderId: base64Url(session.userId) };
    for (const userId of [peer.id, session.userId]) {
      ctx.waitUntil(env.LIGO_LIVE.getByName(base64Url(userId)).notifyDeletions([deletion])
        .catch(logLiveFailure('deletion', messageId)));
    }
    return json({
      evicted: cloudMessage ? [{
        id: messageId,
        nodeId: cloudMessage.node_id,
        storage: cloudMessage.storage_kind === PUBLIC ? 'public' : 'private',
      }] : [],
      storage: await storageForUser(env, session.userId),
    });
  } catch (error) {
    return json({ error: error instanceof InputError ? error.message : 'Message deletion is invalid.' }, 400);
  }
}

export async function createLigoDelivery(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await body(request);
    const id = requiredId(input.id);
    const nodeId = requiredId(input.nodeId);
    const recipientUsername = requiredUsername(input.recipientUsername);
    const storageKind = input.storage === 'public' ? PUBLIC : input.storage === 'private' ? 0 : -1;
    if (storageKind < 0 || !Number.isSafeInteger(input.sizeBytes) || Number(input.sizeBytes) <= 0 ||
        Number(input.sizeBytes) > 1_073_741_824) throw new InputError('Message size is invalid.');
    const preview = typeof input.preview === 'string' ? input.preview.trim().slice(0, 160) : '';
    const now = unixNow();
    const [recipient, node, selectedStorage] = await Promise.all([
      env.DB.prepare('SELECT id FROM users WHERE username = ?1 AND status = 1 LIMIT 1')
        .bind(recipientUsername).first<{ id: ArrayBuffer }>(),
      env.DB.prepare(
        `SELECT user_id, public_quota_bytes, private_quota_bytes, last_seen_at, allow_uploads
           FROM nodes WHERE id = ?1 LIMIT 1`,
      ).bind(nodeId).first<{
        allow_uploads: number;
        last_seen_at: number;
        private_quota_bytes: number;
        public_quota_bytes: number;
        user_id: ArrayBuffer;
      }>(),
      storageForUser(env, session.userId),
    ]);
    if (!recipient || equalBytes(recipient.id, session.userId)) {
      return json({ error: 'Recipient not found.' }, 404);
    }
    if (!node || !node.allow_uploads || now - node.last_seen_at > ONLINE_SECONDS ||
        (storageKind === PUBLIC ? node.public_quota_bytes <= 0 :
          node.private_quota_bytes <= 0 || !equalBytes(node.user_id, session.userId))) {
      return json({ error: 'The selected Nodo is unavailable for this message.' }, 409);
    }
    if ((selectedStorage.selectedNodeId === PUBLIC_DESTINATION && storageKind !== PUBLIC) ||
        (selectedStorage.selectedNodeId !== PUBLIC_DESTINATION &&
          (storageKind === PUBLIC || selectedStorage.selectedNodeId !== nodeId))) {
      return json({ error: 'The selected Ligo storage changed. Reopen its storage panel.' }, 409);
    }
    if (Number(input.sizeBytes) > selectedStorage.stackLimitBytes) {
      return json({ error: 'This message is larger than your Ligo cloud window.' }, 413);
    }
    const lowFirst = compareBytes(session.userId, recipient.id) < 0;
    const low = lowFirst ? session.userId : recipient.id;
    const high = lowFirst ? recipient.id : session.userId;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO ligo_deliveries
          (id, sender_id, recipient_id, node_id, storage_kind, size_bytes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ).bind(id, session.userId, recipient.id, nodeId, storageKind, input.sizeBytes, now),
      env.DB.prepare(
        `INSERT INTO ligo_conversations
          (user_low_id, user_high_id, last_message_id, last_sender_id, last_preview, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(user_low_id, user_high_id) DO UPDATE SET
           last_message_id = excluded.last_message_id,
           last_sender_id = excluded.last_sender_id,
           last_preview = excluded.last_preview,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at >= ligo_conversations.updated_at`,
      ).bind(low, high, id, session.userId, preview, now),
      env.DB.prepare(
        `INSERT INTO ligo_cloud_messages
          (id, owner_id, peer_id, node_id, storage_kind, size_bytes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ).bind(id, session.userId, recipient.id, nodeId, storageKind, input.sizeBytes, Date.now()),
    ]);
    const evicted = await pruneCloudHistory(
      env,
      session.userId,
      selectedStorage.stackLimitBytes,
      now,
    );
    ctx.waitUntil(env.LIGO_LIVE.getByName(base64Url(recipient.id)).notifyInbox(id).catch((error: unknown) => {
      console.error(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        message: 'Ligo live notification failed; inbox polling remains available.',
        messageId: id,
      }));
    }));
    // Settings were already read before the write. Re-read only the compact
    // usage scalar after pruning so concurrent sends cannot publish a stale
    // stack counter, without repeating the settings query.
    const storage = {
      ...selectedStorage,
      stackUsedBytes: await storageUsageForUser(env, session.userId),
    };
    return json({ evicted, storage }, 201);
  } catch (error) {
    if (isUnique(error)) return json({ error: 'This message was already queued.' }, 409);
    return json({ error: error instanceof InputError ? error.message : 'Message delivery is invalid.' }, 400);
  }
}

export async function acknowledgeLigoDelivery(
  request: Request,
  env: Env,
  deliveryId: string,
  ctx: ExecutionContext,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!ID.test(deliveryId)) return json({ error: 'Delivery not found.' }, 404);
  const delivery = await env.DB.prepare(
    `SELECT deliveries.sender_id, messages.read_at
       FROM ligo_deliveries AS deliveries
       LEFT JOIN ligo_cloud_messages AS messages ON messages.id = deliveries.id
      WHERE deliveries.id = ?1 AND deliveries.recipient_id = ?2 LIMIT 1`,
  ).bind(deliveryId, session.userId).first<{ read_at: number | null; sender_id: ArrayBuffer }>();
  if (!delivery) return json({ ok: true });
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE ligo_cloud_messages SET delivered_at = COALESCE(delivered_at, ?1)
        WHERE id = ?2 AND peer_id = ?3`,
    ).bind(now, deliveryId, session.userId),
    env.DB.prepare(
      'DELETE FROM ligo_deliveries WHERE id = ?1 AND recipient_id = ?2',
    ).bind(deliveryId, session.userId),
  ]);
  const receiptStatus = delivery.read_at === null ? 'delivered' as const : 'read' as const;
  ctx.waitUntil(env.LIGO_LIVE.getByName(base64Url(delivery.sender_id))
    .notifyReceipts([deliveryId], receiptStatus).catch(logLiveFailure('receipt', deliveryId)));
  return json({ ok: true });
}

export async function markLigoRead(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await body(request);
    const messageIds = requiredIds(input.messageIds, MAX_RECEIPT_IDS);
    if (!messageIds.length) return json({ ok: true });
    const placeholders = messageIds.map((_, index) => `?${index + 2}`).join(', ');
    const rows = await env.DB.prepare(
      `SELECT id, owner_id FROM ligo_cloud_messages
        WHERE peer_id = ?1 AND id IN (${placeholders}) AND read_at IS NULL`,
    ).bind(session.userId, ...messageIds).all<{ id: string; owner_id: ArrayBuffer }>();
    if (!rows.results.length) return json({ ok: true });
    const changedIds = rows.results.map(({ id }) => id);
    const changedPlaceholders = changedIds.map((_, index) => `?${index + 3}`).join(', ');
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE ligo_cloud_messages SET delivered_at = COALESCE(delivered_at, ?1), read_at = ?1
          WHERE peer_id = ?2 AND id IN (${changedPlaceholders})`,
      ).bind(now, session.userId, ...changedIds),
      env.DB.prepare(
        `DELETE FROM ligo_deliveries WHERE recipient_id = ?1 AND id IN (${
          changedIds.map((_, index) => `?${index + 2}`).join(', ')
        })`,
      ).bind(session.userId, ...changedIds),
    ]);
    const byOwner = new Map<string, { ids: string[]; userId: ArrayBuffer }>();
    for (const row of rows.results) {
      const key = base64Url(row.owner_id);
      const group = byOwner.get(key) ?? { ids: [], userId: row.owner_id };
      group.ids.push(row.id);
      byOwner.set(key, group);
    }
    for (const [ownerKey, group] of byOwner) {
      ctx.waitUntil(env.LIGO_LIVE.getByName(ownerKey).notifyReceipts(group.ids, 'read')
        .catch(logLiveFailure('read receipt', group.ids[0] ?? 'unknown')));
    }
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof InputError ? error.message : 'Read receipt is invalid.' }, 400);
  }
}

function conversation(row: ConversationRow, userId: ArrayBuffer) {
  return {
    lastMessage: {
      id: row.last_message_id,
      mine: equalBytes(row.last_sender_id, userId),
      preview: row.last_preview,
      sentAt: row.updated_at * 1_000,
    },
    user: {
      id: base64Url(row.id),
      online: Boolean(row.online),
      username: row.username,
    },
  };
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
    throw new InputError('Content-Type must be application/json.');
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) throw new InputError('Request is too large.');
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InputError('Invalid JSON.');
  return value as Record<string, unknown>;
}

function pageLimit(value: string | null, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 50 ? parsed : fallback;
}

function cursor(value: string | null): { at: number; id: string } | null {
  if (!value) return null;
  const match = /^(\d{1,13}):([0-9a-f-]{36})$/u.exec(value);
  if (!match?.[1] || !match[2] || !ID.test(match[2])) return null;
  return { at: Number(match[1]), id: match[2] };
}

function requiredId(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new InputError('Message identifier is invalid.');
  return value;
}

function requiredUsername(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!USERNAME.test(normalized)) throw new InputError('Recipient is invalid.');
  return normalized;
}

function requiredUsernames(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new InputError('Ligo usernames are invalid.');
  return [...new Set(value.map(requiredUsername))];
}

function requiredIds(value: unknown, maximum = PRUNE_BATCH): string[] {
  if (!Array.isArray(value) || value.length > maximum ||
      value.some((item) => typeof item !== 'string' || !ID.test(item))) {
    throw new InputError('Ligo cleanup identifiers are invalid.');
  }
  return [...new Set(value as string[])];
}

async function storageForUser(env: Env, userId: ArrayBuffer) {
  const row = await env.DB.prepare(
    `SELECT settings.storage_kind, settings.node_id, settings.stack_limit_bytes,
            COALESCE(usage.bytes, 0) AS bytes
       FROM (SELECT ?1 AS user_id) AS viewer
       LEFT JOIN ligo_storage_settings AS settings
         ON settings.user_id = viewer.user_id
       LEFT JOIN (
         SELECT owner_id, SUM(size_bytes) AS bytes
           FROM ligo_cloud_messages
          WHERE owner_id = ?1
          GROUP BY owner_id
       ) AS usage ON usage.owner_id = viewer.user_id
      LIMIT 1`,
  ).bind(userId).first<{
    bytes: number;
    node_id: string | null;
    stack_limit_bytes: number | null;
    storage_kind: number | null;
  }>();
  return {
    selectedNodeId: row?.storage_kind === 0 && row.node_id
      ? row.node_id
      : PUBLIC_DESTINATION,
    stackLimitBytes: Number(row?.stack_limit_bytes ?? DEFAULT_STACK_BYTES),
    stackUsedBytes: Number(row?.bytes ?? 0),
  };
}

async function storageUsageForUser(env: Env, userId: ArrayBuffer): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM ligo_cloud_messages WHERE owner_id = ?1',
  ).bind(userId).first<{ bytes: number }>();
  return Number(row?.bytes ?? 0);
}

type EvictedCloudMessage = { id: string; nodeId: string; storage: 'private' | 'public' };

async function pruneCloudHistory(
  env: Env,
  ownerId: ArrayBuffer,
  limitBytes: number,
  now: number,
): Promise<EvictedCloudMessage[]> {
  const evicted: EvictedCloudMessage[] = [];
  for (;;) {
    const rows = await env.DB.prepare(
      `SELECT id, node_id, storage_kind FROM (
         SELECT id, node_id, storage_kind, created_at,
                SUM(size_bytes) OVER (ORDER BY created_at DESC, id DESC) AS retained_bytes
           FROM ligo_cloud_messages WHERE owner_id = ?1
       ) WHERE retained_bytes > ?2
       ORDER BY created_at ASC, id ASC LIMIT ?3`,
    ).bind(ownerId, limitBytes, PRUNE_BATCH).all<{
      id: string;
      node_id: string;
      storage_kind: number;
    }>();
    if (!rows.results.length) break;
    const ids = rows.results.map(({ id }) => id);
    const placeholders = ids.map((_, index) => `?${index + 2}`).join(', ');
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO ligo_cloud_tombstones
          (node_id, message_id, owner_id, storage_kind, created_at)
         SELECT node_id, id, owner_id, storage_kind, ?1
           FROM ligo_cloud_messages
          WHERE owner_id = ?2 AND id IN (${ids.map((_, index) => `?${index + 3}`).join(', ')})`,
      ).bind(now, ownerId, ...ids),
      env.DB.prepare(
        `DELETE FROM ligo_deliveries WHERE sender_id = ?1 AND id IN (${placeholders})`,
      ).bind(ownerId, ...ids),
      env.DB.prepare(
        `DELETE FROM ligo_cloud_messages WHERE owner_id = ?1 AND id IN (${placeholders})`,
      ).bind(ownerId, ...ids),
    ]);
    evicted.push(...rows.results.map((row) => ({
      id: row.id,
      nodeId: row.node_id,
      storage: row.storage_kind === PUBLIC ? 'public' as const : 'private' as const,
    })));
    if (rows.results.length < PRUNE_BATCH) break;
  }
  return evicted;
}

export async function acknowledgeCloudCleanup(
  env: Env,
  messageIds: readonly string[],
  nodeId: string | null,
  ownerId: ArrayBuffer | null = null,
): Promise<void> {
  if (!messageIds.length) return;
  const values: unknown[] = [...messageIds];
  const idPlaceholders = messageIds.map((_, index) => `?${index + 1}`).join(', ');
  let filters = `tombstones.message_id IN (${idPlaceholders})`;
  if (nodeId) {
    values.push(nodeId);
    filters += ` AND tombstones.node_id = ?${values.length}`;
  }
  if (ownerId) {
    values.push(ownerId);
    filters += ` AND tombstones.owner_id = ?${values.length}`;
  }
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM fluo_public_allocations AS allocations
        WHERE allocations.committed = 1 AND EXISTS (
          SELECT 1 FROM ligo_cloud_tombstones AS tombstones
           WHERE tombstones.node_id = allocations.node_id
             AND tombstones.message_id = allocations.post_id
             AND tombstones.storage_kind = 1 AND ${filters}
        )`,
    ).bind(...values),
    env.DB.prepare(
      `DELETE FROM ligo_cloud_tombstones AS tombstones WHERE ${filters}`,
    ).bind(...values),
  ]);
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function equalBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function compareBytes(left: ArrayBuffer, right: ArrayBuffer): number {
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return a.length - b.length;
}

function isUnique(error: unknown): boolean {
  return error instanceof Error && /unique constraint/i.test(error.message);
}

class InputError extends Error {}

function logLiveFailure(kind: string, messageId: string): (error: unknown) => void {
  return (error) => console.error(JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    message: `Ligo ${kind} notification failed; history synchronization remains available.`,
    messageId,
  }));
}
