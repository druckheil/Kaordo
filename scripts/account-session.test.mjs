// Checks account publication, preview ownership and cancellation of obsolete bootstrap requests
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountSessionController, loadAccountSnapshot } from '../packages/account-ui/src/session.ts';

const environment = {
  VITE_KAORDO_AUTH_URL: 'http://localhost:8080',
  VITE_KAORDO_AUTH_REALM: 'kaordo',
  VITE_KAORDO_AUTH_CLIENT_ID: 'kaordo-web',
  VITE_KAORDO_API_URL: 'http://localhost:8081'
};
const user = { id: '019977a2-5c18-75e4-ab57-6d5f4bb515c8', username: 'tester' };

function capture(controller) {
  const snapshots = [];
  return { snapshots, refresh: () => controller.refresh((snapshot) => snapshots.push(snapshot)) };
}

for (const action of ['cancelPending', 'dispose']) {
  test(action + ' aborts the actual bootstrap request and retains no late account', async () => {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    let signal;
    const controller = createAccountSessionController(environment, {
      initializeAuth: async () => ({ authenticated: true }),
      bootstrapIdentity: async (_url, _auth, received) => new Promise((_resolve, reject) => {
        signal = received;
        received.addEventListener('abort', () => reject(received.reason), { once: true });
        started();
      }),
      rememberPreview: () => assert.fail('obsolete account cached')
    });
    const { snapshots, refresh } = capture(controller);
    const pending = refresh();
    await ready;
    controller[action]();
    await pending;
    assert.equal(signal.aborted, true);
    assert.equal(snapshots.length, 1);
  });
}

test('publishes a loading state before a resolved account', async () => {
  const controller = createAccountSessionController(environment, {
    initializeAuth: async () => ({ authenticated: true }),
    bootstrapIdentity: async () => user
  });
  const { snapshots, refresh } = capture(controller);
  await refresh();
  assert.deepEqual(snapshots[0], { loading: true, authenticated: false, user: null, error: null });
  assert.deepEqual(snapshots.at(-1), { loading: false, authenticated: true, user, error: null });
});

test('the single-shot resolver shares the gate account result', async () => {
  const snapshot = await loadAccountSnapshot(environment, {
    initializeAuth: async () => ({ authenticated: true }),
    bootstrapIdentity: async () => user
  });
  assert.deepEqual(snapshot, { loading: false, authenticated: true, user, error: null });
});

test('failed refresh immediately clears the previous account', async () => {
  let fail = false;
  const controller = createAccountSessionController(environment, {
    initializeAuth: async () => ({ authenticated: true }),
    bootstrapIdentity: async () => {
      if (fail) throw new Error('Account service unavailable');
      return user;
    }
  });
  const { snapshots, refresh } = capture(controller);
  await refresh();
  fail = true;
  const pending = refresh();
  assert.equal(snapshots.at(-1).user, null);
  await pending;
  assert.deepEqual(snapshots.at(-1), {
    loading: false, authenticated: true, user: null, error: 'Account service unavailable'
  });
});

test('a late response cannot overwrite a newer session', async () => {
  let resolveFirst;
  let calls = 0;
  const cachedUsernames = [];
  const controller = createAccountSessionController(environment, {
    initializeAuth: async () => ({ authenticated: true }),
    bootstrapIdentity: async () => ++calls === 1
      ? new Promise((resolve) => { resolveFirst = resolve; })
      : user,
    rememberPreview: (account) => cachedUsernames.push(account.username)
  });
  const { snapshots, refresh } = capture(controller);
  const first = refresh();
  await Promise.resolve();
  const second = refresh();
  await second;
  const count = snapshots.length;
  resolveFirst({ ...user, username: 'old' });
  await first;
  assert.equal(snapshots.length, count);
  assert.equal(snapshots.at(-1).user.username, 'tester');
  assert.deepEqual(cachedUsernames, ['tester']);
});

test('a cancelled account check cannot restore the preview after sign-out', async () => {
  let resolveIdentity;
  const cachedUsernames = [];
  const controller = createAccountSessionController(environment, {
    initializeAuth: async () => ({ authenticated: true }),
    bootstrapIdentity: async () => new Promise((resolve) => { resolveIdentity = resolve; }),
    rememberPreview: (account) => cachedUsernames.push(account.username)
  });
  const { snapshots, refresh } = capture(controller);
  const pending = refresh();
  await Promise.resolve();
  controller.cancelPending();
  resolveIdentity(user);
  await pending;
  assert.equal(snapshots.length, 1);
  assert.deepEqual(cachedUsernames, []);
});

test('disposed controllers do not publish late results', async () => {
  let resolveIdentity;
  const controller = createAccountSessionController(environment, {
    initializeAuth: async () => ({ authenticated: true }),
    bootstrapIdentity: async () => new Promise((resolve) => { resolveIdentity = resolve; })
  });
  const { snapshots, refresh } = capture(controller);
  const pending = refresh();
  await Promise.resolve();
  controller.dispose();
  resolveIdentity(user);
  await pending;
  assert.equal(snapshots.length, 1);
});

test('unauthenticated session has no account', async () => {
  const controller = createAccountSessionController(environment, {
    initializeAuth: async () => ({ authenticated: false }),
    bootstrapIdentity: async () => { throw new Error('Unexpected bootstrap'); }
  });
  const { snapshots, refresh } = capture(controller);
  await refresh();
  assert.deepEqual(snapshots.at(-1), { loading: false, authenticated: false, user: null, error: null });
});

test('missing API configuration produces a retryable error without an account', async () => {
  const { VITE_KAORDO_API_URL: _unused, ...missingApi } = environment;
  const controller = createAccountSessionController(missingApi, {
    initializeAuth: async () => ({ authenticated: true }),
    bootstrapIdentity: async () => { throw new Error('Unexpected bootstrap'); }
  });
  const { snapshots, refresh } = capture(controller);
  await refresh();
  assert.deepEqual(snapshots.at(-1), {
    loading: false, authenticated: true, user: null, error: 'The API is not configured.'
  });
});
