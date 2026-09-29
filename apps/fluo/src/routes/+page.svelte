<script lang="ts">
  import { AccountGate } from '@kaordo/account-ui';
  import { appPaths } from '@kaordo/links';
  import { Button } from '@kaordo/ui';
  import FluoApp from '$lib/FluoApp.svelte';
</script>

<svelte:head><title>Fluo | Kaordo</title></svelte:head>

<main class="mx-auto max-w-5xl px-4 py-8 sm:px-6">
  <header class="mb-8 flex items-center justify-between gap-4 border-b pb-5">
    <div>
      <p class="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Kaordo</p>
      <h1 class="text-3xl font-semibold tracking-tight">Fluo</h1>
    </div>
    <Button href={appPaths.portal} rel="external" variant="outline">All apps</Button>
  </header>
  <AccountGate appName="Fluo" returnPath={appPaths.fluo} environment={import.meta.env}>
    {#snippet preview(account)}
      <p class="text-sm text-muted-foreground">Welcome back, {account.displayName}. Loading your feed…</p>
      <div class="mt-6 h-40 rounded-2xl bg-muted/60" aria-hidden="true"></div>
    {/snippet}
    {#snippet children(user)}
      <FluoApp {user} />
    {/snippet}
  </AccountGate>
</main>
