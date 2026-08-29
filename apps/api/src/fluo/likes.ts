import type { Env } from '../env';
import { authenticate, unixNow } from '../auth/session';
import { JsonRequestError, json, readJsonObject } from '../http/json';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_TARGETS = 100;
const NODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SPACES = new Set(['private', 'public']);

type LikeTarget = {
  nodeId: string;
  postId: string;
  space: 'private' | 'public';
};

type LikeState = LikeTarget & {
  liked: boolean;
  likeCount: number;
};

/** Reads the current user's reactions for visible feed rows in one D1 query. */
export async function fluoLikeStates(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await readLikesJson(request);
    const targets = parseTargets(input.posts);
    if (targets.length === 0) return json({ likes: [] });

    const rows = await env.DB.prepare(
      `WITH requested AS (
         SELECT
           json_extract(value, '$.nodeId') AS node_id,
           json_extract(value, '$.space') AS space,
           json_extract(value, '$.postId') AS post_id
           FROM json_each(?1)
       ), accessible AS (
         SELECT requested.node_id, requested.space, requested.post_id
           FROM requested
           JOIN nodes ON nodes.id = requested.node_id
          WHERE requested.space = 'private'
         UNION ALL
         SELECT requested.node_id, requested.space, requested.post_id
           FROM requested
           JOIN fluo_public_allocations AS allocations
             ON allocations.node_id = requested.node_id
            AND allocations.post_id = requested.post_id
            AND allocations.committed = 1
           JOIN nodes ON nodes.id = allocations.node_id
          WHERE requested.space = 'public'
            AND NOT EXISTS (
              SELECT 1 FROM fluo_public_tombstones AS tombstones
               WHERE tombstones.node_id = requested.node_id
                 AND tombstones.post_id = requested.post_id
            )
       )
       SELECT accessible.node_id, accessible.space, accessible.post_id,
              COALESCE(COUNT(likes.user_id), 0) AS like_count,
              COALESCE(MAX(CASE WHEN likes.user_id = ?2 THEN 1 ELSE 0 END), 0) AS liked
         FROM accessible
         LEFT JOIN fluo_post_likes AS likes
           ON likes.node_id = accessible.node_id
          AND likes.space = accessible.space
          AND likes.post_id = accessible.post_id
        GROUP BY accessible.node_id, accessible.space, accessible.post_id`,
    ).bind(JSON.stringify(targets), session.userId).all<LikeRow>();
    return json({ likes: rows.results.map(likeState) });
  } catch (error) {
    if (error instanceof InputError || error instanceof JsonRequestError) {
      return json({ error: error.message }, 400);
    }
    logFailure('query', error);
    return json({ error: 'Fluo likes could not be loaded.' }, 500);
  }
}

/** Idempotently creates/removes one reaction and returns its new aggregate. */
export async function setFluoLike(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  try {
    const input = await readLikesJson(request);
    const target = parseTarget(input);
    if (typeof input.liked !== 'boolean') throw new InputError('Like state is invalid.');

    const now = unixNow();
    const write = input.liked
      ? env.DB.prepare(
          `INSERT OR IGNORE INTO fluo_post_likes
            (node_id, space, post_id, user_id, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5
            WHERE (?2 = 'private' AND EXISTS(
                    SELECT 1 FROM nodes WHERE id = ?1
                  ))
               OR (?2 = 'public' AND EXISTS(
                    SELECT 1
                      FROM fluo_public_allocations AS allocations
                     WHERE allocations.node_id = ?1
                       AND allocations.post_id = ?3
                       AND allocations.committed = 1
                       AND NOT EXISTS (
                         SELECT 1 FROM fluo_public_tombstones AS tombstones
                          WHERE tombstones.node_id = allocations.node_id
                            AND tombstones.post_id = allocations.post_id
                       )
                  ))`,
        ).bind(target.nodeId, target.space, target.postId, session.userId, now)
      : env.DB.prepare(
          `DELETE FROM fluo_post_likes
            WHERE node_id = ?1 AND space = ?2 AND post_id = ?3 AND user_id = ?4`,
        ).bind(target.nodeId, target.space, target.postId, session.userId);
    const [, stateResult] = await env.DB.batch([
      write,
      env.DB.prepare(
        `SELECT CASE
                  WHEN ?2 = 'private' THEN EXISTS(
                    SELECT 1 FROM nodes WHERE id = ?1
                  )
                  ELSE EXISTS(
                    SELECT 1
                      FROM fluo_public_allocations AS allocations
                     WHERE allocations.node_id = ?1
                       AND allocations.post_id = ?3
                       AND allocations.committed = 1
                       AND NOT EXISTS (
                         SELECT 1 FROM fluo_public_tombstones AS tombstones
                          WHERE tombstones.node_id = allocations.node_id
                            AND tombstones.post_id = allocations.post_id
                       )
                  )
                END AS accessible,
                COUNT(*) AS like_count,
                EXISTS(
                  SELECT 1 FROM fluo_post_likes
                   WHERE node_id = ?1 AND space = ?2 AND post_id = ?3 AND user_id = ?4
                ) AS liked
           FROM fluo_post_likes
          WHERE node_id = ?1 AND space = ?2 AND post_id = ?3`,
      ).bind(target.nodeId, target.space, target.postId, session.userId),
    ]);
    const state = stateResult?.results?.[0] as LikeRow | undefined;
    if (!state?.accessible) return json({ error: 'The Fluo post was not found.' }, 404);
    return json({
      ...target,
      liked: Boolean(Number(state?.liked ?? (input.liked ? 1 : 0))),
      likeCount: Math.max(0, Number(state?.like_count ?? 0)),
    });
  } catch (error) {
    if (error instanceof InputError || error instanceof JsonRequestError) {
      return json({ error: error.message }, 400);
    }
    logFailure('set', error);
    return json({ error: 'Fluo like could not be saved.' }, 500);
  }
}

type LikeRow = {
  accessible?: number;
  liked: number;
  like_count: number;
  node_id: string;
  post_id: string;
  space: 'private' | 'public';
};

function likeState(row: LikeRow): LikeState {
  return {
    liked: Boolean(row.liked),
    likeCount: Math.max(0, Number(row.like_count ?? 0)),
    nodeId: row.node_id,
    postId: row.post_id,
    space: row.space,
  };
}

function parseTargets(value: unknown): LikeTarget[] {
  if (!Array.isArray(value) || value.length > MAX_TARGETS) {
    throw new InputError('Too many Fluo posts were requested.');
  }
  const unique = new Map<string, LikeTarget>();
  for (const item of value) {
    const target = parseTarget(item);
    unique.set([target.space, target.nodeId, target.postId].join(':'), target);
  }
  return [...unique.values()];
}

function parseTarget(value: unknown): LikeTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError('Fluo post identity is invalid.');
  }
  const input = value as Record<string, unknown>;
  if (typeof input.nodeId !== 'string' || !NODE_ID.test(input.nodeId) ||
      typeof input.postId !== 'string' || !NODE_ID.test(input.postId) ||
      typeof input.space !== 'string' || !SPACES.has(input.space)) {
    throw new InputError('Fluo post identity is invalid.');
  }
  return {
    nodeId: input.nodeId,
    postId: input.postId,
    space: input.space as LikeTarget['space'],
  };
}

function readLikesJson(request: Request): Promise<Record<string, unknown>> {
  return readJsonObject(request, {
    invalidMessage: 'Fluo likes request is invalid.',
    maxBytes: MAX_BODY_BYTES,
    tooLargeMessage: 'Fluo likes request is too large.',
  });
}

function logFailure(operation: 'query' | 'set', error: unknown): void {
  console.error(JSON.stringify({
    error: error instanceof Error ? error.name : 'UnknownError',
    event: 'fluo_likes_failed',
    operation,
  }));
}

class InputError extends Error {}
