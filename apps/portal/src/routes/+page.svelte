<script lang="ts">
	// Loads the current account and composes the Kaordo application portal

	import { onMount } from "svelte";
	import {
		clearAccountPreview,
		createAccountSessionController,
		readAccountPreview,
		type AccountPreview,
		type AccountSnapshot,
	} from "@kaordo/account-ui";
	import { signOut } from "@kaordo/auth";
	import type { UserIdentity } from "@kaordo/contracts";
	import { appPaths } from "@kaordo/links";
	import { Button, LogOutIcon, ThemeToggle } from "@kaordo/ui";
	import PortalApps from "$lib/PortalApps.svelte";
	import PortalWelcome from "$lib/PortalWelcome.svelte";

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
			error = cause instanceof Error ? cause.message : "Could not sign out.";
		}
	}

	async function retryAccount(): Promise<void> {
		accountPreview = readAccountPreview();
		loading = true;
		await refreshAccount();
	}
</script>

<svelte:head><title>Kaordo</title></svelte:head>

<a
	href="#main-content"
	class="sr-only focus:not-sr-only fixed left-3 top-3 z-50 rounded-xl bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-lg ring-2 ring-ring focus:outline-none"
>
	Skip to main content
</a>

<main id="main-content" tabindex="-1" class="mx-auto max-w-6xl px-5 pb-16 pt-7 sm:px-8 sm:pt-10">
	<header class="flex flex-wrap items-center justify-between gap-4">
		<a
			class="inline-flex items-center gap-2 rounded-xl text-lg font-bold tracking-[-0.04em] text-primary focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring"
			href={appPaths.portal}
		>
			<span class="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">K</span>
			Kaordo
		</a>

		<div class="ml-auto flex items-center gap-2">
			{#if authenticated === null}
				{#if accountPreview}
					<Button variant="ghost" onclick={logOut}><LogOutIcon class="size-4" /> Sign out</Button>
				{:else}
					<div class="h-10 w-40 rounded-xl bg-muted/70" aria-hidden="true"></div>
				{/if}
			{:else if authenticated}
				<Button variant="ghost" onclick={logOut}><LogOutIcon class="size-4" /> Sign out</Button>
			{:else}
				<div class="flex gap-2">
					<Button href="/login/" variant="outline">Sign in</Button>
					<Button href="/register/">Create account</Button>
				</div>
			{/if}
			<ThemeToggle />
		</div>
	</header>

	<PortalWelcome
		{loading}
		{user}
		{authenticated}
		{accountPreview}
		onRetry={retryAccount}
	/>

	{#if error}
		<p class="mt-6 rounded-xl border border-destructive/30 bg-card p-4 text-sm text-destructive" role="alert">
			{error}
		</p>
	{/if}

	<PortalApps />
</main>
