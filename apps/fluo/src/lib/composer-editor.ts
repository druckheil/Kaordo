// Creates a Tiptap editor configured for Fluo post content

import type { Editor } from '@tiptap/core';
import type { FluoPost } from '@kaordo/contracts';
import { createRichEditor } from '@kaordo/editor-ui';

export function createComposerEditor(
	element: HTMLDivElement,
	replyTo: FluoPost | null,
	onTextChange: (length: number) => void,
	onFilesPaste: (files: File[]) => void
): Promise<Editor> {
	return createRichEditor(element, {
		label: replyTo ? 'Reply text' : 'Post text',
		placeholder: replyTo ? 'Write a reply…' : 'What would you like to share?',
		onChange: (current) => onTextChange(current.getText().trim().length),
		onFiles: onFilesPaste
	});
}
