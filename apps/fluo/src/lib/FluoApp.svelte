<script lang="ts">
  // Coordinates Fluo navigation, post actions, and post-dialog history

  import { onDestroy, onMount } from 'svelte';
  import { pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { createQuery, QueryClient } from '@tanstack/svelte-query';
  import { appPaths } from '@kaordo/links';
  import { createFluoApi, type Feed } from '@kaordo/api-client';
  import type { FluoPost, UserIdentity } from '@kaordo/contracts';
  import { BellIcon, Button, XIcon } from '@kaordo/ui';
  import FluoFeed from './FluoFeed.svelte';
  import FluoNavigation from './FluoNavigation.svelte';
  import FluoPageHeader from './FluoPageHeader.svelte';
  import { errorMessage, fluoViewFromHash, postIdFromHash, titleForView, type FluoView } from './fluo-model';
  import { postCloseDestination, viewFromPostHistory } from './post-navigation';
  import { createFluoPostActions, removePostFromCachedFeeds } from './post-actions';

  type FluoDialogsComponent = typeof import('./FluoDialogs.svelte').default;

  let { user }: { user: UserIdentity } = $props();

  const api = createFluoApi(import.meta.env.VITE_KAORDO_API_URL, import.meta.env.VITE_KAORDO_NODO_URL);
  const queryClient = new QueryClient();
  onDestroy(() => queryClient.clear());
  let view = $state<FluoView>('feed');
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

  const selectedPost = createQuery(() => ({
    queryKey: ['fluo', 'post', postId],
    queryFn: ({ signal }) => api.get(postId!, signal),
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
      const returnView = viewFromPostHistory(page.state);
      if (returnView) view = returnView;
      postId = hashPostId;
      postDialogOpen = true;
      void loadDialogs();
      return;
    }
    const wasViewingPost = !!postId;
    if (postId && deleteTarget?.id === postId) deleteTarget = null;
    postId = null;
    postDialogOpen = false;
    const nextView = fluoViewFromHash(hash);
    if (nextView) view = nextView;
    if (wasViewingPost) restoreFeedScroll();
  }

  function navigate(next: FluoView): void {
    view = next;
    window.location.hash = next;
    actionError = '';
    window.scrollTo({ top: 0 });
  }

  function openPost(id: string): void {
    if (!postId) retainedFeedScroll = window.scrollY;
    const hash = `#post/${id}`;
    const returnHash = postDialogOpen && postId ? `#post/${postId}` : `#${view}`;
    if (window.location.hash !== hash) {
      pushState(hash, {
        ...page.state,
        kaordoFluoPost: historySession,
        kaordoFluoReturnView: view,
        kaordoFluoReturnHash: returnHash
      });
    } else if (!postDialogOpen) {
      const { kaordoFluoPost: _postEntry, ...rest } = page.state;
      replaceState(hash, {
        ...rest,
        kaordoFluoReturnView: view,
        kaordoFluoReturnHash: returnHash
      });
    }
    postId = id;
    postDialogOpen = true;
    void loadDialogs();
  }

  function restoreFeedScroll(): void {
    const target = retainedFeedScroll;
    if (target === null) return;
    const restore = () => {
      if (!postDialogOpen) window.scrollTo({ top: target, behavior: 'instant' });
    };
    queueMicrotask(restore);
    requestAnimationFrame(restore);
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

  function closePost(): void {
    if (!postId && !window.location.hash.startsWith('#post/')) return;
    const destination = postCloseDestination(page.state, view, historySession);
    postId = null;
    postDialogOpen = false;
    if (destination.returnThroughHistory) {
      window.history.back();
      if (!destination.hash.startsWith('#post/')) restoreFeedScroll();
      return;
    }
    replaceState(destination.hash, destination.cleanState);
    view = destination.view;
    syncLocation();
    if (!destination.hash.startsWith('#post/')) restoreFeedScroll();
  }

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
    if (postId) closePost();
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

  function remove(post: FluoPost): void {
    if (postId === post.id) postDialogOpen = false;
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
      removedIds = [...removedIds, post.id];
      if (postId === post.id) closePost();
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

  <section class="mx-auto min-w-0 w-full max-w-[46rem]" aria-label={pageTitle}>
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
        onDelete={remove}
      />
    {/if}
  </section>
</div>

{#if DialogsComponent}
  <DialogsComponent {api} {user} {queryClient} {replyTo} {quoteTo} {composerOpen} {postDialogOpen}
    {deleteTarget} {deleteError} {deleting}
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
    onDeleteOpenChange={(open) => {
      if (!open && !deleting) {
        const returnToPost = postId === deleteTarget?.id && window.location.hash === `#post/${postId}`;
        deleteTarget = null;
        if (returnToPost) postDialogOpen = true;
      }
    }} onConfirmDelete={confirmRemove}
    onReact={postActions.react} onFollow={postActions.follow} onSave={postActions.save} onDelete={remove} />
{/if}

{#if actionError}
  <div class="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-destructive/35 bg-card p-4 shadow-xl lg:inset-x-auto lg:bottom-6 lg:right-6"
    role="alert">
    <p class="min-w-0 flex-1 text-sm text-destructive">{actionError}</p>
    <Button variant="ghost" size="icon-xs" aria-label="Dismiss message" onclick={() => actionError = ''}><XIcon class="size-4" /></Button>
  </div>
{/if}
