<script lang="ts">
	// Loads the current account and composes the Kaordo application portal

	import { onMount } from 'svelte';
	import {
		clearAccountPreview,
		createAccountSessionController,
		readAccountPreview,
		type AccountPreview,
		type AccountSnapshot
	} from '@kaordo/account-ui';
	import { signOut } from '@kaordo/auth';
	import type { UserIdentity } from '@kaordo/contracts';
	import { appPaths } from '@kaordo/links';
	import { AppHeader, Button, LogOutIcon } from '@kaordo/ui';
	import PortalApps from '$lib/PortalApps.svelte';
	import PortalWelcome from '$lib/PortalWelcome.svelte';

	const accountSession = createAccountSessionController(import.meta.env);

	let user = $state<UserIdentity | null>(null);
	let authenticated = $state<boolean | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(true);
	let accountPreview = $state<AccountPreview | null>(null);

	function applyAccountSnapshot(result: AccountSnapshot): void {
		user = result.user;
		authenticated = result.loading ? null : result.authenticated;
		error = result.loading ? null : result.error;
		if (!result.loading) accountPreview = readAccountPreview();
		loading = result.loading;
	}

	function refreshAccount(): Promise<void> {
		return accountSession.refresh(applyAccountSnapshot);
	}

	onMount(() => {
		accountPreview = readAccountPreview();
		void refreshAccount();
		return () => accountSession.dispose();
	});

	async function logOut(): Promise<void> {
		accountSession.cancelPending();
		clearAccountPreview();
		accountPreview = null;

		try {
			await signOut(window.location.origin + appPaths.portal);
		} catch (cause) {
			await refreshAccount();
			error = cause instanceof Error ? cause.message : 'Could not sign out.';
		}
	}

	async function retryAccount(): Promise<void> {
		accountPreview = readAccountPreview();
		loading = true;
		await refreshAccount();
	}
</script>

<svelte:head><title>Kaordo</title></svelte:head>

<AppHeader name="" homeHref={appPaths.portal} showAllApps={false}>
	{#snippet actions()}
		{#if authenticated || (authenticated === null && accountPreview)}
			<Button variant="ghost" size="sm" onclick={logOut} aria-label="Sign out"
				><LogOutIcon class="size-4" /><span class="hidden min-[390px]:inline">Sign out</span
				></Button
			>
		{:else if authenticated !== null}
			<Button href="/login/" variant="outline" size="sm">Sign in</Button>
		{/if}
	{/snippet}
</AppHeader>

<main id="main-content" tabindex="-1" class="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
	<PortalWelcome {loading} {user} {authenticated} {accountPreview} onRetry={retryAccount} />

	{#if error}
		<p
			class="mt-6 rounded-xl border border-destructive/30 bg-card p-4 text-sm text-destructive"
			role="alert"
		>
			{error}
		</p>
	{/if}

	<PortalApps />
</main>
