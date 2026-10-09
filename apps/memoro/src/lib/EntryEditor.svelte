<script lang="ts">
	// Combines the shared rich editor with paste, file selection and attachment descriptions
	import { Button, ImagePlusIcon, Trash2Icon } from '@kaordo/ui';
	import {
		RichEditor,
		DraftAttachments,
		editorMediaTypes,
		type DraftAttachment
	} from '@kaordo/editor-ui';
	import { MediaGallery, type MediaAttachment } from '@kaordo/media-ui';
	import type { Entry } from '@kaordo/memoro-client';
	let {
		entry = $bindable(),
		files = $bindable([]),
		media = [],
		label,
		placeholder,
		pending = false,
		onChange
	}: {
		entry: Entry;
		files?: DraftAttachment[];
		media?: MediaAttachment[];
		label: string;
		placeholder: string;
		pending?: boolean;
		onChange: () => void;
	} = $props();
	let input: HTMLInputElement;
	let error = $state('');
	function addFiles(incoming: File[]) {
		error = '';
		if (incoming.some((file) => !editorMediaTypes.includes(file.type))) {
			error = 'Choose JPEG, PNG, WebP, MP4, WebM or MOV media.';
			return;
		}
		if (files.length + entry.media.length + incoming.length > 4) {
			error = 'Add at most four attachments to an entry.';
			return;
		}
		if (incoming.some((file) => !file.size || file.size > 99 * 1024 * 1024)) {
			error = 'Each attachment must be smaller than 99 MiB.';
			return;
		}
		files = [
			...files,
			...incoming.map((file) => ({ file, preview: URL.createObjectURL(file), altText: '' }))
		];
		onChange();
	}
	function remove(id: string) {
		entry = { ...entry, media: entry.media.filter((item) => item.id !== id) };
		onChange();
	}
</script>

<RichEditor
	bind:value={entry.content}
	{label}
	{placeholder}
	disabled={pending}
	onFiles={addFiles}
	{onChange}
/>
<input
	class="hidden"
	type="file"
	multiple
	accept={editorMediaTypes.join(',')}
	bind:this={input}
	onchange={() => {
		addFiles(Array.from(input.files ?? []));
		input.value = '';
	}}
/>
<div class="mt-2 flex items-center gap-3">
	<Button size="sm" variant="ghost" disabled={pending} onclick={() => input.click()}
		><ImagePlusIcon class="size-4" />Media</Button
	>
	<p class="text-xs text-muted-foreground">Paste or drop images and video</p>
</div>
{#if error}<p role="alert" class="mt-2 text-sm text-destructive">{error}</p>{/if}
<DraftAttachments bind:files {pending} />
{#if entry.media.length}<div class="mt-3 space-y-2">
		<MediaGallery
			media={media.filter((item) => entry.media.some((stored) => stored.id === item.id))}
		/>
		<div class="flex flex-wrap gap-1">
			{#each entry.media as item, index (item.id)}<Button
					size="sm"
					variant="ghost"
					disabled={pending}
					onclick={() => remove(item.id)}
					><Trash2Icon class="size-3.5" />Remove attachment {index + 1}</Button
				>{/each}
		</div>
	</div>{/if}
