import type { AuthSession, AuthUser } from '../domain/auth';
import type { AuthGateway } from './AuthGateway';
import { browserFetch, decodeJsonResponse, requestJson } from './WebApiClient';

type UserResponse = { user: AuthUser };
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
    validatePassword(password);
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

function validatePassword(password: string) {
  const length = [...password].length;
  if (length < 12 || length > 128 || new TextEncoder().encode(password).length > 256) {
    throw new Error('Password must be 12–128 characters.');
  }
}

async function decode<T>(response: Response): Promise<T> {
  return decodeJsonResponse(response, AUTH_UNAVAILABLE);
}

const AUTH_UNAVAILABLE = 'The authentication service is unavailable.';
