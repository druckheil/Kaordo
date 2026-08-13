import type {
  LigoBootstrap,
  LigoCloudPage,
  LigoInbox,
  LigoLiveTicket,
  LigoStorageUpdate,
  LigoUser,
} from '../domain/ligo';

export type LigoDeliveryInput = {
  id: string;
  nodeId: string;
  preview: string;
  recipientUsername: string;
  sizeBytes: number;
  storage: 'private' | 'public';
};

export interface LigoGateway {
  acknowledge(deliveryId: string): Promise<void>;
  bootstrap(cursor?: string | null, limit?: number): Promise<LigoBootstrap>;
  confirmCleanup(messageIds: readonly string[]): Promise<void>;
  createDelivery(input: LigoDeliveryInput): Promise<LigoStorageUpdate>;
  history(username: string, owner: 'peer' | 'self', cursor?: string | null, limit?: number): Promise<LigoCloudPage>;
  inbox(cursor?: string | null, limit?: number): Promise<LigoInbox>;
  liveTicket(): Promise<LigoLiveTicket>;
  markRead(messageIds: readonly string[]): Promise<void>;
  searchUsers(query: string): Promise<LigoUser[]>;
  updateStorage(selectedNodeId: string, stackLimitBytes: number): Promise<LigoStorageUpdate>;
}
