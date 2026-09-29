import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(import.meta.dirname, '..');

const securityFields = [
  'registrationAllowed', 'registrationEmailAsUsername', 'loginWithEmailAllowed',
  'verifyEmail', 'resetPasswordAllowed', 'bruteForceProtected', 'failureFactor',
  'passwordPolicy', 'otpPolicyType', 'otpPolicyAlgorithm', 'otpPolicyDigits', 'otpPolicyPeriod'
];

async function requireJSON(fetcher, url, headers, label) {
  const response = await fetcher(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Keycloak ${label} failed (${response.status}).`);
  return response.json();
}

async function requireUpdate(fetcher, url, headers, method, value, label) {
  const response = await fetcher(url, {
    method,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Keycloak ${label} failed (${response.status}).`);
}

export async function syncRealmSecurity(fetcher, adminBase, authorization, desiredRealm) {
  const current = await requireJSON(fetcher, adminBase, authorization, 'realm lookup');
  const desired = Object.fromEntries(securityFields.map((field) => [field, desiredRealm[field]]));
  if (Object.entries(desired).some(([field, value]) => current[field] !== value)) {
    await requireUpdate(fetcher, adminBase, authorization, 'PUT', desired, 'realm policy update');
  }
  const actual = await requireJSON(fetcher, adminBase, authorization, 'realm policy verification');
  if (Object.entries(desired).some(([field, value]) => actual[field] !== value)) {
    throw new Error('Keycloak did not apply the required realm security policy.');
  }

  const actionsUrl = `${adminBase}/authentication/required-actions`;
  for (const desiredAction of desiredRealm.requiredActions) {
    let actions = await requireJSON(fetcher, actionsUrl, authorization, 'required action lookup');
    let action = actions.find((item) => item.alias === desiredAction.alias);
    if (!action) {
      const unregistered = await requireJSON(fetcher, `${adminBase}/authentication/unregistered-required-actions`, authorization, 'available required action lookup');
      const provider = unregistered.find((item) => item.providerId === desiredAction.providerId);
      if (!provider) throw new Error(`Keycloak does not provide ${desiredAction.alias}.`);
      await requireUpdate(fetcher, `${adminBase}/authentication/register-required-action`, authorization, 'POST', provider, `${desiredAction.alias} registration`);
      actions = await requireJSON(fetcher, actionsUrl, authorization, 'registered action verification');
      action = actions.find((item) => item.alias === desiredAction.alias);
      if (!action) throw new Error(`Keycloak did not register ${desiredAction.alias}.`);
    }
    if (action.enabled !== desiredAction.enabled || action.defaultAction !== desiredAction.defaultAction) {
      await requireUpdate(fetcher, `${actionsUrl}/${encodeURIComponent(desiredAction.alias)}`, authorization, 'PUT',
        { ...action, enabled: desiredAction.enabled, defaultAction: desiredAction.defaultAction }, `${desiredAction.alias} policy update`);
    }
    const applied = await requireJSON(fetcher, `${actionsUrl}/${encodeURIComponent(desiredAction.alias)}`, authorization, `${desiredAction.alias} verification`);
    if (applied.enabled !== desiredAction.enabled || applied.defaultAction !== desiredAction.defaultAction) {
      throw new Error(`Keycloak did not apply ${desiredAction.alias} policy.`);
    }
  }

  const flowUrl = `${adminBase}/authentication/flows/${encodeURIComponent(actual.browserFlow || 'browser')}/executions`;
  for (const displayName of ['OTP Form', 'Recovery Authentication Code Form']) {
    const executions = await requireJSON(fetcher, flowUrl, authorization, 'browser flow lookup');
    const execution = executions.find((item) => item.displayName === displayName);
    if (!execution?.id) throw new Error(`Keycloak browser flow is missing ${displayName}.`);
    if (execution.requirement !== 'ALTERNATIVE') {
      await requireUpdate(fetcher, flowUrl, authorization, 'PUT',
        { id: execution.id, requirement: 'ALTERNATIVE' }, `${displayName} flow update`);
    }
    const verified = await requireJSON(fetcher, flowUrl, authorization, `${displayName} flow verification`);
    if (verified.find((item) => item.id === execution.id)?.requirement !== 'ALTERNATIVE') {
      throw new Error(`Keycloak did not enable ${displayName}.`);
    }
  }
}

export async function syncKeycloak(privateConfig, fetcher = fetch, identityOrigin = 'http://127.0.0.1:8080') {
  const tokenResponse = await fetcher(`${identityOrigin}/realms/master/protocol/openid-connect/token`, {
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
  if (!tokenResponse.ok) throw new Error(`Keycloak administrator sign-in failed (${tokenResponse.status}). Check deploy/local/.env.`);
  const { access_token: accessToken } = await tokenResponse.json();
  if (!accessToken) throw new Error('Keycloak did not issue an administrator token.');

  const profileJson = await readFile(resolve(root, 'deploy/keycloak/registration-profile.json'), 'utf8');
  const response = await fetcher(`${identityOrigin}/admin/realms/kaordo/users/profile`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: profileJson,
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Keycloak rejected the registration profile (${response.status}).`);

  const realm = JSON.parse(await readFile(resolve(root, 'deploy/keycloak/kaordo-realm.json'), 'utf8'));
  const webClient = realm.clients.find((client) => client.clientId === 'kaordo-web');
  const desiredMapper = webClient?.protocolMappers?.find((mapper) => mapper.name === 'kerno-api-audience');
  if (!desiredMapper) throw new Error('The Kerno audience mapper is missing from the realm configuration.');
  const adminBase = `${identityOrigin}/admin/realms/kaordo`;
  const authorization = { Authorization: `Bearer ${accessToken}` };
  const clientsResponse = await fetcher(`${adminBase}/clients?clientId=kaordo-web`, {
    headers: authorization,
    signal: AbortSignal.timeout(10_000)
  });
  if (!clientsResponse.ok) throw new Error(`Keycloak client lookup failed (${clientsResponse.status}).`);
  const clients = await clientsResponse.json();
  const clientId = clients.find((client) => client.clientId === 'kaordo-web')?.id;
  if (!clientId) throw new Error('The kaordo-web client is missing from Keycloak.');

  const mapperUrl = `${adminBase}/clients/${encodeURIComponent(clientId)}/protocol-mappers/models`;
  const mappersResponse = await fetcher(mapperUrl, {
    headers: authorization,
    signal: AbortSignal.timeout(10_000)
  });
  if (!mappersResponse.ok) throw new Error(`Keycloak mapper lookup failed (${mappersResponse.status}).`);
  const mappers = await mappersResponse.json();
  const existing = mappers.find((mapper) => mapper.name === desiredMapper.name);
  const mapperCurrent = existing && existing.protocolMapper === desiredMapper.protocolMapper &&
    Object.entries(desiredMapper.config).every(([key, value]) => existing.config?.[key] === value);
  if (!mapperCurrent) {
    if (existing && !existing.id) throw new Error('The existing Keycloak audience mapper has no ID.');
    const updateUrl = existing ? `${mapperUrl}/${encodeURIComponent(existing.id)}` : mapperUrl;
    const mapperResponse = await fetcher(updateUrl, {
      method: existing ? 'PUT' : 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(existing ? { ...desiredMapper, id: existing.id } : desiredMapper),
      signal: AbortSignal.timeout(10_000)
    });
    if (!mapperResponse.ok) throw new Error(`Keycloak rejected the Kerno audience mapper (${mapperResponse.status}).`);
  }

  const scopesResponse = await fetcher(`${adminBase}/clients/${encodeURIComponent(clientId)}/default-client-scopes`, {
    headers: authorization,
    signal: AbortSignal.timeout(10_000)
  });
  if (!scopesResponse.ok) throw new Error(`Keycloak default scope lookup failed (${scopesResponse.status}).`);
  const assignedScopes = await scopesResponse.json();
  const requiredScopes = ['basic', 'profile'];
  const missingScopes = requiredScopes.filter((name) => !assignedScopes.some((scope) => scope.name === name));
  if (missingScopes.length > 0) {
    const availableResponse = await fetcher(`${adminBase}/client-scopes`, {
      headers: authorization,
      signal: AbortSignal.timeout(10_000)
    });
    if (!availableResponse.ok) throw new Error(`Keycloak client scope lookup failed (${availableResponse.status}).`);
    const availableScopes = await availableResponse.json();
    for (const name of missingScopes) {
      const scopeId = availableScopes.find((scope) => scope.name === name)?.id;
      if (!scopeId) throw new Error(`The Keycloak ${name} scope is missing.`);
      const attachResponse = await fetcher(`${adminBase}/clients/${encodeURIComponent(clientId)}/default-client-scopes/${encodeURIComponent(scopeId)}`, {
        method: 'PUT',
        headers: authorization,
        signal: AbortSignal.timeout(10_000)
      });
      if (!attachResponse.ok) throw new Error(`Keycloak rejected the ${name} scope (${attachResponse.status}).`);
    }
  }

  // A direct mapper can exist without being effective for issued tokens.
  const effectiveResponse = await fetcher(`${adminBase}/clients/${encodeURIComponent(clientId)}/evaluate-scopes/protocol-mappers`, {
    headers: authorization,
    signal: AbortSignal.timeout(10_000)
  });
  if (!effectiveResponse.ok) throw new Error(`Keycloak could not evaluate the web client's protocol mappers (${effectiveResponse.status}).`);
  const effectiveMappers = await effectiveResponse.json();
  if (!effectiveMappers.some((mapper) => mapper.mapperName === desiredMapper.name && mapper.protocolMapper === desiredMapper.protocolMapper)) {
    throw new Error('The Kerno audience mapper is not effective for kaordo-web access tokens.');
  }

  // Keycloak's example-token endpoint needs a userId even though its REST
  // documentation marks that parameter optional. There is no user yet on the
  // first startup, so evaluate a real user's token shape when one exists.
  const usersResponse = await fetcher(`${adminBase}/users?max=1&briefRepresentation=true`, {
    headers: authorization,
    signal: AbortSignal.timeout(10_000)
  });
  if (!usersResponse.ok) throw new Error(`Keycloak user lookup failed (${usersResponse.status}).`);
  const userId = (await usersResponse.json())[0]?.id;
  if (userId) {
    const exampleResponse = await fetcher(`${adminBase}/clients/${encodeURIComponent(clientId)}/evaluate-scopes/generate-example-access-token?userId=${encodeURIComponent(userId)}`, {
      headers: authorization,
      signal: AbortSignal.timeout(10_000)
    });
    if (!exampleResponse.ok) throw new Error(`Keycloak could not evaluate the web client's access token (${exampleResponse.status}).`);
    const example = await exampleResponse.json();
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

  await syncRealmSecurity(fetcher, adminBase, authorization, realm);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const privateConfig = parseEnv(await readFile(resolve(root, 'deploy/local/.env'), 'utf8'));
    await syncKeycloak(privateConfig);
    console.log('Keycloak registration, TOTP/recovery, basic/profile scopes, and Kerno audience are configured.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
