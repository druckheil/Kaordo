import { arrayBuffer, randomBytes, utf8 } from './encoding';
import { findUserBySeedHash, type SeedUserRow } from './database';

/**
 * A seed is deliberately rendered as eight fixed-size groups.  The 256 bits
 * of entropy are easier to read and paste than a single long token while the
 * normalized form remains deterministic for hashing and login.
 */
const SEED_BYTES = 32;
const SEED_GROUP_LENGTH = 8;
const SEED_GROUPS = 8;
const SEED_PATTERN = /^(?:[0-9a-f]{8})(?: [0-9a-f]{8}){7}$/u;

export function createSeedPhrase(): string {
  const bytes = randomBytes(SEED_BYTES);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  const groups: string[] = [];
  for (let index = 0; index < SEED_GROUPS; index += 1) {
    groups.push(hex.slice(index * SEED_GROUP_LENGTH, (index + 1) * SEED_GROUP_LENGTH));
  }
  return groups.join(' ');
}

export function normalizeSeedPhrase(value: string): string | null {
  const normalized = value.trim().toLowerCase().split(/\s+/u).join(' ');
  return SEED_PATTERN.test(normalized) ? normalized : null;
}

export async function hashSeedPhrase(seedPhrase: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', arrayBuffer(utf8(seedPhrase))));
}

export async function issueSeed(
  db: D1Database,
  userId: ArrayBuffer,
  now: number,
): Promise<string | null> {
  // A collision is cryptographically negligible, but retrying once keeps the
  // unique index an explicit invariant instead of turning it into a user error.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const seedPhrase = createSeedPhrase();
    const seedHash = await hashSeedPhrase(seedPhrase);
    const result = await db.prepare(
      `UPDATE users
          SET seed_hash = ?1, seed_created_at = ?2
        WHERE id = ?3 AND status = 1 AND seed_hash IS NULL`,
    ).bind(seedHash, now, userId).run();
    if ((result.meta.changes ?? 0) > 0) return seedPhrase;
  }
  return null;
}

export function seedUserByHash(
  db: D1Database,
  seedHash: Uint8Array,
): Promise<SeedUserRow | null> {
  return findUserBySeedHash(db, seedHash);
}
