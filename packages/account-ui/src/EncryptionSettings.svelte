<script lang="ts">
	// Approves waiting devices and manages the personal recovery key from Agordoj
	import { onMount } from 'svelte';
	import {
		Button,
		Checkbox,
		Input,
		Label,
		CheckIcon,
		DownloadIcon,
		KeyRoundIcon,
		MonitorSmartphoneIcon,
		ShieldCheckIcon,
		TriangleAlertIcon
	} from '@kaordo/ui';
	import { deviceFingerprint } from '@kaordo/crypto';
	import { getEncryptionState } from './encryption-state.svelte';

	const encryption = getEncryptionState();
	let selected = $state<string | null>(null);
	let savedRecovery = $state(false);
	const devices = $derived(encryption.identity?.devices ?? []);
	const pending = $derived(devices.filter((device) => !device.wrappedKeys));
	const approved = $derived(devices.length - pending.length);

	onMount(() => {
		void encryption.loadRecoveryStatus();
		// A displayed recovery secret must not outlive this page
		return () => encryption.clearRecovery();
	});

	function downloadRecovery() {
		if (!encryption.recovery) return;
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(encryption.recovery, null, 2)], { type: 'application/json' })
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'kaordo-recovery-key.json';
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
</script>

<div class="grid gap-6">
	<section
		class="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm"
		aria-labelledby="encryption-devices"
	>
		<div class="flex items-start gap-3">
			<span
				class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-link"
				aria-hidden="true"><MonitorSmartphoneIcon class="size-5" /></span
			>
			<div>
				<h2 id="encryption-devices" class="text-base font-semibold">Devices</h2>
				<p class="mt-1 text-sm leading-5 text-muted-foreground">
					{approved === 1 ? 'One approved device holds' : `${approved} approved devices hold`} your keys.
					Approve a new device only when its fingerprint matches the one it shows.
				</p>
			</div>
		</div>
		<div class="mt-4 grid gap-3">
			{#each pending as device (device.id)}
				<div class="rounded-2xl border border-border p-4">
					{#await deviceFingerprint(device.publicKey)}<p class="text-sm text-muted-foreground">
							Loading fingerprint…
						</p>{:then fingerprint}
						<p class="font-mono text-base tracking-wide">{fingerprint}</p>
						<p class="mt-1 text-xs text-muted-foreground">
							Requested {new Date(device.createdAt).toLocaleString('en')}
						</p>
						{#if selected === device.id}
							<p class="mt-4 text-sm">Does this fingerprint match your new device?</p>
							<div class="mt-3 flex gap-2">
								<Button disabled={encryption.busy} onclick={() => encryption.approve(device.id)}
									><CheckIcon class="size-4" />Approve</Button
								><Button variant="ghost" onclick={() => (selected = null)}>Cancel</Button>
							</div>
						{:else}<Button
								class="mt-3"
								size="sm"
								variant="outline"
								onclick={() => (selected = device.id)}>Compare fingerprint</Button
							>{/if}
					{/await}
				</div>
			{:else}<p role="status" class="text-sm text-muted-foreground">
					All your devices are approved.
				</p>{/each}
		</div>
	</section>

	<section
		class="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm"
		aria-labelledby="encryption-recovery"
	>
		<div class="flex items-start gap-3">
			<span
				class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-link"
				aria-hidden="true"><KeyRoundIcon class="size-5" /></span
			>
			<div>
				<h2 id="encryption-recovery" class="text-base font-semibold">Recovery key</h2>
				<p class="mt-1 text-sm leading-5 text-muted-foreground">
					This key restores your encrypted data after you sign in, even without an approved device.
					Anyone with the key can unlock the data. Store it offline, separately from your devices.
				</p>
			</div>
		</div>
		<div class="mt-4 flex flex-col items-start gap-3">
			{#if encryption.recoveryActive === true}
				<p role="status" class="flex items-center gap-2 text-sm">
					<ShieldCheckIcon class="size-4 shrink-0 text-link" />A recovery key is active.
				</p>
			{:else if encryption.recoveryActive === false}
				<p
					role="status"
					class="flex items-start gap-2 rounded-xl border border-destructive/35 p-3 text-sm text-destructive"
				>
					<TriangleAlertIcon class="mt-0.5 size-4 shrink-0" />No recovery key yet. If you lose every
					approved device, your private data cannot be restored.
				</p>
			{/if}
			{#if encryption.recovery}
				<Label.Root for="recovery-export">Keep this secret</Label.Root>
				<Input
					id="recovery-export"
					class="self-stretch font-mono text-xs"
					value={encryption.recovery.secret}
					readonly
					spellcheck="false"
					autocomplete="off"
				/>
				<Button variant="outline" onclick={downloadRecovery}
					><DownloadIcon class="size-4" />Download recovery file</Button
				>
				{#if encryption.recoveryReady}<p role="status" class="text-sm text-muted-foreground">
						Recovery is active. Keep the new key; older recovery secrets are replaced.
					</p>
				{:else}
					<div class="flex items-center gap-2">
						<Checkbox.Root
							id="recovery-saved"
							bind:checked={savedRecovery}
							class="grid size-5 shrink-0 place-items-center rounded-md border border-input data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
							>{#snippet children({ checked })}{#if checked}<CheckIcon
										class="size-3.5"
									/>{/if}{/snippet}</Checkbox.Root
						><Label.Root for="recovery-saved">I saved the key in a safe place</Label.Root>
					</div>
					<Button
						disabled={!savedRecovery || encryption.busy}
						onclick={() => encryption.activateRecovery()}>Activate recovery</Button
					>
				{/if}
			{:else}<Button
					variant="outline"
					disabled={encryption.busy}
					onclick={() => {
						savedRecovery = false;
						void encryption.prepareRecovery();
					}}>{encryption.recoveryActive ? 'Replace recovery key' : 'Create recovery key'}</Button
				>{/if}
			{#if encryption.error}<p role="alert" class="text-sm text-destructive">
					{encryption.error}
				</p>{/if}
		</div>
	</section>
</div>
