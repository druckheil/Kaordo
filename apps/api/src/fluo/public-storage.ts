import type { Env } from '../env';
import { authenticate, unixNow } from '../auth/session';
import { json } from '../http/json';

const PUBLIC_LIMIT_BYTES = 1_073_741_824;
const RESERVATION_SECONDS = 10 * 60;
export const PUBLIC_NODE_RETIRE_SECONDS = 24 * 60 * 60;
const MAX_REQUEST_BYTES = 8_192;
const NODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ONLINE_SECONDS = 300;

type UsageRow = { reserved_bytes: number; used_bytes: number };

export async function publicStorageStatus(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  return json(await publicStorageForUser(env, session.userId, unixNow()));
}

export async function publicStorageForUser(env: Env, userId: ArrayBuffer, now: number) {
  const [usage, nodes] = await Promise.all([
    publicUsage(env, userId, now),
    env.DB.prepare(
      `WITH pending AS (
        SELECT node_id, SUM(bytes) AS bytes
          FROM (
            SELECT node_id, bytes FROM fluo_public_allocations
             WHERE committed = 0 AND expires_at > ?1
            UNION ALL
            SELECT node_id, bytes FROM profile_public_allocations
             WHERE committed = 0 AND expires_at > ?1
          ) AS reservations
         GROUP BY node_id
      )
      SELECT nodes.id, nodes.device_name, nodes.app_version,
             MAX(0, nodes.public_quota_bytes - nodes.public_used_bytes -
               COALESCE(pending.bytes, 0)) AS available_bytes
         FROM nodes
         LEFT JOIN pending ON pending.node_id = nodes.id
        WHERE nodes.last_seen_at >= ?2
          AND nodes.allow_uploads = 1
          AND nodes.public_quota_bytes > 0
          AND nodes.public_quota_bytes - nodes.public_used_bytes - COALESCE(pending.bytes, 0) > 0
          AND NOT EXISTS (
            SELECT 1 FROM fluo_public_tombstones AS tombstones
             WHERE tombstones.node_id = nodes.id
          )
        ORDER BY available_bytes DESC, nodes.last_seen_at DESC, nodes.id ASC`,
    ).bind(now, now - ONLINE_SECONDS).all<{
      available_bytes: number;
      app_version: string | null;
      device_name: string;
      id: string;
    }>(),
  ]);
  return {
    limitBytes: PUBLIC_LIMIT_BYTES,
    nodeCandidates: nodes.results.filter((node) => supportsPublicReservations(node.app_version)).map((node) => ({
      availableBytes: node.available_bytes,
      deviceName: node.device_name,
      nodeId: node.id,
    })),
    reservedBytes: usage.reserved_bytes,
    usedBytes: usage.used_bytes,
  };
}

export async function reservePublicStorage(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await readJson(request);
    if (typeof input.nodeId !== 'string' || !NODE_ID.test(input.nodeId) ||
        !Number.isSafeInteger(input.bytes) || (input.bytes as number) <= 0 ||
        (input.bytes as number) > PUBLIC_LIMIT_BYTES) {
      return json({ error: 'Public storage reservation is invalid.' }, 400);
    }
    const now = unixNow();
    const expiresAt = now + RESERVATION_SECONDS;
    const reservationId = crypto.randomUUID();
    const target = await env.DB.prepare(
      'SELECT app_version FROM nodes WHERE id = ?1 LIMIT 1',
    ).bind(input.nodeId).first<{ app_version: string | null }>();
    if (!supportsPublicReservations(target?.app_version ?? null)) {
      return json({ error: 'This host must run Nodo 0.1.0 or newer for public storage.' }, 409);
    }
    const result = await env.DB.prepare(
      `INSERT INTO fluo_public_allocations
         (id, user_id, node_id, post_id, bytes, committed, created_at, expires_at)
       SELECT ?1, ?2, nodes.id, NULL, ?3, 0, ?4, ?5
         FROM nodes
        WHERE nodes.id = ?6
          AND nodes.last_seen_at >= ?7
          AND nodes.allow_uploads = 1
          AND nodes.public_quota_bytes > 0
          AND NOT EXISTS (
            SELECT 1 FROM fluo_public_tombstones AS tombstones
             WHERE tombstones.node_id = nodes.id
          )
          AND ?3 + COALESCE((
            SELECT SUM(bytes) FROM fluo_public_allocations
             WHERE user_id = ?2 AND (
               (committed = 0 AND expires_at > ?4) OR
               (committed = 1 AND EXISTS (
                 SELECT 1 FROM nodes AS usage_node
                  WHERE usage_node.id = fluo_public_allocations.node_id
                    AND usage_node.last_seen_at > ?9
               ))
             )
          ), 0) + COALESCE((
            SELECT SUM(bytes) FROM profile_public_allocations
             WHERE user_id = ?2 AND (
               (committed = 0 AND expires_at > ?4) OR
               (committed = 1 AND EXISTS (
                 SELECT 1 FROM nodes AS usage_node
                  WHERE usage_node.id = profile_public_allocations.node_id
                    AND usage_node.last_seen_at > ?9
               ))
             )
          ), 0) <= ?8
          AND ?3 + COALESCE((
            SELECT SUM(bytes) FROM fluo_public_allocations
             WHERE node_id = nodes.id AND committed = 0 AND expires_at > ?4
          ), 0) + COALESCE((
            SELECT SUM(bytes) FROM profile_public_allocations
             WHERE node_id = nodes.id AND committed = 0 AND expires_at > ?4
          ), 0) <= nodes.public_quota_bytes - nodes.public_used_bytes`,
    ).bind(
      reservationId,
      session.userId,
      input.bytes,
      now,
      expiresAt,
      input.nodeId,
      now - ONLINE_SECONDS,
      PUBLIC_LIMIT_BYTES,
      now - PUBLIC_NODE_RETIRE_SECONDS,
    ).run();
    if ((result.meta.changes ?? 0) === 0) {
      const usage = await publicUsage(env, session.userId, now);
      if (usage.used_bytes + usage.reserved_bytes + (input.bytes as number) > PUBLIC_LIMIT_BYTES) {
        return json({ error: 'Your 1 GB Public Nodo limit would be exceeded.' }, 413);
      }
      return json({ error: 'This public Nodo no longer has enough available space.' }, 409);
    }
    return json({ expiresAt, reservationId }, 201);
  } catch {
    return json({ error: 'Public storage reservation is invalid.' }, 400);
  }
}

export async function commitPublicStorage(
  request: Request,
  env: Env,
  reservationId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(reservationId)) return json({ error: 'Reservation not found.' }, 404);
  try {
    const input = await readJson(request);
    if (input.renew === true) {
      const now = unixNow();
      const expiresAt = now + RESERVATION_SECONDS;
      const renewed = await env.DB.prepare(
        `UPDATE fluo_public_allocations SET expires_at = ?1
          WHERE id = ?2 AND user_id = ?3 AND committed = 0 AND expires_at > ?4`,
      ).bind(expiresAt, reservationId, session.userId, now).run();
      if ((renewed.meta.changes ?? 0) === 0) {
        return json({ error: 'Public storage reservation expired or was not found.' }, 409);
      }
      return json({ expiresAt, reservationId });
    }
    if (typeof input.postId !== 'string' || !NODE_ID.test(input.postId)) {
      return json({ error: 'Public post identifier is invalid.' }, 400);
    }
    const now = unixNow();
    const result = await env.DB.prepare(
      `UPDATE fluo_public_allocations
          SET post_id = ?1, committed = 1, expires_at = 0
        WHERE id = ?2 AND user_id = ?3 AND committed = 0 AND expires_at > ?4`,
    ).bind(input.postId, reservationId, session.userId, now).run();
    if ((result.meta.changes ?? 0) === 0) {
      return json({ error: 'Public storage reservation expired or was not found.' }, 409);
    }
    return json({ usage: await publicUsageResponse(env, session.userId, now) });
  } catch {
    return json({ error: 'Public storage commit is invalid.' }, 400);
  }
}

export async function cancelPublicStorage(
  request: Request,
  env: Env,
  reservationId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(reservationId)) return json({ error: 'Reservation not found.' }, 404);
  await env.DB.prepare(
    `DELETE FROM fluo_public_allocations
      WHERE id = ?1 AND user_id = ?2 AND committed = 0`,
  ).bind(reservationId, session.userId).run();
  return json({ ok: true });
}

export async function releasePublicPost(
  request: Request,
  env: Env,
  nodeId: string,
  postId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(nodeId) || !NODE_ID.test(postId)) {
    return json({ error: 'Public post not found.' }, 404);
  }
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM fluo_post_likes
        WHERE node_id = ?1 AND space = 'public' AND post_id = ?2
          AND EXISTS (
            SELECT 1 FROM fluo_public_allocations AS allocations
             WHERE allocations.node_id = ?1 AND allocations.post_id = ?2
               AND allocations.committed = 1
               AND (allocations.user_id = ?3 OR EXISTS (
                 SELECT 1 FROM nodes WHERE nodes.id = ?1 AND nodes.user_id = ?3
               ))
          )`,
    ).bind(nodeId, postId, session.userId),
    env.DB.prepare(
      `DELETE FROM fluo_public_allocations
      WHERE node_id = ?1 AND post_id = ?2 AND committed = 1
        AND (user_id = ?3 OR EXISTS (
          SELECT 1 FROM nodes WHERE nodes.id = ?1 AND nodes.user_id = ?3
        ))`,
    ).bind(nodeId, postId, session.userId),
    env.DB.prepare(
      'DELETE FROM fluo_public_tombstones WHERE node_id = ?1 AND post_id = ?2',
    ).bind(nodeId, postId),
  ]);
  return json({ usage: await publicUsageResponse(env, session.userId, unixNow()) });
}

async function publicUsageResponse(env: Env, userId: ArrayBuffer, now: number) {
  const usage = await publicUsage(env, userId, now);
  return {
    limitBytes: PUBLIC_LIMIT_BYTES,
    reservedBytes: usage.reserved_bytes,
    usedBytes: usage.used_bytes,
  };
}

async function publicUsage(env: Env, userId: ArrayBuffer, now: number): Promise<UsageRow> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE
              WHEN allocations.committed = 0 AND allocations.expires_at > ?2
              THEN allocations.bytes ELSE 0 END), 0) AS reserved_bytes,
            COALESCE(SUM(CASE
              WHEN allocations.committed = 1 AND nodes.last_seen_at > ?3
              THEN allocations.bytes ELSE 0 END), 0) AS used_bytes
       FROM (
         SELECT user_id, node_id, bytes, committed, expires_at
           FROM fluo_public_allocations
         UNION ALL
         SELECT user_id, node_id, bytes, committed, expires_at
           FROM profile_public_allocations
       ) AS allocations
       LEFT JOIN nodes ON nodes.id = allocations.node_id
      WHERE allocations.user_id = ?1`,
  ).bind(userId, now, now - PUBLIC_NODE_RETIRE_SECONDS).first<UsageRow>();
  return {
    reserved_bytes: Number(row?.reserved_bytes ?? 0),
    used_bytes: Number(row?.used_bytes ?? 0),
  };
}

export async function clearExpiredPublicReservations(env: Env, now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM fluo_public_allocations WHERE committed = 0 AND expires_at <= ?1',
    ).bind(now),
    env.DB.prepare(
      'DELETE FROM profile_public_allocations WHERE committed = 0 AND expires_at <= ?1',
    ).bind(now),
  ]);
}

export async function retireOfflinePublicNodes(env: Env, now: number): Promise<void> {
  const cutoff = now - PUBLIC_NODE_RETIRE_SECONDS;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO fluo_public_tombstones (node_id, post_id, created_at)
       SELECT allocations.node_id, allocations.post_id, ?1
         FROM fluo_public_allocations AS allocations
         JOIN nodes ON nodes.id = allocations.node_id
        WHERE allocations.committed = 1
          AND allocations.post_id IS NOT NULL
          AND nodes.last_seen_at <= ?2`,
    ).bind(now, cutoff),
    env.DB.prepare(
      `DELETE FROM fluo_post_likes
        WHERE node_id IN (SELECT id FROM nodes WHERE last_seen_at <= ?1)
          AND space = 'public'`,
    ).bind(cutoff),
    env.DB.prepare(
      `DELETE FROM fluo_public_allocations
        WHERE committed = 1 AND node_id IN (
          SELECT id FROM nodes WHERE last_seen_at <= ?1
        )`,
    ).bind(cutoff),
    env.DB.prepare(
      `DELETE FROM profile_public_allocations
        WHERE committed = 1 AND node_id IN (
          SELECT id FROM nodes WHERE last_seen_at <= ?1
        )`,
    ).bind(cutoff),
  ]);
}

export async function retireNodePublicPosts(
  env: Env,
  nodeId: string,
  now: number,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO fluo_public_tombstones (node_id, post_id, created_at)
       SELECT node_id, post_id, ?1 FROM fluo_public_allocations
        WHERE node_id = ?2 AND committed = 1 AND post_id IS NOT NULL`,
    ).bind(now, nodeId),
    env.DB.prepare(
      `DELETE FROM fluo_post_likes WHERE node_id = ?1 AND space = 'public'`,
    ).bind(nodeId),
    env.DB.prepare(
      'DELETE FROM fluo_public_allocations WHERE node_id = ?1 AND committed = 1',
    ).bind(nodeId),
    env.DB.prepare(
      'DELETE FROM profile_public_allocations WHERE node_id = ?1 AND committed = 1',
    ).bind(nodeId),
  ]);
}

function supportsPublicReservations(version: string | null): boolean {
  const match = version?.match(/^(\d+)\.(\d+)(?:\.\d+)?(?:-[\w.-]+)?$/u);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 0 || minor >= 1;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_REQUEST_BYTES) throw new Error('Request is too large.');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) throw new Error('Request is too large.');
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object required.');
  return value as Record<string, unknown>;
}
