// Synchronizes local Keycloak settings with the repository configuration
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(import.meta.dirname, '..');

const securityFields = [
  'rememberMe', 'accessTokenLifespan', 'ssoSessionIdleTimeout', 'ssoSessionMaxLifespan',
  'ssoSessionIdleTimeoutRememberMe', 'ssoSessionMaxLifespanRememberMe',
  'clientSessionIdleTimeout', 'clientSessionMaxLifespan', 'revokeRefreshToken', 'refreshTokenMaxReuse',
  'registrationAllowed', 'registrationEmailAsUsername', 'loginWithEmailAllowed',
  'verifyEmail', 'resetPasswordAllowed', 'bruteForceProtected', 'failureFactor',
  'passwordPolicy', 'otpPolicyType', 'otpPolicyAlgorithm', 'otpPolicyDigits', 'otpPolicyPeriod'
];
const inheritedTokenAttributes = ['access.token.lifespan', 'client.session.idle.timeout', 'client.session.max.lifespan'];
const requiredFlowExecutions = ['OTP Form', 'Recovery Authentication Code Form'];

async function requireJSON(fetcher, url, headers, label) {
  const response = await fetcher(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Keycloak ${label} failed (${response.status}).`);
  return response.json();
}

async function requireUpdate(fetcher, url, headers, method, value, label) {
  const requestHeaders = { ...headers };
  const options = { method, headers: requestHeaders, signal: AbortSignal.timeout(10_000) };
  if (value !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
    options.body = JSON.stringify(value);
  }
  const response = await fetcher(url, options);
  if (!response.ok) throw new Error(`Keycloak ${label} failed (${response.status}).`);
}

function differsFrom(current, desired) {
  return Object.entries(desired).some(([field, value]) => current[field] !== value);
}

async function ensureRequiredAction(fetcher, adminBase, authorization, desiredAction) {
  const actionsUrl = `${adminBase}/authentication/required-actions`;
  const actionUrl = `${actionsUrl}/${encodeURIComponent(desiredAction.alias)}`;
  let actions = await requireJSON(fetcher, actionsUrl, authorization, 'required action lookup');
  let action = actions.find((item) => item.alias === desiredAction.alias);

  if (!action) {
    const availableUrl = `${adminBase}/authentication/unregistered-required-actions`;
    const available = await requireJSON(fetcher, availableUrl, authorization, 'available required action lookup');
    const provider = available.find((item) => item.providerId === desiredAction.providerId);
    if (!provider) throw new Error(`Keycloak does not provide ${desiredAction.alias}.`);
    await requireUpdate(fetcher, `${adminBase}/authentication/register-required-action`, authorization,
      'POST', provider, `${desiredAction.alias} registration`);

    actions = await requireJSON(fetcher, actionsUrl, authorization, 'registered action verification');
    action = actions.find((item) => item.alias === desiredAction.alias);
    if (!action) throw new Error(`Keycloak did not register ${desiredAction.alias}.`);
  }

  if (action.enabled !== desiredAction.enabled || action.defaultAction !== desiredAction.defaultAction) {
    await requireUpdate(fetcher, actionUrl, authorization, 'PUT', {
      ...action,
      enabled: desiredAction.enabled,
      defaultAction: desiredAction.defaultAction
    }, `${desiredAction.alias} policy update`);
  }

  const applied = await requireJSON(fetcher, actionUrl, authorization, `${desiredAction.alias} verification`);
  if (applied.enabled !== desiredAction.enabled || applied.defaultAction !== desiredAction.defaultAction) {
    throw new Error(`Keycloak did not apply ${desiredAction.alias} policy.`);
  }
}

async function ensureAlternativeFlowExecution(fetcher, flowUrl, authorization, displayName) {
  const executions = await requireJSON(fetcher, flowUrl, authorization, 'browser flow lookup');
  const execution = executions.find((item) => item.displayName === displayName);
  if (!execution?.id) throw new Error(`Keycloak browser flow is missing ${displayName}.`);

  if (execution.requirement !== 'ALTERNATIVE') {
    await requireUpdate(fetcher, flowUrl, authorization, 'PUT', {
      id: execution.id,
      requirement: 'ALTERNATIVE'
    }, `${displayName} flow update`);
  }

  const applied = await requireJSON(fetcher, flowUrl, authorization, `${displayName} flow verification`);
  if (applied.find((item) => item.id === execution.id)?.requirement !== 'ALTERNATIVE') {
    throw new Error(`Keycloak did not enable ${displayName}.`);
  }
}

export async function syncRealmSecurity(fetcher, adminBase, authorization, desiredRealm) {
  const current = await requireJSON(fetcher, adminBase, authorization, 'realm lookup');
  const desired = Object.fromEntries(securityFields.map((field) => [field, desiredRealm[field]]));
  if (differsFrom(current, desired)) {
    await requireUpdate(fetcher, adminBase, authorization, 'PUT', desired, 'realm policy update');
  }
  const actual = await requireJSON(fetcher, adminBase, authorization, 'realm policy verification');
  if (differsFrom(actual, desired)) {
    throw new Error('Keycloak did not apply the required realm security policy.');
  }

  for (const desiredAction of desiredRealm.requiredActions) {
    await ensureRequiredAction(fetcher, adminBase, authorization, desiredAction);
  }

  const flowUrl = `${adminBase}/authentication/flows/${encodeURIComponent(actual.browserFlow || 'browser')}/executions`;
  for (const displayName of requiredFlowExecutions) {
    await ensureAlternativeFlowExecution(fetcher, flowUrl, authorization, displayName);
  }
}

async function signInAsAdministrator(fetcher, identityOrigin, privateConfig) {
  const response = await fetcher(`${identityOrigin}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'admin-cli',
      grant_type: 'password',
      username: privateConfig.KEYCLOAK_ADMIN_USERNAME,
      password: privateConfig.KEYCLOAK_ADMIN_PASSWORD
    }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Keycloak administrator sign-in failed (${response.status}). Check deploy/local/.env.`);
  const { access_token: accessToken } = await response.json();
  if (!accessToken) throw new Error('Keycloak did not issue an administrator token.');
  return { Authorization: `Bearer ${accessToken}` };
}

async function findWebClient(fetcher, adminBase, authorization) {
  const clients = await requireJSON(fetcher, `${adminBase}/clients?clientId=kaordo-web`, authorization, 'client lookup');
  const clientId = clients.find((client) => client.clientId === 'kaordo-web')?.id;
  if (!clientId) throw new Error('The kaordo-web client is missing from Keycloak.');
  return clientId;
}

export async function syncWebClientSecurity(fetcher, adminBase, authorization, clientId, desiredClient) {
  const clientUrl = `${adminBase}/clients/${encodeURIComponent(clientId)}`;
  const current = await requireJSON(fetcher, clientUrl, authorization, 'web client policy lookup');
  const attributes = { ...current.attributes, ...desiredClient.attributes };
  for (const name of inheritedTokenAttributes) delete attributes[name];

  const needsUpdate = inheritedTokenAttributes.some((name) => name in (current.attributes ?? {})) ||
    differsFrom(current.attributes ?? {}, attributes);
  if (!needsUpdate) return;

  await requireUpdate(fetcher, clientUrl, authorization, 'PUT', { attributes }, 'web client policy update');
  const actual = await requireJSON(fetcher, clientUrl, authorization, 'web client policy verification');
  if (inheritedTokenAttributes.some((name) => name in (actual.attributes ?? {})) ||
      differsFrom(actual.attributes ?? {}, attributes)) {
    throw new Error('Keycloak did not apply the required web client security policy.');
  }
}

async function ensureAudienceMapper(fetcher, adminBase, authorization, clientId, desiredMapper) {
  const mapperUrl = `${adminBase}/clients/${encodeURIComponent(clientId)}/protocol-mappers/models`;
  const mappers = await requireJSON(fetcher, mapperUrl, authorization, 'mapper lookup');
  const existing = mappers.find((mapper) => mapper.name === desiredMapper.name);
  const mapperIsCurrent = existing && existing.protocolMapper === desiredMapper.protocolMapper &&
    Object.entries(desiredMapper.config).every(([key, value]) => existing.config?.[key] === value);
  if (mapperIsCurrent) return;
  if (existing && !existing.id) throw new Error('The existing Keycloak audience mapper has no ID.');

  const updateUrl = existing ? `${mapperUrl}/${encodeURIComponent(existing.id)}` : mapperUrl;
  const method = existing ? 'PUT' : 'POST';
  const value = existing ? { ...desiredMapper, id: existing.id } : desiredMapper;
  await requireUpdate(fetcher, updateUrl, authorization, method, value, 'Kerno audience mapper');
}

async function ensureDefaultScopes(fetcher, adminBase, authorization, clientId) {
  const clientUrl = `${adminBase}/clients/${encodeURIComponent(clientId)}`;
  const assigned = await requireJSON(fetcher, `${clientUrl}/default-client-scopes`, authorization, 'default scope lookup');
  const missingNames = ['basic', 'profile'].filter((name) => !assigned.some((scope) => scope.name === name));
  if (missingNames.length === 0) return;

  const available = await requireJSON(fetcher, `${adminBase}/client-scopes`, authorization, 'client scope lookup');
  for (const name of missingNames) {
    const scopeId = available.find((scope) => scope.name === name)?.id;
    if (!scopeId) throw new Error(`The Keycloak ${name} scope is missing.`);
    await requireUpdate(fetcher, `${clientUrl}/default-client-scopes/${encodeURIComponent(scopeId)}`,
      authorization, 'PUT', undefined, `${name} scope`);
  }
}

async function verifyEffectiveAudienceMapper(fetcher, adminBase, authorization, clientId, desiredMapper) {
  const url = `${adminBase}/clients/${encodeURIComponent(clientId)}/evaluate-scopes/protocol-mappers`;
  const effective = await requireJSON(fetcher, url, authorization, 'effective protocol mapper lookup');
  const isEffective = effective.some((mapper) =>
    mapper.mapperName === desiredMapper.name && mapper.protocolMapper === desiredMapper.protocolMapper);
  if (!isEffective) throw new Error('The Kerno audience mapper is not effective for kaordo-web access tokens.');
}

async function verifyExampleTokenClaims(fetcher, adminBase, authorization, clientId) {
  const users = await requireJSON(fetcher, `${adminBase}/users?max=1&briefRepresentation=true`, authorization, 'user lookup');
  const userId = users[0]?.id;
  if (!userId) return;

  const tokenUrl = `${adminBase}/clients/${encodeURIComponent(clientId)}/evaluate-scopes/generate-example-access-token?userId=${encodeURIComponent(userId)}`;
  const example = await requireJSON(fetcher, tokenUrl, authorization, 'example access token lookup');
  const audiences = Array.isArray(example.aud) ? example.aud : [example.aud];
  if (!audiences.includes('kerno-api')) {
    throw new Error('Keycloak still does not issue the kerno-api audience for kaordo-web. Check its effective client scopes and audience mapper.');
  }
  if (typeof example.sub !== 'string' || !example.sub.trim()) {
    throw new Error('Keycloak does not include sub in the web client access token. Check its basic scope.');
  }
  if (typeof example.preferred_username !== 'string' || !example.preferred_username.trim()) {
    throw new Error('Keycloak does not include preferred_username in the web client access token. Check its profile scope.');
  }
}

export async function syncKeycloak(privateConfig, fetcher = fetch, identityOrigin = 'http://127.0.0.1:8080') {
  const authorization = await signInAsAdministrator(fetcher, identityOrigin, privateConfig);

  const profileJson = await readFile(resolve(root, 'deploy/keycloak/registration-profile.json'), 'utf8');
  const response = await fetcher(`${identityOrigin}/admin/realms/kaordo/users/profile`, {
    method: 'PUT',
    headers: { ...authorization, 'Content-Type': 'application/json' },
    body: profileJson,
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Keycloak rejected the registration profile (${response.status}).`);

  const realm = JSON.parse(await readFile(resolve(root, 'deploy/keycloak/kaordo-realm.json'), 'utf8'));
  const webClient = realm.clients.find((client) => client.clientId === 'kaordo-web');
  const desiredMapper = webClient?.protocolMappers?.find((mapper) => mapper.name === 'kerno-api-audience');
  if (!desiredMapper) throw new Error('The Kerno audience mapper is missing from the realm configuration.');
  const adminBase = `${identityOrigin}/admin/realms/kaordo`;
  const clientId = await findWebClient(fetcher, adminBase, authorization);
  await syncWebClientSecurity(fetcher, adminBase, authorization, clientId, webClient);
  await ensureAudienceMapper(fetcher, adminBase, authorization, clientId, desiredMapper);
  await ensureDefaultScopes(fetcher, adminBase, authorization, clientId);
  await verifyEffectiveAudienceMapper(fetcher, adminBase, authorization, clientId, desiredMapper);
  await verifyExampleTokenClaims(fetcher, adminBase, authorization, clientId);
  await syncRealmSecurity(fetcher, adminBase, authorization, realm);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const privateConfig = parseEnv(await readFile(resolve(root, 'deploy/local/.env'), 'utf8'));
    await syncKeycloak(privateConfig);
    console.log('Keycloak session, registration, TOTP/recovery, basic/profile scopes, and Kerno audience policies are configured.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
