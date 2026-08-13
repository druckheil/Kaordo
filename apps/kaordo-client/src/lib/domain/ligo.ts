export type LigoUser = { id: string; online: boolean; username: string };
export type LigoConversation = {
  lastMessage: { id: string; mine: boolean; preview: string; sentAt: number };
  user: LigoUser;
};
export type LigoAttachment = {
  blob: Blob;
  id: string;
  mimeType: string;
  name: string;
  size: number;
};
export type LigoMessage = {
  attachments: LigoAttachment[];
  body: string;
  conversationId: string;
  createdAt: number;
  id: string;
  recipientId: string;
  senderId: string;
  status: LigoMessageStatus;
};
export type LigoMessageStatus = 'sending' | 'queued' | 'delivered' | 'read' | 'failed';
export type LigoReceiptStatus = Extract<LigoMessageStatus, 'delivered' | 'read'>;
export type LigoDelivery = {
  createdAt: number;
  id: string;
  nodeId: string;
  recipient: { id: string; username: string };
  sender: LigoUser;
  sizeBytes: number;
  status: Extract<LigoMessageStatus, 'queued' | 'delivered' | 'read'>;
  storage: 'private' | 'public';
};
export type LigoStorageSettings = {
  selectedNodeId: string;
  stackLimitBytes: number;
  stackUsedBytes: number;
};
export type LigoCloudPage = { messages: LigoDelivery[]; nextCursor: string | null };
export type LigoStorageUpdate = {
  evicted: Array<Pick<LigoDelivery, 'id' | 'nodeId' | 'storage'>>;
  storage: LigoStorageSettings;
};
export type LigoBootstrap = {
  conversations: LigoConversation[];
  nextCursor: string | null;
  storage: LigoStorageSettings;
};
export type LigoInbox = { deliveries: LigoDelivery[]; nextCursor: string | null };
export type LigoLiveTicket = { url: string };
