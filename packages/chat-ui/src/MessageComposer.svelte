<script lang="ts">
	// Composes text and attachment messages

	import { Button, PaperclipIcon, SendIcon, Textarea } from "@kaordo/ui";
	import { clipboardFiles } from '@kaordo/media-client/clipboard';
	import DraftAttachment from "./DraftAttachment.svelte";

	let {
		draft = $bindable(""),
		files = $bindable<File[]>([]),
		actionError = $bindable(""),
		maxAttachments,
		maxCharacters,
		placeholder = "Write a message…",
		showHint = true,
		onSend,
	}: {
		draft?: string;
		files?: File[];
		actionError?: string;
		maxAttachments: number;
		maxCharacters: number;
		placeholder?: string;
		showHint?: boolean;
		onSend: () => void;
	} = $props();

	let fileInput = $state<HTMLInputElement>();

	function chooseFiles(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		addFiles(Array.from(input.files ?? []));
		input.value = "";
	}

	function addFiles(selectedFiles: File[]): void {
		if (!selectedFiles.length) return;

		if (files.length + selectedFiles.length > maxAttachments) {
			actionError = `Attach at most ${maxAttachments} files.`;
		} else {
			files = [...files, ...selectedFiles];
			actionError = "";
		}
	}

	function handlePaste(event: ClipboardEvent): void {
		const clipboard = event.clipboardData;
		const pastedFiles = clipboardFiles(clipboard);
		if (!clipboard || !pastedFiles.length) return;

		addFiles(pastedFiles);
		if (!clipboard.getData("text/plain")) event.preventDefault();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
		event.preventDefault();
		onSend();
	}

	function removeFile(index: number): void {
		files = files.filter((_, fileIndex) => fileIndex !== index);
	}
</script>

<div class="shrink-0 border-t border-border/75 bg-card/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-xl sm:px-6">
	{#if files.length}
		<div
			class={`kaordo-scrollbar mb-3 grid max-h-56 gap-2 overflow-y-auto ${files.length === 1 ? "max-w-60 grid-cols-1" : files.length === 2 ? "max-w-[32rem] grid-cols-2" : "grid-cols-2 sm:grid-cols-4"}`}
			aria-label="Selected attachments"
		>
			{#each files as file, index (file)}
				<DraftAttachment {file} remove={() => removeFile(index)} />
			{/each}
		</div>
	{/if}

	{#if actionError}
		<p class="mb-2 text-sm text-destructive" role="alert">{actionError}</p>
	{/if}

	<div class="flex items-end gap-2 rounded-[1.25rem] border border-[var(--control-border)] bg-background p-2 shadow-sm transition-[box-shadow,border-color] focus-within:ring-2 focus-within:ring-ring/20">
		<input
			bind:this={fileInput}
			type="file"
			tabindex="-1"
			multiple
			class="sr-only"
			aria-label="Choose files"
			onchange={chooseFiles}
		/>
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label="Attach files"
			disabled={files.length >= maxAttachments}
			onclick={() => fileInput?.click()}
		>
			<PaperclipIcon class="size-5" />
		</Button>
		<Textarea
			bind:value={draft}
			onkeydown={handleKeydown}
			onpaste={handlePaste}
			maxlength={maxCharacters}
			rows={1}
			{placeholder}
			aria-label="Write a message"
			class="kaordo-scrollbar min-h-9 max-h-36 min-w-0 flex-1 overflow-y-auto border-0 bg-transparent px-1 py-2 text-sm leading-5 shadow-none focus-visible:ring-0"
		/>
		<Button
			size="icon-sm"
			aria-label="Send message"
			disabled={!draft.trim() && !files.length}
			onclick={onSend}
		>
			<SendIcon class="size-4" />
		</Button>
	</div>

	{#if showHint}
		<p class="mt-1.5 hidden text-center text-xs text-muted-foreground sm:block">
			Enter to send · Shift+Enter for a new line
		</p>
	{/if}
</div>
