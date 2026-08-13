import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { LigoBootstrap, LigoInbox, LigoUser } from '../domain/ligo';
import type { TauriInvoke } from './TauriWorkspaceGateway';
import type { LigoDeliveryInput, LigoGateway } from './LigoGateway';

export class TauriLigoGateway implements LigoGateway {
  constructor(private readonly invoke: TauriInvoke = tauriInvoke) {}
  acknowledge(deliveryId: string): Promise<void> { return this.invoke('ligo_acknowledge', { deliveryId }); }
  bootstrap(cursor: string | null = null, limit = 30): Promise<LigoBootstrap> {
    return this.invoke('ligo_bootstrap', { cursor, limit });
  }
  createDelivery(input: LigoDeliveryInput): Promise<void> { return this.invoke('ligo_create_delivery', { input }); }
  inbox(cursor: string | null = null, limit = 24): Promise<LigoInbox> {
    return this.invoke('ligo_inbox', { cursor, limit });
  }
  searchUsers(query: string): Promise<LigoUser[]> { return this.invoke('ligo_search_users', { query }); }
}
