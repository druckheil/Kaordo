import type Keycloak from 'keycloak-js';

export interface AuthConfig {
  url: string;
  realm: string;
  clientId: string;
}

export interface AuthSession {
  authenticated: boolean;
  subject?: string;
  username?: string;
}

let adapter: Keycloak | undefined;
let initialization: Promise<Keycloak> | undefined;

export function authConfigFromEnv(env: Record<string, string | undefined>): AuthConfig {
  const url = env.VITE_KAORDO_AUTH_URL;
  const realm = env.VITE_KAORDO_AUTH_REALM;
  const clientId = env.VITE_KAORDO_AUTH_CLIENT_ID;
  if (!url || !realm || !clientId) {
    throw new Error('Authentication is not configured. Set the VITE_KAORDO_AUTH_* variables.');
  }
  return { url, realm, clientId };
}

export async function initializeAuth(config: AuthConfig): Promise<AuthSession> {
  if (typeof window === 'undefined') throw new Error('Authentication requires a browser.');
  initialization ??= (async () => {
    const { default: KeycloakClient } = await import('keycloak-js');
    const instance = new KeycloakClient(config);
    await instance.init({
      onLoad: 'check-sso',
      pkceMethod: 'S256',
      checkLoginIframe: false
    });
    adapter = instance;
    return instance;
  })();
  let instance: Keycloak;
  try {
    instance = await initialization;
  } catch (error) {
    initialization = undefined;
    throw error;
  }
  return {
    authenticated: Boolean(instance.authenticated),
    subject: instance.tokenParsed?.sub,
    username: instance.tokenParsed?.preferred_username as string | undefined
  };
}

async function ready(): Promise<Keycloak> {
  if (!initialization) throw new Error('Authentication has not been initialized.');
  return initialization;
}

export async function signIn(redirectUri = window.location.href): Promise<void> {
  await (await ready()).login({ redirectUri });
}

export async function signUp(redirectUri = window.location.href): Promise<void> {
  await (await ready()).register({ redirectUri });
}

export async function signOut(redirectUri = window.location.origin + '/'): Promise<void> {
  await (await ready()).logout({ redirectUri });
}

export async function accessToken(): Promise<string> {
  const instance = adapter ?? (await ready());
  if (!instance.authenticated) throw new Error('Sign in to continue.');
  await instance.updateToken(30);
  if (!instance.token) throw new Error('The session has expired. Sign in again.');
  return instance.token;
}

export async function refreshAccessToken(): Promise<void> {
  const instance = adapter ?? (await ready());
  if (!instance.authenticated) throw new Error('Sign in to continue.');
  await instance.updateToken(-1);
  if (!instance.token) throw new Error('The session has expired. Sign in again.');
}

export function createAuthorizedFetch(
  getToken: () => Promise<string>,
  fetcher: typeof fetch = globalThis.fetch
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    request.headers.set('Authorization', `Bearer ${await getToken()}`);
    return fetcher(request);
  };
}

export const authorizedFetch = createAuthorizedFetch(accessToken);
