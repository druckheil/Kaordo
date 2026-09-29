<script lang="ts">
  import { untrack } from 'svelte';
  import { createInfiniteQuery, QueryClient, type InfiniteData } from '@tanstack/svelte-query';
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { createFluoApi, feedOptions, type Feed } from '@kaordo/api-client';
  import type { FluoPage, FluoPost, UserIdentity } from '@kaordo/contracts';
  import { Button } from '@kaordo/ui';
  import Composer from './Composer.svelte';
  import PostCard from './PostCard.svelte';

  let { user }: { user: UserIdentity } = $props();

  const api = createFluoApi(import.meta.env.VITE_KAORDO_API_URL, import.meta.env.VITE_KAORDO_NODO_URL);
  const queryClient = new QueryClient();
  let feed = $state<Feed>('latest');
  let replyTo = $state<FluoPost | null>(null);
  let quoteTo = $state<FluoPost | null>(null);
  let removedIds = $state<string[]>([]);
  let listElement = $state<HTMLDivElement>();
  let composerElement = $state<HTMLElement>();
  let actionError = $state('');
  const query = createInfiniteQuery(() => ({ ...feedOptions(api, feed), enabled: typeof window !== 'undefined' }), () => queryClient);
  const posts = $derived(query.data?.pages.flatMap((page) => page.items).filter((item) => !removedIds.includes(item.id)) ?? []);
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0, getScrollElement: () => listElement ?? null, estimateSize: () => 320, overscan: 4
  });

  $effect(() => {
    const count = posts.length;
    const element = listElement;
    untrack(() => $virtualizer.setOptions({ count, getScrollElement: () => element ?? null }));
  });
  $effect(() => {
    const rows = $virtualizer.getVirtualItems();
    const last = rows.at(-1);
    if (last && last.index >= posts.length - 3 && query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  });

  function measure(node: HTMLDivElement) {
    $virtualizer.measureElement(node);
  }

  function compose(post: FluoPost, mode: 'reply' | 'quote') {
    replyTo = mode === 'reply' ? post : null;
    quoteTo = mode === 'quote' ? post : null;
    composerElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updated() {
    replyTo = null;
    quoteTo = null;
    actionError = '';
    void queryClient.invalidateQueries({ queryKey: ['fluo'] });
    listElement?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function react(post: FluoPost, value: 'good' | 'bad' | null) {
    try {
      actionError = '';
      await api.react(post.id, post.myReaction === value ? null : value);
      await queryClient.invalidateQueries({ queryKey: ['fluo'] });
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Could not save your reaction.';
    }
  }

  async function follow(post: FluoPost) {
    try {
      actionError = '';
      await api.follow(post.author.id, !post.author.following);
      await queryClient.invalidateQueries({ queryKey: ['fluo'] });
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Could not change your follow list.';
    }
  }

  async function remove(post: FluoPost) {
    if (!confirm('Delete this post and its comments?')) return;
    try {
      actionError = '';
      await api.remove(post.id);
      removedIds = [...removedIds, post.id];
      queryClient.setQueriesData<InfiniteData<FluoPage>>({ queryKey: ['fluo', 'feed'] }, (cached) => cached && ({
        ...cached,
        pages: cached.pages.map((page) => ({ ...page, items: page.items.filter((item) => item.id !== post.id) }))
      }));
      await queryClient.invalidateQueries({ queryKey: ['fluo'] });
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Could not delete the post.';
    }
  }
</script>

<div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_240px]">
  <div class="min-w-0">
    <section bind:this={composerElement} aria-label="Create a post">
      <Composer {api} {replyTo} {quoteTo} onPublished={updated} onCancel={() => { replyTo = null; quoteTo = null; }} />
    </section>

    <nav class="mt-8 flex gap-2 border-b pb-3" aria-label="Fluo feeds">
      {#each ['latest', 'following', 'mine'] as tab}
        <Button variant={feed === tab ? 'default' : 'ghost'} size="sm"
          aria-current={feed === tab ? 'page' : undefined}
          onclick={() => { feed = tab as Feed; listElement?.scrollTo(0, 0); }}>
          {tab === 'latest' ? 'Latest' : tab === 'following' ? 'Following' : 'My posts'}
        </Button>
      {/each}
    </nav>

    {#if actionError}<p class="mt-4 text-sm text-destructive" role="alert">{actionError}</p>{/if}
    {#if query.isPending}
      <p class="py-12 text-center text-muted-foreground" role="status">Loading posts…</p>
    {:else if query.isError}
      <div class="py-12 text-center">
        <p class="text-destructive" role="alert">{query.error.message}</p>
        <Button class="mt-4" variant="outline" onclick={() => query.refetch()}>Try again</Button>
      </div>
    {:else if posts.length === 0}
      <div class="py-16 text-center">
        <p class="text-lg font-medium">{feed === 'following' ? 'No posts from people you follow yet.' : 'The feed is ready for its first post.'}</p>
        <p class="mt-2 text-sm text-muted-foreground">{feed === 'following' ? 'Follow an author in Latest to see their posts here.' : 'Share a thought, photo or video above.'}</p>
      </div>
    {:else}
      <div bind:this={listElement} class="mt-4 h-[min(72vh,900px)] overflow-y-auto overscroll-contain rounded-2xl border bg-card" aria-label="Posts">
        <div class="relative w-full" style:height={`${$virtualizer.getTotalSize()}px`}>
          {#each $virtualizer.getVirtualItems().filter((row) => row.index < posts.length) as row (posts[row.index].id)}
            <div data-index={row.index} class="absolute top-0 left-0 w-full"
              style:transform={`translateY(${row.start}px)`} use:measure>
              <PostCard post={posts[row.index]} viewerId={user.id} {api} {queryClient}
                onReply={() => compose(posts[row.index], 'reply')}
                onQuote={() => compose(posts[row.index], 'quote')}
                onReact={(value) => react(posts[row.index], value)}
                onFollow={() => follow(posts[row.index])}
                onDelete={() => remove(posts[row.index])} />
            </div>
          {/each}
        </div>
      </div>
      {#if query.isFetchingNextPage}<p class="mt-3 text-center text-sm text-muted-foreground" role="status">Loading more…</p>{/if}
      {#if query.hasNextPage}
        <Button class="mt-3 w-full" variant="outline" disabled={query.isFetchingNextPage} onclick={() => query.fetchNextPage()}>Load more</Button>
      {/if}
    {/if}
  </div>

  <aside class="hidden lg:block">
    <div class="sticky top-6 rounded-2xl border bg-card p-5">
      <p class="text-sm font-semibold">Your space</p>
      <p class="mt-2 truncate text-sm text-muted-foreground">@{user.username}</p>
      <p class="mt-5 text-xs leading-5 text-muted-foreground">Latest shows public posts and your private posts in time order. My posts narrows the feed to your own work.</p>
    </div>
  </aside>
</div>
