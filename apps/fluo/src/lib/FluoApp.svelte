<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { createInfiniteQuery, QueryClient, type InfiniteData } from '@tanstack/svelte-query';
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { appPaths } from '@kaordo/links';
  import { createFluoApi, feedOptions, type Feed } from '@kaordo/api-client';
  import type { FluoPage, FluoPost, UserIdentity } from '@kaordo/contracts';
  import {
    BellIcon, BookmarkIcon, Button, HouseIcon, Input, SearchIcon, SettingsIcon, UserRoundIcon
  } from '@kaordo/ui';
  import Composer from './Composer.svelte';
  import PostCard from './PostCard.svelte';

  type View = 'feed' | 'search' | 'notifications' | 'saved' | 'profile' | 'settings';

  let { user }: { user: UserIdentity } = $props();

  const navigation = [
    { id: 'feed', label: 'Feed', icon: HouseIcon },
    { id: 'search', label: 'Search', icon: SearchIcon },
    { id: 'notifications', label: 'Notifications', icon: BellIcon },
    { id: 'saved', label: 'Saved', icon: BookmarkIcon },
    { id: 'profile', label: 'Profile', icon: UserRoundIcon },
    { id: 'settings', label: 'Settings', icon: SettingsIcon }
  ] as const;

  const api = createFluoApi(import.meta.env.VITE_KAORDO_API_URL, import.meta.env.VITE_KAORDO_NODO_URL);
  const queryClient = new QueryClient();
  let view = $state<View>('feed');
  let feed = $state<Feed>('latest');
  let replyTo = $state<FluoPost | null>(null);
  let quoteTo = $state<FluoPost | null>(null);
  let removedIds = $state<string[]>([]);
  let listElement = $state<HTMLDivElement>();
  let composerElement = $state<HTMLElement>();
  let actionError = $state('');
  let searchInput = $state('');
  let searchTerm = $state('');
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  const currentFeed = $derived<Feed>(
    view === 'profile' ? 'mine' : view === 'saved' ? 'saved' : feed
  );
  const activeSearch = $derived(view === 'search' ? searchTerm : undefined);
  const canQueryPosts = $derived(view === 'feed' || view === 'search' || view === 'saved' || view === 'profile');
  const query = createInfiniteQuery(() => ({
    ...feedOptions(api, currentFeed, activeSearch),
    enabled: typeof window !== 'undefined' && canQueryPosts && (view !== 'search' || searchTerm.length >= 2)
  }), () => queryClient);
  const posts = $derived(query.data?.pages.flatMap((page) => page.items).filter((item) => !removedIds.includes(item.id)) ?? []);
  const pageTitle = $derived({
    feed: 'Feed', search: 'Search', notifications: 'Notifications', saved: 'Saved posts', profile: 'Profile', settings: 'Settings'
  }[view]);
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0, getScrollElement: () => listElement ?? null, estimateSize: () => 320, overscan: 4
  });

  $effect(() => {
    const count = canQueryPosts ? posts.length : 0;
    const element = listElement;
    untrack(() => $virtualizer.setOptions({ count, getScrollElement: () => element ?? null }));
  });
  $effect(() => {
    const rows = $virtualizer.getVirtualItems();
    const last = rows.at(-1);
    if (canQueryPosts && last && last.index >= posts.length - 3 && query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  });

  onDestroy(() => {
    if (searchTimer) clearTimeout(searchTimer);
  });

  function measure(node: HTMLDivElement) {
    $virtualizer.measureElement(node);
  }

  function navigate(next: View) {
    view = next;
    actionError = '';
    listElement?.scrollTo({ top: 0 });
  }

  function changeSearch(event: Event) {
    searchInput = (event.currentTarget as HTMLInputElement).value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTerm = searchInput.trim();
      listElement?.scrollTo({ top: 0 });
    }, 250);
  }

  function compose(post: FluoPost, mode: 'reply' | 'quote') {
    replyTo = mode === 'reply' ? post : null;
    quoteTo = mode === 'quote' ? post : null;
    navigate('feed');
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

  async function save(post: FluoPost) {
    try {
      actionError = '';
      await api.setSaved(post.id, !post.saved);
      await queryClient.invalidateQueries({ queryKey: ['fluo', 'feed'] });
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Could not update your saved posts.';
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

<div class="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8">
  <aside class="lg:sticky lg:top-6 lg:self-start">
    <p class="mb-1 hidden px-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary lg:block">Kaordo</p>
    <p class="mb-4 hidden px-3 text-xl font-semibold tracking-tight lg:block">Fluo</p>
    <nav class="grid grid-cols-3 gap-1 sm:grid-cols-6 lg:grid-cols-1" aria-label="Fluo navigation">
      {#each navigation as item (item.id)}
        {@const Icon = item.icon}
        <Button class="w-full justify-start gap-2 px-2 sm:px-3" variant={view === item.id ? 'secondary' : 'ghost'} size="sm"
          aria-current={view === item.id ? 'page' : undefined} onclick={() => navigate(item.id)}>
          <Icon class="size-4 shrink-0" /> <span class="truncate">{item.label}</span>
        </Button>
      {/each}
    </nav>
    <div class="mt-6 hidden rounded-2xl border bg-card p-4 lg:block">
      <p class="truncate text-sm font-medium">{user.displayName}</p>
      <p class="mt-1 truncate text-sm text-muted-foreground">@{user.username}</p>
    </div>
  </aside>

  <section class="min-w-0" aria-label={pageTitle}>
    <div class="mb-6 flex items-center justify-between border-b pb-4">
      <h2 class="text-2xl font-semibold tracking-tight">{pageTitle}</h2>
      {#if view === 'feed'}
        <div class="flex gap-1" aria-label="Feed order">
          {#each ['latest', 'following'] as tab}
            <Button variant={feed === tab ? 'default' : 'ghost'} size="sm"
              aria-current={feed === tab ? 'page' : undefined}
              onclick={() => { feed = tab as Feed; listElement?.scrollTo({ top: 0 }); }}>
              {tab === 'latest' ? 'Latest' : 'Following'}
            </Button>
          {/each}
        </div>
      {/if}
    </div>

    {#if view === 'notifications'}
      <div class="rounded-2xl border bg-card px-6 py-14 text-center">
        <BellIcon class="mx-auto size-8 text-muted-foreground" />
        <p class="mt-4 text-lg font-medium">No notifications yet</p>
        <p class="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">Replies, reactions and new followers will appear here.</p>
      </div>
    {:else if view === 'settings'}
      <div class="rounded-2xl border bg-card p-6">
        <h3 class="text-lg font-semibold">Your account</h3>
        <dl class="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div><dt class="text-muted-foreground">Display name</dt><dd class="mt-1 font-medium">{user.displayName}</dd></div>
          <div><dt class="text-muted-foreground">Username</dt><dd class="mt-1 font-medium">@{user.username}</dd></div>
        </dl>
        <p class="mt-5 text-sm text-muted-foreground">Password and sign-in security are managed with your Kaordo account.</p>
        <Button class="mt-4" href={appPaths.portal} rel="external" variant="outline">Account settings</Button>
      </div>
    {:else}
      {#if view === 'feed'}
        <section bind:this={composerElement} class="mb-6" aria-label="Create a post">
          <Composer {api} {replyTo} {quoteTo} onPublished={updated} onCancel={() => { replyTo = null; quoteTo = null; }} />
        </section>
      {:else if view === 'search'}
        <div class="mb-5">
          <label class="sr-only" for="fluo-search">Search posts and people</label>
          <div class="relative">
            <SearchIcon class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="fluo-search" class="pl-9" type="search" placeholder="Search posts and people" value={searchInput} oninput={changeSearch} />
          </div>
          <p class="mt-2 text-xs text-muted-foreground">Search public posts and your own posts by text or author.</p>
        </div>
      {:else if view === 'saved'}
        <p class="mb-5 text-sm text-muted-foreground">Only you can see the posts you save.</p>
      {:else if view === 'profile'}
        <div class="mb-5 rounded-2xl border bg-card p-5">
          <h3 class="text-lg font-semibold">{user.displayName}</h3>
          <p class="mt-1 text-sm text-muted-foreground">@{user.username}</p>
        </div>
      {/if}

      {#if actionError}<p class="mb-4 text-sm text-destructive" role="alert">{actionError}</p>{/if}
      {#if view === 'search' && searchTerm.length < 2}
        <p class="py-12 text-center text-sm text-muted-foreground" role="status">Enter at least two characters to search.</p>
      {:else if query.isPending}
        <p class="py-12 text-center text-muted-foreground" role="status">Loading posts…</p>
      {:else if query.isError}
        <div class="py-12 text-center">
          <p class="text-destructive" role="alert">{query.error.message}</p>
          <Button class="mt-4" variant="outline" onclick={() => query.refetch()}>Try again</Button>
        </div>
      {:else if posts.length === 0}
        <div class="rounded-2xl border bg-card px-6 py-14 text-center">
          <p class="text-lg font-medium">
            {view === 'saved' ? 'No saved posts yet.' :
              view === 'search' ? 'No matching posts.' :
              view === 'profile' ? 'You have not posted yet.' :
              view === 'feed' && feed === 'following' ? 'No posts from people you follow yet.' : 'The feed is ready for its first post.'}
          </p>
          <p class="mt-2 text-sm text-muted-foreground">
            {view === 'saved' ? 'Save a post to keep it in your private list.' :
              view === 'search' ? 'Try another phrase or username.' :
              view === 'profile' ? 'Posts you publish will appear on your profile.' :
              view === 'feed' && feed === 'following' ? 'Follow an author in Latest to see their posts here.' :
              view === 'feed' ? 'Share a thought, photo or video above.' : 'There is nothing to show here yet.'}
          </p>
        </div>
      {:else}
        <div bind:this={listElement} class="h-[min(72vh,900px)] overflow-y-auto overscroll-contain rounded-2xl border bg-card" aria-label={view === 'saved' ? 'Saved posts' : view === 'profile' ? 'Profile posts' : view === 'search' ? 'Search results' : 'Posts'}>
          <div class="relative w-full" style:height={`${$virtualizer.getTotalSize()}px`}>
            {#each $virtualizer.getVirtualItems().filter((row) => row.index < posts.length) as row (posts[row.index].id)}
              <div data-index={row.index} class="absolute left-0 top-0 w-full"
                style:transform={`translateY(${row.start}px)`} use:measure>
                <PostCard post={posts[row.index]} viewerId={user.id} {api} {queryClient}
                  onReply={() => compose(posts[row.index], 'reply')}
                  onQuote={() => compose(posts[row.index], 'quote')}
                  onReact={(value) => react(posts[row.index], value)}
                  onFollow={() => follow(posts[row.index])}
                  onSave={() => save(posts[row.index])}
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
    {/if}
  </section>
</div>
