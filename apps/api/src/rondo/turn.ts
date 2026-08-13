import type { Env } from '../env';

export type RondoIceServer = {
  credential?: string;
  urls: string[];
  username?: string;
};

export type RondoIceConfiguration = {
  expiresAt: number;
  iceServers: RondoIceServer[];
};

const STUN_SERVER: RondoIceServer = {
  urls: ['stun:stun.cloudflare.com:3478'],
};
const TURN_TTL_SECONDS = 24 * 60 * 60;

export async function createRondoIceConfiguration(
  env: Pick<Env, 'TURN_KEY_API_TOKEN' | 'TURN_KEY_ID'>,
  now = Math.floor(Date.now() / 1_000),
  customIdentifier?: string,
): Promise<RondoIceConfiguration> {
  if (!env.TURN_KEY_API_TOKEN || !env.TURN_KEY_ID) return stunOnly(now);

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
      {
        body: JSON.stringify({
          ...(customIdentifier ? { customIdentifier } : {}),
          ttl: TURN_TTL_SECONDS,
        }),
        headers: {
          authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    );
    if (!response.ok) return stunOnly(now);
    const body: unknown = await response.json();
    const iceServers = parseIceServers(body);
    if (!iceServers.some(({ urls }) => urls.some((url) => url.startsWith('turn:') || url.startsWith('turns:')))) {
      return stunOnly(now);
    }
    return { expiresAt: now + TURN_TTL_SECONDS, iceServers };
  } catch {
    return stunOnly(now);
  }
}

function parseIceServers(body: unknown): RondoIceServer[] {
  if (!body || typeof body !== 'object') return [];
  const root = body as Record<string, unknown>;
  const nested = root.result && typeof root.result === 'object'
    ? root.result as Record<string, unknown>
    : null;
  const candidate = Array.isArray(root.iceServers)
    ? root.iceServers
    : Array.isArray(nested?.iceServers)
      ? nested.iceServers
      : [];
  return candidate.flatMap((entry): RondoIceServer[] => {
    if (!entry || typeof entry !== 'object') return [];
    const value = entry as Record<string, unknown>;
    const urls = typeof value.urls === 'string'
      ? [value.urls]
      : Array.isArray(value.urls)
        ? value.urls.filter((url): url is string => typeof url === 'string')
        : [];
    const browserUrls = urls.filter((url) => !isPort53(url));
    if (!browserUrls.length) return [];
    return [{
      ...(typeof value.credential === 'string' ? { credential: value.credential } : {}),
      urls: browserUrls,
      ...(typeof value.username === 'string' ? { username: value.username } : {}),
    }];
  });
}

function isPort53(url: string): boolean {
  if (/:53(?:\?|$)/u.test(url)) return true;
  try {
    return new URL(url).port === '53';
  } catch {
    return false;
  }
}

function stunOnly(now: number): RondoIceConfiguration {
  return { expiresAt: now + TURN_TTL_SECONDS, iceServers: [STUN_SERVER] };
}
