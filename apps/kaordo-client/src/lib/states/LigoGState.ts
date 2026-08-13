import type {
  LigoConversation,
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

type CloudMessageUpdate = { message: LigoMessage; replacePayload: boolean };

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
  #outgoingQueue: PendingOutgoing[] = [];
  #processingOutgoing = false;
  readonly #readInFlight = new Set<string>();
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
    for (const pending of this.#outgoingQueue.splice(0)) {
      pending.files.forEach(({ url }) => URL.revokeObjectURL(url));
    }
    this.#readInFlight.clear();
    this.transport.reset();
    this.publish(emptySnapshot());
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
      searchQuery: '',
      searchResults: [],
    });
    try {
      const page = await this.local.page(ownerId, user.id, null, MESSAGE_PAGE);
      if (requestId !== this.#conversationRequestId || this.snapshot.activeUser?.id !== user.id) return;
      this.#messageCursor = page.nextCursor;
      this.publish({
        ...this.snapshot,
        hasOlder: this.hasOlderMessages(),
        // Local history is displayed first. The small cloud indexes and Nodo
        // envelopes are reconciled in the background without blocking chat.
        loadingHistory: true,
        messages: [...page.messages].reverse(),
      });
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
        if (this.#peerCloudCursor) await this.downloadCloudPage(ownerId, user, 'peer', this.#peerCloudCursor);
        if (this.#ownCloudCursor) await this.downloadCloudPage(ownerId, user, 'self', this.#ownCloudCursor);
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
        const message = { ...result.message, createdAt: pending.createdAt, status: 'queued' as const };
        await this.local.put(pending.ownerId, message);
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
        }
      } catch (error) {
        const failed = pendingMessage(pending, 'failed');
        await this.local.put(pending.ownerId, failed).catch(() => undefined);
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
        deliveryCount += page.deliveries.length;
        for (const delivery of page.deliveries) {
          if (lifecycleId !== this.#lifecycleId || this.#ownerId !== ownerId) return;
          try {
            const cached = await this.local.get(ownerId, delivery.id);
            const message = cached
              ? await this.transport.reconcile(ownerId, delivery, cached)
              : await this.transport.receive(ownerId, delivery);
            const replacePayload = !cached || !sameLocalPayload(cached, message);
            if (!replacePayload) {
              await this.local.updateStatus(ownerId, message.id, message.status);
            } else {
              await this.local.put(ownerId, message);
            }
            const user = delivery.sender;
            const conversation = toConversation(user, message, false, preview(message.body, message.attachments));
            const visibleMessage = messageForView(this.snapshot.messages, message, replacePayload);
            const visible = this.snapshot.activeUser?.id === user.id
              ? [...this.snapshot.messages.filter(({ id }) => id !== message.id), visibleMessage]
                .sort(compareOldest).slice(-MAX_MESSAGE_WINDOW)
              : this.snapshot.messages;
            this.publish({
              ...this.snapshot,
              conversations: upsertConversation(this.snapshot.conversations, conversation),
              messages: visible,
            });
            await this.transport.complete(delivery);
          } catch {
            // Leave this delivery queued. The next poll retries without losing data.
          }
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
      for (const remote of page.messages) {
        const cached = await this.local.get(ownerId, remote.id);
        try {
          const message = cached
            ? await this.transport.reconcile(ownerId, remote, cached)
            : await this.transport.receive(ownerId, remote);
          const replacePayload = !cached || !sameLocalPayload(cached, message);
          if (!replacePayload) {
            await this.local.updateStatus(ownerId, message.id, message.status);
          } else {
            await this.local.put(ownerId, message);
          }
          updates.push({ message, replacePayload });
        } catch {
          // A temporarily unavailable Nodo is not allowed to hide local history.
          if (cached) {
            if (source === 'self') {
              await this.local.updateStatus(ownerId, remote.id, remote.status).catch(() => undefined);
            }
            updates.push({
              message: { ...cached, status: advancedStatus(cached.status, remote.status) },
              replacePayload: false,
            });
          }
        }
      }
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
        const visible = messageForView(messages, update.message, update.replacePayload);
        messages = [...messages.filter(({ id }) => id !== visible.id), visible];
      }
      this.publish({
        ...this.snapshot,
        hasOlder: this.hasOlderMessages(),
        loadingHistory: false,
        messages: [...messages].sort(compareOldest).slice(-MAX_MESSAGE_WINDOW),
      });
      void this.markVisibleRead();
    } catch (error) {
      if (requestId !== this.#conversationRequestId || this.snapshot.activeUser?.id !== user.id) return;
      this.publish({ ...this.snapshot, error: readableError(error), loadingHistory: false });
    }
  }

  private async markVisibleRead(): Promise<void> {
    const ownerId = this.#ownerId;
    const activeUser = this.snapshot.activeUser;
    if (!ownerId || !activeUser) return;
    const ids = this.snapshot.messages
      .filter(({ id, senderId, status }) => senderId === activeUser.id && status !== 'read' && !this.#readInFlight.has(id))
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
    hasOlder: false, loadingHistory: false, loadingOlder: false, loadingMoreConversations: false, messages: [], nodes: [], phase: 'idle', publicStorage: null,
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
function sameLocalPayload(left: LigoMessage, right: LigoMessage): boolean {
  return left.id === right.id && left.body === right.body && left.createdAt === right.createdAt &&
    left.senderId === right.senderId && left.recipientId === right.recipientId &&
    left.attachments.length === right.attachments.length && left.attachments.every((attachment, index) => {
      const next = right.attachments[index];
      return next !== undefined && attachment.id === next.id && attachment.name === next.name &&
        attachment.mimeType === next.mimeType && attachment.size === next.size && attachment.blob === next.blob;
    });
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
