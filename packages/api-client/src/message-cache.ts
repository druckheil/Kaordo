// Updates paginated message caches without mutating previous query results

import type { LigoMessage, LigoMessagePage } from '@kaordo/contracts';

interface MessagePages {
	pages: LigoMessagePage[];
}

export function appendSentMessage<T extends MessagePages>(
	existing: T | undefined,
	message: LigoMessage
): T | undefined {
	if (
		!existing?.pages.length ||
		existing.pages.some((page) => page.items.some((item) => item.clientId === message.clientId))
	) {
		return existing;
	}

	const [firstPage, ...olderPages] = existing.pages;
	return {
		...existing,
		pages: [{ ...firstPage, items: [message, ...firstPage.items] }, ...olderPages]
	};
}

export function replaceCachedMessage<T extends MessagePages>(
	existing: T | undefined,
	message: LigoMessage
): T | undefined {
	if (!existing) return existing;
	return {
		...existing,
		pages: existing.pages.map((page) => ({
			...page,
			items: page.items.map((item) => (item.id === message.id ? message : item))
		}))
	};
}
