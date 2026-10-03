// Describes an outgoing message while its attachments and content are being sent

export interface PendingMessage {
  clientId: string;
  conversationId: string;
  text: string;
  files: File[];
  attachmentIds?: string[];
  progress: number;
  status: 'uploading' | 'sending' | 'failed';
  error?: string;
  createdAt: string;
}
