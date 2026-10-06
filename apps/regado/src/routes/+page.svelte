<script lang="ts">
	// Restricts the Regado dashboard to authenticated administrator accounts

	import { AccountGate } from "@kaordo/account-ui";
	import { appPaths } from "@kaordo/links";
	import { ShieldCheckIcon } from "@kaordo/ui";
	import RegadoDashboard from "$lib/RegadoDashboard.svelte";
</script>

<svelte:head>
	<title>Regado · Kaordo</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<AccountGate
	appName="Regado"
	returnPath={appPaths.regado}
	environment={import.meta.env}
>
	{#snippet children(user)}
		{#if user.isAdmin}
			<RegadoDashboard {user} />
		{:else}
			<main
				class="mx-auto grid min-h-[70dvh] max-w-lg place-content-center px-6 text-center"
			>
				<div
					class="mx-auto grid size-16 place-items-center rounded-2xl bg-accent text-accent-foreground"
				>
					<ShieldCheckIcon class="size-8" />
				</div>
				<h1 class="mt-5 text-3xl font-bold tracking-tight">
					Administrator access required
				</h1>
				<p class="mt-3 text-muted-foreground">
					This space is available only to Kaordo administrators.
				</p>
				<a
					class="mt-6 font-semibold text-link underline-offset-4 hover:underline"
					href={appPaths.portal}>Back to Kaordo</a
				>
			</main>
		{/if}
	{/snippet}
</AccountGate>
