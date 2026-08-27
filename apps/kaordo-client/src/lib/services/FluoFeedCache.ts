import type { FluoNodeFeedState } from '../gateways/FluoGateway';
import type { FluoAttachment, FluoPost, FluoQuote } from '../states/FluoGState';

const CACHE_VERSION = 1;
const CACHE_KEY_PREFIX = 'kaordo.fluo-feed.v1.';
const MAX_CACHED_POSTS = 300;
const MAX_CACHE_JSON_BYTES = 1_750_000;
const MAX_ID_LENGTH = 200;
const MAX_AUTHOR_LENGTH = 200;
const MAX_BODY_LENGTH = 5_000;
const MAX_ATTACHMENT_NAME_LENGTH = 240;

export type FluoFeedCacheRecord = {
  feedCursor: string | null;
  feedNodeIds: string[];
  feedStates: FluoNodeFeedState[];
  hasMore: boolean;
  pageSize: number;
  posts: FluoPost[];
};

type StoredFluoFeed = FluoFeedCacheRecord & {
  savedAt: number;
  version: typeof CACHE_VERSION;
};

export type FluoFeedCacheOptions = {
  storage?: Storage;
  keyPrefix?: string;
  maxPosts?: number;
};

/**
 * Persists only the small, immediately-renderable part of Fluo. Attachment
 * bytes and object URLs stay out of localStorage; they are resolved lazily
 * from Nodo after the post shell is visible.
 */
export class FluoFeedCache {
  readonly #maxPosts: number;
  readonly #providedStorage?: Storage;
  readonly #keyPrefix: string;
  readonly #lastContentByKey = new Map<string, string>();

  constructor(options: FluoFeedCacheOptions = {}) {
    this.#maxPosts = clampInteger(options.maxPosts ?? MAX_CACHED_POSTS, 1, MAX_CACHED_POSTS);
    this.#providedStorage = options.storage;
    this.#keyPrefix = options.keyPrefix ?? CACHE_KEY_PREFIX;
  }

  read(ownerId: string | null): FluoFeedCacheRecord | null {
    const key = this.key(ownerId);
    if (!key) return null;
    const storage = this.storage();
    if (!storage) return null;
    let serialized: string | null = null;
    try {
      serialized = storage.getItem(key);
    } catch {
      return null;
    }
    if (!serialized) return null;

    try {
      const parsed: unknown = JSON.parse(serialized);
      const record = parseStoredFeed(parsed);
      if (!record) {
        this.#lastContentByKey.delete(key);
        storage.removeItem(key);
        return null;
      }
      return record;
    } catch {
      // A truncated or incompatible cache must never prevent the live feed
      // from opening. Remove it so the next launch does not repeat the error.
      this.#lastContentByKey.delete(key);
      try { storage.removeItem(key); } catch { /* storage may be unavailable */ }
      return null;
    }
  }

  write(ownerId: string | null, record: FluoFeedCacheRecord): void {
    const key = this.key(ownerId);
    if (!key) return;
    const storage = this.storage();
    if (!storage) return;

    const posts = record.posts
      .slice()
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, this.#maxPosts)
      .map(serializePost);
    const base = {
      feedCursor: typeof record.feedCursor === 'string' ? record.feedCursor : null,
      feedNodeIds: record.feedNodeIds.filter(isBoundedString),
      feedStates: record.feedStates.map(serializeFeedState),
      hasMore: record.hasMore === true,
      pageSize: clampInteger(record.pageSize, 1, 50),
      posts,
      // A stable timestamp keeps the content signature independent from the
      // moment of the write. Otherwise every reconciliation would defeat the
      // duplicate-write guard below even when no feed data changed.
      savedAt: 0,
      version: CACHE_VERSION as typeof CACHE_VERSION,
    } satisfies StoredFluoFeed;

    // Keep localStorage writes bounded even if post text or attachment
    // metadata grows in a future protocol version. Prefer a smaller cache to
    // dropping persistence altogether after a quota error.
    let candidate = base;
    let serialized = JSON.stringify(candidate);
    while (serialized.length * 2 > MAX_CACHE_JSON_BYTES && candidate.posts.length > 1) {
      candidate = { ...candidate, posts: candidate.posts.slice(0, Math.ceil(candidate.posts.length * 0.75)) };
      serialized = JSON.stringify(candidate);
    }
    if (serialized.length * 2 > MAX_CACHE_JSON_BYTES) {
      candidate = { ...candidate, posts: [] };
      serialized = JSON.stringify(candidate);
    }

    // State updates can arrive in quick succession while the feed reconciles
    // metadata. Avoid rewriting the same (potentially large) localStorage
    // value when nothing persisted actually changed. The timestamp is added
    // only for a real write, after this stable content comparison.
    if (this.#lastContentByKey.get(key) === serialized) return;
    const persisted = { ...candidate, savedAt: Date.now() } satisfies StoredFluoFeed;
    serialized = JSON.stringify(persisted);
    try {
      storage.setItem(key, serialized);
      this.#lastContentByKey.set(key, JSON.stringify(candidate));
    } catch {
      // Quota/security failures are non-fatal. The network path remains the
      // source of truth and will try again on the next successful update.
    }
  }

  remove(ownerId: string | null): void {
    const key = this.key(ownerId);
    if (!key) return;
    this.#lastContentByKey.delete(key);
    const storage = this.storage();
    if (!storage) return;
    try { storage.removeItem(key); } catch { /* storage may be unavailable */ }
  }

  private key(ownerId: string | null): string | null {
    const normalized = ownerId?.trim();
    return normalized ? `${this.#keyPrefix}${encodeURIComponent(normalized)}` : null;
  }

  private storage(): Storage | null {
    if (this.#providedStorage) return this.#providedStorage;
    try {
      return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
    } catch {
      return null;
    }
  }
}

function parseStoredFeed(value: unknown): FluoFeedCacheRecord | null {
  if (!isRecord(value) || value.version !== CACHE_VERSION) return null;
  if (!Array.isArray(value.feedNodeIds) || !Array.isArray(value.feedStates) || !Array.isArray(value.posts)) return null;
  const posts = value.posts.map(parsePost).filter((post): post is FluoPost => post !== null);
  const feedStates = value.feedStates.map(parseFeedState).filter((state): state is FluoNodeFeedState => state !== null);
  const feedNodeIds = value.feedNodeIds.filter(isBoundedString);
  const feedCursor = value.feedCursor === null || typeof value.feedCursor === 'string' ? value.feedCursor : null;
  const pageSize = clampInteger(value.pageSize, 1, 50);
  if (!isFiniteNumber(value.savedAt) || value.savedAt < 0) return null;
  return {
    feedCursor,
    feedNodeIds,
    feedStates,
    hasMore: value.hasMore === true,
    pageSize,
    posts,
  };
}

function parsePost(value: unknown): FluoPost | null {
  if (!isRecord(value) || !isBoundedString(value.id) || !isBoundedString(value.nodeId) ||
      (value.space !== 'private' && value.space !== 'public') || !Number.isFinite(value.createdAt) ||
      typeof value.body !== 'string' || typeof value.author !== 'string' || !Array.isArray(value.attachments)) {
    return null;
  }
  const attachments = value.attachments
    .map(parseAttachment)
    .filter((attachment): attachment is FluoAttachment => attachment !== null);
  const quote = parseQuote(value.quote);
  return {
    attachments,
    author: value.author.slice(0, MAX_AUTHOR_LENGTH),
    body: value.body.slice(0, MAX_BODY_LENGTH),
    createdAt: Math.max(0, value.createdAt as number),
    id: value.id,
    liked: value.liked === true,
    likeCount: normalizeLikeCount(value.likeCount),
    nodeId: value.nodeId,
    ...(quote ? { quote } : {}),
    space: value.space,
  };
}

function parseQuote(value: unknown): FluoQuote | null {
  if (!isRecord(value) || !isBoundedString(value.id) || !isBoundedString(value.nodeId) ||
      (value.space !== 'private' && value.space !== 'public') || !Number.isFinite(value.createdAt) ||
      typeof value.body !== 'string' || typeof value.author !== 'string' || !Array.isArray(value.attachments)) {
    return null;
  }
  const attachments = value.attachments
    .map(parseAttachment)
    .filter((attachment): attachment is FluoAttachment => attachment !== null);
  return {
    attachments,
    author: value.author.slice(0, MAX_AUTHOR_LENGTH),
    body: value.body.slice(0, MAX_BODY_LENGTH),
    createdAt: Math.max(0, value.createdAt as number),
    id: value.id,
    nodeId: value.nodeId,
    space: value.space,
  };
}

function parseAttachment(value: unknown): FluoAttachment | null {
  if (!isRecord(value) || !isBoundedString(value.id) ||
      (value.kind !== 'gif' && value.kind !== 'image' && value.kind !== 'video') ||
      !isBoundedString(value.mimeType) || typeof value.name !== 'string' ||
      !isFiniteNumber(value.size) || value.size < 0) return null;
  const dimensions = validDimensions(value.width, value.height)
    ? { height: Math.round(value.height as number), width: Math.round(value.width as number) }
    : {};
  return {
    ...dimensions,
    id: value.id,
    kind: value.kind,
    mimeType: value.mimeType,
    name: value.name.slice(0, MAX_ATTACHMENT_NAME_LENGTH),
    size: Math.max(0, value.size as number),
  };
}

function parseFeedState(value: unknown): FluoNodeFeedState | null {
  if (!isRecord(value) || !isBoundedString(value.nodeId) || !isRecord(value.spaces)) return null;
  const spaces = value.spaces;
  const parseSpace = (space: 'private' | 'public') => {
    const candidate = spaces[space];
    if (!isRecord(candidate)) return null;
    const postCount = Number.isFinite(candidate.postCount) ? Math.max(0, Math.floor(candidate.postCount as number)) : 0;
    const stateHash = candidate.stateHash === null || typeof candidate.stateHash === 'string'
      ? candidate.stateHash
      : null;
    return { postCount, stateHash };
  };
  const privateSpace = parseSpace('private');
  const publicSpace = parseSpace('public');
  return privateSpace && publicSpace
    ? { nodeId: value.nodeId, spaces: { private: privateSpace, public: publicSpace } }
    : null;
}

function serializePost(post: FluoPost): FluoPost {
  return {
    attachments: post.attachments.map(serializeAttachment),
    author: post.author.slice(0, MAX_AUTHOR_LENGTH),
    body: post.body.slice(0, MAX_BODY_LENGTH),
    createdAt: Math.max(0, post.createdAt),
    id: post.id.slice(0, MAX_ID_LENGTH),
    liked: post.liked === true,
    likeCount: normalizeLikeCount(post.likeCount),
    nodeId: post.nodeId.slice(0, MAX_ID_LENGTH),
    ...(post.quote ? { quote: serializeQuote(post.quote) } : {}),
    space: post.space,
  };
}

function serializeQuote(quote: FluoQuote): FluoQuote {
  return {
    attachments: quote.attachments.map(serializeAttachment),
    author: quote.author.slice(0, MAX_AUTHOR_LENGTH),
    body: quote.body.slice(0, MAX_BODY_LENGTH),
    createdAt: Math.max(0, quote.createdAt),
    id: quote.id.slice(0, MAX_ID_LENGTH),
    nodeId: quote.nodeId.slice(0, MAX_ID_LENGTH),
    space: quote.space,
  };
}

function serializeAttachment(attachment: FluoAttachment): FluoAttachment {
  const dimensions = validDimensions(attachment.width, attachment.height)
    ? { height: Math.round(attachment.height as number), width: Math.round(attachment.width as number) }
    : {};
  return {
    ...dimensions,
    id: attachment.id.slice(0, MAX_ID_LENGTH),
    kind: attachment.kind,
    mimeType: attachment.mimeType.slice(0, MAX_ATTACHMENT_NAME_LENGTH),
    name: attachment.name.slice(0, MAX_ATTACHMENT_NAME_LENGTH),
    size: Math.max(0, attachment.size),
  };
}

function serializeFeedState(state: FluoNodeFeedState): FluoNodeFeedState {
  return {
    nodeId: state.nodeId,
    spaces: {
      private: { postCount: Math.max(0, state.spaces.private.postCount), stateHash: state.spaces.private.stateHash },
      public: { postCount: Math.max(0, state.spaces.public.postCount), stateHash: state.spaces.public.stateHash },
    },
  };
}

function validDimensions(width: unknown, height: unknown): boolean {
  return Number.isFinite(width) && Number.isFinite(height) &&
    (width as number) >= 1 && (height as number) >= 1 &&
    (width as number) <= 100_000 && (height as number) <= 100_000;
}

function normalizeLikeCount(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? value as number
    : 0;
}

function isBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampInteger(value: unknown, minimum: number, maximum: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : minimum;
  return Math.min(maximum, Math.max(minimum, number));
}
