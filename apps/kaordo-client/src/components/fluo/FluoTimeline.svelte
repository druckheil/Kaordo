<script lang="ts">
  import {
    createVirtualizer,
    measureElement as tanstackMeasureElement,
  } from '@tanstack/svelte-virtual';
  import type { Virtualizer } from '@tanstack/svelte-virtual';
  import { get } from 'svelte/store';
  import { onMount, tick } from 'svelte';
  import {
    fluoPostKey as postKey,
    type FluoAttachment,
    type FluoPost,
    type FluoQuote,
  } from '../../lib/domain/fluo';
  import type { FluoGState } from '../../lib/states/FluoGState';
  import FluoPostCard from './FluoPostCard.svelte';
  import {
    FLUO_CAROUSEL_MEDIA_WIDTH,
    FLUO_AUDIO_MEDIA_HEIGHT,
    FLUO_MAX_MEDIA_WIDTH,
    getFluoMediaLayout,
  } from './fluoMediaLayout';
  import { countFluoTextLines, FLUO_POST_PREVIEW_LINES, shouldExpandFluoText } from './fluoText';

  type Props = {
    active?: boolean;
    hasMore: boolean;
    isLoading: boolean;
    isLoadingMore: boolean;
    isRefreshing: boolean;
    posts: readonly FluoPost[];
    scrollElement?: HTMLElement;
    fluoState: FluoGState;
    onOpenPost?: (post: FluoPost) => void;
    onOpenProfile?: (username: string) => void;
    onOpenQuotedPost?: (quote: FluoQuote) => void;
    onQuote?: (post: FluoPost) => void;
  };

  type MediaLoadTask = {
    active: boolean;
    load: () => Promise<void>;
    postKey: string;
    queued: boolean;
    started: boolean;
  };

  const INITIAL_METADATA_BUFFER = 120;
  const VIRTUAL_OVERSCAN_POSTS = 50;
  const MEDIA_PREFETCH_POSTS = 12;
  const MAX_CONCURRENT_MEDIA_LOADS = 6;
  const MEDIA_STARTS_PER_FRAME = 3;
  const POST_GAP = 8;
  const QUOTED_POST_MEDIA_WIDTH = 360;
  const QUOTED_POST_CAROUSEL_MEDIA_WIDTH = 280;
  const QUOTED_POST_TEXT_CHARS_PER_LINE = 70;
  const QUOTED_POST_TEXT_LINE_HEIGHT = 15;

  let {
    active = true,
    hasMore,
    isLoading,
    isLoadingMore,
    isRefreshing,
    posts,
    scrollElement,
    fluoState,
    onOpenPost,
    onOpenProfile,
    onOpenQuotedPost,
    onQuote,
  }: Props = $props();
  let list = $state<HTMLDivElement>();
  let destroyed = false;
  let layoutFrame = 0;
  let pageRequestFrame = 0;
  let pageRequestInFlight = false;
  let activeMediaLoads = 0;
  let mediaPumpFrame = 0;
  let mediaWindowStart = 0;
  let mediaWindowEnd = -1;
  let visibleStart = 0;
  let visibleEnd = -1;
  let lastListWidth = 0;
  let lastScrollMargin = -1;
  const mediaTasks = new Set<MediaLoadTask>();
  const mediaQueue = new Set<MediaLoadTask>();

  const virtualizer = createVirtualizer<HTMLElement, HTMLDivElement>({
    count: 0,
    estimateSize: estimatePostHeight,
    gap: POST_GAP,
    getItemKey: itemKey,
    getScrollElement: () => scrollElement ?? null,
    // Avoid an empty first paint before WebKit delivers its first geometry
    // callback. The real rect replaces this conservative bootstrap value.
    initialRect: { height: 900, width: 680 },
    measureElement: measurePostElement,
    overscan: VIRTUAL_OVERSCAN_POSTS,
    scrollMargin: 0,
    // Measurements arrive before paint. Adding another rAF here creates a
    // visible one-frame hole during fast reverse scrolling.
    useAnimationFrameWithResizeObserver: false,
  });

  // TanStack owns both the row range and its geometry. Do not provide a
  // second, estimated row list while the scroll element is settling: mixing
  // independently calculated starts with TanStack's measured total is what
  // makes cards occasionally overlap or leave an oversized gap.
  let virtualRows = $derived($virtualizer.getVirtualItems());
  let totalHeight = $derived($virtualizer.getTotalSize());
  let postIndices = $derived.by(() => new Map(
    posts.map((post, index) => [postKey(post), index] as const),
  ));

  onMount(() => {
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleLayoutSync);
    if (scrollElement) resizeObserver?.observe(scrollElement);
    if (list) {
      resizeObserver?.observe(list);
      if (list.parentElement) resizeObserver?.observe(list.parentElement);
    }
    scheduleLayoutSync();

    return () => {
      destroyed = true;
      resizeObserver?.disconnect();
      mediaTasks.clear();
      mediaQueue.clear();
      if (layoutFrame) cancelAnimationFrame(layoutFrame);
      if (mediaPumpFrame) cancelAnimationFrame(mediaPumpFrame);
      if (pageRequestFrame) cancelAnimationFrame(pageRequestFrame);
    };
  });

  // Keep mutable adapter options in sync explicitly. The Svelte adapter does
  // not track getter values passed during construction.
  $effect(() => {
    const count = posts.length;
    const element = scrollElement;
    const margin = listOffset();
    lastScrollMargin = margin;
    get(virtualizer).setOptions({
      count,
      estimateSize: estimatePostHeight,
      gap: POST_GAP,
      getItemKey: itemKey,
      getScrollElement: () => element ?? null,
      overscan: VIRTUAL_OVERSCAN_POSTS,
      scrollMargin: margin,
      useAnimationFrameWithResizeObserver: false,
    });
  });

  // Metadata remains cheap and is fetched ahead of the renderer. This gives
  // the 50-row overscan real post shells instead of a network-bound blank end.
  $effect(() => {
    if (!active) return;
    const lastRendered = virtualRows.at(-1)?.index ?? -1;
    posts.length;
    hasMore;
    isLoading;
    isLoadingMore;
    isRefreshing;
    if (hasMore && (posts.length < INITIAL_METADATA_BUFFER ||
        lastRendered >= posts.length - VIRTUAL_OVERSCAN_POSTS)) {
      requestNextPage();
    }
  });

  // Media prefetch follows the real visible range, not the much larger DOM
  // overscan. Visible attachments always jump ahead of stale prefetch work.
  $effect(() => {
    active;
    posts.length;
    if (!active) {
      mediaWindowStart = 0;
      mediaWindowEnd = -1;
      refreshMediaQueue();
      return;
    }
    const range = $virtualizer.range;
    if (!range) return;
    visibleStart = range.startIndex;
    visibleEnd = range.endIndex;
    mediaWindowStart = Math.max(0, visibleStart - MEDIA_PREFETCH_POSTS);
    mediaWindowEnd = Math.min(posts.length - 1, visibleEnd + MEDIA_PREFETCH_POSTS);
    refreshMediaQueue();
  });

  function itemKey(index: number): string | number {
    const post = posts[index];
    return post ? postKey(post) : index;
  }

  function estimatePostHeight(index: number): number {
    const post = posts[index];
    if (!post) return 220;
    const textLines = post.body
      ? Math.min(FLUO_POST_PREVIEW_LINES, Math.max(1, countFluoTextLines(post.body)))
      : 0;
    const expandControl = shouldExpandFluoText(post.body) ? 35 : 0;
    const contentHeight = post.attachments.length
      ? 113 + textLines * 20 + expandControl + estimateMediaHeight(
          post.id,
          post.attachments,
          post.attachments.length === 1 ? FLUO_MAX_MEDIA_WIDTH : FLUO_CAROUSEL_MEDIA_WIDTH,
          postKey(post),
        )
      : 91 + textLines * 20 + expandControl;
    return contentHeight + estimateQuotedPostHeight(post.quote);
  }

  /**
   * Keep a realistic row size before a quoted card or its media is mounted.
   * The virtualizer corrects this estimate with the measured border box, but
   * omitting the quote here lets the next absolute row paint on top of it
   * during that first frame.
   */
  function estimateQuotedPostHeight(quote: FluoQuote | undefined): number {
    if (!quote) return 0;

    const hasTextBlock = Boolean(quote.body) || quote.attachments.length === 0;
    const textLines = hasTextBlock
      ? Math.max(1, countFluoTextLines(quote.body, QUOTED_POST_TEXT_CHARS_PER_LINE))
      : 0;
    const mediaHeight = quote.attachments.length
      ? estimateMediaHeight(
          quote.id,
          quote.attachments,
          quote.attachments.length === 1
            ? QUOTED_POST_MEDIA_WIDTH
            : QUOTED_POST_CAROUSEL_MEDIA_WIDTH,
          postKey(quote),
        )
      : 0;

    // margin-top + vertical padding + header + author + body + media margin.
    return 12 + 23 + 13 + 28 + (textLines ? 8 + textLines * QUOTED_POST_TEXT_LINE_HEIGHT : 0) +
      (mediaHeight > 0 ? 10 + mediaHeight : 0);
  }

  function estimateMediaHeight(
    postId: string,
    attachments: readonly FluoAttachment[],
    mediaWidth: number,
    mediaIdentity: string,
  ): number {
    return attachments.reduce((maximum, attachment) => {
      if (attachment.kind === 'audio') return Math.max(maximum, FLUO_AUDIO_MEDIA_HEIGHT);
      const measured = attachment.width && attachment.height
        ? attachment
        : fluoState.getMediaDimensions?.(postId, attachment.id, mediaIdentity);
      return Math.max(maximum, getFluoMediaLayout(measured?.width, measured?.height, mediaWidth).height);
    }, 0);
  }

  function measurePostElement(
    element: HTMLDivElement,
    entry: Parameters<typeof tanstackMeasureElement>[1],
    instance: Virtualizer<HTMLElement, HTMLDivElement>,
  ): number {
    // TanStack intentionally returns the cached size for a sync measurement
    // without a ResizeObserver entry. A virtualized row can be remounted with
    // changed quote/media content while keeping the same key, so use the real
    // border-box height in that path instead of reviving a stale cache entry.
    const measured = entry ? tanstackMeasureElement(element, entry, instance) : element.offsetHeight;
    if (measured > 0) return measured;
    const index = Number(element.dataset.index);
    return Number.isSafeInteger(index) ? estimatePostHeight(index) : 220;
  }

  function measurePost(element: HTMLDivElement, _size: number) {
    get(virtualizer).measureElement(element);
    return {
      update: () => get(virtualizer).measureElement(element),
      destroy: () => get(virtualizer).measureElement(null),
    };
  }

  function scheduleLayoutSync(): void {
    if (destroyed || layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      if (!list) return;
      const instance = get(virtualizer);
      const width = list.clientWidth;
      const margin = listOffset();
      if (Math.abs(margin - lastScrollMargin) > 0.5) {
        lastScrollMargin = margin;
        instance.setOptions({ scrollMargin: margin });
      }
      // Text wrapping and media columns change only when the logical list
      // width changes. Do not throw away every measured row on height-only
      // updates such as pagination or composer growth.
      if (width > 0 && width !== lastListWidth) {
        lastListWidth = width;
        instance.measure();
      }
    });
  }

  function listOffset(): number {
    if (!list || !scrollElement) return 0;
    const listRect = list.getBoundingClientRect();
    const scrollRect = scrollElement.getBoundingClientRect();
    // offsetTop is unreliable through nested grid containers. This formula
    // stays in the scroll element's coordinate space and remains stable under
    // CSS application scaling.
    const visualOffset = listRect.top - scrollRect.top;
    const scale = list.offsetWidth > 0 ? listRect.width / list.offsetWidth : 1;
    return Math.max(0, scrollElement.scrollTop + visualOffset / Math.max(scale, 0.01));
  }

  function registerMedia(postKey: string, load: () => Promise<void>): () => void {
    const task: MediaLoadTask = { active: true, load, postKey, queued: false, started: false };
    mediaTasks.add(task);
    if (isMediaTaskWanted(task)) enqueueMedia(task);
    return () => {
      task.active = false;
      task.queued = false;
      mediaTasks.delete(task);
      mediaQueue.delete(task);
    };
  }

  function refreshMediaQueue(): void {
    for (const task of mediaTasks) {
      const wanted = isMediaTaskWanted(task);
      if (wanted) enqueueMedia(task);
      else if (task.queued) {
        task.queued = false;
        mediaQueue.delete(task);
      }
    }
    scheduleMediaPump();
  }

  function isMediaTaskWanted(task: MediaLoadTask): boolean {
    const index = postIndices.get(task.postKey);
    return active && index !== undefined && index >= mediaWindowStart && index <= mediaWindowEnd;
  }

  function enqueueMedia(task: MediaLoadTask): void {
    if (destroyed || !task.active || task.queued || task.started) return;
    task.queued = true;
    mediaQueue.add(task);
    scheduleMediaPump();
  }

  function scheduleMediaPump(): void {
    if (destroyed || mediaPumpFrame || !mediaQueue.size) return;
    mediaPumpFrame = requestAnimationFrame(() => {
      mediaPumpFrame = 0;
      pumpMediaQueue();
    });
  }

  function pumpMediaQueue(): void {
    let startedThisFrame = 0;
    while (!destroyed && active && activeMediaLoads < MAX_CONCURRENT_MEDIA_LOADS && mediaQueue.size &&
        startedThisFrame < MEDIA_STARTS_PER_FRAME) {
      const task = nextMediaTask();
      if (!task) break;
      mediaQueue.delete(task);
      task.queued = false;
      if (!task.active || task.started) continue;
      task.started = true;
      activeMediaLoads += 1;
      startedThisFrame += 1;
      // A failed media transfer must release the scheduler slot without
      // creating an unhandled rejection in the WebView. The card owns the
      // visible error state; the timeline only coordinates concurrency.
      void task.load().catch(() => undefined).finally(() => {
        activeMediaLoads = Math.max(0, activeMediaLoads - 1);
        scheduleMediaPump();
      });
    }
    if (mediaQueue.size && activeMediaLoads < MAX_CONCURRENT_MEDIA_LOADS) scheduleMediaPump();
  }

  function nextMediaTask(): MediaLoadTask | null {
    let best: MediaLoadTask | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const center = (visibleStart + visibleEnd) / 2;
    for (const task of mediaQueue) {
      if (!task.active || task.started) continue;
      const index = postIndices.get(task.postKey);
      if (index === undefined) {
        task.queued = false;
        mediaQueue.delete(task);
        continue;
      }
      const visible = index >= visibleStart && index <= visibleEnd;
      const score = Math.abs(index - center) - (visible ? 10_000 : 0);
      if (score < bestScore) {
        best = task;
        bestScore = score;
      }
    }
    return best;
  }

  function requestNextPage(): void {
    if (destroyed || !active || pageRequestInFlight || !hasMore ||
        isLoading || isRefreshing || isLoadingMore) return;
    const countBeforeRequest = posts.length;
    pageRequestInFlight = true;
    void (async () => {
      try {
        await fluoState.loadMore();
      } catch {
        // FluoGState owns the user-facing network error.
      }
      await tick();
      const shouldContinue = !destroyed && active && posts.length > countBeforeRequest && hasMore &&
        posts.length < INITIAL_METADATA_BUFFER;
      if (!shouldContinue) {
        pageRequestInFlight = false;
        return;
      }
      pageRequestFrame = requestAnimationFrame(() => {
        pageRequestFrame = 0;
        pageRequestInFlight = false;
        requestNextPage();
      });
    })();
  }

</script>

<div
  bind:this={list}
  class="post-list"
  class:post-list--scrolling={$virtualizer.isScrolling}
  aria-label="Posts"
  style={`height:${totalHeight}px`}
>
  {#each virtualRows as row (row.key)}
    {@const post = posts[row.index]}
    {#if post}
      <div
        class="virtual-post"
        data-index={row.index}
        data-post-key={postKey(post)}
        style={`transform:translateY(${row.start - $virtualizer.options.scrollMargin}px)`}
        use:measurePost={row.size}
      >
        <FluoPostCard
          {active}
          {post}
          {fluoState}
          onOpen={onOpenPost ? () => onOpenPost(post) : undefined}
          {onOpenProfile}
          onOpenQuote={onOpenQuotedPost}
          onQuote={onQuote ? () => onQuote(post) : undefined}
          registerMedia={(load) => registerMedia(postKey(post), load)}
        />
      </div>
    {/if}
  {/each}
</div>

<div class="feed-page-loader" aria-live="polite">
  {#if isLoadingMore}
    <i></i><span>Loading more posts…</span>
  {:else if !hasMore}
    <span>You reached the beginning of this timeline.</span>
  {/if}
</div>

<style>
  .post-list {
    position: relative;
    width: 100%;
    min-height: 1px;
    overflow-anchor: none;
  }

  /* Cards passing under a stationary pointer must not start dozens of hover
     transitions while the compositor is servicing a fast scroll. */
  .post-list--scrolling {
    pointer-events: none;
  }

  .virtual-post {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
  }

  .feed-page-loader {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 48px;
    color: var(--sui-text-muted);
    font-size: calc(9px * var(--text-scale));
  }

  .feed-page-loader i {
    width: 14px;
    height: 14px;
    border: 2px solid color-mix(in srgb, var(--sui-shadow-dark) 60%, transparent);
    border-top-color: var(--sui-primary);
    border-radius: 50%;
    animation: feed-spin .7s linear infinite;
  }

  @keyframes feed-spin { to { transform: rotate(360deg); } }
</style>
