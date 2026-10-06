<script lang="ts">
	// Selects, previews, describes, and removes draft media

	import { Button, XIcon } from "@kaordo/ui";
	import type { ComposerAttachment } from "./composer-model";

	let {
		files = $bindable<ComposerAttachment[]>([]),
		pending,
	}: {
		files?: ComposerAttachment[];
		pending: boolean;
	} = $props();

	function removeFile(index: number): void {
		const attachment = files[index];
		if (!attachment) return;
		URL.revokeObjectURL(attachment.preview);
		files = files.filter((_, fileIndex) => fileIndex !== index);
	}

	function updateAltText(index: number, value: string): void {
		files = files.map((attachment, fileIndex) =>
			fileIndex === index ? { ...attachment, altText: value } : attachment,
		);
	}
</script>

{#if files.length > 0}
	<ul class="mt-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:grid-cols-4" aria-label="Attachments">
		{#each files as attachment, index (attachment.preview)}
			<li class="group relative grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-muted/50 min-[420px]:block">
				<div class="flex h-24 items-center justify-center overflow-hidden bg-foreground min-[420px]:h-28">
					{#if attachment.file.type.startsWith("image/")}
						<img src={attachment.preview} alt="" class="h-full w-full object-cover" />
					{:else}
						<video src={attachment.preview} muted playsinline preload="metadata" class="h-full w-full object-contain" aria-hidden="true"></video>
					{/if}
				</div>
				<span class="block truncate px-2 py-1.5 pr-9 text-xs text-muted-foreground min-[420px]:pr-2">
					{attachment.file.name}
				</span>
				<details class="col-span-2 border-t border-border/70 px-2 py-2 text-xs">
					<summary class="cursor-pointer font-medium text-link underline-offset-4 hover:underline">
						{attachment.altText ? "Edit description" : "Add description"}
					</summary>
					<label class="mt-2 block font-medium" for={`fluo-alt-${index}`}>
						Description for {attachment.file.name}
					</label>
					<textarea
						id={`fluo-alt-${index}`}
						rows="2"
						maxlength="500"
						value={attachment.altText}
						disabled={pending}
						oninput={(event) => updateAltText(index, event.currentTarget.value)}
						class="mt-1 w-full resize-y rounded-lg border border-input bg-card px-2.5 py-2 text-sm leading-5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
						placeholder="Describe the media for people using a screen reader"
					></textarea>
				</details>
				<Button
					class="absolute right-1.5 top-1.5 rounded-full bg-card/95 shadow-sm"
					size="icon-xs"
					variant="outline"
					aria-label={`Remove ${attachment.file.name}`}
					disabled={pending}
					onclick={() => removeFile(index)}
				>
					<XIcon class="size-3.5" />
				</Button>
			</li>
		{/each}
	</ul>
{/if}
