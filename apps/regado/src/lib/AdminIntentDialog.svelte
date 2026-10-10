<script lang="ts">
	// Confirms administrator actions with an auditable reason

	import { Button, Dialog, Textarea } from '@kaordo/ui';
	import { intentDescription, type AdminIntent } from './regado-model';

	let {
		intent,
		reason = $bindable(''),
		busy,
		error,
		onConfirm,
		onClose
	}: {
		intent: AdminIntent | null;
		reason?: string;
		busy: boolean;
		error: string;
		onConfirm: () => void;
		onClose: () => void;
	} = $props();

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
			<Dialog.Title>{intent?.name || 'Confirm action'}</Dialog.Title>
			<Dialog.Description>{intentDescription(intent)}</Dialog.Description>
		</Dialog.Header>
		<label class="block text-sm font-semibold" for="admin-reason">Reason</label>
		<Textarea
			id="admin-reason"
			bind:value={reason}
			maxlength={500}
			rows={4}
			placeholder="Optional reason for the audit log"
		/>
		<p class="text-xs text-muted-foreground">
			Optional · {reasonLength}/500 characters
		</p>
		<Dialog.Footer>
			<Button variant="outline" disabled={busy} onclick={onClose}>Cancel</Button>
			<Button disabled={busy || reasonLength > 500} onclick={onConfirm}>
				{busy ? 'Working…' : 'Confirm'}
			</Button>
		</Dialog.Footer>
		{#if error}
			<p
				class="rounded-xl border border-destructive/30 bg-destructive/7 p-3 text-sm text-destructive"
				role="alert"
			>
				{error}
			</p>
		{/if}
	</Dialog.Content>
</Dialog.Root>
