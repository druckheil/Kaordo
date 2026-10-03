<script lang="ts">
	// Shows the portal introduction and the current account state

	import type { AccountPreview } from "@kaordo/account-ui";
	import type { UserIdentity } from "@kaordo/contracts";
	import { ArrowRightIcon, Button } from "@kaordo/ui";
	import { portalWelcomeMessage } from "./portal-model";

	let {
		loading,
		user,
		authenticated,
		accountPreview,
		onRetry,
	}: {
		loading: boolean;
		user: UserIdentity | null;
		authenticated: boolean | null;
		accountPreview: AccountPreview | null;
		onRetry: () => void;
	} = $props();

	const messageState = $derived(portalWelcomeMessage(loading, user, accountPreview));
</script>

<section class="relative mt-8 overflow-hidden rounded-[2rem] border border-border bg-card px-6 py-8 shadow-[0_24px_80px_-48px_rgba(21,75,43,.45)] sm:px-10 sm:py-10">
	<div class="pointer-events-none absolute -right-24 -top-28 size-80 rounded-full bg-accent blur-3xl" aria-hidden="true"></div>
	<div class="relative max-w-2xl">
		<p class="text-xs font-semibold uppercase tracking-[0.2em] text-primary">One space, many ways to connect</p>
		<h1 class="mt-4 text-4xl font-bold leading-[1.08] tracking-[-0.055em] sm:text-5xl">Your connected space.</h1>

		{#if messageState === "preview"}
			<p class="mt-6 text-base text-muted-foreground" data-kaordo-preview aria-busy="true">
				Welcome, {accountPreview?.displayName}.
			</p>
		{:else if messageState === "checking"}
			<div class="mt-6 h-6 w-48 animate-pulse rounded-lg bg-muted" aria-hidden="true"></div>
			<p class="sr-only" role="status">Checking your session…</p>
		{:else if messageState === "welcome"}
			<p class="mt-6 text-base leading-7 text-muted-foreground">
				Welcome, {user?.displayName}. Your apps are ready when you are.
			</p>
		{:else if authenticated}
			<p class="mt-6 text-base leading-7 text-muted-foreground">
				Your identity session is active, but the account service is unavailable.
			</p>
			<Button class="mt-5" variant="outline" onclick={onRetry}>Retry account setup</Button>
		{:else}
			<p class="mt-6 text-base leading-7 text-muted-foreground">
				Sign in once and move between your Kaordo apps.
			</p>
			<div class="mt-7 flex flex-wrap gap-3">
				<Button href="/login/">Sign in <ArrowRightIcon class="size-4" /></Button>
				<Button href="/register/" variant="outline">Create account</Button>
			</div>
		{/if}
	</div>
</section>
