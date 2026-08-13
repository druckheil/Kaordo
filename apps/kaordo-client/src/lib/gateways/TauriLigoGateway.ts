import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { LigoBootstrap, LigoCloudPage, LigoInbox, LigoLiveTicket, LigoStorageUpdate, LigoUser } from '../domain/ligo';
import type { TauriInvoke } from './TauriWorkspaceGateway';
import type { LigoDeliveryInput, LigoGateway } from './LigoGateway';

export class TauriLigoGateway implements LigoGateway {
  constructor(private readonly invoke: TauriInvoke = tauriInvoke) {}
  acknowledge(deliveryId: string): Promise<void> { return this.invoke('ligo_acknowledge', { deliveryId }); }
  acknowledgeConversationDeletions(peerUsernames: readonly string[]): Promise<void> {
    return this.invoke('ligo_acknowledge_conversation_deletions', { peerUsernames });
  }
  acknowledgeDeletions(messageIds: readonly string[]): Promise<void> {
    return this.invoke('ligo_acknowledge_deletions', { messageIds });
  }
  bootstrap(cursor: string | null = null, limit = 30): Promise<LigoBootstrap> {
    return this.invoke('ligo_bootstrap', { cursor, limit });
  }
  confirmCleanup(messageIds: readonly string[]): Promise<void> {
    return this.invoke('ligo_confirm_cleanup', { messageIds });
  }
  createDelivery(input: LigoDeliveryInput): Promise<LigoStorageUpdate> {
    return this.invoke('ligo_create_delivery', { input });
  }
  deleteConversation(peerUsername: string): Promise<LigoStorageUpdate> {
    return this.invoke('ligo_delete_conversation', { peerUsername });
  }
  deleteMessage(messageId: string, peerUsername: string): Promise<LigoStorageUpdate> {
    return this.invoke('ligo_delete_message', { messageId, peerUsername });
  }
  history(username: string, owner: 'peer' | 'self', cursor: string | null = null, limit = 40): Promise<LigoCloudPage> {
    return this.invoke('ligo_history', { cursor, limit, owner, username });
  }
  inbox(cursor: string | null = null, limit = 24): Promise<LigoInbox> {
    return this.invoke('ligo_inbox', { cursor, limit });
  }
  liveTicket(): Promise<LigoLiveTicket> { return this.invoke('ligo_live_ticket'); }
  markRead(messageIds: readonly string[]): Promise<void> { return this.invoke('ligo_mark_read', { messageIds }); }
  searchUsers(query: string): Promise<LigoUser[]> { return this.invoke('ligo_search_users', { query }); }
  updateStorage(selectedNodeId: string, stackLimitBytes: number): Promise<LigoStorageUpdate> {
    return this.invoke('ligo_update_storage', { selectedNodeId, stackLimitBytes });
  }
}
