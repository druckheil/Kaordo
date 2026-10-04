<script lang="ts">
  // Gates an app on the account session and presents loading or recovery states

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
    preview,
    compact = false
  }: {
    appName: string;
    returnPath: string;
    environment: Record<string, string | undefined>;
    children: Snippet<[UserIdentity]>;
    preview?: Snippet<[AccountPreview]>;
    compact?: boolean;
  } = $props();

  let controller: ReturnType<typeof createAccountSessionController> | undefined;
  let snapshot = $state(initialAccountSnapshot);
  let accountPreview = $state<AccountPreview | null>(null);
  const accountDisabled = $derived(snapshot.error?.includes('This account is disabled.') ?? false);
  const accessHeading = $derived(
    accountDisabled ? 'Account disabled' :
      snapshot.authenticated ? 'Account service unavailable' : `Sign in to ${appName}`
  );

  function refresh() {
    controller ??= createAccountSessionController(environment);
    void controller.refresh(publishSnapshot);
  }

  function publishSnapshot(next: typeof snapshot) {
    snapshot = next;
    if (!next.loading) accountPreview = readAccountPreview();
  }

  onMount(() => {
    accountPreview = readAccountPreview();
    refresh();
    return () => controller?.dispose();
  });
</script>

{#if snapshot.loading}
  <section class={`mx-auto flex max-w-md flex-col items-center justify-center px-6 text-center ${compact ? 'min-h-48 py-8' : 'min-h-[min(34rem,80dvh)] py-12'}`}
    role="status" aria-busy="true">
    <div class="grid size-14 place-items-center rounded-2xl bg-accent text-primary shadow-sm" aria-hidden="true">
      <ShieldCheckIcon class="size-7" />
    </div>
    <svelte:element this={compact ? 'h2' : 'h1'} class="mt-5 text-xl font-bold tracking-tight">
      Opening {appName}
    </svelte:element>
    {#if accountPreview && preview}
      <div data-kaordo-preview class="mt-2 w-full text-sm text-muted-foreground">{@render preview(accountPreview)}</div>
    {:else}
      <p class="mt-2 text-sm text-muted-foreground">Checking your account…</p>
    {/if}
    <div class="mt-6 h-1.5 w-28 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
      <div class="h-full w-1/2 animate-pulse rounded-full bg-primary"></div>
    </div>
  </section>
{:else if snapshot.user}
  {@render children(snapshot.user)}
{:else}
  <section class="mx-auto mt-12 max-w-lg rounded-[1.75rem] border border-border bg-card p-7 shadow-xl sm:p-9"
    aria-label={`${appName} account access`}>
    <div class="grid size-12 place-items-center rounded-2xl bg-accent"><ShieldCheckIcon class="size-6 text-primary" /></div>
    <svelte:element this={compact ? 'h2' : 'h1'} class="mt-6 text-2xl font-bold tracking-[-0.04em]">
      {accessHeading}
    </svelte:element>
    {#if snapshot.error}<p class="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive" role="alert">{snapshot.error}</p>{/if}
    {#if accountDisabled}
      <p class="mt-3 text-sm leading-6 text-muted-foreground">Access to this Kaordo account has been disabled. Contact an administrator if you believe this is an error.</p>
    {:else if snapshot.authenticated}
      <p class="mt-3 text-sm leading-6 text-muted-foreground">We could not connect your Kaordo account. Try again when the service is available.</p>
      <Button class="mt-6" variant="outline" onclick={refresh}>Retry account setup</Button>
    {:else}
      <p class="mt-3 text-sm leading-6 text-muted-foreground">One Kaordo account gives you access across the apps.</p>
      <Button class="mt-6" href={`/login/?next=${encodeURIComponent(returnPath)}`}>Sign in</Button>
    {/if}
  </section>
{/if}
