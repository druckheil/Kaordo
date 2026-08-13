import type { LigoConversation, LigoMessage, LigoUser } from '../domain/ligo';
import type { NodoNode, PublicNodoStorage } from '../domain/nodo';
import type { LigoGateway } from '../gateways/LigoGateway';
import {
  NodeLigoTransport,
  PUBLIC_LIGO_DESTINATION,
  type LigoDraftFile,
  type LigoUploadProgress,
} from '../gateways/NodeLigoTransport';
import type { LigoLocalStore } from '../services/LigoLocalStore';
import { GState } from '../state/GState';

const MESSAGE_PAGE = 40;
const MAX_MESSAGE_WINDOW = 120;
const INBOX_POLL_MIN_MS = 4_000;
const INBOX_POLL_MAX_MS = 30_000;

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
  #searchTimer: ReturnType<typeof setTimeout> | null = null;
  #pollTimer: ReturnType<typeof setTimeout> | null = null;
  #entered = false;
  #emptyPolls = 0;

  constructor(
    private readonly api: LigoGateway,
    private readonly transport: NodeLigoTransport,
    private readonly local: LigoLocalStore,
    private readonly loadNodes: () => Promise<NodoNode[]>,
    private readonly loadPublicStorage: () => Promise<PublicNodoStorage>,
  ) { super(emptySnapshot()); }

  configure(ownerId: string | null): void {
    if (ownerId === this.#ownerId) return;
    this.#ownerId = ownerId;
    this.reset();
    if (this.#entered && ownerId) void this.refresh();
  }

  override enter(): void { this.#entered = true; if (this.#ownerId) void this.refresh(); }
  override exit(): void {
    this.#entered = false;
    this.stopTimers();
    this.#requestId += 1;
    this.#conversationRequestId += 1;
    this.#searchRequestId += 1;
    this.publish({
      ...this.snapshot,
      loadingMoreConversations: false,
      loadingOlder: false,
      searchPhase: 'idle',
    });
  }

  reset(): void {
    this.snapshot.draftFiles.forEach(({ url }) => URL.revokeObjectURL(url));
    this.stopTimers();
    this.#requestId += 1;
    this.#lifecycleId += 1;
    this.#conversationRequestId += 1;
    this.#searchRequestId += 1;
    this.#emptyPolls = 0;
    this.#messageCursor = null;
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
      });
      void this.syncInbox();
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
    this.publish({ ...this.snapshot, activeUser: user, hasOlder: false, loadingOlder: false, messages: [], searchQuery: '', searchResults: [] });
    try {
      const page = await this.local.page(ownerId, user.id, null, MESSAGE_PAGE);
      if (requestId !== this.#conversationRequestId || this.snapshot.activeUser?.id !== user.id) return;
      this.#messageCursor = page.nextCursor;
      this.publish({ ...this.snapshot, hasOlder: page.nextCursor !== null, messages: [...page.messages].reverse() });
    } catch (error) {
      if (requestId !== this.#conversationRequestId || this.snapshot.activeUser?.id !== user.id) return;
      this.publish({ ...this.snapshot, error: readableError(error) });
    }
  }

  async loadOlder(): Promise<void> {
    if (!this.#ownerId || !this.snapshot.activeUser || !this.#messageCursor || this.snapshot.loadingOlder) return;
    const userId = this.snapshot.activeUser.id;
    const requestId = this.#conversationRequestId;
    this.publish({ ...this.snapshot, loadingOlder: true });
    try {
      const page = await this.local.page(this.#ownerId, userId, this.#messageCursor, MESSAGE_PAGE);
      if (requestId !== this.#conversationRequestId || this.snapshot.activeUser?.id !== userId) return;
      this.#messageCursor = page.nextCursor;
      const combined = [...page.messages].reverse().concat(this.snapshot.messages);
      this.publish({
        ...this.snapshot,
        hasOlder: page.nextCursor !== null,
        loadingOlder: false,
        messages: combined.slice(0, MAX_MESSAGE_WINDOW),
      });
    } catch (error) {
      if (requestId !== this.#conversationRequestId) return;
      this.publish({ ...this.snapshot, error: readableError(error), loadingOlder: false });
    }
  }

  selectNode(nodeId: string): void { this.publish({ ...this.snapshot, selectedNodeId: nodeId }); }
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
    if (!ownerId || !recipient || (!body && !this.snapshot.draftFiles.length) || this.snapshot.sending) return false;
    const files = this.snapshot.draftFiles;
    const lifecycleId = this.#lifecycleId;
    this.publish({ ...this.snapshot, error: null, sending: true });
    try {
      const message = await this.transport.send(
        ownerId, recipient, this.snapshot.selectedNodeId, body, files,
        (uploadProgress) => {
          if (lifecycleId === this.#lifecycleId) this.publish({ ...this.snapshot, uploadProgress });
        },
      );
      await this.local.put(ownerId, message);
      if (lifecycleId !== this.#lifecycleId || this.#ownerId !== ownerId) return true;
      files.forEach(({ url }) => URL.revokeObjectURL(url));
      const conversation = toConversation(recipient, message, true, preview(body, files));
      const messages = this.snapshot.activeUser?.id === recipient.id
        ? [...this.snapshot.messages, message].slice(-MAX_MESSAGE_WINDOW)
        : this.snapshot.messages;
      this.publish({
        ...this.snapshot,
        conversations: upsertConversation(this.snapshot.conversations, conversation),
        draft: '',
        draftFiles: [],
        messages,
        sending: false,
        uploadProgress: null,
      });
      return true;
    } catch (error) {
      if (lifecycleId !== this.#lifecycleId) return false;
      this.publish({ ...this.snapshot, error: readableError(error), sending: false, uploadProgress: null });
      return false;
    }
  }

  private async syncInbox(): Promise<void> {
    if (!this.#ownerId || this.snapshot.syncing) return;
    const ownerId = this.#ownerId;
    const lifecycleId = this.#lifecycleId;
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
            if (await this.local.has(ownerId, delivery.id)) {
              await this.transport.complete(delivery);
              continue;
            }
            const message = await this.transport.receive(ownerId, delivery);
            await this.local.put(ownerId, message);
            const user: LigoUser = { ...delivery.sender, online: true };
            const conversation = toConversation(user, message, false, preview(message.body, message.attachments));
            const visible = this.snapshot.activeUser?.id === user.id
              ? [...this.snapshot.messages.filter(({ id }) => id !== message.id), message].sort(compareOldest).slice(-MAX_MESSAGE_WINDOW)
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
    } catch (error) {
      if (lifecycleId !== this.#lifecycleId) return;
      this.publish({ ...this.snapshot, error: readableError(error), syncing: false });
    } finally {
      if (lifecycleId === this.#lifecycleId) this.schedulePoll();
    }
  }

  private schedulePoll(): void {
    if (!this.#entered || !this.#ownerId) return;
    if (this.#pollTimer) clearTimeout(this.#pollTimer);
    const delay = Math.min(INBOX_POLL_MAX_MS, INBOX_POLL_MIN_MS * 2 ** this.#emptyPolls);
    this.#pollTimer = setTimeout(() => { void this.syncInbox(); }, delay);
  }

  private stopTimers(): void {
    if (this.#searchTimer) clearTimeout(this.#searchTimer);
    if (this.#pollTimer) clearTimeout(this.#pollTimer);
    this.#searchTimer = null;
    this.#pollTimer = null;
  }
}

function emptySnapshot(): LigoSnapshot {
  return {
    activeUser: null, attachmentError: null, conversations: [], conversationCursor: null, draft: '', draftFiles: [], error: null,
    hasOlder: false, loadingOlder: false, loadingMoreConversations: false, messages: [], nodes: [], phase: 'idle', publicStorage: null,
    searchPhase: 'idle', searchQuery: '', searchResults: [], selectedNodeId: PUBLIC_LIGO_DESTINATION,
    sending: false, syncing: false, uploadProgress: null,
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
function readableError(error: unknown): string { return error instanceof Error ? error.message : 'Ligo is unavailable.'; }
