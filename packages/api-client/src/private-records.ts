// Persists opaque owner-only records through atomic ciphertext transactions
import createClient from 'openapi-fetch';
import type { paths } from '@kaordo/contracts';
import { encryptionSession, privateCipher, type Ciphertext } from '@kaordo/crypto';
import { requireResponseData, sessionFetch } from './http.ts';

export interface PrivateRecord<T> { id: string; revision: number; value: T }
interface Change { id: string; revision: number; value: unknown }
export function createPrivateRecords(baseUrl: string, module: string) {
  const session = encryptionSession();
  const cipher = privateCipher(session.keys, session.ownerId, module, session.signal);
  void cipher.catch(() => {});
  const client = createClient<paths>({ baseUrl, fetch: sessionFetch });
  const tag = async (id: string) => (await cipher).index(id);
  async function read<T>(ids: string[], signal?: AbortSignal): Promise<PrivateRecord<T>[]> {
    const c = await cipher;
    const tags = await Promise.all(ids.map(id => tag(id)));
    const requestSignal = signal ? AbortSignal.any([session.signal, signal]) : session.signal;
    const { data, error, response } = await client.POST('/v1/crypto/records/read', { body: { tags }, signal: requestSignal });
    const result = requireResponseData(data, error, response.status);
    return Promise.all(result.items.map(async item => {
      const id = ids[tags.indexOf(item.tag)];
      if (!id) throw new Error('The encrypted record index changed.');
      return { id, revision: item.revision, value: await c.openJSON<T>(item, id) };
    }));
  }
  async function commit(writes: Change[], deletes: { id: string; revision: number }[] = [], signal?: AbortSignal): Promise<PrivateRecord<unknown>[]> {
    const c = await cipher;
    const envelopes = await Promise.all(writes.map(async item => ({ tag: await tag(item.id), revision: item.revision, ...await c.sealJSON(item.value, item.id) })));
    const removal = await Promise.all(deletes.map(async item => ({ tag: await tag(item.id), revision: item.revision })));
    const { data, error, response } = await client.POST('/v1/crypto/records/commit', { body: { writes: envelopes, deletes: removal },
      signal: signal ? AbortSignal.any([signal, session.signal]) : session.signal });
    const result = requireResponseData(data, error, response.status);
    return writes.map((item, index) => ({ id: item.id, revision: result.items.find(record => record.tag === envelopes[index].tag)!.revision, value: item.value }));
  }
  return { read, commit, tag };
}
