<script lang="ts">
	// Gates the Rondo workspace behind the shared account session

	import { AccountGate } from '@kaordo/account-ui';
	import { appPaths } from '@kaordo/links';
	import RondoApp from '$lib/RondoApp.svelte';
</script>

<svelte:head>
	<title>Rondo | Kaordo</title>
</svelte:head>

<AccountGate appName="Rondo" returnPath={appPaths.rondo} environment={import.meta.env}>
	{#snippet preview(account: import('@kaordo/account-ui').AccountPreview)}
		<p>Welcome back, {account.displayName}. Loading your communities…</p>
	{/snippet}
	{#snippet children(user: import('@kaordo/contracts').UserIdentity)}
		<RondoApp {user} />
	{/snippet}
</AccountGate>
