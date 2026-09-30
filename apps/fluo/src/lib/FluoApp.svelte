<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { createInfiniteQuery, createQuery, QueryClient, type InfiniteData } from '@tanstack/svelte-query';
  import { createWindowVirtualizer } from '@tanstack/svelte-virtual';
  import { appPaths } from '@kaordo/links';
  import { createFluoApi, feedOptions, type Feed } from '@kaordo/api-client';
  import type { FluoPage, FluoPost, UserIdentity } from '@kaordo/contracts';
  import {
    BellIcon, BookmarkIcon, Button, HouseIcon, Input, PlusIcon,
    SearchIcon, SettingsIcon, UserRoundIcon, XIcon
  } from '@kaordo/ui';
  import PostCard from './PostCard.svelte';

  type FluoDialogsComponent = typeof import('./FluoDialogs.svelte').default;

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
  let composerOpen = $state(false);
  let postId = $state<string | null>(null);
  let postDialogOpen = $state(false);
  let DialogsComponent = $state.raw<FluoDialogsComponent | null>(null);
  let dialogsLoading = $state(false);
  let dialogsPromise: Promise<void> | null = null;
  let historySession = '';
  let pendingCloseHash: string | null = null;
  let removedIds = $state<string[]>([]);
  let listElement = $state<HTMLDivElement>();
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
  const selectedPost = createQuery(() => ({
    queryKey: ['fluo', 'post', postId],
    queryFn: () => api.get(postId!),
    enabled: !!postId,
    staleTime: 15_000
  }), () => queryClient);
  const posts = $derived(query.data?.pages.flatMap((page) => page.items).filter((item) => !removedIds.includes(item.id)) ?? []);
  const pageTitle = $derived({
    feed: 'Feed', search: 'Search', notifications: 'Notifications', saved: 'Saved posts', profile: 'Profile', settings: 'Settings'
  }[view]);
  const virtualizer = createWindowVirtualizer<HTMLDivElement>({
    count: 0,
    getItemKey: (index) => posts[index]?.id ?? index,
    estimateSize: (index) => {
      const post = posts[index];
      if (!post) return 320;
      const firstMedia = post.media[0];
      const width = typeof window === 'undefined' ? 600 : Math.min(700, window.innerWidth - 40);
      const mediaHeight = firstMedia ? Math.min(544, Math.max(192, width * firstMedia.height / firstMedia.width)) : 0;
      return 220 + mediaHeight + Math.ceil(post.text.length / 90) * 22 +
        (post.quote ? (post.quote.media.length ? 300 : 96) : 0);
    },
    overscan: 4
  });

  $effect(() => {
    const ids = canQueryPosts ? posts.map((post) => post.id) : [];
    untrack(() => $virtualizer.setOptions({
      count: ids.length,
      getItemKey: (index) => ids[index] ?? index
    }));
  });
  $effect(() => {
    const rows = $virtualizer.getVirtualItems();
    const last = rows.at(-1);
    if (canQueryPosts && last && last.index >= posts.length - 3 && query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  });

  onMount(() => {
    historySession = window.crypto.randomUUID();
    const syncLocation = () => {
      if (pendingCloseHash) {
        const target = pendingCloseHash;
        pendingCloseHash = null;
        if (window.location.hash !== target) {
          window.history.replaceState(window.history.state, '', target);
        }
      }
      const hash = window.location.hash.slice(1);
      const match = /^post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(hash);
      if (match) {
        const returnView = window.history.state?.kaordoFluoReturnView;
        if (navigation.some((item) => item.id === returnView)) view = returnView as View;
        postId = match[1];
        postDialogOpen = true;
        void loadDialogs();
        return;
      }
      postId = null;
      postDialogOpen = false;
      if (navigation.some((item) => item.id === hash)) view = hash as View;
    };
    syncLocation();
    window.addEventListener('hashchange', syncLocation);
    window.addEventListener('popstate', syncLocation);
    return () => {
      window.removeEventListener('hashchange', syncLocation);
      window.removeEventListener('popstate', syncLocation);
    };
  });
  onDestroy(() => {
    if (searchTimer) clearTimeout(searchTimer);
  });

  function trackList(node: HTMLDivElement) {
    listElement = node;
    let margin = -1;
    const update = () => {
      const next = Math.round(node.getBoundingClientRect().top + window.scrollY);
      if (next !== margin) {
        margin = next;
        $virtualizer.setOptions({ scrollMargin: next });
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(node.parentElement ?? node);
    window.addEventListener('resize', update);
    const frame = requestAnimationFrame(update);
    return {
      destroy() {
        cancelAnimationFrame(frame);
        observer.disconnect();
        window.removeEventListener('resize', update);
        if (listElement === node) listElement = undefined;
      }
    };
  }

  function measure(node: HTMLDivElement) {
    $virtualizer.measureElement(node);
  }

  function navigate(next: View) {
    view = next;
    window.location.hash = next;
    actionError = '';
    window.scrollTo({ top: 0 });
  }

  function openPost(id: string) {
    const hash = `#post/${id}`;
    const returnHash = postDialogOpen && postId ? `#post/${postId}` : `#${view}`;
    if (window.location.hash !== hash) {
      window.history.pushState({
        ...window.history.state,
        kaordoFluoPost: historySession,
        kaordoFluoReturnView: view,
        kaordoFluoReturnHash: returnHash
      }, '', hash);
    } else if (!postDialogOpen) {
      const { kaordoFluoPost: _postEntry, ...rest } = window.history.state ?? {};
      window.history.replaceState({
        ...rest,
        kaordoFluoReturnView: view,
        kaordoFluoReturnHash: returnHash
      }, '', hash);
    }
    postId = id;
    postDialogOpen = true;
    void loadDialogs();
  }

  function loadDialogs(): Promise<void> {
    if (DialogsComponent) return Promise.resolve();
    if (dialogsPromise) return dialogsPromise;
    dialogsLoading = true;
    dialogsPromise = import('./FluoDialogs.svelte').then(({ default: component }) => {
      DialogsComponent = component;
    }).catch(() => {
      composerOpen = false;
      postDialogOpen = false;
      actionError = 'Could not open the post window. Try again.';
    }).finally(() => {
      dialogsLoading = false;
      dialogsPromise = null;
    });
    return dialogsPromise;
  }

  function closePost() {
    if (!postId && !window.location.hash.startsWith('#post/')) return;
    const state = window.history.state ?? {};
    const returnView = navigation.some((item) => item.id === state.kaordoFluoReturnView)
      ? state.kaordoFluoReturnView as View : view;
    const storedHash = state.kaordoFluoReturnHash;
    const returnHash = typeof storedHash === 'string' && (
      navigation.some((item) => storedHash === `#${item.id}`) ||
      /^#post\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storedHash)
    ) ? storedHash : `#${returnView}`;
    const returnThroughHistory = !!historySession && state.kaordoFluoPost === historySession;
    const { kaordoFluoPost: _postEntry, kaordoFluoReturnView: _returnView,
      kaordoFluoReturnHash: _returnHash, ...rest } = state;
    postId = null;
    postDialogOpen = false;
    window.history.replaceState(rest, '', returnHash);
    if (returnThroughHistory) {
      pendingCloseHash = returnHash;
      window.history.back();
      return;
    }
    view = returnView;
  }

  function openComposer() {
    replyTo = null;
    quoteTo = null;
    composerOpen = true;
    void loadDialogs();
  }

  function changeSearch(event: Event) {
    searchInput = (event.currentTarget as HTMLInputElement).value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTerm = searchInput.trim();
      window.scrollTo({ top: 0 });
    }, 250);
  }

  function reply(post: FluoPost) {
    if (postId) closePost();
    quoteTo = null;
    replyTo = post;
    composerOpen = true;
    void loadDialogs();
  }

  function quote(post: FluoPost) {
    if (postId) closePost();
    replyTo = null;
    quoteTo = post;
    composerOpen = true;
    void loadDialogs();
  }

  function updated() {
    const repliedTo = replyTo;
    composerOpen = false;
    replyTo = null;
    quoteTo = null;
    actionError = '';
    if (repliedTo) {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['fluo', 'comments', repliedTo.id] }),
        queryClient.invalidateQueries({ queryKey: ['fluo', 'feed'] }),
        queryClient.invalidateQueries({ queryKey: ['fluo', 'post', repliedTo.id] })
      ]);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ['fluo'] });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function react(post: FluoPost, value: 'good' | 'bad' | null) {
    try {
      actionError = '';
      await api.react(post.id, value);
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
      await queryClient.invalidateQueries({ queryKey: ['fluo', 'post', post.id] });
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
      if (postId === post.id) closePost();
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

<div class="grid gap-7 pb-36 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10 lg:pb-10">
  <aside class="hidden lg:sticky lg:top-24 lg:flex lg:h-[calc(100dvh-7rem)] lg:flex-col lg:self-start">
    <p class="mb-5 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Explore Fluo</p>
    <nav class="grid gap-1" aria-label="Fluo navigation">
      {#each navigation as item (item.id)}
        {@const Icon = item.icon}
        <Button class="h-11 w-full justify-start gap-3 rounded-xl px-4 text-[14px]" variant={view === item.id ? 'secondary' : 'ghost'}
          aria-current={view === item.id ? 'page' : undefined} onclick={() => navigate(item.id)}>
          <Icon class="size-5 shrink-0" /> <span class="truncate">{item.label}</span>
        </Button>
      {/each}
    </nav>
    <Button class="mt-auto h-11 w-full justify-center gap-2 rounded-xl" disabled={dialogsLoading} onclick={openComposer}>
      <PlusIcon class="size-5" /> {dialogsLoading ? 'Opening…' : 'Post'}
    </Button>
    <div class="mt-4 flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm">
      <div class="grid size-10 shrink-0 place-items-center rounded-xl bg-accent font-bold text-accent-foreground" aria-hidden="true">
        {user.displayName[0]?.toUpperCase() ?? 'K'}
      </div>
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold">{user.displayName}</p>
        <p class="truncate text-xs text-muted-foreground">@{user.username}</p>
      </div>
    </div>
  </aside>

  <section class="mx-auto min-w-0 w-full max-w-[46rem]" aria-label={pageTitle}>
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Fluo / {pageTitle}</p>
        <h2 class="text-3xl font-bold tracking-[-0.04em] sm:text-4xl">{pageTitle}</h2>
        <p class="mt-2 text-sm text-muted-foreground">
          {view === 'feed' ? 'Ideas, moments and conversations.' : view === 'profile' ? 'Everything you have shared.' :
            view === 'saved' ? 'Keep good things close.' : view === 'search' ? 'Find posts and people.' :
            view === 'settings' ? 'Your account at a glance.' : 'Updates from your community.'}
        </p>
      </div>
      {#if view === 'feed'}
        <div class="flex rounded-xl border border-border bg-card p-1" aria-label="Feed order">
          {#each ['latest', 'following'] as tab}
            <Button variant={feed === tab ? 'secondary' : 'ghost'} size="sm"
              aria-current={feed === tab ? 'page' : undefined}
              onclick={() => { feed = tab as Feed; window.scrollTo({ top: 0 }); }}>
              {tab === 'latest' ? 'Latest' : 'Following'}
            </Button>
          {/each}
        </div>
      {/if}
    </div>

    {#if view === 'notifications'}
      <div class="rounded-[1.5rem] border border-border bg-card px-6 py-16 text-center shadow-sm">
        <div class="mx-auto grid size-14 place-items-center rounded-2xl bg-accent"><BellIcon class="size-6 text-primary" /></div>
        <p class="mt-5 text-xl font-bold tracking-tight">Notifications are on their way</p>
        <p class="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">For now, keep up with conversations in your feed.</p>
        <Button class="mt-6" variant="secondary" onclick={() => navigate('feed')}>Explore the feed</Button>
      </div>
    {:else if view === 'settings'}
      <div class="rounded-[1.5rem] border border-border bg-card p-6 shadow-sm">
        <h3 class="text-xl font-bold tracking-tight">Account</h3>
        <dl class="mt-6 grid gap-5 text-sm sm:grid-cols-2">
          <div><dt class="text-muted-foreground">Display name</dt><dd class="mt-1 font-semibold">{user.displayName}</dd></div>
          <div><dt class="text-muted-foreground">Username</dt><dd class="mt-1 font-semibold">@{user.username}</dd></div>
        </dl>
        <p class="mt-6 border-t border-border pt-5 text-sm leading-6 text-muted-foreground">Sign-in security is managed by Kaordo Identity.</p>
        <Button class="mt-4" href={appPaths.portal} rel="external" variant="outline">Open Kaordo account</Button>
      </div>
    {:else}
      {#if view === 'search'}
        <div class="mb-6 rounded-[1.5rem] border border-border bg-card p-4 shadow-sm">
          <label class="sr-only" for="fluo-search">Search posts and people</label>
          <div class="relative">
            <SearchIcon class="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input id="fluo-search" class="pl-11" type="search" placeholder="Search posts and people" value={searchInput} oninput={changeSearch} />
          </div>
          <p class="mt-3 text-xs text-muted-foreground">Search public posts and your own posts by text or author.</p>
        </div>
      {:else if view === 'saved'}
        <p class="mb-5 rounded-xl border border-border bg-accent/60 px-4 py-3 text-sm text-accent-foreground">Only you can see the posts you save.</p>
      {:else if view === 'profile'}
        <div class="mb-6 overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
          <div class="h-20 bg-gradient-to-r from-[#dceee1] via-[#e9f4e8] to-[#f1e9d7]"></div>
          <div class="-mt-6 flex items-end gap-4 px-5 pb-5">
            <div class="grid size-14 shrink-0 place-items-center rounded-2xl border-4 border-card bg-primary text-xl font-bold text-primary-foreground" aria-hidden="true">
              {user.displayName[0]?.toUpperCase() ?? 'K'}
            </div>
            <div class="min-w-0 pb-0.5"><h3 class="truncate text-lg font-bold">{user.displayName}</h3><p class="text-sm text-muted-foreground">@{user.username}</p></div>
          </div>
        </div>
      {/if}

      {#if view === 'search' && searchTerm.length < 2}
        <p class="rounded-[1.5rem] border border-dashed border-border bg-card/60 py-14 text-center text-sm text-muted-foreground" role="status">Enter at least two characters to search.</p>
      {:else if query.isPending}
        <div role="status" aria-label="Loading posts" class="space-y-4">
          {#each [1, 2] as item}
            <div class="h-64 animate-pulse rounded-[1.5rem] border border-border bg-card p-6" aria-hidden="true">
              <div class="size-10 rounded-xl bg-muted"></div>
              <div class="mt-6 h-4 w-3/4 rounded bg-muted"></div>
              <div class="mt-3 h-4 w-1/2 rounded bg-muted"></div>
            </div>
          {/each}
          <span class="sr-only">Loading posts…</span>
        </div>
      {:else if query.isError && !query.data}
        <div class="rounded-[1.5rem] border border-border bg-card px-6 py-14 text-center">
          <p class="text-destructive" role="alert">{query.error.message}</p>
          <Button class="mt-4" variant="outline" onclick={() => query.refetch()}>Try again</Button>
        </div>
      {:else if posts.length === 0}
        <div class="rounded-[1.5rem] border border-border bg-card px-6 py-16 text-center shadow-sm">
          <div class="mx-auto grid size-14 place-items-center rounded-2xl bg-accent"><BookmarkIcon class="size-6 text-primary" /></div>
          <p class="mt-5 text-xl font-bold tracking-tight">
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
              view === 'feed' ? 'Use Post to share a thought, photo or video.' : 'There is nothing to show here yet.'}
          </p>
        </div>
      {:else}
        <div use:trackList class="relative w-full" style:height={$virtualizer.getTotalSize() + 'px'}
          aria-label={view === 'saved' ? 'Saved posts' : view === 'profile' ? 'Profile posts' : view === 'search' ? 'Search results' : 'Posts'}>
            {#each $virtualizer.getVirtualItems().filter((row) => row.index < posts.length) as row (posts[row.index].id)}
              <div data-index={row.index} class="absolute left-0 top-0 w-full pb-4"
                style:transform={'translateY(' + (row.start - $virtualizer.options.scrollMargin) + 'px)'} use:measure>
                <PostCard post={posts[row.index]} viewerId={user.id} {api} {queryClient}
                  onReply={() => reply(posts[row.index])}
                  onQuote={() => quote(posts[row.index])}
                  onOpenPost={openPost}
                  onReact={(value) => react(posts[row.index], value)}
                  onFollow={() => follow(posts[row.index])}
                  onSave={() => save(posts[row.index])}
                  onDelete={() => remove(posts[row.index])} />
              </div>
            {/each}
        </div>
        {#if query.isFetchingNextPage}<p class="mt-3 text-center text-sm text-muted-foreground" role="status">Loading more…</p>{/if}
        {#if query.isFetchNextPageError}
          <Button class="mt-3 w-full" variant="outline" onclick={() => query.fetchNextPage()}>Try loading more</Button>
        {/if}
      {/if}
    {/if}
  </section>
</div>

<Button class="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-4 z-30 h-11 gap-2 rounded-full px-5 shadow-lg lg:hidden"
  disabled={dialogsLoading} onclick={openComposer}><PlusIcon class="size-5" /> {dialogsLoading ? 'Opening…' : 'Post'}</Button>

{#if DialogsComponent}
  <DialogsComponent {api} {user} {queryClient} {replyTo} {quoteTo} {composerOpen} {postDialogOpen}
    post={selectedPost.data} postPending={selectedPost.isPending} postError={selectedPost.error?.message ?? null}
    onComposerOpenChange={(open) => {
      composerOpen = open;
      if (!open) { replyTo = null; quoteTo = null; }
    }}
    onRemoveQuote={() => { quoteTo = null; }} onPublished={updated}
    onPostOpenChange={(open) => {
      if (!open) closePost();
      else if (postId && window.location.hash === `#post/${postId}`) postDialogOpen = true;
    }}
    onClosePost={closePost} onReply={reply} onQuote={quote} onOpenPost={openPost}
    onReact={react} onFollow={follow} onSave={save} onDelete={remove} />
{/if}

<nav class="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-border bg-card/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_35px_-28px_rgba(0,0,0,.45)] backdrop-blur-lg lg:hidden"
  aria-label="Fluo navigation">
  {#each navigation as item (item.id)}
    {@const Icon = item.icon}
    <Button class="h-14 min-w-0 flex-col gap-0.5 rounded-none px-0 text-[10px] font-semibold" variant="ghost"
      aria-label={item.label} title={item.label} aria-current={view === item.id ? 'page' : undefined} onclick={() => navigate(item.id)}>
      <Icon class={view === item.id ? 'size-5 text-primary' : 'size-5'} />
      <span class={(view === item.id ? 'text-primary' : 'text-muted-foreground') + ' hidden min-[375px]:inline'}>{item.label}</span>
    </Button>
  {/each}
</nav>

{#if actionError}
  <div class="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-destructive/35 bg-card p-4 shadow-xl lg:inset-x-auto lg:bottom-6 lg:right-6"
    role="alert">
    <p class="min-w-0 flex-1 text-sm text-destructive">{actionError}</p>
    <Button variant="ghost" size="icon-xs" aria-label="Dismiss message" onclick={() => actionError = ''}><XIcon class="size-4" /></Button>
  </div>
{/if}
