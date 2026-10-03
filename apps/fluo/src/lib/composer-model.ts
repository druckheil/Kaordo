// Defines local state for media attached to a Fluo post draft

export interface ComposerAttachment {
	file: File;
	preview: string;
	altText: string;
}

export const maxComposerAttachments = 4;
