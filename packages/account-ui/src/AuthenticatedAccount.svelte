<script lang="ts">
  // Loads device access and shared user presentation together after account authentication
  import type { Snippet } from 'svelte';
  import type { UserIdentity } from '@kaordo/contracts';
  import EncryptionProvider from './EncryptionProvider.svelte';
  import UserPresentationProvider from './UserPresentationProvider.svelte';
  let { user, appName, embedded, environment, children }: {
    user: UserIdentity; appName: string; embedded: boolean;
    environment: Record<string, string | undefined>; children: Snippet;
  } = $props();
</script>

<EncryptionProvider {appName} {embedded} apiBaseUrl={environment.VITE_KAORDO_API_URL ?? ''} ownerId={user.id}>
  <UserPresentationProvider apiBaseUrl={environment.VITE_KAORDO_API_URL ?? ''} userId={user.id}>
    {@render children()}
  </UserPresentationProvider>
</EncryptionProvider>
