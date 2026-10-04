<script lang="ts">
	// Opens the hosted identity form directly and presents recoverable navigation errors

	import { onMount } from "svelte";
	import { authConfigFromEnv, createAuthenticationUrl } from "@kaordo/auth";
	import { clearAccountPreview } from "@kaordo/account-ui";
	import { appPaths } from "@kaordo/links";
	import { AppHeader, Button, LoaderCircleIcon, withIdentityAppearance } from "@kaordo/ui";
	import { authModeCopy, resolveIdentityReturnPath, type AuthMode } from "./portal-model";

	let { mode }: { mode: AuthMode } = $props();
	let error = $state<string | null>(null);
	let returnPath = $state<string>(appPaths.portal);
	let identityRequestPending = false;
	let active = false;

	const copy = $derived(authModeCopy[mode]);
	const alternateModeHref = $derived(
		`${copy.otherModePath}?next=${encodeURIComponent(returnPath)}`,
	);

	onMount(() => {
		active = true;
		returnPath = resolveIdentityReturnPath(
			new URL(window.location.href).searchParams.get("next"),
			Object.values(appPaths),
			appPaths.portal,
		);
		void openIdentity();
		return () => { active = false; };
	});

	async function openIdentity(): Promise<void> {
		if (identityRequestPending) return;
		identityRequestPending = true;
		error = null;
		try {
			clearAccountPreview();
			const url = await createAuthenticationUrl(
				authConfigFromEnv(import.meta.env), mode, window.location.origin + returnPath,
			);
			if (active) window.location.replace(withIdentityAppearance(url));
		} catch (cause) {
			if (active) error = cause instanceof Error ? cause.message : "Unable to open Kaordo Identity.";
		} finally {
			identityRequestPending = false;
		}
	}
</script>

<svelte:head>
	<title>{copy.pageTitle}</title>
	<meta name="description" content="Access your Kaordo account." />
</svelte:head>

<AppHeader name={copy.accessibleName} homeHref={appPaths.portal} />
<main id="main-content" tabindex="-1" class="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-lg place-content-center px-5 py-12">
	{#if error}
		<section class="rounded-2xl border border-border bg-card p-6 shadow-sm" aria-label={copy.accessibleName}>
			<h1 class="text-xl font-semibold tracking-tight">{copy.failureMessage}</h1>
			<p class="mt-3 break-words text-sm text-destructive" role="alert">{error}</p>
			<div class="mt-6 flex flex-wrap gap-2">
				<Button onclick={openIdentity}>Try again</Button>
				<Button href={appPaths.portal} variant="outline">Back to Kaordo</Button>
			</div>
			<p class="mt-6 text-sm text-muted-foreground">
				{copy.otherModePrompt}
				<Button href={alternateModeHref} variant="link" class="h-auto px-1 py-0 align-baseline text-sm">
					{copy.otherModeLabel}
				</Button>
			</p>
		</section>
	{:else}
		<div class="flex items-center gap-3" role="status" aria-busy="true">
			<LoaderCircleIcon class="size-5 shrink-0 animate-spin text-link motion-reduce:animate-none" aria-hidden="true" />
			<h1 class="text-lg font-semibold">{copy.openingMessage}</h1>
		</div>
	{/if}
</main>
