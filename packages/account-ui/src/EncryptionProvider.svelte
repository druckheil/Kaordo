<script lang="ts">
	// Gates private content on device approval without sending decryption keys to the server
	import { setContext, untrack, type Snippet } from 'svelte';
	import {
		headerActionsContext,
		AppHeader,
		Button,
		Dialog,
		DropdownMenu,
		Input,
		Label,
		Checkbox,
		LockIcon,
		KeyRoundIcon,
		CheckIcon,
		DownloadIcon,
		ChevronDownIcon
	} from '@kaordo/ui';
	import { deviceFingerprint } from '@kaordo/crypto';
	import { createEncryptionState } from './encryption-state.svelte';

	let {
		apiBaseUrl,
		ownerId,
		appName,
		embedded,
		children
	}: {
		apiBaseUrl: string;
		ownerId: string;
		appName: string;
		embedded: boolean;
		children: Snippet;
	} = $props();
	const encryption = createEncryptionState(
		untrack(() => apiBaseUrl),
		untrack(() => ownerId)
	);
	setContext(headerActionsContext, () => securityAction);
	let devicesOpen = $state(false);
	let selected = $state<string | null>(null);
	let recoveryOpen = $state(false);
	let recoverySecret = $state('');
	let recoveryFileError = $state('');
	let replaceDeviceId = $state('');
	let savedRecovery = $state(false);
	let recoveryFile: HTMLInputElement;
	const pending = $derived(
		encryption.identity?.devices.filter((device) => !device.wrappedKeys) ?? []
	);
	const deviceLimit = $derived(
		!!encryption.identity &&
			encryption.identity.devices.length >= 20 &&
			!encryption.identity.devices.some((device) => device.id === encryption.deviceId)
	);
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
	async function chooseRecoveryFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		recoveryFileError = '';
		if (!file) return;
		if (file.size > 2048) {
			recoveryFileError = 'Choose the small JSON recovery file downloaded from Kaordo.';
			return;
		}
		try {
			recoverySecret = await file.text();
		} catch {
			recoveryFileError = 'The recovery file could not be read.';
		}
	}
	$effect(() => {
		if (!devicesOpen) {
			encryption.clearRecovery();
			savedRecovery = false;
		}
	});
	$effect(() => {
		if (!recoveryOpen) {
			recoverySecret = '';
			recoveryFileError = '';
			replaceDeviceId = '';
		}
	});
</script>

{#snippet securityAction()}
	{#if encryption.phase === 'ready'}
		<Button
			size="icon-sm"
			variant="ghost"
			class="relative"
			aria-label="Encryption and recovery"
			title="Encryption and recovery"
			onclick={() => (devicesOpen = true)}
		>
			<KeyRoundIcon class="size-4" />
			{#if pending.length}<span
					class="absolute -top-1 -right-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground"
					>{pending.length}</span
				>{/if}
		</Button>
	{/if}
{/snippet}

{#if encryption.phase === 'ready'}
	{@render children()}
{:else}
	{#if !embedded}<AppHeader name={appName} homeHref="/" />{/if}
	<svelte:element
		this={embedded ? 'section' : 'main'}
		id={embedded ? undefined : 'main-content'}
		tabindex="-1"
		class="mx-auto flex min-h-[70dvh] max-w-lg items-center px-5 py-10"
	>
		<section
			class="w-full rounded-3xl border border-border bg-card p-7 text-center shadow-sm"
			aria-busy={encryption.phase === 'loading'}
		>
			<div class="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
				<LockIcon class="size-7" />
			</div>
			<h1 class="mt-5 text-2xl font-bold tracking-tight">
				{encryption.phase === 'pending'
					? 'Approve this device'
					: encryption.phase === 'error'
						? 'Device encryption unavailable'
						: 'Opening encrypted data'}
			</h1>
			{#if encryption.phase === 'pending'}
				<p class="mt-3 text-sm leading-6 text-muted-foreground">
					Open Kaordo on an already approved device. Choose “Approve a device” and check that its
					fingerprint matches this one.
				</p>
				<p
					class="mt-5 rounded-xl bg-muted p-4 font-mono text-lg tracking-wide"
					aria-label="Device fingerprint"
				>
					{encryption.fingerprint}
				</p>
				<p class="mt-4 text-sm leading-6 text-muted-foreground">
					Your keys stay on your devices. Signing in alone cannot unlock existing private data.
				</p>
				<Button class="mt-5" variant="outline" onclick={() => (recoveryOpen = true)}
					>Use a recovery key</Button
				>
			{:else if encryption.phase === 'loading'}<p
					role="status"
					class="mt-3 text-sm text-muted-foreground"
				>
					Preparing your device keys…
				</p>{/if}
			{#if encryption.error}<p role="alert" class="mt-4 text-sm text-destructive">
					{encryption.error}
				</p>
				<Button class="mt-4" variant="outline" onclick={() => encryption.refresh()}>Retry</Button
				>{/if}
			{#if encryption.phase === 'error' && encryption.identity}<Button
					class="mt-4 ml-2"
					variant="outline"
					onclick={() => (recoveryOpen = true)}>Use a recovery key</Button
				>{/if}
		</section>
	</svelte:element>
{/if}

<Dialog.Root bind:open={devicesOpen}>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header
			><Dialog.Title>Encryption & recovery</Dialog.Title><Dialog.Description
				>Your devices hold the keys. Keep a recovery key separately in case every device is lost.</Dialog.Description
			></Dialog.Header
		>
		<div class="space-y-3">
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
			{:else}<p role="status" class="py-5 text-sm text-muted-foreground">
					All your devices are approved.
				</p>{/each}
			<section class="space-y-3 rounded-2xl border border-border p-4">
				<h2 class="font-semibold">Personal recovery key</h2>
				<p class="text-sm leading-6 text-muted-foreground">
					This key restores your encrypted data after you sign in, even without an approved device.
					Anyone with the key can unlock the data. Store it offline, separately from your devices.
				</p>
				{#if encryption.recovery}
					<Label.Root for="recovery-export">Keep this secret</Label.Root>
					<Input
						id="recovery-export"
						class="font-mono text-xs"
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
						onclick={() => encryption.prepareRecovery()}>Create or replace recovery key</Button
					>{/if}
			</section>
			{#if encryption.error}<p role="alert" class="text-sm text-destructive">
					{encryption.error}
				</p>{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={recoveryOpen}>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header
			><Dialog.Title>Restore your keys</Dialog.Title><Dialog.Description
				>Use the personal recovery secret or file you saved when recovery was activated. It stays on
				this device.</Dialog.Description
			></Dialog.Header
		>
		<div class="space-y-4">
			<Label.Root for="recovery-secret">Recovery secret</Label.Root>
			<Input
				id="recovery-secret"
				type="password"
				bind:value={recoverySecret}
				placeholder="Paste your recovery secret"
				autocomplete="off"
				spellcheck="false"
			/>
			{#if deviceLimit}
				<p class="text-sm text-muted-foreground">
					Your device list is full. Choose a lost device whose approval can be replaced. This does
					not erase data already opened on that device.
				</p>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						aria-label="Lost device to replace"
						class="flex min-h-10 w-full items-center justify-between rounded-xl border border-input px-3 text-sm"
						>{replaceDeviceId
							? `Device ${replaceDeviceId.slice(0, 8)}`
							: 'Choose a lost device'}<ChevronDownIcon class="size-4" /></DropdownMenu.Trigger
					>
					<DropdownMenu.Content class="w-(--bits-dropdown-menu-anchor-width)">
						<DropdownMenu.RadioGroup bind:value={replaceDeviceId}>
							{#each encryption.identity?.devices ?? [] as device (device.id)}<DropdownMenu.RadioItem
									value={device.id}
									>Device {device.id.slice(0, 8)} · {new Date(device.createdAt).toLocaleDateString(
										'en'
									)}</DropdownMenu.RadioItem
								>{/each}
						</DropdownMenu.RadioGroup>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/if}
			<input
				type="file"
				accept=".json,application/json"
				class="sr-only"
				tabindex="-1"
				bind:this={recoveryFile}
				onchange={chooseRecoveryFile}
			/>
			<div class="flex flex-wrap justify-between gap-2">
				<Button variant="outline" onclick={() => recoveryFile.click()}>Choose recovery file</Button
				><Button
					disabled={!recoverySecret.trim() || encryption.busy || (deviceLimit && !replaceDeviceId)}
					onclick={async () => {
						await encryption.recover(recoverySecret, replaceDeviceId || undefined);
						if (encryption.phase === 'ready') recoveryOpen = false;
					}}>Restore access</Button
				>
			</div>
			{#if encryption.error}<p role="alert" class="text-sm text-destructive">
					{encryption.error}
				</p>{/if}
			{#if recoveryFileError}<p role="alert" class="text-sm text-destructive">
					{recoveryFileError}
				</p>{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
