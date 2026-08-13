import type { Env } from '../env';
import { arrayBuffer, base64Url, utf8 } from './encoding';

export class RateLimitError extends Error {}

export async function enforceAuthRateLimit(
  request: Request,
  env: Env,
  normalizedUsername: string,
): Promise<void> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const accountDigest = await crypto.subtle.digest(
    'SHA-256',
    arrayBuffer(utf8(normalizedUsername)),
  );
  const accountKey = base64Url(accountDigest).slice(0, 22);
  const [ipResult, accountResult] = await Promise.all([
    env.AUTH_IP_LIMITER.limit({ key: `auth:${ip}` }),
    env.AUTH_ACCOUNT_LIMITER.limit({ key: `auth:${accountKey}` }),
  ]);
  if (!ipResult.success || !accountResult.success) {
    throw new RateLimitError('Too many authentication attempts.');
  }
}
