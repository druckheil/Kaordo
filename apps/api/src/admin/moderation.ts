import type { Env } from '../env';
import { base64Url, base64UrlBytes, arrayBuffer, randomBytes } from '../auth/encoding';
import { authenticate, unixNow, type AuthenticatedSession } from '../auth/session';
import { accountRole, isAdmin, SUPERADMIN_USERNAME, type UserRow } from '../auth/types';
import { json } from '../http/json';

const USER_ID = /^[A-Za-z0-9_-]{22}$/u;
const NODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_JOB_IDS = 64;

type EraseJobRow = {
  id: string;
  target_user_id: ArrayBuffer;
  target_username: string;
};

/** Ban a user and revoke every existing application session immediately. */
export async function adminBanUser(
  request: Request,
  env: Env,
  encodedUserId: string,
  ctx: ExecutionContext,
): Promise<Response> {
  const context = await adminContext(request, env);
  if (context instanceof Response) return context;
  const target = await targetUser(env, encodedUserId, context.session);
  if (target instanceof Response) return target;
  const pendingErase = await hasPendingErase(env, target.id);
  if (pendingErase) return json({ error: 'This account is being erased and cannot be changed.' }, 409);

  await env.DB.batch([
    env.DB.prepare('UPDATE users SET status = 2, online = 0 WHERE id = ?1').bind(target.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(target.id),
    env.DB.prepare('DELETE FROM node_access_tickets WHERE user_id = ?1').bind(target.id),
  ]);
  revokeLiveSockets(env, ctx, target.id);
  return json({ ok: true, status: 'suspended' });
}

/** Restore a previously banned account. Erasure is deliberately irreversible. */
export async function adminUnbanUser(
  request: Request,
  env: Env,
  encodedUserId: string,
): Promise<Response> {
  const context = await adminContext(request, env);
  if (context instanceof Response) return context;
  const target = await targetUser(env, encodedUserId, context.session);
  if (target instanceof Response) return target;
  if (await hasPendingErase(env, target.id)) {
    return json({ error: 'This account is being erased and cannot be restored.' }, 409);
  }
  await env.DB.prepare(
    'UPDATE users SET status = 1, online = 0 WHERE id = ?1 AND status = 2',
  ).bind(target.id).run();
  return json({ ok: true, status: 'active' });
}

/**
 * Start an account erasure. Metadata is removed now; every Nodo receives a
 * compact owner-cleanup job over its existing heartbeat and acknowledges it
 * only after local payloads have been deleted.
 */
export async function adminEraseUser(
  request: Request,
  env: Env,
  encodedUserId: string,
  ctx: ExecutionContext,
): Promise<Response> {
  const context = await adminContext(request, env);
  if (context instanceof Response) return context;
  const target = await targetUser(env, encodedUserId, context.session);
  if (target instanceof Response) return target;

  const existing = await erasePendingCount(env, target.id);
  if (existing > 0) {
    return json({ ok: true, status: 'erasing', pendingJobs: existing }, 202);
  }

  const nodes = await env.DB.prepare('SELECT id FROM nodes ORDER BY id ASC').all<{ id: string }>();
  const now = unixNow();
  const jobs = nodes.results.filter((node) => NODE_ID.test(node.id)).map((node) => ({
    id: crypto.randomUUID(),
    nodeId: node.id,
  }));
  const statements: D1PreparedStatement[] = [
    env.DB.prepare('UPDATE users SET status = 2, online = 0 WHERE id = ?1').bind(target.id),
    env.DB.prepare('DELETE FROM node_access_tickets WHERE user_id = ?1').bind(target.id),
    env.DB.prepare('DELETE FROM user_profiles WHERE user_id = ?1').bind(target.id),
    env.DB.prepare(
      `DELETE FROM fluo_public_tombstones
        WHERE EXISTS (
          SELECT 1 FROM fluo_public_allocations AS allocations
           WHERE allocations.user_id = ?1
             AND allocations.node_id = fluo_public_tombstones.node_id
             AND allocations.post_id = fluo_public_tombstones.post_id
        )`,
    ).bind(target.id),
    env.DB.prepare('DELETE FROM profile_public_allocations WHERE user_id = ?1').bind(target.id),
    env.DB.prepare('DELETE FROM fluo_public_allocations WHERE user_id = ?1').bind(target.id),
    env.DB.prepare('DELETE FROM ligo_message_deletions WHERE recipient_id = ?1 OR sender_id = ?1').bind(target.id),
    // Keep rows addressed to other participants so their next Ligo sync
    // removes the local copy of this conversation before finalization.
    env.DB.prepare('DELETE FROM ligo_conversation_deletions WHERE recipient_id = ?1').bind(target.id),
    env.DB.prepare(
      `INSERT INTO ligo_conversation_deletions (recipient_id, peer_id, created_at)
       SELECT peer_id, ?1, ?2 FROM (
         SELECT CASE WHEN user_low_id = ?1 THEN user_high_id ELSE user_low_id END AS peer_id
           FROM ligo_conversations
          WHERE user_low_id = ?1 OR user_high_id = ?1
         UNION
         SELECT CASE WHEN owner_id = ?1 THEN peer_id ELSE owner_id END AS peer_id
           FROM ligo_cloud_messages
          WHERE owner_id = ?1 OR peer_id = ?1
         UNION
         SELECT CASE WHEN sender_id = ?1 THEN recipient_id ELSE sender_id END AS peer_id
           FROM ligo_deliveries
          WHERE sender_id = ?1 OR recipient_id = ?1
       ) AS peers
       WHERE peer_id != ?1
       ON CONFLICT(recipient_id, peer_id) DO UPDATE SET created_at = excluded.created_at`,
    ).bind(target.id, now),
    env.DB.prepare('DELETE FROM ligo_deliveries WHERE sender_id = ?1 OR recipient_id = ?1').bind(target.id),
    env.DB.prepare('DELETE FROM ligo_conversations WHERE user_low_id = ?1 OR user_high_id = ?1 OR last_sender_id = ?1').bind(target.id),
    // Tombstones are not foreign-keyed to cloud messages because they may
    // outlive a payload while an offline Nodo reconciles it. Remove both
    // tombstones owned by this account and tombstones for messages where the
    // account was the peer; otherwise an erased user's delivery metadata
    // would remain on another user's Nodo.
    env.DB.prepare(
      `DELETE FROM ligo_cloud_tombstones
        WHERE owner_id = ?1
           OR message_id IN (
                SELECT id FROM ligo_cloud_messages
                 WHERE owner_id = ?1 OR peer_id = ?1
              )`,
    ).bind(target.id),
    env.DB.prepare('DELETE FROM ligo_cloud_messages WHERE owner_id = ?1 OR peer_id = ?1').bind(target.id),
    env.DB.prepare('DELETE FROM ligo_storage_settings WHERE user_id = ?1').bind(target.id),
    env.DB.prepare('DELETE FROM rondo_invites WHERE created_by = ?1').bind(target.id),
    env.DB.prepare('DELETE FROM rondo_members WHERE user_id = ?1').bind(target.id),
    env.DB.prepare('DELETE FROM rondo_spaces WHERE owner_user_id = ?1').bind(target.id),
  ];
  jobs.forEach((job) => statements.push(env.DB.prepare(
    `INSERT INTO admin_erase_jobs
      (id, node_id, target_user_id, target_username, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).bind(job.id, job.nodeId, target.id, target.username, now)));

  await env.DB.batch(statements);
  revokeLiveSockets(env, ctx, target.id);

  const pending = await erasePendingCount(env, target.id);
  if (pending === 0) {
    await finalizeAdminEraseUser(env, target.id);
    return json({ ok: true, status: 'erased', pendingJobs: 0 });
  }
  return json({ ok: true, status: 'erasing', pendingJobs: pending }, 202);
}

/** Apply heartbeat acknowledgements and finalize accounts with no jobs left. */
export async function acknowledgeAdminEraseJobs(
  env: Env,
  nodeId: string,
  jobIds: string[],
): Promise<void> {
  if (!NODE_ID.test(nodeId) || jobIds.length === 0) return;
  const unique = [...new Set(jobIds)].slice(0, MAX_JOB_IDS);
  if (unique.some((id) => !NODE_ID.test(id))) return;
  const placeholders = unique.map((_, index) => `?${index + 2}`).join(', ');
  const rows = await env.DB.prepare(
    `SELECT id, target_user_id, target_username
       FROM admin_erase_jobs
      WHERE node_id = ?1 AND id IN (${placeholders})`,
  ).bind(nodeId, ...unique).all<EraseJobRow>();
  if (rows.results.length === 0) return;
  await env.DB.prepare(
    `DELETE FROM admin_erase_jobs WHERE node_id = ?1 AND id IN (${placeholders})`,
  ).bind(nodeId, ...unique).run();

  const targets = new Map<string, ArrayBuffer>();
  rows.results.forEach((row) => targets.set(base64Url(row.target_user_id), row.target_user_id));
  for (const userId of targets.values()) await finalizeAdminEraseUser(env, userId);
}

export async function pendingAdminEraseJobs(
  env: Env,
  nodeId: string,
): Promise<Array<{ id: string; username: string }>> {
  if (!NODE_ID.test(nodeId)) return [];
  const rows = await env.DB.prepare(
    `SELECT id, target_username FROM admin_erase_jobs
      WHERE node_id = ?1 ORDER BY created_at ASC, id ASC LIMIT ?2`,
  ).bind(nodeId, MAX_JOB_IDS).all<{ id: string; target_username: string }>();
  return rows.results.map((row) => ({ id: row.id, username: row.target_username }));
}

async function adminContext(
  request: Request,
  env: Env,
): Promise<{ session: AuthenticatedSession } | Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!isAdmin(session.publicUser)) return json({ error: 'Administrator access required.' }, 403);
  return { session };
}

async function targetUser(
  env: Env,
  encodedUserId: string,
  session: AuthenticatedSession,
): Promise<UserRow | Response> {
  if (!USER_ID.test(encodedUserId)) return json({ error: 'User identifier is invalid.' }, 400);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64UrlBytes(encodedUserId);
  } catch {
    return json({ error: 'User identifier is invalid.' }, 400);
  }
  if (bytes.byteLength !== 16) return json({ error: 'User identifier is invalid.' }, 400);
  const target = await env.DB.prepare(
    `SELECT id, username, display_username, password_hash, password_salt,
            password_algorithm, password_iterations, created_at, status,
            role, last_seen_at
       FROM users WHERE id = ?1 LIMIT 1`,
  ).bind(arrayBuffer(bytes)).first<UserRow>();
  if (!target) return json({ error: 'User was not found.' }, 404);
  if (base64Url(target.id) === base64Url(session.userId)) {
    return json({ error: 'You cannot moderate your own account.' }, 403);
  }
  if (target.username === SUPERADMIN_USERNAME || accountRole(target.username, target.role) === 'superadmin') {
    return json({ error: 'The root superadmin cannot be moderated.' }, 403);
  }
  return target;
}

async function hasPendingErase(env: Env, userId: ArrayBuffer): Promise<boolean> {
  return (await erasePendingCount(env, userId)) > 0;
}

export async function finalizeAdminEraseUser(env: Env, userId: ArrayBuffer): Promise<void> {
  if ((await erasePendingCount(env, userId)) > 0) return;
  // Keep the account suspended until every Nodo and every Ligo peer confirms
  // local cleanup. The conditional makes repeated acknowledgements safe.
  await env.DB.prepare('DELETE FROM users WHERE id = ?1 AND status = 2').bind(userId).run();
}

export async function erasePendingCount(env: Env, userId: ArrayBuffer): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM admin_erase_jobs WHERE target_user_id = ?1) +
       (SELECT COUNT(*) FROM ligo_conversation_deletions WHERE peer_id = ?1)
       AS count`,
  ).bind(userId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

function revokeLiveSockets(env: Env, ctx: ExecutionContext, userId: ArrayBuffer): void {
  const keepSessionKey = base64Url(randomBytes(32));
  ctx.waitUntil(env.LIGO_LIVE.getByName(base64Url(userId))
    .notifySessionRevoked(keepSessionKey)
    .catch((error: unknown) => {
      console.error(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        message: 'Could not broadcast administrative session revocation.',
      }));
    }));
}
