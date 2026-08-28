import type { NodoNode } from '../domain/nodo';
import {
  PUBLIC_FLUO_DESTINATION,
  type FluoLikeState,
  type FluoLikeTarget,
  type FluoNodeFeedState,
  type FluoSpace,
  type FluoGateway,
  type FluoUploadProgress,
  type RemoteFluoPost,
} from '../gateways/FluoGateway';
import type { NodoGateway } from '../gateways/NodoGateway';
import type { PublicNodoStorage } from '../domain/nodo';
import { GState } from '../state/GState';
import { FluoFeedCache } from '../services/FluoFeedCache';
import { NodoRegistry } from '../services/NodoRegistry';

export const FLUO_MAX_POST_LENGTH = 5_000;
export const FLUO_MAX_ATTACHMENTS = 4;

export type FluoAttachmentKind = 'gif' | 'image' | 'video';

export type FluoAttachment = {
  height?: number;
  id: string;
  kind: FluoAttachmentKind;
  mimeType: string;
  name: string;
  size: number;
  loadState?: 'error' | 'idle' | 'loading' | 'ready';
  objectUrl?: boolean;
  url?: string;
  width?: number;
};

export type FluoDraftAttachment = FluoAttachment & { blob: Blob; url: string };

/**
 * The compact, immutable snapshot stored with a quoted post.  It deliberately
 * excludes local object URLs and interaction state so a quote remains a small
 * piece of Nodo metadata instead of duplicating the original payload.
 */
export type FluoQuote = {
  attachments: FluoAttachment[];
  author: string;
  body: string;
  createdAt: number;
  id: string;
  nodeId: string;
  space: 'private' | 'public';
};

export type FluoPost = {
  attachments: FluoAttachment[];
  author: string;
  body: string;
  createdAt: number;
  id: string;
  liked: boolean;
  likeCount?: number;
  likePending?: boolean;
  nodeId: string;
  quote?: FluoQuote;
  space: 'private' | 'public';
};

/**
 * Minimal post identity used by media rendered outside the main timeline
 * (for example, an attachment inside a quoted post).
 */
export type FluoMediaOwner = Pick<FluoPost, 'id' | 'nodeId' | 'space'>;

/** Creates a wire-safe quote snapshot from a hydrated feed post. */
export function createFluoQuote(post: FluoPost): FluoQuote {
  return {
    attachments: post.attachments.map(({ loadState: _loadState, objectUrl: _objectUrl, url: _url, ...attachment }) => ({
      ...attachment,
    })),
    author: post.author,
    body: post.body,
    createdAt: post.createdAt,
    id: post.id,
    nodeId: post.nodeId,
    space: post.space,
  };
}

export type FluoSnapshot = {
  attachmentError: string | null;
  draft: string;
  draftAttachments: FluoDraftAttachment[];
  isLoading: boolean;
  isRefreshing: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  isPublishing: boolean;
  nodes: NodoNode[];
  posts: FluoPost[];
  publicStorage: PublicNodoStorage | null;
  selectedNodeId: string | null;
  storageError: string | null;
  uploadProgress: FluoUploadProgress | null;
};

export type FluoGStateOptions = {
  cacheOwnerId?: string | null;
  cacheStorage?: Storage;
  createId?: () => string;
  createObjectUrl?: (blob: Blob) => string;
  onStorageChanged?: (nodeId: string, space: 'private' | 'public') => void | Promise<void>;
  revokeObjectUrl?: (url: string) => void;
  registry?: NodoRegistry;
  selectionStorage?: Storage | null;
};

/** Owns the global node-backed Fluo timeline and its small metadata snapshot. */
export class FluoGState extends GState<FluoSnapshot> {
  readonly #feedCache: FluoFeedCache;
  readonly #createId: () => string;
  readonly #createObjectUrl: (blob: Blob) => string;
  readonly #gateway: FluoGateway;
  readonly #nodes: NodoGateway;
  readonly #onStorageChanged: ((nodeId: string, space: 'private' | 'public') => void | Promise<void>) | null;
  readonly #registry: NodoRegistry;
  readonly #revokeObjectUrl: (url: string) => void;
  readonly #selectionStorage: Storage | null;
  #lifecycleId = 0;
  #requestId = 0;
  #feedCursor: string | null = null;
  #feedWarmupPending = false;
  #feedNodeIds: string[] = [];
  #feedStates = new Map<string, FluoNodeFeedState>();
  #mediaCache = new Map<string, CachedFluoMedia>();
  #mediaRequests = new Map<string, Promise<string | null>>();
  #mediaSources = new Map<string, ResolvedFluoMedia>();
  #mediaGeneration = 0;
  #mediaCacheBytes = 0;
  #mediaCacheClock = 0;
  #mediaDimensions = new Map<string, { height: number; width: number }>();
  #likeRequests = new Map<string, Promise<boolean>>();
  #likeDesiredStates = new Map<string, boolean>();
  #likeStateRequests = new Map<string, Promise<void>>();
  #likeMutationEpochs = new Map<string, number>();
  #pageSize = INITIAL_FEED_PAGE_SIZE;
  #cacheOwnerId: string | null;
  #cacheRestorePromise: Promise<void> | null = null;
  #persistScheduled = false;
  #persistGeneration = 0;
  #unsubscribeRegistry: (() => void) | null = null;
  #feedStatesInFlight: {
    key: string;
    lifecycleId: number;
    promise: Promise<FluoNodeFeedState[]>;
  } | null = null;
  #refreshInFlight: { lifecycleId: number; promise: Promise<void> } | null = null;
  #nodesResolved = false;

  constructor(gateway: FluoGateway, nodes: NodoGateway, options: FluoGStateOptions = {}) {
    const cacheOwnerId = normalizeCacheOwner(options.cacheOwnerId ?? null);
    const selectionStorage = options.selectionStorage !== undefined
      ? options.selectionStorage
      : options.cacheStorage ?? browserStorage();
    super({
      attachmentError: null,
      draft: '',
      draftAttachments: [],
      isLoading: false,
      isRefreshing: false,
      hasMore: false,
      isLoadingMore: false,
      isPublishing: false,
      nodes: [],
      posts: [],
      publicStorage: null,
      selectedNodeId: readSelectedNode(selectionStorage, cacheOwnerId),
      storageError: null,
      uploadProgress: null,
    });
    this.#gateway = gateway;
    this.#nodes = nodes;
    this.#cacheOwnerId = cacheOwnerId;
    this.#selectionStorage = selectionStorage;
    this.#feedCache = new FluoFeedCache({ storage: options.cacheStorage });
    this.#onStorageChanged = options.onStorageChanged ?? null;
    this.#registry = options.registry ?? new NodoRegistry();
    this.#createId = options.createId ?? createLocalId;
    this.#createObjectUrl = options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.#revokeObjectUrl = options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
  }

  override enter(): void {
    this.#unsubscribeRegistry = this.#registry.subscribe((nodes) => this.applyNodes(nodes));
    const lifecycleId = this.#lifecycleId;
    this.#cacheRestorePromise = Promise.resolve().then(() => {
      if (lifecycleId === this.#lifecycleId) this.restoreFeedCache();
    });
    void this.refreshNodes();
  }

  override exit(): void {
    this.#lifecycleId += 1;
    this.#requestId += 1;
    this.#likeRequests.clear();
    this.#likeDesiredStates.clear();
    this.#likeStateRequests.clear();
    this.#likeMutationEpochs.clear();
    this.#unsubscribeRegistry?.();
    this.#unsubscribeRegistry = null;
    this.#cacheRestorePromise = null;
    this.revokeUrls(this.snapshot.draftAttachments, false);
    this.publish({
      ...this.snapshot,
      attachmentError: null,
      draft: '',
      draftAttachments: [],
      isLoading: false,
      isRefreshing: false,
      isLoadingMore: false,
      isPublishing: false,
      storageError: null,
      uploadProgress: null,
    });
  }

  /** Drops the in-memory feed cache when the authenticated application stops. */
  clearCache(): void {
    this.resetInMemoryFeed();
  }

  private resetInMemoryFeed(): void {
    this.#lifecycleId += 1;
    this.#requestId += 1;
    this.#persistGeneration += 1;
    this.#gateway.resetSession?.();
    this.#feedCursor = null;
    this.#feedWarmupPending = false;
    this.#feedNodeIds = [];
    this.#feedStates.clear();
    this.#pageSize = INITIAL_FEED_PAGE_SIZE;
    this.#cacheRestorePromise = null;
    this.#feedStatesInFlight = null;
    this.#nodesResolved = false;
    this.#likeRequests.clear();
    this.#likeDesiredStates.clear();
    this.#likeStateRequests.clear();
    this.#likeMutationEpochs.clear();
    this.#mediaGeneration += 1;
    this.#nodes.resetSession?.();
    this.#mediaRequests.clear();
    this.#mediaDimensions.clear();
    this.clearMediaCache();
    this.revokeUrls(this.snapshot.posts.flatMap((post) => post.attachments));
    this.revokeUrls(this.snapshot.draftAttachments, false);
    this.publish({
      ...this.snapshot,
      attachmentError: null,
      draft: '',
      draftAttachments: [],
      isLoading: false,
      isRefreshing: false,
      hasMore: false,
      isLoadingMore: false,
      isPublishing: false,
      nodes: [],
      posts: [],
      publicStorage: null,
      selectedNodeId: readSelectedNode(this.#selectionStorage, this.#cacheOwnerId),
      storageError: null,
      uploadProgress: null,
    });
  }

  /** Selects the account namespace used by the persistent feed metadata. */
  configureCacheOwner(ownerId: string | null): void {
    const normalized = normalizeCacheOwner(ownerId);
    if (normalized === this.#cacheOwnerId) return;
    this.#cacheOwnerId = normalized;
    this.resetInMemoryFeed();
  }

  async refreshFeed(): Promise<void> {
    await this.refreshNodes(true);
  }

  async refreshNodes(forceReload = false): Promise<void> {
    const existing = this.#refreshInFlight;
    if (existing?.lifecycleId === this.#lifecycleId) return existing.promise;

    const lifecycleId = this.#lifecycleId;
    const restore = this.#cacheRestorePromise;
    const request = (async () => {
      await restore;
      if (lifecycleId !== this.#lifecycleId) return;
      await this.refreshNodesInternal(forceReload);
    })();
    let sharedRequest: Promise<void>;
    sharedRequest = request.finally(() => {
      if (this.#refreshInFlight?.promise === sharedRequest) this.#refreshInFlight = null;
    });
    this.#refreshInFlight = { lifecycleId, promise: sharedRequest };
    return sharedRequest;
  }

  private async refreshNodesInternal(forceReload: boolean): Promise<void> {
    const requestId = ++this.#requestId;
    // Node IDs and state hashes can survive even when the bounded cache had
    // to evict all post rows. Only actual post metadata is enough to render a
    // cached feed; otherwise fetch the first page again instead of treating
    // an empty cache as a loaded timeline.
    const hasCachedFeed = this.snapshot.posts.length > 0;
    this.publish({
      ...this.snapshot,
      isLoading: !hasCachedFeed,
      isRefreshing: true,
      isLoadingMore: false,
      storageError: null,
    });
    try {
      const bootstrap = this.#nodes.fluoBootstrap
        ? await this.#nodes.fluoBootstrap()
        : null;
      const [nodes, feedNodeIds, publicStorage] = bootstrap
        ? [bootstrap.nodes, bootstrap.nodeIds, bootstrap.publicStorage]
        : await Promise.all([
            this.#nodes.listNodes(),
            this.#nodes.listFeedNodeIds(),
            this.#nodes.publicStorage(),
          ]);
      if (requestId !== this.#requestId) return;
      this.#nodesResolved = true;
      this.#registry.replace(nodes);
      // replace() synchronously notifies the subscription created in enter().
      // Direct state consumers do not have that subscription, so only apply
      // the registry snapshot explicitly in that mode.
      if (!this.#unsubscribeRegistry) this.applyNodes(this.#registry.nodes);
      // The first metadata page and the lightweight state probe are
      // independent. Start both together so posts become visible as soon as
      // the Node metadata responds; media is still loaded by FluoMedia later.
      const initialPage = hasCachedFeed
        ? null
        : this.#gateway.listFeedPage(feedNodeIds, null, INITIAL_FEED_PAGE_SIZE);
      // A state probe is useful for subsequent visits, but it must not block
      // the first metadata page. Older Nodo versions can answer this endpoint
      // slowly (or not expose it at all), while the post list is enough to
      // render the timeline immediately.
      const statesPromise = this.loadFeedStates(feedNodeIds);

      if (!hasCachedFeed && initialPage) {
        const page = await initialPage;
        if (requestId !== this.#requestId) return;
        this.#feedCursor = page.cursor;
        this.#feedWarmupPending = false;
        this.#feedNodeIds = [...feedNodeIds];
        this.#pageSize = INITIAL_FEED_PAGE_SIZE;
        this.publish({
          ...this.snapshot,
          hasMore: page.hasMore,
          isLoading: false,
          // Metadata is ready. Do not hold the feed's scroll/prefetch path
          // hostage to the optional state-hash probe below.
          isRefreshing: false,
          posts: mergePosts(page.posts.map((post) => this.hydrateFeedPost(post))),
          publicStorage,
          storageError: null,
        });
        this.persistFeedCache();
        this.hydrateLikeStates(this.snapshot.posts.slice(0, LIKE_BATCH_SIZE), this.#lifecycleId);
        // State hashes are only needed to reconcile a later refresh. Do not
        // keep the refresh promise pending after metadata is visible; a slow
        // legacy Nodo state endpoint must not make the Refresh button appear
        // to work while silently coalescing the user's next refresh.
        void statesPromise.then((states) => {
          if (requestId === this.#requestId) {
            this.#feedStates = new Map(states.map((state) => [state.nodeId, state]));
            this.persistFeedCache();
          }
        });
        return;
      }

      const states = await statesPromise;
      if (requestId !== this.#requestId) return;

      const nextStates = new Map(states.map((state) => [state.nodeId, state]));
      const changedNodeIds = forceReload
        ? new Set([...this.#feedNodeIds, ...feedNodeIds])
        : changedFeedNodes(this.#feedNodeIds, this.#feedStates, feedNodeIds, nextStates);
      if (hasCachedFeed && changedNodeIds.size === 0) {
        this.#feedNodeIds = [...feedNodeIds];
        this.#feedStates = nextStates;
        this.publish({
          ...this.snapshot,
          isLoading: false,
          isRefreshing: false,
          publicStorage,
          storageError: null,
        });
        this.persistFeedCache();
        this.hydrateLikeStates(this.snapshot.posts.slice(0, LIKE_BATCH_SIZE), this.#lifecycleId);
        return;
      }

      this.#gateway.resetSession?.();
      this.#feedCursor = null;
      this.#feedWarmupPending = false;
      this.#pageSize = INITIAL_FEED_PAGE_SIZE;
      let page = await this.#gateway.listFeedPage(
        feedNodeIds,
        null,
        this.#pageSize,
      );
      if (requestId !== this.#requestId) return;
      // Keep the cached rows visible while the changed portion is reconciled.
      // A single first page is not enough to decide whether an older cached
      // post was deleted: dropping the rest here would make a new post hide
      // perfectly valid older posts until the user paged back through them.
      const cachedChangedPosts = this.snapshot.posts.filter(({ nodeId }) => changedNodeIds.has(nodeId));
      const oldestCachedCreatedAt = cachedChangedPosts.length
        ? Math.min(...cachedChangedPosts.map(({ createdAt }) => createdAt))
        : null;
      const fetched = page.posts.map((post) => this.hydrateFeedPost(post));
      let lastFetchedCreatedAt = fetched.at(-1)?.createdAt ?? null;
      let reconciliationComplete = oldestCachedCreatedAt === null || !page.hasMore ||
        (lastFetchedCreatedAt !== null && lastFetchedCreatedAt < oldestCachedCreatedAt);
      while (!reconciliationComplete && page.hasMore && page.cursor &&
          oldestCachedCreatedAt !== null &&
          (lastFetchedCreatedAt === null || lastFetchedCreatedAt >= oldestCachedCreatedAt)) {
        const previousCursor = page.cursor;
        const nextPage = await this.#gateway.listFeedPage(feedNodeIds, previousCursor, this.#pageSize);
        if (requestId !== this.#requestId) return;
        const nextPosts = nextPage.posts.map((post) => this.hydrateFeedPost(post));
        fetched.push(...nextPosts);
        page = nextPage;
        if (!nextPosts.length && page.cursor === previousCursor) break;
        lastFetchedCreatedAt = nextPosts.at(-1)?.createdAt ?? lastFetchedCreatedAt;
        reconciliationComplete = !page.hasMore ||
          (oldestCachedCreatedAt !== null && lastFetchedCreatedAt !== null &&
            lastFetchedCreatedAt < oldestCachedCreatedAt);
      }
      if (requestId !== this.#requestId) return;
      const fetchedKeys = new Set(fetched.map(postKey));
      const removed = reconciliationComplete
        ? cachedChangedPosts.filter((post) => !fetchedKeys.has(postKey(post)))
        : [];
      this.revokeUrls(removed.flatMap((post) => post.attachments));
      removed.forEach((post) => this.clearMediaCacheForPost(postKey(post)));
      const retained = this.snapshot.posts.filter((post) =>
        !changedNodeIds.has(post.nodeId) || !reconciliationComplete || fetchedKeys.has(postKey(post)));
      const posts = mergePosts(retained, fetched);
      this.#feedCursor = page.cursor;
      this.#feedNodeIds = [...feedNodeIds];
      this.#feedStates = nextStates;
      this.publish({
        ...this.snapshot,
        isLoading: false,
        isRefreshing: false,
        hasMore: page.hasMore,
        isLoadingMore: false,
        posts,
        publicStorage,
        storageError: null,
      });
      this.persistFeedCache();
      this.hydrateLikeStates(this.snapshot.posts.slice(0, LIKE_BATCH_SIZE), this.#lifecycleId);
    } catch (error) {
      if (requestId !== this.#requestId) return;
      this.publish({
        ...this.snapshot,
        isLoading: false,
        isRefreshing: false,
        storageError: readableError(error),
      });
    }
  }

  private restoreFeedCache(): void {
    // Tab switches keep the live in-memory session and its cursor. Only a
    // freshly constructed state (after an application restart) needs a
    // durable snapshot.
    if (this.#feedNodeIds.length || this.#feedStates.size || this.snapshot.posts.length) return;
    const cached = this.#feedCache.read(this.#cacheOwnerId);
    if (!cached) return;

    // Feed cursors are opaque, process-local session IDs in NodeFluoGateway;
    // never reuse one after a restart. loadMore() will open a new session and
    // skip cached pages until it reaches an unseen post.
    this.#feedCursor = null;
    this.#feedWarmupPending = cached.hasMore;
    this.#feedNodeIds = [...cached.feedNodeIds];
    this.#feedStates = new Map(cached.feedStates.map((state) => [state.nodeId, state]));
    this.#pageSize = cached.pageSize;
    const posts = cached.posts.map((post) => this.hydrateCached(post));
    if (!posts.length && !this.#feedNodeIds.length && !this.#feedStates.size) return;
    this.publish({
      ...this.snapshot,
      hasMore: cached.hasMore,
      isLoading: false,
      isLoadingMore: false,
      isRefreshing: false,
      posts: mergePosts(posts),
      storageError: null,
    });
  }

  /** Shares a state-hash probe across overlapping refreshes in one lifecycle. */
  private loadFeedStates(nodeIds: readonly string[]): Promise<FluoNodeFeedState[]> {
    const key = nodeIds.join('\u001f');
    const existing = this.#feedStatesInFlight;
    if (existing?.lifecycleId === this.#lifecycleId && existing.key === key) return existing.promise;

    const lifecycleId = this.#lifecycleId;
    let shared: Promise<FluoNodeFeedState[]>;
    shared = Promise.resolve()
      .then(() => this.#gateway.listFeedStates(nodeIds))
      .catch(() => [])
      .finally(() => {
        if (this.#feedStatesInFlight?.promise === shared) this.#feedStatesInFlight = null;
      });
    this.#feedStatesInFlight = { key, lifecycleId, promise: shared };
    return shared;
  }

  private persistFeedCache(): void {
    if (!this.#cacheOwnerId) return;
    if (this.#persistScheduled) return;
    const ownerId = this.#cacheOwnerId;
    const generation = this.#persistGeneration;
    this.#persistScheduled = true;
    // Feed reconciliation can publish several state updates in one turn.
    // Coalesce them so localStorage is serialized and written once with the
    // latest snapshot instead of blocking the UI repeatedly.
    queueMicrotask(() => {
      this.#persistScheduled = false;
      if (this.#cacheOwnerId !== ownerId || this.#persistGeneration !== generation) return;
      this.persistFeedCacheNow(ownerId);
    });
  }

  private persistFeedCacheNow(ownerId: string): void {
    this.#feedCache.write(ownerId, {
      feedCursor: this.#feedCursor,
      feedNodeIds: this.#feedNodeIds,
      feedStates: [...this.#feedStates.values()],
      hasMore: this.snapshot.hasMore,
      pageSize: this.#pageSize,
      posts: this.snapshot.posts,
    });
  }

  async loadMore(): Promise<void> {
    if (this.snapshot.isLoading || this.snapshot.isRefreshing || this.snapshot.isLoadingMore || !this.snapshot.hasMore ||
        (!this.#feedCursor && !this.#feedWarmupPending)) return;
    const requestId = this.#requestId;
    this.publish({ ...this.snapshot, isLoadingMore: true });
    try {
      const startedAt = performance.now();
      let cursor = this.#feedCursor;
      let page = await this.#gateway.listFeedPage(this.#feedNodeIds, cursor, this.#pageSize);
      const known = new Set(this.snapshot.posts.map(postKey));
      let additions = page.posts.map((post) => this.hydrateFeedPost(post)).filter((post) => !known.has(postKey(post)));
      additions.forEach((post) => known.add(postKey(post)));
      let hasMore = page.hasMore;
      while (this.#feedWarmupPending && !additions.length && page.hasMore && page.cursor) {
        const previousCursor = page.cursor;
        page = await this.#gateway.listFeedPage(this.#feedNodeIds, previousCursor, this.#pageSize);
        if (!page.posts.length && page.cursor === previousCursor) {
          hasMore = page.hasMore;
          break;
        }
        const next = page.posts.map((post) => this.hydrateFeedPost(post)).filter((post) => !known.has(postKey(post)));
        next.forEach((post) => known.add(postKey(post)));
        additions = [...additions, ...next];
        hasMore = page.hasMore;
      }
      if (requestId !== this.#requestId) return;
      this.#feedCursor = page.cursor;
      this.#feedWarmupPending = false;
      const elapsed = performance.now() - startedAt;
      this.#pageSize = elapsed < 600
        ? Math.min(50, this.#pageSize + 8)
        : elapsed > 2_500 ? Math.max(12, this.#pageSize - 8) : this.#pageSize;
      this.publish({
        ...this.snapshot,
        hasMore,
        isLoadingMore: false,
        posts: [...this.snapshot.posts, ...additions],
      });
      this.persistFeedCache();
      this.hydrateLikeStates(additions, this.#lifecycleId);
    } catch (error) {
      if (requestId !== this.#requestId) return;
      this.publish({
        ...this.snapshot,
        isLoadingMore: false,
        storageError: readableError(error),
      });
    }
  }

  async loadMedia(postId: string, attachmentId: string, postIdentity?: string): Promise<string | null> {
    const target = this.findMediaTarget(postId, attachmentId, postIdentity);
    return target ? this.startMediaLoad(target) : null;
  }

  /**
   * Resolves an attachment when its parent post is not currently present in
   * the paginated feed. Quotes keep the original post identity and attachment
   * manifest, so they can still load their media without forcing that old post
   * into the timeline or replacing the feed snapshot.
   */
  async loadMediaForPost(owner: FluoMediaOwner, attachment: FluoAttachment): Promise<string | null> {
    const identity = postKey(owner);
    const existing = this.findMediaTarget(owner.id, attachment.id, identity);
    return this.startMediaLoad(
      existing ?? detachedMediaTarget(owner, attachment),
      false,
      !existing,
    );
  }

  /**
   * Keeps intrinsic dimensions outside the feed snapshot. They can improve a
   * later mount of a legacy attachment without replacing `posts` or
   * invalidating the virtualizer's measurements for every row.
   */
  setMediaDimensions(
    postId: string,
    attachmentId: string,
    width: number,
    height: number,
    postIdentity?: string,
  ): void {
    const normalizedWidth = Math.round(width);
    const normalizedHeight = Math.round(height);
    if (!Number.isSafeInteger(normalizedWidth) || !Number.isSafeInteger(normalizedHeight) ||
        normalizedWidth < 1 || normalizedHeight < 1 ||
        normalizedWidth > MAX_MEDIA_DIMENSION || normalizedHeight > MAX_MEDIA_DIMENSION) return;
    const target = this.findMediaTarget(postId, attachmentId, postIdentity);
    const key = target?.key ?? postIdentity;
    if (!key) return;
    const mediaKey = `${key}:${attachmentId}`;
    if (target?.attachment.width === normalizedWidth && target.attachment.height === normalizedHeight) return;
    const previous = this.#mediaDimensions.get(mediaKey);
    if (previous?.width === normalizedWidth && previous.height === normalizedHeight) return;
    this.#mediaDimensions.set(mediaKey, { height: normalizedHeight, width: normalizedWidth });
  }

  getMediaDimensions(
    postId: string,
    attachmentId: string,
    postIdentity?: string,
  ): { height: number; width: number } | undefined {
    const target = this.findMediaTarget(postId, attachmentId, postIdentity);
    const key = target?.key ?? postIdentity;
    return key ? this.#mediaDimensions.get(`${key}:${attachmentId}`) : undefined;
  }

  async retryMedia(postId: string, attachmentId: string, postIdentity?: string): Promise<string | null> {
    const target = this.findMediaTarget(postId, attachmentId, postIdentity);
    if (!target) return null;
    const mediaKey = `${target.key}:${attachmentId}`;
    this.removeResolvedMedia(mediaKey);
    this.removeCachedMedia(mediaKey);
    if (target.attachment.objectUrl && target.attachment.url) {
      this.#revokeObjectUrl(target.attachment.url);
    }
    return this.startMediaLoad(target, true);
  }

  /** Retries a detached attachment using the same bounded media cache. */
  async retryMediaForPost(owner: FluoMediaOwner, attachment: FluoAttachment): Promise<string | null> {
    const identity = postKey(owner);
    const existing = this.findMediaTarget(owner.id, attachment.id, identity);
    const target = existing ?? detachedMediaTarget(owner, attachment);
    const mediaKey = `${identity}:${attachment.id}`;
    this.removeResolvedMedia(mediaKey);
    this.removeCachedMedia(mediaKey);
    return this.startMediaLoad(target, true, !existing);
  }

  markMediaUnavailable(postId: string, attachmentId: string, postIdentity?: string): void {
    const target = this.findMediaTarget(postId, attachmentId, postIdentity);
    if (!target) return;
    const mediaKey = `${target.key}:${attachmentId}`;
    this.removeResolvedMedia(mediaKey);
    this.removeCachedMedia(mediaKey);
  }

  async selectNode(nodeId: string): Promise<void> {
    if (nodeId === this.snapshot.selectedNodeId) return;
    if (nodeId !== PUBLIC_FLUO_DESTINATION &&
        !this.snapshot.nodes.some(({ id }) => id === nodeId)) return;
    const selectedNodeId = nodeId || PUBLIC_FLUO_DESTINATION;
    this.publish({
      ...this.snapshot,
      selectedNodeId,
    });
    this.persistSelectedNode(selectedNodeId);
  }

  setDraft(draft: string): void {
    const next = draft.slice(0, FLUO_MAX_POST_LENGTH);
    if (next !== this.snapshot.draft) this.publish({ ...this.snapshot, draft: next });
  }

  addAttachments(files: readonly File[]): number {
    if (this.snapshot.isPublishing) return 0;
    const added: FluoDraftAttachment[] = [];
    let limitExceeded = false;
    let unsupported = false;
    for (const file of files) {
      const kind = attachmentKind(file);
      if (!kind) { unsupported = true; continue; }
      if (this.snapshot.draftAttachments.length + added.length >= FLUO_MAX_ATTACHMENTS) {
        limitExceeded = true;
        continue;
      }
      try {
        added.push({
          blob: file,
          id: this.#createId(),
          kind,
          mimeType: file.type || fallbackMimeType(kind),
          name: file.name,
          size: file.size,
          url: this.#createObjectUrl(file),
        });
      } catch { unsupported = true; }
    }
    this.publish({
      ...this.snapshot,
      attachmentError: attachmentMessage(limitExceeded, unsupported),
      draftAttachments: [...this.snapshot.draftAttachments, ...added],
    });
    return added.length;
  }

  removeAttachment(attachmentId: string): void {
    if (this.snapshot.isPublishing) return;
    const attachment = this.snapshot.draftAttachments.find(({ id }) => id === attachmentId);
    if (!attachment) return;
    this.#revokeObjectUrl(attachment.url);
    this.publish({
      ...this.snapshot,
      attachmentError: null,
      draftAttachments: this.snapshot.draftAttachments.filter(({ id }) => id !== attachmentId),
    });
  }

  setDraftAttachmentDimensions(blob: Blob, width: number, height: number): void {
    const normalizedWidth = Math.round(width);
    const normalizedHeight = Math.round(height);
    if (!Number.isSafeInteger(normalizedWidth) || !Number.isSafeInteger(normalizedHeight) ||
        normalizedWidth < 1 || normalizedHeight < 1 ||
        normalizedWidth > MAX_MEDIA_DIMENSION || normalizedHeight > MAX_MEDIA_DIMENSION) return;
    let changed = false;
    const draftAttachments = this.snapshot.draftAttachments.map((attachment) => {
      if (attachment.blob !== blob ||
          (attachment.width === normalizedWidth && attachment.height === normalizedHeight)) return attachment;
      changed = true;
      return { ...attachment, height: normalizedHeight, width: normalizedWidth };
    });
    if (changed) this.publish({ ...this.snapshot, draftAttachments });
  }

  async publishPost(quote?: FluoQuote): Promise<boolean> {
    const body = this.snapshot.draft.trim();
    // The layout is based on the post manifest, not on a later media decode.
    // The composer normally resolves these dimensions before publishing; a
    // deterministic 16:9 reservation keeps direct gateway callers and media
    // formats without readable metadata stable as well.
    const attachments = this.snapshot.draftAttachments.map((attachment) =>
      withReservedDimensions(attachment));
    const nodeId = this.snapshot.selectedNodeId;
    if (!nodeId || (!body && !attachments.length && !quote) || this.snapshot.isPublishing) return false;
    // A metadata refresh can still be awaiting a page while the composer is
    // being used. Invalidate that stale request before the upload starts so a
    // late empty page cannot overwrite the newly published post.
    this.#requestId += 1;
    const lifecycleId = this.#lifecycleId;
    this.publish({
      ...this.snapshot,
      isPublishing: true,
      storageError: null,
      uploadProgress: attachments.length ? {
        attachmentIndex: 1,
        attachmentName: attachments[0]!.name,
        attachmentTotal: attachments.length,
        totalBytes: attachments.reduce((total, attachment) => total + attachment.size, 0),
        uploadedBytes: 0,
      } : null,
    });
    try {
      const remote = await this.#gateway.publishPost(nodeId, body, attachments, (uploadProgress) => {
        if (lifecycleId === this.#lifecycleId && this.snapshot.isPublishing) {
          this.publish({ ...this.snapshot, uploadProgress });
        }
      }, quote);
      if (lifecycleId !== this.#lifecycleId) return true;
      this.revokeUrls(attachments, false);
      const preparedById = new Map(attachments.map((attachment) => [attachment.id, attachment]));
      const post = this.hydrate({
        ...remote,
        attachments: remote.attachments.map((attachment, index) => {
          const prepared = preparedById.get(attachment.id) ?? attachments[index];
          return withReservedDimensions(attachment, prepared);
        }),
      });
      const publishedBytes = Math.max(1, new TextEncoder().encode(body).byteLength +
        (quote ? new TextEncoder().encode(JSON.stringify(quote)).byteLength : 0) +
        attachments.reduce((total, attachment) => total + attachment.size, 0));
      const publicStorage = nodeId === PUBLIC_FLUO_DESTINATION && this.snapshot.publicStorage
        ? {
            ...this.snapshot.publicStorage,
            nodeCandidates: this.snapshot.publicStorage.nodeCandidates.map((candidate) =>
              candidate.nodeId === remote.nodeId
                ? { ...candidate, availableBytes: Math.max(0, candidate.availableBytes - publishedBytes) }
                : candidate),
            usedBytes: this.snapshot.publicStorage.usedBytes + publishedBytes,
          }
        : this.snapshot.publicStorage;
      this.publish({
        ...this.snapshot,
        attachmentError: null,
        draft: '',
        draftAttachments: [],
        isPublishing: false,
        posts: [post, ...this.snapshot.posts.filter(({ id, nodeId }) =>
          id !== post.id || nodeId !== post.nodeId)],
        publicStorage,
        uploadProgress: null,
      });
      this.persistFeedCache();
      void this.#onStorageChanged?.(remote.nodeId, remote.space);
      return true;
    } catch (error) {
      if (lifecycleId !== this.#lifecycleId) return false;
      this.publish({
        ...this.snapshot,
        isPublishing: false,
        storageError: readableError(error),
        uploadProgress: null,
      });
      return false;
    }
  }

  /** Returns whether a like mutation is still waiting for the coordinator. */
  isLikePending(postId: string, postIdentity?: string): boolean {
    const target = this.findLikeTarget(postId, postIdentity);
    return target ? this.#likeRequests.has(postKey(target)) : false;
  }

  /** Optimistically toggles a like and persists it without blocking the feed. */
  async toggleLike(postId: string, postIdentity?: string): Promise<boolean> {
    const target = this.findLikeTarget(postId, postIdentity);
    if (!target) return false;
    const key = postKey(target);

    const previousLiked = target.liked === true;
    const previousLikeCount = normalizeLikeCount(target.likeCount);
    const liked = !previousLiked;
    const mutationEpoch = (this.#likeMutationEpochs.get(key) ?? 0) + 1;
    this.#likeMutationEpochs.set(key, mutationEpoch);
    this.#likeDesiredStates.set(key, liked);
    this.publish({
      ...this.snapshot,
      posts: this.snapshot.posts.map((post) => postKey(post) === key
        ? {
            ...post,
            liked,
            likeCount: Math.max(0, previousLikeCount + (liked ? 1 : -1)),
            likePending: true,
          }
        : post),
    });

    const existing = this.#likeRequests.get(key);
    if (existing) return existing;

    const lifecycleId = this.#lifecycleId;
    const request = this.persistLike(target, key, lifecycleId, previousLiked, previousLikeCount);
    this.#likeRequests.set(key, request);
    // Use a rejection handler instead of an unhandled `finally` promise. A
    // transport failure must never leave the per-post queue permanently busy.
    void request.then(() => {
      if (this.#likeRequests.get(key) === request) this.#likeRequests.delete(key);
    }, () => {
      if (this.#likeRequests.get(key) === request) this.#likeRequests.delete(key);
    });
    return request;
  }

  private findLikeTarget(postId: string, postIdentity?: string): FluoPost | null {
    const matches = postIdentity
      ? this.snapshot.posts.filter((post) => postKey(post) === postIdentity)
      : this.snapshot.posts.filter(({ id }) => id === postId);
    if (matches.length !== 1) return null;
    return matches[0]!;
  }

  private async persistLike(
    target: FluoLikeTarget,
    key: string,
    lifecycleId: number,
    initialLiked: boolean,
    initialLikeCount: number,
  ): Promise<boolean> {
    let authoritativeLiked = initialLiked;
    let authoritativeLikeCount = initialLikeCount;

    while (lifecycleId === this.#lifecycleId) {
      const liked = this.#likeDesiredStates.get(key);
      if (liked === undefined) return true;
      try {
        const result = await this.#gateway.setLike?.(target, liked);
        if (lifecycleId !== this.#lifecycleId) return true;

        const current = this.snapshot.posts.find((post) => postKey(post) === key);
        authoritativeLiked = result?.liked ?? liked;
        authoritativeLikeCount = result
          ? normalizeLikeCount(result.likeCount)
          : normalizeLikeCount(current?.likeCount);

        // A second click may have happened while the first request was in
        // flight. Keep that optimistic state and send only the latest desired
        // value after the current request settles.
        if (this.#likeDesiredStates.get(key) !== authoritativeLiked) continue;

        this.#likeDesiredStates.delete(key);
        if (!current || current.likePending !== true) return true;
        this.publish({
          ...this.snapshot,
          posts: this.snapshot.posts.map((post) => postKey(post) === key
            ? { ...post, liked: authoritativeLiked, likeCount: authoritativeLikeCount, likePending: false }
            : post),
          storageError: null,
        });
        this.persistFeedCache();
        return true;
      } catch (error) {
        if (lifecycleId !== this.#lifecycleId) return false;
        const current = this.snapshot.posts.find((post) => postKey(post) === key);
        // The coordinator did not accept this mutation. Return to the last
        // known server state immediately; a later click can retry normally.
        this.#likeDesiredStates.delete(key);
        if (!current || current.likePending !== true) return false;
        this.publish({
          ...this.snapshot,
          posts: this.snapshot.posts.map((post) => postKey(post) === key
            ? { ...post, liked: authoritativeLiked, likeCount: authoritativeLikeCount, likePending: false }
            : post),
          storageError: readableError(error),
        });
        this.persistFeedCache();
        return false;
      }
    }
    return false;
  }

  /** Hydrates like state in one bounded coordinator query per metadata batch. */
  private hydrateLikeStates(posts: readonly FluoPost[], lifecycleId: number): void {
    const listLikeStates = this.#gateway.listLikeStates;
    if (!listLikeStates || lifecycleId !== this.#lifecycleId) return;
    const targets = [...new Map(posts.map((post) => [postKey(post), {
      id: post.id,
      nodeId: post.nodeId,
      space: post.space,
    } satisfies FluoLikeTarget])).values()];
    if (!targets.length) return;
    const requestKey = targets.map(postKey).sort().join('\u001f');
    if (this.#likeStateRequests.has(requestKey)) return;
    const epochs = new Map(targets.map((target) => [postKey(target), this.#likeMutationEpochs.get(postKey(target)) ?? 0]));
    const request = Promise.resolve()
      .then(() => listLikeStates.call(this.#gateway, targets.slice(0, LIKE_BATCH_SIZE)))
      .then((states) => {
        if (lifecycleId !== this.#lifecycleId) return;
        const byKey = new Map(states.map((state) => [postKey(state), state]));
        let changed = false;
        const posts = this.snapshot.posts.map((post) => {
          const key = postKey(post);
          const state = byKey.get(key);
          if (!state || post.likePending === true || epochs.get(key) !== (this.#likeMutationEpochs.get(key) ?? 0)) {
            return post;
          }
          const likeCount = normalizeLikeCount(state.likeCount);
          if (post.liked === state.liked && normalizeLikeCount(post.likeCount) === likeCount) return post;
          changed = true;
          return { ...post, liked: state.liked, likeCount, likePending: false };
        });
        if (changed) {
          this.publish({ ...this.snapshot, posts });
          this.persistFeedCache();
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.#likeStateRequests.get(requestKey) === request) this.#likeStateRequests.delete(requestKey);
      });
    this.#likeStateRequests.set(requestKey, request);
  }

  async deletePost(postId: string): Promise<boolean> {
    const matches = this.snapshot.posts.filter(({ id }) => id === postId);
    if (matches.length !== 1) return false;
    const post = matches[0]!;
    const lifecycleId = this.#lifecycleId;
    const key = postKey(post);
    try {
      await this.#gateway.deletePost(post.nodeId, postId, post.space);
      const publicStorage = post.space === 'public'
        ? await this.#nodes.publicStorage().catch(() => this.snapshot.publicStorage)
        : this.snapshot.publicStorage;
      if (lifecycleId !== this.#lifecycleId) return true;
      this.revokeUrls(post.attachments);
      this.clearMediaCacheForPost(key);
      this.forgetMediaDimensionsForPost(key);
      this.publish({
        ...this.snapshot,
        posts: this.snapshot.posts.filter((candidate) => postKey(candidate) !== key),
        publicStorage,
        storageError: null,
      });
      this.persistFeedCache();
      void this.#onStorageChanged?.(post.nodeId, post.space);
      return true;
    } catch (error) {
      if (lifecycleId !== this.#lifecycleId) return false;
      this.publish({ ...this.snapshot, storageError: readableError(error) });
      return false;
    }
  }

  clearNodeContent(nodeId: string, space?: 'private'): void {
    const removed = this.snapshot.posts.filter((post) =>
      post.nodeId === nodeId && (!space || post.space === space));
    if (!removed.length) return;
    this.#requestId += 1;
    this.revokeUrls(removed.flatMap((post) => post.attachments));
    removed.forEach((post) => {
      const key = postKey(post);
      this.clearMediaCacheForPost(key);
      this.forgetMediaDimensionsForPost(key);
    });
    this.publish({
      ...this.snapshot,
      isLoading: false,
      posts: this.snapshot.posts.filter((post) =>
        post.nodeId !== nodeId || (space !== undefined && post.space !== space)),
      storageError: null,
    });
    this.persistFeedCache();
  }

  private applyNodes(nodes: readonly NodoNode[]): void {
    const currentNodeId = this.snapshot.selectedNodeId ?? PUBLIC_FLUO_DESTINATION;
    const selectedNodeId = !this.#nodesResolved || currentNodeId === PUBLIC_FLUO_DESTINATION ||
      nodes.some(({ id }) => id === currentNodeId)
      ? currentNodeId
      : PUBLIC_FLUO_DESTINATION;
    if (selectedNodeId !== this.snapshot.selectedNodeId) this.persistSelectedNode(selectedNodeId);
    this.publish({
      ...this.snapshot,
      nodes: [...nodes],
      posts: this.snapshot.posts,
      selectedNodeId,
    });
  }

  private persistSelectedNode(nodeId: string): void {
    const ownerId = this.#cacheOwnerId;
    const storage = this.#selectionStorage;
    if (!ownerId || !storage) return;
    try {
      storage.setItem(selectedNodeKey(ownerId), nodeId || PUBLIC_FLUO_DESTINATION);
    } catch {
      // A disabled or full local storage must not block selecting a Nodo.
    }
  }

  private hydrate(post: RemoteFluoPost): FluoPost {
    return {
      ...post,
      attachments: post.attachments.map((attachment) => this.hydrateAttachment(attachment)),
      liked: false,
      likeCount: normalizeLikeCount(post.likeCount),
      likePending: false,
    };
  }

  /**
   * Reconciles a remote metadata row without throwing away the live media
   * objects owned by the current timeline. Hash refreshes replace post
   * manifests, but an unchanged attachment must keep its URL/player so a
   * video does not restart (or enter an endless loading state) after a post
   * is published elsewhere.
   */
  private hydrateFeedPost(post: RemoteFluoPost): FluoPost {
    const key = postKey(post);
    const previous = this.snapshot.posts.find((candidate) => postKey(candidate) === key);
    if (!previous) return this.hydrate(post);

    const previousById = new Map(previous.attachments.map((attachment) => [attachment.id, attachment]));
    const attachments = post.attachments.map((attachment) => {
      const existing = previousById.get(attachment.id);
      return existing && sameAttachmentMetadata(existing, attachment)
        ? existing
        : this.hydrateAttachment(attachment);
    });

    for (const existing of previous.attachments) {
      const replacement = post.attachments.find((attachment) => attachment.id === existing.id);
      if (replacement && sameAttachmentMetadata(existing, replacement)) continue;
      this.clearMediaCacheForAttachment(key, existing.id);
      if (existing.objectUrl && existing.url) this.#revokeObjectUrl(existing.url);
    }

    const sameAttachments = attachments.length === previous.attachments.length &&
      attachments.every((attachment, index) => attachment === previous.attachments[index]);
    if (sameAttachments && previous.body === post.body && previous.author === post.author &&
        previous.createdAt === post.createdAt && sameQuote(previous.quote, post.quote)) return previous;

    return {
      ...post,
      attachments,
      liked: previous.liked,
      likeCount: previous.likeCount ?? normalizeLikeCount(post.likeCount),
      likePending: previous.likePending,
    };
  }

  private hydrateAttachment(attachment: RemoteFluoPost['attachments'][number]): FluoAttachment {
    const { blob, ...metadata } = attachment;
    return blob ? {
      ...metadata,
      loadState: 'ready',
      objectUrl: true,
      url: this.#createObjectUrl(blob),
    } : { ...metadata, loadState: 'idle' };
  }

  private hydrateCached(post: FluoPost): FluoPost {
    return {
      ...post,
      attachments: post.attachments.map(({ loadState: _loadState, objectUrl: _objectUrl, url: _url, ...attachment }) => ({
        ...attachment,
        loadState: 'idle',
      })),
      liked: post.liked === true,
      likeCount: normalizeLikeCount(post.likeCount),
      likePending: false,
    };
  }

  private findMediaTarget(
    postId: string,
    attachmentId: string,
    postIdentity?: string,
  ): FluoMediaTarget | null {
    const matches = postIdentity
      ? this.snapshot.posts.filter((post) => postKey(post) === postIdentity)
      : this.snapshot.posts.filter(({ id }) => id === postId);
    if (matches.length !== 1) return null;
    const post = matches[0]!;
    const attachment = post.attachments.find(({ id }) => id === attachmentId);
    return attachment ? { attachment, key: postKey(post), post } : null;
  }

  private startMediaLoad(
    target: FluoMediaTarget,
    forceRemote = false,
    detached = false,
  ): Promise<string | null> {
    const { attachment, key, post } = target;
    const mediaKey = `${key}:${attachment.id}`;
    if (!forceRemote && attachment.url) return Promise.resolve(attachment.url);
    const resolved = this.#mediaSources.get(mediaKey);
    if (resolved) return Promise.resolve(resolved.url);
    const inFlight = this.#mediaRequests.get(mediaKey);
    if (inFlight) return inFlight;

    const cached = this.#mediaCache.get(mediaKey);
    if (cached) {
      cached.lastUsed = ++this.#mediaCacheClock;
      try {
        const url = this.#createObjectUrl(cached.blob);
        this.#mediaSources.set(mediaKey, { objectUrl: true, url });
        return Promise.resolve(url);
      } catch {
        this.removeCachedMedia(mediaKey);
      }
    }

    const request = this.resolveMediaLoad(target, this.#mediaGeneration, mediaKey, detached);
    this.#mediaRequests.set(mediaKey, request);
    void request.finally(() => {
      // A changed attachment may start a new request under the same key
      // before this one settles. Never let the old request delete the new
      // entry and accidentally re-enable duplicate transfers.
      if (this.#mediaRequests.get(mediaKey) === request) this.#mediaRequests.delete(mediaKey);
    });
    return request;
  }

  private async resolveMediaLoad(
    target: FluoMediaTarget,
    mediaGeneration: number,
    mediaKey: string,
    detached = false,
  ): Promise<string | null> {
    const { attachment, key, post } = target;
    try {
      const source = await this.#gateway.loadMedia(post.nodeId, post.space, attachment);
      const objectUrl = 'blob' in source;
      const url = source.blob ? this.#createObjectUrl(source.blob) : source.streamUrl;
      const current = detached
        ? target
        : this.findMediaTarget(post.id, attachment.id, key);
      if (mediaGeneration !== this.#mediaGeneration || !current ||
          !sameAttachmentMetadata(current.attachment, attachment)) {
        if (objectUrl) this.#revokeObjectUrl(url);
        return null;
      }
      if (source.blob) this.cacheMedia(mediaKey, source.blob, attachment.size);
      this.#mediaSources.set(mediaKey, { objectUrl, url });
      return url;
    } catch {
      return null;
    }
  }

  private revokeUrls(attachments: readonly FluoAttachment[], objectUrlsOnly = true): void {
    for (const attachment of attachments) {
      if (!attachment.url || (objectUrlsOnly && !attachment.objectUrl)) continue;
      this.#revokeObjectUrl(attachment.url);
    }
  }


  private cacheMedia(key: string, blob: Blob, declaredSize: number): void {
    const bytes = blob.size || declaredSize;
    if (!bytes || bytes > MAX_MEDIA_CACHE_BYTES) return;
    this.removeCachedMedia(key);
    this.#mediaCache.set(key, { blob, bytes, lastUsed: ++this.#mediaCacheClock });
    this.#mediaCacheBytes += bytes;
    const protectedKeys = new Set<string>([key, ...this.#mediaSources.keys()]);
    while (this.#mediaCacheBytes > MAX_MEDIA_CACHE_BYTES) {
      const candidate = [...this.#mediaCache.entries()]
        .filter(([candidateKey]) => !protectedKeys.has(candidateKey))
        .sort(([, left], [, right]) => left.lastUsed - right.lastUsed)[0];
      if (!candidate) break;
      this.removeCachedMedia(candidate[0]);
    }
  }

  private removeCachedMedia(key: string): void {
    const cached = this.#mediaCache.get(key);
    if (!cached) return;
    this.#mediaCache.delete(key);
    this.#mediaCacheBytes = Math.max(0, this.#mediaCacheBytes - cached.bytes);
  }

  private removeResolvedMedia(key: string): void {
    const source = this.#mediaSources.get(key);
    if (!source) return;
    this.#mediaSources.delete(key);
    if (source.objectUrl) this.#revokeObjectUrl(source.url);
  }

  private clearMediaCacheForPost(key: string): void {
    const prefix = `${key}:`;
    for (const mediaKey of this.#mediaCache.keys()) {
      if (mediaKey.startsWith(prefix)) this.removeCachedMedia(mediaKey);
    }
    for (const mediaKey of this.#mediaSources.keys()) {
      if (mediaKey.startsWith(prefix)) this.removeResolvedMedia(mediaKey);
    }
  }

  private clearMediaCacheForAttachment(key: string, attachmentId: string): void {
    const mediaKey = `${key}:${attachmentId}`;
    this.#mediaRequests.delete(mediaKey);
    this.removeCachedMedia(mediaKey);
    this.removeResolvedMedia(mediaKey);
  }

  private forgetMediaDimensionsForPost(key: string): void {
    const prefix = `${key}:`;
    for (const mediaKey of this.#mediaDimensions.keys()) {
      if (mediaKey.startsWith(prefix)) this.#mediaDimensions.delete(mediaKey);
    }
  }

  private clearMediaCache(): void {
    for (const key of this.#mediaSources.keys()) this.removeResolvedMedia(key);
    this.#mediaCache.clear();
    this.#mediaCacheBytes = 0;
  }
}

type CachedFluoMedia = {
  blob: Blob;
  bytes: number;
  lastUsed: number;
};

type FluoMediaTarget = {
  attachment: FluoAttachment;
  key: string;
  post: FluoMediaOwner;
};

type ResolvedFluoMedia = {
  objectUrl: boolean;
  url: string;
};

function attachmentKind(file: File): FluoAttachmentKind | null {
  const mimeType = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (mimeType === 'image/gif' || name.endsWith('.gif')) return 'gif';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return null;
}

function attachmentMessage(limitExceeded: boolean, unsupported: boolean): string | null {
  const messages: string[] = [];
  if (limitExceeded) messages.push('A post can contain up to 4 media files');
  if (unsupported) messages.push('Only images, GIFs, and videos are supported');
  return messages.length ? `${messages.join('. ')}.` : null;
}

function fallbackMimeType(kind: FluoAttachmentKind): string {
  return kind === 'gif' ? 'image/gif' : kind === 'video' ? 'video/mp4' : 'image/jpeg';
}

function withReservedDimensions<T extends FluoAttachment>(
  attachment: T,
  fallback?: FluoAttachment,
): T {
  if (validMediaDimensions(attachment.width, attachment.height)) return attachment;
  const width = validMediaDimensions(fallback?.width, fallback?.height)
    ? fallback!.width!
    : RESERVED_MEDIA_WIDTH;
  const height = validMediaDimensions(fallback?.width, fallback?.height)
    ? fallback!.height!
    : RESERVED_MEDIA_HEIGHT;
  return attachment.width === width && attachment.height === height
    ? attachment
    : { ...attachment, height, width } as T;
}

function validMediaDimensions(width?: number, height?: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) &&
    width! > 0 && height! > 0 && width! <= MAX_MEDIA_DIMENSION && height! <= MAX_MEDIA_DIMENSION;
}

function readableError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'The selected Nodo could not be reached.';
}

const INITIAL_FEED_PAGE_SIZE = 24;
const MAX_MEDIA_CACHE_BYTES = 96 * 1_024 * 1_024;
const MAX_MEDIA_DIMENSION = 100_000;
const RESERVED_MEDIA_WIDTH = 1_600;
const RESERVED_MEDIA_HEIGHT = 900;
const LIKE_BATCH_SIZE = 100;
const NODE_SELECTION_KEY_PREFIX = 'kaordo.fluo-node.v1.';

function postKey(post: Pick<FluoPost, 'id' | 'nodeId' | 'space'>): string {
  return `${post.space}:${post.nodeId}:${post.id}`;
}

function detachedMediaTarget(owner: FluoMediaOwner, attachment: FluoAttachment): FluoMediaTarget {
  return {
    attachment,
    key: postKey(owner),
    post: owner,
  };
}

function sameAttachmentMetadata(
  left: FluoAttachment,
  right: Pick<FluoAttachment, 'id' | 'kind' | 'mimeType' | 'name' | 'size' | 'width' | 'height'>,
): boolean {
  return left.id === right.id && left.kind === right.kind && left.mimeType === right.mimeType &&
    left.name === right.name && left.size === right.size && left.width === right.width &&
    left.height === right.height;
}

function sameQuote(left: FluoQuote | undefined, right: FluoQuote | undefined): boolean {
  if (left === right) return true;
  if (!left || !right || left.id !== right.id || left.nodeId !== right.nodeId ||
      left.space !== right.space || left.author !== right.author || left.body !== right.body ||
      left.createdAt !== right.createdAt || left.attachments.length !== right.attachments.length) return false;
  return left.attachments.every((attachment, index) =>
    sameAttachmentMetadata(attachment, right.attachments[index]!));
}

function mergePosts(...groups: readonly FluoPost[][]): FluoPost[] {
  const posts = new Map<string, FluoPost>();
  for (const group of groups) {
    for (const post of group) posts.set(postKey(post), post);
  }
  return [...posts.values()].sort((left, right) => right.createdAt - left.createdAt);
}

function changedFeedNodes(
  previousNodeIds: readonly string[],
  previousStates: ReadonlyMap<string, FluoNodeFeedState>,
  nextNodeIds: readonly string[],
  nextStates: ReadonlyMap<string, FluoNodeFeedState>,
): Set<string> {
  const changed = new Set<string>();
  const nextIds = new Set(nextNodeIds);
  for (const nodeId of previousNodeIds) if (!nextIds.has(nodeId)) changed.add(nodeId);
  for (const nodeId of nextNodeIds) {
    const previous = previousStates.get(nodeId);
    const next = nextStates.get(nodeId);
    if (!previous || !next || feedStateChanged(previous, next)) changed.add(nodeId);
  }
  return changed;
}

function feedStateChanged(previous: FluoNodeFeedState, next: FluoNodeFeedState): boolean {
  return (['private', 'public'] as const).some((space: FluoSpace) => {
    const before = previous.spaces[space];
    const after = next.spaces[space];
    if (before.postCount !== after.postCount) return true;
    // A missing hash means an older Nodo or a transient state-endpoint
    // failure. Reloading is safer than silently serving stale posts.
    if (!before.stateHash || !after.stateHash) return true;
    return before.stateHash !== after.stateHash;
  });
}

function createLocalId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `fluo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeCacheOwner(ownerId: string | null): string | null {
  const normalized = ownerId?.trim();
  return normalized || null;
}

function readSelectedNode(storage: Storage | null, ownerId: string | null): string {
  if (!storage || !ownerId) return PUBLIC_FLUO_DESTINATION;
  try {
    const selected = storage.getItem(selectedNodeKey(ownerId))?.trim();
    return selected || PUBLIC_FLUO_DESTINATION;
  } catch {
    return PUBLIC_FLUO_DESTINATION;
  }
}

function selectedNodeKey(ownerId: string): string {
  return `${NODE_SELECTION_KEY_PREFIX}${encodeURIComponent(ownerId)}`;
}

function browserStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function normalizeLikeCount(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? value as number
    : 0;
}
