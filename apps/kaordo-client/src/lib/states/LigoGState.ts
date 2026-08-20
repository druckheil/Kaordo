import type {
  LigoConversation,
  LigoConversationDeletion,
  LigoDeletion,
  LigoDelivery,
  LigoMessage,
  LigoMessageStatus,
  LigoReceiptStatus,
  LigoStorageSettings,
  LigoUser,
} from '../domain/ligo';
import type { NodoNode, PublicNodoStorage } from '../domain/nodo';
import type { LigoGateway } from '../gateways/LigoGateway';
import {
  PUBLIC_LIGO_DESTINATION,
  type LigoDraftFile,
  type LigoTransport,
  type LigoUploadProgress,
} from '../gateways/NodeLigoTransport';
import type { LigoLocalStore } from '../services/LigoLocalStore';
import { type LigoFileArchive, UNAVAILABLE_LIGO_FILE_ARCHIVE } from '../services/LigoFileArchive';
import { ligoAttachmentUrls } from '../services/LigoAttachmentUrls';
import { GState } from '../state/GState';

const MESSAGE_PAGE = 40;
const MAX_MESSAGE_WINDOW = 120;
const INBOX_POLL_MIN_MS = 4_000;
const INBOX_POLL_MAX_MS = 30_000;
const LIVE_FALLBACK_POLL_MS = 10 * 60_000;
const LIVE_RECONNECT_MAX_MS = 30_000;
const LIVE_CONNECT_TIMEOUT_MS = 10_000;
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

type LigoLiveSocket = {
  close(code?: number, reason?: string): void;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onopen: ((event: Event) => void) | null;
  readonly readyState: number;
  send(data: string): void;
};

type PendingOutgoing = {
  body: string;
  createdAt: number;
  destination: string;
  files: LigoDraftFile[];
  id: string;
  ownerId: string;
  recipient: LigoUser;
};

type CloudMessageUpdate = {
  delivery: LigoDelivery;
  message: LigoMessage;
  pending: LigoMessage | null;
  replacePayload: boolean;
  verified: boolean;
};
type IncomingHydration = {
  complete: boolean;
  lifecycleId: number;
  ownerId: string;
  update: CloudMessageUpdate;
};

export type LigoScrollPosition = {
  atBottom: boolean;
  messageId: string | null;
  offset: number;
  scrollTop: number;
};

export type LigoSnapshot = {
  activeUser: LigoUser | null;
  attachmentError: string | null;
  conversations: LigoConversation[];
  conversationCursor: string | null;
  draft: string;
  draftFiles: LigoDraftFile[];
  error: string | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadingHistory: boolean;
  loadingMoreConversations: boolean;
  openingLocalFiles: boolean;
  messages: LigoMessage[];
  nodes: NodoNode[];
  phase: 'idle' | 'loading' | 'ready';
  publicStorage: PublicNodoStorage | null;
  searchPhase: 'idle' | 'loading' | 'ready';
  searchQuery: string;
  searchResults: LigoUser[];
  selectedNodeId: string;
  sending: boolean;
  stackLimitBytes: number;
  stackUsedBytes: number;
  storageSaving: boolean;
  syncing: boolean;
  uploadProgress: LigoUploadProgress | null;
};

export class LigoGState extends GState<LigoSnapshot> {
  #ownerId: string | null = null;
  #requestId = 0;
  #lifecycleId = 0;
  #conversationRequestId = 0;
  #searchRequestId = 0;
  #messageCursor: string | null = null;
  #peerCloudCursor: string | null = null;
  #ownCloudCursor: string | null = null;
  #searchTimer: ReturnType<typeof setTimeout> | null = null;
  #pollTimer: ReturnType<typeof setTimeout> | null = null;
  #liveReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #liveConnectTimer: ReturnType<typeof setTimeout> | null = null;
  #livePingTimer: ReturnType<typeof setInterval> | null = null;
  #liveSocket: LigoLiveSocket | null = null;
  #storageRefresh: Promise<void> | null = null;
  readonly #scrollPositions = new Map<string, LigoScrollPosition>();
  readonly #messageHeights = new Map<string, number>();
  #outgoingQueue: PendingOutgoing[] = [];
  #processingOutgoing = false;
  #activeOutgoingPeerId: string | null = null;
  readonly #outgoingPeerWaiters = new Map<string, Array<() => void>>();
  readonly #readInFlight = new Set<string>();
  readonly #deletedMessageIds = new Set<string>();
  readonly #deletingConversationPeers = new Set<string>();
  readonly #archiveSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #incomingHydrations: IncomingHydration[] = [];
  readonly #hydratingDeliveries = new Map<string, IncomingHydration>();
  #activeHydrations = 0;
  #liveGeneration = 0;
  #liveFailures = 0;
  #syncRequested = false;
  #entered = false;
  #emptyPolls = 0;

  constructor(
    private readonly api: LigoGateway,
    private readonly transport: LigoTransport,
    private readonly local: LigoLocalStore,
    private readonly loadNodes: () => Promise<NodoNode[]>,
    private readonly loadPublicStorage: () => Promise<PublicNodoStorage>,
    private readonly openLiveSocket: (url: string) => LigoLiveSocket = (url) => new WebSocket(url),
    private readonly fileArchive: LigoFileArchive = UNAVAILABLE_LIGO_FILE_ARCHIVE,
    private readonly onStorageChanged: ((nodeId: string, space: 'private' | 'public') => void | Promise<void>) | null = null,
  ) { super(emptySnapshot()); }

  configure(ownerId: string | null): void {
    if (ownerId === this.#ownerId) return;
    this.#ownerId = ownerId;
    this.reset();
    if (this.#entered && ownerId) {
      void this.refresh();
      this.startLive();
    }
  }

  override enter(): void {
    this.#entered = true;
    if (!this.#ownerId) return;
    void this.refresh();
    this.startLive();
  }
  override exit(): void {
    this.#entered = false;
    this.stopLive();
    this.stopTimers();
    this.#requestId += 1;
    this.#conversationRequestId += 1;
    this.#searchRequestId += 1;
    this.publish({
      ...this.snapshot,
      loadingHistory: false,
      loadingMoreConversations: false,
      loadingOlder: false,
      searchPhase: 'idle',
    });
  }

  async openLocalFiles(): Promise<void> {
    const ownerId = this.#ownerId;
    const peer = this.snapshot.activeUser;
    if (!ownerId || !peer || !this.fileArchive.available || this.snapshot.openingLocalFiles) return;
    this.publish({ ...this.snapshot, error: null, openingLocalFiles: true });
    try {
      const attachments = await this.local.attachments(ownerId, peer.id);
      if (this.#ownerId !== ownerId) return;
      if (this.snapshot.activeUser?.id !== peer.id) {
        this.publish({ ...this.snapshot, openingLocalFiles: false });
        return;
      }
      await this.fileArchive.open(ownerId, peer, attachments);
      if (this.#ownerId === ownerId) this.publish({ ...this.snapshot, openingLocalFiles: false });
    } catch (error) {
      if (this.#ownerId === ownerId) {
        this.publish({ ...this.snapshot, error: readableError(error), openingLocalFiles: false });
      }
    }
  }

  reset(): void {
    this.snapshot.draftFiles.forEach(({ url }) => URL.revokeObjectURL(url));
    this.stopLive();
    this.stopTimers();
    this.#requestId += 1;
    this.#lifecycleId += 1;
    this.#conversationRequestId += 1;
    this.#searchRequestId += 1;
    this.#emptyPolls = 0;
    this.#syncRequested = false;
    this.#messageCursor = null;
    this.#peerCloudCursor = null;
    this.#ownCloudCursor = null;
    this.#storageRefresh = null;
    this.#scrollPositions.clear();
    this.#messageHeights.clear();
    for (const pending of this.#outgoingQueue.splice(0)) {
      pending.files.forEach(({ url }) => URL.revokeObjectURL(url));
    }
    for (const waiters of this.#outgoingPeerWaiters.values()) waiters.forEach((resolve) => resolve());
    this.#outgoingPeerWaiters.clear();
    this.#readInFlight.clear();
    this.#deletedMessageIds.clear();
    this.#deletingConversationPeers.clear();
    for (const timer of this.#archiveSyncTimers.values()) clearTimeout(timer);
    this.#archiveSyncTimers.clear();
    for (const task of this.#incomingHydrations) {
      const key = `${task.ownerId}:${task.update.delivery.id}`;
      if (this.#hydratingDeliveries.get(key) === task) this.#hydratingDeliveries.delete(key);
    }
    this.#incomingHydrations = [];
    this.transport.reset();
    this.publish(emptySnapshot());
  }

  rememberScroll(userId: string, position: LigoScrollPosition): void {
    if (!userId || !Number.isFinite(position.scrollTop) || !Number.isFinite(position.offset)) return;
    this.#scrollPositions.set(userId, {
      ...position,
      offset: Math.round(position.offset * 100) / 100,
      scrollTop: Math.max(0, position.scrollTop),
    });
  }

  rememberedScroll(userId: string): LigoScrollPosition | null {
    return this.#scrollPositions.get(userId) ?? null;
  }

  rememberMessageHeight(messageId: string, layoutKey: string, height: number): void {
    if (!messageId || !layoutKey || !Number.isFinite(height) || height <= 0) return;
    const key = `${layoutKey}:${messageId}`;
    this.#messageHeights.set(key, Math.max(this.#messageHeights.get(key) ?? 0, height));
  }

  rememberedMessageHeight(messageId: string, layoutKey: string): number | null {
    return this.#messageHeights.get(`${layoutKey}:${messageId}`) ?? null;
  }

  async refresh(): Promise<void> {
    if (!this.#ownerId) return;
    const requestId = ++this.#requestId;
    this.publish({ ...this.snapshot, error: null, phase: 'loading' });
    try {
      const [bootstrap, nodes, publicStorage] = await Promise.all([
        this.api.bootstrap(), this.loadNodes(), this.loadPublicStorage(),
      ]);
      if (requestId !== this.#requestId) return;
      this.publish({
        ...this.snapshot,
        conversations: bootstrap.conversations,
        conversationCursor: bootstrap.nextCursor,
        nodes,
        phase: 'ready',
        publicStorage,
        selectedNodeId: bootstrap.storage.selectedNodeId,
        stackLimitBytes: bootstrap.storage.stackLimitBytes,
        stackUsedBytes: bootstrap.storage.stackUsedBytes,
      });
      this.requestInboxSync();
    } catch (error) {
      if (requestId !== this.#requestId) return;
      this.publish({ ...this.snapshot, error: readableError(error), phase: 'ready' });
      this.schedulePoll();
    }
  }

  async loadMoreConversations(): Promise<void> {
    const cursor = this.snapshot.conversationCursor;
    if (!cursor || this.snapshot.loadingMoreConversations) return;
    const requestId = this.#requestId;
    this.publish({ ...this.snapshot, loadingMoreConversations: true });
    try {
      const page = await this.api.bootstrap(cursor);
      if (requestId !== this.#requestId) return;
      const known = new Set(this.snapshot.conversations.map(({ user }) => user.id));
      this.publish({
        ...this.snapshot,
        conversationCursor: page.nextCursor,
        conversations: [...this.snapshot.conversations, ...page.conversations.filter(({ user }) => !known.has(user.id))],
        loadingMoreConversations: false,
      });
    } catch (error) {
      if (requestId !== this.#requestId) return;
      this.publish({ ...this.snapshot, error: readableError(error), loadingMoreConversations: false });
    }
  }

  setSearch(query: string): void {
    const normalized = query.slice(0, 32);
    if (this.#searchTimer) clearTimeout(this.#searchTimer);
    const requestId = ++this.#searchRequestId;
    this.publish({ ...this.snapshot, searchPhase: normalized.trim() ? 'loading' : 'idle', searchQuery: normalized,
      searchResults: normalized.trim() ? this.snapshot.searchResults : [] });
    if (!normalized.trim()) return;
    const expected = normalized;
    this.#searchTimer = setTimeout(async () => {
      this.#searchTimer = null;
      try {
        const results = await this.api.searchUsers(expected.trim());
        if (requestId !== this.#searchRequestId || this.snapshot.searchQuery !== expected) return;
        this.publish({ ...this.snapshot, searchPhase: 'ready', searchResults: results });
      } catch (error) {
        if (requestId !== this.#searchRequestId || this.snapshot.searchQuery !== expected) return;
        this.publish({ ...this.snapshot, error: readableError(error), searchPhase: 'ready', searchResults: [] });
      }
    }, 350);
  }

  async openConversation(user: LigoUser): Promise<void> {
    if (!this.#ownerId) return;
    this.#deletingConversationPeers.delete(user.id);
    if (this.#searchTimer) clearTimeout(this.#searchTimer);
    this.#searchTimer = null;
    this.#searchRequestId += 1;
    const requestId = ++this.#conversationRequestId;
    const ownerId = this.#ownerId;
    this.#messageCursor = null;
    this.#peerCloudCursor = null;
    this.#ownCloudCursor = null;
    this.publish({
      ...this.snapshot,
      activeUser: user,
      hasOlder: false,
      loadingHistory: true,
      loadingOlder: false,
      messages: [],
      searchPhase: 'idle',
      searchQuery: '',
      searchResults: [],
    });
    try {
      const rememberedMessageId = this.#scrollPositions.get(user.id)?.messageId ?? null;
      let page = await this.local.page(ownerId, user.id, null, MESSAGE_PAGE);
      const messages = [...page.messages];
      while (rememberedMessageId && !messages.some(({ id }) => id === rememberedMessageId) &&
          page.nextCursor && messages.length < MAX_MESSAGE_WINDOW) {
        page = await this.local.page(ownerId, user.id, page.nextCursor, MESSAGE_PAGE);
        messages.push(...page.messages);
      }
      if (requestId !== this.#conversationRequestId || this.snapshot.activeUser?.id !== user.id) return;
      this.#messageCursor = page.nextCursor;
      this.publish({
        ...this.snapshot,
        hasOlder: this.hasOlderMessages(),
        // Local history is displayed first. The small cloud indexes and Nodo
        // envelopes are reconciled in the background without blocking chat.
        loadingHistory: true,
        messages: messages.reverse(),
      });
      this.scheduleArchiveSync(ownerId, user);
      void this.markVisibleRead();
      void this.reconcileConversation(ownerId, user, requestId);
    } catch (error) {
      if (requestId !== this.#conversationRequestId || this.snapshot.activeUser?.id !== user.id) return;
      this.publish({ ...this.snapshot, error: readableError(error), loadingHistory: false });
    }
  }

  async loadOlder(): Promise<void> {
    const ownerId = this.#ownerId;
    const user = this.snapshot.activeUser;
    if (!ownerId || !user || this.snapshot.loadingOlder) return;
    if (!this.#messageCursor && !this.#peerCloudCursor && !this.#ownCloudCursor) return;
    const userId = user.id;
    const requestId = this.#conversationRequestId;
    this.publish({ ...this.snapshot, loadingOlder: true });
    try {
      let cursor = this.#messageCursor;
      if (!cursor) {
        const cloudUpdates: CloudMessageUpdate[] = [];
        if (this.#peerCloudCursor) {
          cloudUpdates.push(...await this.downloadCloudPage(ownerId, user, 'peer', this.#peerCloudCursor));
        }
        if (this.#ownCloudCursor) {
          cloudUpdates.push(...await this.downloadCloudPage(ownerId, user, 'self', this.#ownCloudCursor));
        }
        for (const update of cloudUpdates) {
          if (update.pending) this.enqueueHydration(ownerId, this.#lifecycleId, update, false);
        }
        cursor = this.snapshot.messages[0] ? messageCursor(this.snapshot.messages[0]) : null;
      }
      const page = await this.local.page(ownerId, userId, cursor, MESSAGE_PAGE);
      if (requestId !== this.#conversationRequestId || this.snapshot.activeUser?.id !== userId) return;
      this.#messageCursor = page.nextCursor;
      const combined = [...page.messages].reverse().concat(this.snapshot.messages);
      this.publish({
        ...this.snapshot,
        hasOlder: this.hasOlderMessages(),
        loadingOlder: false,
        messages: combined.slice(0, MAX_MESSAGE_WINDOW),
      });
      void this.markVisibleRead();
    } catch (error) {
      if (requestId !== this.#conversationRequestId) return;
      this.publish({ ...this.snapshot, error: readableError(error), loadingOlder: false });
    }
  }

  async saveStorage(selectedNodeId: string, stackLimitBytes: number): Promise<boolean> {
    if (this.snapshot.storageSaving) return false;
    this.publish({ ...this.snapshot, error: null, storageSaving: true });
    try {
      const update = await this.api.updateStorage(selectedNodeId, stackLimitBytes);
      await this.transport.discard(update.evicted);
      this.applyStorage(update.storage, false);
      void this.refreshStorage();
      return true;
    } catch (error) {
      this.publish({ ...this.snapshot, error: readableError(error), storageSaving: false });
      return false;
    }
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    const ownerId = this.#ownerId;
    const user = this.snapshot.activeUser;
    const message = this.snapshot.messages.find(({ id }) => id === messageId);
    if (!ownerId || !user || !message || message.senderId !== ownerId || message.status === 'sending') return false;
    try {
      if (message.status !== 'failed') {
        const update = await this.api.deleteMessage(messageId, user.username.toLowerCase());
        this.applyStorage(update.storage, false);
        // D1 has already persisted a Nodo tombstone. Direct cleanup is the fast
        // path; heartbeat reconciliation remains the durable fallback.
        await this.transport.discard(update.evicted).catch(() => undefined);
      }
      await this.removeLocalMessage(ownerId, messageId, ownerId);
      void this.refreshStorage();
      return true;
    } catch (error) {
      this.publish({ ...this.snapshot, error: readableError(error) });
      return false;
    }
  }

  async deleteConversation(user: LigoUser): Promise<boolean> {
    const ownerId = this.#ownerId;
    if (!ownerId || !this.snapshot.conversations.some((conversation) => conversation.user.id === user.id)) return false;
    this.#deletingConversationPeers.add(user.id);
    try {
      this.removeQueuedOutgoing(ownerId, user.id);
      await this.waitForOutgoingPeer(user.id);
      const update = await this.api.deleteConversation(user.username.toLowerCase());
      this.applyStorage(update.storage, false);
      await this.transport.discard(update.evicted).catch(() => undefined);
      await this.removeLocalConversation(ownerId, user.id);
      void this.refreshStorage();
      return true;
    } catch (error) {
      this.#deletingConversationPeers.delete(user.id);
      this.publish({ ...this.snapshot, error: readableError(error) });
      return false;
    }
  }

  async refreshStorage(): Promise<void> {
    if (this.#storageRefresh) return this.#storageRefresh;
    const lifecycleId = this.#lifecycleId;
    const refresh = Promise.all([this.loadNodes(), this.loadPublicStorage()])
      .then(([nodes, publicStorage]) => {
        if (lifecycleId !== this.#lifecycleId) return;
        this.publish({ ...this.snapshot, nodes, publicStorage });
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.#storageRefresh === refresh) this.#storageRefresh = null;
      });
    this.#storageRefresh = refresh;
    return refresh;
  }

  setDraft(value: string): void { this.publish({ ...this.snapshot, draft: value.slice(0, 16_000) }); }

  addFiles(files: readonly File[]): void {
    const available = Math.max(0, 12 - this.snapshot.draftFiles.length);
    const selected = files.slice(0, available).map((file) => ({
      blob: file,
      id: crypto.randomUUID(),
      mimeType: file.type || 'application/octet-stream',
      name: file.name.slice(0, 180),
      size: file.size,
      url: URL.createObjectURL(file),
    }));
    this.publish({
      ...this.snapshot,
      attachmentError: files.length > available ? 'A message can contain up to 12 files.' : null,
      draftFiles: [...this.snapshot.draftFiles, ...selected],
    });
  }

  removeFile(id: string): void {
    const file = this.snapshot.draftFiles.find((item) => item.id === id);
    if (file) URL.revokeObjectURL(file.url);
    this.publish({ ...this.snapshot, attachmentError: null, draftFiles: this.snapshot.draftFiles.filter((item) => item.id !== id) });
  }

  async send(): Promise<boolean> {
    const ownerId = this.#ownerId;
    const recipient = this.snapshot.activeUser;
    const body = this.snapshot.draft.trim();
    if (!ownerId || !recipient || (!body && !this.snapshot.draftFiles.length)) return false;
    const files = this.snapshot.draftFiles;
    const sizeBytes = Math.max(1, new TextEncoder().encode(body).byteLength +
      files.reduce((sum, file) => sum + file.size, 0));
    if (sizeBytes > this.snapshot.stackLimitBytes) {
      this.publish({ ...this.snapshot, error: 'This message is larger than your Ligo cloud window.' });
      return false;
    }
    const pending: PendingOutgoing = {
      body,
      createdAt: Date.now(),
      destination: this.snapshot.selectedNodeId,
      files,
      id: crypto.randomUUID(),
      ownerId,
      recipient,
    };
    const message = pendingMessage(pending, 'sending');
    this.#outgoingQueue.push(pending);
    this.publish({
      ...this.snapshot,
      conversations: upsertConversation(
        this.snapshot.conversations,
        toConversation(recipient, message, true, preview(body, files)),
      ),
      draft: '',
      draftFiles: [],
      error: null,
      messages: this.snapshot.activeUser?.id === recipient.id
        ? [...this.snapshot.messages, message].slice(-MAX_MESSAGE_WINDOW)
        : this.snapshot.messages,
      sending: true,
    });
    void this.processOutgoing();
    return true;
  }

  private async processOutgoing(): Promise<void> {
    if (this.#processingOutgoing) return;
    this.#processingOutgoing = true;
    while (this.#outgoingQueue.length) {
      const pending = this.#outgoingQueue.shift()!;
      const lifecycleId = this.#lifecycleId;
      this.#activeOutgoingPeerId = pending.recipient.id;
      try {
        const result = await this.transport.send(
          pending.id,
          pending.ownerId,
          pending.recipient,
          pending.destination,
          pending.body,
          pending.files,
          (uploadProgress) => {
            if (lifecycleId === this.#lifecycleId && this.#ownerId === pending.ownerId) {
              this.publish({ ...this.snapshot, uploadProgress });
            }
          },
        );
        if (this.#deletingConversationPeers.has(pending.recipient.id)) continue;
        const message = { ...result.message, createdAt: pending.createdAt, status: 'queued' as const };
        await this.local.put(pending.ownerId, message);
        this.scheduleArchiveSync(pending.ownerId, pending.recipient);
        if (lifecycleId === this.#lifecycleId && this.#ownerId === pending.ownerId) {
          this.publish({
            ...this.snapshot,
            messages: replaceMessage(this.snapshot.messages, message),
            selectedNodeId: result.storage.selectedNodeId,
            stackLimitBytes: result.storage.stackLimitBytes,
            stackUsedBytes: result.storage.stackUsedBytes,
            uploadProgress: null,
          });
          void this.refreshStorage();
          if (result.nodeId && result.space) void this.onStorageChanged?.(result.nodeId, result.space);
        }
      } catch (error) {
        if (this.#deletingConversationPeers.has(pending.recipient.id)) continue;
        const failed = pendingMessage(pending, 'failed');
        await this.local.put(pending.ownerId, failed).catch(() => undefined);
        this.scheduleArchiveSync(pending.ownerId, pending.recipient);
        if (lifecycleId === this.#lifecycleId && this.#ownerId === pending.ownerId) {
          this.publish({
            ...this.snapshot,
            error: readableError(error),
            messages: replaceMessage(this.snapshot.messages, failed),
            uploadProgress: null,
          });
        }
      } finally {
        pending.files.forEach(({ url }) => URL.revokeObjectURL(url));
        this.finishOutgoingPeer(pending.recipient.id);
      }
    }
    this.#processingOutgoing = false;
    if (this.#ownerId) this.publish({ ...this.snapshot, sending: false, uploadProgress: null });
  }

  private async syncInbox(): Promise<void> {
    if (!this.#ownerId) return;
    if (this.snapshot.syncing) {
      this.#syncRequested = true;
      return;
    }
    const ownerId = this.#ownerId;
    const lifecycleId = this.#lifecycleId;
    this.#syncRequested = false;
    this.publish({ ...this.snapshot, syncing: true });
    try {
      let cursor: string | null = null;
      let deliveryCount = 0;
      do {
        const page = await this.api.inbox(cursor);
        if (lifecycleId !== this.#lifecycleId || this.#ownerId !== ownerId) return;
        if (!cursor && page.conversationDeletions.length) {
          await this.applyConversationDeletions(page.conversationDeletions);
          if (page.conversationDeletions.length === 64) this.#syncRequested = true;
        }
        if (!cursor && page.deletions.length) {
          await this.applyDeletions(page.deletions);
          if (page.deletions.length === 64) this.#syncRequested = true;
        }
        deliveryCount += page.deliveries.length + page.deletions.length + page.conversationDeletions.length;
        const updates = (await Promise.all(page.deliveries.map((delivery) =>
          this.prepareCloudMessage(ownerId, delivery)))).filter((update): update is CloudMessageUpdate => update !== null);
        if (lifecycleId !== this.#lifecycleId || this.#ownerId !== ownerId) return;
        this.publishInboxMetadata(ownerId, updates);
        for (const update of updates) {
          if (update.pending) this.enqueueHydration(ownerId, lifecycleId, update, true);
          else if (update.verified) void this.transport.complete(update.delivery).catch(() => undefined);
        }
        cursor = page.nextCursor;
      } while (cursor && this.#ownerId === ownerId);
      if (lifecycleId !== this.#lifecycleId) return;
      this.#emptyPolls = deliveryCount ? 0 : Math.min(3, this.#emptyPolls + 1);
      this.publish({ ...this.snapshot, syncing: false });
      void this.markVisibleRead();
    } catch (error) {
      if (lifecycleId !== this.#lifecycleId) return;
      this.publish({ ...this.snapshot, error: readableError(error), syncing: false });
    } finally {
      if (lifecycleId === this.#lifecycleId) {
        if (this.#syncRequested) {
          this.#syncRequested = false;
          queueMicrotask(() => { void this.syncInbox(); });
        } else {
          this.schedulePoll();
        }
      }
    }
  }

  private async downloadCloudPage(
    ownerId: string,
    user: LigoUser,
    source: 'peer' | 'self',
    cursor: string | null,
    requestId = this.#conversationRequestId,
  ): Promise<CloudMessageUpdate[]> {
    const updates: CloudMessageUpdate[] = [];
    try {
      const page = await this.api.history(user.username.toLowerCase(), source, cursor, MESSAGE_PAGE);
      if (requestId === this.#conversationRequestId && this.#ownerId === ownerId &&
          this.snapshot.activeUser?.id === user.id) {
        if (source === 'peer') this.#peerCloudCursor = page.nextCursor;
        else this.#ownCloudCursor = page.nextCursor;
      }
      const prepared = await Promise.all(page.messages.map((remote) => this.prepareCloudMessage(ownerId, remote)));
      updates.push(...prepared.filter((update): update is CloudMessageUpdate => update !== null));
    } catch {
      if (requestId === this.#conversationRequestId && this.#ownerId === ownerId &&
          this.snapshot.activeUser?.id === user.id) {
        if (source === 'peer') this.#peerCloudCursor = null;
        else this.#ownCloudCursor = null;
      }
    }
    return updates;
  }

  private async reconcileConversation(ownerId: string, user: LigoUser, requestId: number): Promise<void> {
    const pages = await Promise.all([
      this.downloadCloudPage(ownerId, user, 'peer', null, requestId),
      this.downloadCloudPage(ownerId, user, 'self', null, requestId),
    ]);
    if (requestId !== this.#conversationRequestId || this.#ownerId !== ownerId ||
        this.snapshot.activeUser?.id !== user.id) return;
    try {
      let messages = this.snapshot.messages;
      for (const update of pages.flat()) {
        if (this.#deletedMessageIds.has(update.message.id)) continue;
        const visible = messageForView(messages, update.message, update.replacePayload);
        messages = [...messages.filter(({ id }) => id !== visible.id), visible];
      }
      this.publish({
        ...this.snapshot,
        hasOlder: this.hasOlderMessages(),
        loadingHistory: false,
        messages: [...messages].sort(compareOldest).slice(-MAX_MESSAGE_WINDOW),
      });
      for (const update of pages.flat()) {
        if (update.pending) this.enqueueHydration(ownerId, this.#lifecycleId, update, false);
      }
      void this.markVisibleRead();
    } catch (error) {
      if (requestId !== this.#conversationRequestId || this.snapshot.activeUser?.id !== user.id) return;
      this.publish({ ...this.snapshot, error: readableError(error), loadingHistory: false });
    }
  }

  private async prepareCloudMessage(
    ownerId: string,
    delivery: LigoDelivery,
  ): Promise<CloudMessageUpdate | null> {
    if (this.#deletedMessageIds.has(delivery.id)) return null;
    const cached = await this.local.get(ownerId, delivery.id);
    try {
      const prepared = await this.transport.prepare(ownerId, delivery, cached);
      if (this.#deletedMessageIds.has(delivery.id)) return null;
      if (cached && !prepared.replacePayload) {
        await this.local.updateStatus(ownerId, prepared.message.id, prepared.message.status);
      } else {
        // Persist the light envelope immediately. Attachments use zero-byte
        // placeholders until independent background hydration replaces them.
        await this.local.put(ownerId, prepared.message);
      }
      return {
        delivery,
        message: prepared.message,
        pending: prepared.pending,
        replacePayload: prepared.replacePayload,
        verified: true,
      };
    } catch {
      // A temporarily unavailable Nodo must never hide an existing local copy.
      if (!cached) return null;
      await this.local.updateStatus(ownerId, delivery.id, delivery.status).catch(() => undefined);
      return {
        delivery,
        message: { ...cached, status: advancedStatus(cached.status, delivery.status) },
        pending: null,
        replacePayload: false,
        verified: false,
      };
    }
  }

  private publishInboxMetadata(ownerId: string, updates: readonly CloudMessageUpdate[]): void {
    let conversations = this.snapshot.conversations;
    let messages = this.snapshot.messages;
    for (const update of updates) {
      const { delivery, message, replacePayload } = update;
      if (this.#deletedMessageIds.has(message.id)) continue;
      const peer = delivery.sender.id === ownerId
        ? {
            ...delivery.recipient,
            online: this.snapshot.activeUser?.id === delivery.recipient.id
              ? this.snapshot.activeUser.online
              : this.snapshot.conversations.find(({ user }) => user.id === delivery.recipient.id)?.user.online ?? false,
          }
        : delivery.sender;
      conversations = upsertConversation(
        conversations,
        toConversation(peer, message, delivery.sender.id === ownerId, preview(message.body, message.attachments)),
      );
      if (this.snapshot.activeUser?.id === peer.id) {
        const visible = messageForView(messages, message, replacePayload);
        messages = [...messages.filter(({ id }) => id !== message.id), visible]
          .sort(compareOldest).slice(-MAX_MESSAGE_WINDOW);
      }
    }
    this.publish({ ...this.snapshot, conversations, messages });
  }

  private enqueueHydration(
    ownerId: string,
    lifecycleId: number,
    update: CloudMessageUpdate,
    complete: boolean,
  ): void {
    const key = `${ownerId}:${update.delivery.id}`;
    const existing = this.#hydratingDeliveries.get(key);
    if (existing) {
      // An inbox delivery upgrades a history-only hydration so it is
      // acknowledged as soon as the shared download finishes.
      if (complete) existing.complete = true;
      return;
    }
    const task = { complete, lifecycleId, ownerId, update };
    this.#hydratingDeliveries.set(key, task);
    this.#incomingHydrations.push(task);
    this.drainHydrations();
  }

  private drainHydrations(): void {
    while (this.#activeHydrations < 3) {
      const task = this.#incomingHydrations.shift();
      if (!task) return;
      this.#activeHydrations += 1;
      void this.hydrateMessage(task).finally(() => {
        const key = `${task.ownerId}:${task.update.delivery.id}`;
        if (this.#hydratingDeliveries.get(key) === task) this.#hydratingDeliveries.delete(key);
        this.#activeHydrations -= 1;
        this.drainHydrations();
      });
    }
  }

  private async hydrateMessage(task: IncomingHydration): Promise<void> {
    const { delivery, pending } = task.update;
    if (!pending || this.#deletedMessageIds.has(delivery.id)) return;
    try {
      const message = await this.transport.hydrate(delivery, pending);
      if (this.#deletedMessageIds.has(delivery.id)) return;
      await this.local.put(task.ownerId, message);
      this.scheduleArchiveSync(task.ownerId, this.peerForDelivery(task.ownerId, delivery));
      if (task.lifecycleId === this.#lifecycleId && this.#ownerId === task.ownerId &&
          this.snapshot.activeUser?.id === message.conversationId) {
        this.publish({
          ...this.snapshot,
          messages: replaceMessage(this.snapshot.messages, message),
        });
      }
      if (task.complete && task.lifecycleId === this.#lifecycleId && this.#ownerId === task.ownerId) {
        await this.transport.complete(delivery);
      }
      if (task.lifecycleId === this.#lifecycleId) void this.markVisibleRead();
    } catch {
      // The zero-byte placeholder remains retryable. Other messages and their
      // attachments continue hydrating independently.
    }
  }

  private async markVisibleRead(): Promise<void> {
    const ownerId = this.#ownerId;
    const activeUser = this.snapshot.activeUser;
    if (!ownerId || !activeUser) return;
    const ids = this.snapshot.messages
      .filter((message) => message.senderId === activeUser.id && message.status !== 'read' &&
        messagePayloadReady(message) && !this.#readInFlight.has(message.id))
      .map(({ id }) => id);
    for (let offset = 0; offset < ids.length; offset += 64) {
      const chunk = ids.slice(offset, offset + 64);
      chunk.forEach((id) => this.#readInFlight.add(id));
      try {
        await this.api.markRead(chunk);
        await Promise.all(chunk.map((id) => this.local.updateStatus(ownerId, id, 'read')));
        if (this.#ownerId === ownerId && this.snapshot.activeUser?.id === activeUser.id) {
          this.publish({
            ...this.snapshot,
            messages: updateMessageStatuses(this.snapshot.messages, chunk, 'read'),
          });
        }
      } catch {
        return;
      } finally {
        chunk.forEach((id) => this.#readInFlight.delete(id));
      }
    }
  }

  private async applyReceipts(messageIds: readonly string[], status: LigoReceiptStatus): Promise<void> {
    const ownerId = this.#ownerId;
    if (!ownerId || !messageIds.length) return;
    await Promise.all(messageIds.map((id) => this.local.updateStatus(ownerId, id, status)));
    if (this.#ownerId !== ownerId) return;
    this.publish({
      ...this.snapshot,
      messages: updateMessageStatuses(this.snapshot.messages, messageIds, status),
    });
  }

  private async applyDeletions(deletions: readonly LigoDeletion[]): Promise<void> {
    const ownerId = this.#ownerId;
    if (!ownerId || !deletions.length) return;
    const acknowledged: string[] = [];
    for (const deletion of deletions) {
      try {
        await this.removeLocalMessage(ownerId, deletion.messageId, deletion.senderId);
        acknowledged.push(deletion.messageId);
      } catch {
        // Keep the deletion in D1. The next live sync/poll retries local cleanup.
      }
    }
    if (!acknowledged.length) return;
    if (deletions.some(({ senderId }) => senderId === ownerId)) void this.refreshStorage();
    try {
      await this.api.acknowledgeDeletions(acknowledged);
    } catch {
      // Local cleanup is idempotent; an unacknowledged outbox item is retried.
    }
  }

  private async applyConversationDeletions(deletions: readonly LigoConversationDeletion[]): Promise<void> {
    const ownerId = this.#ownerId;
    if (!ownerId || !deletions.length) return;
    const acknowledged: string[] = [];
    for (const deletion of deletions) {
      try {
        await this.removeLocalConversation(ownerId, deletion.peerId);
        acknowledged.push(deletion.peerUsername.toLowerCase());
      } catch {
        // Keep the D1 outbox item until local IndexedDB cleanup succeeds.
      }
    }
    if (!acknowledged.length) return;
    try {
      await this.api.acknowledgeConversationDeletions(acknowledged);
    } catch {
      // Reapplying a conversation deletion is safe and retries on next sync.
    }
    void this.refreshStorage();
  }

  private async removeLocalConversation(ownerId: string, peerId: string): Promise<void> {
    const peer = this.snapshot.activeUser?.id === peerId
      ? this.snapshot.activeUser
      : this.snapshot.conversations.find(({ user }) => user.id === peerId)?.user ?? null;
    const deleted = await this.local.deleteConversation(ownerId, peerId);
    for (const message of deleted) {
      this.#deletedMessageIds.add(message.id);
      ligoAttachmentUrls.release(message.attachments);
    }
    this.removeQueuedOutgoing(ownerId, peerId);
    this.#scrollPositions.delete(peerId);
    if (peer) this.scheduleArchiveSync(ownerId, peer);
    if (this.#ownerId !== ownerId) return;
    const active = this.snapshot.activeUser?.id === peerId;
    if (active) {
      this.#conversationRequestId += 1;
      this.#messageCursor = null;
      this.#peerCloudCursor = null;
      this.#ownCloudCursor = null;
      this.snapshot.draftFiles.forEach(({ url }) => URL.revokeObjectURL(url));
    }
    this.publish({
      ...this.snapshot,
      activeUser: active ? null : this.snapshot.activeUser,
      conversations: this.snapshot.conversations.filter(({ user }) => user.id !== peerId),
      draft: active ? '' : this.snapshot.draft,
      draftFiles: active ? [] : this.snapshot.draftFiles,
      hasOlder: active ? false : this.snapshot.hasOlder,
      loadingHistory: active ? false : this.snapshot.loadingHistory,
      loadingOlder: active ? false : this.snapshot.loadingOlder,
      messages: active ? [] : this.snapshot.messages,
      uploadProgress: active ? null : this.snapshot.uploadProgress,
    });
  }

  private removeQueuedOutgoing(ownerId: string, peerId: string): void {
    const remaining: PendingOutgoing[] = [];
    for (const pending of this.#outgoingQueue) {
      if (pending.ownerId === ownerId && pending.recipient.id === peerId) {
        pending.files.forEach(({ url }) => URL.revokeObjectURL(url));
      } else {
        remaining.push(pending);
      }
    }
    this.#outgoingQueue = remaining;
  }

  private waitForOutgoingPeer(peerId: string): Promise<void> {
    if (this.#activeOutgoingPeerId !== peerId) return Promise.resolve();
    return new Promise((resolve) => {
      const waiters = this.#outgoingPeerWaiters.get(peerId) ?? [];
      waiters.push(resolve);
      this.#outgoingPeerWaiters.set(peerId, waiters);
    });
  }

  private finishOutgoingPeer(peerId: string): void {
    if (this.#activeOutgoingPeerId === peerId) this.#activeOutgoingPeerId = null;
    const waiters = this.#outgoingPeerWaiters.get(peerId) ?? [];
    this.#outgoingPeerWaiters.delete(peerId);
    waiters.forEach((resolve) => resolve());
  }

  private async removeLocalMessage(ownerId: string, messageId: string, senderId: string): Promise<void> {
    const visible = this.snapshot.messages.find(({ id }) => id === messageId);
    const cached = await this.local.get(ownerId, messageId);
    const message = cached ?? visible ?? null;
    if (message && message.senderId !== senderId) return;
    this.#deletedMessageIds.add(messageId);
    const deleted = await this.local.delete(ownerId, messageId);
    ligoAttachmentUrls.release((deleted ?? visible)?.attachments ?? []);
    const peerId = (deleted ?? message)?.conversationId;
    const peer = peerId === this.snapshot.activeUser?.id
      ? this.snapshot.activeUser
      : this.snapshot.conversations.find(({ user }) => user.id === peerId)?.user ?? null;
    if (peer) this.scheduleArchiveSync(ownerId, peer);
    if (this.#ownerId !== ownerId) return;
    this.publish({
      ...this.snapshot,
      conversations: this.snapshot.conversations.map((conversation) =>
        conversation.lastMessage.id === messageId
          ? { ...conversation, lastMessage: { ...conversation.lastMessage, preview: 'Message deleted' } }
          : conversation),
      messages: this.snapshot.messages.filter(({ id }) => id !== messageId),
    });
  }

  private applyPresence(userId: string, online: boolean): void {
    const update = (user: LigoUser): LigoUser => user.id === userId ? { ...user, online } : user;
    this.publish({
      ...this.snapshot,
      activeUser: this.snapshot.activeUser ? update(this.snapshot.activeUser) : null,
      conversations: this.snapshot.conversations.map((conversation) => ({
        ...conversation,
        user: update(conversation.user),
      })),
      searchResults: this.snapshot.searchResults.map(update),
    });
  }

  private peerForDelivery(ownerId: string, delivery: LigoDelivery): LigoUser {
    if (delivery.sender.id !== ownerId) return delivery.sender;
    const known = this.snapshot.activeUser?.id === delivery.recipient.id
      ? this.snapshot.activeUser
      : this.snapshot.conversations.find(({ user }) => user.id === delivery.recipient.id)?.user;
    return { ...delivery.recipient, online: known?.online ?? false };
  }

  private scheduleArchiveSync(ownerId: string, peer: LigoUser): void {
    if (!this.fileArchive.available) return;
    const key = `${ownerId}:${peer.id}`;
    const previous = this.#archiveSyncTimers.get(key);
    if (previous) clearTimeout(previous);
    this.#archiveSyncTimers.set(key, setTimeout(() => {
      this.#archiveSyncTimers.delete(key);
      if (this.#ownerId !== ownerId) return;
      void this.local.attachments(ownerId, peer.id)
        .then((attachments) => this.fileArchive.sync(ownerId, peer, attachments))
        .catch(() => undefined);
    }, 100));
  }

  private async syncActiveReceipts(): Promise<void> {
    const ownerId = this.#ownerId;
    const user = this.snapshot.activeUser;
    if (!ownerId || !user) return;
    try {
      const page = await this.api.history(user.username.toLowerCase(), 'self', null, MESSAGE_PAGE);
      for (const message of page.messages) {
        await this.local.updateStatus(ownerId, message.id, message.status);
      }
      if (this.#ownerId !== ownerId || this.snapshot.activeUser?.id !== user.id) return;
      const statuses = new Map(page.messages.map(({ id, status }) => [id, status]));
      this.publish({
        ...this.snapshot,
        messages: this.snapshot.messages.map((message) => {
          const status = statuses.get(message.id);
          return status ? { ...message, status: advancedStatus(message.status, status) } : message;
        }),
      });
    } catch {
      // Live receipts remain the primary path; the next reconnect retries history.
    }
  }

  private hasOlderMessages(): boolean {
    return Boolean(this.#messageCursor || this.#peerCloudCursor || this.#ownCloudCursor);
  }

  private applyStorage(storage: LigoStorageSettings, storageSaving: boolean): void {
    this.publish({
      ...this.snapshot,
      selectedNodeId: storage.selectedNodeId,
      stackLimitBytes: storage.stackLimitBytes,
      stackUsedBytes: storage.stackUsedBytes,
      storageSaving,
    });
  }

  private requestInboxSync(): void {
    if (this.snapshot.syncing) {
      this.#syncRequested = true;
      return;
    }
    void this.syncInbox();
  }

  private startLive(): void {
    if (!this.#entered || !this.#ownerId || this.#liveSocket || this.#liveReconnectTimer) return;
    const generation = this.#liveGeneration;
    void this.api.liveTicket().then(({ url }) => {
      if (generation !== this.#liveGeneration || !this.#entered || !this.#ownerId) return;
      const endpoint = new URL(url);
      if (endpoint.protocol !== 'wss:' && endpoint.protocol !== 'ws:') {
        throw new Error('Ligo returned an invalid live endpoint.');
      }
      const socket = this.openLiveSocket(endpoint.toString());
      this.#liveSocket = socket;
      this.#liveConnectTimer = setTimeout(() => {
        if (this.#liveSocket === socket && socket.readyState === SOCKET_CONNECTING) socket.close();
      }, LIVE_CONNECT_TIMEOUT_MS);
      socket.onopen = () => {
        if (generation !== this.#liveGeneration || this.#liveSocket !== socket) return;
        this.clearLiveConnectTimer();
        this.#liveFailures = 0;
        this.#emptyPolls = 0;
        this.startLivePing(socket);
        this.requestInboxSync();
        void this.syncActiveReceipts();
      };
      socket.onmessage = ({ data }) => {
        if (generation !== this.#liveGeneration || this.#liveSocket !== socket) return;
        const signal = liveSignal(data);
        if (!signal) return;
        if (signal.type === 'inbox') this.requestInboxSync();
        else if (signal.type === 'presence') this.applyPresence(signal.userId, signal.online);
        else if (signal.type === 'conversation-deletions') void this.applyConversationDeletions(signal.deletions);
        else if (signal.type === 'deletions') void this.applyDeletions(signal.deletions);
        else void this.applyReceipts(signal.messageIds, signal.status);
      };
      socket.onerror = () => { if (this.#liveSocket === socket) socket.close(); };
      socket.onclose = () => {
        if (generation !== this.#liveGeneration || this.#liveSocket !== socket) return;
        this.clearLiveConnectTimer();
        this.clearLivePingTimer();
        this.#liveSocket = null;
        this.scheduleLiveReconnect();
        this.schedulePoll();
      };
    }).catch(() => {
      if (generation !== this.#liveGeneration) return;
      this.scheduleLiveReconnect();
      this.schedulePoll();
    });
  }

  private scheduleLiveReconnect(): void {
    if (!this.#entered || !this.#ownerId || this.#liveReconnectTimer) return;
    const delay = Math.min(LIVE_RECONNECT_MAX_MS, 1_000 * 2 ** Math.min(5, this.#liveFailures));
    this.#liveFailures += 1;
    this.#liveReconnectTimer = setTimeout(() => {
      this.#liveReconnectTimer = null;
      this.startLive();
    }, delay);
  }

  private stopLive(): void {
    this.#liveGeneration += 1;
    this.#liveFailures = 0;
    this.clearLiveConnectTimer();
    this.clearLivePingTimer();
    if (this.#liveReconnectTimer) clearTimeout(this.#liveReconnectTimer);
    this.#liveReconnectTimer = null;
    const socket = this.#liveSocket;
    this.#liveSocket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close(1000, 'Ligo closed.');
    }
  }

  private clearLiveConnectTimer(): void {
    if (this.#liveConnectTimer) clearTimeout(this.#liveConnectTimer);
    this.#liveConnectTimer = null;
  }

  private startLivePing(socket: LigoLiveSocket): void {
    this.clearLivePingTimer();
    this.#livePingTimer = setInterval(() => {
      if (this.#liveSocket === socket && socket.readyState === SOCKET_OPEN) socket.send('ping');
    }, 25_000);
  }

  private clearLivePingTimer(): void {
    if (this.#livePingTimer) clearInterval(this.#livePingTimer);
    this.#livePingTimer = null;
  }

  private schedulePoll(): void {
    if (!this.#entered || !this.#ownerId) return;
    if (this.#pollTimer) clearTimeout(this.#pollTimer);
    const delay = this.#liveSocket?.readyState === SOCKET_OPEN
      ? LIVE_FALLBACK_POLL_MS
      : Math.min(INBOX_POLL_MAX_MS, INBOX_POLL_MIN_MS * 2 ** this.#emptyPolls);
    this.#pollTimer = setTimeout(() => { void this.syncInbox(); }, delay);
  }

  private stopTimers(): void {
    if (this.#searchTimer) clearTimeout(this.#searchTimer);
    if (this.#pollTimer) clearTimeout(this.#pollTimer);
    if (this.#liveReconnectTimer) clearTimeout(this.#liveReconnectTimer);
    this.clearLiveConnectTimer();
    this.#searchTimer = null;
    this.#pollTimer = null;
    this.#liveReconnectTimer = null;
  }
}

function emptySnapshot(): LigoSnapshot {
  return {
    activeUser: null, attachmentError: null, conversations: [], conversationCursor: null, draft: '', draftFiles: [], error: null,
    hasOlder: false, loadingHistory: false, loadingOlder: false, loadingMoreConversations: false, messages: [], nodes: [], openingLocalFiles: false, phase: 'idle', publicStorage: null,
    searchPhase: 'idle', searchQuery: '', searchResults: [], selectedNodeId: PUBLIC_LIGO_DESTINATION,
    sending: false, stackLimitBytes: 100 * 1_048_576, stackUsedBytes: 0, storageSaving: false,
    syncing: false, uploadProgress: null,
  };
}

function toConversation(user: LigoUser, message: LigoMessage, mine: boolean, text: string): LigoConversation {
  return { lastMessage: { id: message.id, mine, preview: text, sentAt: message.createdAt }, user };
}
function upsertConversation(items: LigoConversation[], next: LigoConversation): LigoConversation[] {
  return [next, ...items.filter(({ user }) => user.id !== next.user.id)]
    .sort((a, b) => b.lastMessage.sentAt - a.lastMessage.sentAt);
}
function preview(body: string, files: readonly { name: string }[]): string {
  return (body.trim().replace(/\s+/gu, ' ') || (files.length === 1 ? `File: ${files[0]!.name}` : `${files.length} files`)).slice(0, 160);
}
function compareOldest(a: LigoMessage, b: LigoMessage): number { return a.createdAt - b.createdAt || a.id.localeCompare(b.id); }
function messageCursor(message: LigoMessage): string { return `${message.createdAt}:${message.id}`; }
function pendingMessage(pending: PendingOutgoing, status: 'sending' | 'failed'): LigoMessage {
  return {
    attachments: pending.files.map(({ url: _url, ...file }) => ({
      ...file,
      blob: file.blob.slice(0, file.blob.size, file.mimeType),
    })),
    body: pending.body,
    conversationId: pending.recipient.id,
    createdAt: pending.createdAt,
    id: pending.id,
    recipientId: pending.recipient.id,
    senderId: pending.ownerId,
    status,
  };
}
function messagePayloadReady(message: LigoMessage): boolean {
  return message.attachments.every((attachment) =>
    attachment.blob instanceof Blob && attachment.blob.size === attachment.size);
}
function messageForView(
  current: readonly LigoMessage[],
  update: LigoMessage,
  replacePayload: boolean,
): LigoMessage {
  const visible = current.find(({ id }) => id === update.id);
  if (!visible || replacePayload) return update;
  return { ...visible, status: advancedStatus(visible.status, update.status) };
}
function replaceMessage(messages: LigoMessage[], replacement: LigoMessage): LigoMessage[] {
  return messages.map((message) => message.id === replacement.id ? replacement : message);
}
function updateMessageStatuses(
  messages: LigoMessage[],
  messageIds: readonly string[],
  status: LigoMessageStatus,
): LigoMessage[] {
  const ids = new Set(messageIds);
  return messages.map((message) => ids.has(message.id)
    ? { ...message, status: advancedStatus(message.status, status) }
    : message);
}
const STATUS_RANK: Record<LigoMessageStatus, number> = {
  failed: 0, sending: 1, queued: 2, delivered: 3, read: 4,
};
function advancedStatus(current: LigoMessageStatus, next: LigoMessageStatus): LigoMessageStatus {
  return STATUS_RANK[next] >= STATUS_RANK[current] ? next : current;
}
type LigoLiveSignal =
  | { deletions: LigoConversationDeletion[]; type: 'conversation-deletions' }
  | { deletions: LigoDeletion[]; type: 'deletions' }
  | { messageId: string; type: 'inbox' }
  | { online: boolean; type: 'presence'; userId: string }
  | { messageIds: string[]; status: LigoReceiptStatus; type: 'receipts' };
function liveSignal(data: unknown): LigoLiveSignal | null {
  if (typeof data !== 'string') return null;
  try {
    const value: unknown = JSON.parse(data);
    if (typeof value !== 'object' || value === null || !('type' in value)) return null;
    if (value.type === 'inbox' && 'messageId' in value && typeof value.messageId === 'string') {
      return { messageId: value.messageId, type: 'inbox' };
    }
    if (value.type === 'presence' && 'userId' in value && typeof value.userId === 'string' &&
        'online' in value && typeof value.online === 'boolean') {
      return { online: value.online, type: 'presence', userId: value.userId };
    }
    if (value.type === 'deletions' && 'deletions' in value && Array.isArray(value.deletions) &&
        value.deletions.every((item) => typeof item === 'object' && item !== null &&
          'messageId' in item && typeof item.messageId === 'string' &&
          'senderId' in item && typeof item.senderId === 'string')) {
      return { deletions: value.deletions as LigoDeletion[], type: 'deletions' };
    }
    if (value.type === 'conversation-deletions' && 'deletions' in value && Array.isArray(value.deletions) &&
        value.deletions.every((item) => typeof item === 'object' && item !== null &&
          'peerId' in item && typeof item.peerId === 'string' &&
          'peerUsername' in item && typeof item.peerUsername === 'string')) {
      return { deletions: value.deletions as LigoConversationDeletion[], type: 'conversation-deletions' };
    }
    if (value.type === 'receipts' && 'messageIds' in value && Array.isArray(value.messageIds) &&
        value.messageIds.every((id) => typeof id === 'string') && 'status' in value &&
        (value.status === 'delivered' || value.status === 'read')) {
      return { messageIds: value.messageIds, status: value.status, type: 'receipts' };
    }
    return null;
  } catch {
    return null;
  }
}
function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' && error.trim() ? error : 'Ligo is unavailable.';
}
