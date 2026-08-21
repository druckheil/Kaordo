import { describe, expect, it } from 'vitest';
import type { NodoAccess, NodoNode, NodoPolicy } from '../domain/nodo';
import type { FluoGateway, RemoteFluoPost } from '../gateways/FluoGateway';
import { PUBLIC_FLUO_DESTINATION } from '../gateways/FluoGateway';
import type { NodoGateway } from '../gateways/NodoGateway';
import { FluoGState, type FluoDraftAttachment } from './FluoGState';

describe('FluoGState', () => {
  it('loads the Cloudflare coordination snapshot with one bootstrap request', async () => {
    const nodes = new MemoryNodoGateway();
    const state = new FluoGState(new MemoryFluoGateway(), nodes);

    await state.refreshNodes();

    expect(nodes.bootstrapCalls).toBe(1);
    expect(nodes.individualCalls).toBe(0);
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
    expect(state.snapshot.attachmentError).toBe('A post can contain up to 4 media files.');

    expect(await state.publishPost()).toBe(true);
    expect(state.snapshot.posts[0]?.attachments.map(({ kind }) => kind)).toEqual([
      'image', 'gif', 'video', 'image',
    ]);
    const postId = state.snapshot.posts[0]?.id;
    expect(postId).toBeDefined();
    expect(await state.deletePost(postId!)).toBe(true);
    expect(fluo.posts).toEqual([]);
    expect(state.snapshot.posts).toEqual([]);
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
) {
  return new FluoGState(fluo, new MemoryNodoGateway(), {
    createObjectUrl: () => 'blob:remote',
    revokeObjectUrl: () => undefined,
    ...options,
  });
}

class MemoryFluoGateway implements FluoGateway {
  failure: Error | null = null;
  posts: RemoteFluoPost[] = [];
  feedPageCalls = 0;
  stateHash = 'memory-1';
  readonly publishedOn: string[] = [];

  async listFeedPage(): Promise<{ cursor: null; hasMore: false; posts: RemoteFluoPost[] }> {
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

  loadMedia(): Promise<{ blob: Blob }> { return Promise.resolve({ blob: new Blob(['media']) }); }

  async publishPost(
    nodeId: string,
    body: string,
    attachments: readonly FluoDraftAttachment[],
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
    return Promise.resolve({
      nodeIds: [NODE.id],
      nodes: [NODE],
      publicStorage: PUBLIC_STORAGE,
    });
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
  requestQuickTest() { return Promise.resolve({ completedAt: 0, diskReadBps: 1, diskWriteBps: 1 }); }
  refreshUsage() { return Promise.resolve({ spaces: NODE.spaces, usedBytes: NODE.usedBytes }); }
  updatePolicy(_nodeId: string, policy: Omit<NodoPolicy, 'ownerOnly'>): Promise<NodoPolicy> {
    return Promise.resolve({ ...policy, ownerOnly: true });
  }
  updateSpaces() { return Promise.resolve(NODE.spaces); }
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
