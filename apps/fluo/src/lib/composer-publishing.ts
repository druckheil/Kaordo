// Uploads draft media and creates the corresponding Fluo post

import type { Editor } from "@tiptap/core";
import type { FluoApi } from "@kaordo/api-client";
import type { FluoDocument, FluoPost } from "@kaordo/contracts";
import type { ComposerAttachment } from "./composer-model";

export interface PublishComposerPostInput {
	api: FluoApi;
	editor: Editor;
	replyTo: FluoPost | null;
	quoteTo: FluoPost | null;
	visibility: "public" | "private";
	attachments: ComposerAttachment[];
	onProgress: (progress: number) => void;
}

export async function publishComposerPost(input: PublishComposerPostInput): Promise<void> {
	const attachmentIds = await uploadAttachments(input);
	await input.api.create({
		content: input.editor.getJSON() as FluoDocument,
		visibility: input.replyTo?.visibility ?? input.visibility,
		...(input.replyTo ? { parentId: input.replyTo.id } : {}),
		...(input.quoteTo ? { quoteId: input.quoteTo.id } : {}),
		attachmentIds,
		altTexts: attachmentAltTexts(input.attachments, attachmentIds),
	});
}

async function uploadAttachments(input: PublishComposerPostInput): Promise<string[]> {
	if (!input.attachments.length) return [];
	const { uploadMedia } = await import("@kaordo/media-client");
	return uploadMedia(
		input.attachments.map(({ file }) => file),
		import.meta.env.VITE_KAORDO_NODO_URL,
		input.api,
		input.onProgress,
	);
}

function attachmentAltTexts(
	attachments: ComposerAttachment[],
	attachmentIds: string[],
): Record<string, string> {
	return Object.fromEntries(
		attachmentIds.flatMap((id, index) => {
			const altText = attachments[index]?.altText.trim();
			return altText ? [[id, altText]] : [];
		}),
	);
}
