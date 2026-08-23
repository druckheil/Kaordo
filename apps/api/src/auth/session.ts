import type { Env } from '../env';
import {
  deleteSession,
  findSessionUser,
  publicUser,
  updateSessionActivity,
  SESSION_REFRESH_INTERVAL_SECONDS,
} from './database';
import { arrayBuffer, randomBytes, utf8 } from './encoding';
import { ACCOUNT_STATUS_ACTIVE, type PublicUser } from './types';

const SESSION_COOKIE = 'vdm_session';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PRESENCE_REFRESH_INTERVAL_SECONDS = 10 * 60;

export type AuthenticatedSession = {
  publicUser: PublicUser;
  refreshed: boolean;
  source: 'bearer' | 'cookie';
  token: string;
  tokenHash: Uint8Array;
  userId: ArrayBuffer;
};

export async function createSessionToken(): Promise<{
  token: string;
  tokenHash: Uint8Array;
}> {
  const token = base64Token();
  return { token, tokenHash: await hashSessionToken(token) };
}

export async function authenticate(
  request: Request,
  env: Env,
  now = unixNow(),
  allowSuspended = false,
): Promise<AuthenticatedSession | null> {
  const extracted = extractToken(request);
  if (!extracted) return null;
  const tokenHash = await hashSessionToken(extracted.token);
  const row = await findSessionUser(env.DB, tokenHash);
  if (!row) return null;
  if (row.expires_at <= now ||
      (row.status !== ACCOUNT_STATUS_ACTIVE && !(allowSuspended && row.status === 2))) {
    await deleteSession(env.DB, tokenHash);
    return null;
  }

  const refreshed = now - row.last_used_at >= SESSION_REFRESH_INTERVAL_SECONDS;
  const presenceStale = now - row.last_seen_at >= PRESENCE_REFRESH_INTERVAL_SECONDS;
  await updateSessionActivity(
    env.DB,
    tokenHash,
    row.id,
    now,
    refreshed,
    presenceStale,
  );
  return {
    publicUser: publicUser(row),
    refreshed,
    source: extracted.source,
    token: extracted.token,
    tokenHash,
    userId: row.id,
  };
}

export async function hashSessionToken(token: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', arrayBuffer(utf8(token))),
  );
}

export function sessionCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=2592000`;
}

export function expiredSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=0`;
}

export function unixNow(): number {
  return Math.floor(Date.now() / 1_000);
}

function extractToken(
  request: Request,
): { source: 'bearer' | 'cookie'; token: string } | null {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice(7);
    return TOKEN_PATTERN.test(token) ? { source: 'bearer', token } : null;
  }
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  for (const item of cookie.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    const name = item.slice(0, separator).trim();
    const token = item.slice(separator + 1).trim();
    if (name === SESSION_COOKIE && TOKEN_PATTERN.test(token)) {
      return { source: 'cookie', token };
    }
  }
  return null;
}

function base64Token(): string {
  const bytes = randomBytes(32);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
