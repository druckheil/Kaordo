<script lang="ts">
	// Gates the Fluo feed behind the shared account session

  import { AccountGate } from '@kaordo/account-ui';
  import { appPaths } from '@kaordo/links';
  import { AppHeader } from '@kaordo/ui';
  import DeferredFluoApp from '$lib/DeferredFluoApp.svelte';

  let backAction = $state<(() => void) | null>(null);

  function updateBackAction(action: (() => void) | null): void {
    backAction = action;
  }
</script>

<svelte:head><title>Fluo | Kaordo</title></svelte:head>

<div class="min-h-screen">
  <AppHeader name="Fluo" homeHref={appPaths.portal} sticky {backAction} />
  <main id="main-content" tabindex="-1" class="mx-auto max-w-6xl px-4 pt-7 sm:px-6 lg:pt-9">
    <AccountGate appName="Fluo" returnPath={appPaths.fluo} environment={import.meta.env}>
      {#snippet preview(account)}
        <p class="text-sm text-muted-foreground">Welcome back, {account.displayName}. Loading your feed…</p>
        <div class="mt-6 h-52 max-w-[46rem] animate-pulse rounded-[1.5rem] border border-border bg-card" aria-hidden="true"></div>
      {/snippet}
      {#snippet children(user)}
        <DeferredFluoApp {user} onBackActionChange={updateBackAction} />
      {/snippet}
    </AccountGate>
  </main>
</div>
