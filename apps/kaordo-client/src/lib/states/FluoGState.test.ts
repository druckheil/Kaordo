import { describe, expect, it } from 'vitest';
import type { NodoAccess, NodoNode, NodoPolicy } from '../domain/nodo';
import {
  createFluoQuote,
  FLUO_MAX_POST_LENGTH,
  type FluoDraftAttachment,
  type FluoQuote,
} from '../domain/fluo';
import type { FluoFeedPage, FluoGateway, FluoLikeState, FluoLikeTarget, FluoUploadProgress, RemoteFluoPost } from '../gateways/FluoGateway';
import { PUBLIC_FLUO_DESTINATION } from '../gateways/FluoGateway';
import type { NodoGateway } from '../gateways/NodoGateway';
import { FluoGState } from './FluoGState';

describe('FluoGState', () => {
  it('loads the Cloudflare coordination snapshot with one bootstrap request', async () => {
    const nodes = new MemoryNodoGateway();
    const state = new FluoGState(new MemoryFluoGateway(), nodes);

    await state.refreshNodes();

    expect(nodes.bootstrapCalls).toBe(1);
    expect(nodes.individualCalls).toBe(0);
  });

  it('shares concurrent node refreshes within one lifecycle', async () => {
    const nodes = new MemoryNodoGateway();
    let release!: () => void;
    nodes.bootstrapGate = new Promise<void>((resolve) => { release = resolve; });
    const state = createState(new MemoryFluoGateway(), {}, nodes);

    const first = state.refreshNodes();
    const second = state.refreshNodes();
    await Promise.resolve();

    expect(nodes.bootstrapCalls).toBe(1);
    release();
    await Promise.all([first, second]);
  });

  it('accepts a five-thousand-character post draft', () => {
    const state = createState(new MemoryFluoGateway());

    state.setDraft('a'.repeat(FLUO_MAX_POST_LENGTH + 1));

    expect(state.snapshot.draft).toHaveLength(FLUO_MAX_POST_LENGTH);
  });

  it('reuses cached post metadata when every Nodo state hash is unchanged', async () => {
    const fluo = new MemoryFluoGateway();
    fluo.posts = [{
      attachments: [],
      author: 'cached',
      body: 'Keep me',
      createdAt: 10,
      id: 'cached-post',
      nodeId: NODE.id,
      space: 'private',
    }];
    const state = createState(fluo);

    await state.refreshNodes();
    await state.refreshNodes();

    expect(fluo.feedPageCalls).toBe(1);
    expect(state.snapshot.posts.map(({ id }) => id)).toEqual(['cached-post']);
  });

  it('does not rewrite an unchanged persisted feed snapshot', async () => {
    const storage = new MapStorage();
    const fluo = new MemoryFluoGateway();
    fluo.posts = [{
      attachments: [],
      author: 'cached',
      body: 'Keep the storage write bounded',
      createdAt: 10,
      id: 'stable-post',
      nodeId: NODE.id,
      space: 'private',
    }];
    const state = createState(fluo, { cacheOwnerId: 'user-1', cacheStorage: storage });

    await state.refreshNodes();
    await Promise.resolve();
    await Promise.resolve();
    const writesAfterInitialSnapshot = storage.writes;
    await state.refreshNodes();
    await Promise.resolve();

    expect(writesAfterInitialSnapshot).toBeGreaterThan(0);
    expect(storage.writes).toBe(writesAfterInitialSnapshot);
  });

  it('restores persisted post metadata before revalidating the live feed', async () => {
    const storage = new MapStorage();
    const firstGateway = new MemoryFluoGateway();
    firstGateway.posts = [{
      attachments: [],
      author: 'cached',
      body: 'Available immediately after restart',
      createdAt: 10,
      id: 'persisted-post',
      nodeId: NODE.id,
      space: 'private',
    }];
    const first = new FluoGState(firstGateway, new MemoryNodoGateway(), {
      cacheOwnerId: 'user-1',
      cacheStorage: storage,
      scheduleCacheWrite: scheduleMicrotask,
    });

    first.enter();
    await first.refreshNodes();
    // The first metadata response is committed before the optional state
    // probe resolves. Let that probe persist its hash as well.
    await Promise.resolve();
    await Promise.resolve();
    first.exit();

    const secondGateway = new MemoryFluoGateway();
    secondGateway.posts = [...firstGateway.posts];
    const secondNodes = new MemoryNodoGateway();
    let releaseBootstrap!: () => void;
    secondNodes.bootstrapGate = new Promise<void>((resolve) => { releaseBootstrap = resolve; });
    const second = new FluoGState(secondGateway, secondNodes, {
      cacheOwnerId: 'user-1',
      cacheStorage: storage,
      scheduleCacheWrite: scheduleMicrotask,
    });

    second.enter();
    await Promise.resolve();
    expect(second.snapshot.posts.map(({ id }) => id)).toEqual(['persisted-post']);
    expect(second.snapshot.isLoading).toBe(false);
    releaseBootstrap();
    await second.refreshNodes();

    expect(secondGateway.feedPageCalls).toBe(0);
    expect(second.snapshot.posts.map(({ id }) => id)).toEqual(['persisted-post']);
    second.exit();
  });

  it('reloads metadata and removes cached posts when a Nodo hash changes', async () => {
    const fluo = new MemoryFluoGateway();
    fluo.posts = [{
      attachments: [],
      author: 'cached',
      body: 'Remove me',
      createdAt: 10,
      id: 'removed-post',
      nodeId: NODE.id,
      space: 'private',
    }];
    const state = createState(fluo);

    await state.refreshNodes();
    fluo.posts = [];
    fluo.stateHash = 'memory-2';
    await state.refreshNodes();

    expect(fluo.feedPageCalls).toBe(2);
    expect(state.snapshot.posts).toEqual([]);
  });

  it('preserves resolved media when a changed hash reconciles an existing post', async () => {
    const fluo = new MemoryFluoGateway();
    const attachment = {
      height: 900,
      id: 'stable-media',
      kind: 'video' as const,
      mimeType: 'video/mp4',
      name: 'stable.mp4',
      size: 10,
      width: 1_600,
    };
    fluo.posts = [{
      attachments: [attachment],
      author: 'cached',
      body: 'Keep the player alive',
      createdAt: 10,
      id: 'stable-post',
      nodeId: NODE.id,
      space: 'private',
    }];
    const state = createState(fluo);

    await state.refreshNodes();
    const previous = state.snapshot.posts[0]!;
    expect(await state.loadMedia(previous.id, attachment.id)).toBe('blob:remote');
    expect(fluo.mediaLoads).toBe(1);

    fluo.posts = [{
      attachments: [],
      author: 'cached',
      body: 'A new post',
      createdAt: 20,
      id: 'new-post',
      nodeId: NODE.id,
      space: 'private',
    }, ...fluo.posts];
    fluo.stateHash = 'memory-2';
    await state.refreshNodes();

    const reconciled = state.snapshot.posts.find(({ id }) => id === previous.id);
    expect(reconciled?.attachments[0]).toBe(previous.attachments[0]);
    expect(await state.loadMedia(previous.id, attachment.id)).toBe('blob:remote');
    expect(fluo.mediaLoads).toBe(1);
  });

  it('keeps older cached posts while reconciling a changed feed page', async () => {
    const fluo = new ReconcileFluoGateway();
    const state = createState(fluo);

    await state.refreshNodes();
    await state.loadMore();
    expect(state.snapshot.posts.map(({ id }) => id)).toEqual(['post-3', 'post-2', 'post-1']);

    fluo.phase = 'changed';
    fluo.stateHash = 'state-2';
    await state.refreshNodes();

    expect(state.snapshot.posts.map(({ id }) => id)).toEqual(['post-4', 'post-3', 'post-1']);
  });

  it('builds one date-ordered feed that does not change with the publishing destination', async () => {
    const fluo = new MemoryFluoGateway();
    fluo.posts = [
      { attachments: [], author: 'older', body: 'Old', createdAt: 10, id: 'old', nodeId: 'node-a', space: 'private' },
      { attachments: [], author: 'newer', body: 'New', createdAt: 20, id: 'new', nodeId: 'node-b', space: 'public' },
    ];
    const state = createState(fluo);

    await state.refreshNodes();
    expect(state.snapshot.posts.map(({ id }) => id)).toEqual(['new', 'old']);

    await state.selectNode(NODE.id);
    expect(state.snapshot.posts.map(({ id }) => id)).toEqual(['new', 'old']);
  });

  it('hydrates persisted like state without blocking the first metadata page', async () => {
    const fluo = new LikeFluoGateway();
    fluo.posts = [{
      attachments: [],
      author: 'liked',
      body: 'A post with a server reaction',
      createdAt: 20,
      id: '123e4567-e89b-42d3-a456-426614174001',
      nodeId: NODE.id,
      space: 'private',
    }];
    fluo.likeStates.set(fluo.posts[0]!.id, { liked: true, likeCount: 3 });
    const state = createState(fluo);

    await state.refreshNodes();
    expect(state.snapshot.posts[0]?.body).toBe('A post with a server reaction');
    await flushTasks();

    expect(state.snapshot.posts[0]).toMatchObject({ likeCount: 3, liked: true });
    expect(fluo.likeQueryCalls).toBe(1);
  });

  it('reuses fresh like state across automatic feed revalidation', async () => {
    const fluo = new LikeFluoGateway();
    fluo.posts = [{
      attachments: [],
      author: 'liked',
      body: 'Do not query the coordinator again on a tab revisit',
      createdAt: 20,
      id: '123e4567-e89b-42d3-a456-426614174011',
      nodeId: NODE.id,
      space: 'private',
    }];
    const state = createState(fluo);

    await state.refreshNodes();
    await flushTasks();
    await state.refreshNodes();
    await flushTasks();
    expect(fluo.likeQueryCalls).toBe(1);

    await state.refreshFeed();
    await flushTasks();
    expect(fluo.likeQueryCalls).toBe(2);
  });

  it('updates a like optimistically and rolls back when persistence fails', async () => {
    const fluo = new LikeFluoGateway();
    fluo.posts = [{
      attachments: [],
      author: 'optimistic',
      body: 'Tap without waiting',
      createdAt: 20,
      id: '123e4567-e89b-42d3-a456-426614174002',
      nodeId: NODE.id,
      space: 'private',
    }];
    const state = createState(fluo);
    await state.refreshNodes();
    await flushTasks();

    fluo.setLikeFailure = new Error('Likes are temporarily unavailable.');
    const pending = state.toggleLike(fluo.posts[0]!.id);
    expect(state.snapshot.posts[0]).toMatchObject({ likeCount: 1, likePending: true, liked: true });
    expect(await pending).toBe(false);
    expect(state.snapshot.posts[0]).toMatchObject({ likeCount: 0, likePending: false, liked: false });
    expect(state.snapshot.storageError).toBe('Likes are temporarily unavailable.');
  });

  it('keeps toggling responsive while a previous like request is slow', async () => {
    const fluo = new LikeFluoGateway();
    fluo.posts = [{
      attachments: [],
      author: 'responsive',
      body: 'A slow coordinator must not lock the button',
      createdAt: 20,
      id: '123e4567-e89b-42d3-a456-426614174003',
      nodeId: NODE.id,
      space: 'private',
    }];
    let release!: () => void;
    fluo.setLikeGate = new Promise<void>((resolve) => { release = resolve; });
    const state = createState(fluo);
    await state.refreshNodes();
    await flushTasks();

    const first = state.toggleLike(fluo.posts[0]!.id);
    expect(state.snapshot.posts[0]).toMatchObject({ liked: true, likeCount: 1, likePending: true });
    // The second click is accepted immediately and is queued as the latest
    // desired state instead of being ignored while the first request waits.
    const second = state.toggleLike(fluo.posts[0]!.id);
    expect(state.snapshot.posts[0]).toMatchObject({ liked: false, likeCount: 0, likePending: true });
    expect(fluo.setLikeCalls).toBe(1);

    release();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(fluo.setLikeCalls).toBe(2);
    expect(fluo.likeStates.get(fluo.posts[0]!.id)).toEqual({ liked: false, likeCount: 0 });
    expect(state.snapshot.posts[0]).toMatchObject({ liked: false, likeCount: 0, likePending: false });
  });

  it('publishes to the Public Nodo pool by default and still allows a private destination', async () => {
    const fluo = new MemoryFluoGateway();
    const state = createState(fluo);
    await state.refreshNodes();
    state.setDraft('  A node-backed beginning.  ');

    expect(await state.publishPost()).toBe(true);
    expect(fluo.publishedOn).toEqual([PUBLIC_FLUO_DESTINATION]);

    state.setDraft('Private copy');
    await state.selectNode(NODE.id);
    expect(await state.publishPost()).toBe(true);
    expect(fluo.publishedOn).toEqual([PUBLIC_FLUO_DESTINATION, NODE.id]);
    expect(state.snapshot.draft).toBe('');
    expect(state.snapshot.posts[0]).toMatchObject({
      author: 'Nova_User',
      body: 'Private copy',
      liked: false,
      space: 'private',
    });
    expect(state.snapshot.posts[1]).toMatchObject({ body: 'A node-backed beginning.', space: 'public' });
  });

  it('restores the selected Nodo for the account after restart', async () => {
    const storage = new MapStorage();
    const first = createState(new MemoryFluoGateway(), {
      cacheOwnerId: 'user-1',
      selectionStorage: storage,
    });

    await first.refreshNodes();
    await first.selectNode(NODE.id);

    const second = createState(new MemoryFluoGateway(), {
      cacheOwnerId: 'user-1',
      selectionStorage: storage,
    });

    expect(second.snapshot.selectedNodeId).toBe(NODE.id);
    await second.refreshNodes();
    expect(second.snapshot.selectedNodeId).toBe(NODE.id);
  });

  it('publishes a quote without duplicating the original media payload', async () => {
    const fluo = new MemoryFluoGateway();
    fluo.posts = [{
      attachments: [],
      author: 'Original',
      body: 'The original post',
      createdAt: 1_719_000_000_000,
      id: 'original-post',
      nodeId: NODE.id,
      space: 'private',
    }];
    const state = createState(fluo);
    await state.refreshNodes();
    const original = state.snapshot.posts[0]!;
    state.setDraft('My context');

    expect(await state.publishPost(createFluoQuote(original))).toBe(true);
    expect(state.snapshot.posts[0]?.body).toBe('My context');
    expect(state.snapshot.posts[0]?.quote).toMatchObject({
      author: 'Original',
      body: 'The original post',
      id: 'original-post',
      nodeId: NODE.id,
      space: 'private',
    });
    expect(state.snapshot.posts[0]?.quote?.attachments).toEqual([]);
  });

  it('uploads at most four mixed media files and deletes the remote post', async () => {
    const fluo = new MemoryFluoGateway();
    let id = 0;
    const state = createState(fluo, {
      createId: () => `media-${++id}`,
      createObjectUrl: () => `blob:preview-${id}`,
      revokeObjectUrl: () => undefined,
    });
    await state.refreshNodes();
    await state.selectNode(NODE.id);

    expect(state.addAttachments([
      new File(['image'], 'one.png', { type: 'image/png' }),
      new File(['gif'], 'two.gif', { type: 'image/gif' }),
      new File(['video'], 'three.mp4', { type: 'video/mp4' }),
      new File(['image'], 'four.jpg', { type: 'image/jpeg' }),
      new File(['video'], 'extra.webm', { type: 'video/webm' }),
    ])).toBe(4);
    expect(state.snapshot.attachmentError).toBe('A post can contain up to 4 images, GIFs, or videos and 5 audio files.');

    expect(await state.publishPost()).toBe(true);
    expect(state.snapshot.posts[0]?.attachments.map(({ kind }) => kind)).toEqual([
      'image', 'gif', 'video', 'image',
    ]);
    expect(state.snapshot.posts[0]?.attachments.every(({ width, height }) =>
      width === 1_600 && height === 900)).toBe(true);
    const postId = state.snapshot.posts[0]?.id;
    expect(postId).toBeDefined();
    expect(await state.deletePost(postId!)).toBe(true);
    expect(fluo.posts).toEqual([]);
    expect(state.snapshot.posts).toEqual([]);
  });

  it('allows five audio files independently from the four visual media limit', () => {
    const state = createState(new MemoryFluoGateway(), {
      createId: (() => {
        let id = 0;
        return () => `audio-${++id}`;
      })(),
      createObjectUrl: (blob) => `blob:${blob.size}`,
      revokeObjectUrl: () => undefined,
    });

    expect(state.addAudioAttachments([
      new File(['1'], 'one.mp3', { type: 'audio/mpeg' }),
      new File(['2'], 'two.ogg', { type: 'audio/ogg' }),
      new File(['3'], 'three.wav', { type: 'audio/wav' }),
      new File(['4'], 'four.m4a', { type: 'audio/mp4' }),
      new File(['5'], 'five.flac', { type: 'audio/flac' }),
      new File(['6'], 'six.mp3', { type: 'audio/mpeg' }),
    ])).toBe(5);
    expect(state.snapshot.draftAttachments.map(({ kind }) => kind)).toEqual([
      'audio', 'audio', 'audio', 'audio', 'audio',
    ]);
    expect(state.snapshot.draftAttachments.every(({ width, height }) => width === undefined && height === undefined)).toBe(true);
    expect(state.snapshot.attachmentError).toBe('A post can contain up to 4 images, GIFs, or videos and 5 audio files.');
  });

  it('surfaces an unreachable Nodo without falling back to local storage', async () => {
    const fluo = new MemoryFluoGateway();
    fluo.failure = new Error('Nodo is offline.');
    const state = createState(fluo);
    await state.refreshNodes();

    await state.selectNode(NODE.id);

    expect(state.snapshot.posts).toEqual([]);
    expect(state.snapshot.storageError).toBe('Nodo is offline.');
  });

  it('publishes byte-accurate progress and keeps the uploaded blob for immediate display', async () => {
    const fluo = new ProgressFluoGateway();
    const state = createState(fluo, {
      createId: () => 'draft-media',
      createObjectUrl: () => 'blob:media',
    });
    await state.refreshNodes();
    await state.selectNode(NODE.id);
    state.addAttachments([new File(['0123456789'], 'large.mp4', { type: 'video/mp4' })]);

    const publishing = state.publishPost();
    await Promise.resolve();
    expect(state.snapshot.uploadProgress).toMatchObject({
      attachmentName: 'large.mp4',
      totalBytes: 10,
      uploadedBytes: 5,
    });

    fluo.complete();
    expect(await publishing).toBe(true);
    expect(state.snapshot.uploadProgress).toBeNull();
    expect(state.snapshot.posts[0]?.attachments[0]?.url).toBe('blob:media');
  });

  it('pages metadata first and loads media only when requested', async () => {
    const fluo = new PagedFluoGateway();
    const created: Blob[] = [];
    const state = createState(fluo, {
      createObjectUrl: (blob) => { created.push(blob); return `blob:lazy-${created.length}`; },
    });

    await state.refreshNodes();
    expect(state.snapshot.posts).toHaveLength(24);
    expect(state.snapshot.posts[0]?.attachments[0]?.url).toBeUndefined();
    expect(fluo.mediaLoads).toBe(0);

    await state.loadMore();
    expect(state.snapshot.posts).toHaveLength(40);
    const first = state.snapshot.posts[0]!;
    const snapshotBeforeMedia = state.snapshot;
    expect(await state.loadMedia(first.id, first.attachments[0]!.id)).toBe('blob:lazy-1');
    expect(fluo.mediaLoads).toBe(1);
    expect(state.snapshot).toBe(snapshotBeforeMedia);
  });

  it('keeps measured legacy dimensions without publishing a feed update', async () => {
    const fluo = new MemoryFluoGateway();
    fluo.posts = [{
      attachments: [{
        id: 'legacy-media',
        kind: 'image',
        mimeType: 'image/jpeg',
        name: 'legacy.jpg',
        size: 10,
      }],
      author: 'legacy',
      body: '',
      createdAt: 1_800_000_000_000,
      id: 'legacy-post',
      nodeId: NODE.id,
      space: 'private',
    }];
    const state = createState(fluo);

    await state.refreshNodes();
    const snapshotBeforeDimensions = state.snapshot;
    state.setMediaDimensions('legacy-post', 'legacy-media', 400, 700);
    expect(state.snapshot).toBe(snapshotBeforeDimensions);
    expect(state.getMediaDimensions('legacy-post', 'legacy-media')).toEqual({ width: 400, height: 700 });

    fluo.stateHash = 'memory-2';
    await state.refreshNodes();
    expect(state.getMediaDimensions('legacy-post', 'legacy-media')).toEqual({ width: 400, height: 700 });
  });

  it('keeps a direct Nodo media URL across a feed tab switch', async () => {
    const fluo = new DirectMediaFluoGateway();
    const revoked: string[] = [];
    const state = createState(fluo, {
      revokeObjectUrl: (url) => revoked.push(url),
    });

    await state.refreshNodes();
    const first = state.snapshot.posts[0]!;
    const url = await state.loadMedia(first.id, first.attachments[0]!.id);
    state.exit();

    expect(url).toBe('http://nodo.test/media.png');
    expect(await state.loadMedia(first.id, first.attachments[0]!.id)).toBe(url);
    expect(fluo.mediaLoads).toBe(1);
    expect(revoked).toEqual([]);
  });

  it('deduplicates concurrent media resolution without publishing feed state', async () => {
    const fluo = new SlowMediaFluoGateway();
    const state = createState(fluo);
    await state.refreshNodes();
    const first = state.snapshot.posts[0]!;
    const snapshotBeforeMedia = state.snapshot;

    const load = state.loadMedia(first.id, first.attachments[0]!.id);
    const duplicate = state.loadMedia(first.id, first.attachments[0]!.id);
    expect(fluo.mediaLoads).toBe(1);

    fluo.completeNext();
    await Promise.all([load, duplicate]);

    expect(state.snapshot).toBe(snapshotBeforeMedia);
  });
});

function createState(
  fluo: FluoGateway,
  options: ConstructorParameters<typeof FluoGState>[2] = {},
  nodes: NodoGateway = new MemoryNodoGateway(),
) {
  return new FluoGState(fluo, nodes, {
    createObjectUrl: () => 'blob:remote',
    revokeObjectUrl: () => undefined,
    scheduleCacheWrite: scheduleMicrotask,
    ...options,
  });
}

function scheduleMicrotask(callback: () => void): () => void {
  let cancelled = false;
  queueMicrotask(() => {
    if (!cancelled) callback();
  });
  return () => { cancelled = true; };
}

async function flushTasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

class MemoryFluoGateway implements FluoGateway {
  failure: Error | null = null;
  posts: RemoteFluoPost[] = [];
  feedPageCalls = 0;
  mediaLoads = 0;
  stateHash = 'memory-1';
  readonly publishedOn: string[] = [];

  async listFeedPage(_nodeIds: readonly string[] = [], _cursor: string | null = null, _limit = 50): Promise<FluoFeedPage> {
    this.feedPageCalls += 1;
    if (this.failure) throw this.failure;
    return { cursor: null, hasMore: false, posts: this.posts };
  }

  listFeedStates(nodeIds: readonly string[]) {
    return Promise.resolve(nodeIds.map((nodeId) => ({
      nodeId,
      spaces: {
        private: { postCount: this.posts.filter((post) => post.nodeId === nodeId && post.space === 'private').length, stateHash: this.stateHash },
        public: { postCount: this.posts.filter((post) => post.nodeId === nodeId && post.space === 'public').length, stateHash: this.stateHash },
      },
    })));
  }

  loadMedia(): Promise<{ blob: Blob }> {
    this.mediaLoads += 1;
    return Promise.resolve({ blob: new Blob(['media']) });
  }

  async publishPost(
    nodeId: string,
    body: string,
    attachments: readonly FluoDraftAttachment[],
    _onProgress?: (progress: FluoUploadProgress) => void,
    quote?: FluoQuote,
  ): Promise<RemoteFluoPost> {
    if (this.failure) throw this.failure;
    this.publishedOn.push(nodeId);
    const post: RemoteFluoPost = {
      attachments: attachments.map(({ blob, url: _url, ...attachment }) => ({ ...attachment, blob })),
      author: 'Nova_User',
      body,
      createdAt: 1_720_000_000_000,
      id: `post-${this.posts.length + 1}`,
      nodeId,
      ...(quote ? { quote } : {}),
      space: nodeId === PUBLIC_FLUO_DESTINATION ? 'public' : 'private',
    };
    this.posts = [post, ...this.posts];
    return post;
  }

  async deletePost(_nodeId: string, postId: string): Promise<void> {
    if (this.failure) throw this.failure;
    this.posts = this.posts.filter(({ id }) => id !== postId);
  }
}

class LikeFluoGateway extends MemoryFluoGateway {
  readonly likeStates = new Map<string, { liked: boolean; likeCount: number }>();
  likeQueryCalls = 0;
  setLikeCalls = 0;
  setLikeGate: Promise<void> | null = null;
  setLikeFailure: Error | null = null;

  listLikeStates(targets: readonly FluoLikeTarget[]): Promise<FluoLikeState[]> {
    this.likeQueryCalls += 1;
    return Promise.resolve(targets.map((target) => {
      const state = this.likeStates.get(target.id) ?? { liked: false, likeCount: 0 };
      return { ...target, ...state };
    }));
  }

  async setLike(target: FluoLikeTarget, liked: boolean): Promise<FluoLikeState> {
    this.setLikeCalls += 1;
    if (this.setLikeGate) await this.setLikeGate;
    if (this.setLikeFailure) throw this.setLikeFailure;
    const previous = this.likeStates.get(target.id) ?? { liked: false, likeCount: 0 };
    const state = {
      liked,
      likeCount: Math.max(0, previous.likeCount + (liked === previous.liked ? 0 : liked ? 1 : -1)),
    };
    this.likeStates.set(target.id, state);
    return { ...target, ...state };
  }
}

class ReconcileFluoGateway extends MemoryFluoGateway {
  phase: 'initial' | 'changed' = 'initial';
  stateHash = 'state-1';

  override async listFeedPage(
    _nodeIds: readonly string[] = [],
    cursor: string | null = null,
    _limit = 50,
  ): Promise<FluoFeedPage> {
    const post = (id: string, createdAt: number): RemoteFluoPost => ({
      attachments: [],
      author: 'cached',
      body: id,
      createdAt,
      id,
      nodeId: NODE.id,
      space: 'private',
    });
    if (this.phase === 'initial') {
      return cursor
        ? { cursor: null, hasMore: false, posts: [post('post-1', 10)] }
        : { cursor: 'initial-next', hasMore: true, posts: [post('post-3', 30), post('post-2', 20)] };
    }
    return cursor
      ? { cursor: null, hasMore: false, posts: [post('post-1', 10)] }
      : { cursor: 'changed-next', hasMore: true, posts: [post('post-4', 40), post('post-3', 30)] };
  }

  override listFeedStates(nodeIds: readonly string[]) {
    return Promise.resolve(nodeIds.map((nodeId) => ({
      nodeId,
      spaces: {
        private: { postCount: 3, stateHash: this.stateHash },
        public: { postCount: 0, stateHash: this.stateHash },
      },
    })));
  }
}

class ProgressFluoGateway implements FluoGateway {
  private attachment: FluoDraftAttachment | null = null;
  private resolve: ((post: RemoteFluoPost) => void) | null = null;

  listFeedPage() { return Promise.resolve({ cursor: null, hasMore: false, posts: [] }); }
  listFeedStates(nodeIds: readonly string[]) {
    return Promise.resolve(nodeIds.map((nodeId) => ({
      nodeId,
      spaces: {
        private: { postCount: 0, stateHash: 'progress-private' },
        public: { postCount: 0, stateHash: 'progress-public' },
      },
    })));
  }
  loadMedia(): Promise<{ blob: Blob }> { return Promise.resolve({ blob: new Blob() }); }
  deletePost(): Promise<void> { return Promise.resolve(); }

  publishPost(
    _nodeId: string,
    _body: string,
    attachments: readonly FluoDraftAttachment[],
    onProgress?: Parameters<FluoGateway['publishPost']>[3],
  ): Promise<RemoteFluoPost> {
    this.attachment = attachments[0] ?? null;
    onProgress?.({
      attachmentIndex: 1,
      attachmentName: this.attachment?.name ?? '',
      attachmentTotal: 1,
      totalBytes: this.attachment?.size ?? 0,
      uploadedBytes: (this.attachment?.size ?? 0) / 2,
    });
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  complete(): void {
    const attachment = this.attachment;
    if (!attachment || !this.resolve) throw new Error('Upload was not started.');
    this.resolve({
      attachments: [{
        blob: attachment.blob,
        id: '123e4567-e89b-42d3-a456-426614174000',
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        name: attachment.name,
        size: attachment.size,
      }],
      author: 'Nova_User',
      body: '',
      createdAt: 1_720_000_000_000,
      id: 'post-progress',
      nodeId: NODE.id,
      space: 'private',
    });
  }
}

class PagedFluoGateway implements FluoGateway {
  mediaLoads = 0;
  private readonly posts: RemoteFluoPost[] = Array.from({ length: 40 }, (_, index) => ({
    attachments: [{
      id: `media-${index}`,
      kind: 'image',
      mimeType: 'image/png',
      name: `${index}.png`,
      size: 5,
    }],
    author: 'paged',
    body: `Post ${index}`,
    createdAt: 1_800_000_000_000 - index,
    id: `post-${index}`,
    nodeId: NODE.id,
    space: 'private',
  }));

  listFeedPage(_nodeIds: readonly string[], cursor: string | null, limit: number) {
    const offset = Number(cursor ?? 0);
    const posts = this.posts.slice(offset, offset + limit);
    const next = offset + posts.length;
    return Promise.resolve({
      cursor: next < this.posts.length ? String(next) : null,
      hasMore: next < this.posts.length,
      posts,
    });
  }

  listFeedStates(nodeIds: readonly string[]) {
    return Promise.resolve(nodeIds.map((nodeId) => ({
      nodeId,
      spaces: {
        private: { postCount: this.posts.length, stateHash: 'paged-private' },
        public: { postCount: 0, stateHash: 'paged-public' },
      },
    })));
  }

  loadMedia() {
    this.mediaLoads += 1;
    return Promise.resolve({ blob: new Blob(['image'], { type: 'image/png' }) });
  }

  deletePost(): Promise<void> { return Promise.resolve(); }
  publishPost(): Promise<RemoteFluoPost> { throw new Error('Not used.'); }
}

class DirectMediaFluoGateway implements FluoGateway {
  mediaLoads = 0;
  private readonly posts: RemoteFluoPost[] = [{
    attachments: [{
      id: 'direct-media',
      kind: 'image',
      mimeType: 'image/png',
      name: 'cached.png',
      size: 8,
    }],
    author: 'direct',
    body: 'Cache the immutable URL',
    createdAt: 1_800_000_000_000,
    id: 'direct-post',
    nodeId: NODE.id,
    space: 'private',
  }];

  listFeedPage() {
    return Promise.resolve({ cursor: null, hasMore: false, posts: this.posts });
  }

  listFeedStates(nodeIds: readonly string[]) {
    return Promise.resolve(nodeIds.map((nodeId) => ({
      nodeId,
      spaces: {
        private: { postCount: this.posts.length, stateHash: 'direct-private' },
        public: { postCount: 0, stateHash: 'direct-public' },
      },
    })));
  }

  loadMedia() {
    this.mediaLoads += 1;
    return Promise.resolve({ streamUrl: 'http://nodo.test/media.png' });
  }

  deletePost(): Promise<void> { return Promise.resolve(); }
  publishPost(): Promise<RemoteFluoPost> { throw new Error('Not used.'); }
}

class SlowMediaFluoGateway extends PagedFluoGateway {
  private readonly pending: Array<() => void> = [];

  override loadMedia(): Promise<{ blob: Blob }> {
    this.mediaLoads += 1;
    return new Promise((resolve) => {
      this.pending.push(() => resolve({ blob: new Blob(['image'], { type: 'image/png' }) }));
    });
  }

  completeNext(): void {
    const resolve = this.pending.shift();
    if (!resolve) throw new Error('No media request is pending.');
    resolve();
  }
}

class MemoryNodoGateway implements NodoGateway {
  bootstrapCalls = 0;
  individualCalls = 0;
  bootstrapGate: Promise<void> | null = null;
  accessNode(): Promise<NodoAccess> { throw new Error('Not used by state tests.'); }
  cancelPublicStorage() { return Promise.resolve(); }
  clearStorage() { return Promise.resolve({ deletedBytes: 0, deletedPosts: 0, deletedUploads: 0 }); }
  clearPrivateStorage() { return Promise.resolve({ deletedBytes: 0, deletedPosts: 0, deletedUploads: 0 }); }
  deleteStorageItem() { return Promise.resolve(); }
  commitPublicStorage() { return Promise.resolve(); }
  deleteNode(): Promise<void> { return Promise.resolve(); }
  renameNode(_nodeId: string, name: string): Promise<string> { return Promise.resolve(name); }
  fluoBootstrap() {
    this.bootstrapCalls += 1;
    return (this.bootstrapGate ?? Promise.resolve()).then(() => ({
        nodeIds: [NODE.id],
        nodes: [NODE],
        publicStorage: PUBLIC_STORAGE,
      }));
  }
  listNodes(): Promise<NodoNode[]> {
    this.individualCalls += 1;
    return Promise.resolve([NODE]);
  }
  listFeedNodeIds(): Promise<string[]> {
    this.individualCalls += 1;
    return Promise.resolve([NODE.id]);
  }
  listStorageItems() { return Promise.resolve([]); }
  publicStorage() {
    this.individualCalls += 1;
    return Promise.resolve({ ...PUBLIC_STORAGE });
  }
  releasePublicPost() { return Promise.resolve(); }
  renewPublicStorage() { return Promise.resolve({
    expiresAt: 1_900_000_000,
    reservationId: '123e4567-e89b-42d3-a456-426614174099',
  }); }
  reservePublicStorage() { return Promise.resolve({
    expiresAt: 1_900_000_000,
    reservationId: '123e4567-e89b-42d3-a456-426614174099',
  }); }
  requestQuickTest() { return Promise.resolve({ batteryPercent: null, charging: null, completedAt: 0, coordinatorLatencyMs: 0, diskReadBps: 1, diskWriteBps: 1, memoryAvailableBytes: 0, memoryTotalBytes: 0, networkDownBps: null, networkMetered: null, networkType: 'offline' as const, networkUpBps: null, storageAvailableBytes: 0 }); }
  refreshUsage() { return Promise.resolve({ spaces: NODE.spaces, usedBytes: NODE.usedBytes }); }
  updatePolicy(_nodeId: string, policy: Omit<NodoPolicy, 'ownerOnly'>): Promise<NodoPolicy> {
    return Promise.resolve({ ...policy, ownerOnly: true });
  }
  updateSpaces() { return Promise.resolve(NODE.spaces); }
}

class MapStorage implements Storage {
  readonly #values = new Map<string, string>();
  writes = 0;

  get length(): number { return this.#values.size; }
  clear(): void { this.#values.clear(); }
  getItem(key: string): string | null { return this.#values.get(key) ?? null; }
  key(index: number): string | null { return [...this.#values.keys()][index] ?? null; }
  removeItem(key: string): void { this.#values.delete(key); }
  setItem(key: string, value: string): void { this.writes += 1; this.#values.set(key, value); }
}

const PUBLIC_STORAGE = {
  limitBytes: 1_073_741_824,
  nodeCandidates: [{ availableBytes: 1_073_741_824, deviceName: 'Living room tablet', nodeId: '8dbb2352-c02b-4a4e-a169-f6b5f13fd19c' }],
  reservedBytes: 0,
  usedBytes: 0,
};

const NODE: NodoNode = {
  createdAt: 1_700_000_000,
  deviceName: 'Living room tablet',
  diagnostics: { completedAt: null, requestedAt: null, running: false },
  id: '8dbb2352-c02b-4a4e-a169-f6b5f13fd19c',
  lastSeenAt: 1_720_000_000,
  localAddresses: ['192.168.1.44'],
  metrics: {
    androidSdk: 31,
    appVersion: '0.3.0',
    batteryPercent: 82,
    charging: true,
    coordinatorLatencyMs: 24,
    diskReadBps: null,
    diskWriteBps: null,
    memoryAvailableBytes: null,
    memoryTotalBytes: null,
    networkMetered: false,
    networkDownBps: null,
    networkType: 'wifi',
    networkUpBps: null,
    storageAvailableBytes: 40_000_000_000,
  },
  observedAddress: null,
  online: true,
  policy: { allowDownloads: true, allowUploads: true, chargingOnly: false, ownerOnly: true, wifiOnly: true },
  port: 49_321,
  protocol: 'tus/1.0.0',
  quotaBytes: 30 * 1_073_741_824,
  spaces: {
    private: { quotaBytes: 30 * 1_073_741_824, usedBytes: 0 },
    public: { quotaBytes: 0, usedBytes: 0 },
  },
  usedBytes: 0,
};
