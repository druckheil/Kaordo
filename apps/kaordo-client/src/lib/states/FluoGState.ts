import type { NodoNode } from '../domain/nodo';
import {
  PUBLIC_FLUO_DESTINATION,
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
  id: string;
  kind: FluoAttachmentKind;
  mimeType: string;
  name: string;
  size: number;
  loadState?: 'error' | 'idle' | 'loading' | 'ready';
  objectUrl?: boolean;
  url?: string;
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
  revokeObjectUrl?: (url: string) => void;
  registry?: NodoRegistry;
};

/** Owns the global node-backed Fluo timeline. No post or media is persisted locally. */
export class FluoGState extends GState<FluoSnapshot> {
  readonly #createId: () => string;
  readonly #createObjectUrl: (blob: Blob) => string;
  readonly #gateway: FluoGateway;
  readonly #nodes: NodoGateway;
  readonly #registry: NodoRegistry;
  readonly #revokeObjectUrl: (url: string) => void;
  #lifecycleId = 0;
  #requestId = 0;
  #feedCursor: string | null = null;
  #feedNodeIds: string[] = [];
  #pageSize = INITIAL_FEED_PAGE_SIZE;
  #unsubscribeRegistry: (() => void) | null = null;

  constructor(gateway: FluoGateway, nodes: NodoGateway, options: FluoGStateOptions = {}) {
    super({
      attachmentError: null,
      draft: '',
      draftAttachments: [],
      isLoading: false,
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
    this.#gateway.resetSession?.();
    this.#feedCursor = null;
    this.#feedNodeIds = [];
    this.#pageSize = INITIAL_FEED_PAGE_SIZE;
    this.#unsubscribeRegistry?.();
    this.#unsubscribeRegistry = null;
    this.revokeUrls(this.snapshot.posts.flatMap((post) => post.attachments));
    this.revokeUrls(this.snapshot.draftAttachments);
    this.publish({
      ...this.snapshot,
      attachmentError: null,
      draft: '',
      draftAttachments: [],
      isLoading: false,
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

  async refreshNodes(): Promise<void> {
    const requestId = ++this.#requestId;
    this.publish({ ...this.snapshot, isLoading: true, isLoadingMore: false, storageError: null });
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
      this.#pageSize = INITIAL_FEED_PAGE_SIZE;
      const page = await this.#gateway.listFeedPage(feedNodeIds, null, this.#pageSize);
      if (requestId !== this.#requestId) return;
      this.#feedCursor = page.cursor;
      this.#feedNodeIds = [...feedNodeIds];
      this.revokeUrls(this.snapshot.posts.flatMap((post) => post.attachments));
      const posts = page.posts
        .map((post) => this.hydrate(post))
        .sort((left, right) => right.createdAt - left.createdAt);
      this.publish({
        ...this.snapshot,
        isLoading: false,
        hasMore: page.hasMore,
        isLoadingMore: false,
        posts,
        publicStorage,
        storageError: null,
      });
    } catch (error) {
      if (requestId !== this.#requestId) return;
      this.publish({ ...this.snapshot, isLoading: false, storageError: readableError(error) });
    }
  }

  async loadMore(): Promise<void> {
    if (this.snapshot.isLoading || this.snapshot.isLoadingMore || !this.snapshot.hasMore ||
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
    const matches = this.snapshot.posts.filter(({ id }) => id === postId);
    if (matches.length !== 1) return null;
    const post = matches[0];
    const attachment = post?.attachments.find(({ id }) => id === attachmentId);
    if (!post || !attachment) return null;
    const lifecycleId = this.#lifecycleId;
    const key = postKey(post);
    if (attachment.url) return attachment.url;
    if (attachment.loadState === 'loading') return null;
    this.updateAttachment(key, attachmentId, { loadState: 'loading' });
    try {
      const source = await this.#gateway.loadMedia(post.nodeId, post.space, attachment);
      const objectUrl = 'blob' in source;
      const url = source.blob ? this.#createObjectUrl(source.blob) : source.streamUrl;
      if (lifecycleId !== this.#lifecycleId || !this.snapshot.posts.some((candidate) => postKey(candidate) === key)) {
        if (objectUrl) this.#revokeObjectUrl(url);
        return null;
      }
      this.updateAttachment(key, attachmentId, { loadState: 'ready', objectUrl, url });
      return url;
    } catch {
      if (lifecycleId === this.#lifecycleId) {
        this.updateAttachment(key, attachmentId, { loadState: 'error' });
      }
      return null;
    }
  }

  unloadMediaOutside(visiblePostKeys: ReadonlySet<string>): void {
    let changed = false;
    const posts = this.snapshot.posts.map((post) => {
      if (visiblePostKeys.has(postKey(post))) return post;
      const attachments = post.attachments.map((attachment) => {
        if (!attachment.url) return attachment;
        if (attachment.objectUrl) this.#revokeObjectUrl(attachment.url);
        changed = true;
        return { ...attachment, loadState: 'idle' as const, objectUrl: false, url: undefined };
      });
      return attachments === post.attachments ? post : { ...post, attachments };
    });
    if (changed) this.publish({ ...this.snapshot, posts });
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
      this.revokeUrls(attachments);
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
      this.publish({
        ...this.snapshot,
        posts: this.snapshot.posts.filter((candidate) => postKey(candidate) !== key),
        publicStorage,
        storageError: null,
      });
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

  private updateAttachment(
    key: string,
    attachmentId: string,
    update: Partial<FluoAttachment>,
  ): void {
    this.publish({
      ...this.snapshot,
      posts: this.snapshot.posts.map((post) => postKey(post) !== key ? post : {
        ...post,
        attachments: post.attachments.map((attachment) => attachment.id === attachmentId
          ? { ...attachment, ...update }
          : attachment),
      }),
    });
  }

  private revokeUrls(attachments: readonly FluoAttachment[]): void {
    for (const attachment of attachments) if (attachment.url) this.#revokeObjectUrl(attachment.url);
  }
}

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

function postKey(post: Pick<FluoPost, 'id' | 'nodeId' | 'space'>): string {
  return `${post.space}:${post.nodeId}:${post.id}`;
}

function createLocalId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `fluo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
