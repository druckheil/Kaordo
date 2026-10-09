// Formats message text, timestamps, and attachment sizes for chat components

import { appPaths } from '@kaordo/links';

export interface MessageTextPart {
	text: string;
	href?: string;
}

const fluoPostLinkPattern = /(?:https?:\/\/[^\s]+)?\/fluo\/#post\/([0-9a-f-]{36})/gi;
const messageTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: '2-digit',
	minute: '2-digit'
});

export function splitMessageText(text: string): MessageTextPart[] {
	const parts: MessageTextPart[] = [];
	let cursor = 0;

	for (const match of text.matchAll(fluoPostLinkPattern)) {
		if (!isInternalFluoPostLink(match[0])) continue;

		const start = match.index;
		if (start > cursor) parts.push({ text: text.slice(cursor, start) });

		parts.push({
			text: 'View Fluo post',
			href: `${appPaths.fluo}#post/${match[1]}`
		});
		cursor = start + match[0].length;
	}

	if (cursor < text.length) parts.push({ text: text.slice(cursor) });
	return parts;
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMessageTime(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? '' : messageTimeFormatter.format(date);
}

function isInternalFluoPostLink(link: string): boolean {
	if (!/^https?:\/\//i.test(link) || typeof window === 'undefined') return true;

	try {
		return new URL(link).origin === window.location.origin;
	} catch {
		return false;
	}
}
