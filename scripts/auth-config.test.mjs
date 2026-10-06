// Checks Keycloak policy reconciliation, registration fields, and the shared identity theme
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { addPasswordConfirmation } from '../deploy/keycloak/themes/kaordo/login/resources/js/register.js';
import { restoreKeycloak, snapshotKeycloak, syncKeycloak, syncRealmSecurity, syncWebClientSecurity } from './sync-keycloak.mjs';

const root = resolve(import.meta.dirname, '..');
const realm = JSON.parse(readFileSync(resolve(root, 'deploy/keycloak/kaordo-realm.json'), 'utf8'));
const web = realm.clients.find((client) => client.clientId === 'kaordo-web');
const registrationProfile = JSON.parse(readFileSync(resolve(root, 'deploy/keycloak/registration-profile.json'), 'utf8'));
const adminBase = 'http://127.0.0.1:8080/admin/realms/kaordo';

test('Keycloak serves the same Deep Purple tokens as the shared UI', () => {
  const palette = readFileSync(resolve(root, 'packages/ui/src/lib/themes/deep-purple.css'), 'utf8');
  const generated = readFileSync(resolve(root, 'deploy/keycloak/themes/kaordo/login/resources/css/deep-purple.css'), 'utf8');
  assert.equal(generated.slice(generated.indexOf('\n') + 1), palette, 'Run node scripts/sync-theme.mjs after palette changes');
  const properties = readFileSync(resolve(root, 'deploy/keycloak/themes/kaordo/login/theme.properties'), 'utf8');
  assert.match(properties, /styles=.*css\/deep-purple\.css.*css\/kaordo\.css/);
  assert.match(properties, /scripts=js\/theme\.js/);
});

test('identity forms apply stored mode immediately and track system and other tabs', () => {
  const script = readFileSync(resolve(root, 'deploy/keycloak/themes/kaordo/login/resources/js/theme.js'), 'utf8');
  for (const [preference, systemDark, expected] of [
    ['light', true, false], ['dark', false, true], [null, true, true],
    ['system', false, false], ['invalid', true, true],
  ]) {
    let saved = preference;
    let dark;
    const listeners = {};
    const media = { matches: systemDark, addEventListener: (name, listener) => { listeners.system = listener; } };
    const html = { classList: { toggle: (name, value) => { assert.equal(name, 'dark'); dark = value; } }, style: {}, dataset: {} };
    runInNewContext(script, {
      URL,
      document: { documentElement: html },
      localStorage: { getItem: (key) => key === 'kaordo.color-mode' ? saved : null },
      window: {
        location: { href: 'http://localhost:8080/realms/kaordo/protocol/openid-connect/auth' },
        matchMedia: () => media, addEventListener: (name, listener) => { listeners[name] = listener; },
      },
    });
    assert.equal(dark, expected);
    assert.equal(html.style.colorScheme, expected ? 'dark' : 'light');
    assert.equal(html.dataset.theme, 'deep-purple');
    saved = 'dark';
    listeners.storage({ key: 'kaordo.color-mode' });
    assert.equal(dark, true);
    saved = null;
    listeners.storage({ key: 'kaordo.color-mode' });
    media.matches = false;
    listeners.system();
    assert.equal(dark, false);
    media.matches = true;
    listeners.storage({ key: null });
    assert.equal(dark, true, 'Clearing storage restores the system preference');
  }
});

test('identity forms use the system mode when preference storage is unavailable', () => {
  const script = readFileSync(resolve(root, 'deploy/keycloak/themes/kaordo/login/resources/js/theme.js'), 'utf8');
  let dark;
  runInNewContext(script, {
    URL,
    document: { documentElement: { classList: { toggle: (name, value) => { dark = value; } }, style: {}, dataset: {} } },
    localStorage: { getItem: () => { throw new Error('Storage is unavailable'); } },
    window: {
      location: { href: 'http://localhost:8080/realms/kaordo/protocol/openid-connect/auth' },
      matchMedia: () => ({ matches: true, addEventListener() {} }), addEventListener() {},
    },
  });
  assert.equal(dark, true);
});

// Existing client-mapper tests isolate that contract; realm policy has its own
// stateful tests below instead of making every unrelated mock emulate Keycloak.
function syncClient(config, fetcher) {
  const actions = realm.requiredActions.map((action) => ({ ...action }));
  const executions = ['OTP Form', 'Recovery Authentication Code Form'].map((displayName, index) =>
    ({ displayName, id: `execution-${index}`, requirement: 'ALTERNATIVE' }));
  return syncKeycloak(config, (url, options = {}) => {
    if (url === adminBase && !options.method) return Response.json({ ...realm, browserFlow: 'browser' });
    if (url === `${adminBase}/clients/web-id` && !options.method) return Response.json(web);
    if (url === `${adminBase}/authentication/required-actions` && !options.method) return Response.json(actions);
    if (url.startsWith(`${adminBase}/authentication/required-actions/`) && !options.method) {
      return Response.json(actions.find((action) => url.endsWith(`/${action.alias}`)));
    }
    if (url === `${adminBase}/authentication/flows/browser/executions` && !options.method) return Response.json(executions);
    return fetcher(url, options);
  });
}

test('web client uses PKCE, an API audience, and no password grant', () => {
  assert.equal(web.publicClient, true);
  assert.equal(web.standardFlowEnabled, true);
  assert.equal(web.implicitFlowEnabled, false);
  assert.equal(web.directAccessGrantsEnabled, false);
  assert.equal(web.attributes['pkce.code.challenge.method'], 'S256');
  assert.ok(web.defaultClientScopes.includes('basic'));
  assert.ok(web.defaultClientScopes.includes('profile'));
  assert.ok(web.protocolMappers.some((mapper) =>
    mapper.config['included.custom.audience'] === 'kerno-api' &&
    mapper.config['access.token.claim'] === 'true' &&
    mapper.config['id.token.claim'] === 'false'
  ));
  assert.ok(web.redirectUris.every((uri) => !uri.startsWith('*')));
});

test('local and production sessions renew for a month with short rotating tokens', () => {
  const production = JSON.parse(readFileSync(resolve(root, 'deploy/nixos/kaordo-realm.json'), 'utf8'));
  for (const policy of [realm, production]) {
    const day = 24 * 60 * 60;
    assert.equal(policy.rememberMe, true);
    assert.equal(policy.accessTokenLifespan, 5 * 60);
    assert.equal(policy.ssoSessionIdleTimeout, 30 * day);
    assert.equal(policy.ssoSessionIdleTimeoutRememberMe, 30 * day);
    assert.equal(policy.ssoSessionMaxLifespan, 5 * 365 * day);
    assert.equal(policy.ssoSessionMaxLifespanRememberMe, 5 * 365 * day);
    assert.equal(policy.clientSessionIdleTimeout, 0, 'Client idle inherits the realm policy');
    assert.equal(policy.clientSessionMaxLifespan, 0, 'Client maximum inherits the realm policy');
    assert.equal(policy.revokeRefreshToken, true);
    assert.equal(policy.refreshTokenMaxReuse, 0, 'Used refresh tokens must be rejected');
  }
});

test('native remembered sign-in defaults on and preserves opt-out through errors and unavailable storage', () => {
  const script = readFileSync(resolve(root, 'deploy/keycloak/themes/kaordo/login/resources/js/session.js'), 'utf8');
  for (const [preference, invalid, storageUnavailable, expected] of [
    [null, false, false, true], ['true', false, false, true], ['false', false, false, false],
    ['false', true, false, false], [null, true, true, false], [null, false, true, true]
  ]) {
    const listeners = {};
    const checkbox = { checked: false, addEventListener: (event, listener) => { listeners[event] = listener; } };
    const writes = [];
    runInNewContext(script, {
      document: {
        addEventListener: (event, listener) => { listeners[event] = listener; },
        querySelector: (selector) => selector.includes('aria-invalid') ? invalid : checkbox
      },
      localStorage: {
        getItem: () => { if (storageUnavailable) throw new Error('Blocked'); return preference; },
        setItem: (key, value) => { if (storageUnavailable) throw new Error('Blocked'); writes.push([key, value]); }
      }
    });
    listeners.DOMContentLoaded();
    assert.equal(checkbox.checked, expected);
    checkbox.checked = false;
    listeners.change();
    assert.deepEqual(writes, storageUnavailable ? [] : [['kaordo.stay-signed-in', 'false']]);
  }
});

test('web client security sync removes short session overrides and preserves unrelated attributes', async () => {
  let attributes = {
    ...web.attributes, 'pkce.code.challenge.method': 'plain', custom: 'keep',
    'access.token.lifespan': '7200', 'client.session.idle.timeout': '1800', 'client.session.max.lifespan': '7200'
  };
  const writes = [];
  const fetcher = async (url, options = {}) => {
    assert.equal(url, `${adminBase}/clients/web-id`);
    if (options.method === 'PUT') {
      const update = JSON.parse(options.body);
      writes.push(update);
      attributes = update.attributes;
      return new Response(null, { status: 204 });
    }
    return Response.json({ ...web, attributes });
  };
  await syncWebClientSecurity(fetcher, adminBase, {}, 'web-id', web);
  assert.deepEqual(attributes, { ...web.attributes, custom: 'keep' });
  await syncWebClientSecurity(fetcher, adminBase, {}, 'web-id', web);
  assert.equal(writes.length, 1, 'An unchanged web client must not be rewritten');
});

test('web client security sync rejects an ignored policy update', async () => {
  await assert.rejects(syncWebClientSecurity(async () => Response.json({
    ...web, attributes: { ...web.attributes, 'client.session.max.lifespan': '7200' }
  }), adminBase, {}, 'web-id', web), /did not apply the required web client security policy/);
});

test('production client reconciliation removes local redirects and restores PKCE login policy', async () => {
  const production = JSON.parse(readFileSync(resolve(root, 'deploy/nixos/kaordo-realm.json'), 'utf8').replaceAll('${KAORDO_SITE_ORIGIN}', 'https://kaordo.link'));
  const desired = production.clients.find((client) => client.clientId === 'kaordo-web');
  let current = { ...web, publicClient: false, standardFlowEnabled: false, directAccessGrantsEnabled: true };
  await syncWebClientSecurity(async (url, options = {}) => {
    if (options.method === 'PUT') { current = { ...current, ...JSON.parse(options.body) }; return new Response(null, { status: 204 }); }
    return Response.json(current);
  }, adminBase, {}, 'web-id', desired);
  assert.deepEqual(current.redirectUris, ['https://kaordo.link/*']);
  assert.deepEqual(current.webOrigins, ['https://kaordo.link']);
  assert.equal(current.publicClient, true);
  assert.equal(current.standardFlowEnabled, true);
  assert.equal(current.directAccessGrantsEnabled, false);
});

test('new users must configure TOTP before login completes', () => {
  assert.equal(realm.registrationAllowed, true);
  assert.equal(realm.otpPolicyType, 'totp');
  assert.ok(realm.requiredActions.some((action) =>
    action.providerId === 'CONFIGURE_TOTP' && action.enabled && action.defaultAction
  ));
  assert.ok(realm.requiredActions.some((action) =>
    action.providerId === 'CONFIGURE_RECOVERY_AUTHN_CODES' && action.enabled && action.defaultAction
  ));
});

test('registration profile exposes only username to the user', () => {
  assert.deepEqual(
    registrationProfile.attributes.filter((attribute) => attribute.permissions.edit.includes('user')).map((attribute) => attribute.name),
    ['username']
  );
  assert.deepEqual(registrationProfile.attributes.map((attribute) => attribute.name),
    ['username', 'email', 'firstName', 'lastName']);
  assert.ok(registrationProfile.attributes.every((attribute) => !attribute.required?.roles?.includes('user')));
  assert.ok(registrationProfile.attributes.find((attribute) => attribute.name === 'username').validations['username-prohibited-characters']);
});

test('registration template has one visible password input and supplies Keycloak confirmation in the request', () => {
  const template = readFileSync(resolve(root, 'deploy/keycloak/themes/kaordo/login/register.ftl'), 'utf8');
  assert.match(template, /<input type="password"[^>]*name="password"/);
  assert.match(template, /autocomplete="new-password"[\s\S]*?required \/>/,
    'New credentials are required and advertise the right browser autofill intent');
  assert.match(template, /aria-describedby="input-error-password"/,
    'Password validation text is associated with the invalid input');
  assert.match(template, /<label for="password"/, 'Password has an explicit label');
  assert.doesNotMatch(template, /<input[^>]*name="password-confirm"/);
  const payload = new FormData();
  addPasswordConfirmation(payload, 'example-password');
  assert.equal(payload.get('password-confirm'), 'example-password');
});

test('registration script attaches the confirmation to the submitted form data', async () => {
  const originalDocument = globalThis.document;
  let onFormData;
  globalThis.document = {
    getElementById(id) {
      if (id === 'password') return { value: 'submitted-password' };
      if (id === 'kc-register-form') return {
        addEventListener(eventName, listener) {
          assert.equal(eventName, 'formdata');
          onFormData = listener;
        }
      };
      return null;
    }
  };
  try {
    await import(`../deploy/keycloak/themes/kaordo/login/resources/js/register.js?binding-test=${Date.now()}`);
    const payload = new FormData();
    onFormData({ formData: payload });
    assert.equal(payload.get('password-confirm'), 'submitted-password');
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('local identity sync repairs an existing realm without replacing users', async () => {
  const calls = [];
  await syncClient({ KEYCLOAK_ADMIN_USERNAME: 'admin', KEYCLOAK_ADMIN_PASSWORD: 'test-only' }, async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return Response.json({ access_token: 'test-token' });
    if (url.endsWith('/clients?clientId=kaordo-web')) return Response.json([{ id: 'web-id', clientId: 'kaordo-web' }]);
    if (url.endsWith('/protocol-mappers/models') && options.method !== 'POST') return Response.json([]);
    if (url.endsWith('/default-client-scopes')) return Response.json([{ id: 'basic-id', name: 'basic' }, { id: 'profile-id', name: 'profile' }]);
    if (url.endsWith('/evaluate-scopes/protocol-mappers')) return Response.json([{ mapperName: 'kerno-api-audience', protocolMapper: 'oidc-audience-mapper' }]);
    if (url.includes('/users?max=1')) return Response.json([{ id: 'user-id' }]);
    if (url.includes('/generate-example-access-token?userId=user-id')) return Response.json({ aud: ['account', 'kerno-api'], sub: 'subject-1', preferred_username: 'alice' });
    return Response.json({});
  });
  assert.equal(calls.length, 9);
  assert.equal(calls[0].options.body.get('client_id'), 'admin-cli');
  assert.equal(calls[1].url, 'http://127.0.0.1:8080/admin/realms/kaordo/users/profile');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(calls[1].options.body), registrationProfile);
  assert.equal(calls[4].options.method, 'POST');
  assert.equal(calls[4].options.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(calls[4].options.body), web.protocolMappers.find((mapper) => mapper.name === 'kerno-api-audience'));
});

test('identity sync updates a stale audience mapper and leaves a correct one alone', async () => {
  const desired = web.protocolMappers.find((mapper) => mapper.name === 'kerno-api-audience');
  for (const stale of [true, false]) {
    const calls = [];
    await syncClient({ KEYCLOAK_ADMIN_USERNAME: 'admin', KEYCLOAK_ADMIN_PASSWORD: 'test-only' }, async (url, options) => {
      calls.push({ url, options });
      if (url.includes('/protocol/openid-connect/token')) return Response.json({ access_token: 'test-token' });
      if (url.endsWith('/clients?clientId=kaordo-web')) return Response.json([{ id: 'web-id', clientId: 'kaordo-web' }]);
      if (url.endsWith('/protocol-mappers/models')) return Response.json([
        { ...desired, id: 'mapper-id', config: stale ? { ...desired.config, 'included.custom.audience': 'old-audience' } : desired.config }
      ]);
      if (url.endsWith('/default-client-scopes')) return Response.json([{ id: 'basic-id', name: 'basic' }, { id: 'profile-id', name: 'profile' }]);
      if (url.endsWith('/evaluate-scopes/protocol-mappers')) return Response.json([{ mapperName: 'kerno-api-audience', protocolMapper: 'oidc-audience-mapper' }]);
      if (url.includes('/users?max=1')) return Response.json([]);
      return Response.json({});
    });
    assert.equal(calls.length, stale ? 8 : 7);
    if (stale) {
      assert.equal(calls[4].options.method, 'PUT');
      assert.ok(calls[4].url.endsWith('/protocol-mappers/models/mapper-id'));
      assert.equal(JSON.parse(calls[4].options.body).config['included.custom.audience'], 'kerno-api');
    }
  }
});

test('identity sync attaches basic and profile scopes to an existing client', async () => {
  const calls = [];
  await syncClient({ KEYCLOAK_ADMIN_USERNAME: 'admin', KEYCLOAK_ADMIN_PASSWORD: 'test-only' }, async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/protocol/openid-connect/token')) return Response.json({ access_token: 'test-token' });
    if (url.endsWith('/clients?clientId=kaordo-web')) return Response.json([{ id: 'web-id', clientId: 'kaordo-web' }]);
    if (url.endsWith('/protocol-mappers/models') && options.method !== 'POST') return Response.json([]);
    if (url.endsWith('/default-client-scopes')) return Response.json([]);
    if (url.endsWith('/client-scopes')) return Response.json([{ id: 'basic-id', name: 'basic' }, { id: 'profile-id', name: 'profile' }]);
    if (url.endsWith('/evaluate-scopes/protocol-mappers')) return Response.json([{ mapperName: 'kerno-api-audience', protocolMapper: 'oidc-audience-mapper' }]);
    if (url.includes('/users?max=1')) return Response.json([]);
    return Response.json({});
  });
  assert.ok(calls.some(({ url, options }) => url.endsWith('/default-client-scopes/basic-id') && options.method === 'PUT'));
  assert.ok(calls.some(({ url, options }) => url.endsWith('/default-client-scopes/profile-id') && options.method === 'PUT'));
});

test('identity sync repairs the missing basic scope without replacing an existing profile scope', async () => {
  const calls = [];
  await syncClient({ KEYCLOAK_ADMIN_USERNAME: 'admin', KEYCLOAK_ADMIN_PASSWORD: 'test-only' }, async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/protocol/openid-connect/token')) return Response.json({ access_token: 'test-token' });
    if (url.endsWith('/clients?clientId=kaordo-web')) return Response.json([{ id: 'web-id', clientId: 'kaordo-web' }]);
    if (url.endsWith('/protocol-mappers/models') && options.method !== 'POST') return Response.json([]);
    if (url.endsWith('/default-client-scopes')) return Response.json([{ id: 'profile-id', name: 'profile' }]);
    if (url.endsWith('/client-scopes')) return Response.json([{ id: 'basic-id', name: 'basic' }, { id: 'profile-id', name: 'profile' }]);
    if (url.endsWith('/evaluate-scopes/protocol-mappers')) return Response.json([{ mapperName: 'kerno-api-audience', protocolMapper: 'oidc-audience-mapper' }]);
    if (url.includes('/users?max=1')) return Response.json([]);
    return Response.json({});
  });
  assert.equal(calls.filter(({ url, options }) => url.endsWith('/default-client-scopes/basic-id') && options.method === 'PUT').length, 1);
  assert.equal(calls.filter(({ url, options }) => url.endsWith('/default-client-scopes/profile-id') && options.method === 'PUT').length, 0);
});

test('identity sync refuses to report success when the effective access token lacks Kerno audience', async () => {
  await assert.rejects(syncClient({ KEYCLOAK_ADMIN_USERNAME: 'admin', KEYCLOAK_ADMIN_PASSWORD: 'test-only' }, async (url, options) => {
    if (url.includes('/protocol/openid-connect/token')) return Response.json({ access_token: 'test-token' });
    if (url.endsWith('/clients?clientId=kaordo-web')) return Response.json([{ id: 'web-id', clientId: 'kaordo-web' }]);
    if (url.endsWith('/protocol-mappers/models') && options.method !== 'POST') return Response.json([]);
    if (url.endsWith('/default-client-scopes')) return Response.json([{ id: 'basic-id', name: 'basic' }, { id: 'profile-id', name: 'profile' }]);
    if (url.endsWith('/evaluate-scopes/protocol-mappers')) return Response.json([{ mapperName: 'kerno-api-audience', protocolMapper: 'oidc-audience-mapper' }]);
    if (url.includes('/users?max=1')) return Response.json([{ id: 'user-id' }]);
    if (url.includes('/generate-example-access-token?userId=user-id')) return Response.json({ aud: ['account'], sub: 'subject-1', preferred_username: 'alice' });
    return Response.json({});
  }), /still does not issue the kerno-api audience/);
});

test('identity sync rejects an effective token without a username', async () => {
  await assert.rejects(syncClient({ KEYCLOAK_ADMIN_USERNAME: 'admin', KEYCLOAK_ADMIN_PASSWORD: 'test-only' }, async (url, options) => {
    if (url.includes('/protocol/openid-connect/token')) return Response.json({ access_token: 'test-token' });
    if (url.endsWith('/clients?clientId=kaordo-web')) return Response.json([{ id: 'web-id', clientId: 'kaordo-web' }]);
    if (url.endsWith('/protocol-mappers/models') && options.method !== 'POST') return Response.json([]);
    if (url.endsWith('/default-client-scopes')) return Response.json([{ id: 'basic-id', name: 'basic' }, { id: 'profile-id', name: 'profile' }]);
    if (url.endsWith('/evaluate-scopes/protocol-mappers')) return Response.json([{ mapperName: 'kerno-api-audience', protocolMapper: 'oidc-audience-mapper' }]);
    if (url.includes('/users?max=1')) return Response.json([{ id: 'user-id' }]);
    if (url.includes('/generate-example-access-token?userId=user-id')) return Response.json({ aud: ['kerno-api'], sub: 'subject-1' });
    return Response.json({});
  }), /does not include preferred_username/);
});

test('identity sync rejects an effective token without a subject', async () => {
  await assert.rejects(syncClient({ KEYCLOAK_ADMIN_USERNAME: 'admin', KEYCLOAK_ADMIN_PASSWORD: 'test-only' }, async (url, options) => {
    if (url.includes('/protocol/openid-connect/token')) return Response.json({ access_token: 'test-token' });
    if (url.endsWith('/clients?clientId=kaordo-web')) return Response.json([{ id: 'web-id', clientId: 'kaordo-web' }]);
    if (url.endsWith('/protocol-mappers/models') && options.method !== 'POST') return Response.json([]);
    if (url.endsWith('/default-client-scopes')) return Response.json([{ id: 'basic-id', name: 'basic' }, { id: 'profile-id', name: 'profile' }]);
    if (url.endsWith('/evaluate-scopes/protocol-mappers')) return Response.json([{ mapperName: 'kerno-api-audience', protocolMapper: 'oidc-audience-mapper' }]);
    if (url.includes('/users?max=1')) return Response.json([{ id: 'user-id' }]);
    if (url.includes('/generate-example-access-token?userId=user-id')) return Response.json({ aud: ['kerno-api'], preferred_username: 'alice' });
    return Response.json({});
  }), /does not include sub/);
});

function securityMock({ missingRecoveryProvider = false, ignoreRealmUpdate = false } = {}) {
  let current = {
    ...realm, browserFlow: 'browser', unrelatedSetting: 'keep', bruteForceProtected: false,
    passwordPolicy: 'length(8)', otpPolicyType: 'hotp', rememberMe: false,
    accessTokenLifespan: 7200, ssoSessionIdleTimeout: 1800, ssoSessionMaxLifespan: 7200,
    ssoSessionIdleTimeoutRememberMe: 0, ssoSessionMaxLifespanRememberMe: 0,
    clientSessionIdleTimeout: 1800, clientSessionMaxLifespan: 7200, revokeRefreshToken: false
  };
  const actions = [{ ...realm.requiredActions[0], enabled: false, defaultAction: false }];
  const executions = ['OTP Form', 'Recovery Authentication Code Form'].map((displayName, index) =>
    ({ displayName, id: `execution-${index}`, requirement: 'DISABLED' }));
  const writes = [];
  const fetcher = async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method !== 'GET') writes.push({ url, method, body: JSON.parse(options.body) });
    if (url === adminBase) {
      if (method === 'PUT' && !ignoreRealmUpdate) current = { ...current, ...JSON.parse(options.body) };
      return method === 'GET' ? Response.json(current) : new Response(null, { status: 204 });
    }
    const actionsUrl = `${adminBase}/authentication/required-actions`;
    if (url === actionsUrl && method === 'GET') return Response.json(actions);
    if (url === `${adminBase}/authentication/unregistered-required-actions`) {
      return Response.json(missingRecoveryProvider ? [] : [
        { providerId: 'CONFIGURE_RECOVERY_AUTHN_CODES', name: 'Recovery Authentication Codes' }
      ]);
    }
    if (url === `${adminBase}/authentication/register-required-action` && method === 'POST') {
      const provider = JSON.parse(options.body);
      actions.push({ alias: provider.providerId, ...provider, enabled: false, defaultAction: false });
      return new Response(null, { status: 204 });
    }
    if (url.startsWith(`${actionsUrl}/`)) {
      const action = actions.find((item) => url.endsWith(`/${item.alias}`));
      if (!action) return new Response(null, { status: 404 });
      if (method === 'PUT') Object.assign(action, JSON.parse(options.body));
      return method === 'GET' ? Response.json(action) : new Response(null, { status: 204 });
    }
    const flowUrl = `${adminBase}/authentication/flows/browser/executions`;
    if (url === flowUrl) {
      if (method === 'PUT') {
        const update = JSON.parse(options.body);
        Object.assign(executions.find((item) => item.id === update.id), update);
      }
      return method === 'GET' ? Response.json(executions) : new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected policy request: ${method} ${url}`);
  };
  return { fetcher, writes, current: () => current, actions, executions };
}

test('realm security sync repairs short sessions, TOTP and recovery settings once', async () => {
  const mock = securityMock();
  await syncRealmSecurity(mock.fetcher, adminBase, { Authorization: 'Bearer test-token' }, realm);
  assert.equal(mock.current().bruteForceProtected, true);
  assert.equal(mock.current().passwordPolicy, 'length(12)');
  assert.equal(mock.current().otpPolicyType, 'totp');
  assert.equal(mock.current().rememberMe, true);
  assert.equal(mock.current().accessTokenLifespan, realm.accessTokenLifespan);
  assert.equal(mock.current().ssoSessionIdleTimeout, realm.ssoSessionIdleTimeout);
  assert.equal(mock.current().ssoSessionMaxLifespan, realm.ssoSessionMaxLifespan);
  assert.equal(mock.current().ssoSessionIdleTimeoutRememberMe, realm.ssoSessionIdleTimeoutRememberMe);
  assert.equal(mock.current().ssoSessionMaxLifespanRememberMe, realm.ssoSessionMaxLifespanRememberMe);
  assert.equal(mock.current().clientSessionIdleTimeout, 0);
  assert.equal(mock.current().clientSessionMaxLifespan, 0);
  assert.equal(mock.current().revokeRefreshToken, true);
  assert.equal(mock.current().unrelatedSetting, 'keep');
  assert.equal('unrelatedSetting' in mock.writes.find((write) => write.url === adminBase).body, false);
  assert.deepEqual(mock.actions.map(({ alias, enabled, defaultAction }) => ({ alias, enabled, defaultAction })),
    realm.requiredActions.map(({ alias, enabled, defaultAction }) => ({ alias, enabled, defaultAction })));
  assert.ok(mock.executions.every((execution) => execution.requirement === 'ALTERNATIVE'));
  const firstWrites = mock.writes.length;
  assert.ok(firstWrites >= 5);
  await syncRealmSecurity(mock.fetcher, adminBase, { Authorization: 'Bearer test-token' }, realm);
  assert.equal(mock.writes.length, firstWrites, 'an unchanged realm must not be rewritten');
});

test('realm security sync fails closed when recovery action is unavailable', async () => {
  const mock = securityMock({ missingRecoveryProvider: true });
  await assert.rejects(syncRealmSecurity(mock.fetcher, adminBase, {}, realm), /does not provide CONFIGURE_RECOVERY_AUTHN_CODES/);
});

test('realm security sync verifies effective policy after an ignored update', async () => {
  const mock = securityMock({ ignoreRealmUpdate: true });
  await assert.rejects(syncRealmSecurity(mock.fetcher, adminBase, {}, realm), /did not apply the required realm security policy/);
});

test('identity rollback restores observed policy, overrides, flows and scopes without user data or credentials', async () => {
  const mock = securityMock();
  let client = { ...web, attributes: { ...web.attributes, 'client.session.idle.timeout': '1800' } };
  let profile = { attributes: [{ name: 'username' }] };
  let scopes = [{ id: 'profile-id', name: 'profile' }];
  let mappers = [];
  const fetcher = async (url, options = {}) => {
    const method = options.method || 'GET';
    if (url.endsWith('/protocol/openid-connect/token')) return Response.json({ access_token: 'fixture-token' });
    if (url.endsWith('/clients?clientId=kaordo-web')) return Response.json([{ clientId: 'kaordo-web', id: 'web-id' }]);
    if (url === `${adminBase}/clients/web-id`) {
      if (method === 'PUT') { client = { ...client, ...JSON.parse(options.body) }; return new Response(null, { status: 204 }); }
      return Response.json(client);
    }
    if (url.endsWith('/users/profile')) {
      if (method === 'PUT') { profile = JSON.parse(options.body); return new Response(null, { status: 204 }); }
      return Response.json(profile);
    }
    if (url.endsWith('/protocol-mappers/models')) return Response.json(mappers);
    if (url.endsWith('/protocol-mappers/models/new-mapper') && method === 'DELETE') { mappers = []; return new Response(null, { status: 204 }); }
    if (url.endsWith('/default-client-scopes')) return Response.json(scopes);
    if (url.endsWith('/default-client-scopes/basic-id') && method === 'DELETE') { scopes = scopes.filter((item) => item.id !== 'basic-id'); return new Response(null, { status: 204 }); }
    return mock.fetcher(url, options);
  };
  const credential = { KEYCLOAK_ADMIN_USERNAME: 'admin', KEYCLOAK_ADMIN_PASSWORD: 'fixture-private-password' };
  const snapshot = await snapshotKeycloak(credential, fetcher);
  assert.doesNotMatch(JSON.stringify(snapshot), /fixture-token|fixture-private-password|unrelatedSetting/);
  await syncRealmSecurity(fetcher, adminBase, {}, realm);
  await syncWebClientSecurity(fetcher, adminBase, {}, 'web-id', web);
  scopes.push({ id: 'basic-id', name: 'basic' });
  mappers.push({ id: 'new-mapper', name: 'kerno-api-audience' });
  profile = registrationProfile;
  await restoreKeycloak(credential, snapshot, fetcher);
  assert.equal(mock.current().rememberMe, false);
  assert.equal(mock.current().ssoSessionIdleTimeout, 1800);
  assert.equal(client.attributes['client.session.idle.timeout'], '1800');
  assert.deepEqual(scopes, snapshot.scopes);
  assert.deepEqual(profile, snapshot.profile);
  assert.deepEqual(mappers, []);
  assert.ok(mock.executions.every((item) => item.requirement === 'DISABLED'));
  assert.ok(mock.actions.every((item) => !item.enabled && !item.defaultAction));
});
