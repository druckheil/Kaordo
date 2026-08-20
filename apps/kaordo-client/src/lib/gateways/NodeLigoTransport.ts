import type {
  LigoAttachment,
  LigoDelivery,
  LigoMessage,
  LigoStorageSettings,
  LigoStorageUpdate,
  LigoUser,
} from '../domain/ligo';
import type { NodoGateway } from './NodoGateway';
import type { LigoGateway } from './LigoGateway';
import { NodeConnection, NodeRequestError, uploadTus } from './NodeFluoGateway';

const PUBLIC_DESTINATION = 'public';
const PATHS = {
  private: { content: '/v1/files', envelopes: '/v1/ligo/envelopes', uploads: '/files' },
  public: {
    content: '/v1/spaces/public/content',
    envelopes: '/v1/spaces/public/ligo/envelopes',
    uploads: '/v1/spaces/public/files',
  },
} as const;

export type LigoDraftFile = { blob: Blob; id: string; mimeType: string; name: string; size: number; url: string };
export type LigoUploadProgress = { file: string; totalBytes: number; uploadedBytes: number };
export type LigoSendResult = {
  message: LigoMessage;
  nodeId?: string;
  space?: 'private' | 'public';
  storage: LigoStorageSettings;
};
export type LigoPreparedMessage = {
  message: LigoMessage;
  pending: LigoMessage | null;
  replacePayload: boolean;
};

export interface LigoTransport {
  complete(delivery: LigoDelivery): Promise<void>;
  discard(evicted: LigoStorageUpdate['evicted']): Promise<void>;
  hydrate(delivery: LigoDelivery, pending: LigoMessage): Promise<LigoMessage>;
  prepare(ownerId: string, delivery: LigoDelivery, cached: LigoMessage | null): Promise<LigoPreparedMessage>;
  reset(): void;
  send(
    messageId: string,
    ownerId: string,
    recipient: LigoUser,
    destination: string,
    body: string,
    files: readonly LigoDraftFile[],
    onProgress: (progress: LigoUploadProgress | null) => void,
  ): Promise<LigoSendResult>;
}

export class NodeLigoTransport implements LigoTransport {
  readonly #connections = new Map<string, Promise<NodeConnection>>();

  constructor(private readonly api: LigoGateway, private readonly nodes: NodoGateway) {}

  reset(): void { this.#connections.clear(); }

  async send(
    messageId: string,
    ownerId: string,
    recipient: LigoUser,
    destination: string,
    body: string,
    files: readonly LigoDraftFile[],
    onProgress: (progress: LigoUploadProgress | null) => void,
  ): Promise<LigoSendResult> {
    const sizeBytes = Math.max(1, new TextEncoder().encode(body).byteLength + files.reduce((sum, file) => sum + file.size, 0));
    if (destination === PUBLIC_DESTINATION) {
      const status = await this.nodes.publicStorage();
      if (status.usedBytes + status.reservedBytes + sizeBytes > status.limitBytes) {
        throw new Error('Your shared 1 GB Public Nodo limit would be exceeded.');
      }
      const candidates = status.nodeCandidates.filter(({ availableBytes }) => availableBytes >= sizeBytes);
      let lastError: unknown = null;
      for (const candidate of candidates) {
        try {
          return await this.sendToNode(ownerId, recipient, messageId, candidate.nodeId, 'public', body, files, sizeBytes, onProgress);
        } catch (error) { lastError = error; this.#connections.delete(candidate.nodeId); }
      }
      throw lastError ?? new Error('No Public Nodo can accept this message right now.');
    }
    return this.sendToNode(ownerId, recipient, messageId, destination, 'private', body, files, sizeBytes, onProgress);
  }

  async prepare(
    ownerId: string,
    delivery: LigoDelivery,
    cached: LigoMessage | null,
  ): Promise<LigoPreparedMessage> {
    const connection = await this.connection(delivery.nodeId);
    const paths = PATHS[delivery.storage];
    let envelope: NodeEnvelope;
    try {
      envelope = await this.envelope(connection, paths.envelopes, delivery.id);
    } catch (error) {
      // Transit copies are expected to disappear after retention cleanup. A
      // valid local copy remains authoritative and must not be deleted.
      if (cached && error instanceof NodeRequestError && error.status === 404) {
        return {
          message: { ...cached, status: newestStatus(cached.status, delivery.status) },
          pending: null,
          replacePayload: false,
        };
      }
      throw error;
    }
    if (cached && matchesEnvelope(cached, envelope)) {
      return {
        message: { ...cached, status: newestStatus(cached.status, delivery.status) },
        pending: null,
        replacePayload: false,
      };
    }
    const pending = messageMetadata(ownerId, delivery, envelope);
    const needsHydration = pending.attachments.length > 0;
    return {
      // Keep a valid local payload visible until changed remote content has
      // finished downloading. New messages use the metadata-only placeholder.
      message: cached && needsHydration
        ? { ...cached, status: newestStatus(cached.status, delivery.status) }
        : pending,
      pending: needsHydration ? pending : null,
      replacePayload: !cached || !needsHydration,
    };
  }

  private envelope(connection: NodeConnection, path: string, messageId: string): Promise<NodeEnvelope> {
    return connection.json<{ envelope: NodeEnvelope }>(`${path}/${encodeURIComponent(messageId)}`)
      .then(({ envelope }) => envelope);
  }

  async hydrate(delivery: LigoDelivery, pending: LigoMessage): Promise<LigoMessage> {
    const connection = await this.connection(delivery.nodeId);
    const contentPath = PATHS[delivery.storage].content;
    const attachments: LigoAttachment[] = [];
    for (const { blob: _blob, ...attachment } of pending.attachments) {
      const blob = await connection.blob(
        `${contentPath}/${encodeURIComponent(attachment.id)}`,
        attachment.mimeType,
        Math.max(60_000, Math.ceil(attachment.size / 64_000) * 1_000),
      );
      attachments.push({ ...attachment, blob });
    }
    return { ...pending, attachments };
  }

  async complete(delivery: LigoDelivery): Promise<void> {
    await this.api.acknowledge(delivery.id);
  }

  async discard(evicted: LigoStorageUpdate['evicted']): Promise<void> {
    const deleted: string[] = [];
    for (const message of evicted) {
      try {
        const connection = await this.connection(message.nodeId);
        await connection.json(
          `${PATHS[message.storage].envelopes}/${encodeURIComponent(message.id)}`,
          { method: 'DELETE' },
        );
        deleted.push(message.id);
      } catch (error) {
        if (error instanceof NodeRequestError && error.status === 404) deleted.push(message.id);
      }
    }
    if (deleted.length) await this.api.confirmCleanup(deleted).catch(() => undefined);
  }

  private async sendToNode(
    ownerId: string,
    recipient: LigoUser,
    id: string,
    nodeId: string,
    storage: 'private' | 'public',
    body: string,
    files: readonly LigoDraftFile[],
    sizeBytes: number,
    onProgress: (progress: LigoUploadProgress | null) => void,
  ): Promise<LigoSendResult> {
    const connection = await this.connection(nodeId);
    const paths = PATHS[storage];
    let reservationId: string | undefined;
    let reservationCommitted = false;
    let envelopeCreated = false;
    const uploaded: LigoAttachment[] = [];
    const totalFileBytes = files.reduce((sum, file) => sum + file.size, 0);
    let completed = 0;
    try {
      if (storage === 'public') reservationId = (await this.nodes.reservePublicStorage(nodeId, sizeBytes)).reservationId;
      for (const file of files) {
        const uploadedId = await uploadTus(connection, paths.uploads, file, (offset) => onProgress({
          file: file.name,
          totalBytes: totalFileBytes,
          uploadedBytes: completed + offset,
        }), reservationId);
        uploaded.push({
          blob: file.blob.slice(0, file.blob.size, file.mimeType),
          id: uploadedId,
          mimeType: file.mimeType,
          name: file.name,
          size: file.size,
        });
        completed += file.size;
      }
      await connection.json(paths.envelopes, {
        body: JSON.stringify({
          attachments: uploaded.map(({ blob: _blob, ...attachment }) => attachment),
          body,
          id,
          recipient: recipient.username.toLowerCase(),
        }),
        headers: { 'content-type': 'application/json', ...reservationHeader(reservationId) },
        method: 'POST',
      });
      envelopeCreated = true;
      if (reservationId) {
        await this.nodes.commitPublicStorage(reservationId, id);
        reservationCommitted = true;
      }
      const update = await this.api.createDelivery({
        id,
        nodeId,
        preview: preview(body, files),
        recipientUsername: recipient.username,
        sizeBytes,
        storage,
      });
      await this.discard(update.evicted);
      onProgress(null);
      return {
        message: {
          attachments: uploaded,
          body,
          conversationId: recipient.id,
          createdAt: Date.now(),
          id,
          recipientId: recipient.id,
          senderId: ownerId,
          status: 'queued',
        },
        nodeId,
        space: storage,
        storage: update.storage,
      };
    } catch (error) {
      if (envelopeCreated) {
        await connection.json(`${paths.envelopes}/${encodeURIComponent(id)}`, { method: 'DELETE' })
          .catch(() => undefined);
      }
      await Promise.allSettled(uploaded.map(({ id: uploadedId }) => connection.fetch(
        `${paths.uploads}/${encodeURIComponent(uploadedId)}`,
        { headers: { 'tus-resumable': '1.0.0', ...reservationHeader(reservationId) }, method: 'DELETE' },
      )));
      if (reservationId) {
        if (reservationCommitted) await this.nodes.releasePublicPost(nodeId, id).catch(() => undefined);
        else await this.nodes.cancelPublicStorage(reservationId).catch(() => undefined);
      }
      onProgress(null);
      throw error;
    }
  }

  private connection(nodeId: string): Promise<NodeConnection> {
    const cached = this.#connections.get(nodeId);
    if (cached) return cached;
    const opened = NodeConnection.open(this.nodes, nodeId);
    this.#connections.set(nodeId, opened);
    opened.catch(() => { if (this.#connections.get(nodeId) === opened) this.#connections.delete(nodeId); });
    return opened;
  }
}

type NodeEnvelope = {
  attachments: Array<Omit<LigoAttachment, 'blob'>>;
  body: string;
  createdAt: number;
  id: string;
  recipient: string;
  sender: string;
};

function messageMetadata(ownerId: string, delivery: LigoDelivery, envelope: NodeEnvelope): LigoMessage {
  return {
    attachments: envelope.attachments.map((attachment) => ({
      ...attachment,
      blob: new Blob([], { type: attachment.mimeType }),
    })),
    body: envelope.body,
    conversationId: delivery.sender.id === ownerId ? delivery.recipient.id : delivery.sender.id,
    createdAt: delivery.createdAt,
    id: envelope.id,
    recipientId: delivery.recipient.id,
    senderId: delivery.sender.id,
    status: delivery.status,
  };
}

function reservationHeader(id?: string): Record<string, string> {
  const name = ['x-veri', 'dimensio-public-reservation'].join('');
  return id ? { [name]: id } : {};
}
function preview(body: string, files: readonly LigoDraftFile[]): string {
  const normalized = body.trim().replace(/\s+/gu, ' ');
  return (normalized || (files.length === 1 ? `File: ${files[0]!.name}` : `${files.length} files`)).slice(0, 160);
}

function matchesEnvelope(message: LigoMessage, envelope: NodeEnvelope): boolean {
  return message.body === envelope.body && message.attachments.length === envelope.attachments.length &&
    message.attachments.every((local, index) => {
      const remote = envelope.attachments[index];
      return remote !== undefined && local.id === remote.id && local.name === remote.name &&
        local.mimeType === remote.mimeType && local.size === remote.size &&
        local.blob instanceof Blob && !isFile(local.blob) && local.blob.size === remote.size;
    });
}

function newestStatus(current: LigoMessage['status'], remote: LigoDelivery['status']): LigoMessage['status'] {
  const rank: Record<LigoMessage['status'], number> = {
    failed: 0, sending: 1, queued: 2, delivered: 3, read: 4,
  };
  return rank[remote] >= rank[current] ? remote : current;
}

function isFile(blob: Blob): boolean {
  return typeof File !== 'undefined' && blob instanceof File;
}

export { PUBLIC_DESTINATION as PUBLIC_LIGO_DESTINATION };
