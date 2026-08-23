import type { Env } from '../env';
import { base64Url } from '../auth/encoding';
import { authenticate, unixNow } from '../auth/session';
import { accountRole, isAdmin } from '../auth/types';
import { json } from '../http/json';

type AdminUserRow = {
  active_sessions: number;
  created_at: number;
  display_username: string;
  id: ArrayBuffer;
  last_seen_at: number;
  online: number;
  role: number;
  status: number;
  erase_pending: number;
  username: string;
};

export async function adminDashboard(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  if (!isAdmin(session.publicUser)) return json({ error: 'Administrator access required.' }, 403);

  const now = unixNow();
  const result = await env.DB
    .prepare(
      `SELECT u.id, u.username, u.display_username, u.created_at, u.status,
              u.role, u.last_seen_at, u.online,
              COUNT(CASE WHEN s.expires_at > ?1 THEN 1 END) AS active_sessions,
              EXISTS(
                SELECT 1 FROM admin_erase_jobs AS erase_jobs
                WHERE erase_jobs.target_user_id = u.id
              ) OR EXISTS(
                SELECT 1 FROM ligo_conversation_deletions AS erase_conversations
                WHERE erase_conversations.peer_id = u.id
              ) AS erase_pending
         FROM users u
         LEFT JOIN sessions s ON s.user_id = u.id
        GROUP BY u.id
        ORDER BY u.role DESC, u.created_at ASC`,
    )
    .bind(now)
    .all<AdminUserRow>();
  const users = result.results.map((user) => ({
    activeSessions: user.active_sessions,
    createdAt: user.created_at,
    id: base64Url(user.id),
    lastSeenAt: user.last_seen_at,
    online: Boolean(user.online),
    role: accountRole(user.username, user.role),
    status: user.erase_pending
      ? 'erasing'
      : user.status === 1 ? 'active' : user.status === 2 ? 'suspended' : 'disabled',
    username: user.display_username,
  }));
  const meta = result.meta as D1Meta & { size_after?: number };
  return json({
    capacity: {
      d1: {
        accountStorageBytes: 5_000_000_000,
        databaseBytes: 500_000_000,
        databases: 10,
        rowsReadDaily: 5_000_000,
        rowsWrittenDaily: 100_000,
        timeTravelDays: 7,
      },
      r2: {
        classAOperationsMonthly: 1_000_000,
        classBOperationsMonthly: 10_000_000,
        storageBytesMonthly: 10_000_000_000,
      },
      turn: {
        egressBytesMonthly: 1_000_000_000_000,
        overageUsdPerGb: 0.05,
      },
      worker: {
        cpuMsPerRequest: 10,
        cronTriggers: 5,
        memoryBytes: 128 * 1024 * 1024,
        requestsDaily: 100_000,
        scripts: 100,
        simultaneousConnections: 6,
        startupMs: 1_000,
        subrequestsPerRequest: 50,
        workerBytes: 3 * 1024 * 1024,
      },
    },
    generatedAt: now,
    usage: {
      activeSessions: users.reduce((total, user) => total + user.activeSessions, 0),
      cloudflare: null,
      databaseBytes: meta.size_after ?? null,
      onlineUsers: users.filter((user) => user.online).length,
      totalUsers: users.length,
    },
    users,
  });
}
