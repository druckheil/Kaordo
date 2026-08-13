import { authenticate, unixNow } from '../auth/session';
import type { Env } from '../env';
import { json } from '../http/json';
import { fluoNodeIds, nodesForUser } from '../nodes/routes';
import { publicStorageForUser } from './public-storage';

export async function fluoBootstrap(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  const now = unixNow();
  const [nodes, nodeIds, publicStorage] = await Promise.all([
    nodesForUser(env, session.userId, now),
    fluoNodeIds(env, now),
    publicStorageForUser(env, session.userId, now),
  ]);
  return json({ nodeIds, nodes, publicStorage });
}
