import type { Env } from '../env';
import { base64Url } from '../auth/encoding';
import { authenticate, unixNow } from '../auth/session';
import { json } from '../http/json';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const USERNAME = /^[a-z0-9](?:[a-z0-9_]{1,30}[a-z0-9])?$/u;
const MAX_BODY_BYTES = 4_096;
const ONLINE_SECONDS = 300;
const PUBLIC = 1;

type ConversationRow = {
  id: ArrayBuffer;
  last_message_id: string;
  last_preview: string;
  last_sender_id: ArrayBuffer;
  last_seen_at: number;
  updated_at: number;
  username: string;
};

export async function ligoBootstrap(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  const url = new URL(request.url);
  const limit = pageLimit(url.searchParams.get('limit'), 30);
  const before = cursor(url.searchParams.get('before'));
  const rows = await env.DB.prepare(
    `SELECT users.id, users.display_username AS username, users.last_seen_at,
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
  ).bind(session.userId, before?.at ?? null, before?.id ?? '', limit + 1).all<ConversationRow>();
  const hasMore = rows.results.length > limit;
  const page = rows.results.slice(0, limit);
  return json({
    conversations: page.map((row) => conversation(row, session.userId, unixNow())),
    nextCursor: hasMore && page.length
      ? `${page[page.length - 1]!.updated_at}:${page[page.length - 1]!.last_message_id}`
      : null,
  });
}

export async function searchLigoUsers(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  const query = new URL(request.url).searchParams.get('q')?.trim().toLowerCase() ?? '';
  if (!query || query.length > 32 || !/^[a-z0-9_]+$/u.test(query)) return json({ users: [] });
  const rows = await env.DB.prepare(
    `SELECT id, display_username, last_seen_at
       FROM users
      WHERE id != ?1 AND status = 1 AND username LIKE ?2 ESCAPE '\\'
      ORDER BY CASE WHEN username = ?3 THEN 0 WHEN username LIKE ?4 ESCAPE '\\' THEN 1 ELSE 2 END,
               length(username) ASC, username ASC
      LIMIT 8`,
  ).bind(session.userId, `%${escapeLike(query)}%`, query, `${escapeLike(query)}%`).all<{
    display_username: string;
    id: ArrayBuffer;
    last_seen_at: number;
  }>();
  const now = unixNow();
  return json({ users: rows.results.map((row) => ({
    id: base64Url(row.id),
    online: now - row.last_seen_at <= ONLINE_SECONDS,
    username: row.display_username,
  })) });
}

export async function ligoInbox(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  const url = new URL(request.url);
  const limit = pageLimit(url.searchParams.get('limit'), 24);
  const after = cursor(url.searchParams.get('after'));
  const rows = await env.DB.prepare(
    `SELECT deliveries.id, deliveries.node_id, deliveries.storage_kind,
            deliveries.size_bytes, deliveries.created_at,
            users.id AS sender_id, users.display_username AS sender_username
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
    sender_username: string;
    size_bytes: number;
    storage_kind: number;
  }>();
  const hasMore = rows.results.length > limit;
  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  return json({
    deliveries: page.map((row) => ({
      createdAt: row.created_at * 1_000,
      id: row.id,
      nodeId: row.node_id,
      sender: { id: base64Url(row.sender_id), username: row.sender_username },
      sizeBytes: row.size_bytes,
      storage: row.storage_kind === PUBLIC ? 'public' : 'private',
    })),
    nextCursor: hasMore && last ? `${last.created_at}:${last.id}` : null,
  });
}

export async function createLigoDelivery(request: Request, env: Env): Promise<Response> {
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
    const [recipient, node] = await Promise.all([
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
    ]);
    if (!recipient || equalBytes(recipient.id, session.userId)) {
      return json({ error: 'Recipient not found.' }, 404);
    }
    if (!node || !node.allow_uploads || now - node.last_seen_at > ONLINE_SECONDS ||
        (storageKind === PUBLIC ? node.public_quota_bytes <= 0 :
          node.private_quota_bytes <= 0 || !equalBytes(node.user_id, session.userId))) {
      return json({ error: 'The selected Nodo is unavailable for this message.' }, 409);
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
    ]);
    return json({ id }, 201);
  } catch (error) {
    if (isUnique(error)) return json({ error: 'This message was already queued.' }, 409);
    return json({ error: error instanceof InputError ? error.message : 'Message delivery is invalid.' }, 400);
  }
}

export async function acknowledgeLigoDelivery(
  request: Request,
  env: Env,
  deliveryId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!ID.test(deliveryId)) return json({ error: 'Delivery not found.' }, 404);
  const delivery = await env.DB.prepare(
    'SELECT node_id, storage_kind FROM ligo_deliveries WHERE id = ?1 AND recipient_id = ?2 LIMIT 1',
  ).bind(deliveryId, session.userId).first<{ node_id: string; storage_kind: number }>();
  if (!delivery) return json({ ok: true });
  const statements = [env.DB.prepare(
    'DELETE FROM ligo_deliveries WHERE id = ?1 AND recipient_id = ?2',
  ).bind(deliveryId, session.userId)];
  if (delivery.storage_kind === PUBLIC) {
    statements.push(env.DB.prepare(
      'DELETE FROM fluo_public_allocations WHERE node_id = ?1 AND post_id = ?2 AND committed = 1',
    ).bind(delivery.node_id, deliveryId));
  }
  await env.DB.batch(statements);
  return json({ ok: true });
}

function conversation(row: ConversationRow, userId: ArrayBuffer, now: number) {
  return {
    lastMessage: {
      id: row.last_message_id,
      mine: equalBytes(row.last_sender_id, userId),
      preview: row.last_preview,
      sentAt: row.updated_at * 1_000,
    },
    user: {
      id: base64Url(row.id),
      online: now - row.last_seen_at <= ONLINE_SECONDS,
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
  const match = /^(\d{1,12}):([0-9a-f-]{36})$/u.exec(value);
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
