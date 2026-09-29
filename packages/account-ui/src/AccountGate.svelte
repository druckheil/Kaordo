<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import type { UserIdentity } from '@kaordo/contracts';
  import { Button, ShieldCheckIcon } from '@kaordo/ui';
  import { createAccountSessionController, initialAccountSnapshot } from './session.js';
  import { readAccountPreview, type AccountPreview } from './session-preview.js';

  let {
    appName,
    returnPath,
    environment,
    children,
    preview
  }: {
    appName: string;
    returnPath: string;
    environment: Record<string, string | undefined>;
    children: Snippet<[UserIdentity]>;
    preview?: Snippet<[AccountPreview]>;
  } = $props();

  let controller: ReturnType<typeof createAccountSessionController> | undefined;
  let snapshot = $state(initialAccountSnapshot);
  let accountPreview = $state<AccountPreview | null>(null);

  function refresh() {
    controller ??= createAccountSessionController(environment);
    void controller.refresh((next) => {
      snapshot = next;
      if (!next.loading) accountPreview = readAccountPreview();
    });
  }

  onMount(() => {
    accountPreview = readAccountPreview();
    refresh();
    return () => controller?.dispose();
  });
</script>

{#if snapshot.loading}
  {#if accountPreview && preview}
    <div data-kaordo-preview aria-busy="true">{@render preview(accountPreview)}</div>
  {:else}
    <div class="mt-4 h-6 max-w-sm rounded-lg bg-muted/70" aria-hidden="true"></div>
    <p class="sr-only" role="status">Checking your account…</p>
  {/if}
{:else if snapshot.user}
  {@render children(snapshot.user)}
{:else}
  <section class="mt-8 max-w-lg rounded-2xl border bg-card p-6" aria-label={`${appName} account access`}>
    <ShieldCheckIcon class="size-6 text-primary" />
    <h2 class="mt-4 text-xl font-semibold">{snapshot.authenticated ? 'Account service unavailable' : `Sign in to ${appName}`}</h2>
    {#if snapshot.error}<p class="mt-3 text-sm text-destructive" role="alert">{snapshot.error}</p>{/if}
    {#if snapshot.authenticated}
      <Button class="mt-6" variant="outline" onclick={refresh}>Retry account setup</Button>
    {:else}
      <p class="mt-3 text-sm text-muted-foreground">Your Kaordo account works across every app.</p>
      <Button class="mt-6" href={`/login/?next=${encodeURIComponent(returnPath)}`}>Sign in</Button>
    {/if}
  </section>
{/if}
