<script lang="ts">
  import { AccountGate } from '@kaordo/account-ui';
  import { appPaths } from '@kaordo/links';
  import LigoApp from '$lib/LigoApp.svelte';
</script>

<svelte:head><title>Ligo | Kaordo</title></svelte:head>

<AccountGate appName="Ligo" returnPath={appPaths.ligo} environment={import.meta.env}>
  {#snippet preview(account)}
    <p>Welcome back, {account.displayName}. Loading your conversations…</p>
  {/snippet}
  {#snippet children(user)}
    <LigoApp {user} />
  {/snippet}
</AccountGate>
