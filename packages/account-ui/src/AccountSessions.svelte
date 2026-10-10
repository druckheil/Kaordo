<script lang="ts">
	// Lists every signed-in session with its device's key status and the actions each one allows
	import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
	import {
		accountSessionsKey,
		accountSessionsOptions,
		createAccountSessionsApi,
		type AccountSession
	} from '@kaordo/api-client';
	import type { EncryptionDevice } from '@kaordo/contracts';
	import { deviceFingerprint } from '@kaordo/crypto';
	import {
		AlertDialog,
		Button,
		CheckIcon,
		LogOutIcon,
		MonitorIcon,
		SmartphoneIcon,
		Trash2Icon,
		TriangleAlertIcon
	} from '@kaordo/ui';
	import { getEncryptionState } from './encryption-state.svelte';

	type Confirmation =
		| { kind: 'session'; session: AccountSession; label: string }
		| { kind: 'others' }
		| { kind: 'keys'; device: EncryptionDevice; label: string };

	const encryption = getEncryptionState();
	const api = createAccountSessionsApi();
	const queryClient = useQueryClient();
	const sessions = createQuery(() => accountSessionsOptions(api));
	const signOut = createMutation(() => ({
		mutationFn: (session: AccountSession | null) =>
			session ? api.signOut(session.id) : api.signOutOthers(),
		onSettled: () => queryClient.invalidateQueries({ queryKey: accountSessionsKey })
	}));
	let confirmation = $state<Confirmation | null>(null);
	let comparing = $state<string | null>(null);

	const devices = $derived(encryption.identity?.devices ?? []);
	// The current session is this browser's device; others show the device that last reported them
	const rows = $derived(
		(sessions.data ?? []).map((session) => ({
			session,
			label: sessionLabel(session),
			device: devices.find((device) =>
				session.current
					? device.id === encryption.deviceId
					: device.id !== encryption.deviceId && device.sessionId === session.id
			)
		}))
	);
	const detached = $derived(
		sessions.data
			? devices.filter(
					(device) =>
						device.id !== encryption.deviceId &&
						!sessions.data.some((session) => session.id === device.sessionId)
				)
			: []
	);
	const others = $derived(rows.filter((row) => !row.session.current).length);

	function sessionLabel(session: AccountSession) {
		const [name = '', version = ''] = session.browser.split('/');
		const browser =
			!name || name === 'Other' ? 'Unknown browser' : `${name} ${version.split('.')[0]}`.trim();
		return session.os ? `${browser} on ${session.os}` : browser;
	}

	function when(value: number | string) {
		return new Date(value).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
	}

	function keyStatus(device: EncryptionDevice | undefined) {
		if (!device) return 'Has not opened private data in this session.';
		if (!device.wrappedKeys) return 'Waiting for approval or the recovery key.';
		const since = device.unlockedAt ? ` on ${when(device.unlockedAt)}` : '';
		switch (device.unlockedWith) {
			case 'recovery':
				return `Unlocked with the recovery key${since}.`;
			case 'device':
				return `Approved by another device${since}.`;
			case 'account':
				return `Created the account keys${since}.`;
			default:
				return 'Holds the account keys.';
		}
	}

	async function confirm() {
		const current = confirmation;
		if (!current) return;
		if (current.kind === 'keys') {
			if (await encryption.remove(current.device.id)) confirmation = null;
			return;
		}
		try {
			await signOut.mutateAsync(current.kind === 'session' ? current.session : null);
			confirmation = null;
		} catch {
			// The dialog stays open and shows the error
		}
	}
</script>

{#snippet keys(device: EncryptionDevice | undefined, label: string, current: boolean)}
	<div class="mt-3 rounded-xl bg-muted/60 p-3 text-sm">
		<p class={device && !device.wrappedKeys ? 'font-medium text-destructive' : ''}>
			{keyStatus(device)}
		</p>
		{#if device}
			{#await deviceFingerprint(device.publicKey) then fingerprint}
				<p class="mt-1 font-mono text-xs tracking-wide text-muted-foreground">
					Device fingerprint {fingerprint}
				</p>
			{/await}
			{#if !current && !device.wrappedKeys}
				{#if comparing === device.id}
					<p class="mt-3">Does this fingerprint match the one the new device shows?</p>
					<div class="mt-2 flex flex-wrap gap-2">
						<Button
							size="sm"
							disabled={encryption.busy}
							onclick={() => encryption.approve(device.id)}
							><CheckIcon class="size-4" />Approve</Button
						><Button size="sm" variant="ghost" onclick={() => (comparing = null)}>Cancel</Button>
					</div>
				{:else}
					<Button class="mt-3" size="sm" variant="outline" onclick={() => (comparing = device.id)}
						>Compare fingerprint</Button
					>
				{/if}
			{/if}
			{#if !current}
				<Button
					class="mt-3"
					size="sm"
					variant="ghost"
					onclick={() => (confirmation = { kind: 'keys', device, label })}
					><Trash2Icon class="size-4" />{device.wrappedKeys
						? 'Remove keys'
						: 'Remove request'}</Button
				>
			{/if}
		{/if}
	</div>
{/snippet}

<section
	class="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm"
	aria-labelledby="account-sessions"
>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 id="account-sessions" class="text-base font-semibold">Sessions</h2>
			<p class="mt-1 text-sm leading-5 text-muted-foreground">
				Every browser signed in to your account, and whether it can open your private data.
			</p>
		</div>
		{#if others > 0}
			<Button size="sm" variant="outline" onclick={() => (confirmation = { kind: 'others' })}
				><LogOutIcon class="size-4" />Sign out other sessions</Button
			>
		{/if}
	</div>

	{#if sessions.isPending}
		<p role="status" class="mt-4 text-sm text-muted-foreground">Loading sessions…</p>
	{:else if sessions.isError}
		<div class="mt-4 flex flex-wrap items-center gap-3">
			<p role="alert" class="text-sm text-destructive">{sessions.error.message}</p>
			<Button size="sm" variant="outline" onclick={() => sessions.refetch()}>Try again</Button>
		</div>
	{:else}
		<ul class="mt-4 grid gap-3" aria-label="Sessions">
			{#each rows as row (row.session.id)}
				{@const Icon = row.session.mobile ? SmartphoneIcon : MonitorIcon}
				<li class="rounded-2xl border border-border p-4" aria-label={row.label}>
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="flex min-w-0 items-start gap-3">
							<span
								class="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-link"
								aria-hidden="true"><Icon class="size-4" /></span
							>
							<div class="min-w-0">
								<p class="font-medium break-words">
									{row.label}{#if row.session.current}<span
											class="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-link"
											>This device</span
										>{/if}
								</p>
								<p class="text-sm text-muted-foreground">
									{row.session.device && row.session.device !== 'Other'
										? `${row.session.device} · `
										: ''}{row.session.ipAddress}
								</p>
							</div>
						</div>
						{#if !row.session.current}
							<Button
								size="sm"
								variant="outline"
								onclick={() =>
									(confirmation = { kind: 'session', session: row.session, label: row.label })}
								><LogOutIcon class="size-4" />Sign out</Button
							>
						{/if}
					</div>
					<dl class="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
						<div>
							<dt class="text-muted-foreground">Signed in</dt>
							<dd>{when(row.session.started)}</dd>
						</div>
						<div>
							<dt class="text-muted-foreground">Last active</dt>
							<dd>{when(row.session.lastAccess)}</dd>
						</div>
						<div>
							<dt class="text-muted-foreground">Expires</dt>
							<dd>{when(row.session.expires)}</dd>
						</div>
					</dl>
					{@render keys(row.device, row.label, row.session.current)}
				</li>
			{/each}
		</ul>
		{#if detached.length}
			<h3 class="mt-6 text-sm font-semibold">Devices without a session</h3>
			<p class="mt-1 text-sm leading-5 text-muted-foreground">
				These devices are signed out but keep their keys. Signing in there opens your private data
				again until you remove them.
			</p>
			<ul class="mt-3 grid gap-3" aria-label="Devices without a session">
				{#each detached as device (device.id)}
					{@const label = `Device added ${when(device.createdAt)}`}
					<li class="rounded-2xl border border-border p-4" aria-label={label}>
						<p class="font-medium">{label}</p>
						{@render keys(device, label, false)}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
	{#if encryption.error}<p role="alert" class="mt-3 text-sm text-destructive">
			{encryption.error}
		</p>{/if}
</section>

<AlertDialog.Root
	open={!!confirmation}
	onOpenChange={(open) => {
		if (!open) {
			confirmation = null;
			signOut.reset();
		}
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{#if confirmation?.kind === 'session'}Sign out {confirmation.label}?
				{:else if confirmation?.kind === 'others'}Sign out every other session?
				{:else if confirmation?.kind === 'keys'}{confirmation.device.wrappedKeys
						? `Remove the keys of ${confirmation.label}?`
						: `Remove the request from ${confirmation.label}?`}{/if}
			</AlertDialog.Title>
			<AlertDialog.Description>
				{#if confirmation?.kind === 'keys' && confirmation.device.wrappedKeys}
					That device can no longer open your private data, even after signing in again, until an
					approved device or your recovery key unlocks it. What it already displayed stays on it.
				{:else if confirmation?.kind === 'keys'}
					The device stops waiting for approval. It can ask again the next time it signs in.
				{:else}
					{confirmation?.kind === 'others' ? 'Every other browser' : 'That browser'} must sign in again.
					Its keys stay on the device unless you remove them.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		{#if signOut.isError}<p role="alert" class="flex items-start gap-2 text-sm text-destructive">
				<TriangleAlertIcon class="mt-0.5 size-4 shrink-0" />{signOut.error.message}
			</p>{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<Button
				variant="destructive"
				disabled={signOut.isPending || encryption.busy}
				onclick={confirm}
				>{confirmation?.kind === 'keys'
					? confirmation.device.wrappedKeys
						? 'Remove keys'
						: 'Remove request'
					: confirmation?.kind === 'others'
						? 'Sign out others'
						: 'Sign out'}</Button
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
