import type { Env } from '../env';
import { json } from '../http/json';
import {
  createSession,
  createUserAndSession,
  deleteSession,
  findUserByUsername,
  listSessionSummaries,
  publicUser,
  terminateSessionForUser,
} from './database';
import { base64Url, base64UrlBytes } from './encoding';
import { hashPassword, verifyPassword } from './password';
import { enforceAuthRateLimit, RateLimitError } from './rateLimit';
import {
  authenticate,
  createSessionToken,
  expiredSessionCookie,
  sessionCookie,
  unixNow,
} from './session';
import {
  ACCOUNT_STATUS_ACTIVE,
  CLIENT_DESKTOP,
  CLIENT_WEB,
  type AuthClientKind,
  type PublicUser,
} from './types';
import { InputError, readCredentials } from './validation';

const GENERIC_LOGIN_ERROR = 'Username or password is incorrect.';

export async function register(request: Request, env: Env, clientKind: AuthClientKind): Promise<Response> {
  try {
    const credentials = await readCredentials(request);
    await enforceAuthRateLimit(request, env, credentials.normalizedUsername);
    const [password, session] = await Promise.all([
      hashPassword(credentials.passwordProof),
      createSessionToken(),
    ]);
    const createdAt = unixNow();
    const user = await createUserAndSession(env.DB, {
      clientKind,
      createdAt,
      deviceName: clientKind === CLIENT_DESKTOP ? credentials.deviceName : null,
      displayUsername: credentials.displayUsername,
      password,
      tokenHash: session.tokenHash,
      username: credentials.normalizedUsername,
    });
    return authenticatedResponse(request, user, session.token, clientKind, 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return json({ error: 'Username is unavailable.' }, 409);
    }
    return authErrorResponse(error);
  }
}

export async function login(request: Request, env: Env, clientKind: AuthClientKind): Promise<Response> {
  try {
    const credentials = await readCredentials(request);
    await enforceAuthRateLimit(request, env, credentials.normalizedUsername);
    const user = await findUserByUsername(env.DB, credentials.normalizedUsername);
    const verified = await verifyPassword(
      credentials.passwordProof,
      user
        ? {
            algorithm: user.password_algorithm,
            hash: new Uint8Array(user.password_hash),
            iterations: user.password_iterations,
            salt: new Uint8Array(user.password_salt),
          }
        : null,
    );
    if (!verified || !user || user.status !== ACCOUNT_STATUS_ACTIVE) {
      return json({ error: GENERIC_LOGIN_ERROR }, 401);
    }

    const session = await createSessionToken();
    await createSession(env.DB, {
      clientKind,
      createdAt: unixNow(),
      deviceName: clientKind === CLIENT_DESKTOP ? credentials.deviceName : null,
      tokenHash: session.tokenHash,
      userId: user.id,
    });
    return authenticatedResponse(request, publicUser(user), session.token, clientKind);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function me(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  const headers = session.refreshed && session.source === 'cookie'
    ? { 'set-cookie': sessionCookie(session.token, request) }
    : undefined;
  return json({ user: session.publicUser }, 200, headers);
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (session) await deleteSession(env.DB, session.tokenHash);
  return json(
    { ok: true },
    200,
    session?.source === 'bearer'
      ? undefined
      : { 'set-cookie': expiredSessionCookie(request) },
  );
}

export async function sessions(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  const rows = await listSessionSummaries(env.DB, session.userId, session.tokenHash, unixNow());
  return json({
    sessions: rows.map((row) => ({
      clientKind: row.client_kind === CLIENT_DESKTOP ? 'desktop' : 'web',
      createdAt: row.created_at,
      current: row.is_current === 1,
      deviceName: row.device_name,
      expiresAt: row.expires_at,
      id: base64Url(row.token_hash),
      lastActiveAt: row.last_used_at,
    })),
  });
}

export async function terminateSession(
  request: Request,
  env: Env,
  sessionId: string,
): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  const tokenHash = parseSessionId(sessionId);
  if (!tokenHash) return json({ error: 'Session identifier is invalid.' }, 400);
  const terminated = await terminateSessionForUser(env.DB, session.userId, tokenHash);
  if (!terminated) return json({ error: 'Session was not found.' }, 404);
  return json({ ok: true });
}

export async function presence(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  return json({ ok: true });
}

function authenticatedResponse(
  request: Request,
  user: PublicUser,
  token: string,
  clientKind: AuthClientKind,
  status = 200,
): Response {
  if (clientKind === CLIENT_DESKTOP) {
    return json({ sessionToken: token, user }, status);
  }
  return json({ user }, status, { 'set-cookie': sessionCookie(token, request) });
}

function authErrorResponse(error: unknown): Response {
  if (error instanceof InputError) return json({ error: error.message }, 400);
  if (error instanceof RateLimitError) {
    return json({ error: error.message }, 429, { 'retry-after': '60' });
  }
  console.error('Authentication request failed.', error);
  return json({ error: 'Authentication service is unavailable.' }, 503);
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

function parseSessionId(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return null;
  try {
    const bytes = base64UrlBytes(value);
    return bytes.byteLength === 32 ? bytes : null;
  } catch {
    return null;
  }
}

export { CLIENT_DESKTOP, CLIENT_WEB };
