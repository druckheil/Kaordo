// Defines the shared conversation-history component contract
import type { LigoMessage, LigoReaction } from '@kaordo/contracts';
import type { PendingMessage } from '@kaordo/chat-client';

export interface MessageListProps {
	messages: LigoMessage[];
	pending: PendingMessage[];
	viewerId: string;
	personal: boolean;
	group: boolean;
	showReceipt?: boolean;
	hasMore: boolean;
	loadingMore: boolean;
	loadOlder: () => Promise<void>;
	retry: (item: PendingMessage) => void;
	react: (message: LigoMessage, emoji: LigoReaction['emoji']) => Promise<void>;
	edit: (message: LigoMessage, text: string) => Promise<void>;
	remove: (message: LigoMessage) => Promise<void>;
}
