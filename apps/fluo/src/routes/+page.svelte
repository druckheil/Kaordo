<script lang="ts">
  import { AccountGate } from '@kaordo/account-ui';
  import { appPaths } from '@kaordo/links';
  import { ArrowUpRightIcon, Button } from '@kaordo/ui';
  import FluoApp from '$lib/FluoApp.svelte';
</script>

<svelte:head><title>Fluo | Kaordo</title></svelte:head>

<div class="min-h-screen">
  <header class="sticky top-0 z-20 border-b border-border/80 bg-background/90 backdrop-blur-xl">
    <div class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
      <div class="flex items-baseline gap-2">
        <a href={appPaths.portal} rel="external" class="text-sm font-bold tracking-[-0.03em] text-primary">Kaordo</a>
        <span class="text-muted-foreground/60" aria-hidden="true">/</span>
        <h1 class="text-lg font-bold tracking-[-0.04em]">Fluo</h1>
      </div>
      <Button href={appPaths.portal} rel="external" variant="ghost" size="sm">All apps <ArrowUpRightIcon class="size-4" /></Button>
    </div>
  </header>
  <main class="mx-auto max-w-6xl px-4 pt-7 sm:px-6 lg:pt-9">
    <AccountGate appName="Fluo" returnPath={appPaths.fluo} environment={import.meta.env}>
      {#snippet preview(account)}
        <p class="text-sm text-muted-foreground">Welcome back, {account.displayName}. Loading your feed…</p>
        <div class="mt-6 h-52 max-w-[46rem] animate-pulse rounded-[1.5rem] border border-border bg-card" aria-hidden="true"></div>
      {/snippet}
      {#snippet children(user)}
        <FluoApp {user} />
      {/snippet}
    </AccountGate>
  </main>
</div>
