<script lang="ts">
  // Gates an app on the account session and presents loading or recovery states

  import { onMount, type Snippet } from 'svelte';
  import type { UserIdentity } from '@kaordo/contracts';
  import { AppHeader, Button, ShieldCheckIcon } from '@kaordo/ui';
  import { createAccountSessionController, initialAccountSnapshot } from './session.js';
  import { readAccountPreview, type AccountPreview } from './session-preview.js';

  let {
    appName,
    returnPath,
    environment,
    children,
    preview,
    compact = false,
    embedded = false
  }: {
    appName: string;
    returnPath: string;
    environment: Record<string, string | undefined>;
    children: Snippet<[UserIdentity]>;
    preview?: Snippet<[AccountPreview]>;
    compact?: boolean;
    embedded?: boolean;
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

{#snippet accountState()}
{#if snapshot.loading}
  <section class={`mx-auto flex max-w-md flex-col items-center justify-center px-6 text-center ${compact ? 'min-h-48 py-8' : 'min-h-[min(34rem,80dvh)] py-12'}`}
    role="status" aria-busy="true">
    <div class="grid size-14 place-items-center rounded-2xl bg-accent text-accent-foreground shadow-sm" aria-hidden="true">
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
    <div class="mt-6 h-1.5 w-28 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div class="h-full w-1/2 animate-pulse rounded-full bg-primary"></div>
    </div>
  </section>
{:else}
  <section class="mx-auto my-8 max-w-lg rounded-3xl border border-border bg-card p-6 shadow-sm sm:my-12 sm:p-8"
    aria-label={`${appName} account access`}>
    <div class="grid size-12 place-items-center rounded-2xl bg-accent"><ShieldCheckIcon class="size-6 text-accent-foreground" /></div>
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
{/snippet}

{#if snapshot.user}
  {#key snapshot.user.id}
    {#await import('./AuthenticatedAccount.svelte')}
      <section role="status" class="mx-auto max-w-md px-6 py-12 text-center text-sm text-muted-foreground">Opening {appName}…</section>
    {:then { default: AuthenticatedAccount }}
      <AuthenticatedAccount user={snapshot.user} {appName} {embedded} {environment}>
        {@render children(snapshot.user)}
      </AuthenticatedAccount>
    {:catch}
      <section role="alert" class="mx-auto max-w-lg px-6 py-12 text-center"><h1 class="text-xl font-semibold">Device access could not load</h1><p class="mt-3 text-sm text-muted-foreground">Reload this page to try again.</p><Button class="mt-4" variant="outline" onclick={() => window.location.reload()}>Reload</Button></section>
    {/await}
  {/key}
{:else if embedded || compact}
  {@render accountState()}
{:else}
  <AppHeader name={appName} homeHref="/" />
  <main id="main-content" tabindex="-1" class="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
    {@render accountState()}
  </main>
{/if}
