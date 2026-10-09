// Initializes Keycloak and exposes the shared browser session and request helpers

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

let initialization: Promise<Keycloak> | undefined;

export function authConfigFromEnv(env: Record<string, string | undefined>): AuthConfig {
	const config = {
		url: env.VITE_KAORDO_AUTH_URL,
		realm: env.VITE_KAORDO_AUTH_REALM,
		clientId: env.VITE_KAORDO_AUTH_CLIENT_ID
	};

	if (!config.url || !config.realm || !config.clientId) {
		throw new Error('Authentication is not configured. Set the VITE_KAORDO_AUTH_* variables.');
	}

	return { url: config.url, realm: config.realm, clientId: config.clientId };
}

export async function initializeAuth(config: AuthConfig): Promise<AuthSession> {
	requireBrowser();

	const pending = initialization ?? createInitializedClient(config);
	initialization = pending;

	try {
		return toAuthSession(await pending);
	} catch (error) {
		if (initialization === pending) initialization = undefined;
		throw error;
	}
}

export async function createAuthenticationUrl(
	config: AuthConfig,
	action: 'login' | 'register',
	redirectUri: string
): Promise<string> {
	requireBrowser();
	const client = await createInitializedClient(config, false);
	const options = { redirectUri };
	return action === 'register' ? client.createRegisterUrl(options) : client.createLoginUrl(options);
}

export async function signIn(redirectUri?: string): Promise<void> {
	const client = await ready();
	await client.login({ redirectUri: redirectUri ?? currentPageUrl() });
}

export async function signUp(redirectUri?: string): Promise<void> {
	const client = await ready();
	await client.register({ redirectUri: redirectUri ?? currentPageUrl() });
}

export async function signOut(redirectUri?: string): Promise<void> {
	const client = await ready();
	await client.logout({ redirectUri: redirectUri ?? applicationHomeUrl() });
}

export async function accessToken(): Promise<string> {
	return updateAuthenticatedToken(30);
}

export async function refreshAccessToken(): Promise<void> {
	await updateAuthenticatedToken(-1);
}

export function createAuthorizedFetch(
	getToken: () => Promise<string>,
	fetcher: typeof fetch = globalThis.fetch
): typeof fetch {
	return async (input, init) => {
		const request = new Request(input, init);
		request.signal.throwIfAborted();
		request.headers.set('Authorization', `Bearer ${await getToken()}`);
		request.signal.throwIfAborted();
		return fetcher(request);
	};
}

export const authorizedFetch = createAuthorizedFetch(accessToken);

async function createInitializedClient(config: AuthConfig, checkSession = true): Promise<Keycloak> {
	const { default: KeycloakClient } = await import('keycloak-js');
	const client = new KeycloakClient(config);

	await client.init({
		pkceMethod: 'S256',
		checkLoginIframe: false,
		...(checkSession
			? {
					onLoad: 'check-sso' as const,
					silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`
				}
			: {})
	});

	return client;
}

function toAuthSession(client: Keycloak): AuthSession {
	const username: unknown = client.tokenParsed?.preferred_username;
	return {
		authenticated: client.authenticated,
		subject: client.tokenParsed?.sub,
		username: typeof username === 'string' ? username : undefined
	};
}

async function ready(): Promise<Keycloak> {
	if (!initialization) throw new Error('Authentication has not been initialized.');
	return initialization;
}

async function updateAuthenticatedToken(minValidity: number): Promise<string> {
	const client = await ready();
	if (!client.authenticated) throw new Error('Sign in to continue.');

	await client.updateToken(minValidity);
	if (!client.token) throw new Error('The session has expired. Sign in again.');
	return client.token;
}

function requireBrowser(): void {
	if (typeof window === 'undefined') throw new Error('Authentication requires a browser.');
}

function currentPageUrl(): string {
	requireBrowser();
	return window.location.href;
}

function applicationHomeUrl(): string {
	requireBrowser();
	return `${window.location.origin}/`;
}
