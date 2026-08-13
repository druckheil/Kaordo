import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { arrayBuffer, base64Url, utf8 } from '../src/auth/encoding';
import { isRootSuperadmin } from '../src/auth/types';
import { retireOfflinePublicNodes } from '../src/fluo/public-storage';

const PASSWORD = 'correct horse battery staple';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ligo_deliveries'),
    env.DB.prepare('DELETE FROM ligo_conversations'),
    env.DB.prepare('DELETE FROM rondo_invites'),
    env.DB.prepare('DELETE FROM rondo_members'),
    env.DB.prepare('DELETE FROM rondo_room_routes'),
    env.DB.prepare('DELETE FROM rondo_rooms'),
    env.DB.prepare('DELETE FROM rondo_space_nodes'),
    env.DB.prepare('DELETE FROM rondo_spaces'),
    env.DB.prepare('DELETE FROM fluo_public_tombstones'),
    env.DB.prepare('DELETE FROM fluo_public_allocations'),
    env.DB.prepare('DELETE FROM node_access_tickets'),
    env.DB.prepare('DELETE FROM nodes'),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM users'),
  ]);
});

describe('authentication API', () => {
  it('requires role, reserved username, and immutable ID for root authority', () => {
    const root = {
      createdAt: 1,
      id: 'immutable-user-id',
      role: 'superadmin' as const,
      username: 'druckheil',
    };

    expect(isRootSuperadmin(root, 'immutable-user-id')).toBe(true);
    expect(isRootSuperadmin(root, 'another-user-id')).toBe(false);
    expect(isRootSuperadmin({ ...root, username: 'someone' }, 'immutable-user-id')).toBe(false);
    expect(isRootSuperadmin({ ...root, role: 'admin' }, 'immutable-user-id')).toBe(false);
  });

  it('registers a web user, authenticates the cookie, and logs out', async () => {
    const registered = await post('/api/auth/register', {
      password: PASSWORD,
      username: 'Nova_User',
    });
    const cookieHeader = registered.headers.get('set-cookie');
    const registeredBody = await registered.json();

    expect(registered.status).toBe(201);
    expect(cookieHeader).toContain('vdm_session=');
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('Secure');
    expect(cookieHeader).toContain('SameSite=Strict');
    expect(registeredBody).toMatchObject({
      user: { username: 'Nova_User' },
    });
    expect(JSON.stringify(registeredBody)).not.toContain('sessionToken');

    const cookie = cookieHeader?.split(';', 1)[0] ?? '';
    const current = await api('/api/auth/me', { headers: { cookie } });
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({ user: { username: 'Nova_User' } });

    const loggedOut = await api('/api/auth/logout', {
      headers: { cookie },
      method: 'POST',
    });
    expect(loggedOut.status).toBe(200);
    expect(loggedOut.headers.get('set-cookie')).toContain('Max-Age=0');

    const afterLogout = await api('/api/auth/me', { headers: { cookie } });
    expect(afterLogout.status).toBe(401);
  });

  it('enforces case-insensitive username uniqueness', async () => {
    expect((await post('/api/auth/register', { password: PASSWORD, username: 'River' })).status)
      .toBe(201);
    const duplicate = await post('/api/auth/register', {
      password: `${PASSWORD}!`,
      username: 'RIVER',
    });

    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toEqual({ error: 'Username is unavailable.' });
  });

  it('logs in valid credentials and gives the same error for both invalid cases', async () => {
    await post('/api/auth/register', { password: PASSWORD, username: 'Aurora' });

    const successful = await post('/api/auth/login', {
      password: PASSWORD,
      username: 'aurora',
    });
    const wrongPassword = await post('/api/auth/login', {
      password: 'this password is wrong',
      username: 'aurora',
    });
    const missingUser = await post('/api/auth/login', {
      password: 'this password is wrong',
      username: 'unknown_user',
    });

    expect(successful.status).toBe(200);
    expect(successful.headers.get('set-cookie')).toContain('HttpOnly');
    expect(wrongPassword.status).toBe(401);
    expect(missingUser.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await missingUser.json());
  });

  it('returns desktop tokens only from the non-CORS desktop flow', async () => {
    const response = await post('/api/auth/desktop/register', {
      deviceName: 'Test Mac',
      password: PASSWORD,
      username: 'Desktop_User',
    });
    const body = await response.json<{ sessionToken: string; user: { username: string } }>();

    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(body.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const current = await api('/api/auth/me', {
      headers: { authorization: `Bearer ${body.sessionToken}` },
    });
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({ user: { username: 'Desktop_User' } });
  });

  it('does not expose desktop token routes on a future web app host', async () => {
    const response = await exports.default.fetch(
      'https://app.kaordo.example/api/auth/desktop/login',
      {
        body: JSON.stringify({
          passwordProof: 'x'.repeat(43),
          username: 'desktop_user',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects expired sessions', async () => {
    const response = await post('/api/auth/desktop/register', {
      password: PASSWORD,
      username: 'Timed_User',
    });
    const { sessionToken } = await response.json<{ sessionToken: string }>();
    await env.DB.prepare('UPDATE sessions SET expires_at = 0').run();

    const current = await api('/api/auth/me', {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(current.status).toBe(401);
    expect(await env.DB.prepare('SELECT 1 FROM sessions').first()).toBeNull();
  });

  it('stores only a hash of the session token and compact password records', async () => {
    const response = await post('/api/auth/desktop/register', {
      password: PASSWORD,
      username: 'Binary_User',
    });
    const { sessionToken } = await response.json<{ sessionToken: string }>();
    const session = await env.DB.prepare('SELECT token_hash FROM sessions').first<{
      token_hash: ArrayBuffer;
    }>();
    const user = await env.DB
      .prepare(
        `SELECT length(password_hash) AS hash_bytes,
                length(password_salt) AS salt_bytes,
                password_iterations
           FROM users`,
      )
      .first<{ hash_bytes: number; password_iterations: number; salt_bytes: number }>();
    const expectedHash = await crypto.subtle.digest(
      'SHA-256',
      arrayBuffer(utf8(sessionToken)),
    );

    expect(base64Url(session?.token_hash ?? new ArrayBuffer(0))).toBe(base64Url(expectedHash));
    expect(base64Url(session?.token_hash ?? new ArrayBuffer(0))).not.toBe(sessionToken);
    expect(user).toEqual({
      hash_bytes: 32,
      password_iterations: 20_000,
      salt_bytes: 16,
    });
  });

  it('rejects malformed and oversized authentication input', async () => {
    const malformed = await api('/api/auth/register', {
      body: '{',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const oversized = await post('/api/auth/register', {
      passwordProof: 'x'.repeat(4_100),
      username: 'large_user',
    }, false);

    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(400);
  });

  it('requires a session for account information', async () => {
    const response = await api('/api/auth/me');
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required.' });
  });

  it('protects the admin dashboard from regular accounts', async () => {
    const registered = await post('/api/auth/desktop/register', {
      password: PASSWORD,
      username: 'Regular_User',
    });
    const { sessionToken } = await registered.json<{ sessionToken: string }>();

    const dashboard = await api('/api/admin/dashboard', {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const telemetry = await api('/api/admin/cloudflare', {
      headers: { authorization: `Bearer ${sessionToken}` },
    });

    expect(dashboard.status).toBe(403);
    expect(telemetry.status).toBe(403);
    await expect(dashboard.json()).resolves.toEqual({
      error: 'Administrator access required.',
    });
  });

  it('always grants druckheil superadmin access and reports operational data', async () => {
    const registered = await post('/api/auth/desktop/register', {
      password: PASSWORD,
      username: 'druckheil',
    });
    const { sessionToken, user } = await registered.json<{
      sessionToken: string;
      user: { role: string };
    }>();
    expect(user.role).toBe('superadmin');

    // The immutable username rule remains authoritative even if the stored role
    // is accidentally downgraded.
    await env.DB.prepare("UPDATE users SET role = 0 WHERE username = 'druckheil'").run();
    const dashboard = await api('/api/admin/dashboard', {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    const body = await dashboard.json<{
      capacity: { d1: { rowsReadDaily: number }; worker: { requestsDaily: number } };
      usage: { activeSessions: number; totalUsers: number };
      users: Array<{ role: string; username: string }>;
    }>();

    expect(dashboard.status).toBe(200);
    expect(body.capacity.worker.requestsDaily).toBe(100_000);
    expect(body.capacity.d1.rowsReadDaily).toBe(5_000_000);
    expect(body.usage).toMatchObject({ activeSessions: 1, totalUsers: 1 });
    expect(body.users[0]).toMatchObject({ role: 'superadmin', username: 'druckheil' });

    const telemetry = await api('/api/admin/cloudflare', {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(telemetry.status).toBe(200);
    await expect(telemetry.json()).resolves.toBeNull();
  });

  it('refreshes presence for an authenticated account', async () => {
    const registered = await post('/api/auth/desktop/register', {
      password: PASSWORD,
      username: 'Present_User',
    });
    const { sessionToken } = await registered.json<{ sessionToken: string }>();
    await env.DB.prepare('UPDATE users SET last_seen_at = 0').run();

    const response = await api('/api/auth/presence', {
      headers: { authorization: `Bearer ${sessionToken}` },
      method: 'POST',
    });
    const user = await env.DB.prepare('SELECT last_seen_at FROM users').first<{
      last_seen_at: number;
    }>();

    expect(response.status).toBe(200);
    expect(user?.last_seen_at).toBeGreaterThan(0);
  });

  it('registers an Android node and returns ordered direct connection candidates', async () => {
    const registered = await post('/api/auth/desktop/register', {
      deviceName: 'Nodo test',
      password: PASSWORD,
      username: 'node_owner',
    });
    const { sessionToken } = await registered.json<{ sessionToken: string }>();
    const authorization = { authorization: `Bearer ${sessionToken}` };
    const deviceKey = 'a'.repeat(64);
    const heartbeat = await api('/api/nodes/heartbeat', {
      body: JSON.stringify({
        deviceKey,
        deviceName: 'Pixel 6',
        localAddresses: ['192.168.1.44'],
        nodeId: null,
        port: 49_321,
        protocol: 'tus/1.0.0',
        quotaBytes: 10_737_418_240,
        slotKey: 'primary',
        usedBytes: 1_048_576,
        metrics: {
          androidSdk: 31,
          appVersion: '0.13.0',
          batteryPercent: 82,
          charging: true,
          coordinatorLatencyMs: 24,
          diskReadBps: 220_000_000,
          diskWriteBps: 105_000_000,
          memoryAvailableBytes: 2_000_000_000,
          memoryTotalBytes: 6_000_000_000,
          networkMetered: false,
          networkDownBps: 100_000_000,
          networkType: 'wifi',
          networkUpBps: 50_000_000,
          storageAvailableBytes: 40_000_000_000,
        },
      }),
      headers: {
        ...authorization,
        'cf-connecting-ip': '203.0.113.10',
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    const heartbeatBody = await heartbeat.json<{
      heartbeatAfterSeconds: number;
      nodeId: string;
      observedAddress: string;
    }>();

    expect(heartbeat.status).toBe(200);
    expect(heartbeatBody.heartbeatAfterSeconds).toBe(120);
    expect(heartbeatBody.nodeId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(heartbeatBody.observedAddress).toBe('203.0.113.10');

    const reinstalled = await api('/api/nodes/heartbeat', {
      body: JSON.stringify({
        deviceKey,
        deviceName: 'Pixel 6',
        localAddresses: ['192.168.1.44'],
        nodeId: null,
        port: 49_321,
        protocol: 'tus/1.0.0',
        quotaBytes: 10_737_418_240,
        slotKey: 'primary',
        usedBytes: 1_048_576,
      }),
      headers: { ...authorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    expect((await reinstalled.json<{ nodeId: string }>()).nodeId).toBe(heartbeatBody.nodeId);

    const nodes = await api('/api/nodes', { headers: authorization });
    const nodesBody = await nodes.json<{ nodes: unknown[] }>();
    expect(nodesBody.nodes).toHaveLength(1);
    expect(nodesBody).toMatchObject({
      nodes: [{
        deviceName: 'Pixel 6',
        metrics: { androidSdk: 31, batteryPercent: 82, networkType: 'wifi' },
        online: true,
        policy: { allowDownloads: true, allowUploads: true, ownerOnly: true },
        quotaBytes: 10_737_418_240,
        spaces: {
          private: { quotaBytes: 10_737_418_240, usedBytes: 1_048_576 },
          public: { quotaBytes: 0, usedBytes: 0 },
        },
      }],
    });

    const policy = await api(`/api/nodes/${heartbeatBody.nodeId}`, {
      body: JSON.stringify({
        allowDownloads: true,
        allowUploads: false,
        chargingOnly: true,
        wifiOnly: true,
      }),
      headers: { ...authorization, 'content-type': 'application/json' },
      method: 'PATCH',
    });
    expect(policy.status).toBe(200);
    await expect(policy.json()).resolves.toMatchObject({
      policy: { allowUploads: false, chargingOnly: true, ownerOnly: true, wifiOnly: true },
    });

    const split = await api(`/api/nodes/${heartbeatBody.nodeId}/spaces`, {
      body: JSON.stringify({
        privateQuotaBytes: 8_589_934_592,
        publicQuotaBytes: 2_147_483_648,
      }),
      headers: { ...authorization, 'content-type': 'application/json' },
      method: 'PATCH',
    });
    expect(split.status).toBe(200);
    await expect(split.json()).resolves.toMatchObject({
      spaces: {
        private: { quotaBytes: 8_589_934_592, usedBytes: 1_048_576 },
        public: { quotaBytes: 2_147_483_648, usedBytes: 0 },
      },
    });

    const allPublic = await api(`/api/nodes/${heartbeatBody.nodeId}/spaces`, {
      body: JSON.stringify({
        privateQuotaBytes: 0,
        publicQuotaBytes: 10_737_418_240,
      }),
      headers: { ...authorization, 'content-type': 'application/json' },
      method: 'PATCH',
    });
    expect(allPublic.status).toBe(409);

    await api('/api/nodes/heartbeat', {
      body: JSON.stringify({
        deviceKey,
        deviceName: 'Pixel 6',
        localAddresses: ['192.168.1.44'],
        nodeId: heartbeatBody.nodeId,
        port: 49_321,
        protocol: 'tus/1.0.0',
        quotaBytes: 10_737_418_240,
        slotKey: 'primary',
        usedBytes: 0,
      }),
      headers: { ...authorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    const allPublicAfterClear = await api(`/api/nodes/${heartbeatBody.nodeId}/spaces`, {
      body: JSON.stringify({
        privateQuotaBytes: 0,
        publicQuotaBytes: 10_737_418_240,
      }),
      headers: { ...authorization, 'content-type': 'application/json' },
      method: 'PATCH',
    });
    expect(allPublicAfterClear.status).toBe(200);
    await expect(allPublicAfterClear.json()).resolves.toMatchObject({
      spaces: {
        private: { quotaBytes: 0, usedBytes: 0 },
        public: { quotaBytes: 10_737_418_240, usedBytes: 0 },
      },
    });

    const test = await api(`/api/nodes/${heartbeatBody.nodeId}/test`, {
      headers: authorization,
      method: 'POST',
    });
    expect(test.status).toBe(200);
    const testBody = await test.json<{ requestedAt: number }>();
    const secondHeartbeat = await api('/api/nodes/heartbeat', {
      body: JSON.stringify({
        deviceKey,
        deviceName: 'Pixel 6',
        localAddresses: ['192.168.1.44'],
        nodeId: heartbeatBody.nodeId,
        port: 49_321,
        protocol: 'tus/1.0.0',
        quotaBytes: 10_737_418_240,
        slotKey: 'primary',
        usedBytes: 0,
      }),
      headers: { ...authorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    await expect(secondHeartbeat.json()).resolves.toMatchObject({
      policy: { allowUploads: false, chargingOnly: true, wifiOnly: true },
      runQuickTest: true,
      spaces: {
        private: { quotaBytes: 0 },
        public: { quotaBytes: 10_737_418_240 },
      },
    });
    expect(testBody.requestedAt).toBeGreaterThan(0);

    const route = await api(`/api/nodes/${heartbeatBody.nodeId}/route`, {
      headers: authorization,
    });
    await expect(route.json()).resolves.toMatchObject({
      candidates: [
        { address: '192.168.1.44', kind: 'lan', port: 49_321 },
        { address: '203.0.113.10', kind: 'public', port: 49_321 },
      ],
      strategy: ['lan', 'public'],
    });

    const access = await api(`/api/nodes/${heartbeatBody.nodeId}/access`, {
      headers: authorization,
      method: 'POST',
    });
    const accessBody = await access.json<{ expiresAt: number; ticket: string }>();
    expect(access.status).toBe(200);
    expect(accessBody.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(accessBody.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1_000));
    const verified = await api('/api/nodes/tickets/verify', {
      body: JSON.stringify({ nodeId: heartbeatBody.nodeId, ticket: accessBody.ticket }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    await expect(verified.json()).resolves.toMatchObject({
      authorized: true,
      isOwner: true,
      username: 'node_owner',
    });

    const visitor = await post('/api/auth/desktop/register', {
      password: PASSWORD,
      username: 'node_visitor',
    });
    const visitorToken = (await visitor.json<{ sessionToken: string }>()).sessionToken;
    const feedNodes = await api('/api/fluo/nodes', {
      headers: { authorization: `Bearer ${visitorToken}` },
    });
    await expect(feedNodes.json()).resolves.toEqual({ nodeIds: [heartbeatBody.nodeId] });
    const visitorAccess = await api(`/api/nodes/${heartbeatBody.nodeId}/access`, {
      headers: { authorization: `Bearer ${visitorToken}` },
      method: 'POST',
    });
    expect(visitorAccess.status).toBe(200);
    const visitorTicket = (await visitorAccess.json<{ ticket: string }>()).ticket;
    const visitorVerified = await api('/api/nodes/tickets/verify', {
      body: JSON.stringify({ nodeId: heartbeatBody.nodeId, ticket: visitorTicket }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    await expect(visitorVerified.json()).resolves.toMatchObject({
      authorized: true,
      isOwner: false,
      username: 'node_visitor',
    });
    const rejected = await api('/api/nodes/tickets/verify', {
      body: JSON.stringify({ nodeId: heartbeatBody.nodeId, ticket: 'x'.repeat(43) }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(rejected.status).toBe(401);

    const removed = await api(`/api/nodes/${heartbeatBody.nodeId}`, {
      headers: authorization,
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    await expect(api('/api/nodes', { headers: authorization }).then((response) => response.json()))
      .resolves.toEqual({ nodes: [] });
  });

  it('reserves shared Public Nodo space and enforces a 1 GB allowance per account', async () => {
    const owner = await post('/api/auth/desktop/register', {
      password: PASSWORD,
      username: 'public_node_owner',
    });
    const ownerToken = (await owner.json<{ sessionToken: string }>()).sessionToken;
    const ownerAuthorization = { authorization: `Bearer ${ownerToken}` };
    const heartbeat = await api('/api/nodes/heartbeat', {
      body: JSON.stringify({
        deviceKey: 'b'.repeat(64),
        deviceName: 'Shared tablet',
        localAddresses: ['192.168.1.45'],
        metrics: { appVersion: '0.14.1' },
        nodeId: null,
        port: 49_321,
        protocol: 'tus/1.0.0',
        quotaBytes: 4_294_967_296,
        slotKey: 'primary',
        usedBytes: 0,
      }),
      headers: { ...ownerAuthorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    const nodeId = (await heartbeat.json<{ nodeId: string }>()).nodeId;
    await api(`/api/nodes/${nodeId}/spaces`, {
      body: JSON.stringify({ privateQuotaBytes: 0, publicQuotaBytes: 4_294_967_296 }),
      headers: { ...ownerAuthorization, 'content-type': 'application/json' },
      method: 'PATCH',
    });

    const visitor = await post('/api/auth/desktop/register', {
      password: PASSWORD,
      username: 'public_writer',
    });
    const visitorToken = (await visitor.json<{ sessionToken: string }>()).sessionToken;
    const authorization = { authorization: `Bearer ${visitorToken}` };
    const status = await api('/api/fluo/public-storage', { headers: authorization });
    await expect(status.json()).resolves.toMatchObject({
      limitBytes: 1_073_741_824,
      nodeCandidates: [{ nodeId }],
      reservedBytes: 0,
      usedBytes: 0,
    });
    const bootstrap = await api('/api/fluo/bootstrap', { headers: authorization });
    await expect(bootstrap.json()).resolves.toMatchObject({
      nodeIds: [nodeId],
      nodes: [],
      publicStorage: {
        limitBytes: 1_073_741_824,
        nodeCandidates: [{ nodeId }],
        reservedBytes: 0,
        usedBytes: 0,
      },
    });

    const reserved = await api('/api/fluo/public-storage/reservations', {
      body: JSON.stringify({ bytes: 536_870_912, nodeId }),
      headers: { ...authorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    const reservation = await reserved.json<{ reservationId: string }>();
    expect(reserved.status).toBe(201);
    expect(reservation.reservationId).toMatch(/^[0-9a-f-]{36}$/u);
    const renewed = await api(
      `/api/fluo/public-storage/reservations/${reservation.reservationId}`,
      {
        body: JSON.stringify({ renew: true }),
        headers: { ...authorization, 'content-type': 'application/json' },
        method: 'PATCH',
      },
    );
    await expect(renewed.json()).resolves.toMatchObject({
      reservationId: reservation.reservationId,
    });

    const access = await api(`/api/nodes/${nodeId}/access`, {
      headers: authorization,
      method: 'POST',
    });
    const ticket = (await access.json<{ ticket: string }>()).ticket;
    const verifiedReservation = await api('/api/nodes/tickets/verify', {
      body: JSON.stringify({ nodeId, reservationId: reservation.reservationId, ticket }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    await expect(verifiedReservation.json()).resolves.toMatchObject({
      authorized: true,
      publicReservation: { bytes: 536_870_912, id: reservation.reservationId },
      username: 'public_writer',
    });

    const postId = '123e4567-e89b-42d3-a456-426614174001';
    const committed = await api(
      `/api/fluo/public-storage/reservations/${reservation.reservationId}`,
      {
        body: JSON.stringify({ postId }),
        headers: { ...authorization, 'content-type': 'application/json' },
        method: 'PATCH',
      },
    );
    await expect(committed.json()).resolves.toMatchObject({
      usage: { usedBytes: 536_870_912 },
    });

    const overLimit = await api('/api/fluo/public-storage/reservations', {
      body: JSON.stringify({ bytes: 600_000_000, nodeId }),
      headers: { ...authorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(overLimit.status).toBe(413);

    const released = await api(`/api/fluo/public-storage/posts/${nodeId}/${postId}`, {
      headers: authorization,
      method: 'DELETE',
    });
    await expect(released.json()).resolves.toMatchObject({ usage: { usedBytes: 0 } });

    const replacement = await api('/api/fluo/public-storage/reservations', {
      body: JSON.stringify({ bytes: 100, nodeId }),
      headers: { ...authorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    const replacementId = (await replacement.json<{ reservationId: string }>()).reservationId;
    const offlinePostId = '123e4567-e89b-42d3-a456-426614174002';
    await api(`/api/fluo/public-storage/reservations/${replacementId}`, {
      body: JSON.stringify({ postId: offlinePostId }),
      headers: { ...authorization, 'content-type': 'application/json' },
      method: 'PATCH',
    });
    await api('/api/nodes/heartbeat', {
      body: JSON.stringify({
        deletedPublicPostIds: [],
        deviceKey: 'b'.repeat(64),
        deviceName: 'Shared tablet',
        localAddresses: ['192.168.1.45'],
        metrics: { appVersion: '0.14.1' },
        nodeId,
        port: 49_321,
        protocol: 'tus/1.0.0',
        quotaBytes: 4_294_967_296,
        releasedPublicReservationIds: [],
        slotKey: 'primary',
        spaces: { privateUsedBytes: 0, publicUsedBytes: 0 },
        usedBytes: 0,
      }),
      headers: { ...ownerAuthorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(await env.DB.prepare(
      'SELECT 1 FROM fluo_public_allocations WHERE post_id = ?1',
    ).bind(offlinePostId).first()).not.toBeNull();
    await env.DB.prepare('UPDATE nodes SET last_seen_at = 0 WHERE id = ?1').bind(nodeId).run();
    const offlineUsage = await api('/api/fluo/public-storage', { headers: authorization });
    await expect(offlineUsage.json()).resolves.toMatchObject({ usedBytes: 0 });

    await retireOfflinePublicNodes(env, Math.floor(Date.now() / 1_000));
    expect(await env.DB.prepare(
      'SELECT 1 FROM fluo_public_allocations WHERE post_id = ?1',
    ).bind(offlinePostId).first()).toBeNull();
    expect(await env.DB.prepare(
      'SELECT 1 FROM fluo_public_tombstones WHERE node_id = ?1 AND post_id = ?2',
    ).bind(nodeId, offlinePostId).first()).not.toBeNull();

    const recoveryBody = {
      deletedPublicPostIds: [],
      deviceKey: 'b'.repeat(64),
      deviceName: 'Shared tablet',
      localAddresses: ['192.168.1.45'],
      metrics: { appVersion: '0.14.1' },
      nodeId,
      port: 49_321,
      protocol: 'tus/1.0.0',
      quotaBytes: 4_294_967_296,
      releasedPublicReservationIds: [],
      slotKey: 'primary',
      spaces: { privateUsedBytes: 0, publicUsedBytes: 100 },
      usedBytes: 100,
    };
    const recovered = await api('/api/nodes/heartbeat', {
      body: JSON.stringify(recoveryBody),
      headers: { ...ownerAuthorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    await expect(recovered.json()).resolves.toMatchObject({
      publicDeletePostIds: [offlinePostId],
    });
    const hiddenWhileReconciling = await api('/api/fluo/public-storage', {
      headers: authorization,
    });
    await expect(hiddenWhileReconciling.json()).resolves.toMatchObject({ nodeCandidates: [] });
    const blockedWhileReconciling = await api(`/api/nodes/${nodeId}/access`, {
      headers: authorization,
      method: 'POST',
    });
    expect(blockedWhileReconciling.status).toBe(409);
    const acknowledged = await api('/api/nodes/heartbeat', {
      body: JSON.stringify({
        ...recoveryBody,
        deletedPublicPostIds: [offlinePostId],
        spaces: { privateUsedBytes: 0, publicUsedBytes: 0 },
        usedBytes: 0,
      }),
      headers: { ...ownerAuthorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    await expect(acknowledged.json()).resolves.toMatchObject({ publicDeletePostIds: [] });
    const availableAfterReconciliation = await api(`/api/nodes/${nodeId}/access`, {
      headers: authorization,
      method: 'POST',
    });
    expect(availableAfterReconciliation.status).toBe(200);
  });

  it('creates and joins a Rondo Space while allowing only one free Public Space per owner', async () => {
    const nodeOwner = await post('/api/auth/desktop/register', {
      password: PASSWORD,
      username: 'rondo_node_owner',
    });
    const nodeOwnerToken = (await nodeOwner.json<{ sessionToken: string }>()).sessionToken;
    const nodeOwnerAuthorization = { authorization: `Bearer ${nodeOwnerToken}` };
    const heartbeat = await api('/api/nodes/heartbeat', {
      body: JSON.stringify({
        deviceKey: 'c'.repeat(64),
        deviceName: 'Rondo host',
        localAddresses: ['192.168.1.46'],
        metrics: { appVersion: '0.15.1' },
        nodeId: null,
        port: 49_321,
        protocol: 'tus/1.0.0',
        quotaBytes: 4_294_967_296,
        slotKey: 'primary',
        usedBytes: 0,
      }),
      headers: { ...nodeOwnerAuthorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    const nodeId = (await heartbeat.json<{ nodeId: string }>()).nodeId;
    await api(`/api/nodes/${nodeId}/spaces`, {
      body: JSON.stringify({ privateQuotaBytes: 0, publicQuotaBytes: 4_294_967_296 }),
      headers: { ...nodeOwnerAuthorization, 'content-type': 'application/json' },
      method: 'PATCH',
    });

    const creator = await post('/api/auth/desktop/register', {
      password: PASSWORD,
      username: 'rondo_creator',
    });
    const creatorToken = (await creator.json<{ sessionToken: string }>()).sessionToken;
    const creatorAuthorization = { authorization: `Bearer ${creatorToken}` };
    const initial = await api('/api/rondo/bootstrap', { headers: creatorAuthorization });
    await expect(initial.json()).resolves.toMatchObject({
      publicOption: { alreadyCreated: false, available: true, limitBytes: 1_073_741_824 },
      spaces: [],
    });

    const created = await api('/api/rondo/spaces', {
      body: JSON.stringify({
        description: 'A test community.',
        name: 'North Star',
        storage: 'public',
      }),
      headers: { ...creatorAuthorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    const createdBody = await created.json<{
      inviteCode: string;
      space: { id: string; memberCount: number; storage: { deviceName: string; kind: string; limitBytes: number; nodeId: string | null } };
    }>();
    expect(created.status).toBe(201);
    expect(createdBody.inviteCode).toMatch(/^RND-[A-Z2-9]{5}-[A-Z2-9]{5}$/u);
    expect(createdBody.space).toMatchObject({
      memberCount: 1,
      storage: { deviceName: 'Public Node', kind: 'public', limitBytes: 1_073_741_824, nodeId: null },
    });

    const detail = await api(`/api/rondo/spaces/${createdBody.space.id}`, {
      headers: creatorAuthorization,
    });
    const detailBody = await detail.json<{
      detail: {
        nodes: Array<{ deviceName: string; id: string; kind: string; nodeId: string | null; position: number }>;
        rooms: Array<{ id: string; name: string }>;
      };
    }>();
    expect(detailBody).toMatchObject({
      detail: {
        id: createdBody.space.id,
        invites: [{ code: null }],
        members: [{ role: 'owner', username: 'rondo_creator' }],
        nodes: [{ deviceName: 'Public Node', kind: 'public', nodeId: null, position: 0 }],
        rooms: [{ name: 'general', position: 0 }],
      },
    });

    const privateHeartbeat = await api('/api/nodes/heartbeat', {
      body: JSON.stringify({
        deviceKey: 'd'.repeat(64),
        deviceName: 'Creator private Nodo',
        localAddresses: ['192.168.1.47'],
        metrics: { appVersion: '0.15.1' },
        nodeId: null,
        port: 49_322,
        protocol: 'tus/1.0.0',
        quotaBytes: 2_147_483_648,
        slotKey: 'primary',
        usedBytes: 0,
      }),
      headers: { ...creatorAuthorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    const privateNodeId = (await privateHeartbeat.json<{ nodeId: string }>()).nodeId;
    const addedNode = await api(`/api/rondo/spaces/${createdBody.space.id}/nodes`, {
      body: JSON.stringify({ nodeId: privateNodeId, storage: 'private' }),
      headers: { ...creatorAuthorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    const addedNodeBody = await addedNode.json<{ node: { id: string; position: number } }>();
    expect(addedNodeBody.node.position).toBe(1);
    const reordered = await api(`/api/rondo/spaces/${createdBody.space.id}/nodes`, {
      body: JSON.stringify({
        tierIds: [addedNodeBody.node.id, detailBody.detail.nodes[0]?.id],
      }),
      headers: { ...creatorAuthorization, 'content-type': 'application/json' },
      method: 'PATCH',
    });
    await expect(reordered.json()).resolves.toMatchObject({
      nodes: [
        { id: addedNodeBody.node.id, position: 0 },
        { id: detailBody.detail.nodes[0]?.id, position: 1 },
      ],
    });

    const generalRoomId = detailBody.detail.rooms[0]!.id;
    const messageRoute = await api(
      `/api/rondo/spaces/${createdBody.space.id}/rooms/${generalRoomId}/route`,
      { headers: creatorAuthorization },
    );
    const messageRouteBody = await messageRoute.json<{
      limitBytes: number;
      nodeId: string;
      storage: string;
    }>();
    expect(messageRouteBody).toMatchObject({
      limitBytes: 2_147_483_648,
      nodeId: privateNodeId,
      storage: 'private',
    });
    const messageAccess = await api(`/api/nodes/${privateNodeId}/access`, {
      headers: creatorAuthorization,
      method: 'POST',
    });
    const messageTicket = (await messageAccess.json<{ ticket: string }>()).ticket;
    const verifiedMessageAccess = await api('/api/nodes/tickets/verify', {
      body: JSON.stringify({
        nodeId: privateNodeId,
        rondoRoomId: generalRoomId,
        rondoSpaceId: createdBody.space.id,
        ticket: messageTicket,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    await expect(verifiedMessageAccess.json()).resolves.toMatchObject({
      authorized: true,
      rondo: {
        limitBytes: 2_147_483_648,
        owner: true,
        roomId: generalRoomId,
        spaceId: createdBody.space.id,
        storage: 'private',
      },
    });

    const updated = await api(`/api/rondo/spaces/${createdBody.space.id}`, {
      body: JSON.stringify({ description: 'Updated description.', name: 'Northern Star' }),
      headers: { ...creatorAuthorization, 'content-type': 'application/json' },
      method: 'PATCH',
    });
    await expect(updated.json()).resolves.toMatchObject({
      space: { description: 'Updated description.', name: 'Northern Star' },
    });

    const extraInvite = await api(`/api/rondo/spaces/${createdBody.space.id}/invites`, {
      body: JSON.stringify({ expiresInDays: 1, maxUses: 3 }),
      headers: { ...creatorAuthorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    const extraInviteBody = await extraInvite.json<{ invite: { code: string; id: string } }>();
    expect(extraInvite.status).toBe(201);
    expect(extraInviteBody.invite.code).toMatch(/^RND-/u);

    const room = await api(`/api/rondo/spaces/${createdBody.space.id}/rooms`, {
      body: JSON.stringify({ name: 'Product Ideas' }),
      headers: { ...creatorAuthorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    const roomBody = await room.json<{ room: { id: string; name: string } }>();
    expect(roomBody.room.name).toBe('product-ideas');
    expect((await api(`/api/rondo/spaces/${createdBody.space.id}/rooms/${roomBody.room.id}`, {
      headers: creatorAuthorization,
      method: 'DELETE',
    })).status).toBe(200);

    const duplicate = await api('/api/rondo/spaces', {
      body: JSON.stringify({ name: 'Second Public', storage: 'public' }),
      headers: { ...creatorAuthorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(duplicate.status).toBe(409);

    const invitee = await post('/api/auth/desktop/register', {
      password: PASSWORD,
      username: 'rondo_invitee',
    });
    const inviteeToken = (await invitee.json<{ sessionToken: string }>()).sessionToken;
    const inviteeAuthorization = { authorization: `Bearer ${inviteeToken}` };
    const joined = await api('/api/rondo/join', {
      body: JSON.stringify({ inviteCode: createdBody.inviteCode.toLowerCase() }),
      headers: { ...inviteeAuthorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(joined.status).toBe(200);
    await expect(joined.json()).resolves.toMatchObject({
      space: { id: createdBody.space.id, memberCount: 2, role: 'member' },
    });
    const inviteeBootstrap = await api('/api/rondo/bootstrap', { headers: inviteeAuthorization });
    await expect(inviteeBootstrap.json()).resolves.toMatchObject({
      spaces: [{ id: createdBody.space.id, memberCount: 2 }],
    });

    const fluoStorage = await api('/api/fluo/public-storage', { headers: creatorAuthorization });
    await expect(fluoStorage.json()).resolves.toMatchObject({
      nodeCandidates: [{ availableBytes: 4_294_967_296, nodeId }],
    });
  });

  it('indexes Ligo conversations and removes an acknowledged offline delivery', async () => {
    const senderRegistration = await post('/api/auth/desktop/register', {
      password: PASSWORD,
      username: 'ligo_sender',
    });
    const senderRegistrationBody = await senderRegistration.json<{
      sessionToken: string;
      user: { id: string };
    }>();
    const senderToken = senderRegistrationBody.sessionToken;
    const senderAuthorization = { authorization: `Bearer ${senderToken}` };
    const recipientRegistration = await post('/api/auth/desktop/register', {
      password: PASSWORD,
      username: 'ligo_recipient',
    });
    const recipientRegistrationBody = await recipientRegistration.json<{
      sessionToken: string;
      user: { id: string };
    }>();
    const recipientToken = recipientRegistrationBody.sessionToken;
    const recipientAuthorization = { authorization: `Bearer ${recipientToken}` };
    const ticketResponse = await api('/api/ligo/live-ticket', {
      headers: recipientAuthorization,
      method: 'POST',
    });
    const { url: liveUrl } = await ticketResponse.json<{ url: string }>();
    expect(ticketResponse.status).toBe(201);
    expect(liveUrl).toMatch(/^wss:\/\//u);
    const testLiveUrl = new URL(liveUrl);
    testLiveUrl.protocol = 'https:';
    const liveResponse = await exports.default.fetch(testLiveUrl, {
      headers: { upgrade: 'websocket' },
    });
    expect(liveResponse.status).toBe(101);
    const liveSocket = liveResponse.webSocket!;
    liveSocket.accept();
    const heartbeat = await api('/api/nodes/heartbeat', {
      body: JSON.stringify({
        deviceKey: 'f'.repeat(64),
        deviceName: 'Ligo tablet',
        localAddresses: ['192.168.1.51'],
        metrics: { appVersion: '0.18.0' },
        nodeId: null,
        port: 49_321,
        protocol: 'tus/1.0.0',
        quotaBytes: 2_147_483_648,
        slotKey: 'primary',
        usedBytes: 0,
      }),
      headers: { ...senderAuthorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    const nodeId = (await heartbeat.json<{ nodeId: string }>()).nodeId;
    const storage = await api('/api/ligo/storage', {
      body: JSON.stringify({ selectedNodeId: nodeId, stackLimitBytes: 104_857_600 }),
      headers: { ...senderAuthorization, 'content-type': 'application/json' },
      method: 'PATCH',
    });
    expect(storage.status).toBe(200);
    const search = await api('/api/ligo/users?q=ligo_rec', { headers: senderAuthorization });
    await expect(search.json()).resolves.toMatchObject({
      users: [{ online: true, username: 'ligo_recipient' }],
    });

    const messageId = '123e4567-e89b-42d3-a456-426614174077';
    const liveSignal = new Promise<string>((resolve) => {
      liveSocket.addEventListener('message', ({ data }) => resolve(String(data)), { once: true });
    });
    const queued = await api('/api/ligo/deliveries', {
      body: JSON.stringify({
        id: messageId,
        nodeId,
        preview: 'A compact local-first message',
        recipientUsername: 'ligo_recipient',
        sizeBytes: 64,
        storage: 'private',
      }),
      headers: { ...senderAuthorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(queued.status).toBe(201);
    await expect(liveSignal).resolves.toBe(JSON.stringify({ messageId, type: 'inbox' }));

    const senderBootstrap = await api('/api/ligo/bootstrap', { headers: senderAuthorization });
    await expect(senderBootstrap.json()).resolves.toMatchObject({
      conversations: [{
        lastMessage: { id: messageId, mine: true, preview: 'A compact local-first message' },
        user: { online: true, username: 'ligo_recipient' },
      }],
      nextCursor: null,
    });
    const inbox = await api('/api/ligo/inbox', { headers: recipientAuthorization });
    await expect(inbox.json()).resolves.toMatchObject({
      deliveries: [{ id: messageId, nodeId, sender: { username: 'ligo_sender' }, storage: 'private' }],
      nextCursor: null,
    });
    await expect(api('/api/ligo/history/ligo_recipient?owner=self', {
      headers: senderAuthorization,
    }).then((response) => response.json())).resolves.toMatchObject({
      messages: [{ id: messageId, status: 'queued' }],
    });
    const acknowledged = await api(`/api/ligo/deliveries/${messageId}`, {
      headers: recipientAuthorization,
      method: 'DELETE',
    });
    expect(acknowledged.status).toBe(200);
    await expect(api('/api/ligo/inbox', { headers: recipientAuthorization }).then((response) => response.json()))
      .resolves.toEqual({ deliveries: [], nextCursor: null });
    await expect(api('/api/ligo/history/ligo_recipient?owner=self', {
      headers: senderAuthorization,
    }).then((response) => response.json())).resolves.toMatchObject({
      messages: [{ id: messageId, status: 'delivered' }],
    });
    const read = await api('/api/ligo/read', {
      body: JSON.stringify({ messageIds: [messageId] }),
      headers: { ...recipientAuthorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(read.status).toBe(200);
    await expect(api('/api/ligo/history/ligo_recipient?owner=self', {
      headers: senderAuthorization,
    }).then((response) => response.json())).resolves.toMatchObject({
      messages: [{ id: messageId, status: 'read' }],
    });

    const smallerWindow = await api('/api/ligo/storage', {
      body: JSON.stringify({ selectedNodeId: nodeId, stackLimitBytes: 1_048_576 }),
      headers: { ...senderAuthorization, 'content-type': 'application/json' },
      method: 'PATCH',
    });
    expect(smallerWindow.status).toBe(200);
    const retainedId = '223e4567-e89b-42d3-a456-426614174078';
    const newestId = '323e4567-e89b-42d3-a456-426614174079';
    for (const id of [retainedId, newestId]) {
      const response = await api('/api/ligo/deliveries', {
        body: JSON.stringify({
          id,
          nodeId,
          preview: `Cloud message ${id}`,
          recipientUsername: 'ligo_recipient',
          sizeBytes: 700_000,
          storage: 'private',
        }),
        headers: { ...senderAuthorization, 'content-type': 'application/json' },
        method: 'POST',
      });
      expect(response.status).toBe(201);
      if (id === newestId) {
        await expect(response.json()).resolves.toMatchObject({
          evicted: expect.arrayContaining([{ id: retainedId, nodeId, storage: 'private' }]),
          storage: { selectedNodeId: nodeId, stackLimitBytes: 1_048_576, stackUsedBytes: 700_000 },
        });
      }
    }
    const peerHistory = await api('/api/ligo/history/ligo_sender?owner=peer', {
      headers: recipientAuthorization,
    });
    await expect(peerHistory.json()).resolves.toMatchObject({
      messages: [{ id: newestId, sender: { username: 'ligo_sender' } }],
    });
    const cleanup = await api('/api/ligo/cloud-cleanup', {
      body: JSON.stringify({ messageIds: [messageId, retainedId] }),
      headers: { ...senderAuthorization, 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(cleanup.status).toBe(200);
    const senderTicketResponse = await api('/api/ligo/live-ticket', {
      headers: senderAuthorization,
      method: 'POST',
    });
    const { url: senderLiveUrl } = await senderTicketResponse.json<{ url: string }>();
    const senderTestLiveUrl = new URL(senderLiveUrl);
    senderTestLiveUrl.protocol = 'https:';
    const senderLiveResponse = await exports.default.fetch(senderTestLiveUrl, {
      headers: { upgrade: 'websocket' },
    });
    expect(senderLiveResponse.status).toBe(101);
    const senderLiveSocket = senderLiveResponse.webSocket!;
    senderLiveSocket.accept();
    const recipientOfflineSignal = new Promise<string>((resolve) => {
      senderLiveSocket.addEventListener('message', ({ data }) => resolve(String(data)), { once: true });
    });
    const liveClosed = new Promise<void>((resolve) => {
      liveSocket.addEventListener('close', () => resolve(), { once: true });
    });
    liveSocket.close(1000, 'Test complete.');
    await liveClosed;
    await expect(recipientOfflineSignal).resolves.toBe(JSON.stringify({
      online: false,
      type: 'presence',
      userId: recipientRegistrationBody.user.id,
    }));
    senderLiveSocket.close(1000, 'Test complete.');
    const offlineSearch = await api('/api/ligo/users?q=ligo_rec', { headers: senderAuthorization });
    await expect(offlineSearch.json()).resolves.toMatchObject({
      users: [{ online: false, username: 'ligo_recipient' }],
    });
  });
});

function api(pathname: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(
    `https://${['veri', 'dimensio-api'].join('')}.pshenychnyi-ld.workers.dev${pathname}`,
    init,
  );
}

async function post(
  pathname: string,
  body: Record<string, unknown>,
  deriveProof = true,
): Promise<Response> {
  const requestBody = deriveProof && typeof body.password === 'string' && typeof body.username === 'string'
    ? {
        ...body,
        password: undefined,
        passwordProof: await clientPasswordProof(body.username, body.password),
      }
    : body;
  return api(pathname, {
    body: JSON.stringify(requestBody),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
}

async function clientPasswordProof(username: string, password: string): Promise<string> {
  const normalizedUsername = username.trim().toLowerCase();
  const key = await crypto.subtle.importKey(
    'raw',
    arrayBuffer(utf8(password)),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const proof = await crypto.subtle.deriveBits(
    {
      hash: 'SHA-256',
      iterations: 600_000,
      name: 'PBKDF2',
      salt: arrayBuffer(utf8(`${['veri', 'dimensio:password:v1:'].join('')}${normalizedUsername}`)),
    },
    key,
    256,
  );
  return base64Url(proof);
}
