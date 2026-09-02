import type { AuthSession, AuthUser } from '../domain/auth';
import type { AuthGateway } from './AuthGateway';
import { browserFetch, decodeJsonResponse, requestJson } from './WebApiClient';

type UserResponse = { user: AuthUser };
type SeedResponse = { seedPhrase: string };
type SessionsResponse = { sessions: AuthSession[] };

export class WebAuthGateway implements AuthGateway {
  async currentUser(): Promise<AuthUser | null> {
    const response = await browserFetch('/api/auth/me');
    if (response.status === 401) return null;
    return (await decode<UserResponse>(response)).user;
  }

  login(username: string, password: string): Promise<AuthUser> {
    return this.authenticate('login', username, password);
  }

  register(username: string, password: string): Promise<AuthUser> {
    return this.authenticate('register', username, password);
  }

  async loginWithSeed(seedPhrase: string): Promise<AuthUser> {
    const normalized = normalizeSeedPhrase(seedPhrase);
    if (!normalized) throw new Error('Enter the complete seed phrase.');
    const result = await requestJson<UserResponse>('/api/auth/seed-login', {
      body: JSON.stringify({ seedPhrase: normalized }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }, AUTH_UNAVAILABLE);
    return result.user;
  }

  async issueSeed(): Promise<string> {
    const result = await requestJson<SeedResponse>('/api/auth/account/seed', {
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }, AUTH_UNAVAILABLE);
    if (!result.seedPhrase) throw new Error(AUTH_UNAVAILABLE);
    return result.seedPhrase;
  }

  async changeUsername(
    currentUsername: string,
    newUsername: string,
    currentPassword: string,
  ): Promise<AuthUser> {
    validateUsername(newUsername);
    validatePassword(currentPassword, false);
    const [passwordProof, newPasswordProof] = await Promise.all([
      derivePasswordProof(currentUsername, currentPassword),
      derivePasswordProof(newUsername, currentPassword),
    ]);
    const result = await requestJson<UserResponse>('/api/auth/account/username', {
      body: JSON.stringify({ newPasswordProof, passwordProof, username: newUsername }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }, AUTH_UNAVAILABLE);
    return result.user;
  }

  async changePassword(
    username: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    validatePassword(currentPassword, false);
    validatePassword(newPassword, true);
    const [currentPasswordProof, newPasswordProof] = await Promise.all([
      derivePasswordProof(username, currentPassword),
      derivePasswordProof(username, newPassword),
    ]);
    await requestJson<{ ok: boolean }>('/api/auth/account/password', {
      body: JSON.stringify({ currentPasswordProof, newPasswordProof }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }, AUTH_UNAVAILABLE);
  }

  async logout(): Promise<void> {
    await requestJson<{ ok: boolean }>(
      '/api/auth/logout',
      { method: 'POST' },
      AUTH_UNAVAILABLE,
    );
  }

  async presence(): Promise<void> {
    await requestJson<{ ok: boolean }>(
      '/api/auth/presence',
      { method: 'POST' },
      AUTH_UNAVAILABLE,
    );
  }

  async listSessions(): Promise<AuthSession[]> {
    const result = await requestJson<SessionsResponse>(
      '/api/auth/sessions',
      { cache: 'no-store' },
      AUTH_UNAVAILABLE,
    );
    return result.sessions;
  }

  async terminateSession(sessionId: string): Promise<void> {
    await requestJson<{ ok: boolean }>(
      `/api/auth/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' },
      AUTH_UNAVAILABLE,
    );
  }

  private async authenticate(
    path: 'login' | 'register',
    username: string,
    password: string,
  ): Promise<AuthUser> {
    validatePassword(password, path === 'register');
    const passwordProof = await derivePasswordProof(username, password);
    const result = await requestJson<UserResponse>(`/api/auth/${path}`, {
      body: JSON.stringify({ passwordProof, username }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }, AUTH_UNAVAILABLE);
    return result.user;
  }
}

async function derivePasswordProof(
  username: string,
  password: string,
): Promise<string> {
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    bytes.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const proof = await crypto.subtle.deriveBits(
    {
      hash: 'SHA-256',
      iterations: 600_000,
      name: 'PBKDF2',
      salt: bytes.encode(`${['veri', 'dimensio:password:v1:'].join('')}${username.trim().toLowerCase()}`),
    },
    key,
    256,
  );
  return base64Url(new Uint8Array(proof));
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function validateUsername(username: string) {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9_]{1,30}[a-z0-9])?$/u.test(normalized)) {
    throw new Error('Username must be 3–32 characters using letters, numbers, or inner underscores.');
  }
}

export function validatePassword(password: string, registration: boolean) {
  const length = [...password].length;
  const maximum = registration ? 32 : 128;
  if (length < 6 || length > maximum || new TextEncoder().encode(password).length > 256) {
    throw new Error(`Password must be 6–${maximum} characters.`);
  }
}

function normalizeSeedPhrase(value: string): string | null {
  const normalized = value.trim().toLowerCase().split(/\s+/u).join(' ');
  return /^(?:[0-9a-f]{8})(?: [0-9a-f]{8}){7}$/u.test(normalized)
    ? normalized
    : null;
}

async function decode<T>(response: Response): Promise<T> {
  return decodeJsonResponse(response, AUTH_UNAVAILABLE);
}

const AUTH_UNAVAILABLE = 'The authentication service is unavailable.';
