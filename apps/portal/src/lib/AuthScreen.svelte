<script lang="ts">
  import { onMount } from 'svelte';
  import { signIn, signUp } from '@kaordo/auth';
  import { appPaths } from '@kaordo/links';
  import { ArrowRightIcon, Button, KeyRoundIcon, ShieldCheckIcon } from '@kaordo/ui';
  import { loadSession } from './session';

  let { mode }: { mode: 'login' | 'register' } = $props();
  let ready = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let signedIn = $state<boolean | null>(null);
  let returnPath = $state<string>(appPaths.portal);

  onMount(() => {
    const next = new URL(window.location.href).searchParams.get('next');
    if (next && Object.values(appPaths).some((path) => path === next)) returnPath = next;
    void (async () => {
      const result = await loadSession();
      error = result.error;
      signedIn = result.authenticated;
      ready = true;
    })();
  });

  async function continueToIdentity() {
    busy = true;
    error = null;
    try {
      const redirectUri = window.location.origin + returnPath;
      if (mode === 'login') await signIn(redirectUri);
      else await signUp(redirectUri);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Unable to open the identity service.';
      busy = false;
    }
  }

  async function retrySession() {
    busy = true;
    const result = await loadSession();
    signedIn = result.authenticated;
    error = result.error;
    busy = false;
  }
</script>

<svelte:head>
  <title>{mode === 'login' ? 'Sign in' : 'Create account'} | Kaordo</title>
  <meta name="description" content="Secure access to your Kaordo account." />
</svelte:head>

<main class="min-h-screen bg-background px-5 py-8 text-foreground">
  <div class="mx-auto flex max-w-6xl items-center justify-between">
    <a class="text-lg font-semibold tracking-tight" href={appPaths.portal}>Kaordo<span class="text-primary">.</span></a>
    <a class="text-sm text-muted-foreground transition-colors hover:text-foreground" href={appPaths.portal}>Back to home</a>
  </div>

  <div class="mx-auto grid max-w-6xl gap-14 py-16 lg:grid-cols-[1fr_440px] lg:items-center lg:py-28">
    <section class="max-w-xl">
      <div class="mb-7 inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
        <ShieldCheckIcon class="size-3.5 text-primary" /> One account for every Kaordo app
      </div>
      <h1 class="text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
        {mode === 'login' ? 'Your space, ready when you are.' : 'Make room for what matters.'}
      </h1>
      <p class="mt-6 max-w-lg text-base leading-7 text-muted-foreground">
        {mode === 'login'
          ? 'Sign in once to move between your conversations, communities and social feed.'
          : 'Create your account, then set up an authenticator app to protect it.'}
      </p>
      <div class="mt-10 grid gap-4 sm:grid-cols-2">
        <div class="rounded-2xl border bg-card p-5">
          <KeyRoundIcon class="size-5 text-primary" />
          <h2 class="mt-4 text-sm font-semibold">Password and authenticator</h2>
          <p class="mt-2 text-sm leading-6 text-muted-foreground">Your sign-in is verified by the identity service before any app receives access.</p>
        </div>
        <div class="rounded-2xl border bg-card p-5">
          <ShieldCheckIcon class="size-5 text-primary" />
          <h2 class="mt-4 text-sm font-semibold">One secure session</h2>
          <p class="mt-2 text-sm leading-6 text-muted-foreground">Ligo, Fluo and Rondo use the same account without sharing your password.</p>
        </div>
      </div>
    </section>

    <section class="rounded-3xl border bg-card p-7 shadow-xl shadow-primary/5 sm:p-10" aria-label={mode === 'login' ? 'Sign in' : 'Create account'}>
      <p class="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Kaordo account</p>
      <h2 class="mt-3 text-2xl font-semibold tracking-tight">{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
      <p class="mt-2 text-sm leading-6 text-muted-foreground">
        {mode === 'login'
          ? 'Continue to the secure sign-in form to enter your password and authenticator code.'
          : 'Continue to registration. You will set up a one-time code before your first session.'}
      </p>

      {#if error}
        <p class="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>
      {/if}

      {#if !ready}
        <div class="mt-8 h-9 w-full rounded-2xl bg-muted/70" aria-hidden="true"></div>
        <p class="mt-4 text-center text-xs leading-5 text-muted-foreground" role="status">Checking your session…</p>
      {:else if signedIn}
        <p class="mt-6 text-sm text-muted-foreground">You are already signed in.</p>
        {#if error}
          <Button class="mt-5 w-full" size="lg" disabled={busy} onclick={retrySession}>Retry account setup</Button>
        {:else}
          <Button href={returnPath} class="mt-5 w-full" size="lg">Open Kaordo <ArrowRightIcon class="size-4" /></Button>
        {/if}
      {:else}
        <Button class="mt-8 w-full" size="lg" disabled={!ready || busy || Boolean(error)} onclick={continueToIdentity}>
          {busy ? 'Opening secure sign-in…' : mode === 'login' ? 'Continue to sign in' : 'Continue to registration'}
          <ArrowRightIcon class="size-4" />
        </Button>
        <p class="mt-4 text-center text-xs leading-5 text-muted-foreground">The password and one-time code are entered on Kaordo Identity.</p>
        {#if error}<Button class="mt-4 w-full" variant="outline" disabled={busy} onclick={retrySession}>Retry connection</Button>{/if}
      {/if}

      <div class="mt-8 border-t pt-6 text-center text-sm text-muted-foreground">
        {#if mode === 'login'}
          New to Kaordo? <a class="font-medium text-primary hover:underline" href={`/register/?next=${encodeURIComponent(returnPath)}`}>Create an account</a>
        {:else}
          Already have an account? <a class="font-medium text-primary hover:underline" href={`/login/?next=${encodeURIComponent(returnPath)}`}>Sign in</a>
        {/if}
      </div>
    </section>
  </div>
</main>
