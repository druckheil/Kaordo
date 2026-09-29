import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapIdentity } from '../packages/api-client/src/index.ts';
import { createAuthorizedFetch } from '../packages/auth/src/index.ts';

const user = { id: '0199a0c4-5a5f-7000-8000-000000000001', username: 'alice', displayName: 'alice', createdAt: '2026-09-29T00:00:00Z' };

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
