<script lang="ts">
  import { Button } from '@kaordo/ui';
  import { AccountGate } from '@kaordo/account-ui';
  import { appPaths } from '@kaordo/links';
</script>

<svelte:head><title>Regado | Kaordo</title></svelte:head>

<main class="mx-auto max-w-3xl p-8">
  <p class="text-sm text-muted-foreground">Kaordo 0.0.1</p>
  <h1 class="mt-2 text-3xl font-semibold">Regado</h1>
  <AccountGate appName="Regado" returnPath={appPaths.regado} environment={import.meta.env}>
    {#snippet preview(account)}
      <p class="mt-4 text-muted-foreground">Welcome, {account.displayName}. Administration requires a separate role check and is not available yet.</p>
    {/snippet}
    {#snippet children(user)}
      <p class="mt-4 text-muted-foreground">Welcome, {user.displayName}. Administration requires a separate role check and is not available yet.</p>
    {/snippet}
  </AccountGate>
  <Button href={appPaths.portal} rel="external" variant="outline" class="mt-8">Back to Kaordo</Button>
</main>
