<script lang="ts">
  // Coordinates Fluo navigation, focused posts, and post actions

  import { onDestroy, onMount, setContext, tick } from 'svelte';
  import { pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { createQuery, QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import { createFluoApi, fluoProfileOptions, invalidateFluoPostQueries, removePostFromCachedFeeds, type Feed } from '@kaordo/api-client';
  import type { FluoPost, UserIdentity } from '@kaordo/contracts';
  import { Button, XIcon } from '@kaordo/ui';
  import FluoFeed from './FluoFeed.svelte';
  import FluoNotifications from './FluoNotifications.svelte';
  import FluoSettings from './FluoSettings.svelte';
  import FluoProfile from './FluoProfile.svelte';
  import PostFocusView from './PostFocusView.svelte';
  import FluoNavigation from './FluoNavigation.svelte';
  import { createFluoNotificationState } from './notification-state.svelte.ts';
  import { createFluoSettingsState } from './settings-state.svelte.ts';
  import FluoPageHeader from './FluoPageHeader.svelte';
  import {
    errorMessage,
    fluoViewFromHash,
    fluoViews,
    isFluoSettingsView,
    postHashForId,
    postIdFromHash,
    profileHashForUsername,
    profileUsernameFromHash,
    profileNavigationKey,
    type FluoView
  } from './fluo-model';
  import { postBackDestination, viewFromPostHistory } from './post-navigation';
  import { createFluoPostActions } from './post-actions';

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
  let disposed = false;
  let view = $state<FluoView>('feed');
  let feed = $state<Feed>('latest');
  let replyTo = $state<FluoPost | null>(null);
  let quoteTo = $state<FluoPost | null>(null);
  let composerOpen = $state(false);
  let postId = $state<string | null>(null);
  let profileUsername = $state<string | null>(null);
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
    if (!disposed) actionError = message;
  });

  const selectedThread = createQuery(() => ({
    queryKey: ['fluo', 'thread', postId],
    queryFn: ({ signal }) => api.thread(postId!, signal),
    enabled: !!postId,
    staleTime: 15_000
  }), () => queryClient);
  const pageTitle = $derived(fluoViews[view].title);
  const notificationState = createFluoNotificationState(api, queryClient,
    () => view === 'notifications' && !postId,
    (message) => { if (!disposed) actionError = message; });
  const settingsState = createFluoSettingsState(api, queryClient, () => isFluoSettingsView(view) && !postId);
  const settingsSection = $derived(fluoViews[view].settingsSection ?? null);
  const ownProfileQuery = createQuery(() => ({
    ...fluoProfileOptions(api, user.username),
    refetchInterval: false
  }), () => queryClient);
  const ownProfile = $derived(ownProfileQuery.data);
  setContext(profileNavigationKey, openProfile);

  onDestroy(() => {
    disposed = true;
    onBackActionChange(null);
    postActions.dispose();
    queryClient.clear();
  });

  onMount(() => {
    // Deliver audience keys to accounts followed elsewhere before they open this author's private posts.
    void api.syncKeys().catch(() => {});
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
      if (returnView === 'profile') {
        profileUsername = profileUsernameFromHash(page.state.kaordoFluoProfileHash ?? '')
          ?? profileUsernameFromHash(page.state.kaordoFluoReturnHash ?? '');
      }
      if (removedIds.includes(hashPostId)) {
        const destinationView = returnView ?? view;
        const { cleanState } = postBackDestination(page.state, destinationView, historySession);
        replaceState(viewHash(destinationView), cleanState);
        postId = null;
        view = destinationView;
        restoreFeedScroll();
        return;
      }
      if (returnView) view = returnView;
      postId = hashPostId;
      return;
    }
    const wasViewingPost = !!postId;
    if (postId && deleteTarget?.id === postId) deleteTarget = null;
    postId = null;
    const nextView = fluoViewFromHash(hash);
    if (nextView) view = nextView;
    profileUsername = profileUsernameFromHash(hash);
    if (wasViewingPost) restoreFeedScroll();
  }

  function navigate(next: FluoView): void {
    if (postId) postId = null;
    view = next;
    profileUsername = null;
    const { cleanState } = postBackDestination(page.state, next, historySession);
    pushState(viewHash(next), cleanState);
    actionError = '';
    window.scrollTo({ top: 0 });
  }

  function viewHash(target: FluoView): string {
    return target === 'profile' ? profileHashForUsername(profileUsername ?? user.username) : `#${target}`;
  }

  function openProfile(username: string): void {
    postId = null;
    profileUsername = username;
    view = 'profile';
    retainedFeedScroll = null;
    const { cleanState } = postBackDestination(page.state, view, historySession);
    pushState(profileHashForUsername(username), cleanState);
    actionError = '';
    window.scrollTo({ top: 0 });
  }

  function openPost(id: string): void {
    if (postId === id) return;
    if (!postId) retainedFeedScroll = window.scrollY;
    const hash = postHashForId(id);
    const returnHash = postId ? postHashForId(postId) : viewHash(view);
    if (window.location.hash !== hash) {
      pushState(hash, {
        ...page.state,
        kaordoFluoPost: historySession,
        kaordoFluoReturnView: view,
        kaordoFluoReturnHash: returnHash,
        kaordoFluoProfileHash: view === 'profile' ? viewHash(view) : undefined
      });
    } else if (!postId) {
      const { kaordoFluoPost: _postEntry, ...rest } = page.state;
      replaceState(hash, {
        ...rest,
        kaordoFluoReturnView: view,
        kaordoFluoReturnHash: returnHash,
        kaordoFluoProfileHash: view === 'profile' ? viewHash(view) : undefined
      });
    }
    postId = id;
    window.scrollTo({ top: 0 });
  }

  function restoreFeedScroll(): void {
    const target = retainedFeedScroll;
    if (target === null) return;
    retainedFeedScroll = null;
    void tick().then(() => {
      if (disposed) return;
      requestAnimationFrame(() => {
        if (!disposed && !postId) window.scrollTo({ top: target, behavior: 'instant' });
      });
    });
  }

  function loadDialogs(): Promise<void> {
    if (DialogsComponent) return Promise.resolve();
    if (dialogsPromise) return dialogsPromise;
    dialogsLoading = true;
    dialogsPromise = import('./FluoDialogs.svelte').then(({ default: component }) => {
      if (!disposed) DialogsComponent = component;
    }).catch(() => {
      if (disposed) return;
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
    replaceState(viewHash(destination.view), destination.cleanState);
    view = destination.view;
    postId = null;
    restoreFeedScroll();
  }

  $effect(() => {
    if (postId) onBackActionChange(backFromPost);
    else if (settingsSection) onBackActionChange(() => navigate('settings'));
    else if (view === 'profile' && profileUsername && profileUsername.toLowerCase() !== user.username.toLowerCase()) onBackActionChange(() => navigate('feed'));
    else onBackActionChange(null);
  });

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
    void invalidateFluoPostQueries(queryClient);
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
      if (disposed) return;
      deleteTarget = null;
      const thread = selectedThread.data?.posts ?? [];
      const deletedThreadIndex = thread.findIndex((threadPost) => threadPost.id === post.id);
      const deletedThreadPosts = deletedThreadIndex < 0 ? [] : thread.slice(deletedThreadIndex);
      removedIds = [...new Set([...removedIds, post.id, ...deletedThreadPosts.map((threadPost) => threadPost.id)])];
      if (deletedThreadIndex >= 0 && deletedThreadIndex === thread.length - 1) backFromPost();
      else if (deletedThreadIndex >= 0) returnToViewAfterDeletedAncestor();
      removePostFromCachedFeeds(queryClient, post.id);
      await invalidateFluoPostQueries(queryClient, { notifications: true });
    } catch (cause) {
      if (!disposed) deleteError = errorMessage(cause, 'Could not delete the post.');
    } finally {
      deleting = false;
    }
  }
</script>

<QueryClientProvider client={queryClient}>
<div class="grid gap-7 pb-24 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10 lg:pb-10">
  <FluoNavigation {view} {user} profile={ownProfile} {dialogsLoading} unreadCount={notificationState.unreadCount} onNavigate={navigate} onOpenComposer={openComposer} />

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
      {#if view !== 'profile'}<FluoPageHeader {view} {feed} bind:searchTerm onFeedChange={(nextFeed) => (feed = nextFeed)} />{/if}

      {#if view === 'notifications'}
        <FluoNotifications
          state={notificationState}
          onOpenPost={openPost}
          onOpenProfile={openProfile}
        />
      {:else if isFluoSettingsView(view)}
        <FluoSettings section={settingsSection} state={settingsState} {user} onNavigate={navigate} />
      {:else if view === 'profile'}
        {#key (profileUsername ?? user.username).toLowerCase()}
        <FluoProfile username={profileUsername ?? user.username} viewerId={user.id} {api} {queryClient}>
          {#snippet posts(profile)}
            <FluoFeed {view} {feed} {searchTerm} {user} {api} {queryClient} {removedIds} profileId={profile.id}
              onReply={reply} onQuote={quote} onOpenPost={openPost}
              onReact={postActions.react} onFollow={postActions.follow} onSave={postActions.save}
              onVisibilityChange={postActions.setVisibility} onDelete={remove} />
          {/snippet}
        </FluoProfile>
        {/key}
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
</QueryClientProvider>
