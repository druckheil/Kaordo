// Verifies authenticated transport, abort boundaries and shared response/cache policies
import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapIdentity, createAdminApi, appendSentMessage, replaceCachedMessage } from '../packages/api-client/src/index.ts';
import { createAuthorizedFetch } from '../packages/auth/src/index.ts';

const user = { id: '0199a0c4-5a5f-7000-8000-000000000001', username: 'alice', displayName: 'alice', createdAt: '2026-09-29T00:00:00Z' };

test('an already aborted request neither refreshes credentials nor reaches the network', async () => {
  const signal = AbortSignal.abort();
  const fetcher = createAuthorizedFetch(async () => assert.fail('credentials requested after cancellation'),
    async () => assert.fail('network request after cancellation'));
  await assert.rejects(fetcher('https://example.test', { signal }), { name: 'AbortError' });
});

test('abort during token refresh prevents sending the authenticated request', async () => {
  const controller = new AbortController();
  const fetcher = createAuthorizedFetch(async () => { controller.abort(); return 'test-token'; },
    async () => assert.fail('network request after cancellation'));
  await assert.rejects(fetcher('https://example.test', { signal: controller.signal }), { name: 'AbortError' });
});

test('account setup forwards cancellation and never retries after cancellation', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(bootstrapIdentity('https://example.test', {
    fetch: async request => {
      calls++;
      assert.equal(request.signal.aborted, false);
      controller.abort();
      assert.equal(request.signal.aborted, true);
      return Response.json({ error: 'Expired token.' }, { status: 401 });
    },
    refresh: async () => assert.fail('credentials refreshed after cancellation')
  }, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('the OpenAPI client sends the access token as a bearer header', async () => {
  const result = await bootstrapIdentity('http://127.0.0.1:8081', {
    fetch: createAuthorizedFetch(async () => 'test-access-token', async (input) => {
      const request = new Request(input);
      assert.equal(request.method, 'POST');
      assert.equal(request.url, 'http://127.0.0.1:8081/v1/session');
      assert.equal(request.headers.get('Authorization'), 'Bearer test-access-token');
      return Response.json(user);
    }),
    refresh: async () => { throw new Error('a successful request must not refresh'); }
  });
  assert.deepEqual(result, user);
});

test('account setup refreshes and retries once after an unauthorized token', async () => {
  let calls = 0;
  let refreshes = 0;
  const result = await bootstrapIdentity('http://127.0.0.1:8081', {
    fetch: async (input) => {
      const request = new Request(input);
      assert.equal(request.url, 'http://127.0.0.1:8081/v1/session');
      calls++;
      return calls === 1 ? Response.json({ error: 'The session token is invalid or expired.' }, { status: 401 }) : Response.json(user);
    },
    refresh: async () => { refreshes++; }
  });
  assert.deepEqual(result, user);
  assert.equal(calls, 2);
  assert.equal(refreshes, 1);
});

test('account setup does not loop on repeated unauthorized responses', async () => {
  let calls = 0;
  let refreshes = 0;
  await assert.rejects(bootstrapIdentity('http://127.0.0.1:8081', {
    fetch: async () => {
      calls++;
      return Response.json({ error: 'The session token is invalid or expired.' }, { status: 401 });
    },
    refresh: async () => { refreshes++; }
  }), /Account setup failed \(401\)\. The session token is invalid or expired\./);
  assert.equal(calls, 2);
  assert.equal(refreshes, 1);
});

test('account setup includes the server reason after retrying the token', async () => {
  let calls = 0;
  await assert.rejects(bootstrapIdentity('http://127.0.0.1:8081', {
    fetch: async () => {
      calls++;
      return Response.json({ code: 'invalid_audience', error: 'The identity token is not valid for Kerno. Check the Keycloak API audience.' }, { status: 401 });
    },
    refresh: async () => {}
  }), /Account setup failed \(401\)\. The identity token is not valid for Kerno\. Check the Keycloak API audience\./);
  assert.equal(calls, 2);
});

test('account setup keeps the status when a proxy does not return JSON', async () => {
  await assert.rejects(bootstrapIdentity('http://127.0.0.1:8081', {
    fetch: async () => new Response('gateway error', { status: 502 }),
    refresh: async () => { throw new Error('refresh must not run'); }
  }), /Account setup failed \(502\)\./);
});

test('Regado uses contract parameters, cancellation and empty mutation responses', async () => {
  const controller = new AbortController();
  const calls = [];
  const api = createAdminApi('https://example.test', async (request) => {
    calls.push(request);
    if (request.method === 'PATCH') return Response.json({ ...user, isAdmin: false });
    return Response.json({ items: [], nextCursor: null });
  });
  await api.users('a&b', controller.signal);
  assert.equal(new URL(calls[0].url).searchParams.get('q'), 'a&b');
  await api.logs('service?&=', controller.signal);
  assert.equal(new URL(calls[1].url).searchParams.get('service'), 'service?&=');
  controller.abort();
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].signal.aborted, true);
  await api.setRole(user.id, false, 'Synthetic role change');
  assert.equal(calls[2].method, 'PATCH');
  assert.deepEqual(await calls[2].json(), { isAdmin: false, reason: 'Synthetic role change' });
});

test('Regado preserves server errors and HTTP status', async () => {
  const api = createAdminApi('https://example.test', async () => Response.json({ error: 'Administrator access required.' }, { status: 403 }));
  await assert.rejects(api.users(), /Administrator access required/);
});

test('shared message caches preserve pagination and idempotency', () => {
  const old = { id: 'old', clientId: 'client-old', text: 'before' };
  const sent = { id: 'new', clientId: 'client-new', text: 'after' };
  const original = { pages: [{ items: [old], nextCursor: 'older' }, { items: [], nextCursor: null }], pageParams: [undefined, 'older'] };
  const appended = appendSentMessage(original, sent);
  assert.deepEqual(appended.pages[0].items, [sent, old]);
  assert.equal(appended.pageParams, original.pageParams);
  assert.equal(appended.pages[1], original.pages[1]);
  assert.equal(appendSentMessage(appended, sent), appended);
  const replaced = replaceCachedMessage(appended, { ...old, text: 'edited' });
  assert.equal(replaced.pages[0].items[1].text, 'edited');
  assert.equal(original.pages[0].items[0].text, 'before');
  assert.equal(appendSentMessage(undefined, sent), undefined);
});
