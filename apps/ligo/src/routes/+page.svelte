<script lang="ts">
  import { Button } from '@kaordo/ui';
  import { AccountGate } from '@kaordo/account-ui';
  import { appPaths } from '@kaordo/links';
</script>

<svelte:head><title>Ligo | Kaordo</title></svelte:head>

<main class="mx-auto max-w-3xl p-8">
  <p class="text-sm text-muted-foreground">Kaordo 0.0.1</p>
  <h1 class="mt-2 text-3xl font-semibold">Ligo</h1>
  <AccountGate appName="Ligo" returnPath={appPaths.ligo} environment={import.meta.env}>
    {#snippet children(user)}
      <p class="mt-4 text-muted-foreground">Signed in as {user.displayName}. Messaging is not available yet.</p>
    {/snippet}
  </AccountGate>
  <Button href={appPaths.portal} rel="external" variant="outline" class="mt-8">Back to Kaordo</Button>
</main>
