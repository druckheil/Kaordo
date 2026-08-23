import type { Env } from '../env';
import { authenticate, unixNow } from '../auth/session';
import { json } from '../http/json';
import {
  PUBLIC_NODE_RETIRE_SECONDS,
  retireNodePublicPosts,
} from '../fluo/public-storage';
import { acknowledgeCloudCleanup } from '../ligo/routes';
import {
  acknowledgeAdminEraseJobs,
  pendingAdminEraseJobs,
} from '../admin/moderation';

const MAX_REQUEST_BYTES = 16_384;
const NODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ONLINE_SECONDS = 300;
const ACCESS_TICKET_SECONDS = 2 * 60 * 60;
const ACCESS_TICKET = /^[A-Za-z0-9_-]{43}$/u;
const DEVICE_KEY = /^[0-9a-f]{64}$/u;
const SLOT_KEY = /^[a-z0-9][a-z0-9_-]{0,31}$/u;
const MAX_RECONCILIATION_IDS = 64;

type NodeRow = {
  allow_downloads: number;
  allow_uploads: number;
  android_sdk: number | null;
  app_version: string | null;
  battery_percent: number | null;
  charging: number | null;
  charging_only: number;
  coordinator_latency_ms: number | null;
  created_at: number;
  device_name: string;
  disk_read_bps: number | null;
  disk_write_bps: number | null;
  device_key: string | null;
  id: string;
  last_seen_at: number;
  local_addresses: string;
  memory_available_bytes: number | null;
  memory_total_bytes: number | null;
  network_metered: number | null;
  network_down_bps: number | null;
  network_type: string | null;
  network_up_bps: number | null;
  observed_address: string | null;
  port: number;
  private_quota_bytes: number;
  private_used_bytes: number;
  protocol: string;
  public_quota_bytes: number;
  public_used_bytes: number;
  quota_bytes: number;
  storage_available_bytes: number | null;
  slot_key: string;
  test_completed_at: number | null;
  test_requested_at: number | null;
  used_bytes: number;
  wifi_only: number;
};

const NODE_COLUMNS = `id, device_name, protocol, port, quota_bytes, used_bytes,
  public_quota_bytes, private_quota_bytes, public_used_bytes, private_used_bytes,
  local_addresses, observed_address, created_at, last_seen_at, app_version,
  android_sdk, battery_percent, charging, memory_available_bytes,
  memory_total_bytes, storage_available_bytes, disk_read_bps, disk_write_bps,
  coordinator_latency_ms, network_type, network_metered, network_down_bps,
  network_up_bps, test_requested_at,
  test_completed_at, allow_downloads, allow_uploads, charging_only, wifi_only,
  device_key, slot_key`;

export async function nodeHeartbeat(request: Request, env: Env): Promise<Response> {
  // A suspended account may still heartbeat long enough for an
  // administrative erasure job to remove its local Nodo payloads. This is
  // the only endpoint that accepts that infrastructure call.
  const session = await authenticate(request, env, unixNow(), true);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await readHeartbeat(request);
    const now = unixNow();
    const previous = await resolveHeartbeatNode(env, session.userId, input);
    const nodeId = previous?.id ?? input.nodeId ?? crypto.randomUUID();
    if (previous && now - previous.last_seen_at >= PUBLIC_NODE_RETIRE_SECONDS) {
      await retireNodePublicPosts(env, nodeId, now);
    }
    const observedAddress = clientAddress(request);
    const result = await env.DB.prepare(
      `INSERT INTO nodes (
         id, user_id, device_name, protocol, port, quota_bytes, used_bytes,
         local_addresses, observed_address, created_at, last_seen_at,
         app_version, android_sdk, battery_percent, charging,
         memory_available_bytes, memory_total_bytes, storage_available_bytes,
         disk_read_bps, disk_write_bps, coordinator_latency_ms, network_type,
         network_metered, network_down_bps, network_up_bps, test_completed_at,
         device_key, slot_key, public_quota_bytes, private_quota_bytes,
         public_used_bytes, private_used_bytes
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10,
         ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25,
         ?26, ?27, 0, ?6, ?28, ?29
       )
       ON CONFLICT(id) DO UPDATE SET
         device_name = nodes.device_name,
         protocol = excluded.protocol,
         port = excluded.port,
         quota_bytes = excluded.quota_bytes,
         used_bytes = excluded.used_bytes,
         public_quota_bytes = MAX(
           excluded.public_used_bytes,
           MIN(nodes.public_quota_bytes, excluded.quota_bytes - excluded.private_used_bytes)
         ),
         private_quota_bytes = excluded.quota_bytes - MAX(
           excluded.public_used_bytes,
           MIN(nodes.public_quota_bytes, excluded.quota_bytes - excluded.private_used_bytes)
         ),
         public_used_bytes = excluded.public_used_bytes,
         private_used_bytes = excluded.private_used_bytes,
         local_addresses = excluded.local_addresses,
         observed_address = COALESCE(excluded.observed_address, nodes.observed_address),
         last_seen_at = excluded.last_seen_at,
         -- A metrics object is a complete snapshot. When it is present,
         -- nullable values are allowed to clear a capability that no longer
         -- exists (for example battery data on Linux). When it is omitted,
         -- preserve the last known telemetry for lightweight heartbeats.
         app_version = CASE WHEN ?30 = 1 THEN excluded.app_version ELSE nodes.app_version END,
         android_sdk = CASE WHEN ?30 = 1 THEN excluded.android_sdk ELSE nodes.android_sdk END,
         battery_percent = CASE WHEN ?30 = 1 THEN excluded.battery_percent ELSE nodes.battery_percent END,
         charging = CASE WHEN ?30 = 1 THEN excluded.charging ELSE nodes.charging END,
         memory_available_bytes = CASE WHEN ?30 = 1 THEN excluded.memory_available_bytes ELSE nodes.memory_available_bytes END,
         memory_total_bytes = CASE WHEN ?30 = 1 THEN excluded.memory_total_bytes ELSE nodes.memory_total_bytes END,
         storage_available_bytes = CASE WHEN ?30 = 1 THEN excluded.storage_available_bytes ELSE nodes.storage_available_bytes END,
         disk_read_bps = CASE WHEN ?30 = 1 THEN excluded.disk_read_bps ELSE nodes.disk_read_bps END,
         disk_write_bps = CASE WHEN ?30 = 1 THEN excluded.disk_write_bps ELSE nodes.disk_write_bps END,
         coordinator_latency_ms = CASE WHEN ?30 = 1 THEN excluded.coordinator_latency_ms ELSE nodes.coordinator_latency_ms END,
         network_type = CASE WHEN ?30 = 1 THEN excluded.network_type ELSE nodes.network_type END,
         network_metered = CASE WHEN ?30 = 1 THEN excluded.network_metered ELSE nodes.network_metered END,
         network_down_bps = CASE WHEN ?30 = 1 THEN excluded.network_down_bps ELSE nodes.network_down_bps END,
         network_up_bps = CASE WHEN ?30 = 1 THEN excluded.network_up_bps ELSE nodes.network_up_bps END,
         test_completed_at = COALESCE(excluded.test_completed_at, nodes.test_completed_at),
         device_key = COALESCE(nodes.device_key, excluded.device_key),
         slot_key = CASE
           WHEN nodes.device_key IS NULL AND excluded.device_key IS NOT NULL THEN excluded.slot_key
           ELSE nodes.slot_key
         END
       WHERE nodes.user_id = excluded.user_id`,
    ).bind(
      nodeId,
      session.userId,
      input.deviceName,
      input.protocol,
      input.port,
      input.quotaBytes,
      input.usedBytes,
      JSON.stringify(input.localAddresses),
      observedAddress,
      now,
      input.metrics?.appVersion ?? null,
      input.metrics?.androidSdk ?? null,
      input.metrics?.batteryPercent ?? null,
      booleanInteger(input.metrics?.charging),
      input.metrics?.memoryAvailableBytes ?? null,
      input.metrics?.memoryTotalBytes ?? null,
      input.metrics?.storageAvailableBytes ?? null,
      input.metrics?.diskReadBps ?? null,
      input.metrics?.diskWriteBps ?? null,
      input.metrics?.coordinatorLatencyMs ?? null,
      input.metrics?.networkType ?? null,
      booleanInteger(input.metrics?.networkMetered),
      input.metrics?.networkDownBps ?? null,
      input.metrics?.networkUpBps ?? null,
      input.testCompletedAt ?? null,
      input.deviceKey,
      input.slotKey,
      input.spaces.publicUsedBytes,
      input.spaces.privateUsedBytes,
      Number(input.metrics !== null),
    ).run();
    if ((result.meta.changes ?? 0) === 0) return json({ error: 'Node not found.' }, 404);
    // Keep a snapshot for the response: the final erase acknowledgement may
    // delete this user's account (and its node row) before this heartbeat
    // returns to the host.
    const row = await ownedNode(env, nodeId, session.userId);
    if (!row) return json({ error: 'Node not found.' }, 404);
    await applyPublicReconciliationAcks(
      env,
      nodeId,
      input.deletedPublicPostIds,
      input.releasedPublicReservationIds,
    );
    await acknowledgeCloudCleanup(env, input.deletedLigoMessageIds, nodeId);
    await acknowledgeAdminEraseJobs(env, nodeId, input.completedEraseJobIds);
    const tombstones = await env.DB.prepare(
      `SELECT post_id FROM fluo_public_tombstones
        WHERE node_id = ?1 ORDER BY created_at ASC, post_id ASC LIMIT ?2`,
    ).bind(nodeId, MAX_RECONCILIATION_IDS).all<{ post_id: string }>();
    const ligoTombstones = await env.DB.prepare(
      `SELECT message_id, storage_kind FROM ligo_cloud_tombstones
        WHERE node_id = ?1 ORDER BY created_at ASC, message_id ASC LIMIT ?2`,
    ).bind(nodeId, MAX_RECONCILIATION_IDS).all<{
      message_id: string;
      storage_kind: number;
    }>();
    const eraseJobs = await pendingAdminEraseJobs(env, nodeId);
    return json({
      heartbeatAfterSeconds: 120,
      deviceName: row.device_name,
      nodeId,
      observedAddress,
      policy: policy(row),
      ligoDeleteMessages: ligoTombstones.results.map((item) => ({
        id: item.message_id,
        storage: item.storage_kind === 1 ? 'public' : 'private',
      })),
      publicDeletePostIds: tombstones.results.map(({ post_id }) => post_id),
      eraseUserJobs: eraseJobs,
      spaces: spaces(row),
      runQuickTest: (row.test_requested_at ?? 0) > (row.test_completed_at ?? 0),
    });
  } catch (error) {
    return json({ error: error instanceof NodeInputError ? error.message : 'Node heartbeat is invalid.' }, 400);
  }
}

export async function listNodes(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  return json({ nodes: await nodesForUser(env, session.userId, unixNow()) });
}

export async function nodesForUser(env: Env, userId: ArrayBuffer, now: number) {
  const rows = await env.DB.prepare(
    `SELECT ${NODE_COLUMNS} FROM nodes WHERE user_id = ?1 ORDER BY last_seen_at DESC`,
  ).bind(userId).all<NodeRow>();
  return rows.results.map((row) => publicNode(row, now));
}

export async function listFluoNodeIds(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  return json({ nodeIds: await fluoNodeIds(env, unixNow()) });
}

export async function fluoNodeIds(env: Env, now: number): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT id FROM nodes
      WHERE last_seen_at >= ?1 AND allow_downloads = 1
        AND NOT EXISTS (
          SELECT 1 FROM fluo_public_tombstones
           WHERE fluo_public_tombstones.node_id = nodes.id
        )
      ORDER BY last_seen_at DESC, id ASC`,
  ).bind(now - ONLINE_SECONDS).all<{ id: string }>();
  return rows.results.map(({ id }) => id);
}

export async function nodeRoute(request: Request, env: Env, nodeId: string): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(nodeId)) return json({ error: 'Node not found.' }, 404);
  const row = await ownedNode(env, nodeId, session.userId);
  if (!row) return json({ error: 'Node not found.' }, 404);
  const local = parseAddresses(row.local_addresses);
  const candidates = [
    ...local.map((address) => ({ address, kind: 'lan' as const, port: row.port })),
    ...(row.observed_address
      ? [{ address: row.observed_address, kind: 'public' as const, port: row.port }]
      : []),
    relayCandidate(request, nodeId),
  ];
  return json({
    candidates,
    node: publicNode(row, unixNow()),
    strategy: ['lan', 'public', 'relay'],
  });
}

export async function issueNodeAccess(
  request: Request,
  env: Env,
  nodeId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(nodeId)) return json({ error: 'Node not found.' }, 404);
  const row = await env.DB.prepare(
    `SELECT ${NODE_COLUMNS}, nodes.user_id = ?1 AS is_owner,
            EXISTS(
              SELECT 1 FROM fluo_public_tombstones
               WHERE fluo_public_tombstones.node_id = nodes.id
            ) AS pending
       FROM nodes WHERE nodes.id = ?2 LIMIT 1`,
  ).bind(session.userId, nodeId).first<NodeRow & { is_owner: number; pending: number }>();
  if (!row) return json({ error: 'Node not found.' }, 404);
  const now = unixNow();
  if (now - row.last_seen_at > ONLINE_SECONDS) {
    return json({ error: 'The selected node is offline.' }, 409);
  }
  if (row.pending && !row.is_owner) {
    return json({ error: 'Nodo is reconciling its public storage.' }, 409);
  }
  const ticket = randomTicket();
  const expiresAt = now + ACCESS_TICKET_SECONDS;
  await env.DB.prepare(
    `INSERT INTO node_access_tickets
      (token_hash, node_id, user_id, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).bind(await tokenHash(ticket), nodeId, session.userId, now, expiresAt).run();
  const local = parseAddresses(row.local_addresses);
  return json({
    candidates: [
      ...local.map((address) => ({ address, kind: 'lan' as const, port: row.port })),
      ...(row.observed_address
        ? [{ address: row.observed_address, kind: 'public' as const, port: row.port }]
        : []),
      relayCandidate(request, nodeId),
    ],
    expiresAt,
    node: publicNode(row, now),
    ticket,
  });
}

/**
 * HTTPS fallback for clients that cannot reach a Nodo's direct address.
 *
 * The relay is deliberately a capability endpoint: the short-lived Nodo
 * access ticket is forwarded to the host, which performs the authoritative
 * reservation/space permission check through /api/nodes/tickets/verify. The
 * Worker only selects the current observed address and streams the request;
 * it never stores payload bytes in D1. Small JSON control requests are
 * buffered only long enough to give the Nodo parser an explicit length.
 */
export async function relayNodeRequest(
  request: Request,
  env: Env,
  nodeId: string,
  relayPath: string,
): Promise<Response> {
  if (!NODE_ID.test(nodeId) || !isRelayPath(relayPath)) {
    return relayJson(request, { error: 'Nodo route is invalid.' }, 404);
  }
  if (request.method === 'OPTIONS') return relayOptions(request);
  const incoming = new URL(request.url);
  const queryTicket = incoming.searchParams.get('access_token');
  const authorization = request.headers.get('authorization') ??
    (queryTicket ? `Bearer ${queryTicket}` : '');
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/u);
  if (!match) return relayJson(request, { error: 'Authentication required.' }, 401);

  const now = unixNow();
  const row = await env.DB.prepare(
    `SELECT nodes.last_seen_at, nodes.observed_address, nodes.port
       FROM node_access_tickets AS tickets
       JOIN nodes ON nodes.id = tickets.node_id
      WHERE tickets.token_hash = ?1
        AND tickets.node_id = ?2
        AND tickets.expires_at > ?3
      LIMIT 1`,
  ).bind(await tokenHash(match[1]), nodeId, now).first<{
    last_seen_at: number;
    observed_address: string | null;
    port: number;
  }>();
  if (!row) return relayJson(request, { error: 'Node access ticket is invalid or expired.' }, 401);
  if (now - row.last_seen_at > ONLINE_SECONDS) {
    return relayJson(request, { error: 'The selected node is offline.' }, 409);
  }
  if (!row.observed_address) {
    return relayJson(request, { error: 'The selected node has no public route.' }, 409);
  }

  // Cloudflare Workers reject outbound requests to a bare IP literal. The
  // DNS-only sslip.io name resolves back to the observed IPv6 address and
  // lets the relay keep the node's existing HTTP/TUS protocol unchanged.
  const host = relayHost(row.observed_address);
  // Keep the capability token out of the upstream URL; it is forwarded in
  // the Authorization header so it is never logged by an origin proxy.
  incoming.searchParams.delete('access_token');
  const query = incoming.searchParams.toString();
  const target = `http://${host}:${row.port}${relayPath}${query ? `?${query}` : ''}`;
  const headers = new Headers(request.headers);
  headers.set('authorization', authorization);
  // Hop-by-hop and client-routing headers must be regenerated by fetch.
  for (const name of ['connection', 'content-length', 'cookie', 'host', 'keep-alive', 'proxy-authenticate',
    'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']) {
    headers.delete(name);
  }
  let body: BodyInit | undefined;
  try {
    body = await relayBody(request);
  } catch (error) {
    if (error instanceof RelayBodyTooLargeError) {
      return relayJson(request, { error: 'Nodo control request is too large.' }, 413);
    }
    return relayJson(request, { error: 'Nodo request body could not be read.' }, 400);
  }
  try {
    const upstream = await fetch(target, {
      body,
      headers,
      method: request.method,
      redirect: 'manual',
      signal: request.signal,
    });
    const responseHeaders = new Headers(upstream.headers);
    for (const name of ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
      'te', 'trailer', 'transfer-encoding', 'upgrade']) {
      responseHeaders.delete(name);
    }
    addRelayCors(responseHeaders, request);
    responseHeaders.set('x-kaordo-node-relay', '1');
    return new Response(upstream.body, {
      headers: responseHeaders,
      status: upstream.status,
      statusText: upstream.statusText,
    });
  } catch {
    return relayJson(request, { error: 'The Nodo relay could not reach the host.' }, 502);
  }
}

/**
 * A plain ReadableStream makes Workers send chunked transfer encoding. Nodo's
 * deliberately small HTTP parser uses Content-Length (or the TUS chunk
 * header) and does not implement a chunk decoder, so preserve a known body
 * length with the Workers FixedLengthStream while still streaming every byte.
 */
const MAX_RELAY_CONTROL_BODY_BYTES = 512 * 1024;

class RelayBodyTooLargeError extends Error {}

async function relayBody(request: Request): Promise<BodyInit | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD' || !request.body) return undefined;
  const length = relayBodyLength(request);
  if (length === null) {
    const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    // Browsers do not expose Content-Length for fetch requests. Buffer only
    // the small JSON control envelope; media/TUS bodies always carry an
    // explicit length or Kaordo chunk-length header and stay streaming.
    if (contentType === 'application/json') return readRelayControlBody(request);
    return request.body;
  }
  const fixed = new FixedLengthStream(length);
  void request.body.pipeTo(fixed.writable, { signal: request.signal }).catch((error) => {
    void fixed.writable.abort(error);
  });
  return fixed.readable;
}

async function readRelayControlBody(request: Request): Promise<Blob> {
  if (!request.body) return new Blob();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RELAY_CONTROL_BODY_BYTES) {
        await reader.cancel();
        throw new RelayBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([body]);
}

function relayBodyLength(request: Request): number | null {
  const value = request.headers.get('x-kaordo-chunk-length') ??
    request.headers.get('x-veridimensio-chunk-length') ??
    request.headers.get('content-length');
  if (value === null || !/^\d+$/u.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

function relayCandidate(request: Request, nodeId: string) {
  const origin = new URL(`/api/nodes/${nodeId}/relay`, request.url).toString().replace(/\/$/u, '');
  return { address: 'relay', kind: 'relay' as const, origin, port: 443 };
}

function relayHost(address: string): string {
  return address.includes(':')
    ? `${address.replaceAll(':', '-')}.sslip.io`
    : `${address.replaceAll('.', '-')}.sslip.io`;
}

function isRelayPath(path: string): boolean {
  return path.length <= 512 && !path.includes('..') && !/%(?:2e|2f|5c|00)/iu.test(path) &&
    !/[\u0000-\u001f\u007f]/u.test(path) &&
    (path.startsWith('/v1/') || path === '/files' || path.startsWith('/files/'));
}

function relayOptions(request: Request): Response {
  const headers = new Headers({
    'access-control-allow-headers': request.headers.get('access-control-request-headers') ??
      'authorization,content-type,tus-resumable,upload-length,upload-offset,upload-metadata,range',
    'access-control-allow-methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS',
    'access-control-max-age': '600',
  });
  addRelayCors(headers, request);
  return new Response(null, { headers, status: 204 });
}

function relayJson(request: Request, body: unknown, status: number): Response {
  const response = json(body, status);
  const headers = new Headers(response.headers);
  addRelayCors(headers, request);
  return new Response(response.body, { headers, status: response.status });
}

function addRelayCors(headers: Headers, request: Request): void {
  const origin = request.headers.get('origin');
  headers.set('access-control-allow-origin', origin && origin !== 'null' ? origin : '*');
  headers.set('access-control-allow-private-network', 'true');
  headers.set('access-control-expose-headers', 'Location,Tus-Resumable,Tus-Version,Tus-Extension,Tus-Max-Size,Upload-Length,Upload-Offset,Upload-Metadata,Accept-Ranges,Content-Length,Content-Range,ETag');
  headers.append('vary', 'Origin');
}

export async function deleteExpiredNodeAccessTickets(env: Env, now: number): Promise<void> {
  await env.DB.prepare('DELETE FROM node_access_tickets WHERE expires_at <= ?1').bind(now).run();
}

export async function verifyNodeAccess(request: Request, env: Env): Promise<Response> {
  try {
    const input = await readJson(request);
    if (typeof input.nodeId !== 'string' || !NODE_ID.test(input.nodeId) ||
        typeof input.ticket !== 'string' || !ACCESS_TICKET.test(input.ticket) ||
        (input.reservationId !== undefined && input.reservationId !== null &&
          (typeof input.reservationId !== 'string' || !NODE_ID.test(input.reservationId))) ||
        (input.rondoSpaceId !== undefined &&
          (typeof input.rondoSpaceId !== 'string' || !NODE_ID.test(input.rondoSpaceId))) ||
        (input.rondoRoomId !== undefined &&
          (typeof input.rondoRoomId !== 'string' || !NODE_ID.test(input.rondoRoomId))) ||
        ((input.rondoSpaceId === undefined) !== (input.rondoRoomId === undefined))) {
      throw new NodeInputError('Node ticket is invalid.');
    }
    const reservationId = typeof input.reservationId === 'string' ? input.reservationId : null;
    const rondoSpaceId = typeof input.rondoSpaceId === 'string' ? input.rondoSpaceId : null;
    const rondoRoomId = typeof input.rondoRoomId === 'string' ? input.rondoRoomId : null;
    const now = unixNow();
    const row = await env.DB.prepare(
      `SELECT tickets.expires_at,
              tickets.user_id = nodes.user_id AS is_owner,
              users.username,
              allocations.id AS reservation_id,
              allocations.bytes AS reservation_bytes,
              profile_allocations.id AS profile_reservation_id,
              profile_allocations.bytes AS profile_reservation_bytes
              ,members.role AS rondo_role,
              routes.storage_kind AS rondo_storage_kind,
              COALESCE((SELECT quota_bytes FROM rondo_space_nodes
                WHERE space_id = routes.space_id
                  AND storage_kind = routes.storage_kind
                  AND (routes.storage_kind = 1 OR node_id = routes.node_id)
                ORDER BY position ASC LIMIT 1), 0) AS rondo_limit_bytes
        FROM node_access_tickets AS tickets
        JOIN nodes ON nodes.id = tickets.node_id
        JOIN users ON users.id = tickets.user_id
        LEFT JOIN fluo_public_allocations AS allocations
          ON allocations.id = ?4
         AND allocations.node_id = tickets.node_id
         AND allocations.user_id = tickets.user_id
         AND allocations.committed = 0
         AND allocations.expires_at > ?3
        LEFT JOIN profile_public_allocations AS profile_allocations
          ON profile_allocations.id = ?4
         AND profile_allocations.node_id = tickets.node_id
         AND profile_allocations.user_id = tickets.user_id
         AND profile_allocations.committed = 0
         AND profile_allocations.expires_at > ?3
        LEFT JOIN rondo_room_routes AS routes
          ON routes.space_id = ?5
         AND routes.room_id = ?6
         AND routes.node_id = tickets.node_id
        LEFT JOIN rondo_members AS members
          ON members.space_id = routes.space_id
         AND members.user_id = tickets.user_id
        WHERE tickets.token_hash = ?1 AND tickets.node_id = ?2 AND tickets.expires_at > ?3
        LIMIT 1`,
    ).bind(
      await tokenHash(input.ticket), input.nodeId, now, reservationId, rondoSpaceId, rondoRoomId,
    ).first<{
      expires_at: number;
      is_owner: number;
      profile_reservation_bytes: number | null;
      profile_reservation_id: string | null;
      reservation_bytes: number | null;
      reservation_id: string | null;
      rondo_limit_bytes: number | null;
      rondo_role: number | null;
      rondo_storage_kind: number | null;
      username: string;
    }>();
    if (!row || (reservationId !== null && row.reservation_id === null && row.profile_reservation_id === null) ||
        (rondoSpaceId !== null && row.rondo_role === null)) {
      return json({ authorized: false }, 401);
    }
    return json({
      authorized: true,
      expiresAt: row.expires_at,
      isOwner: Boolean(row.is_owner),
      publicReservation: row.reservation_id === null && row.profile_reservation_id === null ? null : {
        bytes: row.reservation_bytes ?? row.profile_reservation_bytes,
        id: row.reservation_id ?? row.profile_reservation_id,
      },
      rondo: row.rondo_role === null ? null : {
        limitBytes: row.rondo_limit_bytes,
        owner: row.rondo_role === 1,
        roomId: rondoRoomId,
        spaceId: rondoSpaceId,
        storage: row.rondo_storage_kind === 1 ? 'public' : 'private',
      },
      username: row.username,
    });
  } catch {
    return json({ authorized: false }, 401);
  }
}

export async function updateNodePolicy(
  request: Request,
  env: Env,
  nodeId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(nodeId)) return json({ error: 'Node not found.' }, 404);
  try {
    const input = await readJson(request);
    const keys = ['allowDownloads', 'allowUploads', 'chargingOnly', 'wifiOnly'] as const;
    if (keys.some((key) => typeof input[key] !== 'boolean')) {
      throw new NodeInputError('Node policy is invalid.');
    }
    const result = await env.DB.prepare(
      `UPDATE nodes SET allow_downloads = ?1, allow_uploads = ?2,
                        charging_only = ?3, wifi_only = ?4
        WHERE id = ?5 AND user_id = ?6`,
    ).bind(
      Number(input.allowDownloads),
      Number(input.allowUploads),
      Number(input.chargingOnly),
      Number(input.wifiOnly),
      nodeId,
      session.userId,
    ).run();
    if ((result.meta.changes ?? 0) === 0) return json({ error: 'Node not found.' }, 404);
    return json({ policy: {
      allowDownloads: input.allowDownloads,
      allowUploads: input.allowUploads,
      chargingOnly: input.chargingOnly,
      ownerOnly: true,
      wifiOnly: input.wifiOnly,
    } });
  } catch (error) {
    return json({ error: error instanceof NodeInputError ? error.message : 'Node policy is invalid.' }, 400);
  }
}

export async function renameNode(
  request: Request,
  env: Env,
  nodeId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(nodeId)) return json({ error: 'Node not found.' }, 404);
  try {
    const input = await readJson(request);
    if (typeof input.name !== 'string') throw new NodeInputError('Nodo name is invalid.');
    const name = input.name.trim();
    if (!name || name.length > 80 || new TextEncoder().encode(name).byteLength > 160) {
      throw new NodeInputError('Nodo name must be between 1 and 80 characters.');
    }
    const result = await env.DB.prepare(
      'UPDATE nodes SET device_name = ?1 WHERE id = ?2 AND user_id = ?3',
    ).bind(name, nodeId, session.userId).run();
    if ((result.meta.changes ?? 0) === 0) return json({ error: 'Node not found.' }, 404);
    return json({ deviceName: name });
  } catch (error) {
    return json({
      error: error instanceof NodeInputError ? error.message : 'Nodo name is invalid.',
    }, 400);
  }
}

export async function updateNodeSpaces(
  request: Request,
  env: Env,
  nodeId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(nodeId)) return json({ error: 'Node not found.' }, 404);
  try {
    const input = await readJson(request);
    if (!safeBytes(input.publicQuotaBytes, true) || !safeBytes(input.privateQuotaBytes, true)) {
      throw new NodeInputError('Nodo space allocation is invalid.');
    }
    const row = await ownedNode(env, nodeId, session.userId);
    if (!row) return json({ error: 'Node not found.' }, 404);
    if (!supportsSpaces(row.app_version)) {
      return json({ error: 'Install Nodo 0.1.0 or newer before changing its space allocation.' }, 409);
    }
    const publicQuotaBytes = input.publicQuotaBytes as number;
    const privateQuotaBytes = input.privateQuotaBytes as number;
    if (publicQuotaBytes + privateQuotaBytes !== row.quota_bytes) {
      throw new NodeInputError('Public and private allocation must equal the Nodo quota.');
    }
    if (publicQuotaBytes < row.public_used_bytes || privateQuotaBytes < row.private_used_bytes) {
      return json({ error: 'A space cannot be smaller than the data already stored in it.' }, 409);
    }
    const reserved = await env.DB.prepare(
      `SELECT COALESCE((SELECT SUM(bytes) FROM fluo_public_allocations
          WHERE node_id = ?1 AND committed = 0 AND expires_at > ?2), 0) AS bytes`,
    ).bind(nodeId, unixNow()).first<{ bytes: number }>();
    if (publicQuotaBytes < row.public_used_bytes + (reserved?.bytes ?? 0)) {
      return json({ error: 'Public allocation cannot be smaller than its active reservations.' }, 409);
    }
    await env.DB.prepare(
      `UPDATE nodes SET public_quota_bytes = ?1, private_quota_bytes = ?2
        WHERE id = ?3 AND user_id = ?4`,
    ).bind(publicQuotaBytes, privateQuotaBytes, nodeId, session.userId).run();
    return json({ spaces: spaces({
      ...row,
      public_quota_bytes: publicQuotaBytes,
      private_quota_bytes: privateQuotaBytes,
    }) });
  } catch (error) {
    return json({
      error: error instanceof NodeInputError ? error.message : 'Nodo space allocation is invalid.',
    }, 400);
  }
}

export async function nodeQuickTest(
  request: Request,
  env: Env,
  nodeId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(nodeId)) return json({ error: 'Node not found.' }, 404);
  const now = unixNow();
  const result = await env.DB.prepare(
    'UPDATE nodes SET test_requested_at = ?1 WHERE id = ?2 AND user_id = ?3',
  ).bind(now, nodeId, session.userId).run();
  if ((result.meta.changes ?? 0) === 0) return json({ error: 'Node not found.' }, 404);
  return json({ requestedAt: now });
}

/**
 * Stores the result of the synchronous client-to-Nodo benchmark. New clients
 * use this path instead of also queueing a second heartbeat-driven test.
 * Keeping requested/completed timestamps equal makes the persisted state
 * immediately final and prevents a later node-list refresh from resurrecting
 * a stale `running` indicator.
 */
export async function completeNodeQuickTest(
  request: Request,
  env: Env,
  nodeId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(nodeId)) return json({ error: 'Node not found.' }, 404);
  try {
    const input = await readJson(request);
    if (!safeBytes(input.diskReadBps, false) || !safeBytes(input.diskWriteBps, false)) {
      throw new NodeInputError('Nodo test result is invalid.');
    }
    const diskReadBps = input.diskReadBps as number;
    const diskWriteBps = input.diskWriteBps as number;
    const now = unixNow();
    const telemetryKeys = [
      'batteryPercent', 'charging', 'coordinatorLatencyMs', 'memoryAvailableBytes',
      'memoryTotalBytes', 'networkMetered', 'networkDownBps', 'networkType',
      'networkUpBps', 'storageAvailableBytes',
    ] as const;
    const isFreshTelemetry = telemetryKeys.every((key) => key in input);
    if (isFreshTelemetry) {
      const metrics = readMetrics(input);
      if (metrics.coordinatorLatencyMs === null || metrics.memoryAvailableBytes === null ||
          metrics.memoryTotalBytes === null || metrics.networkType === null ||
          metrics.storageAvailableBytes === null) {
        throw new NodeInputError('Nodo test result is incomplete.');
      }
      const result = await env.DB.prepare(
        `UPDATE nodes
            SET test_requested_at = ?1,
                test_completed_at = ?1,
                disk_read_bps = ?2,
                disk_write_bps = ?3,
                battery_percent = ?4,
                charging = ?5,
                coordinator_latency_ms = ?6,
                memory_available_bytes = ?7,
                memory_total_bytes = ?8,
                network_metered = ?9,
                network_down_bps = ?10,
                network_type = ?11,
                network_up_bps = ?12,
                storage_available_bytes = ?13
          WHERE id = ?14 AND user_id = ?15`,
      ).bind(
        now,
        diskReadBps,
        diskWriteBps,
        metrics.batteryPercent,
        booleanInteger(metrics.charging),
        metrics.coordinatorLatencyMs,
        metrics.memoryAvailableBytes,
        metrics.memoryTotalBytes,
        booleanInteger(metrics.networkMetered),
        metrics.networkDownBps,
        metrics.networkType,
        metrics.networkUpBps,
        metrics.storageAvailableBytes,
        nodeId,
        session.userId,
      ).run();
      if ((result.meta.changes ?? 0) === 0) return json({ error: 'Node not found.' }, 404);
      return json({
        completedAt: now,
        batteryPercent: metrics.batteryPercent,
        charging: metrics.charging,
        coordinatorLatencyMs: metrics.coordinatorLatencyMs,
        diskReadBps,
        diskWriteBps,
        memoryAvailableBytes: metrics.memoryAvailableBytes,
        memoryTotalBytes: metrics.memoryTotalBytes,
        networkMetered: metrics.networkMetered,
        networkDownBps: metrics.networkDownBps,
        networkType: metrics.networkType,
        networkUpBps: metrics.networkUpBps,
        storageAvailableBytes: metrics.storageAvailableBytes,
      });
    }
    const result = await env.DB.prepare(
      `UPDATE nodes
          SET test_requested_at = ?1,
              test_completed_at = ?1,
              disk_read_bps = ?2,
              disk_write_bps = ?3
        WHERE id = ?4 AND user_id = ?5`,
    ).bind(now, diskReadBps, diskWriteBps, nodeId, session.userId).run();
    if ((result.meta.changes ?? 0) === 0) return json({ error: 'Node not found.' }, 404);
    return json({
      completedAt: now,
      diskReadBps,
      diskWriteBps,
    });
  } catch (error) {
    return json({
      error: error instanceof NodeInputError ? error.message : 'Nodo test result is invalid.',
    }, 400);
  }
}

export async function deleteNode(request: Request, env: Env, nodeId: string): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!NODE_ID.test(nodeId)) return json({ error: 'Node not found.' }, 404);
  const existing = await ownedNode(env, nodeId, session.userId);
  if (!existing) return json({ error: 'Node not found.' }, 404);
  await retireNodePublicPosts(env, nodeId, unixNow());
  const result = await env.DB.prepare('DELETE FROM nodes WHERE id = ?1 AND user_id = ?2')
    .bind(nodeId, session.userId)
    .run();
  if ((result.meta.changes ?? 0) === 0) return json({ error: 'Node not found.' }, 404);
  return json({ ok: true });
}

function publicNode(row: NodeRow, now: number) {
  return {
    createdAt: row.created_at,
    deviceName: row.device_name,
    diagnostics: {
      completedAt: row.test_completed_at,
      requestedAt: row.test_requested_at,
      running: (row.test_requested_at ?? 0) > (row.test_completed_at ?? 0),
    },
    id: row.id,
    lastSeenAt: row.last_seen_at,
    localAddresses: parseAddresses(row.local_addresses),
    metrics: {
      androidSdk: row.android_sdk,
      appVersion: row.app_version,
      batteryPercent: row.battery_percent,
      charging: integerBoolean(row.charging),
      coordinatorLatencyMs: row.coordinator_latency_ms,
      diskReadBps: row.disk_read_bps,
      diskWriteBps: row.disk_write_bps,
      memoryAvailableBytes: row.memory_available_bytes,
      memoryTotalBytes: row.memory_total_bytes,
      networkMetered: integerBoolean(row.network_metered),
      networkDownBps: row.network_down_bps,
      networkType: row.network_type,
      networkUpBps: row.network_up_bps,
      storageAvailableBytes: row.storage_available_bytes,
    },
    observedAddress: row.observed_address,
    online: now - row.last_seen_at <= ONLINE_SECONDS,
    policy: policy(row),
    port: row.port,
    protocol: row.protocol,
    quotaBytes: row.quota_bytes,
    usedBytes: row.used_bytes,
    spaces: spaces(row),
  };
}

function policy(row: NodeRow) {
  return {
    allowDownloads: Boolean(row.allow_downloads),
    allowUploads: Boolean(row.allow_uploads),
    chargingOnly: Boolean(row.charging_only),
    ownerOnly: true,
    wifiOnly: Boolean(row.wifi_only),
  };
}

function spaces(row: NodeRow) {
  return {
    private: { quotaBytes: row.private_quota_bytes, usedBytes: row.private_used_bytes },
    public: { quotaBytes: row.public_quota_bytes, usedBytes: row.public_used_bytes },
  };
}

async function ownedNode(env: Env, nodeId: string, userId: ArrayBuffer): Promise<NodeRow | null> {
  return env.DB.prepare(
    `SELECT ${NODE_COLUMNS} FROM nodes WHERE id = ?1 AND user_id = ?2 LIMIT 1`,
  ).bind(nodeId, userId).first<NodeRow>();
}

async function readHeartbeat(request: Request) {
  const value = await readJson(request);
  const nodeId = value.nodeId === null || value.nodeId === undefined ? null : value.nodeId;
  if (nodeId !== null && (typeof nodeId !== 'string' || !NODE_ID.test(nodeId))) {
    throw new NodeInputError('Node ID is invalid.');
  }
  if (typeof value.deviceName !== 'string' || !value.deviceName.trim() || value.deviceName.length > 80) {
    throw new NodeInputError('Device name is invalid.');
  }
  if (value.protocol !== 'tus/1.0.0') throw new NodeInputError('Node protocol is unsupported.');
  if (!Number.isInteger(value.port) || (value.port as number) < 1 || (value.port as number) > 65_535) {
    throw new NodeInputError('Node port is invalid.');
  }
  if (!safeBytes(value.quotaBytes, false) || !safeBytes(value.usedBytes, true) ||
      (value.usedBytes as number) > (value.quotaBytes as number)) {
    throw new NodeInputError('Node storage values are invalid.');
  }
  const spaces = readHeartbeatSpaces(value.spaces, value.usedBytes as number);
  const deletedPublicPostIds = reconciliationIds(value.deletedPublicPostIds);
  const deletedLigoMessageIds = reconciliationIds(value.deletedLigoMessageIds);
  const releasedPublicReservationIds = reconciliationIds(value.releasedPublicReservationIds);
  const completedEraseJobIds = reconciliationIds(value.completedEraseJobIds);
  if (!Array.isArray(value.localAddresses) || value.localAddresses.length > 16 ||
      value.localAddresses.some((address) => typeof address !== 'string' || !validIpAddress(address))) {
    throw new NodeInputError('Node addresses are invalid.');
  }
  const metrics = value.metrics === undefined ? null : readMetrics(value.metrics);
  const deviceKey = value.deviceKey === undefined || value.deviceKey === null
    ? null
    : typeof value.deviceKey === 'string' && DEVICE_KEY.test(value.deviceKey)
      ? value.deviceKey
      : (() => { throw new NodeInputError('Device identity is invalid.'); })();
  const slotKey = value.slotKey === undefined ? 'primary' : value.slotKey;
  if (typeof slotKey !== 'string' || !SLOT_KEY.test(slotKey)) {
    throw new NodeInputError('Node slot is invalid.');
  }
  const testCompletedAt = value.testCompletedAt === undefined || value.testCompletedAt === null
    ? null
    : safeTimestamp(value.testCompletedAt);
  return {
    deletedLigoMessageIds,
    deletedPublicPostIds,
    completedEraseJobIds,
    deviceName: value.deviceName.trim(),
    deviceKey,
    localAddresses: [...new Set(value.localAddresses as string[])],
    metrics,
    nodeId,
    port: value.port as number,
    protocol: value.protocol,
    quotaBytes: value.quotaBytes as number,
    releasedPublicReservationIds,
    slotKey,
    spaces,
    testCompletedAt,
    usedBytes: value.usedBytes as number,
  };
}

function reconciliationIds(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_RECONCILIATION_IDS ||
      value.some((item) => typeof item !== 'string' || !NODE_ID.test(item))) {
    throw new NodeInputError('Node reconciliation data is invalid.');
  }
  return [...new Set(value as string[])];
}

async function applyPublicReconciliationAcks(
  env: Env,
  nodeId: string,
  postIds: string[],
  reservationIds: string[],
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  if (postIds.length) {
    const placeholders = postIds.map((_, index) => `?${index + 2}`).join(', ');
    statements.push(
      env.DB.prepare(
        `DELETE FROM fluo_public_allocations
          WHERE node_id = ?1 AND committed = 1 AND post_id IN (${placeholders})`,
      ).bind(nodeId, ...postIds),
      env.DB.prepare(
        `DELETE FROM fluo_public_tombstones
          WHERE node_id = ?1 AND post_id IN (${placeholders})`,
      ).bind(nodeId, ...postIds),
    );
  }
  if (reservationIds.length) {
    const placeholders = reservationIds.map((_, index) => `?${index + 2}`).join(', ');
    statements.push(
      env.DB.prepare(
        `DELETE FROM fluo_public_allocations
          WHERE node_id = ?1 AND committed = 0 AND id IN (${placeholders})`,
      ).bind(nodeId, ...reservationIds),
      env.DB.prepare(
        `DELETE FROM profile_public_allocations
          WHERE node_id = ?1 AND id IN (${placeholders})`,
      ).bind(nodeId, ...reservationIds),
    );
  }
  if (statements.length) await env.DB.batch(statements);
}

function readHeartbeatSpaces(value: unknown, usedBytes: number) {
  if (value === null || value === undefined) {
    return { privateUsedBytes: usedBytes, publicUsedBytes: 0 };
  }
  if (!isRecord(value) || !safeBytes(value.privateUsedBytes, true) ||
      !safeBytes(value.publicUsedBytes, true) ||
      Number(value.privateUsedBytes) + Number(value.publicUsedBytes) !== usedBytes) {
    throw new NodeInputError('Node space usage is invalid.');
  }
  return {
    privateUsedBytes: value.privateUsedBytes as number,
    publicUsedBytes: value.publicUsedBytes as number,
  };
}

async function resolveHeartbeatNode(
  env: Env,
  userId: ArrayBuffer,
  input: { deviceKey: string | null; nodeId: string | null; slotKey: string },
): Promise<NodeRow | null> {
  if (!input.deviceKey && !input.nodeId) return null;
  return env.DB.prepare(
    `SELECT ${NODE_COLUMNS} FROM nodes
      WHERE user_id = ?1
        AND ((?2 IS NOT NULL AND device_key = ?2 AND slot_key = ?3) OR id = ?4)
      ORDER BY CASE WHEN device_key = ?2 AND slot_key = ?3 THEN 0 ELSE 1 END
      LIMIT 1`,
  ).bind(userId, input.deviceKey, input.slotKey, input.nodeId).first<NodeRow>();
}

function readMetrics(value: unknown) {
  if (!isRecord(value)) throw new NodeInputError('Node metrics are invalid.');
  const appVersion = optionalString(value.appVersion, 24);
  const androidSdk = optionalInteger(value.androidSdk, 21, 100);
  const batteryPercent = optionalInteger(value.batteryPercent, 0, 100);
  const coordinatorLatencyMs = optionalInteger(value.coordinatorLatencyMs, 0, 120_000);
  const networkType = optionalEnum(value.networkType, ['cellular', 'ethernet', 'offline', 'other', 'wifi']);
  const bytes = (name: string) => optionalSafeBytes(value[name]);
  const charging = optionalBoolean(value.charging);
  const networkMetered = optionalBoolean(value.networkMetered);
  return {
    androidSdk,
    appVersion,
    batteryPercent,
    charging,
    coordinatorLatencyMs,
    diskReadBps: bytes('diskReadBps'),
    diskWriteBps: bytes('diskWriteBps'),
    memoryAvailableBytes: bytes('memoryAvailableBytes'),
    memoryTotalBytes: bytes('memoryTotalBytes'),
    networkMetered,
    networkDownBps: bytes('networkDownBps'),
    networkType,
    networkUpBps: bytes('networkUpBps'),
    storageAvailableBytes: bytes('storageAvailableBytes'),
  };
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim();
  if (contentType !== 'application/json') throw new NodeInputError('Content-Type must be application/json.');
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_REQUEST_BYTES) throw new NodeInputError('Request is too large.');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_REQUEST_BYTES) throw new NodeInputError('Request is too large.');
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(value)) throw new NodeInputError('Request body must contain an object.');
    return value;
  } catch (error) {
    if (error instanceof NodeInputError) throw error;
    throw new NodeInputError('Request body must contain valid JSON.');
  }
}

function safeBytes(value: unknown, allowZero: boolean): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
}

function optionalSafeBytes(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (!safeBytes(value, true)) throw new NodeInputError('Node metrics are invalid.');
  return value as number;
}

function optionalInteger(value: unknown, minimum: number, maximum: number): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new NodeInputError('Node metrics are invalid.');
  }
  return value as number;
}

function optionalBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'boolean') throw new NodeInputError('Node metrics are invalid.');
  return value;
}

function optionalString(value: unknown, maximum: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new NodeInputError('Node metrics are invalid.');
  }
  return value.trim();
}

function optionalEnum(value: unknown, allowed: readonly string[]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new NodeInputError('Node metrics are invalid.');
  }
  return value;
}

function safeTimestamp(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new NodeInputError('Test timestamp is invalid.');
  }
  return value as number;
}

function validIpv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255);
}

function validIpAddress(value: string): boolean {
  if (validIpv4(value)) return true;
  if (!value.includes(':') || value.length > 45) return false;
  try {
    // URL parsing is available in Workers and validates compressed IPv6,
    // IPv4-mapped IPv6, and rejects zone identifiers/control characters.
    return new URL(`http://[${value}]/`).hostname.length > 2;
  } catch {
    return false;
  }
}

function parseAddresses(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function clientAddress(request: Request): string | null {
  const value = request.headers.get('cf-connecting-ip')?.trim();
  return value && value.length <= 45 && validIpAddress(value) ? value : null;
}

function booleanInteger(value: boolean | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function integerBoolean(value: number | null): boolean | null {
  return value === null ? null : Boolean(value);
}

function supportsSpaces(version: string | null): boolean {
  const match = version?.match(/^(\d+)\.(\d+)(?:\.|$)/u);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  // The current 0.1 release line supersedes the older 0.13+ development
  // line; keep both ranges supported for nodes that have not been upgraded.
  return major > 0 || minor >= 1;
}

function randomTicket(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

async function tokenHash(token: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class NodeInputError extends Error {}
