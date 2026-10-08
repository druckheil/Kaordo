<script lang="ts">
  // Scopes shared avatars and presence to the authenticated application's lifetime

  import { setContext, untrack, type Snippet } from 'svelte';
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import { createUserPresentationState } from './user-presentation-state.svelte.ts';
  import { userPresentationContext } from './user-presentation-context.ts';

  let { apiBaseUrl, userId, children }: { apiBaseUrl: string; userId: string; children: Snippet } = $props();
  const queryClient = new QueryClient();
  setContext(userPresentationContext, createUserPresentationState(untrack(() => apiBaseUrl), untrack(() => userId), queryClient));
</script>

<QueryClientProvider client={queryClient}>
  {@render children()}
</QueryClientProvider>
