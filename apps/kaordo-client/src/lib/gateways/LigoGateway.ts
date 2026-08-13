import type { LigoBootstrap, LigoInbox, LigoUser } from '../domain/ligo';

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
  createDelivery(input: LigoDeliveryInput): Promise<void>;
  inbox(cursor?: string | null, limit?: number): Promise<LigoInbox>;
  searchUsers(query: string): Promise<LigoUser[]>;
}
