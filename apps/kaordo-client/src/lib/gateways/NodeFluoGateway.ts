import type { NodoAccess } from '../domain/nodo';
import type { FluoAttachment, FluoDraftAttachment } from '../states/FluoGState';
import {
  PUBLIC_FLUO_DESTINATION,
  type FluoFeedPage,
  type FluoGateway,
  type FluoMediaSource,
  type FluoNodeFeedState,
  type FluoSpace,
  type FluoUploadProgress,
  type RemoteFluoPost,
} from './FluoGateway';
import type { NodoGateway } from './NodoGateway';
import { nodoOrigin, orderedNodoCandidates } from './NodoRoute';

const TUS_VERSION = '1.0.0';
const WIRE_CHUNK_LENGTH_HEADER = ['x-veri', 'dimensio-chunk-length'].join('');
const WIRE_PUBLIC_RESERVATION_HEADER = ['x-veri', 'dimensio-public-reservation'].join('');
const PATCH_STALL_TIMEOUT_MS = 15_000;
const PATCH_ACK_TIMEOUT_MS = 1_000;
const FETCH_PATCH_TIMEOUT_MS = 2 * 60_000;
const RECOVERY_TIMEOUT_MS = 5_000;
const MAX_CHUNK_RETRIES = 6;
const RELAY_CHUNK_SIZE = 8 * 1024 * 1024;
const CONNECTION_IDLE_MILLISECONDS = 90 * 60_000;
export type NodoUploadFile = { blob: Blob; mimeType: string; name: string; size: number };
let feedSessionSequence = 0;

const SPACE_PATHS = {
  private: { content: '/v1/files', posts: '/v1/fluo/posts', uploads: '/files' },
  public: {
    content: '/v1/spaces/public/content',
    posts: '/v1/spaces/public/fluo/posts',
    uploads: '/v1/spaces/public/files',
  },
} as const;

export class NodeFluoGateway implements FluoGateway {
  private readonly connections = new Map<string, Promise<NodeConnection>>();
  private feedSession: FeedSession | null = null;

  constructor(private readonly nodes: NodoGateway) {}

  resetSession(): void {
    this.feedSession = null;
    this.connections.clear();
  }

  async listPosts(nodeId: string): Promise<RemoteFluoPost[]> {
    return this.withNode(nodeId, async (connection) => {
      const page = await listSpacePosts(connection, 'private', null, 50);
      return page.posts.map((post) => remotePost(nodeId, 'private', post));
    });
  }

  async listFeedPage(
    nodeIds: readonly string[],
    cursor: string | null,
    limit: number,
  ): Promise<FluoFeedPage> {
    const uniqueNodeIds = [...new Set(nodeIds)];
    if (!uniqueNodeIds.length) return { cursor: null, hasMore: false, posts: [] };
    const key = uniqueNodeIds.slice().sort().join(',');
    if (!cursor || !this.feedSession || this.feedSession.id !== cursor || this.feedSession.key !== key) {
      this.feedSession = await FeedSession.open(
        (nodeId) => this.connection(nodeId),
        uniqueNodeIds,
        key,
      );
    }
    const page = await this.feedSession.next(Math.max(1, Math.min(50, limit)));
    if (!page.hasMore) this.feedSession = null;
    return page;
  }

  async listFeedStates(nodeIds: readonly string[]): Promise<FluoNodeFeedState[]> {
    const uniqueNodeIds = [...new Set(nodeIds)];
    return Promise.all(uniqueNodeIds.map(async (nodeId) => {
      try {
        const state = await this.withNode(nodeId, (connection) =>
          connection.json<NodeFeedStateWire>('/v1/fluo/state'),
        );
        return normalizeFeedState(nodeId, state);
      } catch {
        // Older Nodo builds do not expose the state endpoint yet. A null hash
        // keeps their cached metadata usable while the normal feed remains
        // backward-compatible.
        return emptyFeedState(nodeId);
      }
    }));
  }

  async loadMedia(
    nodeId: string,
    space: FluoSpace,
    attachment: FluoAttachment,
  ): Promise<FluoMediaSource> {
    return this.withNode(nodeId, async (connection) => {
      const path = `${SPACE_PATHS[space].content}/${encodeURIComponent(attachment.id)}`;
      // Let the browser's native media loader request the immutable file.
      // This starts decoding as bytes arrive, supports HTTP range requests,
      // and avoids buffering the entire image into a Blob first.
      return { streamUrl: await connection.streamUrl(path) };
    });
  }

  async publishPost(
    nodeId: string,
    body: string,
    attachments: readonly FluoDraftAttachment[],
    onProgress?: (progress: FluoUploadProgress) => void,
  ): Promise<RemoteFluoPost> {
    if (nodeId === PUBLIC_FLUO_DESTINATION) {
      return this.publishPublic(body, attachments, onProgress);
    }
    return this.withNode(nodeId, (connection) => publishToNode(
      connection,
      nodeId,
      'private',
      body,
      attachments,
      onProgress,
      undefined,
    ), false);
  }

  async deletePost(nodeId: string, postId: string, space: FluoSpace): Promise<void> {
    await this.withNode(nodeId, (connection) => connection.json(
      `${SPACE_PATHS[space].posts}/${encodeURIComponent(postId)}`,
      { method: 'DELETE' },
    ));
    // Nodo 0.14 keeps a durable deletion outbox, so a temporary coordinator
    // outage must not make a successfully deleted post reappear in the UI.
    if (space === 'public') {
      await this.nodes.releasePublicPost(nodeId, postId).catch(() => undefined);
    }
  }

  private async publishPublic(
    body: string,
    attachments: readonly FluoDraftAttachment[],
    onProgress?: (progress: FluoUploadProgress) => void,
  ): Promise<RemoteFluoPost> {
    const bytes = Math.max(1, new TextEncoder().encode(body).byteLength +
      attachments.reduce((total, attachment) => total + attachment.size, 0));
    const status = await this.nodes.publicStorage();
    if (status.usedBytes + status.reservedBytes + bytes > status.limitBytes) {
      throw new Error('Your 1 GB Public Nodo limit would be exceeded.');
    }
    const candidates = status.nodeCandidates.filter(({ availableBytes }) => availableBytes >= bytes);
    if (!candidates.length) throw new Error('No public Nodo currently has enough available space.');
    let lastError: unknown = null;
    for (const candidate of candidates) {
      let reservationId: string | null = null;
      try {
        const connection = await this.connection(candidate.nodeId);
        await connection.validate();
        const reservation = await this.nodes.reservePublicStorage(candidate.nodeId, bytes);
        reservationId = reservation.reservationId;
        const stopRenewing = keepReservationAlive(this.nodes, reservation);
        let post: RemoteFluoPost;
        try {
          post = await publishToNode(
            connection,
            candidate.nodeId,
            'public',
            body,
            attachments,
            onProgress,
            reservationId,
          );
        } finally {
          await stopRenewing();
        }
        try {
          await this.nodes.commitPublicStorage(reservationId, post.id);
        } catch (error) {
          await connection.json(
            `${SPACE_PATHS.public.posts}/${encodeURIComponent(post.id)}`,
            { method: 'DELETE' },
          ).catch(() => undefined);
          throw error;
        }
        return post;
      } catch (error) {
        lastError = error;
        this.connections.delete(candidate.nodeId);
        if (reservationId) await this.nodes.cancelPublicStorage(reservationId).catch(() => undefined);
      }
    }
    throw lastError instanceof Error
      ? new Error(`No public Nodo could accept this post. ${lastError.message}`)
      : new Error('No public Nodo could accept this post.');
  }

  private async withNode<T>(
    nodeId: string,
    operation: (connection: NodeConnection) => Promise<T>,
    retryWithFreshConnection = true,
  ): Promise<T> {
    try {
      const connection = await this.connection(nodeId);
      if (!retryWithFreshConnection) await connection.validate();
      return await operation(connection);
    } catch (error) {
      this.connections.delete(nodeId);
      const canRetry = retryWithFreshConnection &&
        (!(error instanceof NodeRequestError) || error.status === 401 || error.status >= 500);
      if (canRetry) {
        try {
          return await operation(await this.connection(nodeId));
        } catch (retryError) {
          this.connections.delete(nodeId);
          error = retryError;
        }
      }
      throw error instanceof Error
        ? new Error(`The selected Nodo could not be reached. ${error.message}`)
        : new Error('The selected Nodo could not be reached. Keep its host online and use the same network.');
    }
  }

  private async connection(nodeId: string): Promise<NodeConnection> {
    const cached = this.connections.get(nodeId);
    if (cached) {
      const connection = await cached.catch(() => null);
      if (connection?.isReusable()) return connection;
      this.connections.delete(nodeId);
    }
    const opened = NodeConnection.open(this.nodes, nodeId);
    this.connections.set(nodeId, opened);
    try {
      return await opened;
    } catch (error) {
      if (this.connections.get(nodeId) === opened) this.connections.delete(nodeId);
      throw error;
    }
  }
}

function keepReservationAlive(
  nodes: NodoGateway,
  reservation: { expiresAt: number; reservationId: string },
): () => Promise<void> {
  const safetyMilliseconds = 2 * 60_000;
  let expiresAt = reservation.expiresAt;
  let inFlight = Promise.resolve();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (retryMilliseconds?: number) => {
    if (stopped) return;
    const untilRenewal = expiresAt * 1_000 - Date.now() - safetyMilliseconds;
    timer = setTimeout(renew, Math.max(1_000, retryMilliseconds ?? untilRenewal));
  };
  const renew = () => {
    timer = null;
    inFlight = inFlight
      .then(() => nodes.renewPublicStorage(reservation.reservationId))
      .then((renewed) => {
        expiresAt = renewed.expiresAt;
        schedule();
      })
      .catch(() => {
        if (Date.now() < expiresAt * 1_000) schedule(10_000);
      });
  };
  schedule();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await inFlight;
  };
}

async function listSpacePosts(
  connection: NodeConnection,
  space: FluoSpace,
  cursor: string | null,
  limit: number,
): Promise<{ nextCursor: string | null; posts: NodePost[] }> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  const page = await connection.json<{ nextCursor?: string | null; posts: NodePost[] }>(
    `${SPACE_PATHS[space].posts}?${query}`,
  );
  return { nextCursor: page.nextCursor ?? null, posts: page.posts };
}

async function publishToNode(
  connection: NodeConnection,
  nodeId: string,
  space: FluoSpace,
  body: string,
  attachments: readonly FluoDraftAttachment[],
  onProgress?: (progress: FluoUploadProgress) => void,
  reservationId?: string,
): Promise<RemoteFluoPost> {
  const paths = SPACE_PATHS[space];
  const uploaded: Array<FluoAttachment & { blob: Blob }> = [];
  const totalBytes = attachments.reduce((total, attachment) => total + attachment.size, 0);
  let completedBytes = 0;
  try {
    for (const [index, attachment] of attachments.entries()) {
      const report = (offset: number) => onProgress?.({
        attachmentIndex: index + 1,
        attachmentName: attachment.name,
        attachmentTotal: attachments.length,
        totalBytes,
        uploadedBytes: Math.min(totalBytes, completedBytes + offset),
      });
      report(0);
      const id = await uploadTus(connection, paths.uploads, attachment, report, reservationId);
      uploaded.push({
        blob: attachment.blob,
        height: attachment.height,
        id,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        name: attachment.name,
        size: attachment.size,
        width: attachment.width,
      });
      completedBytes += attachment.size;
      report(attachment.size);
    }
    const created = await connection.json<{ post: NodePost }>(paths.posts, {
      body: JSON.stringify({
        attachments: uploaded.map(({ blob: _blob, ...attachment }) => attachment),
        body,
      }),
      headers: {
        'content-type': 'application/json',
        ...publicReservationHeader(reservationId),
      },
      method: 'POST',
    });
    return {
      ...created.post,
      attachments: created.post.attachments.map((attachment) => {
        const source = uploaded.find(({ id }) => id === attachment.id);
        if (!source) throw new Error('Nodo returned unknown post media.');
        return {
          ...attachment,
          blob: source.blob,
          height: attachment.height ?? source.height,
          width: attachment.width ?? source.width,
        };
      }),
      nodeId,
      space,
    };
  } catch (error) {
    await Promise.allSettled(uploaded.map(({ id }) => connection.fetch(
      `${paths.uploads}/${encodeURIComponent(id)}`,
      {
        headers: { 'tus-resumable': TUS_VERSION, ...publicReservationHeader(reservationId) },
        method: 'DELETE',
      },
    )));
    throw error;
  }
}

function remotePost(
  nodeId: string,
  space: FluoSpace,
  post: NodePost,
): RemoteFluoPost {
  return {
    ...post,
    attachments: post.attachments,
    nodeId,
    space,
  };
}

type FeedSource = {
  buffer: NodePost[];
  connection: NodeConnection;
  cursor: string | null;
  exhausted: boolean;
  nodeId: string;
  space: FluoSpace;
};

class FeedSession {
  private constructor(
    readonly id: string,
    readonly key: string,
    private readonly sources: FeedSource[],
  ) {}

  static async open(
    connect: (nodeId: string) => Promise<NodeConnection>,
    nodeIds: string[],
    key: string,
  ): Promise<FeedSession> {
    const opened = await Promise.allSettled(nodeIds.map(async (nodeId) => ({
      connection: await connect(nodeId),
      nodeId,
    })));
    const reachable = opened.filter((result): result is PromiseFulfilledResult<{
      connection: NodeConnection;
      nodeId: string;
    }> => result.status === 'fulfilled').map(({ value }) => value);
    if (!reachable.length) throw new Error('No Fluo Nodo could be reached from this network.');
    return new FeedSession(`feed-${++feedSessionSequence}`, key, reachable.flatMap(({ connection, nodeId }) => [
      { buffer: [], connection, cursor: null, exhausted: false, nodeId, space: 'private' },
      { buffer: [], connection, cursor: null, exhausted: false, nodeId, space: 'public' },
    ]));
  }

  async next(limit: number): Promise<FluoFeedPage> {
    const posts: RemoteFluoPost[] = [];
    while (posts.length < limit) {
      const empty = this.sources.filter(({ buffer, exhausted }) => !buffer.length && !exhausted);
      if (empty.length) await Promise.all(empty.map((source) => this.fill(source, limit)));
      const source = this.sources.reduce<FeedSource | null>((newest, candidate) => {
        const post = candidate.buffer[0];
        if (!post) return newest;
        const current = newest?.buffer[0];
        if (!current || post.createdAt > current.createdAt ||
            (post.createdAt === current.createdAt && post.id > current.id)) return candidate;
        return newest;
      }, null);
      const post = source?.buffer.shift();
      if (!source || !post) break;
      posts.push(remotePost(source.nodeId, source.space, post));
    }
    const hasMore = this.sources.some(({ buffer, exhausted }) => buffer.length > 0 || !exhausted);
    return { cursor: hasMore ? this.id : null, hasMore, posts };
  }

  private async fill(source: FeedSource, limit: number): Promise<void> {
    try {
      const page = await listSpacePosts(source.connection, source.space, source.cursor, limit);
      source.buffer.push(...page.posts);
      source.cursor = page.nextCursor;
      source.exhausted = page.nextCursor === null;
    } catch (error) {
      if (error instanceof NodeRequestError && error.status === 404 && source.space === 'public') {
        source.exhausted = true;
        return;
      }
      // One unavailable space must not block posts from every other Nodo.
      source.exhausted = true;
    }
  }
}

type NodePost = {
  attachments: FluoAttachment[];
  author: string;
  body: string;
  createdAt: number;
  id: string;
};

type NodeFeedStateWire = {
  spaces?: Partial<Record<FluoSpace, { postCount?: number; stateHash?: string }>>;
};

function normalizeFeedState(nodeId: string, value: NodeFeedStateWire): FluoNodeFeedState {
  const spaceState = (space: FluoSpace) => {
    const candidate = value.spaces?.[space];
    return {
      postCount: Number.isSafeInteger(candidate?.postCount) ? Math.max(0, candidate!.postCount!) : 0,
      stateHash: typeof candidate?.stateHash === 'string' && candidate.stateHash.length
        ? candidate.stateHash
        : null,
    };
  };
  return { nodeId, spaces: { private: spaceState('private'), public: spaceState('public') } };
}

function emptyFeedState(nodeId: string): FluoNodeFeedState {
  return {
    nodeId,
    spaces: {
      private: { postCount: 0, stateHash: null },
      public: { postCount: 0, stateHash: null },
    },
  };
}

export class NodeConnection {
  private lastSuccessfulAt = Date.now();
  private refreshPromise: Promise<void> | null = null;
  private validatePromise: Promise<void> | null = null;

  private constructor(
    private readonly nodes: NodoGateway,
    private readonly nodeId: string,
    private access: NodoAccess,
    private origin: string,
    private relay = false,
  ) {}

  static async open(nodes: NodoGateway, nodeId: string): Promise<NodeConnection> {
    const access = await nodes.accessNode(nodeId);
    let lastError: unknown = null;
    const candidates = orderedNodoCandidates(access);
    if (!candidates.length) throw new Error('Nodo access returned no usable routes.');
    for (const candidate of candidates) {
      const origin = nodoOrigin(candidate);
      try {
        await nodeFetch(origin, access.ticket, '/v1/status', {}, 4_000);
        return new NodeConnection(nodes, nodeId, access, origin, candidate.kind === 'relay');
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error('Keep the host online and use the same network.');
  }

  async fetch(path: string, init: RequestInit = {}, timeout = 60_000): Promise<Response> {
    await this.ensureFreshTicket();
    try {
      const response = await nodeFetch(this.origin, this.access.ticket, path, init, timeout);
      this.lastSuccessfulAt = Date.now();
      return response;
    } catch (error) {
      const canRetry = !init.method || init.method === 'GET' || init.method === 'HEAD';
      if (error instanceof NodeRequestError ? error.status !== 401 : !canRetry) throw error;
      await this.refreshTicket();
      const response = await nodeFetch(this.origin, this.access.ticket, path, init, timeout);
      this.lastSuccessfulAt = Date.now();
      return response;
    }
  }

  async json<T = { ok: boolean }>(
    path: string,
    init: RequestInit = {},
    timeout = 15_000,
  ): Promise<T> {
    const response = await this.fetch(path, init, timeout);
    return await response.json().catch(() => null) as T;
  }

  async blob(path: string, mimeType: string, timeout: number): Promise<Blob> {
    const blob = await (await this.fetch(path, {}, timeout)).blob();
    return blob.slice(0, blob.size, mimeType);
  }

  async streamUrl(path: string): Promise<string> {
    await this.validate();
    const query = new URLSearchParams({ access_token: this.access.ticket });
    return `${this.origin}${path}?${query}`;
  }

  async patch(
    path: string,
    body: Blob,
    offset: number,
    onOffset: (offset: number) => void,
    reservationId?: string,
  ): Promise<number> {
    await this.ensureFreshTicket();
    try {
      const nextOffset = await uploadPatch(
        this.origin,
        this.access.ticket,
        path,
        body,
        offset,
        onOffset,
        reservationId,
      );
      this.lastSuccessfulAt = Date.now();
      return nextOffset;
    } catch (error) {
      if (!(error instanceof NodeRequestError) || error.status !== 401) throw error;
      await this.refreshTicket();
      const nextOffset = await uploadPatch(
        this.origin,
        this.access.ticket,
        path,
        body,
        offset,
        onOffset,
        reservationId,
      );
      this.lastSuccessfulAt = Date.now();
      return nextOffset;
    }
  }

  isReusable(): boolean {
    return Date.now() - this.lastSuccessfulAt < CONNECTION_IDLE_MILLISECONDS;
  }

  usesRelay(): boolean {
    return this.relay;
  }

  async validate(): Promise<void> {
    await this.ensureFreshTicket();
    if (Date.now() - this.lastSuccessfulAt < 30_000) return;
    if (this.validatePromise) return this.validatePromise;
    const validation = (async () => {
      try {
        await nodeFetch(this.origin, this.access.ticket, '/v1/status', {}, 4_000);
      } catch {
        await this.refreshTicket();
        await nodeFetch(this.origin, this.access.ticket, '/v1/status', {}, 4_000);
      }
      this.lastSuccessfulAt = Date.now();
    })();
    this.validatePromise = validation;
    try {
      await validation;
    } finally {
      if (this.validatePromise === validation) this.validatePromise = null;
    }
  }

  private async ensureFreshTicket(): Promise<void> {
    if (this.access.expiresAt > Math.floor(Date.now() / 1_000) + 30) return;
    await this.refreshTicket();
  }

  private async refreshTicket(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const access = await this.nodes.accessNode(this.nodeId, { forceRefresh: true });
      const candidates = orderedNodoCandidates(access);
      const current = candidates.find((candidate) => nodoOrigin(candidate) === this.origin);
      const candidate = current ?? candidates[0];
      if (!candidate) throw new Error('Nodo no longer has a reachable route.');
      this.access = access;
      this.origin = nodoOrigin(candidate);
      this.relay = candidate.kind === 'relay';
    })();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }
}

export async function uploadTus(
  connection: NodeConnection,
  uploadsPath: string,
  attachment: NodoUploadFile,
  onOffset: (offset: number) => void,
  reservationId?: string,
): Promise<string> {
  let location: string | null = null;
  try {
    const created = await connection.fetch(uploadsPath, {
      headers: {
        'tus-resumable': TUS_VERSION,
        'upload-length': String(attachment.blob.size),
        'upload-metadata': `filename ${base64(attachment.name)},filetype ${base64(attachment.mimeType)}`,
        ...publicReservationHeader(reservationId),
      },
      method: 'POST',
    });
    location = created.headers.get('location');
    if (!location?.startsWith(`${uploadsPath}/`)) throw new Error('Nodo returned an invalid upload location.');
    let offset = 0;
    let failures = 0;
    while (offset < attachment.blob.size) {
      // Keep direct uploads as one streaming request. Cloudflare's relay has
      // a bounded request body, so use small resumable pieces only when the
      // connection is using that fallback route.
      const chunk = attachment.blob.slice(
        offset,
        connection.usesRelay()
          ? Math.min(attachment.blob.size, offset + RELAY_CHUNK_SIZE)
          : attachment.blob.size,
      );
      try {
        const nextOffset = await connection.patch(location, chunk, offset, onOffset, reservationId);
        if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset > attachment.size) {
          throw new Error('Nodo returned an invalid resumable upload offset.');
        }
        offset = nextOffset;
        failures = 0;
        onOffset(offset);
      } catch (error) {
        failures += 1;
        if (failures > MAX_CHUNK_RETRIES) throw error;
        await pause(failures * 250);
        const head = await connection.fetch(location, {
          headers: { 'tus-resumable': TUS_VERSION, ...publicReservationHeader(reservationId) },
          method: 'HEAD',
        }, RECOVERY_TIMEOUT_MS);
        const recoveredOffset = Number(head.headers.get('upload-offset'));
        if (!Number.isSafeInteger(recoveredOffset) || recoveredOffset < offset ||
            recoveredOffset > attachment.size) {
          throw new Error('Nodo could not resume the interrupted upload.');
        }
        const madeProgress = recoveredOffset > offset;
        offset = recoveredOffset;
        if (madeProgress) failures = 0;
        onOffset(offset);
      }
    }
    return location.slice(uploadsPath.length + 1);
  } catch (error) {
    if (location) await connection.fetch(location, {
      headers: { 'tus-resumable': TUS_VERSION, ...publicReservationHeader(reservationId) },
      method: 'DELETE',
    }).catch(() => undefined);
    throw error;
  }
}

async function uploadPatch(
  origin: string,
  ticket: string,
  path: string,
  body: Blob,
  offset: number,
  onOffset: (offset: number) => void,
  reservationId?: string,
): Promise<number> {
  if (isTauriRuntime() && typeof XMLHttpRequest !== 'undefined') {
    return xhrUploadPatch(origin, ticket, path, body, offset, onOffset, reservationId);
  }
  const response = await nodeFetch(origin, ticket, path, {
    body,
    headers: {
      'content-type': 'application/offset+octet-stream',
      'tus-resumable': TUS_VERSION,
      'upload-offset': String(offset),
      [WIRE_CHUNK_LENGTH_HEADER]: String(body.size),
      ...publicReservationHeader(reservationId),
    },
    method: 'PATCH',
  }, FETCH_PATCH_TIMEOUT_MS);
  const nextOffset = Number(response.headers.get('upload-offset'));
  await response.arrayBuffer();
  return nextOffset;
}

function xhrUploadPatch(
  origin: string,
  ticket: string,
  path: string,
  body: Blob,
  offset: number,
  onOffset: (offset: number) => void,
  reservationId?: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, value?: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) {
        request.abort();
        reject(error);
      } else {
        resolve(value as number);
      }
    };
    const watchForStall = (timeout = PATCH_STALL_TIMEOUT_MS) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish(
        new Error('Nodo stopped responding during upload. Reconnecting…'),
      ), timeout);
    };

    request.open('PATCH', `${origin}${path}`, true);
    request.setRequestHeader('authorization', `Bearer ${ticket}`);
    request.setRequestHeader('content-type', 'application/offset+octet-stream');
    request.setRequestHeader('tus-resumable', TUS_VERSION);
    request.setRequestHeader('upload-offset', String(offset));
    request.setRequestHeader(WIRE_CHUNK_LENGTH_HEADER, String(body.size));
    if (reservationId) request.setRequestHeader(WIRE_PUBLIC_RESERVATION_HEADER, reservationId);
    request.upload.onprogress = (event) => {
      watchForStall(event.loaded >= body.size ? PATCH_ACK_TIMEOUT_MS : PATCH_STALL_TIMEOUT_MS);
      onOffset(offset + Math.min(body.size, event.loaded));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        finish(undefined, Number(request.getResponseHeader('upload-offset')));
        return;
      }
      finish(new NodeRequestError(request.status, xhrErrorMessage(request)));
    };
    request.onerror = () => finish(new Error('Nodo upload connection was interrupted.'));
    request.onabort = () => finish(new Error('Nodo upload connection was aborted.'));
    watchForStall();
    request.send(body);
  });
}

function xhrErrorMessage(request: XMLHttpRequest): string {
  try {
    const value: unknown = JSON.parse(request.responseText);
    if (typeof value === 'object' && value !== null && 'error' in value &&
        typeof value.error === 'string') return value.error;
  } catch {
    // Fall back to the HTTP status below.
  }
  return `Nodo request failed (${request.status}).`;
}

function isTauriRuntime(): boolean {
  return '__TAURI_INTERNALS__' in globalThis;
}

async function nodeFetch(
  origin: string,
  ticket: string,
  path: string,
  init: RequestInit = {},
  timeout = 60_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${ticket}`);
  try {
    const response = await fetch(`${origin}${path}`, {
      ...init,
      cache: 'no-store',
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      const value: unknown = await response.json().catch(() => null);
      const message = typeof value === 'object' && value !== null && 'error' in value &&
        typeof value.error === 'string' ? value.error : `Nodo request failed (${response.status}).`;
      throw new NodeRequestError(response.status, message);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export class NodeRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function publicReservationHeader(reservationId?: string): Record<string, string> {
  return reservationId ? { [WIRE_PUBLIC_RESERVATION_HEADER]: reservationId } : {};
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function base64(value: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}
