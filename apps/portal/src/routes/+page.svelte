<script lang="ts">
  import { onMount } from 'svelte';
  import { appPaths } from '@kaordo/links';
  import { signOut } from '@kaordo/auth';
  import { clearAccountPreview, createAccountSessionController, readAccountPreview, type AccountPreview } from '@kaordo/account-ui';
  import { ArrowRightIcon, ArrowUpRightIcon, Button, LogOutIcon } from '@kaordo/ui';
  import type { UserIdentity } from '@kaordo/contracts';

  const upcoming = [
    { name: 'Ligo', description: 'Messages' },
    { name: 'Rondo', description: 'Communities' },
    { name: 'Regado', description: 'Administration' }
  ];
  const accountSession = createAccountSessionController(import.meta.env);

  let user = $state<UserIdentity | null>(null);
  let authenticated = $state<boolean | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let accountPreview = $state<AccountPreview | null>(null);

  function refreshAccount(): Promise<void> {
    return accountSession.refresh((result) => {
      user = result.user;
      authenticated = result.loading ? null : result.authenticated;
      error = result.loading ? null : result.error;
      if (!result.loading) accountPreview = readAccountPreview();
      loading = result.loading;
    });
  }

  onMount(() => {
    accountPreview = readAccountPreview();
    void refreshAccount();
    return () => accountSession.dispose();
  });

  async function logOut() {
    accountSession.cancelPending();
    clearAccountPreview();
    accountPreview = null;
    try {
      await signOut(window.location.origin + appPaths.portal);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not sign out.';
      await refreshAccount();
      error = cause instanceof Error ? cause.message : 'Could not sign out.';
    }
  }

  async function retryAccount() {
    accountPreview = readAccountPreview();
    loading = true;
    await refreshAccount();
  }
</script>

<svelte:head><title>Kaordo</title></svelte:head>

<main class="mx-auto max-w-6xl px-5 pb-16 pt-7 sm:px-8 sm:pt-10">
  <header class="flex flex-wrap items-center justify-between gap-4">
    <a class="inline-flex items-center gap-2 text-lg font-bold tracking-[-0.04em] text-primary" href={appPaths.portal}>
      <span class="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">K</span> Kaordo
    </a>
    {#if authenticated === null}
      {#if accountPreview}
        <Button variant="ghost" onclick={logOut}><LogOutIcon class="size-4" /> Sign out</Button>
      {:else}
        <div class="h-10 w-40 rounded-xl bg-muted/70" aria-hidden="true"></div>
      {/if}
    {:else if authenticated}
      <Button variant="ghost" onclick={logOut}><LogOutIcon class="size-4" /> Sign out</Button>
    {:else}
      <div class="flex gap-2">
        <Button href="/login/" variant="outline">Sign in</Button>
        <Button href="/register/">Create account</Button>
      </div>
    {/if}
  </header>

  <section class="relative mt-10 overflow-hidden rounded-[2rem] border border-border bg-card px-6 py-10 shadow-[0_24px_80px_-48px_rgba(21,75,43,.45)] sm:px-10 sm:py-14">
    <div class="pointer-events-none absolute -right-24 -top-28 size-80 rounded-full bg-accent blur-3xl" aria-hidden="true"></div>
    <div class="relative max-w-2xl">
      <p class="text-xs font-semibold uppercase tracking-[0.2em] text-primary">One space, many ways to connect</p>
      <h1 class="mt-4 text-4xl font-bold leading-[1.08] tracking-[-0.055em] sm:text-6xl">Your connected space.</h1>
      {#if loading}
        {#if accountPreview}
          <p class="mt-6 text-base text-muted-foreground" data-kaordo-preview aria-busy="true">Welcome, {accountPreview.displayName}.</p>
        {:else}
          <div class="mt-6 h-6 w-48 animate-pulse rounded-lg bg-muted" aria-hidden="true"></div>
          <p class="sr-only" role="status">Checking your session…</p>
        {/if}
      {:else if user}
        <p class="mt-6 text-base leading-7 text-muted-foreground">Welcome, {user.displayName}. Your apps are ready when you are.</p>
      {:else if authenticated}
        <p class="mt-6 text-base leading-7 text-muted-foreground">Your identity session is active, but the account service is unavailable.</p>
        <Button class="mt-5" variant="outline" onclick={retryAccount}>Retry account setup</Button>
      {:else}
        <p class="mt-6 text-base leading-7 text-muted-foreground">Sign in once and move between your Kaordo apps.</p>
        <div class="mt-7 flex flex-wrap gap-3">
          <Button href="/login/">Sign in <ArrowRightIcon class="size-4" /></Button>
          <Button href="/register/" variant="outline">Create account</Button>
        </div>
      {/if}
    </div>
  </section>

  {#if error}
    <p class="mt-6 rounded-xl border border-destructive/30 bg-card p-4 text-sm text-destructive" role="alert">{error}</p>
  {/if}

  <section class="mt-12" aria-label="Applications">
    <div class="mb-5">
      <p class="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Apps</p>
      <h2 class="mt-1 text-2xl font-bold tracking-[-0.04em]">Start with Fluo</h2>
    </div>
    <a href={appPaths.fluo} rel="external" class="group flex flex-col justify-between gap-7 rounded-[1.5rem] border border-border bg-card p-6 shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg sm:flex-row sm:items-end">
      <div>
        <div class="mb-5 grid size-12 place-items-center rounded-2xl bg-accent text-xl font-bold text-primary" aria-hidden="true">F</div>
        <h3 class="text-2xl font-bold tracking-[-0.04em]">Fluo</h3>
        <p class="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Share a thought, discover new voices and keep the posts you love.</p>
      </div>
      <span class="inline-flex h-10 items-center gap-2 self-start rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground group-hover:brightness-110 sm:self-auto">
        Open Fluo <ArrowUpRightIcon class="size-4" />
      </span>
    </a>
    <div class="mt-5 grid gap-3 sm:grid-cols-3">
      {#each upcoming as module}
        <div class="rounded-2xl border border-border bg-card/75 p-5">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-base font-bold">{module.name}</h3>
            <span class="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">In development</span>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">{module.description}</p>
        </div>
      {/each}
    </div>
  </section>
</main>
