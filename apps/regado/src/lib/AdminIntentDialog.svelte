<script lang="ts">
	// Confirms administrator actions with an auditable reason

	import { Button, Dialog, Input, Textarea } from '@kaordo/ui';
	import { intentDescription, minimumReasonLength, type AdminIntent } from './regado-model';

	let {
		intent,
		reason = $bindable(''),
		confirmation = $bindable(''),
		busy,
		error,
		onConfirm,
		onClose
	}: {
		intent: AdminIntent | null;
		reason?: string;
		confirmation?: string;
		busy: boolean;
		error: string;
		onConfirm: () => void;
		onClose: () => void;
	} = $props();

	const requiredReasonLength = minimumReasonLength;
	const reasonLength = $derived(reason.trim().length);
	const confirmationTarget = $derived(
		intent?.type === 'action' && intent.id === 'configure-storage' ? (intent.target ?? '') : ''
	);
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
			placeholder="Describe why this action is necessary"
		/>
		<p class="text-xs text-muted-foreground">
			{reasonLength}/500 characters · {requiredReasonLength} minimum
		</p>
		{#if confirmationTarget}
			<div class="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
				<p class="text-sm font-semibold text-destructive">
					{intent?.type === 'action' && intent.resumeSetup
						? 'This resumes the prepared data partition'
						: 'This changes the disk’s partition table'}
				</p>
				<label class="block text-sm" for="admin-target-confirmation">
					Type <span class="font-mono font-semibold">{confirmationTarget}</span> to confirm
				</label>
				<Input
					id="admin-target-confirmation"
					bind:value={confirmation}
					autocomplete="off"
					spellcheck="false"
				/>
			</div>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" disabled={busy} onclick={onClose}>Cancel</Button>
			<Button
				disabled={busy ||
					reasonLength < requiredReasonLength ||
					(!!confirmationTarget && confirmation !== confirmationTarget)}
				onclick={onConfirm}
			>
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
