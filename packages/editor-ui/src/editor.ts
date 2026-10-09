// Creates the shared safe rich-text editor and clipboard media pipeline
import type { Editor } from '@tiptap/core';
import type { FluoDocument } from '@kaordo/contracts';
import { clipboardFiles } from '@kaordo/media-client/clipboard';

export interface DraftAttachment {
	file: File;
	preview: string;
	altText: string;
}
export const editorMediaTypes = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'video/mp4',
	'video/webm',
	'video/quicktime'
];
export const emptyDocument = (): FluoDocument => ({
	type: 'doc',
	content: [{ type: 'paragraph' }]
});

export interface RichEditorOptions {
	label: string;
	placeholder: string;
	content?: FluoDocument;
	onChange: (editor: Editor) => void;
	onFiles: (files: File[]) => void;
}

export async function createRichEditor(
	element: HTMLDivElement,
	options: RichEditorOptions
): Promise<Editor> {
	const [{ Editor: EditorConstructor }, { default: StarterKit }, { Placeholder }, { FileHandler }] =
		await Promise.all([
			import('@tiptap/core'),
			import('@tiptap/starter-kit'),
			import('@tiptap/extension-placeholder'),
			import('@tiptap/extension-file-handler')
		]);
	return new EditorConstructor({
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
				underline: false
			}),
			Placeholder.configure({ placeholder: options.placeholder }),
			FileHandler.configure({
				allowedMimeTypes: editorMediaTypes,
				onPaste: (_editor, files) => options.onFiles(files),
				onDrop: (_editor, files) => options.onFiles(files)
			})
		],
		content: options.content ?? emptyDocument(),
		editorProps: {
			handlePaste: (_view, event) => {
				const clipboard = event.clipboardData;
				// FileHandler owns the standard path; Gecko can expose files through items alone
				if (!clipboard || clipboard.files.length) return false;
				const files = clipboardFiles(clipboard).filter((file) =>
					editorMediaTypes.includes(file.type)
				);
				if (!files.length) return false;
				options.onFiles(files);
				return !clipboard.getData('text/plain') && !clipboard.getData('text/html');
			},
			attributes: {
				role: 'textbox',
				'aria-multiline': 'true',
				'aria-label': options.label,
				class: 'outline-none'
			}
		},
		onUpdate: ({ editor }) => options.onChange(editor)
	});
}
