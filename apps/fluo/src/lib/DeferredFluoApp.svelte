<script lang="ts">
  import { onMount } from 'svelte';
  import type { UserIdentity } from '@kaordo/contracts';
  import { Button } from '@kaordo/ui';

  let { user }: { user: UserIdentity } = $props();
  let App = $state.raw<typeof import('./FluoApp.svelte').default | null>(null);
  let failed = $state(false);

  function load() {
    failed = false;
    void import('./FluoApp.svelte')
      .then(({ default: component }) => { App = component; })
      .catch(() => { failed = true; });
  }

  onMount(load);
</script>

{#if App}
  <App {user} />
{:else if failed}
  <section class="mx-auto max-w-[46rem] rounded-3xl border border-border bg-card px-6 py-12 text-center" role="alert">
    <h1 class="text-xl font-bold">The feed could not open</h1>
    <p class="mt-2 text-sm text-muted-foreground">Check your connection and try again.</p>
    <Button class="mt-5" variant="outline" onclick={load}>Try again</Button>
  </section>
{:else}
  <section class="mx-auto max-w-[46rem]" role="status" aria-label="Opening your feed">
    <div class="h-9 w-28 animate-pulse rounded-lg bg-muted" aria-hidden="true"></div>
    <div class="mt-6 h-64 animate-pulse rounded-3xl border border-border bg-card" aria-hidden="true"></div>
    <span class="sr-only">Opening your feed…</span>
  </section>
{/if}
