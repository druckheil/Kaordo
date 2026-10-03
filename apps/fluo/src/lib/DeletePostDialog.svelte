<script lang="ts">
	// Confirms destructive post removal and reports its progress

	import type { FluoPost } from "@kaordo/contracts";
	import { Button, Dialog } from "@kaordo/ui";

	let { post, error, deleting, onOpenChange, onConfirm }: {
		post: FluoPost | null;
		error: string;
		deleting: boolean;
		onOpenChange: (open: boolean) => void;
		onConfirm: () => void;
	} = $props();
</script>

<Dialog.Root open={!!post} onOpenChange={onOpenChange}>
	<Dialog.Content class="z-[70] max-w-[28rem] p-5 sm:p-6" showCloseButton={false}>
		<Dialog.Header>
			<Dialog.Title class="text-lg font-bold tracking-tight">Delete post?</Dialog.Title>
			<Dialog.Description class="leading-6 text-muted-foreground">
				This also removes its replies and attachments. This action cannot be undone.
			</Dialog.Description>
		</Dialog.Header>
		{#if error}
			<p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{error}</p>
		{/if}
		<Dialog.Footer class="flex flex-row justify-end gap-2">
			<Button variant="outline" disabled={deleting} onclick={() => onOpenChange(false)}>Cancel</Button>
			<Button variant="destructive" disabled={deleting} onclick={onConfirm}>
				{deleting ? "Deleting…" : "Delete post"}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
