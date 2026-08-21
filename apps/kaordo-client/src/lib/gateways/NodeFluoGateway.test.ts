import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodoAccess, NodoPolicy } from '../domain/nodo';
import type { FluoDraftAttachment } from '../states/FluoGState';
import type { NodoGateway } from './NodoGateway';
import { NodeFluoGateway } from './NodeFluoGateway';

describe('NodeFluoGateway', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uploads media in tus chunks and writes post metadata directly to the LAN node', async () => {
    const calls: Array<{ body: BodyInit | null | undefined; method: string; url: string }> = [];
    let offset = 0;
    let interrupted = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ body: init?.body, method, url });
      if (url.endsWith('/v1/status')) return json({ status: 'online' });
      if (url.endsWith('/files') && method === 'POST') {
        return new Response(null, {
          headers: { location: '/files/123e4567-e89b-42d3-a456-426614174000' },
          status: 201,
        });
      }
      if (url.includes('/files/') && method === 'PATCH') {
        offset += (init?.body as Blob).size;
        if (!interrupted) {
          interrupted = true;
          throw new DOMException('Connection interrupted', 'AbortError');
        }
        return new Response(null, { headers: { 'upload-offset': String(offset) }, status: 204 });
      }
      if (url.includes('/files/') && method === 'HEAD') {
        return new Response(null, { headers: { 'upload-offset': String(offset) }, status: 200 });
      }
      if (url.endsWith('/v1/fluo/posts') && method === 'POST') return json({ post: {
        attachments: [{
          id: '123e4567-e89b-42d3-a456-426614174000',
          kind: 'video',
          mimeType: 'video/mp4',
          name: 'clip.mp4',
          size: 4 * 1_024 * 1_024 + 1,
          width: 1_920,
          height: 1_080,
        }],
        author: 'Nova_User',
        body: 'From Nodo',
        createdAt: 1_720_000_000_000,
        id: '123e4567-e89b-42d3-a456-426614174001',
      } }, 201);
      throw new Error(`Unexpected request: ${method} ${url}`);
    }));
    const attachment: FluoDraftAttachment = {
      blob: new Blob([new Uint8Array(4 * 1_024 * 1_024 + 1)], { type: 'video/mp4' }),
      id: 'draft-1',
      kind: 'video',
      mimeType: 'video/mp4',
      name: 'clip.mp4',
      size: 4 * 1_024 * 1_024 + 1,
      url: 'blob:preview',
      width: 1_920,
      height: 1_080,
    };

    const progress = vi.fn();
    const post = await new NodeFluoGateway(new AccessGateway()).publishPost(
      NODE_ID,
      'From Nodo',
      [attachment],
      progress,
    );

    expect(calls.filter(({ method }) => method === 'PATCH')).toHaveLength(1);
    expect(calls.filter(({ method }) => method === 'HEAD')).toHaveLength(1);
    expect(calls.every(({ url }) => url.startsWith('http://192.168.1.44:49321/'))).toBe(true);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
      totalBytes: attachment.size,
      uploadedBytes: attachment.size,
    }));
    expect(post.attachments[0]?.blob).toBe(attachment.blob);
    const postCall = calls.find(({ url }) => url.endsWith('/v1/fluo/posts'));
    expect(JSON.parse(String(postCall?.body))).toMatchObject({
      attachments: [{
        height: 1_080,
        kind: 'video',
        mimeType: 'video/mp4',
        name: 'clip.mp4',
        width: 1_920,
      }],
      body: 'From Nodo',
    });
  });

  it('places the default Public Nodo post in a public space and commits its quota reservation', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/v1/status')) return json({ status: 'online' });
      if (url.endsWith('/v1/spaces/public/fluo/posts') && init?.method === 'POST') {
        return json({ post: {
          attachments: [],
          author: 'Nova_User',
          body: 'Shared text',
          createdAt: 1_720_000_000_000,
          id: '123e4567-e89b-42d3-a456-426614174001',
        } }, 201);
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
    }));
    const nodes = new AccessGateway();

    const post = await new NodeFluoGateway(nodes).publishPost('public', 'Shared text', []);

    expect(post).toMatchObject({ nodeId: NODE_ID, space: 'public' });
    expect(calls).toContain('POST http://192.168.1.44:49321/v1/spaces/public/fluo/posts');
    expect(nodes.reservations).toEqual([{ bytes: 11, nodeId: NODE_ID }]);
    expect(nodes.commits).toEqual([{
      postId: '123e4567-e89b-42d3-a456-426614174001',
      reservationId: '123e4567-e89b-42d3-a456-426614174099',
    }]);
  });

  it('returns an authenticated direct stream URL for image attachments', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/status')) return json({ status: 'online' });
      if (url.includes('/v1/fluo/posts?')) return json({ posts: [{
        attachments: [{
          id: '123e4567-e89b-42d3-a456-426614174000',
          kind: 'image',
          mimeType: 'image/png',
          name: 'pixel.png',
          size: 1,
        }],
        author: 'druckheil',
        body: '',
        createdAt: 1_720_000_000_000,
        id: '123e4567-e89b-42d3-a456-426614174001',
      }] });
      throw new Error(`Unexpected request: ${url}`);
    }));

    const nodes = new AccessGateway();
    const gateway = new NodeFluoGateway(nodes);
    const posts = await gateway.listPosts(NODE_ID);
    const media = await gateway.loadMedia(NODE_ID, 'private', posts[0]!.attachments[0]!);

    expect(posts[0]?.attachments[0]?.blob).toBeUndefined();
    expect(media.streamUrl).toContain('/v1/files/123e4567-e89b-42d3-a456-426614174000?');
    expect(media.streamUrl).toContain(`access_token=${'A'.repeat(43)}`);
    expect(nodes.accessCalls).toBe(1);
  });

  it('merges cursor pages without downloading media before it becomes visible', async () => {
    const mediaRequests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/status')) return json({ status: 'online' });
      if (url.includes('/v1/spaces/public/fluo/posts?')) {
        return json({ nextCursor: null, posts: [] });
      }
      if (url.includes('/v1/fluo/posts?')) {
        const cursor = new URL(url).searchParams.get('cursor');
        return cursor === null
          ? json({ nextCursor: '51', posts: [nodePost('new', 30), nodePost('middle', 20)] })
          : json({ nextCursor: null, posts: [nodePost('old', 10)] });
      }
      if (url.includes('/v1/files/')) {
        mediaRequests.push(url);
        return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    const gateway = new NodeFluoGateway(new AccessGateway());

    const first = await gateway.listFeedPage([NODE_ID], null, 2);
    const second = await gateway.listFeedPage([NODE_ID], first.cursor, 2);

    expect(first.posts.map(({ body }) => body)).toEqual(['new', 'middle']);
    expect(second.posts.map(({ body }) => body)).toEqual(['old']);
    expect(second.hasMore).toBe(false);
    expect(mediaRequests).toEqual([]);
  });

  it('returns an authenticated direct stream URL for video without pre-downloading it', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/v1/status')) return json({ status: 'online' });
      throw new Error(`Unexpected request: ${url}`);
    }));

    const source = await new NodeFluoGateway(new AccessGateway()).loadMedia(
      NODE_ID,
      'public',
      {
        id: '123e4567-e89b-42d3-a456-426614174000',
        kind: 'video',
        mimeType: 'video/mp4',
        name: 'large.mp4',
        size: 100 * 1_024 * 1_024,
      },
    );

    expect(source.streamUrl).toContain('/v1/spaces/public/content/123e4567-e89b-42d3-a456-426614174000?');
    expect(source.streamUrl).toContain(`access_token=${'A'.repeat(43)}`);
    expect(calls).toHaveLength(1);
  });

  it('renews an expiring ticket without restarting the post', async () => {
    const gateway = new AccessGateway(true);
    const authorizations: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      authorizations.push(new Headers(init?.headers).get('authorization') ?? '');
      const url = String(input);
      if (url.endsWith('/v1/status')) return json({ status: 'online' });
      if (url.endsWith('/v1/fluo/posts')) return json({ post: {
        attachments: [],
        author: 'druckheil',
        body: 'Long upload finished',
        createdAt: 1_720_000_000_000,
        id: '123e4567-e89b-42d3-a456-426614174001',
      } }, 201);
      throw new Error(`Unexpected request: ${url}`);
    }));

    await new NodeFluoGateway(gateway).publishPost(NODE_ID, 'Long upload finished', []);

    expect(gateway.accessCalls).toBe(2);
    expect(authorizations).toEqual([
      `Bearer ${'A'.repeat(43)}`,
      `Bearer ${'B'.repeat(43)}`,
    ]);
  });

  it('streams large media in one continuous XHR request', async () => {
    const attachmentSize = 16 * 1_024 * 1_024 + 1;
    const patches: number[] = [];
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    vi.stubGlobal('XMLHttpRequest', class {
      upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
      onabort: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      responseText = '';
      status = 204;
      private nextOffset = 0;
      private offset = 0;

      open() {}
      setRequestHeader(name: string, value: string) {
        if (name === 'upload-offset') this.offset = Number(value);
      }
      getResponseHeader(name: string) {
        return name === 'upload-offset' ? String(this.nextOffset) : null;
      }
      send(body: Blob) {
        patches.push(this.offset);
        this.nextOffset = this.offset + body.size;
        this.upload.onprogress?.({ loaded: body.size });
        queueMicrotask(() => this.onload?.());
      }
      abort() {}
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/v1/status')) return json({ status: 'online' });
      if (url.endsWith('/files') && method === 'POST') return new Response(null, {
        headers: { location: '/files/123e4567-e89b-42d3-a456-426614174000' },
        status: 201,
      });
      if (url.endsWith('/v1/fluo/posts') && method === 'POST') return json({ post: {
        attachments: [{
          id: '123e4567-e89b-42d3-a456-426614174000',
          kind: 'video',
          mimeType: 'video/mp4',
          name: 'long.mov',
          size: attachmentSize,
        }],
        author: 'druckheil',
        body: '',
        createdAt: 1_720_000_000_000,
        id: '123e4567-e89b-42d3-a456-426614174001',
      } }, 201);
      throw new Error(`Unexpected request: ${method} ${url}`);
    }));
    const blob = new Blob([new Uint8Array(attachmentSize)], { type: 'video/mp4' });

    await new NodeFluoGateway(new AccessGateway()).publishPost(NODE_ID, '', [{
      blob,
      id: 'draft-long',
      kind: 'video',
      mimeType: 'video/mp4',
      name: 'long.mov',
      size: blob.size,
      url: 'blob:long',
    }]);

    expect(patches).toEqual([0]);
  });

  it('confirms a persisted continuous upload when WebView never delivers the PATCH acknowledgement', async () => {
    vi.useFakeTimers();
    const attachmentSize = 16 * 1_024 * 1_024 + 1;
    let persistedOffset = 0;
    let headCalls = 0;
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    vi.stubGlobal('XMLHttpRequest', class {
      upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
      onabort: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      responseText = '';
      status = 204;
      private offset = 0;

      open() {}
      setRequestHeader(name: string, value: string) {
        if (name === 'upload-offset') this.offset = Number(value);
      }
      getResponseHeader() { return null; }
      send(body: Blob) {
        persistedOffset = this.offset + body.size;
        this.upload.onprogress?.({ loaded: body.size });
        // Deliberately never calls onload: this is the WebView failure mode.
      }
      abort() {}
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/v1/status')) return json({ status: 'online' });
      if (url.endsWith('/files') && method === 'POST') return new Response(null, {
        headers: { location: '/files/123e4567-e89b-42d3-a456-426614174000' },
        status: 201,
      });
      if (url.includes('/files/') && method === 'HEAD') {
        headCalls += 1;
        return new Response(null, {
          headers: { 'upload-offset': String(persistedOffset) },
          status: 200,
        });
      }
      if (url.endsWith('/v1/fluo/posts') && method === 'POST') return json({ post: {
        attachments: [{
          id: '123e4567-e89b-42d3-a456-426614174000',
          kind: 'video',
          mimeType: 'video/mp4',
          name: 'stalled-ack.mov',
          size: attachmentSize,
        }],
        author: 'druckheil',
        body: '',
        createdAt: 1_720_000_000_000,
        id: '123e4567-e89b-42d3-a456-426614174001',
      } }, 201);
      throw new Error(`Unexpected request: ${method} ${url}`);
    }));
    const blob = new Blob([new Uint8Array(attachmentSize)], { type: 'video/mp4' });

    const publishing = new NodeFluoGateway(new AccessGateway()).publishPost(NODE_ID, '', [{
      blob,
      id: 'draft-stalled-ack',
      kind: 'video',
      mimeType: 'video/mp4',
      name: 'stalled-ack.mov',
      size: blob.size,
      url: 'blob:stalled-ack',
    }]);
    await vi.runAllTimersAsync();
    await publishing;

    expect(headCalls).toBe(1);
    expect(persistedOffset).toBe(attachmentSize);
  });

  it('resumes a continuous XHR upload from the exact persisted byte after interruption', async () => {
    vi.useFakeTimers();
    const attachmentSize = 8 * 1_024 * 1_024;
    const interruptedAt = 3 * 1_024 * 1_024;
    const patchOffsets: number[] = [];
    let persistedOffset = 0;
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    vi.stubGlobal('XMLHttpRequest', class {
      upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
      onabort: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      responseText = '';
      status = 204;
      private offset = 0;

      open() {}
      setRequestHeader(name: string, value: string) {
        if (name === 'upload-offset') this.offset = Number(value);
      }
      getResponseHeader(name: string) {
        return name === 'upload-offset' ? String(persistedOffset) : null;
      }
      send(body: Blob) {
        patchOffsets.push(this.offset);
        if (patchOffsets.length === 1) {
          persistedOffset = interruptedAt;
          this.upload.onprogress?.({ loaded: interruptedAt });
          queueMicrotask(() => this.onerror?.());
          return;
        }
        persistedOffset = this.offset + body.size;
        this.upload.onprogress?.({ loaded: body.size });
        queueMicrotask(() => this.onload?.());
      }
      abort() {}
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/v1/status')) return json({ status: 'online' });
      if (url.endsWith('/files') && method === 'POST') return new Response(null, {
        headers: { location: '/files/123e4567-e89b-42d3-a456-426614174000' },
        status: 201,
      });
      if (url.includes('/files/') && method === 'HEAD') return new Response(null, {
        headers: { 'upload-offset': String(persistedOffset) },
        status: 200,
      });
      if (url.endsWith('/v1/fluo/posts') && method === 'POST') return json({ post: {
        attachments: [{
          id: '123e4567-e89b-42d3-a456-426614174000',
          kind: 'video',
          mimeType: 'video/mp4',
          name: 'resumed.mov',
          size: attachmentSize,
        }],
        author: 'druckheil',
        body: '',
        createdAt: 1_720_000_000_000,
        id: '123e4567-e89b-42d3-a456-426614174001',
      } }, 201);
      throw new Error(`Unexpected request: ${method} ${url}`);
    }));
    const blob = new Blob([new Uint8Array(attachmentSize)], { type: 'video/mp4' });

    const publishing = new NodeFluoGateway(new AccessGateway()).publishPost(NODE_ID, '', [{
      blob,
      id: 'draft-resumed',
      kind: 'video',
      mimeType: 'video/mp4',
      name: 'resumed.mov',
      size: blob.size,
      url: 'blob:resumed',
    }]);
    await vi.runAllTimersAsync();
    await publishing;

    expect(patchOffsets).toEqual([0, interruptedAt]);
    expect(persistedOffset).toBe(attachmentSize);
  });
});

class AccessGateway implements NodoGateway {
  accessCalls = 0;
  readonly commits: Array<{ postId: string; reservationId: string }> = [];
  readonly reservations: Array<{ bytes: number; nodeId: string }> = [];
  constructor(private readonly firstTicketExpires = false) {}

  accessNode(): Promise<NodoAccess> {
    this.accessCalls += 1;
    const first = this.accessCalls === 1;
    return Promise.resolve({
      candidates: [
        { address: '203.0.113.10', kind: 'public', port: 49_321 },
        { address: '192.168.1.44', kind: 'lan', port: 49_321 },
      ],
      expiresAt: this.firstTicketExpires && first
        ? Math.floor(Date.now() / 1_000) + 1
        : Math.floor(Date.now() / 1_000) + 600,
      node: null as never,
      ticket: (first ? 'A' : 'B').repeat(43),
    });
  }
  clearStorage() { return Promise.resolve({ deletedBytes: 0, deletedPosts: 0, deletedUploads: 0 }); }
  clearPrivateStorage() { return Promise.resolve({ deletedBytes: 0, deletedPosts: 0, deletedUploads: 0 }); }
  deleteStorageItem() { return Promise.resolve(); }
  cancelPublicStorage() { return Promise.resolve(); }
  commitPublicStorage(reservationId: string, postId: string) {
    this.commits.push({ postId, reservationId });
    return Promise.resolve();
  }
  deleteNode(): Promise<void> { return Promise.resolve(); }
  renameNode(_nodeId: string, name: string): Promise<string> { return Promise.resolve(name); }
  listNodes(): Promise<never[]> { return Promise.resolve([]); }
  listFeedNodeIds(): Promise<string[]> { return Promise.resolve([NODE_ID]); }
  listStorageItems() { return Promise.resolve([]); }
  publicStorage() { return Promise.resolve({
    limitBytes: 1_073_741_824,
    nodeCandidates: [{ availableBytes: 1_073_741_824, deviceName: 'Test Nodo', nodeId: NODE_ID }],
    reservedBytes: 0,
    usedBytes: 0,
  }); }
  releasePublicPost() { return Promise.resolve(); }
  renewPublicStorage(reservationId: string) { return Promise.resolve({
    expiresAt: Math.floor(Date.now() / 1_000) + 600,
    reservationId,
  }); }
  reservePublicStorage(nodeId: string, bytes: number) {
    this.reservations.push({ bytes, nodeId });
    return Promise.resolve({
    expiresAt: Math.floor(Date.now() / 1_000) + 600,
    reservationId: '123e4567-e89b-42d3-a456-426614174099',
    });
  }
  requestQuickTest() { return Promise.resolve({ completedAt: 0, diskReadBps: 1, diskWriteBps: 1 }); }
  refreshUsage() { return Promise.resolve({ spaces: { private: { quotaBytes: 0, usedBytes: 0 }, public: { quotaBytes: 0, usedBytes: 0 } }, usedBytes: 0 }); }
  updatePolicy(_nodeId: string, policy: Omit<NodoPolicy, 'ownerOnly'>): Promise<NodoPolicy> {
    return Promise.resolve({ ...policy, ownerOnly: true });
  }
  updateSpaces() { return Promise.resolve({
    private: { quotaBytes: 1, usedBytes: 0 },
    public: { quotaBytes: 0, usedBytes: 0 },
  }); }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function nodePost(body: string, createdAt: number) {
  return {
    attachments: [{
      id: `123e4567-e89b-42d3-a456-4266141740${createdAt}`,
      kind: 'image',
      mimeType: 'image/png',
      name: `${body}.png`,
      size: 1,
    }],
    author: 'druckheil',
    body,
    createdAt,
    id: `123e4567-e89b-42d3-a456-4266141741${createdAt}`,
  };
}

const NODE_ID = '123e4567-e89b-42d3-a456-426614174010';
