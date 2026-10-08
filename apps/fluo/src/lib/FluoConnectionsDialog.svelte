<script lang="ts">
  // Presents cursor-paginated followers and following with links to their profiles

  import { untrack } from 'svelte';
  import { createInfiniteQuery, type QueryClient } from '@tanstack/svelte-query';
  import { fluoConnectionsOptions, type FluoApi } from '@kaordo/api-client';
  import { Button, Dialog, UsersIcon, ChevronRightIcon } from '@kaordo/ui';
  import { UserAvatar } from '@kaordo/account-ui';
  import ProfileLink from './ProfileLink.svelte';
  import VerifiedBadge from './VerifiedBadge.svelte';

  let { profileId, kind, api, queryClient, onClose }: {
    profileId: string;
    kind: 'followers' | 'following';
    api: FluoApi;
    queryClient: QueryClient;
    onClose: () => void;
  } = $props();
  const stableApi = untrack(() => api);
  const query = createInfiniteQuery(() => fluoConnectionsOptions(stableApi, profileId, kind), () => queryClient);
  const users = $derived([...new Map(query.data?.pages.flatMap((page) => page.items).map((user) => [user.id, user]) ?? []).values()]);
  const title = $derived(kind === 'followers' ? 'Followers' : 'Following');
</script>

<Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
  <Dialog.Content class="gap-4 sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{kind === 'followers' ? 'People following this profile.' : 'People this profile follows.'}</Dialog.Description>
    </Dialog.Header>
    {#if query.isPending}
      <p class="py-8 text-center text-sm text-muted-foreground" role="status">Loading people…</p>
    {:else if query.isError && !query.data}
      <p class="text-sm text-destructive" role="alert">{query.error.message}</p>
      <Button variant="outline" onclick={() => void query.refetch()}>Try again</Button>
    {:else if users.length === 0}
      <div class="py-8 text-center text-muted-foreground"><UsersIcon class="mx-auto mb-3 size-8" /><p class="text-sm">{kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</p></div>
    {:else}
      <ul class="-mx-1 grid max-h-[min(55dvh,28rem)] gap-1 overflow-y-auto overscroll-contain px-1" aria-label={title}>
        {#each users as user (user.id)}
          <li>
            <ProfileLink username={user.username} class="flex items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring" onNavigate={onClose}>
              <UserAvatar user={user} />
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5"><span class="truncate text-sm font-semibold">{user.displayName}</span>{#if user.verified}<VerifiedBadge />{/if}</span>
                <span class="block truncate text-xs text-muted-foreground">@{user.username}</span>
              </span>
              <ChevronRightIcon class="size-4 shrink-0 text-muted-foreground" />
            </ProfileLink>
          </li>
        {/each}
      </ul>
      {#if query.hasNextPage || query.isFetchNextPageError}
        <Button variant="outline" disabled={query.isFetchingNextPage} onclick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage ? 'Loading…' : query.isFetchNextPageError ? 'Try loading more' : 'Load more'}
        </Button>
      {/if}
    {/if}
  </Dialog.Content>
</Dialog.Root>
