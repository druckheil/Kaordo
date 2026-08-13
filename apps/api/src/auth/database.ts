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

export async function findUserByUsername(
  db: D1Database,
  username: string,
): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT id, username, display_username, password_hash, password_salt,
              password_algorithm, password_iterations, created_at, status,
              role, last_seen_at
         FROM users
        WHERE username = ?1
        LIMIT 1`,
    )
    .bind(username)
    .first<UserRow>();
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
              u.role, u.last_seen_at, s.expires_at, s.last_used_at
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

export async function deleteExpiredSessions(db: D1Database, now: number): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now).run();
}

export function publicUser(
  row: Pick<UserRow, 'created_at' | 'display_username' | 'id' | 'role' | 'username'>,
): PublicUser {
  return {
    createdAt: row.created_at,
    id: base64Url(row.id),
    role: accountRole(row.username, row.role),
    username: row.display_username,
  };
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
