// Encrypts private documents, attachments and opaque calendar indexes with Web Crypto
import { fromBase64, toBase64, type AccountKeys } from './keys.ts';

export interface Ciphertext { nonce: string; ciphertext: string }
export interface PrivateCipher {
  sealJSON(value: unknown, context: string): Promise<Ciphertext>;
  openJSON<T>(value: Ciphertext, context: string): Promise<T>;
  sealBytes(value: ArrayBuffer, context: string): Promise<{ nonce: string; bytes: ArrayBuffer }>;
  openBytes(value: ArrayBuffer, nonce: string, context: string): Promise<ArrayBuffer>;
  index(value: string): Promise<string>;
}

export async function privateCipher(keys: AccountKeys, ownerId: string, module: string, signal?: AbortSignal): Promise<PrivateCipher> {
  signal?.throwIfAborted();
  const material = await crypto.subtle.importKey('raw', keys.root as Uint8Array<ArrayBuffer>, 'HKDF', false, ['deriveKey']);
  const derive = (purpose: string, algorithm: AesKeyGenParams | HmacKeyGenParams, usage: KeyUsage[]) => crypto.subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(ownerId), info: new TextEncoder().encode(`kaordo/v1/${module}/${purpose}`)
  }, material, algorithm, false, usage);
  const [dataKey, mediaKey, indexKey] = await Promise.all([
    derive('data', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']),
    derive('media', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']),
    derive('index', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign'])
  ]);
  signal?.throwIfAborted();
  const aad = (context: string) => new TextEncoder().encode(`kaordo/v1/${module}/${ownerId}/${context}`);
  async function sealBytes(value: ArrayBuffer, context: string, key = mediaKey) {
    signal?.throwIfAborted();
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad(context) }, key, value);
    signal?.throwIfAborted();
    return { nonce: toBase64(nonce), bytes };
  }
  async function openBytes(value: ArrayBuffer, nonce: string, context: string, key = mediaKey) {
    signal?.throwIfAborted();
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(nonce, 12), additionalData: aad(context) }, key, value);
    if (signal?.aborted) { new Uint8Array(bytes).fill(0); signal.throwIfAborted(); }
    return bytes;
  }
  return {
    async sealJSON(value, context) {
      const plain = new TextEncoder().encode(JSON.stringify(value));
      try {
        const encrypted = await sealBytes(plain.buffer, context, dataKey);
        return { nonce: encrypted.nonce, ciphertext: toBase64(new Uint8Array(encrypted.bytes)) };
      } finally { plain.fill(0); }
    },
    async openJSON<T>(value: Ciphertext, context: string): Promise<T> {
      const bytes = await openBytes(fromBase64(value.ciphertext).buffer, value.nonce, context, dataKey);
      try { return JSON.parse(new TextDecoder().decode(bytes)) as T; }
      finally { new Uint8Array(bytes).fill(0); }
    },
    sealBytes, openBytes,
    async index(value) {
      signal?.throwIfAborted();
      const signed = new Uint8Array(await crypto.subtle.sign('HMAC', indexKey, new TextEncoder().encode(value)));
      signal?.throwIfAborted();
      return Array.from(signed, byte => byte.toString(16).padStart(2, '0')).join('');
    }
  };
}
