<script lang="ts">
	// Controls post formatting and visibility options

	import type { Editor } from "@tiptap/core";
	import { BoldIcon, Button, ItalicIcon, StrikethroughIcon, XIcon } from "@kaordo/ui";

	let {
		editor,
		visibility = $bindable("public"),
		pending,
		replying,
		open,
		onClose,
	}: {
		editor: Editor | null;
		visibility?: "public" | "private";
		pending: boolean;
		replying: boolean;
		open: boolean;
		onClose: () => void;
	} = $props();
</script>

<div id="fluo-post-options" hidden={!open} class="mt-4 rounded-xl border border-border bg-muted/35 p-3">
	<div class="flex items-center justify-between gap-2">
		<p class="text-xs font-semibold text-muted-foreground">Post options</p>
		<Button variant="ghost" size="icon-xs" aria-label="Close post options" disabled={pending} onclick={onClose}>
			<XIcon class="size-4" />
		</Button>
	</div>
	<div class="mt-2 flex flex-wrap items-center justify-between gap-3">
		<div class="flex gap-1" aria-label="Text formatting">
			<Button variant="ghost" size="icon-sm" aria-label="Bold" aria-pressed={editor?.isActive("bold") ?? false}
				disabled={!editor || pending} onclick={() => editor?.chain().focus().toggleBold().run()}>
				<BoldIcon class="size-4" />
			</Button>
			<Button variant="ghost" size="icon-sm" aria-label="Italic" aria-pressed={editor?.isActive("italic") ?? false}
				disabled={!editor || pending} onclick={() => editor?.chain().focus().toggleItalic().run()}>
				<ItalicIcon class="size-4" />
			</Button>
			<Button variant="ghost" size="icon-sm" aria-label="Strike through" aria-pressed={editor?.isActive("strike") ?? false}
				disabled={!editor || pending} onclick={() => editor?.chain().focus().toggleStrike().run()}>
				<StrikethroughIcon class="size-4" />
			</Button>
		</div>
		<select aria-label="Post visibility" bind:value={visibility} disabled={pending || replying}
			class="h-9 rounded-xl border border-input bg-card px-3 text-xs font-medium focus-visible:outline-3 focus-visible:outline-ring">
			<option value="public">Public</option>
			<option value="private">Only me</option>
		</select>
	</div>
	<p class="mt-2 text-xs text-muted-foreground">Your account privacy also applies to posts and replies.</p>
	{#if replying}
		<p class="mt-2 text-xs text-muted-foreground">Replies use the original post&apos;s visibility.</p>
	{/if}
</div>
