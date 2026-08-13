import type { LigoBootstrap, LigoInbox, LigoUser } from '../domain/ligo';
import type { LigoDeliveryInput, LigoGateway } from './LigoGateway';
import { requestJson } from './WebApiClient';

export class WebLigoGateway implements LigoGateway {
  acknowledge(deliveryId: string): Promise<void> {
    return requestJson(`/api/ligo/deliveries/${encodeURIComponent(deliveryId)}`, { method: 'DELETE' }, LIGO_UNAVAILABLE);
  }
  bootstrap(cursor: string | null = null, limit = 30): Promise<LigoBootstrap> {
    return requestJson(`/api/ligo/bootstrap?${pageQuery('before', cursor, limit)}`, {}, LIGO_UNAVAILABLE);
  }
  createDelivery(input: LigoDeliveryInput): Promise<void> {
    return requestJson('/api/ligo/deliveries', jsonRequest('POST', input), LIGO_UNAVAILABLE);
  }
  inbox(cursor: string | null = null, limit = 24): Promise<LigoInbox> {
    return requestJson(`/api/ligo/inbox?${pageQuery('after', cursor, limit)}`, {}, LIGO_UNAVAILABLE);
  }
  async searchUsers(query: string): Promise<LigoUser[]> {
    return (await requestJson<{ users: LigoUser[] }>(`/api/ligo/users?q=${encodeURIComponent(query)}`, {}, LIGO_UNAVAILABLE)).users;
  }
}

function pageQuery(key: string, cursor: string | null, limit: number): string {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set(key, cursor);
  return query.toString();
}

function jsonRequest(method: string, value: unknown): RequestInit {
  return { body: JSON.stringify(value), headers: { 'content-type': 'application/json' }, method };
}

const LIGO_UNAVAILABLE = 'Ligo service is unavailable.';
