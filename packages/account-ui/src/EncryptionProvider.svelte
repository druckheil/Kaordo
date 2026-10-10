<script lang="ts">
	// Gates private content on device approval without sending decryption keys to the server
	import { setContext, untrack, type Snippet } from 'svelte';
	import { agordojPaths } from '@kaordo/links';
	import {
		settingsNoticeContext,
		AppHeader,
		Button,
		Dialog,
		DropdownMenu,
		Input,
		Label,
		LockIcon,
		ChevronDownIcon,
		type SettingsNoticeSource
	} from '@kaordo/ui';
	import { createEncryptionState, setEncryptionState } from './encryption-state.svelte';

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
	setEncryptionState(encryption);
	let recoveryOpen = $state(false);
	let recoverySecret = $state('');
	let recoveryFileError = $state('');
	let replaceDeviceId = $state('');
	let recoveryFile: HTMLInputElement;
	const pending = $derived(
		encryption.phase === 'ready'
			? (encryption.identity?.devices.filter((device) => !device.wrappedKeys).length ?? 0)
			: 0
	);
	// Devices waiting for approval point the shared settings link at Agordoj's encryption section
	setContext<SettingsNoticeSource>(settingsNoticeContext, () =>
		pending
			? {
					count: pending,
					label:
						pending === 1 ? '1 device awaiting approval' : `${pending} devices awaiting approval`,
					href: agordojPaths.encryption
				}
			: undefined
	);
	const deviceLimit = $derived(
		!!encryption.identity &&
			encryption.identity.devices.length >= 20 &&
			!encryption.identity.devices.some((device) => device.id === encryption.deviceId)
	);
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
		if (!recoveryOpen) {
			recoverySecret = '';
			recoveryFileError = '';
			replaceDeviceId = '';
		}
	});
</script>

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
					On an already approved device, open Agordoj, then Encryption & recovery, and approve the
					request whose fingerprint matches this one.
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
