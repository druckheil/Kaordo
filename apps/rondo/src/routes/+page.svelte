<script lang="ts">
  import { AccountGate } from '@kaordo/account-ui';
  import { appPaths } from '@kaordo/links';
  import RondoApp from '$lib/RondoApp.svelte';
</script>

<svelte:head><title>Rondo | Kaordo</title></svelte:head>

<AccountGate appName="Rondo" returnPath={appPaths.rondo} environment={import.meta.env}>
    {#snippet preview(account)}
      <p>Welcome back, {account.displayName}. Loading your communities…</p>
    {/snippet}
    {#snippet children(user)}
      <RondoApp {user} />
    {/snippet}
</AccountGate>
