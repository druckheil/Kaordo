import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { addPasswordConfirmation } from '../deploy/keycloak/themes/kaordo/login/resources/js/register.js';
import { syncKeycloak } from './sync-keycloak.mjs';

const root = resolve(import.meta.dirname, '..');
const realm = JSON.parse(readFileSync(resolve(root, 'deploy/keycloak/kaordo-realm.json'), 'utf8'));
const web = realm.clients.find((client) => client.clientId === 'kaordo-web');
const registrationProfile = JSON.parse(readFileSync(resolve(root, 'deploy/keycloak/registration-profile.json'), 'utf8'));

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

test('new users must configure TOTP before login completes', () => {
  assert.equal(realm.registrationAllowed, true);
  assert.equal(realm.otpPolicyType, 'totp');
  assert.ok(realm.requiredActions.some((action) =>
    action.providerId === 'CONFIGURE_TOTP' && action.enabled && action.defaultAction
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
  await syncKeycloak({ KEYCLOAK_ADMIN_USERNAME: 'admin', KEYCLOAK_ADMIN_PASSWORD: 'test-only' }, async (url, options) => {
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
    await syncKeycloak({ KEYCLOAK_ADMIN_USERNAME: 'admin', KEYCLOAK_ADMIN_PASSWORD: 'test-only' }, async (url, options) => {
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
  await syncKeycloak({ KEYCLOAK_ADMIN_USERNAME: 'admin', KEYCLOAK_ADMIN_PASSWORD: 'test-only' }, async (url, options) => {
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
  await syncKeycloak({ KEYCLOAK_ADMIN_USERNAME: 'admin', KEYCLOAK_ADMIN_PASSWORD: 'test-only' }, async (url, options) => {
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
  await assert.rejects(syncKeycloak({ KEYCLOAK_ADMIN_USERNAME: 'admin', KEYCLOAK_ADMIN_PASSWORD: 'test-only' }, async (url, options) => {
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
  await assert.rejects(syncKeycloak({ KEYCLOAK_ADMIN_USERNAME: 'admin', KEYCLOAK_ADMIN_PASSWORD: 'test-only' }, async (url, options) => {
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
  await assert.rejects(syncKeycloak({ KEYCLOAK_ADMIN_USERNAME: 'admin', KEYCLOAK_ADMIN_PASSWORD: 'test-only' }, async (url, options) => {
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
