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
  status: 'delivered' | 'queued';
};
export type LigoDelivery = {
  createdAt: number;
  id: string;
  nodeId: string;
  sender: { id: string; username: string };
  sizeBytes: number;
  storage: 'private' | 'public';
};
export type LigoBootstrap = { conversations: LigoConversation[]; nextCursor: string | null };
export type LigoInbox = { deliveries: LigoDelivery[]; nextCursor: string | null };
