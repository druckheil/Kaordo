import { base64Url, randomBytes } from './encoding';
import type { PasswordRecord } from './password';
import {
  ACCOUNT_ROLE_SUPERADMIN,
  ACCOUNT_ROLE_USER,
  ACCOUNT_STATUS_ACTIVE,
  SUPERADMIN_USERNAME,
  accountRole,
  type AuthClientKind,
  type PublicUser,
  type SessionUserRow,
  type UserRow,
} from './types';

const MAX_SESSIONS_PER_USER = 16;

export type SeedUserRow = UserRow;

export async function findUserByUsername(
  db: D1Database,
  username: string,
): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT id, username, display_username, password_hash, password_salt,
              password_algorithm, password_iterations, created_at, status,
              role, last_seen_at, seed_hash IS NOT NULL AS seed_issued
         FROM users
        WHERE username = ?1
        LIMIT 1`,
    )
    .bind(username)
    .first<UserRow>();
}

export async function findUserBySeedHash(
  db: D1Database,
  seedHash: Uint8Array,
): Promise<SeedUserRow | null> {
  return db
    .prepare(
      `SELECT id, username, display_username, password_hash, password_salt,
              password_algorithm, password_iterations, created_at, status,
              role, last_seen_at, seed_hash IS NOT NULL AS seed_issued
         FROM users
        WHERE seed_hash = ?1
        LIMIT 1`,
    )
    .bind(seedHash)
    .first<SeedUserRow>();
}

export async function resetSeed(
  db: D1Database,
  userId: ArrayBuffer,
): Promise<boolean> {
  const result = await db.prepare(
    'UPDATE users SET seed_hash = NULL, seed_created_at = NULL WHERE id = ?1',
  ).bind(userId).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function findUserById(
  db: D1Database,
  userId: ArrayBuffer,
): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT id, username, display_username, password_hash, password_salt,
              password_algorithm, password_iterations, created_at, status,
              role, last_seen_at, seed_hash IS NOT NULL AS seed_issued
         FROM users
        WHERE id = ?1
        LIMIT 1`,
    )
    .bind(userId)
    .first<UserRow>();
}

export async function updateUsername(
  db: D1Database,
  userId: ArrayBuffer,
  username: string,
  displayUsername: string,
  password: PasswordRecord,
): Promise<UserRow | null> {
  const result = await db
    .prepare(
      `UPDATE users
          SET username = ?1,
              display_username = ?2,
              password_hash = ?3,
              password_salt = ?4,
              password_algorithm = ?5,
              password_iterations = ?6
        WHERE id = ?7 AND status = 1`,
    )
    .bind(
      username,
      displayUsername,
      password.hash,
      password.salt,
      password.algorithm,
      password.iterations,
      userId,
    )
    .run();
  if ((result.meta.changes ?? 0) === 0) return null;
  return findUserById(db, userId);
}

export async function updatePassword(
  db: D1Database,
  userId: ArrayBuffer,
  currentTokenHash: Uint8Array,
  password: PasswordRecord,
): Promise<boolean> {
  const [updated] = await db.batch([
    db
      .prepare(
        `UPDATE users
            SET password_hash = ?1,
                password_salt = ?2,
                password_algorithm = ?3,
                password_iterations = ?4
          WHERE id = ?5 AND status = 1`,
      )
      .bind(
        password.hash,
        password.salt,
        password.algorithm,
        password.iterations,
        userId,
      ),
    db
      .prepare('DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2')
      .bind(userId, currentTokenHash),
  ]);
  return (updated?.meta.changes ?? 0) > 0;
}

export async function createUserAndSession(
  db: D1Database,
  input: {
    clientKind: AuthClientKind;
    createdAt: number;
    deviceName: string | null;
    displayUsername: string;
    password: PasswordRecord;
    tokenHash: Uint8Array;
    username: string;
  },
): Promise<PublicUser> {
  const userId = randomBytes(16);
  const expiresAt = input.createdAt + SESSION_LIFETIME_SECONDS;
  const role = input.username === SUPERADMIN_USERNAME
    ? ACCOUNT_ROLE_SUPERADMIN
    : ACCOUNT_ROLE_USER;
  await db.batch([
    db
      .prepare(
        `INSERT INTO users (
           id, username, display_username, password_hash, password_salt,
           password_algorithm, password_iterations, created_at, status, role,
           last_seen_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      )
      .bind(
        userId,
        input.username,
        input.displayUsername,
        input.password.hash,
        input.password.salt,
        input.password.algorithm,
        input.password.iterations,
        input.createdAt,
        ACCOUNT_STATUS_ACTIVE,
        role,
        input.createdAt,
      ),
    sessionInsert(db, {
      clientKind: input.clientKind,
      createdAt: input.createdAt,
      deviceName: input.deviceName,
      expiresAt,
      tokenHash: input.tokenHash,
      userId,
    }),
  ]);
  return {
    createdAt: input.createdAt,
    id: base64Url(userId),
    role: accountRole(input.username, role),
    seedIssued: false,
    username: input.displayUsername,
  };
}

export async function createSession(
  db: D1Database,
  input: {
    clientKind: AuthClientKind;
    createdAt: number;
    deviceName: string | null;
    tokenHash: Uint8Array;
    userId: ArrayBuffer;
  },
): Promise<void> {
  await db.batch([
    sessionInsert(db, {
      ...input,
      expiresAt: input.createdAt + SESSION_LIFETIME_SECONDS,
    }),
    db
      .prepare('UPDATE users SET last_seen_at = ?1 WHERE id = ?2')
      .bind(input.createdAt, input.userId),
    db
      .prepare(
        `DELETE FROM sessions
          WHERE user_id = ?1
            AND token_hash IN (
              SELECT token_hash
                FROM sessions
               WHERE user_id = ?1
               ORDER BY last_used_at DESC
               LIMIT -1 OFFSET ?2
            )`,
      )
      .bind(input.userId, MAX_SESSIONS_PER_USER),
  ]);
}

export async function findSessionUser(
  db: D1Database,
  tokenHash: Uint8Array,
): Promise<SessionUserRow | null> {
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_username, u.created_at, u.status,
              u.role, u.last_seen_at, s.expires_at, s.last_used_at,
              u.seed_hash IS NOT NULL AS seed_issued
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?1
        LIMIT 1`,
    )
    .bind(tokenHash)
    .first<SessionUserRow>();
}

export async function updateSessionActivity(
  db: D1Database,
  tokenHash: Uint8Array,
  userId: ArrayBuffer,
  now: number,
  refreshSession: boolean,
  refreshPresence: boolean,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  if (refreshSession) {
    statements.push(db
      .prepare('UPDATE sessions SET last_used_at = ?1, expires_at = ?2 WHERE token_hash = ?3')
      .bind(now, now + SESSION_LIFETIME_SECONDS, tokenHash));
  }
  if (refreshPresence) {
    statements.push(db
      .prepare('UPDATE users SET last_seen_at = ?1 WHERE id = ?2')
      .bind(now, userId));
  }
  if (statements.length === 1) await statements[0]!.run();
  else if (statements.length > 1) await db.batch(statements);
}

export async function deleteSession(db: D1Database, tokenHash: Uint8Array): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(tokenHash).run();
}

export type SessionSummaryRow = {
  client_kind: number;
  created_at: number;
  device_name: string | null;
  expires_at: number;
  is_current: number;
  last_used_at: number;
  token_hash: ArrayBuffer;
};

export async function listSessionSummaries(
  db: D1Database,
  userId: ArrayBuffer,
  currentTokenHash: Uint8Array,
  now: number,
): Promise<SessionSummaryRow[]> {
  const result = await db
    .prepare(
      `SELECT token_hash, created_at, expires_at, last_used_at, client_kind, device_name,
              CASE WHEN token_hash = ?2 THEN 1 ELSE 0 END AS is_current
         FROM sessions
        WHERE user_id = ?1 AND expires_at > ?3
        ORDER BY is_current DESC, last_used_at DESC, created_at DESC`,
    )
    .bind(userId, currentTokenHash, now)
    .all<SessionSummaryRow>();
  return result.results;
}

export async function terminateSessionForUser(
  db: D1Database,
  userId: ArrayBuffer,
  tokenHash: Uint8Array,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM sessions WHERE user_id = ?1 AND token_hash = ?2')
    .bind(userId, tokenHash)
    .run();
  return result.meta.changes > 0;
}

export async function deleteExpiredSessions(db: D1Database, now: number): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now).run();
}

export function publicUser(
  row: Pick<UserRow, 'created_at' | 'display_username' | 'id' | 'role' | 'username'> &
    Partial<Pick<UserRow, 'seed_issued'>>,
): PublicUser {
  const user: PublicUser = {
    createdAt: row.created_at,
    id: base64Url(row.id),
    role: accountRole(row.username, row.role),
    username: row.display_username,
  };
  if (row.seed_issued !== undefined) user.seedIssued = row.seed_issued === 1;
  return user;
}

export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_REFRESH_INTERVAL_SECONDS = 24 * 60 * 60;

function sessionInsert(
  db: D1Database,
  input: {
    clientKind: AuthClientKind;
    createdAt: number;
    deviceName: string | null;
    expiresAt: number;
    tokenHash: Uint8Array;
    userId: ArrayBuffer | Uint8Array;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO sessions (
         token_hash, user_id, created_at, expires_at, last_used_at, client_kind, device_name
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      input.tokenHash,
      input.userId,
      input.createdAt,
      input.expiresAt,
      input.createdAt,
      input.clientKind,
      input.deviceName,
    );
}
