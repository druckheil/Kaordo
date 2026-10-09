<script lang="ts">
	// Opens the private language workspace through the shared account gate
	import { AccountGate } from '@kaordo/account-ui';
	import { appPaths } from '@kaordo/links';
	import LingvoApp from '$lib/LingvoApp.svelte';
</script>

<svelte:head><title>Lingvo | Kaordo</title></svelte:head>

<AccountGate appName="Lingvo" returnPath={appPaths.lingvo} environment={import.meta.env}>
	{#snippet preview(account: import('@kaordo/account-ui').AccountPreview)}
		<p>Welcome back, {account.displayName}. Preparing your dictionaries…</p>
	{/snippet}
	{#snippet children(user: import('@kaordo/contracts').UserIdentity)}<LingvoApp {user} />{/snippet}
</AccountGate>
