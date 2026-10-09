<script lang="ts">
	// Edits a shared rich-text document with bounded native scrolling
	import { onMount } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import type { FluoDocument } from '@kaordo/contracts';
	import FormattingToolbar from './FormattingToolbar.svelte';
	import { createRichEditor, emptyDocument } from './editor';

	let {
		value = $bindable(emptyDocument()),
		label,
		placeholder,
		disabled = false,
		onFiles,
		onChange
	}: {
		value?: FluoDocument;
		label: string;
		placeholder: string;
		disabled?: boolean;
		onFiles: (files: File[]) => void;
		onChange?: () => void;
	} = $props();
	let element: HTMLDivElement;
	let editor = $state.raw<Editor | null>(null);
	let error = $state('');

	onMount(() => {
		let active = true;
		let instance: Editor | undefined;
		void createRichEditor(element, {
			label,
			placeholder,
			content: value,
			onFiles,
			onChange: (current) => {
				value = current.getJSON() as FluoDocument;
				onChange?.();
			}
		})
			.then((current) => {
				if (!active) {
					current.destroy();
					return;
				}
				instance = current;
				editor = current;
			})
			.catch(() => {
				if (active) error = 'The text editor could not load. Reload to try again.';
			});
		return () => {
			active = false;
			instance?.destroy();
		};
	});
	$effect(() => {
		editor?.setEditable(!disabled);
	});
	$effect(() => {
		if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(value))
			editor.commands.setContent(value, { emitUpdate: false });
	});
</script>

<div class="min-w-0 rounded-2xl border border-[var(--control-border)] bg-background">
	<div
		class="kaordo-scrollbar max-h-[min(24rem,45dvh)] overflow-y-auto overscroll-contain rounded-t-2xl px-4 py-3 [scrollbar-gutter:stable]"
	>
		{#if !editor && !error}<p role="status" class="text-sm text-muted-foreground">
				Loading editor…
			</p>{/if}
		<div
			class="editor-surface min-w-0 text-[15px] leading-7 wrap-anywhere"
			bind:this={element}
		></div>
		{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
	</div>
	<div class="border-t border-border/60 px-2 py-1.5"><FormattingToolbar {editor} {disabled} /></div>
</div>

<style>
	.editor-surface :global(.tiptap) {
		min-width: 0;
		min-height: 4lh;
		outline: none;
	}
	.editor-surface :global(.tiptap p + p) {
		margin-top: 0.6rem;
	}
	.editor-surface :global(.tiptap p.is-editor-empty:first-child::before) {
		color: var(--muted-foreground);
		content: attr(data-placeholder);
		float: left;
		height: 0;
		pointer-events: none;
	}
</style>
