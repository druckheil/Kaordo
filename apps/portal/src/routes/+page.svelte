<script lang="ts">
  import { onMount } from 'svelte';
  import { appPaths } from '@kaordo/links';
  import { signOut } from '@kaordo/auth';
  import { clearAccountPreview, createAccountSessionController, readAccountPreview, type AccountPreview } from '@kaordo/account-ui';
  import { ArrowRightIcon, ArrowUpRightIcon, Button, HouseIcon, LogOutIcon, MessageCircleIcon, UsersIcon } from '@kaordo/ui';
  import type { UserIdentity } from '@kaordo/contracts';

  const available = [
    { name: 'Fluo', description: 'Share a thought, discover new voices and keep the posts you love.',
      label: 'Social', href: appPaths.fluo, icon: HouseIcon },
    { name: 'Ligo', description: 'Keep conversations, photos and files together in one place.',
      label: 'Messages', href: appPaths.ligo, icon: MessageCircleIcon },
    { name: 'Rondo', description: 'Build a community with channels, shared files and local voice rooms.',
      label: 'Communities', href: appPaths.rondo, icon: UsersIcon }
  ];
  const upcoming = [
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
    <a class="inline-flex items-center gap-2 rounded-xl text-lg font-bold tracking-[-0.04em] text-primary focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring" href={appPaths.portal}>
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
      <h2 class="mt-1 text-2xl font-bold tracking-[-0.04em]">Choose an app</h2>
    </div>
    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {#each available as module (module.name)}
        {@const Icon = module.icon}
        <a href={module.href} rel="external"
          class="group flex min-h-56 flex-col rounded-[1.5rem] border border-border bg-card p-6 shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring sm:p-7">
          <div class="flex items-start justify-between gap-3">
            <span class="grid size-12 place-items-center rounded-2xl bg-accent text-primary" aria-hidden="true"><Icon class="size-6" /></span>
            <span class="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">{module.label}</span>
          </div>
          <h3 class="mt-5 text-2xl font-bold tracking-tight">{module.name}</h3>
          <p class="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{module.description}</p>
          <span class="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-semibold text-primary">
            Open {module.name} <ArrowUpRightIcon class="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </span>
        </a>
      {/each}
    </div>
    <h3 class="mt-8 text-sm font-semibold text-muted-foreground">Coming next</h3>
    <div class="mt-3 grid gap-3 sm:grid-cols-2">
      {#each upcoming as module}
        <div class="rounded-2xl border border-border bg-card/75 p-5">
          <div class="flex items-center justify-between gap-2">
            <h4 class="text-base font-bold">{module.name}</h4>
            <span class="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">In development</span>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">{module.description}</p>
        </div>
      {/each}
    </div>
  </section>
</main>
