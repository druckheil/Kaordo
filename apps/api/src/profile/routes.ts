import type { Env } from '../env';
import { authenticate, unixNow } from '../auth/session';
import { json } from '../http/json';
import { publicStorageForUser } from '../fluo/public-storage';

const NODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROFILE_ID = NODE_ID;
const RESERVATION_SECONDS = 10 * 60;
const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
const MAX_PROFILE_BYTES = 32 * 1024;
const MAX_TOTAL_BYTES = MAX_AVATAR_BYTES + MAX_PROFILE_BYTES;

type ProfileRow = {
  allocation_id: string;
  avatar_file_id: string | null;
  avatar_mime_type: string | null;
  avatar_size: number;
  node_id: string;
  profile_file_id: string;
  profile_size: number;
  updated_at: number;
};

type PreviousProfile = {
  avatarFileId: string | null;
  nodeId: string;
  profileFileId: string;
};

type ProfilePointerInput = {
  allocationId: string;
  avatarFileId: string | null;
  avatarMimeType: string | null;
  avatarSize: number;
  nodeId: string;
  profileFileId: string;
  profileSize: number;
  updatedAt: number;
};

export async function getProfile(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  const row = await profileRow(env, session.userId);
  return json({ profile: row ? profilePointer(row) : null });
}

export async function reserveProfileStorage(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await readJson(request);
    if (typeof input.nodeId !== 'string' || !NODE_ID.test(input.nodeId) ||
        !Number.isSafeInteger(input.bytes) || (input.bytes as number) <= 0 ||
        (input.bytes as number) > MAX_TOTAL_BYTES) {
      return json({ error: 'Profile storage reservation is invalid.' }, 400);
    }
    const now = unixNow();
    const storage = await publicStorageForUser(env, session.userId, now);
    const candidate = storage.nodeCandidates.find((node) => node.nodeId === input.nodeId);
    if (!candidate || candidate.availableBytes < (input.bytes as number)) {
      return json({ error: 'Your Public Nodo does not have enough available space.' }, 409);
    }
    const owned = await env.DB.prepare(
      `SELECT id FROM nodes
        WHERE id = ?1 AND user_id = ?2 AND public_quota_bytes > 0
          AND allow_uploads = 1 AND last_seen_at >= ?3
        LIMIT 1`,
    ).bind(input.nodeId, session.userId, now - 300).first<{ id: string }>();
    if (!owned) return json({ error: 'Choose an online Public Nodo owned by this account.' }, 409);
    const reservationId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const result = await env.DB.prepare(
      `INSERT INTO profile_public_allocations
         (id, user_id, node_id, profile_id, bytes, committed, created_at, expires_at)
       SELECT ?1, ?2, nodes.id, ?3, ?4, 0, ?5, ?6
         FROM nodes
        WHERE nodes.id = ?7 AND nodes.user_id = ?2
          AND nodes.last_seen_at >= ?8 AND nodes.allow_uploads = 1
          AND nodes.public_quota_bytes > 0
          AND ?4 + COALESCE((
            SELECT SUM(bytes) FROM profile_public_allocations
             WHERE node_id = nodes.id AND committed = 0 AND expires_at > ?5
          ), 0) + COALESCE((
            SELECT SUM(bytes) FROM fluo_public_allocations
             WHERE node_id = nodes.id AND committed = 0 AND expires_at > ?5
          ), 0) <= nodes.public_quota_bytes - nodes.public_used_bytes`,
    ).bind(
      reservationId,
      session.userId,
      profileId,
      input.bytes,
      now,
      now + RESERVATION_SECONDS,
      input.nodeId,
      now - 300,
    ).run();
    if ((result.meta.changes ?? 0) === 0) {
      return json({ error: 'This Public Nodo no longer has enough available space.' }, 409);
    }
    return json({ expiresAt: now + RESERVATION_SECONDS, profileId, reservationId, nodeId: input.nodeId }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Profile storage reservation is invalid.' }, 400);
  }
}

export async function commitProfileStorage(
  request: Request,
  env: Env,
  reservationId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!PROFILE_ID.test(reservationId)) return json({ error: 'Profile reservation was not found.' }, 404);
  try {
    const input = await readJson(request);
    if (!isFileId(input.profileFileId) ||
        (input.avatarFileId !== null && input.avatarFileId !== undefined && !isFileId(input.avatarFileId)) ||
        !Number.isSafeInteger(input.profileSize) || (input.profileSize as number) <= 0 ||
        (input.profileSize as number) > MAX_PROFILE_BYTES ||
        !Number.isSafeInteger(input.avatarSize) || (input.avatarSize as number) < 0 ||
        (input.avatarSize as number) > MAX_AVATAR_BYTES ||
        (input.avatarSize as number) > 0 && typeof input.avatarMimeType !== 'string') {
      return json({ error: 'Profile payload is invalid.' }, 400);
    }
    const avatarFileId = typeof input.avatarFileId === 'string' ? input.avatarFileId : null;
    const avatarMimeType = avatarFileId ? String(input.avatarMimeType).slice(0, 120) : null;
    const profileSize = input.profileSize as number;
    const avatarSize = input.avatarSize as number;
    const bytes = profileSize + avatarSize;
    const now = unixNow();
    const reservation = await env.DB.prepare(
      `SELECT id, node_id, profile_id, bytes
         FROM profile_public_allocations
        WHERE id = ?1 AND user_id = ?2 AND committed = 0 AND expires_at > ?3
        LIMIT 1`,
    ).bind(reservationId, session.userId, now).first<{
      bytes: number;
      id: string;
      node_id: string;
      profile_id: string;
    }>();
    if (!reservation) return json({ error: 'Profile storage reservation expired or was not found.' }, 409);
    if (bytes > reservation.bytes) return json({ error: 'Profile payload exceeds its reservation.' }, 413);
    const previous = await profileRow(env, session.userId);
    const pointer = {
      allocationId: reservation.id,
      avatarFileId,
      avatarMimeType,
      avatarSize,
      nodeId: reservation.node_id,
      profileFileId: input.profileFileId as string,
      profileSize,
      updatedAt: now,
    };
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `UPDATE profile_public_allocations
            SET profile_id = ?1, bytes = ?2, committed = 1, expires_at = 0
          WHERE id = ?3 AND user_id = ?4 AND committed = 0`,
      ).bind(reservation.profile_id, bytes, reservation.id, session.userId),
      env.DB.prepare(
        `INSERT INTO user_profiles
           (user_id, allocation_id, node_id, profile_file_id, avatar_file_id,
            avatar_mime_type, avatar_size, profile_size, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(user_id) DO UPDATE SET
           allocation_id = excluded.allocation_id,
           node_id = excluded.node_id,
           profile_file_id = excluded.profile_file_id,
           avatar_file_id = excluded.avatar_file_id,
           avatar_mime_type = excluded.avatar_mime_type,
           avatar_size = excluded.avatar_size,
           profile_size = excluded.profile_size,
           updated_at = excluded.updated_at`,
      ).bind(
        session.userId,
        pointer.allocationId,
        pointer.nodeId,
        pointer.profileFileId,
        pointer.avatarFileId,
        pointer.avatarMimeType,
        pointer.avatarSize,
        pointer.profileSize,
        pointer.updatedAt,
      ),
    ];
    if (previous && previous.allocation_id !== reservation.id) {
      statements.push(env.DB.prepare(
        'DELETE FROM profile_public_allocations WHERE id = ?1 AND user_id = ?2',
      ).bind(previous.allocation_id, session.userId));
    }
    await env.DB.batch(statements);
    return json({ profile: profilePointer(pointer), previous: previous ? previousPointer(previous) : null });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Profile could not be saved.' }, 400);
  }
}

export async function cancelProfileStorage(
  request: Request,
  env: Env,
  reservationId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (PROFILE_ID.test(reservationId)) {
    await env.DB.prepare(
      'DELETE FROM profile_public_allocations WHERE id = ?1 AND user_id = ?2 AND committed = 0',
    ).bind(reservationId, session.userId).run();
  }
  return json({ ok: true });
}

async function profileRow(env: Env, userId: ArrayBuffer): Promise<ProfileRow | null> {
  return env.DB.prepare(
    `SELECT allocation_id, avatar_file_id, avatar_mime_type, avatar_size,
            node_id, profile_file_id, profile_size, updated_at
       FROM user_profiles WHERE user_id = ?1 LIMIT 1`,
  ).bind(userId).first<ProfileRow>();
}

function profilePointer(row: ProfileRow | ProfilePointerInput) {
  const value = 'allocation_id' in row
    ? {
        allocationId: row.allocation_id,
        avatarFileId: row.avatar_file_id,
        avatarMimeType: row.avatar_mime_type,
        avatarSize: row.avatar_size,
        nodeId: row.node_id,
        profileFileId: row.profile_file_id,
        profileSize: row.profile_size,
        updatedAt: row.updated_at,
      }
    : row;
  return {
    ...value,
  };
}

function previousPointer(row: ProfileRow): PreviousProfile {
  return { avatarFileId: row.avatar_file_id, nodeId: row.node_id, profileFileId: row.profile_file_id };
}

function isFileId(value: unknown): value is string {
  return typeof value === 'string' && PROFILE_ID.test(value);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_PROFILE_BYTES) throw new Error('Profile request is too large.');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_PROFILE_BYTES) throw new Error('Profile request is too large.');
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object required.');
  return value as Record<string, unknown>;
}
