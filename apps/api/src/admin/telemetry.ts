import type { Env } from '../env';
import { authenticate } from '../auth/session';
import { isAdmin, isRootSuperadmin } from '../auth/types';
import { json } from '../http/json';
import { cloudflareUsage } from './cloudflare';

export async function adminCloudflareTelemetry(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!isAdmin(session.publicUser)) return json({ error: 'Administrator access required.' }, 403);
  if (!isRootSuperadmin(session.publicUser, env.SUPERADMIN_USER_ID)) return json(null);
  return json(await cloudflareUsage(env));
}
