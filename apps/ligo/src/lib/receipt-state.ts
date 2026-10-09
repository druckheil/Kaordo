// Deduplicates delivery and read acknowledgements and cancels them with the conversation workspace
import type { LigoApi } from '@kaordo/api-client';
import type { LigoConversation } from '@kaordo/contracts';

export function createReceiptState(
	api: Pick<LigoApi, 'markRead' | 'markDelivered'>,
	userId: () => string,
	changed: () => Promise<void>
) {
	let lastReadAttempt = '';
	const deliveredAttempts = new Map<string, string>();
	const lifetime = new AbortController();

	function markRead(conversationId: string, messageId: string): void {
		const attemptKey = `${conversationId}:${messageId}`;
		if (lifetime.signal.aborted || lastReadAttempt === attemptKey) return;
		lastReadAttempt = attemptKey;
		void api
			.markRead(conversationId, messageId, lifetime.signal)
			.then(() => {
				if (!lifetime.signal.aborted) return changed();
			})
			.catch(() => {
				if (!lifetime.signal.aborted) lastReadAttempt = '';
			});
	}

	function markDelivered(items: LigoConversation[]): void {
		if (lifetime.signal.aborted) return;
		for (const conversation of items) {
			const lastMessage = conversation.lastMessage;
			if (!lastMessage || lastMessage.senderId === userId()) continue;
			if (deliveredAttempts.get(conversation.id) === lastMessage.id) continue;
			deliveredAttempts.set(conversation.id, lastMessage.id);
			void api.markDelivered(conversation.id, lastMessage.id, lifetime.signal).catch(() => {
				if (!lifetime.signal.aborted && deliveredAttempts.get(conversation.id) === lastMessage.id) {
					deliveredAttempts.delete(conversation.id);
				}
			});
		}
	}

	return {
		markRead,
		markDelivered,
		dispose() {
			lifetime.abort();
			deliveredAttempts.clear();
		}
	};
}
