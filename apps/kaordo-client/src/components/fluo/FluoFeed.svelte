<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import {
    fluoPostKey as postIdentity,
    type FluoAuthorProfile,
    type FluoPost,
    type FluoQuote,
  } from '../../lib/domain/fluo';
  import type { FluoGState, FluoSnapshot } from '../../lib/states/FluoGState';
  import { PUBLIC_FLUO_DESTINATION } from '../../lib/gateways/FluoGateway';
  import FluoComposer from './FluoComposer.svelte';
  import FluoPostPage from './FluoPostPage.svelte';
  import PublicProfilePage from './PublicProfilePage.svelte';
  import FluoTimeline from './FluoTimeline.svelte';

  type Props = {
    active?: boolean;
    snapshot: Readonly<FluoSnapshot>;
    fluoState: FluoGState;
  };

  let { active = true, snapshot, fluoState }: Props = $props();
  let composerTrigger = $state<HTMLButtonElement>();
  let shell = $state<HTMLElement>();
  let openPostKey = $state<string | null>(null);
  let postHistory = $state<string[]>([]);
  let composerOpen = $state(false);
  let composerQuote = $state<FluoPost | null>(null);
  let publicProfileUsername = $state<string | null>(null);
  let publicProfile = $state<FluoAuthorProfile | null>(null);
  let publicProfileLoading = $state(false);
  let publicProfileError = $state<string | null>(null);
  let publicProfileFeedState = $state<FluoGState | null>(null);
  let publicProfileSnapshot = $state<Readonly<FluoSnapshot> | null>(null);
  let publicProfileRequestId = 0;
  let publicProfileSyncPostKey: string | null = null;
  let selectedNode = $derived(snapshot.nodes.find(({ id }) => id === snapshot.selectedNodeId));
  let publicAvailable = $derived(Boolean(snapshot.publicStorage?.nodeCandidates.length));
  let openPost = $derived(snapshot.posts.find((post) => postIdentity(post) === openPostKey) ?? null);
  let postBackLabel = $derived(postHistory.length > 1 ? 'Back to quoted post' : 'Back to timeline');

  onDestroy(() => {
    publicProfileRequestId += 1;
    publicProfileFeedState?.dispose();
  });

  $effect(() => {
    if (!active) {
      openPostKey = null;
      postHistory = [];
      if (publicProfileUsername || publicProfileFeedState) closePublicProfile();
      if (!snapshot.isPublishing) {
        composerOpen = false;
        composerQuote = null;
      }
      return;
    }
    if (openPostKey && !openPost) {
      const fallback = [...postHistory].reverse().find((key) =>
        snapshot.posts.some((post) => postIdentity(post) === key));
      if (fallback) {
        const index = postHistory.lastIndexOf(fallback);
        postHistory = postHistory.slice(0, index + 1);
        openPostKey = fallback;
      } else {
        postHistory = [];
        openPostKey = null;
      }
    }
  });

  // A post can be published while its author's profile is open. The global
  // state receives that optimistic row immediately, while the profile has a
  // deliberately independent cursor. Refresh the scoped state once for the
  // new feed row so the page stays current without sharing cursor state or
  // replacing the profile timeline snapshot by hand.
  $effect(() => {
    const username = publicProfileUsername;
    const scopedState = publicProfileFeedState;
    if (!username || !scopedState) {
      publicProfileSyncPostKey = null;
      return;
    }
    const latestAuthorPost = snapshot.posts.find((post) =>
      post.author.trim().toLowerCase() === username);
    if (!latestAuthorPost) return;
    const key = postIdentity(latestAuthorPost);
    if (scopedState.snapshot.posts.some((post) => postIdentity(post) === key)) {
      if (publicProfileSyncPostKey === key) publicProfileSyncPostKey = null;
      return;
    }
    if (publicProfileSyncPostKey === key) return;
    publicProfileSyncPostKey = key;
    scopedState.addAuthorFeedNodeIds([latestAuthorPost.nodeId]);
    void scopedState.refreshFeed();
  });

  function openComposer(quote: FluoPost | null = null): void {
    if (snapshot.isPublishing || openPostKey) return;
    composerQuote = quote;
    composerOpen = true;
  }

  function closeComposer(): void {
    if (snapshot.isPublishing) return;
    composerOpen = false;
    composerQuote = null;
    void tick().then(() => composerTrigger?.focus({ preventScroll: true }));
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !openPostKey) return;
    event.preventDefault();
    closePostPage();
  }

  function openPostPage(post: FluoPost, fromQuote = false): void {
    const key = postIdentity(post);
    if (fromQuote && postHistory.length) {
      if (postHistory.at(-1) !== key) postHistory = [...postHistory, key];
    } else {
      postHistory = [key];
    }
    openPostKey = key;
  }

  function closePostPage(): void {
    if (postHistory.length > 1) {
      postHistory = postHistory.slice(0, -1);
      openPostKey = postHistory.at(-1) ?? null;
      return;
    }
    postHistory = [];
    openPostKey = null;
  }

  function openQuoteComposer(post: FluoPost): void {
    postHistory = [];
    openPostKey = null;
    openComposer(post);
  }

  async function openPublicProfile(author: string): Promise<void> {
    const username = author.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9_]{1,30}[a-z0-9])?$/u.test(username)) return;
    const requestId = ++publicProfileRequestId;
    publicProfileFeedState?.dispose();
    publicProfileFeedState = null;
    publicProfileSnapshot = null;
    publicProfileSyncPostKey = null;
    publicProfileUsername = username;
    publicProfile = null;
    publicProfileError = null;
    publicProfileLoading = true;
    openPostKey = null;
    postHistory = [];
    try {
      const loaded = await fluoState.loadAuthorProfile(username);
      if (requestId !== publicProfileRequestId) return;
      publicProfile = loaded;
      const feedNodeIds = fluoState.getFeedNodeIds();
      const liveAuthorNodeIds = snapshot.posts
        .filter((post) => post.author.trim().toLowerCase() === username)
        .map((post) => post.nodeId);
      const scopedState = fluoState.createAuthorFeedState(
        username,
        uniqueNodeIds([...feedNodeIds, ...liveAuthorNodeIds]),
        (nextSnapshot) => {
          if (requestId === publicProfileRequestId) publicProfileSnapshot = nextSnapshot;
        },
      );
      publicProfileFeedState = scopedState;
      publicProfileSnapshot = scopedState.snapshot;
      scopedState.enter();
    } catch (error) {
      if (requestId === publicProfileRequestId) {
        publicProfileError = error instanceof Error ? error.message : 'Public profile is unavailable.';
      }
    } finally {
      if (requestId === publicProfileRequestId) publicProfileLoading = false;
    }
  }

  function closePublicProfile(): void {
    publicProfileRequestId += 1;
    publicProfileFeedState?.dispose();
    publicProfileFeedState = null;
    publicProfileSnapshot = null;
    publicProfileSyncPostKey = null;
    publicProfileUsername = null;
    publicProfile = null;
    publicProfileLoading = false;
    publicProfileError = null;
  }

  function openQuotedPost(quote: FluoQuote): void {
    const target = snapshot.posts.find((post) => postIdentity(post) === postIdentity(quote));
    if (target) openPostPage(target, true);
  }

  function uniqueNodeIds(nodeIds: readonly string[]): string[] {
    return [...new Set(nodeIds.filter((nodeId) => typeof nodeId === 'string' && nodeId.trim()))];
  }

</script>

<svelte:window onkeydown={handleWindowKeydown} />

<main bind:this={shell} class="fluo-shell" aria-labelledby="fluo-title">
  <div class="fluo-layout">
    <section class="feed-column" aria-label="Global Fluo timeline">
      <header class="feed-header">
        <div>
          <span class="section-eyebrow">Public conversation</span>
          <h1 id="fluo-title">Global timeline</h1>
        </div>
        <div class="feed-header-actions">
          <button
            class="feed-refresh-button"
            class:is-refreshing={snapshot.isRefreshing}
            type="button"
            disabled={snapshot.isRefreshing}
            aria-label="Refresh feed"
            aria-busy={snapshot.isRefreshing}
            title="Refresh feed"
            onclick={() => void fluoState.refreshFeed()}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 9a6 6 0 0 0-10.6-3.8L4 6.7M4 4v2.7h2.7M4 11a6 6 0 0 0 10.6 3.8l1.4-1.5M16 16v-2.7h-2.7" /></svg>
            <span>Refresh</span>
          </button>
          <span class="node-badge">
            <i aria-hidden="true"></i>
            All available Nodo
          </span>
        </div>
      </header>

      <button
        bind:this={composerTrigger}
        class="sui-btn fluo-create-trigger"
        type="button"
        aria-label="Create a post"
        onclick={() => openComposer()}
      >
        <svg class="fluo-create-trigger__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.75 19.25h4.1L19 9.1a2.12 2.12 0 0 0-3-3L5.85 16.25z" />
          <path d="m14.5 7.5 2 2" />
        </svg>
        <span>New post</span>
      </button>

      {#if snapshot.storageError}
        <p class="storage-error" role="alert">{snapshot.storageError}</p>
      {/if}

      <div class="timeline-divider">
        <span>Latest</span>
        <i></i>
      </div>

      {#if snapshot.posts.length}
        <FluoTimeline
          hasMore={snapshot.hasMore}
          isLoading={snapshot.isLoading}
          isLoadingMore={snapshot.isLoadingMore}
          isRefreshing={snapshot.isRefreshing}
          active={active && !publicProfileUsername}
          {fluoState}
          onOpenPost={openPostPage}
          onOpenProfile={openPublicProfile}
          onOpenQuotedPost={openQuotedPost}
          onQuote={openQuoteComposer}
          posts={snapshot.posts}
          scrollElement={shell}
        />
      {:else}
        <div class="empty-feed">
          <span aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M6 5h12v10H9l-3 3V5Zm4 4h4m-4 3h6" /></svg>
          </span>
          <h2>The global feed is quiet</h2>
          <p>Posts from every available Nodo will appear here in publication order. Choosing a Nodo above only decides where your next post is stored.</p>
          {#if snapshot.selectedNodeId === PUBLIC_FLUO_DESTINATION ? publicAvailable : selectedNode}
            <button type="button" onclick={() => openComposer()}>Write a post</button>
          {/if}
        </div>
      {/if}
    </section>

    <aside class="feed-aside" aria-label="About Fluo">
      <section class="aside-card aside-card--intro">
        <span class="aside-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3.5 19 7v5c0 4-2.6 7-7 8.5C7.6 19 5 16 5 12V7l7-3.5Zm-3 8 2 2 4-4" /></svg>
        </span>
        <h2>Node-backed by design</h2>
        <p>Posts and media go directly to Nodo storage. Public Nodo automatically finds shared capacity; Cloudflare only coordinates placement and quota.</p>
      </section>
      <section class="aside-card">
        <span class="aside-label">Storage flow</span>
        <ul>
          <li><i></i><span><strong>Choose</strong><small>Use the public pool or one of your private hosts</small></span></li>
          <li><i></i><span><strong>Transfer</strong><small>Upload directly with resumable tus</small></span></li>
          <li><i></i><span><strong>Own</strong><small>Keep the original bytes on your device</small></span></li>
        </ul>
      </section>
    </aside>
  </div>
</main>

{#if openPost}
  <FluoPostPage
    {fluoState}
    backLabel={postBackLabel}
    onClose={closePostPage}
    onOpenProfile={openPublicProfile}
    onOpenQuotedPost={openQuotedPost}
    onQuote={openQuoteComposer}
    post={openPost}
  />
{/if}

{#if publicProfileUsername}
  <PublicProfilePage
    active={active}
    fluoState={publicProfileFeedState}
    onBack={closePublicProfile}
    onOpenProfile={openPublicProfile}
    onQuote={openQuoteComposer}
    profile={publicProfile}
    profileError={publicProfileError}
    profileLoading={publicProfileLoading}
    snapshot={publicProfileSnapshot}
    username={publicProfileUsername}
  />
{/if}

{#if composerOpen}
  <FluoComposer
    {fluoState}
    onClose={closeComposer}
    quote={composerQuote}
    {snapshot}
  />
{/if}

<style>
  .fluo-shell {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    overflow-anchor: none;
    overscroll-behavior: contain;
    scroll-behavior: auto;
    scrollbar-gutter: stable;
    touch-action: pan-y;
    will-change: scroll-position;
    color: var(--sui-text);
    background: var(--sui-bg);
    /* Keep fixed controls viewport-anchored; paint containment would make a
       fixed descendant relative to this scrolling surface. */
    contain: style;
    isolation: isolate;
  }

  /* SoftUI's vendored palette is scoped here so its global reset cannot alter
     the rest of Kaordo. */
  .fluo-shell {
    --sui-bg: #e4e9f0;
    --sui-bg-light: #edf1f7;
    --sui-bg-dark: #d1d9e6;
    --fluo-shadow-color: rgb(39 51 67 / 20%);
    /* Fluo uses depth-only SoftUI shadows.  A bright highlight on every
       raised surface reads as a white halo against the feed and becomes
       especially distracting around avatars, media labels and controls. */
    --sui-shadow-light: transparent !important;
    --sui-shadow-dark: var(--fluo-shadow-color) !important;
    --sui-primary: #5b54e0;
    --sui-primary-hover: #4a44c4;
    --sui-success: #1fa96e;
    --sui-danger: #d03a5c;
    --sui-warning: #f5a623;
    --sui-text: #2d3748;
    --sui-text-muted: #5a6a7e;
    --sui-text-light: #6a7d94;
    --sui-radius-sm: 10px;
    --sui-radius: 16px;
    --sui-radius-lg: 24px;
    --sui-shadow-raised: 0 5px 14px var(--fluo-shadow-color) !important;
    --sui-shadow-raised-sm: 0 3px 8px var(--fluo-shadow-color) !important;
    --sui-shadow-raised-lg: 0 16px 36px var(--fluo-shadow-color) !important;
    --sui-shadow-inset: inset 3px 3px 8px var(--sui-shadow-dark);
    --sui-shadow-inset-sm: inset 2px 2px 5px var(--sui-shadow-dark);
  }

  :global(html[data-theme='dark']) .fluo-shell {
    --sui-bg: #2a2d35;
    --sui-bg-light: #31343c;
    --sui-bg-dark: #23262d;
    --fluo-shadow-color: rgb(0 0 0 / 42%);
    --sui-shadow-light: transparent !important;
    --sui-shadow-dark: var(--fluo-shadow-color) !important;
    --sui-primary: var(--accent, #69a993);
    --sui-primary-hover: color-mix(in srgb, var(--sui-primary) 84%, white);
    --sui-success: #54c99a;
    --sui-danger: #e28a9e;
    --sui-warning: #f1bd63;
    --sui-text: #e2e8f0;
    --sui-text-muted: #9ba5b8;
    --sui-text-light: #8a94a6;
  }

  .fluo-layout {
    display: grid;
    grid-template-columns: minmax(520px, 680px) 264px;
    align-items: start;
    justify-content: center;
    gap: 24px;
    width: min(100%, 1020px);
    min-height: 100%;
    margin: 0 auto;
    padding: 30px 28px 72px;
  }

  .feed-column { min-width: 0; }

  .feed-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    min-height: 72px;
    margin-bottom: 18px;
    padding: 16px 18px;
    background: var(--sui-bg);
    border-radius: var(--sui-radius);
    box-shadow: var(--sui-shadow-raised);
  }

  .feed-header-actions {
    display: flex;
    align-items: center;
    flex: none;
    gap: 10px;
  }

  .section-eyebrow,
  .aside-label {
    color: var(--sui-primary);
    font-size: calc(9px * var(--text-scale));
    font-weight: 730;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  h1 {
    margin-top: 6px;
    color: var(--sui-text);
    font-size: calc(25px * var(--text-scale));
    font-weight: 690;
    letter-spacing: -0.035em;
  }

  .node-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    color: var(--sui-text-muted);
    background: var(--sui-bg-light);
    border: 0;
    border-radius: 999px;
    box-shadow: var(--sui-shadow-inset-sm);
    font-size: calc(9px * var(--text-scale));
    font-weight: 620;
  }

  .node-badge i {
    width: 6px;
    height: 6px;
    background: var(--sui-success);
    border-radius: 50%;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--sui-success) 18%, transparent);
  }

  .feed-refresh-button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 32px;
    padding: 0 11px;
    color: var(--sui-primary);
    background: var(--sui-bg);
    border: 0;
    border-radius: 999px;
    box-shadow: var(--sui-shadow-raised-sm);
    font: inherit;
    font-size: calc(9px * var(--text-scale));
    font-weight: 650;
    cursor: pointer;
    transition: background 160ms ease, color 160ms ease, transform 160ms ease,
      box-shadow 160ms ease;
  }

  .feed-refresh-button:hover:not(:disabled) {
    color: var(--sui-primary-hover);
    background: var(--sui-bg-light);
    box-shadow: var(--sui-shadow-raised-sm);
    transform: translateY(-1px);
  }

  .feed-refresh-button:active:not(:disabled) {
    box-shadow: var(--sui-shadow-inset-sm);
    transform: translateY(1px);
  }

  .feed-refresh-button:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--sui-primary) 48%, transparent);
    outline-offset: 3px;
  }

  .feed-refresh-button:disabled { cursor: wait; opacity: .72; }
  .feed-refresh-button svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.55; }
  .feed-refresh-button.is-refreshing svg { animation: feed-refresh-spin .75s linear infinite; }

  @keyframes feed-refresh-spin { to { transform: rotate(360deg); } }

  .fluo-create-trigger {
    position: fixed;
    display: inline-flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: center;
    right: max(28px, calc((100% - 1000px) / 2 + 25px));
    left: auto;
    bottom: 46px;
    z-index: 90;
    width: 256px;
    min-width: 254px;
    height: 48px;
    padding: 0 24px;
    color: var(--sui-text);
    background: var(--sui-bg-light);
    border: 0;
    border-radius: 999px;
    cursor: pointer;
    font-family: inherit;
    font-size: calc(12px * var(--text-scale));
    font-weight: 700;
    letter-spacing: .01em;
    white-space: nowrap;
    box-shadow: var(--sui-shadow-raised);
    transition: background 130ms ease, border-color 130ms ease,
      box-shadow 130ms ease, color 130ms ease, transform 130ms ease;
  }

  .fluo-create-trigger__icon {
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }

  .fluo-create-trigger > span {
    display: block;
    flex: 0 0 auto;
    line-height: 1;
  }

  .fluo-create-trigger:hover {
    color: var(--sui-primary);
    background: var(--sui-bg);
    box-shadow: var(--sui-shadow-raised-sm);
    transform: translateY(-1px);
  }

  .fluo-create-trigger:active {
    color: var(--sui-primary);
    background: var(--sui-bg-dark);
    box-shadow: var(--sui-shadow-inset);
    transform: translateY(1px) scale(.985);
  }

  .fluo-create-trigger:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--sui-primary) 48%, transparent);
    outline-offset: 3px;
  }


  .storage-error {
    margin-top: 10px;
    padding: 9px 11px;
    color: color-mix(in srgb, var(--sui-danger) 80%, var(--sui-text));
    background: color-mix(in srgb, var(--sui-danger) 10%, var(--sui-bg));
    border: 0;
    border-radius: var(--sui-radius-sm);
    box-shadow: var(--sui-shadow-inset-sm);
    font-size: calc(10px * var(--text-scale));
  }

  .timeline-divider {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 22px 3px 10px;
  }

  .timeline-divider span {
    padding: 4px 9px;
    color: var(--sui-text-muted);
    background: var(--sui-bg);
    border-radius: 999px;
    box-shadow: var(--sui-shadow-inset-sm);
    font-size: calc(9px * var(--text-scale));
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .timeline-divider i {
    flex: 1;
    height: 1px;
    background: color-mix(in srgb, var(--sui-shadow-dark) 64%, transparent);
  }

  .empty-feed {
    display: flex;
    align-items: center;
    flex-direction: column;
    padding: 48px 24px 44px;
    color: var(--sui-text-muted);
    background: var(--sui-bg);
    border: 0;
    border-radius: var(--sui-radius);
    box-shadow: var(--sui-shadow-inset);
    text-align: center;
  }

  .empty-feed > span { display: grid; width: 42px; height: 42px; color: var(--sui-primary); background: var(--sui-bg); border-radius: var(--sui-radius-sm); box-shadow: var(--sui-shadow-raised-sm); place-items: center; }
  .empty-feed svg { width: 23px; height: 23px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.4; }
  .empty-feed h2 { margin-top: 14px; color: var(--sui-text); font-size: calc(14px * var(--text-scale)); font-weight: 670; }
  .empty-feed p { max-width: 300px; margin-top: 7px; font-size: calc(10px * var(--text-scale)); line-height: 1.55; }
  .empty-feed button { margin-top: 15px; padding: 9px 16px; color: var(--sui-primary); background: var(--sui-bg); border: 0; border-radius: var(--sui-radius-sm); box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: calc(10px * var(--text-scale)); font-weight: 680; transition: box-shadow 140ms ease, transform 140ms ease, color 140ms ease; }
  .empty-feed button:hover { color: var(--sui-primary-hover); box-shadow: var(--sui-shadow-raised-sm); transform: translateY(-1px); }
  .empty-feed button:active { box-shadow: var(--sui-shadow-inset-sm); transform: translateY(1px); }
  .empty-feed button:focus-visible { outline: 2px solid color-mix(in srgb, var(--sui-primary) 48%, transparent); outline-offset: 3px; }

  .feed-aside { display: grid; gap: 14px; padding-top: 90px; }
  .aside-card { padding: 18px; background: var(--sui-bg); border: 0; border-radius: var(--sui-radius); box-shadow: var(--sui-shadow-raised); }
  .aside-card--intro { background: var(--sui-bg); }
  .aside-icon { display: grid; width: 36px; height: 36px; color: var(--sui-primary); background: var(--sui-bg); border: 0; border-radius: var(--sui-radius-sm); box-shadow: var(--sui-shadow-inset-sm); place-items: center; }
  .aside-icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .aside-card h2 { margin-top: 13px; color: var(--sui-text); font-size: calc(12px * var(--text-scale)); font-weight: 680; }
  .aside-card p { margin-top: 7px; color: var(--sui-text-muted); font-size: calc(9px * var(--text-scale)); line-height: 1.6; }
  .aside-card ul { display: grid; gap: 14px; margin: 14px 0 0; padding: 0; list-style: none; }
  .aside-card li { display: grid; grid-template-columns: 7px minmax(0, 1fr); gap: 9px; align-items: start; }
  .aside-card li > i { width: 6px; height: 6px; margin-top: 4px; background: var(--sui-primary); border-radius: 2px; box-shadow: 0 0 0 3px color-mix(in srgb, var(--sui-primary) 13%, transparent); }
  .aside-card li span,
  .aside-card li strong,
  .aside-card li small { display: block; }
  .aside-card li strong { color: var(--sui-text); font-size: calc(9px * var(--text-scale)); font-weight: 670; }
  .aside-card li small { margin-top: 2px; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); line-height: 1.4; }

  @media (max-width: 1120px) {
    .fluo-layout { grid-template-columns: minmax(520px, 700px); }
    .feed-aside { display: none; }
    .fluo-create-trigger {
      right: max(28px, calc((100% - 700px) / 2));
      width: 254px;
      min-width: 254px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .feed-refresh-button,
    .fluo-create-trigger,
    .empty-feed button { transition: none; }
    .feed-refresh-button.is-refreshing svg { animation: none; }
  }

</style>
