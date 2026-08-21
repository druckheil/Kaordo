import type { NodoNode } from '../domain/nodo';
import {
  PUBLIC_FLUO_DESTINATION,
  type FluoNodeFeedState,
  type FluoSpace,
  type FluoGateway,
  type FluoUploadProgress,
  type RemoteFluoPost,
} from '../gateways/FluoGateway';
import type { NodoGateway } from '../gateways/NodoGateway';
import type { PublicNodoStorage } from '../domain/nodo';
import { GState } from '../state/GState';
import { NodoRegistry } from '../services/NodoRegistry';

export const FLUO_MAX_POST_LENGTH = 500;
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

export type FluoPost = {
  attachments: FluoAttachment[];
  author: string;
  body: string;
  createdAt: number;
  id: string;
  liked: boolean;
  nodeId: string;
  space: 'private' | 'public';
};

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
  createId?: () => string;
  createObjectUrl?: (blob: Blob) => string;
  onStorageChanged?: (nodeId: string, space: 'private' | 'public') => void | Promise<void>;
  revokeObjectUrl?: (url: string) => void;
  registry?: NodoRegistry;
};

/** Owns the global node-backed Fluo timeline. No post or media is persisted locally. */
export class FluoGState extends GState<FluoSnapshot> {
  readonly #createId: () => string;
  readonly #createObjectUrl: (blob: Blob) => string;
  readonly #gateway: FluoGateway;
  readonly #nodes: NodoGateway;
  readonly #onStorageChanged: ((nodeId: string, space: 'private' | 'public') => void | Promise<void>) | null;
  readonly #registry: NodoRegistry;
  readonly #revokeObjectUrl: (url: string) => void;
  #lifecycleId = 0;
  #requestId = 0;
  #feedCursor: string | null = null;
  #feedNodeIds: string[] = [];
  #feedStates = new Map<string, FluoNodeFeedState>();
  #mediaCache = new Map<string, CachedFluoMedia>();
  #mediaRequests = new Map<string, Promise<string | null>>();
  #mediaSources = new Map<string, ResolvedFluoMedia>();
  #mediaGeneration = 0;
  #mediaCacheBytes = 0;
  #mediaCacheClock = 0;
  #pageSize = INITIAL_FEED_PAGE_SIZE;
  #unsubscribeRegistry: (() => void) | null = null;

  constructor(gateway: FluoGateway, nodes: NodoGateway, options: FluoGStateOptions = {}) {
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
      selectedNodeId: PUBLIC_FLUO_DESTINATION,
      storageError: null,
      uploadProgress: null,
    });
    this.#gateway = gateway;
    this.#nodes = nodes;
    this.#onStorageChanged = options.onStorageChanged ?? null;
    this.#registry = options.registry ?? new NodoRegistry();
    this.#createId = options.createId ?? createLocalId;
    this.#createObjectUrl = options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.#revokeObjectUrl = options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
  }

  override enter(): void {
    this.#unsubscribeRegistry = this.#registry.subscribe((nodes) => this.applyNodes(nodes));
    void this.refreshNodes();
  }

  override exit(): void {
    this.#lifecycleId += 1;
    this.#requestId += 1;
    this.#unsubscribeRegistry?.();
    this.#unsubscribeRegistry = null;
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
    this.#lifecycleId += 1;
    this.#requestId += 1;
    this.#gateway.resetSession?.();
    this.#feedCursor = null;
    this.#feedNodeIds = [];
    this.#feedStates.clear();
    this.#pageSize = INITIAL_FEED_PAGE_SIZE;
    this.#mediaGeneration += 1;
    this.#mediaRequests.clear();
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
      selectedNodeId: PUBLIC_FLUO_DESTINATION,
      storageError: null,
      uploadProgress: null,
    });
  }

  async refreshFeed(): Promise<void> {
    await this.refreshNodes(true);
  }

  async refreshNodes(forceReload = false): Promise<void> {
    const requestId = ++this.#requestId;
    const hasCachedFeed = this.#feedNodeIds.length > 0 || this.#feedStates.size > 0 ||
      this.snapshot.posts.length > 0;
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
      this.#registry.replace(nodes);
      this.applyNodes(this.#registry.nodes);
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
      const statesPromise = this.#gateway.listFeedStates(feedNodeIds).catch(() => []);

      if (!hasCachedFeed && initialPage) {
        const page = await initialPage;
        if (requestId !== this.#requestId) return;
        this.#feedCursor = page.cursor;
        this.#feedNodeIds = [...feedNodeIds];
        this.#pageSize = INITIAL_FEED_PAGE_SIZE;
        this.publish({
          ...this.snapshot,
          hasMore: page.hasMore,
          isLoading: false,
          // Metadata is ready. Do not hold the feed's scroll/prefetch path
          // hostage to the optional state-hash probe below.
          isRefreshing: false,
          posts: mergePosts(page.posts.map((post) => this.hydrate(post))),
          publicStorage,
          storageError: null,
        });

        const states = await statesPromise;
        if (requestId !== this.#requestId) return;
        this.#feedStates = new Map(states.map((state) => [state.nodeId, state]));
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
        return;
      }

      this.#gateway.resetSession?.();
      this.#feedCursor = null;
      this.#pageSize = INITIAL_FEED_PAGE_SIZE;
      const page = await this.#gateway.listFeedPage(
        feedNodeIds,
        null,
        this.#pageSize,
      );
      if (requestId !== this.#requestId) return;
      const removed = this.snapshot.posts.filter(({ nodeId }) => changedNodeIds.has(nodeId));
      this.revokeUrls(removed.flatMap((post) => post.attachments));
      removed.forEach((post) => this.clearMediaCacheForPost(postKey(post)));
      const retained = this.snapshot.posts.filter(({ nodeId }) => !changedNodeIds.has(nodeId));
      const posts = mergePosts(retained, page.posts.map((post) => this.hydrate(post)));
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

  async loadMore(): Promise<void> {
    if (this.snapshot.isLoading || this.snapshot.isRefreshing || this.snapshot.isLoadingMore || !this.snapshot.hasMore ||
        !this.#feedCursor) return;
    const requestId = this.#requestId;
    this.publish({ ...this.snapshot, isLoadingMore: true });
    try {
      const startedAt = performance.now();
      const page = await this.#gateway.listFeedPage(
        this.#feedNodeIds,
        this.#feedCursor,
        this.#pageSize,
      );
      if (requestId !== this.#requestId) return;
      this.#feedCursor = page.cursor;
      const elapsed = performance.now() - startedAt;
      this.#pageSize = elapsed < 600
        ? Math.min(50, this.#pageSize + 8)
        : elapsed > 2_500 ? Math.max(12, this.#pageSize - 8) : this.#pageSize;
      const known = new Set(this.snapshot.posts.map(postKey));
      const additions = page.posts.map((post) => this.hydrate(post)).filter((post) => !known.has(postKey(post)));
      this.publish({
        ...this.snapshot,
        hasMore: page.hasMore,
        isLoadingMore: false,
        posts: [...this.snapshot.posts, ...additions],
      });
    } catch (error) {
      if (requestId !== this.#requestId) return;
      this.publish({
        ...this.snapshot,
        isLoadingMore: false,
        storageError: readableError(error),
      });
    }
  }

  async loadMedia(postId: string, attachmentId: string): Promise<string | null> {
    const target = this.findMediaTarget(postId, attachmentId);
    return target ? this.startMediaLoad(target) : null;
  }

  async retryMedia(postId: string, attachmentId: string): Promise<string | null> {
    const target = this.findMediaTarget(postId, attachmentId);
    if (!target) return null;
    const mediaKey = `${target.key}:${attachmentId}`;
    this.removeResolvedMedia(mediaKey);
    this.removeCachedMedia(mediaKey);
    if (target.attachment.objectUrl && target.attachment.url) {
      this.#revokeObjectUrl(target.attachment.url);
    }
    return this.startMediaLoad(target, true);
  }

  markMediaUnavailable(postId: string, attachmentId: string): void {
    const target = this.findMediaTarget(postId, attachmentId);
    if (!target) return;
    const mediaKey = `${target.key}:${attachmentId}`;
    this.removeResolvedMedia(mediaKey);
    this.removeCachedMedia(mediaKey);
  }

  async selectNode(nodeId: string): Promise<void> {
    if (nodeId === this.snapshot.selectedNodeId) return;
    if (nodeId !== PUBLIC_FLUO_DESTINATION &&
        !this.snapshot.nodes.some(({ id }) => id === nodeId)) return;
    this.publish({
      ...this.snapshot,
      selectedNodeId: nodeId || PUBLIC_FLUO_DESTINATION,
    });
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

  async publishPost(): Promise<boolean> {
    const body = this.snapshot.draft.trim();
    const attachments = this.snapshot.draftAttachments;
    const nodeId = this.snapshot.selectedNodeId;
    if (!nodeId || (!body && !attachments.length) || this.snapshot.isPublishing) return false;
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
      });
      if (lifecycleId !== this.#lifecycleId) return true;
      this.revokeUrls(attachments, false);
      const post = this.hydrate(remote);
      const publishedBytes = Math.max(1, new TextEncoder().encode(body).byteLength +
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

  toggleLike(postId: string): void {
    const matches = this.snapshot.posts.filter(({ id }) => id === postId);
    if (matches.length !== 1) return;
    const key = postKey(matches[0]!);
    this.publish({
      ...this.snapshot,
      posts: this.snapshot.posts.map((post) => postKey(post) === key
        ? { ...post, liked: !post.liked }
        : post),
    });
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
      this.publish({
        ...this.snapshot,
        posts: this.snapshot.posts.filter((candidate) => postKey(candidate) !== key),
        publicStorage,
        storageError: null,
      });
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
    removed.forEach((post) => this.clearMediaCacheForPost(postKey(post)));
    this.publish({
      ...this.snapshot,
      isLoading: false,
      posts: this.snapshot.posts.filter((post) =>
        post.nodeId !== nodeId || (space !== undefined && post.space !== space)),
      storageError: null,
    });
  }

  private applyNodes(nodes: readonly NodoNode[]): void {
    const selectedNodeId = this.snapshot.selectedNodeId === PUBLIC_FLUO_DESTINATION ||
      nodes.some(({ id }) => id === this.snapshot.selectedNodeId)
      ? this.snapshot.selectedNodeId
      : PUBLIC_FLUO_DESTINATION;
    this.publish({
      ...this.snapshot,
      nodes: [...nodes],
      posts: this.snapshot.posts,
      selectedNodeId,
    });
  }

  private hydrate(post: RemoteFluoPost): FluoPost {
    return {
      ...post,
      attachments: post.attachments.map(({ blob, ...attachment }) => blob ? {
        ...attachment,
        loadState: 'ready',
        objectUrl: true,
        url: this.#createObjectUrl(blob),
      } : { ...attachment, loadState: 'idle' }),
      liked: false,
    };
  }

  private findMediaTarget(postId: string, attachmentId: string): FluoMediaTarget | null {
    const matches = this.snapshot.posts.filter(({ id }) => id === postId);
    if (matches.length !== 1) return null;
    const post = matches[0]!;
    const attachment = post.attachments.find(({ id }) => id === attachmentId);
    return attachment ? { attachment, key: postKey(post), post } : null;
  }

  private startMediaLoad(target: FluoMediaTarget, forceRemote = false): Promise<string | null> {
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

    const request = this.resolveMediaLoad(target, this.#mediaGeneration, mediaKey);
    this.#mediaRequests.set(mediaKey, request);
    return request;
  }

  private async resolveMediaLoad(
    target: FluoMediaTarget,
    mediaGeneration: number,
    mediaKey: string,
  ): Promise<string | null> {
    const { attachment, key, post } = target;
    try {
      const source = await this.#gateway.loadMedia(post.nodeId, post.space, attachment);
      const objectUrl = 'blob' in source;
      const url = source.blob ? this.#createObjectUrl(source.blob) : source.streamUrl;
      if (mediaGeneration !== this.#mediaGeneration ||
          !this.snapshot.posts.some((candidate) => postKey(candidate) === key)) {
        if (objectUrl) this.#revokeObjectUrl(url);
        if (mediaGeneration === this.#mediaGeneration) this.#mediaRequests.delete(mediaKey);
        return null;
      }
      if (source.blob) this.cacheMedia(mediaKey, source.blob, attachment.size);
      this.#mediaSources.set(mediaKey, { objectUrl, url });
      this.#mediaRequests.delete(mediaKey);
      return url;
    } catch {
      if (mediaGeneration === this.#mediaGeneration) this.#mediaRequests.delete(mediaKey);
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
  post: FluoPost;
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

function readableError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'The selected Nodo could not be reached.';
}

const INITIAL_FEED_PAGE_SIZE = 24;
const MAX_MEDIA_CACHE_BYTES = 96 * 1_024 * 1_024;
const MAX_MEDIA_DIMENSION = 100_000;

function postKey(post: Pick<FluoPost, 'id' | 'nodeId' | 'space'>): string {
  return `${post.space}:${post.nodeId}:${post.id}`;
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
    // A missing hash means an older Nodo or a transient state-endpoint
    // failure. Reloading is safer than silently serving stale posts.
    if (!before.stateHash || !after.stateHash) return true;
    return before.stateHash !== after.stateHash;
  });
}

function createLocalId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `fluo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
