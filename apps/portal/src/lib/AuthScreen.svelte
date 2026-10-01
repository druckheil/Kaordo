<script lang="ts">
  import { onMount } from 'svelte';
  import { authConfigFromEnv, initializeAuth, signIn, signUp } from '@kaordo/auth';
  import { clearAccountPreview } from '@kaordo/account-ui';
  import { appPaths } from '@kaordo/links';
  import { ArrowRightIcon, Button, ShieldCheckIcon } from '@kaordo/ui';

  let { mode }: { mode: 'login' | 'register' } = $props();
  let busy = $state(true);
  let error = $state<string | null>(null);
  let returnPath = $state<string>(appPaths.portal);

  onMount(() => {
    const next = new URL(window.location.href).searchParams.get('next');
    if (next && Object.values(appPaths).some((path) => path === next)) returnPath = next;

    // A Back navigation from Keycloak returns to this history entry. Let the
    // person decide whether to try again instead of sending them into a loop.
    const state = window.history.state as Record<string, unknown> | null;
    if (state?.kaordoIdentityStarted) {
      busy = false;
      return;
    }
    window.history.replaceState({ ...state, kaordoIdentityStarted: true }, '');
    void openIdentity();
  });

  async function openIdentity() {
    busy = true;
    error = null;
    try {
      clearAccountPreview();
      await initializeAuth(authConfigFromEnv(import.meta.env));
      const redirectUri = window.location.origin + returnPath;
      if (mode === 'login') await signIn(redirectUri);
      else await signUp(redirectUri);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Unable to open Kaordo Identity.';
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{mode === 'login' ? 'Sign in' : 'Create account'} | Kaordo</title>
  <meta name="description" content="Access your Kaordo account." />
</svelte:head>

<main class="relative grid min-h-screen place-items-center overflow-hidden bg-background px-5 py-16 text-foreground">
  <div class="pointer-events-none absolute -left-24 -top-40 size-[30rem] rounded-full bg-accent/80 blur-3xl" aria-hidden="true"></div>
  <div class="pointer-events-none absolute -bottom-48 -right-28 size-[32rem] rounded-full bg-secondary/80 blur-3xl" aria-hidden="true"></div>
  <div class="relative w-full max-w-md">
    <a class="mb-8 inline-flex items-center gap-2 rounded-xl text-lg font-bold tracking-[-0.04em] text-primary focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring" href={appPaths.portal}>
      <span class="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">K</span> Kaordo
    </a>
    <section class="rounded-[1.75rem] border border-border bg-card p-7 shadow-[0_24px_80px_-40px_rgba(21,75,43,.45)] sm:p-9"
      aria-label={mode === 'login' ? 'Sign in' : 'Create account'}>
      <div class="grid size-12 place-items-center rounded-2xl bg-accent"><ShieldCheckIcon class="size-6 text-primary" /></div>
      <h1 class="mt-6 text-3xl font-bold tracking-[-0.05em]">{mode === 'login' ? 'Welcome back' : 'Join Kaordo'}</h1>
      <p class="mt-2 text-sm leading-6 text-muted-foreground">
        {busy
          ? mode === 'login' ? 'Opening your sign-in form…' : 'Opening your registration form…'
          : 'Continue to Kaordo Identity to enter your username and password.'}
      </p>

      {#if error}
        <p class="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{error}</p>
      {/if}

      {#if busy}
        <div class="mt-8 flex items-center gap-3 rounded-xl bg-muted px-4 py-4" role="status">
          <span class="size-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden="true"></span>
          <span class="text-sm font-medium">Connecting to Kaordo Identity…</span>
        </div>
      {:else}
        <Button class="mt-8 w-full" size="lg" onclick={openIdentity}>
          {mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRightIcon class="size-4" />
        </Button>
        <p class="mt-3 text-center text-xs leading-5 text-muted-foreground">
          {error ? 'Check your connection and try again.' : 'You can continue whenever you are ready.'}
        </p>
      {/if}

      <div class="mt-8 border-t border-border pt-6 text-center text-sm text-muted-foreground">
        {#if mode === 'login'}
          New to Kaordo? <a class="font-semibold text-primary underline-offset-4 hover:underline" href={'/register/?next=' + encodeURIComponent(returnPath)}>Create an account</a>
        {:else}
          Already have an account? <a class="font-semibold text-primary underline-offset-4 hover:underline" href={'/login/?next=' + encodeURIComponent(returnPath)}>Sign in</a>
        {/if}
      </div>
    </section>
    <p class="mt-6 text-center text-xs text-muted-foreground">One account for every Kaordo app.</p>
  </div>
</main>
