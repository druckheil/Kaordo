// Creates a Tiptap editor configured for Fluo post content

import type { Editor } from "@tiptap/core";
import type { FluoPost } from "@kaordo/contracts";
import { composerMediaTypes } from "./composer-model";

export function createComposerEditor(
	element: HTMLDivElement,
	replyTo: FluoPost | null,
	onTextChange: (length: number) => void,
	onFilesPaste: (files: File[]) => void,
): Promise<Editor> {
	return Promise.all([
		import("@tiptap/core"),
		import("@tiptap/starter-kit"),
		import("@tiptap/extension-placeholder"),
		import("@tiptap/extension-file-handler"),
	]).then(([{ Editor: EditorConstructor }, { default: StarterKit }, { Placeholder }, { FileHandler }]) => new EditorConstructor({
		element,
		extensions: [
			StarterKit.configure({
				blockquote: false,
				bulletList: false,
				code: false,
				codeBlock: false,
				heading: false,
				horizontalRule: false,
				link: false,
				orderedList: false,
				listItem: false,
				listKeymap: false,
				underline: false,
			}),
			Placeholder.configure({
				placeholder: replyTo ? "Write a reply…" : "What would you like to share?",
			}),
			FileHandler.configure({
				allowedMimeTypes: composerMediaTypes,
				onPaste: (_editor, files) => onFilesPaste(files),
			}),
		],
		content: { type: "doc", content: [{ type: "paragraph" }] },
		editorProps: {
			attributes: {
				"aria-label": replyTo ? "Reply text" : "Post text",
				class: "outline-none",
			},
		},
		onUpdate: ({ editor: current }) => onTextChange(current.getText().trim().length),
	}));
}
