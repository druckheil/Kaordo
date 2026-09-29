<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { authConfigFromEnv, initializeAuth } from '@kaordo/auth';
  import { bootstrapIdentity } from '@kaordo/api-client';
  import type { UserIdentity } from '@kaordo/contracts';
  import { Button, ShieldCheckIcon } from '@kaordo/ui';

  let {
    appName,
    returnPath,
    environment,
    children
  }: {
    appName: string;
    returnPath: string;
    environment: Record<string, string | undefined>;
    children: Snippet<[UserIdentity]>;
  } = $props();

  let user = $state<UserIdentity | null>(null);
  let authenticated = $state(false);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function refresh() {
    loading = true;
    error = null;
    try {
      const session = await initializeAuth(authConfigFromEnv(environment));
      authenticated = session.authenticated;
      if (authenticated) {
        const apiUrl = environment.VITE_KAORDO_API_URL;
        if (!apiUrl) throw new Error('The API is not configured.');
        user = await bootstrapIdentity(apiUrl);
      } else {
        user = null;
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not check your account.';
    } finally {
      loading = false;
    }
  }

  onMount(() => { void refresh(); });
</script>

{#if loading}
  <p class="mt-8 text-sm text-muted-foreground" role="status">Checking your account…</p>
{:else if user}
  {@render children(user)}
{:else}
  <section class="mt-8 max-w-lg rounded-2xl border bg-card p-6" aria-label={`${appName} account access`}>
    <ShieldCheckIcon class="size-6 text-primary" />
    <h2 class="mt-4 text-xl font-semibold">{authenticated ? 'Account service unavailable' : `Sign in to ${appName}`}</h2>
    {#if error}<p class="mt-3 text-sm text-destructive" role="alert">{error}</p>{/if}
    {#if authenticated}
      <Button class="mt-6" variant="outline" onclick={refresh}>Retry account setup</Button>
    {:else}
      <p class="mt-3 text-sm text-muted-foreground">Your Kaordo account works across every app.</p>
      <Button class="mt-6" href={`/login/?next=${encodeURIComponent(returnPath)}`}>Sign in</Button>
    {/if}
  </section>
{/if}
