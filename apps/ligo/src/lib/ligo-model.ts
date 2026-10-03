// Defines Ligo display rules and immutable message-cache updates

import type { LigoConversation, LigoUser } from "@kaordo/contracts";

export const maxAttachmentsPerMessage = 8;
export const maxMessageCharacters = 4_000;

export type ConversationDialogMode = "new" | "add";

export function conversationTitle(conversation: LigoConversation, currentUserId: string): string {
	if (conversation.kind === "self") return "Saved messages";
	if (conversation.kind === "group" || conversation.kind === "channel") return conversation.title;
	return conversation.members.find((member) => member.id !== currentUserId)?.displayName ?? "Direct chat";
}

export function userInitials(value: string): string {
	return value
		.trim()
		.split(/\s+/)
		.slice(0, 2)
		.map((word) => word[0])
		.join("")
		.toUpperCase() || "K";
}

export function formatConversationTime(value: string, now = new Date()): string {
	const date = new Date(value);
	const options: Intl.DateTimeFormatOptions =
		date.toDateString() === now.toDateString()
			? { hour: "2-digit", minute: "2-digit" }
			: { month: "short", day: "numeric" };
	return new Intl.DateTimeFormat(undefined, options).format(date);
}

export function filterConversations(
	conversations: LigoConversation[],
	search: string,
	currentUserId: string,
): LigoConversation[] {
	const normalizedSearch = search.toLocaleLowerCase();
	return conversations.filter(
		(conversation) =>
			conversation.kind !== "self" &&
			conversationTitle(conversation, currentUserId)
				.toLocaleLowerCase()
				.includes(normalizedSearch),
	);
}

export function findAvailableUsers(
	users: LigoUser[],
	mode: ConversationDialogMode,
	conversation: LigoConversation | null,
): LigoUser[] {
	if (mode !== "add") return users;
	return users.filter(
		(candidate) => !conversation?.members.some((member) => member.id === candidate.id),
	);
}
