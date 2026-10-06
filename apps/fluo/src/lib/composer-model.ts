// Defines local state for media attached to a Fluo post draft

export interface ComposerAttachment {
	file: File;
	preview: string;
	altText: string;
}

export const maxComposerAttachments = 4;

export const composerMediaTypes = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"video/mp4",
	"video/webm",
	"video/quicktime",
];
