<script lang="ts">
  import { onMount } from 'svelte';
  import { appPaths } from '@kaordo/links';
  import { signOut } from '@kaordo/auth';
  import { clearAccountPreview, readAccountPreview, type AccountPreview } from '@kaordo/account-ui';
  import { ArrowUpRightIcon, Button, LogOutIcon } from '@kaordo/ui';
  import type { UserIdentity } from '@kaordo/contracts';
  import { loadSession } from '$lib/session';

  const modules = [
    { name: 'Ligo', path: appPaths.ligo, description: 'Messages' },
    { name: 'Fluo', path: appPaths.fluo, description: 'Social feed' },
    { name: 'Rondo', path: appPaths.rondo, description: 'Communities' },
    { name: 'Regado', path: appPaths.regado, description: 'Administration' }
  ];

  let user = $state<UserIdentity | null>(null);
  let authenticated = $state<boolean | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(true);
  let accountPreview = $state<AccountPreview | null>(null);
  let sessionTask: Promise<void> | null = null;

  async function refreshAccount() {
    const result = await loadSession();
    user = result.user;
    authenticated = result.authenticated;
    error = result.error;
    accountPreview = readAccountPreview();
    loading = false;
  }

  onMount(() => {
    accountPreview = readAccountPreview();
    sessionTask = refreshAccount();
  });

  async function logOut() {
    try {
      await sessionTask;
      clearAccountPreview();
      accountPreview = null;
      await signOut(window.location.origin + appPaths.portal);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not sign out.';
    }
  }

  async function retryAccount() {
    accountPreview = readAccountPreview();
    loading = true;
    sessionTask = refreshAccount();
    await sessionTask;
  }
</script>

<svelte:head><title>Kaordo</title></svelte:head>

<main class="mx-auto max-w-5xl px-5 py-10 sm:py-16">
  <header class="flex flex-wrap items-center justify-between gap-4">
    <div>
      <p class="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Kaordo</p>
      <h1 class="mt-2 text-4xl font-semibold tracking-tight">Your connected space.</h1>
    </div>
    {#if authenticated === null}
      {#if accountPreview}
        <Button variant="outline" onclick={logOut}><LogOutIcon class="size-4" /> Sign out</Button>
      {:else}
        <div class="h-8 w-44 rounded-2xl bg-muted/70" aria-hidden="true"></div>
      {/if}
    {:else if authenticated}
      <Button variant="outline" onclick={logOut}><LogOutIcon class="size-4" /> Sign out</Button>
    {:else}
      <div class="flex gap-2">
        <Button href="/login/" variant="outline">Sign in</Button>
        <Button href="/register/">Create account</Button>
      </div>
    {/if}
  </header>

  {#if error}
    <p class="mt-8 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{error}</p>
  {/if}

  {#if loading}
    {#if accountPreview}
      <div data-kaordo-preview aria-busy="true">
        <p class="mt-8 text-muted-foreground">Welcome, {accountPreview.displayName}.</p>
        <p class="mt-1 text-xs text-muted-foreground">Account ID: {accountPreview.id}</p>
      </div>
    {:else}
      <div class="mt-8 h-6 w-48 rounded-lg bg-muted/70" aria-hidden="true"></div>
      <p class="sr-only" role="status">Checking your session…</p>
    {/if}
  {:else if user}
    <p class="mt-8 text-muted-foreground">Welcome, {user.displayName}.</p>
    <p class="mt-1 text-xs text-muted-foreground">Account ID: {user.id}</p>
  {:else if authenticated}
    <p class="mt-8 text-muted-foreground">Your identity session is active, but the account service is unavailable.</p>
    <Button class="mt-5" variant="outline" onclick={retryAccount}>Retry account setup</Button>
  {:else}
    <p class="mt-8 max-w-xl text-base leading-7 text-muted-foreground">Sign in to access your Kaordo account across every app.</p>
    <div class="mt-6 flex gap-3">
      <Button href="/login/">Sign in</Button>
      <Button href="/register/" variant="outline">Create account</Button>
    </div>
  {/if}

  <section class="mt-14 grid gap-4 sm:grid-cols-2" aria-label="Applications">
    {#each modules as module}
      <a href={module.path} rel="external" class="group rounded-2xl border bg-card p-6 transition-colors hover:bg-muted/40">
        <div class="flex items-center justify-between">
          <h2 class="text-xl font-semibold">{module.name}</h2>
          <ArrowUpRightIcon class="size-5 text-muted-foreground transition-colors group-hover:text-primary" />
        </div>
        <p class="mt-3 text-sm text-muted-foreground">{module.description}</p>
      </a>
    {/each}
  </section>
</main>
