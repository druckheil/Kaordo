// Describes an outgoing message throughout upload, sending and retry
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
