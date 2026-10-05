<script lang="ts">
  // Coordinates Fluo navigation, focused posts, and post actions

  import { onDestroy, onMount, tick } from 'svelte';
  import { pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { createQuery, QueryClient } from '@tanstack/svelte-query';
  import { appPaths } from '@kaordo/links';
  import { createFluoApi, type Feed } from '@kaordo/api-client';
  import type { FluoPost, UserIdentity } from '@kaordo/contracts';
  import { BellIcon, Button, XIcon } from '@kaordo/ui';
  import FluoFeed from './FluoFeed.svelte';
  import PostFocusView from './PostFocusView.svelte';
  import FluoNavigation from './FluoNavigation.svelte';
  import FluoPageHeader from './FluoPageHeader.svelte';
  import {
    errorMessage,
    fluoViewFromHash,
    postHashForId,
    postIdFromHash,
    titleForView,
    type FluoView
  } from './fluo-model';
  import { postBackDestination, viewFromPostHistory } from './post-navigation';
  import { createFluoPostActions, removePostFromCachedFeeds } from './post-actions';

  type FluoDialogsComponent = typeof import('./FluoDialogs.svelte').default;

  let {
    user,
    onBackActionChange
  }: {
    user: UserIdentity;
    onBackActionChange: (action: (() => void) | null) => void;
  } = $props();

  const api = createFluoApi(import.meta.env.VITE_KAORDO_API_URL, import.meta.env.VITE_KAORDO_NODO_URL);
  const queryClient = new QueryClient();
  onDestroy(() => {
    onBackActionChange(null);
    queryClient.clear();
  });
  let view = $state<FluoView>('feed');
  let feed = $state<Feed>('latest');
  let replyTo = $state<FluoPost | null>(null);
  let quoteTo = $state<FluoPost | null>(null);
  let composerOpen = $state(false);
  let postId = $state<string | null>(null);
  let DialogsComponent = $state.raw<FluoDialogsComponent | null>(null);
  let dialogsLoading = $state(false);
  let dialogsPromise: Promise<void> | null = null;
  let historySession = '';
  let retainedFeedScroll: number | null = null;
  let removedIds = $state<string[]>([]);
  let actionError = $state('');
  let deleteTarget = $state<FluoPost | null>(null);
  let deleteError = $state('');
  let deleting = $state(false);
  let searchTerm = $state('');
  const postActions = createFluoPostActions(api, queryClient, (message) => {
    actionError = message;
  });

  const selectedThread = createQuery(() => ({
    queryKey: ['fluo', 'thread', postId],
    queryFn: ({ signal }) => api.thread(postId!, signal),
    enabled: !!postId,
    staleTime: 15_000
  }), () => queryClient);
  const pageTitle = $derived(titleForView(view));

  onMount(() => {
    historySession = window.crypto.randomUUID();
    syncLocation();
    window.addEventListener('hashchange', syncLocation);
    window.addEventListener('popstate', syncLocation);
    return () => {
      window.removeEventListener('hashchange', syncLocation);
      window.removeEventListener('popstate', syncLocation);
    };
  });
  function syncLocation(): void {
    const hash = window.location.hash;
    const hashPostId = postIdFromHash(hash);
    if (hashPostId) {
      if (removedIds.includes(hashPostId)) {
        const returnView = viewFromPostHistory(page.state) ?? view;
        const { cleanState } = postBackDestination(page.state, returnView, historySession);
        replaceState(`#${returnView}`, cleanState);
        postId = null;
        view = returnView;
        restoreFeedScroll();
        return;
      }
      const returnView = viewFromPostHistory(page.state);
      if (returnView) view = returnView;
      postId = hashPostId;
      return;
    }
    const wasViewingPost = !!postId;
    if (postId && deleteTarget?.id === postId) deleteTarget = null;
    postId = null;
    const nextView = fluoViewFromHash(hash);
    if (nextView) view = nextView;
    if (wasViewingPost) restoreFeedScroll();
  }

  function navigate(next: FluoView): void {
    if (postId) postId = null;
    view = next;
    window.location.hash = next;
    actionError = '';
    window.scrollTo({ top: 0 });
  }

  function openPost(id: string): void {
    if (postId === id) return;
    if (!postId) retainedFeedScroll = window.scrollY;
    const hash = postHashForId(id);
    const returnHash = postId ? postHashForId(postId) : `#${view}`;
    if (window.location.hash !== hash) {
      pushState(hash, {
        ...page.state,
        kaordoFluoPost: historySession,
        kaordoFluoReturnView: view,
        kaordoFluoReturnHash: returnHash
      });
    } else if (!postId) {
      const { kaordoFluoPost: _postEntry, ...rest } = page.state;
      replaceState(hash, {
        ...rest,
        kaordoFluoReturnView: view,
        kaordoFluoReturnHash: returnHash
      });
    }
    postId = id;
    window.scrollTo({ top: 0 });
  }

  function restoreFeedScroll(): void {
    const target = retainedFeedScroll;
    if (target === null) return;
    retainedFeedScroll = null;
    void tick().then(() => requestAnimationFrame(() => {
      if (!postId) window.scrollTo({ top: target, behavior: 'instant' });
    }));
  }

  function loadDialogs(): Promise<void> {
    if (DialogsComponent) return Promise.resolve();
    if (dialogsPromise) return dialogsPromise;
    dialogsLoading = true;
    dialogsPromise = import('./FluoDialogs.svelte').then(({ default: component }) => {
      DialogsComponent = component;
    }).catch(() => {
      composerOpen = false;
      actionError = 'Could not load post controls. Try again.';
    }).finally(() => {
      dialogsLoading = false;
      dialogsPromise = null;
    });
    return dialogsPromise;
  }

  function backFromPost(): void {
    if (!postId && !postIdFromHash(window.location.hash)) return;
    const destination = postBackDestination(page.state, view, historySession);
    if (destination.returnThroughHistory) {
      window.history.back();
      return;
    }
    replaceState(destination.hash, destination.cleanState);
    view = destination.view;
    syncLocation();
  }

  function returnToViewAfterDeletedAncestor(): void {
    const destination = postBackDestination(page.state, view, historySession);
    replaceState(`#${destination.view}`, destination.cleanState);
    view = destination.view;
    postId = null;
    restoreFeedScroll();
  }

  $effect(() => onBackActionChange(postId ? backFromPost : null));

  function openComposer(): void {
    replyTo = null;
    quoteTo = null;
    revealComposer();
  }

  function revealComposer(): void {
    composerOpen = true;
    void loadDialogs();
  }

  function openComposerFor(post: FluoPost, intent: 'reply' | 'quote'): void {
    replyTo = intent === 'reply' ? post : null;
    quoteTo = intent === 'quote' ? post : null;
    revealComposer();
  }

  function reply(post: FluoPost): void {
    openComposerFor(post, 'reply');
  }

  function quote(post: FluoPost): void {
    openComposerFor(post, 'quote');
  }

  function updated(): void {
    const repliedTo = replyTo;
    composerOpen = false;
    replyTo = null;
    quoteTo = null;
    actionError = '';
    if (repliedTo) {
      const invalidations = [
        queryClient.invalidateQueries({ queryKey: ['fluo', 'comments', repliedTo.id] }),
        queryClient.invalidateQueries({ queryKey: ['fluo', 'feed'] }),
        queryClient.invalidateQueries({ queryKey: ['fluo', 'thread', postId] })
      ];
      if (repliedTo.parentId) {
        invalidations.push(queryClient.invalidateQueries({ queryKey: ['fluo', 'comments', repliedTo.parentId] }));
      }
      void Promise.all(invalidations);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ['fluo'] });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function remove(post: FluoPost): void {
    deleteTarget = post;
    deleteError = '';
    void loadDialogs();
  }

  async function confirmRemove(): Promise<void> {
    const post = deleteTarget;
    if (!post || deleting) return;
    deleting = true;
    try {
      actionError = '';
      await api.remove(post.id);
      deleteTarget = null;
      const thread = selectedThread.data?.posts ?? [];
      const deletedThreadIndex = thread.findIndex((threadPost) => threadPost.id === post.id);
      const deletedThreadPosts = deletedThreadIndex < 0 ? [] : thread.slice(deletedThreadIndex);
      removedIds = [...new Set([...removedIds, post.id, ...deletedThreadPosts.map((threadPost) => threadPost.id)])];
      if (deletedThreadIndex >= 0 && deletedThreadIndex === thread.length - 1) backFromPost();
      else if (deletedThreadIndex >= 0) returnToViewAfterDeletedAncestor();
      removePostFromCachedFeeds(queryClient, post.id);
      await queryClient.invalidateQueries({ queryKey: ['fluo'] });
    } catch (cause) {
      deleteError = errorMessage(cause, 'Could not delete the post.');
    } finally {
      deleting = false;
    }
  }
</script>

<div class="grid gap-7 pb-24 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10 lg:pb-10">
  <FluoNavigation {view} {user} {dialogsLoading} onNavigate={navigate} onOpenComposer={openComposer} />

  <section class="mx-auto min-w-0 w-full max-w-[46rem]" aria-label={postId ? 'Post' : pageTitle}>
    {#if postId}
      <PostFocusView
        thread={selectedThread.data?.posts ?? []}
        pending={selectedThread.isPending}
        error={selectedThread.error?.message ?? null}
        viewerId={user.id}
        {api}
        {queryClient}
        onRetry={() => void selectedThread.refetch()}
        onReply={reply}
        onQuote={quote}
        onOpenPost={openPost}
        onReact={postActions.react}
        onFollow={postActions.follow}
        onSave={postActions.save}
        onVisibilityChange={postActions.setVisibility}
        onDelete={remove}
      />
    {:else}
      <FluoPageHeader {view} {feed} {user} bind:searchTerm onFeedChange={(nextFeed) => (feed = nextFeed)} />

      {#if view === 'notifications'}
        <div class="rounded-[1.5rem] border border-border bg-card px-6 py-16 text-center shadow-sm">
          <div class="mx-auto grid size-14 place-items-center rounded-2xl bg-accent"><BellIcon class="size-6 text-accent-foreground" /></div>
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
        <FluoFeed
          {view}
          {feed}
          {searchTerm}
          {user}
          {api}
          {queryClient}
          {removedIds}
          onReply={reply}
          onQuote={quote}
          onOpenPost={openPost}
          onReact={postActions.react}
          onFollow={postActions.follow}
          onSave={postActions.save}
          onVisibilityChange={postActions.setVisibility}
          onDelete={remove}
        />
      {/if}
    {/if}
  </section>
</div>

{#if DialogsComponent}
  <DialogsComponent {api} {replyTo} {quoteTo} {composerOpen}
    {deleteTarget} {deleteError} {deleting}
    onComposerOpenChange={(open) => {
      composerOpen = open;
      if (!open) { replyTo = null; quoteTo = null; }
    }}
    onRemoveQuote={() => { quoteTo = null; }} onPublished={updated}
    onDeleteOpenChange={(open) => {
      if (!open && !deleting) deleteTarget = null;
    }} onConfirmDelete={confirmRemove}
  />
{/if}

{#if actionError}
  <div class="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-destructive/35 bg-card p-4 shadow-xl lg:inset-x-auto lg:bottom-6 lg:right-6"
    role="alert">
    <p class="min-w-0 flex-1 text-sm text-destructive">{actionError}</p>
    <Button variant="ghost" size="icon-xs" aria-label="Dismiss message" onclick={() => actionError = ''}><XIcon class="size-4" /></Button>
  </div>
{/if}
