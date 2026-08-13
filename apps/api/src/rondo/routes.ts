import type { Env } from '../env';
import { base64Url, utf8 } from '../auth/encoding';
import { authenticate, unixNow } from '../auth/session';
import { json } from '../http/json';
import { createRondoIceConfiguration } from './turn';

export const PUBLIC_RONDO_LIMIT_BYTES = 1_073_741_824;
const ONLINE_SECONDS = 300;
const MAX_REQUEST_BYTES = 4_096;
const NODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const INVITE_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/u;

type SpaceRow = {
  created_at: number;
  description: string;
  device_name: string | null;
  id: string;
  last_seen_at: number | null;
  member_count: number;
  name: string;
  owner_id: ArrayBuffer;
  owner_username: string;
  primary_node_id: string | null;
  primary_node_space: number;
  quota_bytes: number;
  role: number;
  used_bytes: number;
};

export async function rondoVoiceIce(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  const rate = await env.TURN_CREDENTIAL_LIMITER.limit({
    key: `rondo-turn:${session.publicUser.id}`,
  });
  if (!rate.success) {
    return json({ error: 'Too many voice connection attempts.' }, 429, { 'retry-after': '60' });
  }
  return json(await createRondoIceConfiguration(env, unixNow(), session.publicUser.id));
}

export async function rondoBootstrap(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  const now = unixNow();
  const [spaces, privateNodes, publicSpace, publicNodo] = await Promise.all([
    spacesForUser(env, session.userId, now),
    env.DB.prepare(
      `SELECT id, device_name, last_seen_at, private_quota_bytes, private_used_bytes
         FROM nodes
        WHERE user_id = ?1 AND private_quota_bytes > 0 AND allow_uploads = 1
        ORDER BY last_seen_at DESC, id ASC`,
    ).bind(session.userId).all<{
      device_name: string;
      id: string;
      last_seen_at: number;
      private_quota_bytes: number;
      private_used_bytes: number;
    }>(),
    env.DB.prepare(
      'SELECT 1 AS found FROM rondo_spaces WHERE owner_user_id = ?1 AND public_quota_bytes > 0 LIMIT 1',
    ).bind(session.userId).first<{ found: number }>(),
    publicNodoAvailable(env, now),
  ]);
  return json({
    privateNodes: privateNodes.results.map((node) => ({
      availableBytes: Math.max(0, node.private_quota_bytes - node.private_used_bytes),
      deviceName: node.device_name,
      nodeId: node.id,
      online: now - node.last_seen_at <= ONLINE_SECONDS,
      quotaBytes: node.private_quota_bytes,
      usedBytes: node.private_used_bytes,
    })),
    publicOption: {
      available: !publicSpace && publicNodo,
      alreadyCreated: Boolean(publicSpace),
      limitBytes: PUBLIC_RONDO_LIMIT_BYTES,
    },
    spaces,
  });
}

export async function createRondoSpace(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await readInput(request);
    const name = requiredText(input.name, 2, 48, 'Space name must be 2–48 characters.');
    const description = optionalText(input.description, 180, 'Description must be 180 characters or less.');
    const storage = input.storage;
    if (storage !== 'private' && storage !== 'public') {
      throw new RondoInputError('Choose a storage location.');
    }
    const now = unixNow();
    let nodeId: string | null;
    let quotaBytes: number;
    if (storage === 'public') {
      const existing = await env.DB.prepare(
        'SELECT 1 AS found FROM rondo_spaces WHERE owner_user_id = ?1 AND public_quota_bytes > 0 LIMIT 1',
      ).bind(session.userId).first<{ found: number }>();
      if (existing) return json({ error: 'Only one free Public Node Space can be created per account.' }, 409);
      const node = await selectPublicNodo(env, now);
      if (!node) return json({ error: 'No Public Node storage is currently available.' }, 409);
      nodeId = null;
      quotaBytes = PUBLIC_RONDO_LIMIT_BYTES;
    } else {
      if (typeof input.nodeId !== 'string' || !NODE_ID.test(input.nodeId)) {
        throw new RondoInputError('Choose one of your private Nodo devices.');
      }
      const node = await env.DB.prepare(
        `SELECT id, private_quota_bytes, private_used_bytes, last_seen_at
           FROM nodes
          WHERE id = ?1 AND user_id = ?2 AND private_quota_bytes > 0 AND allow_uploads = 1
          LIMIT 1`,
      ).bind(input.nodeId, session.userId).first<{
        id: string;
        last_seen_at: number;
        private_quota_bytes: number;
        private_used_bytes: number;
      }>();
      if (!node) return json({ error: 'The selected private Nodo is unavailable.' }, 409);
      if (now - node.last_seen_at > ONLINE_SECONDS) {
        return json({ error: 'The selected private Nodo is offline.' }, 409);
      }
      if (node.private_used_bytes >= node.private_quota_bytes) {
        return json({ error: 'The selected private Nodo has no free space.' }, 409);
      }
      nodeId = node.id;
      quotaBytes = node.private_quota_bytes;
    }

    const spaceId = crypto.randomUUID();
    const tierId = crypto.randomUUID();
    const roomId = crypto.randomUUID();
    const inviteId = crypto.randomUUID();
    const inviteCode = randomInviteCode();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO rondo_spaces
          (id, owner_user_id, name, description, primary_node_id,
           primary_node_space, quota_bytes, used_bytes, created_at, public_quota_bytes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9)`,
      ).bind(
        spaceId,
        session.userId,
        name,
        description,
        nodeId,
        storage === 'public' ? 1 : 0,
        quotaBytes,
        now,
        storage === 'public' ? PUBLIC_RONDO_LIMIT_BYTES : 0,
      ),
      env.DB.prepare(
        `INSERT INTO rondo_space_nodes
          (id, space_id, node_id, storage_kind, position, quota_bytes, used_bytes, created_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, 0, ?6)`,
      ).bind(tierId, spaceId, nodeId, storage === 'public' ? 1 : 0, quotaBytes, now),
      env.DB.prepare(
        `INSERT INTO rondo_rooms (id, space_id, name, position, created_at)
         VALUES (?1, ?2, 'general', 0, ?3)`,
      ).bind(roomId, spaceId, now),
      env.DB.prepare(
        `INSERT INTO rondo_members (space_id, user_id, role, joined_at)
         VALUES (?1, ?2, 1, ?3)`,
      ).bind(spaceId, session.userId, now),
      env.DB.prepare(
        `INSERT INTO rondo_invites
          (id, space_id, code_hash, created_by, created_at, expires_at, max_uses, uses)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, 0, 0)`,
      ).bind(inviteId, spaceId, await inviteHash(inviteCode), session.userId, now),
    ]);
    const space = (await spacesForUser(env, session.userId, now, spaceId))[0];
    if (!space) throw new Error('Created Space was not found.');
    return json({ inviteCode: displayInviteCode(inviteCode), space }, 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return json({ error: 'Only one free Public Node Space can be created per account.' }, 409);
    }
    if (error instanceof RondoInputError) return json({ error: error.message }, 400);
    console.error('Rondo Space creation failed.', error);
    return json({ error: 'The Space could not be created.' }, 503);
  }
}

export async function joinRondoSpace(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await readInput(request);
    const inviteCode = normalizeInviteCode(input.inviteCode);
    if (!inviteCode) throw new RondoInputError('Enter a valid Rondo invite code.');
    const now = unixNow();
    const invite = await env.DB.prepare(
      `SELECT id, space_id
         FROM rondo_invites
        WHERE code_hash = ?1
          AND (expires_at IS NULL OR expires_at > ?2)
          AND (max_uses = 0 OR uses < max_uses)
        LIMIT 1`,
    ).bind(await inviteHash(inviteCode), now).first<{ id: string; space_id: string }>();
    if (!invite) return json({ error: 'This invite is invalid or has expired.' }, 404);
    const existing = await env.DB.prepare(
      'SELECT 1 AS found FROM rondo_members WHERE space_id = ?1 AND user_id = ?2 LIMIT 1',
    ).bind(invite.space_id, session.userId).first<{ found: number }>();
    if (!existing) {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO rondo_members (space_id, user_id, role, joined_at)
           VALUES (?1, ?2, 0, ?3)`,
        ).bind(invite.space_id, session.userId, now),
        env.DB.prepare('UPDATE rondo_invites SET uses = uses + 1 WHERE id = ?1').bind(invite.id),
      ]);
    }
    const space = (await spacesForUser(env, session.userId, now, invite.space_id))[0];
    if (!space) return json({ error: 'This Space is no longer available.' }, 404);
    return json({ space });
  } catch (error) {
    if (error instanceof RondoInputError) return json({ error: error.message }, 400);
    console.error('Rondo invite join failed.', error);
    return json({ error: 'The Space could not be joined.' }, 503);
  }
}

export async function rondoSpaceDetail(
  request: Request,
  env: Env,
  spaceId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(spaceId)) return json({ error: 'Space not found.' }, 404);
  const access = await spaceAccess(env, spaceId, session.userId);
  if (!access) return json({ error: 'Space not found.' }, 404);
  const now = unixNow();
  const [space, rooms, nodes, members, invites] = await Promise.all([
    spacesForUser(env, session.userId, now, spaceId).then(([value]) => value),
    env.DB.prepare(
      `SELECT id, name, position, created_at FROM rondo_rooms
        WHERE space_id = ?1 ORDER BY position ASC, id ASC`,
    ).bind(spaceId).all<{ created_at: number; id: string; name: string; position: number }>(),
    nodeTiers(env, spaceId, now),
    env.DB.prepare(
      `SELECT users.id, users.display_username AS username, users.last_seen_at,
              members.role, members.joined_at, members.user_id = ?2 AS self
         FROM rondo_members AS members
         JOIN users ON users.id = members.user_id
        WHERE members.space_id = ?1
        ORDER BY members.role DESC, users.last_seen_at DESC, users.display_username ASC`,
    ).bind(spaceId, session.userId).all<{
      id: ArrayBuffer;
      joined_at: number;
      last_seen_at: number;
      role: number;
      self: number;
      username: string;
    }>(),
    access.owner
      ? env.DB.prepare(
          `SELECT id, created_at, expires_at, max_uses, uses
             FROM rondo_invites WHERE space_id = ?1
            ORDER BY created_at DESC, id ASC`,
        ).bind(spaceId).all<{
          created_at: number;
          expires_at: number | null;
          id: string;
          max_uses: number;
          uses: number;
        }>()
      : Promise.resolve({ results: [] }),
  ]);
  if (!space) return json({ error: 'Space not found.' }, 404);
  return json({
    detail: {
      ...space,
      invites: invites.results.map((invite) => ({
        code: null,
        createdAt: invite.created_at,
        expiresAt: invite.expires_at,
        id: invite.id,
        maxUses: invite.max_uses,
        uses: invite.uses,
      })),
      members: members.results.map((member) => ({
        id: base64Url(member.id),
        joinedAt: member.joined_at,
        online: now - member.last_seen_at <= 15 * 60,
        role: member.role === 1 ? 'owner' : 'member',
        self: Boolean(member.self),
        username: member.username,
      })),
      nodes,
      rooms: rooms.results.map((room) => ({
        createdAt: room.created_at,
        id: room.id,
        name: room.name,
        position: room.position,
      })),
    },
  });
}

export async function rondoRoomRoute(
  request: Request,
  env: Env,
  spaceId: string,
  roomId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(spaceId) || !NODE_ID.test(roomId)) {
    return json({ error: 'Room not found.' }, 404);
  }
  const access = await env.DB.prepare(
    `SELECT EXISTS(
             SELECT 1 FROM rondo_rooms
              WHERE rondo_rooms.id = ?1 AND rondo_rooms.space_id = ?2
           ) AS room_found
       FROM rondo_members
      WHERE rondo_members.space_id = ?2 AND rondo_members.user_id = ?3
     LIMIT 1`,
  ).bind(roomId, spaceId, session.userId).first<{ room_found: number }>();
  if (!access) return json({ error: 'Space membership required.' }, 403);
  if (!access.room_found) return json({ error: 'Room not found.' }, 404);

  const now = unixNow();
  let route = await existingRoomRoute(env, spaceId, roomId);
  if (!route) {
    const tiers = await env.DB.prepare(
      `SELECT node_id, storage_kind, quota_bytes
         FROM rondo_space_nodes
        WHERE space_id = ?1
        ORDER BY position ASC, id ASC`,
    ).bind(spaceId).all<{
      node_id: string | null;
      quota_bytes: number;
      storage_kind: number;
    }>();
    for (const tier of tiers.results) {
      const nodeId = tier.storage_kind === 1
        ? (await selectPublicNodo(env, now))?.id ?? null
        : tier.node_id;
      if (!nodeId) continue;
      const node = await env.DB.prepare(
        `SELECT last_seen_at, allow_downloads, allow_uploads
           FROM nodes WHERE id = ?1 LIMIT 1`,
      ).bind(nodeId).first<{
        allow_downloads: number;
        allow_uploads: number;
        last_seen_at: number;
      }>();
      if (!node || now - node.last_seen_at > ONLINE_SECONDS ||
          !node.allow_downloads || !node.allow_uploads) continue;
      try {
        await env.DB.prepare(
          `INSERT INTO rondo_room_routes
            (room_id, space_id, node_id, storage_kind, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5)`,
        ).bind(roomId, spaceId, nodeId, tier.storage_kind, now).run();
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
      }
      route = await existingRoomRoute(env, spaceId, roomId);
      break;
    }
  }
  if (!route) return json({ error: 'No assigned Nodo is currently available.' }, 409);
  return json({
    limitBytes: route.limit_bytes,
    nodeId: route.node_id,
    storage: route.storage_kind === 1 ? 'public' : 'private',
  });
}

export async function updateRondoSpace(
  request: Request,
  env: Env,
  spaceId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(spaceId)) return json({ error: 'Space not found.' }, 404);
  if (!(await spaceAccess(env, spaceId, session.userId))?.owner) {
    return json({ error: 'Space owner access required.' }, 403);
  }
  try {
    const input = await readInput(request);
    const name = requiredText(input.name, 2, 48, 'Space name must be 2–48 characters.');
    const description = optionalText(input.description, 180, 'Description must be 180 characters or less.');
    await env.DB.prepare(
      'UPDATE rondo_spaces SET name = ?1, description = ?2 WHERE id = ?3',
    ).bind(name, description, spaceId).run();
    const space = (await spacesForUser(env, session.userId, unixNow(), spaceId))[0];
    return json({ space });
  } catch (error) {
    return json({
      error: error instanceof RondoInputError ? error.message : 'Space settings are invalid.',
    }, 400);
  }
}

export async function createRondoInvite(
  request: Request,
  env: Env,
  spaceId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(spaceId)) return json({ error: 'Space not found.' }, 404);
  if (!(await spaceAccess(env, spaceId, session.userId))?.owner) {
    return json({ error: 'Space owner access required.' }, 403);
  }
  try {
    const input = await readInput(request);
    const expiresInDays = input.expiresInDays ?? 7;
    const maxUses = input.maxUses ?? 0;
    if (![0, 1, 7, 30].includes(expiresInDays as number) ||
        !Number.isInteger(maxUses) || (maxUses as number) < 0 || (maxUses as number) > 1_000) {
      throw new RondoInputError('Invite limits are invalid.');
    }
    const now = unixNow();
    const expiresAt = expiresInDays === 0 ? null : now + (expiresInDays as number) * 86_400;
    const code = randomInviteCode();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO rondo_invites
        (id, space_id, code_hash, created_by, created_at, expires_at, max_uses, uses)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)`,
    ).bind(id, spaceId, await inviteHash(code), session.userId, now, expiresAt, maxUses).run();
    return json({ invite: {
      code: displayInviteCode(code),
      createdAt: now,
      expiresAt,
      id,
      maxUses,
      uses: 0,
    } }, 201);
  } catch (error) {
    return json({
      error: error instanceof RondoInputError ? error.message : 'Invite could not be created.',
    }, 400);
  }
}

export async function revokeRondoInvite(
  request: Request,
  env: Env,
  spaceId: string,
  inviteId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(spaceId) || !NODE_ID.test(inviteId)) return json({ error: 'Invite not found.' }, 404);
  if (!(await spaceAccess(env, spaceId, session.userId))?.owner) {
    return json({ error: 'Space owner access required.' }, 403);
  }
  const result = await env.DB.prepare(
    'DELETE FROM rondo_invites WHERE id = ?1 AND space_id = ?2',
  ).bind(inviteId, spaceId).run();
  if ((result.meta.changes ?? 0) === 0) return json({ error: 'Invite not found.' }, 404);
  return json({ ok: true });
}

export async function createRondoRoom(
  request: Request,
  env: Env,
  spaceId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(spaceId)) return json({ error: 'Space not found.' }, 404);
  if (!(await spaceAccess(env, spaceId, session.userId))?.owner) {
    return json({ error: 'Space owner access required.' }, 403);
  }
  try {
    const input = await readInput(request);
    const name = roomName(input.name);
    const room = { createdAt: unixNow(), id: crypto.randomUUID(), name, position: 0 };
    const inserted = await env.DB.prepare(
      `INSERT INTO rondo_rooms (id, space_id, name, position, created_at)
       SELECT ?1, ?2, ?3, COALESCE(MAX(position), -1) + 1, ?4
         FROM rondo_rooms WHERE space_id = ?2
       HAVING COUNT(*) < 128
       RETURNING position`,
    ).bind(room.id, spaceId, room.name, room.createdAt).first<{ position: number }>();
    if (!inserted) return json({ error: 'A Space can contain up to 128 rooms.' }, 409);
    room.position = inserted.position;
    return json({ room }, 201);
  } catch (error) {
    return json({ error: error instanceof RondoInputError ? error.message : 'Room could not be created.' }, 400);
  }
}

export async function deleteRondoRoom(
  request: Request,
  env: Env,
  spaceId: string,
  roomId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(spaceId) || !NODE_ID.test(roomId)) return json({ error: 'Room not found.' }, 404);
  if (!(await spaceAccess(env, spaceId, session.userId))?.owner) {
    return json({ error: 'Space owner access required.' }, 403);
  }
  const result = await env.DB.prepare(
    `DELETE FROM rondo_rooms
      WHERE id = ?1 AND space_id = ?2
        AND (SELECT COUNT(*) FROM rondo_rooms WHERE space_id = ?2) > 1`,
  ).bind(roomId, spaceId).run();
  if ((result.meta.changes ?? 0) === 0) {
    const room = await env.DB.prepare(
      'SELECT 1 AS found FROM rondo_rooms WHERE id = ?1 AND space_id = ?2 LIMIT 1',
    ).bind(roomId, spaceId).first<{ found: number }>();
    return room
      ? json({ error: 'Every Space needs at least one room.' }, 409)
      : json({ error: 'Room not found.' }, 404);
  }
  return json({ ok: true });
}

export async function addRondoNode(
  request: Request,
  env: Env,
  spaceId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(spaceId)) return json({ error: 'Space not found.' }, 404);
  if (!(await spaceAccess(env, spaceId, session.userId))?.owner) {
    return json({ error: 'Space owner access required.' }, 403);
  }
  try {
    const input = await readInput(request);
    if (input.storage !== 'private' && input.storage !== 'public') {
      throw new RondoInputError('Choose a Nodo storage type.');
    }
    const now = unixNow();
    let nodeId: string | null;
    let quotaBytes: number;
    let storageKind: number;
    if (input.storage === 'public') {
      const hasPublic = await env.DB.prepare(
        'SELECT 1 AS found FROM rondo_spaces WHERE owner_user_id = ?1 AND public_quota_bytes > 0 LIMIT 1',
      ).bind(session.userId).first<{ found: number }>();
      if (hasPublic) return json({ error: 'Only one free Public Node tier is available per account.' }, 409);
      const node = await selectPublicNodo(env, now);
      if (!node) return json({ error: 'No Public Node storage is currently available.' }, 409);
      nodeId = null;
      quotaBytes = PUBLIC_RONDO_LIMIT_BYTES;
      storageKind = 1;
    } else {
      if (typeof input.nodeId !== 'string' || !NODE_ID.test(input.nodeId)) {
        throw new RondoInputError('Choose one of your private Nodo devices.');
      }
      const node = await env.DB.prepare(
        `SELECT id, private_quota_bytes FROM nodes
          WHERE id = ?1 AND user_id = ?2 AND private_quota_bytes > 0 AND allow_uploads = 1
          LIMIT 1`,
      ).bind(input.nodeId, session.userId).first<{ id: string; private_quota_bytes: number }>();
      if (!node) return json({ error: 'The selected private Nodo is unavailable.' }, 409);
      nodeId = node.id;
      quotaBytes = node.private_quota_bytes;
      storageKind = 0;
    }
    const tierId = crypto.randomUUID();
    const [inserted] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO rondo_space_nodes
          (id, space_id, node_id, storage_kind, position, quota_bytes, used_bytes, created_at)
         SELECT ?1, ?2, ?3, ?4, COALESCE(MAX(position), -1) + 1, ?5, 0, ?6
           FROM rondo_space_nodes WHERE space_id = ?2
         HAVING COUNT(*) < 16
            AND (?4 = 0 OR COALESCE(SUM(CASE WHEN storage_kind = 1 THEN 1 ELSE 0 END), 0) = 0)`,
      ).bind(tierId, spaceId, nodeId, storageKind, quotaBytes, now),
      ...(storageKind === 1
        ? [env.DB.prepare(
            `UPDATE rondo_spaces SET public_quota_bytes = ?1
              WHERE id = ?2 AND EXISTS(
                SELECT 1 FROM rondo_space_nodes WHERE id = ?3 AND space_id = ?2
              )`,
          ).bind(PUBLIC_RONDO_LIMIT_BYTES, spaceId, tierId)]
        : []),
    ]);
    if ((inserted.meta.changes ?? 0) === 0) {
      return json({ error: storageKind === 1
        ? 'Only one free Public Node tier is available per account.'
        : 'A Space can use up to 16 Nodo tiers.' }, 409);
    }
    const tier = (await nodeTiers(env, spaceId, now)).find(({ id }) => id === tierId);
    return json({ node: tier }, 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) return json({ error: 'This Nodo is already assigned to the Space.' }, 409);
    if (error instanceof RondoInputError) return json({ error: error.message }, 400);
    console.error('Rondo Nodo assignment failed.', error);
    return json({ error: 'Nodo could not be added.' }, 503);
  }
}

export async function removeRondoNode(
  request: Request,
  env: Env,
  spaceId: string,
  tierId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(spaceId) || !NODE_ID.test(tierId)) return json({ error: 'Nodo tier not found.' }, 404);
  if (!(await spaceAccess(env, spaceId, session.userId))?.owner) {
    return json({ error: 'Space owner access required.' }, 403);
  }
  const tiers = await env.DB.prepare(
    'SELECT id, storage_kind FROM rondo_space_nodes WHERE space_id = ?1 ORDER BY position ASC',
  ).bind(spaceId).all<{ id: string; storage_kind: number }>();
  if (tiers.results.length <= 1) return json({ error: 'A Space must keep at least one Nodo.' }, 409);
  const removed = tiers.results.find(({ id }) => id === tierId);
  if (!removed) return json({ error: 'Nodo tier not found.' }, 404);
  await env.DB.prepare(
    'DELETE FROM rondo_space_nodes WHERE id = ?1 AND space_id = ?2',
  ).bind(tierId, spaceId).run();
  await normalizeNodeOrder(env, spaceId);
  if (removed.storage_kind === 1) {
    await env.DB.prepare('UPDATE rondo_spaces SET public_quota_bytes = 0 WHERE id = ?1')
      .bind(spaceId).run();
  }
  return json({ ok: true });
}

export async function reorderRondoNodes(
  request: Request,
  env: Env,
  spaceId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(spaceId)) return json({ error: 'Space not found.' }, 404);
  if (!(await spaceAccess(env, spaceId, session.userId))?.owner) {
    return json({ error: 'Space owner access required.' }, 403);
  }
  try {
    const input = await readInput(request);
    if (!Array.isArray(input.tierIds) || input.tierIds.length < 1 || input.tierIds.length > 16 ||
        input.tierIds.some((id) => typeof id !== 'string' || !NODE_ID.test(id)) ||
        new Set(input.tierIds).size !== input.tierIds.length) {
      throw new RondoInputError('Nodo priority is invalid.');
    }
    const existing = await env.DB.prepare(
      'SELECT id FROM rondo_space_nodes WHERE space_id = ?1',
    ).bind(spaceId).all<{ id: string }>();
    const current = new Set(existing.results.map(({ id }) => id));
    if (current.size !== input.tierIds.length || input.tierIds.some((id) => !current.has(id as string))) {
      throw new RondoInputError('Nodo priority must include every assigned Nodo.');
    }
    await setNodeOrder(env, spaceId, input.tierIds as string[]);
    return json({ nodes: await nodeTiers(env, spaceId, unixNow()) });
  } catch (error) {
    return json({ error: error instanceof RondoInputError ? error.message : 'Nodo priority is invalid.' }, 400);
  }
}

async function spaceAccess(env: Env, spaceId: string, userId: ArrayBuffer) {
  const row = await env.DB.prepare(
    `SELECT members.role, spaces.owner_user_id = ?2 AS is_owner
       FROM rondo_members AS members
       JOIN rondo_spaces AS spaces ON spaces.id = members.space_id
      WHERE members.space_id = ?1 AND members.user_id = ?2
      LIMIT 1`,
  ).bind(spaceId, userId).first<{ is_owner: number; role: number }>();
  return row ? { owner: Boolean(row.is_owner || row.role === 1) } : null;
}

async function existingRoomRoute(env: Env, spaceId: string, roomId: string) {
  return env.DB.prepare(
    `SELECT routes.node_id, routes.storage_kind,
            COALESCE((SELECT quota_bytes FROM rondo_space_nodes
              WHERE space_id = routes.space_id
                AND storage_kind = routes.storage_kind
                AND (routes.storage_kind = 1 OR node_id = routes.node_id)
              ORDER BY position ASC LIMIT 1), 0) AS limit_bytes
       FROM rondo_room_routes AS routes
      WHERE routes.space_id = ?1 AND routes.room_id = ?2
      LIMIT 1`,
  ).bind(spaceId, roomId).first<{
    limit_bytes: number;
    node_id: string;
    storage_kind: number;
  }>();
}

async function nodeTiers(env: Env, spaceId: string, now: number) {
  const rows = await env.DB.prepare(
    `SELECT tiers.id, tiers.node_id, tiers.storage_kind, tiers.position,
            tiers.quota_bytes, tiers.used_bytes, nodes.device_name, nodes.last_seen_at
       FROM rondo_space_nodes AS tiers
       LEFT JOIN nodes ON nodes.id = tiers.node_id
      WHERE tiers.space_id = ?1
      ORDER BY tiers.position ASC, tiers.id ASC`,
  ).bind(spaceId).all<{
    device_name: string | null;
    id: string;
    last_seen_at: number | null;
    node_id: string | null;
    position: number;
    quota_bytes: number;
    storage_kind: number;
    used_bytes: number;
  }>();
  const publicOnline = rows.results.some(({ storage_kind }) => storage_kind === 1)
    ? await publicNodoAvailable(env, now)
    : false;
  return rows.results.map((tier) => ({
    deviceName: tier.storage_kind === 1 ? 'Public Node' : tier.device_name,
    id: tier.id,
    kind: tier.storage_kind === 1 ? 'public' : 'private',
    limitBytes: tier.quota_bytes,
    nodeId: tier.node_id,
    online: tier.storage_kind === 1
      ? publicOnline
      : tier.last_seen_at !== null && now - tier.last_seen_at <= ONLINE_SECONDS,
    position: tier.position,
    usedBytes: tier.used_bytes,
  }));
}

async function normalizeNodeOrder(env: Env, spaceId: string): Promise<void> {
  const rows = await env.DB.prepare(
    'SELECT id FROM rondo_space_nodes WHERE space_id = ?1 ORDER BY position ASC, id ASC',
  ).bind(spaceId).all<{ id: string }>();
  await setNodeOrder(env, spaceId, rows.results.map(({ id }) => id));
}

async function setNodeOrder(env: Env, spaceId: string, tierIds: string[]): Promise<void> {
  const firstId = tierIds[0];
  if (!firstId) throw new RondoInputError('A Space must keep at least one Nodo.');
  const first = await env.DB.prepare(
    `SELECT node_id, storage_kind FROM rondo_space_nodes
      WHERE id = ?1 AND space_id = ?2 LIMIT 1`,
  ).bind(firstId, spaceId).first<{ node_id: string | null; storage_kind: number }>();
  if (!first) throw new RondoInputError('Primary Nodo was not found.');
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE rondo_space_nodes SET position = position + 1000 WHERE space_id = ?1',
    ).bind(spaceId),
    ...tierIds.map((id, position) => env.DB.prepare(
      'UPDATE rondo_space_nodes SET position = ?1 WHERE id = ?2 AND space_id = ?3',
    ).bind(position, id, spaceId)),
    env.DB.prepare(
      `UPDATE rondo_spaces
          SET primary_node_id = ?1,
              primary_node_space = ?2,
              quota_bytes = (SELECT COALESCE(SUM(quota_bytes), 0)
                FROM rondo_space_nodes WHERE space_id = ?3),
              used_bytes = (SELECT COALESCE(SUM(used_bytes), 0)
                FROM rondo_space_nodes WHERE space_id = ?3)
        WHERE id = ?3`,
    ).bind(first.node_id, first.storage_kind, spaceId),
  ]);
}

function roomName(value: unknown): string {
  const name = requiredText(value, 1, 48, 'Room name must be 1–48 characters.')
    .toLowerCase()
    .replace(/\s+/gu, '-');
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,47}$/u.test(name)) {
    throw new RondoInputError('Use letters, numbers, dots, dashes or underscores for a room name.');
  }
  return name;
}

async function spacesForUser(
  env: Env,
  userId: ArrayBuffer,
  now: number,
  spaceId?: string,
) {
  const rows = await env.DB.prepare(
    `SELECT spaces.id, spaces.name, spaces.description, spaces.owner_user_id AS owner_id,
            owner.display_username AS owner_username, spaces.primary_node_id,
            spaces.primary_node_space,
            COALESCE((SELECT SUM(quota_bytes) FROM rondo_space_nodes
              WHERE space_id = spaces.id), spaces.quota_bytes) AS quota_bytes,
            COALESCE((SELECT SUM(used_bytes) FROM rondo_space_nodes
              WHERE space_id = spaces.id), spaces.used_bytes) AS used_bytes,
            spaces.created_at, members.role, nodes.device_name, nodes.last_seen_at,
            (SELECT COUNT(*) FROM rondo_members AS count_members
              WHERE count_members.space_id = spaces.id) AS member_count
       FROM rondo_members AS members
       JOIN rondo_spaces AS spaces ON spaces.id = members.space_id
       JOIN users AS owner ON owner.id = spaces.owner_user_id
       LEFT JOIN nodes ON nodes.id = spaces.primary_node_id
      WHERE members.user_id = ?1 AND (?2 IS NULL OR spaces.id = ?2)
      ORDER BY members.joined_at DESC, spaces.id ASC`,
  ).bind(userId, spaceId ?? null).all<SpaceRow>();
  const publicOnline = rows.results.some(({ primary_node_space }) => primary_node_space === 1)
    ? await publicNodoAvailable(env, now)
    : false;
  return rows.results.map((row) => ({
    createdAt: row.created_at,
    description: row.description,
    id: row.id,
    memberCount: row.member_count,
    name: row.name,
    owner: { id: base64Url(row.owner_id), username: row.owner_username },
    role: row.role === 1 ? 'owner' : 'member',
    storage: {
      deviceName: row.primary_node_space === 1 ? 'Public Node' : row.device_name,
      kind: row.primary_node_space === 1 ? 'public' : 'private',
      limitBytes: row.quota_bytes,
      nodeId: row.primary_node_id,
      online: row.primary_node_space === 1
        ? publicOnline
        : row.last_seen_at !== null && now - row.last_seen_at <= ONLINE_SECONDS,
      usedBytes: row.used_bytes,
    },
  }));
}

async function publicNodoAvailable(env: Env, now: number): Promise<boolean> {
  return Boolean(await selectPublicNodo(env, now));
}

async function selectPublicNodo(env: Env, now: number): Promise<{ id: string } | null> {
  return env.DB.prepare(
    `SELECT nodes.id
       FROM nodes
      WHERE nodes.last_seen_at >= ?1
        AND nodes.allow_uploads = 1
        AND nodes.public_quota_bytes > 0
        AND NOT EXISTS (
          SELECT 1 FROM fluo_public_tombstones AS tombstones
           WHERE tombstones.node_id = nodes.id
        )
        AND nodes.public_quota_bytes - nodes.public_used_bytes
          - COALESCE((
              SELECT SUM(bytes) FROM fluo_public_allocations
               WHERE node_id = nodes.id AND committed = 0 AND expires_at > ?2
            ), 0) > 0
      ORDER BY nodes.last_seen_at DESC, nodes.id ASC
      LIMIT 1`,
  ).bind(now - ONLINE_SECONDS, now).first<{ id: string }>();
}

async function readInput(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_REQUEST_BYTES) throw new RondoInputError('Request is too large.');
  const text = await request.text();
  if (utf8(text).byteLength > MAX_REQUEST_BYTES) throw new RondoInputError('Request is too large.');
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RondoInputError('A JSON object is required.');
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, min: number, max: number, message: string): string {
  if (typeof value !== 'string') throw new RondoInputError(message);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new RondoInputError(message);
  return trimmed;
}

function optionalText(value: unknown, max: number, message: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new RondoInputError(message);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new RondoInputError(message);
  return trimmed;
}

function randomInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (byte) => INVITE_ALPHABET[byte % INVITE_ALPHABET.length]).join('');
}

function normalizeInviteCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase().replace(/^RND-/u, '').replaceAll('-', '');
  return INVITE_CODE.test(normalized) ? normalized : null;
}

function displayInviteCode(value: string): string {
  return `RND-${value.slice(0, 5)}-${value.slice(5)}`;
}

async function inviteHash(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(value)));
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

class RondoInputError extends Error {}
