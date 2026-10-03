<script lang="ts">
	// Confirms administrator actions with an auditable reason

	import { Button, Dialog, Textarea } from "@kaordo/ui";
	import { intentDescription, minimumReasonLength, type AdminIntent } from "./regado-model";

	let {
		intent,
		reason = $bindable(""),
		busy,
		error,
		onConfirm,
		onClose,
	}: {
		intent: AdminIntent | null;
		reason?: string;
		busy: boolean;
		error: string;
		onConfirm: () => void;
		onClose: () => void;
	} = $props();

	const requiredReasonLength = $derived(minimumReasonLength(intent));
	const reasonLength = $derived(reason.trim().length);
</script>

<Dialog.Root
	open={!!intent}
	onOpenChange={(open) => {
		if (!open && !busy) onClose();
	}}
>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{intent?.name || "Confirm action"}</Dialog.Title>
			<Dialog.Description>{intentDescription(intent)}</Dialog.Description>
		</Dialog.Header>
		<label class="block text-sm font-semibold" for="admin-reason">Reason</label>
		<Textarea
			id="admin-reason"
			bind:value={reason}
			maxlength={500}
			rows={4}
			placeholder="Describe why this action is necessary"
		/>
		<p class="text-xs text-muted-foreground">
			{reasonLength}/500 characters · {requiredReasonLength} minimum
		</p>
		<Dialog.Footer>
			<Button variant="outline" disabled={busy} onclick={onClose}>Cancel</Button>
			<Button
				disabled={busy || reasonLength < requiredReasonLength}
				onclick={onConfirm}
			>
				{busy ? "Working…" : "Confirm"}
			</Button>
		</Dialog.Footer>
		{#if error}
			<p class="rounded-xl border border-destructive/30 bg-destructive/7 p-3 text-sm text-destructive" role="alert">
				{error}
			</p>
		{/if}
	</Dialog.Content>
</Dialog.Root>
