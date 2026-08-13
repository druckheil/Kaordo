import { arrayBuffer, randomBytes } from './encoding';

// v2: the official client performs PBKDF2-SHA-256/600k first, then the Worker
// performs this independently-salted PBKDF2 step within the free CPU budget.
export const PASSWORD_ALGORITHM_TWO_STAGE_PBKDF2_SHA256 = 2;
export const PASSWORD_ITERATIONS = 20_000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;
const DUMMY_SALT = new Uint8Array([
  124, 50, 211, 83, 114, 45, 142, 5, 29, 167, 94, 240, 38, 197, 71, 198,
]);

export type PasswordRecord = {
  algorithm: number;
  hash: Uint8Array;
  iterations: number;
  salt: Uint8Array;
};

export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = randomBytes(SALT_BYTES);
  return {
    algorithm: PASSWORD_ALGORITHM_TWO_STAGE_PBKDF2_SHA256,
    hash: await derivePassword(password, salt, PASSWORD_ITERATIONS),
    iterations: PASSWORD_ITERATIONS,
    salt,
  };
}

export async function verifyPassword(
  password: string,
  record: PasswordRecord | null,
): Promise<boolean> {
  const supported = record?.algorithm === PASSWORD_ALGORITHM_TWO_STAGE_PBKDF2_SHA256;
  const salt = supported ? record.salt : DUMMY_SALT;
  const iterations = supported ? record.iterations : PASSWORD_ITERATIONS;
  const candidate = await derivePassword(password, salt, iterations);
  if (!supported || record.hash.byteLength !== candidate.byteLength) return false;
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(left: BufferSource, right: BufferSource): boolean;
  };
  return subtle.timingSafeEqual(arrayBuffer(candidate), arrayBuffer(record.hash));
}

async function derivePassword(
  passwordProof: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    arrayBuffer(new TextEncoder().encode(passwordProof)),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { hash: 'SHA-256', iterations, name: 'PBKDF2', salt: arrayBuffer(salt) },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}
