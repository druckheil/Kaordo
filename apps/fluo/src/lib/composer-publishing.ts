// Uploads draft media and creates the corresponding Fluo post

import type { FluoApi } from "@kaordo/api-client";
import type { FluoDocument, FluoPost } from "@kaordo/contracts";

export interface PublishComposerPostInput {
	api: Pick<FluoApi, "create" | "uploadMetadata">;
	content: FluoDocument;
	nodoBaseUrl: string;
	replyTo: FluoPost | null;
	quoteTo: FluoPost | null;
	visibility: "public" | "private";
	attachments: { file: File; altText: string }[];
	onProgress: (progress: number) => void;
}

export async function publishComposerPost(input: PublishComposerPostInput): Promise<void> {
	const attachmentIds = await uploadAttachments(input);
	await input.api.create({
		content: input.content,
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
		input.nodoBaseUrl,
		input.api,
		input.onProgress,
	);
}

function attachmentAltTexts(
	attachments: PublishComposerPostInput["attachments"],
	attachmentIds: string[],
): Record<string, string> {
	return Object.fromEntries(
		attachmentIds.flatMap((id, index) => {
			const altText = attachments[index]?.altText.trim();
			return altText ? [[id, altText]] : [];
		}),
	);
}
