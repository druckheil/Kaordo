import type {
  CreateRondoSpaceInput,
  RondoMessage,
  RondoPrivateNode,
  RondoSpace,
  RondoSpaceDetail,
} from '../domain/rondo';
import type { MediaPreferences } from '../domain/mediaSettings';
import type { RondoGateway } from '../gateways/RondoGateway';
import type { RondoChatGateway } from '../gateways/NodeRondoChatGateway';
import { GState } from '../state/GState';
import {
  EMPTY_RONDO_VOICE,
  type RondoVoiceSession,
  type RondoVoiceSnapshot,
} from '../services/RondoVoiceSession';

export type RondoView = 'create' | 'empty' | 'join' | 'space';
export type RondoOperation =
  | 'add-node'
  | 'create'
  | 'create-invite'
  | 'create-room'
  | 'delete-room'
  | 'join'
  | 'remove-node'
  | 'reorder-nodes'
  | 'revoke-invite'
  | 'save-general';

export type RondoSnapshot = {
  activeRoomId: string | null;
  activeSpaceId: string | null;
  chatAtLatest: boolean;
  chatCursor: string | null;
  chatError: string | null;
  chatHasMore: boolean;
  chatMessages: RondoMessage[];
  chatPhase: 'idle' | 'loading' | 'ready';
  chatSending: boolean;
  detail: RondoSpaceDetail | null;
  detailPhase: 'idle' | 'loading' | 'ready';
  error: string | null;
  inviteCode: string | null;
  operation: RondoOperation | null;
  phase: 'idle' | 'loading' | 'ready';
  privateNodes: RondoPrivateNode[];
  publicOption: { alreadyCreated: boolean; available: boolean; limitBytes: number };
  roomMode: 'text' | 'voice';
  settingsOpen: boolean;
  spaces: RondoSpace[];
  view: RondoView;
  voice: RondoVoiceSnapshot;
};

const EMPTY_PUBLIC_OPTION = { alreadyCreated: false, available: false, limitBytes: 1_073_741_824 };

export class RondoGState extends GState<RondoSnapshot> {
  readonly #gateway: RondoGateway;
  readonly #chat: RondoChatGateway;
  readonly #voice: RondoVoiceSession;
  #requestId = 0;
  #detailRequestId = 0;
  #chatRequestId = 0;
  #entered = false;
  #lifecycleId = 0;
  #pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(gateway: RondoGateway, chat: RondoChatGateway, voice: RondoVoiceSession) {
    super(emptySnapshot());
    this.#gateway = gateway;
    this.#chat = chat;
    this.#voice = voice;
    this.#voice.subscribe((snapshot) => {
      this.publish({
        ...this.snapshot,
        roomMode: snapshot.phase === 'connected' || snapshot.phase === 'joining'
          ? this.snapshot.roomMode
          : 'text',
        voice: { ...snapshot },
      });
    });
  }

  override enter(): void { this.#entered = true; void this.refresh(); }

  override exit(): void {
    this.#entered = false;
    this.#requestId += 1;
    this.#detailRequestId += 1;
    this.#chatRequestId += 1;
    this.stopPolling();
    void this.#voice.leave();
  }

  reset(): void {
    this.#lifecycleId += 1;
    this.#requestId += 1;
    this.#detailRequestId += 1;
    this.#chatRequestId += 1;
    this.stopPolling();
    this.#chat.reset();
    void this.#voice.leave();
    this.publish(emptySnapshot());
  }

  async refresh(): Promise<void> {
    const requestId = ++this.#requestId;
    this.publish({ ...this.snapshot, error: null, phase: 'loading' });
    try {
      const bootstrap = await this.#gateway.bootstrap();
      if (requestId !== this.#requestId) return;
      const activeExists = bootstrap.spaces.some(({ id }) => id === this.snapshot.activeSpaceId);
      const view = this.snapshot.view === 'create' || this.snapshot.view === 'join'
        ? this.snapshot.view
        : activeExists && this.snapshot.view === 'space'
          ? 'space'
          : 'empty';
      const activeSpaceId = activeExists ? this.snapshot.activeSpaceId : null;
      this.publish({
        ...this.snapshot,
        activeSpaceId,
        detail: activeSpaceId ? this.snapshot.detail : null,
        error: null,
        phase: 'ready',
        privateNodes: bootstrap.privateNodes,
        publicOption: bootstrap.publicOption,
        settingsOpen: activeSpaceId ? this.snapshot.settingsOpen : false,
        spaces: bootstrap.spaces,
        view,
      });
      if (activeSpaceId) await this.loadSpace(activeSpaceId);
    } catch (error) {
      if (requestId !== this.#requestId) return;
      this.publish({ ...this.snapshot, error: readableError(error), phase: 'ready' });
    }
  }

  openCreate(): void {
    if (this.snapshot.operation) return;
    void this.#voice.leave();
    this.publish({ ...this.snapshot, error: null, inviteCode: null, settingsOpen: false, view: 'create' });
  }

  openJoin(): void {
    if (this.snapshot.operation) return;
    void this.#voice.leave();
    this.publish({ ...this.snapshot, error: null, inviteCode: null, settingsOpen: false, view: 'join' });
  }

  closeForm(): void {
    if (this.snapshot.operation) return;
    this.publish({ ...this.snapshot, error: null, view: this.snapshot.activeSpaceId ? 'space' : 'empty' });
  }

  selectSpace(spaceId: string): void {
    if (!this.snapshot.spaces.some(({ id }) => id === spaceId)) return;
    const changed = spaceId !== this.snapshot.activeSpaceId;
    if (changed) void this.#voice.leave();
    this.publish({
      ...this.snapshot,
      activeRoomId: changed ? null : this.snapshot.activeRoomId,
      activeSpaceId: spaceId,
      detail: changed ? null : this.snapshot.detail,
      detailPhase: changed ? 'loading' : this.snapshot.detailPhase,
      error: null,
      inviteCode: null,
      settingsOpen: false,
      view: 'space',
    });
    void this.loadSpace(spaceId);
  }

  selectRoom(roomId: string): void {
    if (!this.snapshot.detail?.rooms.some(({ id }) => id === roomId)) return;
    if (roomId === this.snapshot.activeRoomId && this.snapshot.chatPhase !== 'idle') return;
    void this.#voice.leave();
    this.publish({ ...this.snapshot, activeRoomId: roomId, roomMode: 'text', settingsOpen: false });
    void this.openChat(this.snapshot.activeSpaceId, roomId);
  }

  openSettings(): void {
    if (!this.snapshot.detail) return;
    this.publish({ ...this.snapshot, error: null, settingsOpen: true });
  }

  closeSettings(): void {
    this.publish({ ...this.snapshot, error: null, settingsOpen: false });
  }

  async loadSpace(spaceId = this.snapshot.activeSpaceId): Promise<boolean> {
    if (!spaceId) return false;
    const requestId = ++this.#detailRequestId;
    this.publish({ ...this.snapshot, detailPhase: 'loading', error: null });
    try {
      const { detail } = await this.#gateway.loadSpace(spaceId);
      if (requestId !== this.#detailRequestId || this.snapshot.activeSpaceId !== spaceId) return false;
      const resolvedDetail = this.snapshot.inviteCode && detail.invites[0] && !detail.invites[0].code
        ? {
            ...detail,
            invites: [
              { ...detail.invites[0], code: this.snapshot.inviteCode },
              ...detail.invites.slice(1),
            ],
          }
        : detail;
      const activeRoomId = resolvedDetail.rooms.some(({ id }) => id === this.snapshot.activeRoomId)
        ? this.snapshot.activeRoomId
        : resolvedDetail.rooms[0]?.id ?? null;
      this.publish({
        ...this.snapshot,
        activeRoomId,
        detail: resolvedDetail,
        detailPhase: 'ready',
        error: null,
        spaces: replaceSpace(this.snapshot.spaces, resolvedDetail),
      });
      if (activeRoomId && this.#entered) void this.openChat(spaceId, activeRoomId);
      return true;
    } catch (error) {
      if (requestId !== this.#detailRequestId) return false;
      this.publish({ ...this.snapshot, detailPhase: 'ready', error: readableError(error) });
      return false;
    }
  }

  async createSpace(input: CreateRondoSpaceInput): Promise<boolean> {
    if (this.snapshot.operation) return false;
    this.publish({ ...this.snapshot, error: null, operation: 'create' });
    const lifecycleId = this.#lifecycleId;
    try {
      const created = await this.#gateway.createSpace(input);
      if (lifecycleId !== this.#lifecycleId) return true;
      this.publish({
        ...this.snapshot,
        activeRoomId: null,
        activeSpaceId: created.space.id,
        detail: null,
        detailPhase: 'loading',
        error: null,
        inviteCode: created.inviteCode,
        operation: null,
        publicOption: input.storage === 'public'
          ? { ...this.snapshot.publicOption, alreadyCreated: true, available: false }
          : this.snapshot.publicOption,
        settingsOpen: false,
        spaces: [created.space, ...this.snapshot.spaces.filter(({ id }) => id !== created.space.id)],
        view: 'space',
      });
      await this.loadSpace(created.space.id);
      return true;
    } catch (error) {
      if (lifecycleId !== this.#lifecycleId) return false;
      this.publish({ ...this.snapshot, error: readableError(error), operation: null });
      return false;
    }
  }

  async joinSpace(inviteCode: string): Promise<boolean> {
    if (this.snapshot.operation) return false;
    this.publish({ ...this.snapshot, error: null, operation: 'join' });
    const lifecycleId = this.#lifecycleId;
    try {
      const { space } = await this.#gateway.joinSpace(inviteCode);
      if (lifecycleId !== this.#lifecycleId) return true;
      this.publish({
        ...this.snapshot,
        activeRoomId: null,
        activeSpaceId: space.id,
        detail: null,
        detailPhase: 'loading',
        error: null,
        inviteCode: null,
        operation: null,
        settingsOpen: false,
        spaces: [space, ...this.snapshot.spaces.filter(({ id }) => id !== space.id)],
        view: 'space',
      });
      await this.loadSpace(space.id);
      return true;
    } catch (error) {
      if (lifecycleId !== this.#lifecycleId) return false;
      this.publish({ ...this.snapshot, error: readableError(error), operation: null });
      return false;
    }
  }

  async updateGeneral(name: string, description: string): Promise<boolean> {
    const detail = this.snapshot.detail;
    if (!detail || this.snapshot.operation) return false;
    return this.run('save-general', async (isCurrent) => {
      const { space } = await this.#gateway.updateSpace(detail.id, { description, name });
      if (!isCurrent()) return;
      this.publish({
        ...this.snapshot,
        detail: this.snapshot.detail ? { ...this.snapshot.detail, ...space } : null,
        spaces: replaceSpace(this.snapshot.spaces, space),
      });
    });
  }

  async createInvite(expiresInDays: number, maxUses: number): Promise<boolean> {
    const detail = this.snapshot.detail;
    if (!detail || this.snapshot.operation) return false;
    return this.run('create-invite', async (isCurrent) => {
      const { invite } = await this.#gateway.createInvite(detail.id, { expiresInDays, maxUses });
      if (!isCurrent()) return;
      this.publish({
        ...this.snapshot,
        detail: this.snapshot.detail
          ? { ...this.snapshot.detail, invites: [invite, ...this.snapshot.detail.invites] }
          : null,
      });
    });
  }

  async revokeInvite(inviteId: string): Promise<boolean> {
    const detail = this.snapshot.detail;
    if (!detail || this.snapshot.operation) return false;
    return this.run('revoke-invite', async (isCurrent) => {
      await this.#gateway.revokeInvite(detail.id, inviteId);
      if (!isCurrent()) return;
      this.publish({
        ...this.snapshot,
        detail: this.snapshot.detail
          ? { ...this.snapshot.detail, invites: this.snapshot.detail.invites.filter(({ id }) => id !== inviteId) }
          : null,
      });
    });
  }

  async createRoom(name: string): Promise<boolean> {
    const detail = this.snapshot.detail;
    if (!detail || this.snapshot.operation) return false;
    return this.run('create-room', async (isCurrent) => {
      const { room } = await this.#gateway.createRoom(detail.id, name);
      if (!isCurrent()) return;
      this.publish({
        ...this.snapshot,
        activeRoomId: this.snapshot.activeRoomId ?? room.id,
        detail: this.snapshot.detail
          ? { ...this.snapshot.detail, rooms: [...this.snapshot.detail.rooms, room] }
          : null,
      });
    });
  }

  async deleteRoom(roomId: string): Promise<boolean> {
    const detail = this.snapshot.detail;
    if (!detail || this.snapshot.operation) return false;
    return this.run('delete-room', async (isCurrent) => {
      await this.#gateway.deleteRoom(detail.id, roomId);
      if (!isCurrent()) return;
      const rooms = this.snapshot.detail?.rooms.filter(({ id }) => id !== roomId) ?? [];
      this.publish({
        ...this.snapshot,
        activeRoomId: this.snapshot.activeRoomId === roomId ? rooms[0]?.id ?? null : this.snapshot.activeRoomId,
        detail: this.snapshot.detail ? { ...this.snapshot.detail, rooms } : null,
      });
      const nextRoomId = this.snapshot.activeRoomId;
      if (nextRoomId && this.#entered) void this.openChat(detail.id, nextRoomId);
    });
  }

  async openChat(
    spaceId = this.snapshot.activeSpaceId,
    roomId = this.snapshot.activeRoomId,
  ): Promise<void> {
    if (!spaceId || !roomId) return;
    this.stopPolling();
    const requestId = ++this.#chatRequestId;
    this.publish({
      ...this.snapshot,
      chatAtLatest: true,
      chatCursor: null,
      chatError: null,
      chatHasMore: false,
      chatMessages: [],
      chatPhase: 'loading',
      chatSending: false,
    });
    try {
      const page = await this.#chat.listMessages(spaceId, roomId, null, CHAT_PAGE_SIZE);
      if (!this.isCurrentChat(requestId, spaceId, roomId)) return;
      this.publish({
        ...this.snapshot,
        chatCursor: page.nextCursor,
        chatHasMore: page.nextCursor !== null,
        chatMessages: [...page.messages].reverse(),
        chatPhase: 'ready',
      });
      this.schedulePolling();
      if (this.#entered) void this.#voice.preview(spaceId, roomId);
    } catch (error) {
      if (!this.isCurrentChat(requestId, spaceId, roomId)) return;
      this.publish({
        ...this.snapshot,
        chatError: readableError(error),
        chatPhase: 'ready',
      });
    }
  }

  async loadOlderMessages(): Promise<void> {
    const { activeRoomId, activeSpaceId, chatCursor, chatHasMore, chatPhase } = this.snapshot;
    if (!activeRoomId || !activeSpaceId || !chatCursor || !chatHasMore || chatPhase === 'loading') return;
    const requestId = this.#chatRequestId;
    this.publish({ ...this.snapshot, chatError: null, chatPhase: 'loading' });
    try {
      const page = await this.#chat.listMessages(activeSpaceId, activeRoomId, chatCursor, CHAT_PAGE_SIZE);
      if (!this.isCurrentChat(requestId, activeSpaceId, activeRoomId)) return;
      const combined = deduplicateMessages([
        ...[...page.messages].reverse(),
        ...this.snapshot.chatMessages,
      ]);
      const overflow = Math.max(0, combined.length - MAX_CHAT_WINDOW);
      this.publish({
        ...this.snapshot,
        chatAtLatest: overflow === 0 && this.snapshot.chatAtLatest,
        chatCursor: page.nextCursor,
        chatHasMore: page.nextCursor !== null,
        chatMessages: overflow ? combined.slice(0, -overflow) : combined,
        chatPhase: 'ready',
      });
    } catch (error) {
      if (!this.isCurrentChat(requestId, activeSpaceId, activeRoomId)) return;
      this.publish({ ...this.snapshot, chatError: readableError(error), chatPhase: 'ready' });
    }
  }

  async sendMessage(body: string): Promise<boolean> {
    const { activeRoomId, activeSpaceId } = this.snapshot;
    const normalized = body.trim();
    if (!activeRoomId || !activeSpaceId || !normalized || normalized.length > 4_000 ||
        this.snapshot.chatSending) return false;
    this.publish({ ...this.snapshot, chatError: null, chatSending: true });
    const requestId = this.#chatRequestId;
    try {
      const message = await this.#chat.createMessage(activeSpaceId, activeRoomId, normalized);
      if (!this.isCurrentChat(requestId, activeSpaceId, activeRoomId)) return true;
      if (!this.snapshot.chatAtLatest) {
        await this.openChat(activeSpaceId, activeRoomId);
        return true;
      }
      this.publish({
        ...this.snapshot,
        chatMessages: [...this.snapshot.chatMessages, message].slice(-MAX_CHAT_WINDOW),
        chatSending: false,
      });
      return true;
    } catch (error) {
      if (!this.isCurrentChat(requestId, activeSpaceId, activeRoomId)) return false;
      this.publish({ ...this.snapshot, chatError: readableError(error), chatSending: false });
      return false;
    }
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    const { activeRoomId, activeSpaceId } = this.snapshot;
    if (!activeRoomId || !activeSpaceId) return false;
    const requestId = this.#chatRequestId;
    try {
      await this.#chat.deleteMessage(activeSpaceId, activeRoomId, messageId);
      if (!this.isCurrentChat(requestId, activeSpaceId, activeRoomId)) return true;
      this.publish({
        ...this.snapshot,
        chatError: null,
        chatMessages: this.snapshot.chatMessages.filter(({ id }) => id !== messageId),
      });
      return true;
    } catch (error) {
      if (!this.isCurrentChat(requestId, activeSpaceId, activeRoomId)) return false;
      this.publish({ ...this.snapshot, chatError: readableError(error) });
      return false;
    }
  }

  async joinVoice(): Promise<boolean> {
    const { activeRoomId, activeSpaceId } = this.snapshot;
    if (!activeRoomId || !activeSpaceId) return false;
    const lifecycleId = this.#lifecycleId;
    this.publish({ ...this.snapshot, roomMode: 'voice' });
    const joined = await this.#voice.join(activeSpaceId, activeRoomId);
    if (!joined && lifecycleId === this.#lifecycleId &&
        this.snapshot.activeSpaceId === activeSpaceId && this.snapshot.activeRoomId === activeRoomId) {
      this.publish({ ...this.snapshot, roomMode: 'text' });
    }
    return joined;
  }

  async leaveVoice(): Promise<void> {
    const { activeRoomId, activeSpaceId } = this.snapshot;
    const lifecycleId = this.#lifecycleId;
    this.publish({ ...this.snapshot, roomMode: 'text' });
    await this.#voice.leave();
    if (lifecycleId === this.#lifecycleId && activeSpaceId && activeRoomId &&
        this.snapshot.activeSpaceId === activeSpaceId && this.snapshot.activeRoomId === activeRoomId) {
      void this.#voice.preview(activeSpaceId, activeRoomId);
    }
  }

  setRoomMode(mode: 'text' | 'voice'): void {
    if (mode === 'voice' && this.snapshot.voice.phase !== 'connected') return;
    this.publish({ ...this.snapshot, roomMode: mode });
  }

  toggleMute(): void { this.#voice.toggleMute(); }
  toggleDeafen(): void { this.#voice.toggleDeafen(); }
  async toggleCamera(): Promise<void> { await this.#voice.toggleCamera(); }
  async toggleScreen(): Promise<void> { await this.#voice.toggleScreen(); }
  async configureMedia(preferences: MediaPreferences): Promise<void> {
    await this.#voice.configure(preferences);
  }

  private async refreshLatestMessages(): Promise<void> {
    const { activeRoomId, activeSpaceId, chatAtLatest } = this.snapshot;
    if (!activeRoomId || !activeSpaceId || !chatAtLatest || this.snapshot.chatSending) return;
    const requestId = this.#chatRequestId;
    try {
      const page = await this.#chat.listMessages(activeSpaceId, activeRoomId, null, CHAT_PAGE_SIZE);
      if (!this.isCurrentChat(requestId, activeSpaceId, activeRoomId) || !this.snapshot.chatAtLatest) return;
      const latest = [...page.messages].reverse();
      this.publish({
        ...this.snapshot,
        chatCursor: this.snapshot.chatMessages.length > CHAT_PAGE_SIZE
          ? this.snapshot.chatCursor
          : page.nextCursor,
        chatHasMore: this.snapshot.chatMessages.length > CHAT_PAGE_SIZE
          ? this.snapshot.chatHasMore
          : page.nextCursor !== null,
        chatMessages: deduplicateMessages([...this.snapshot.chatMessages, ...latest]).slice(-MAX_CHAT_WINDOW),
      });
    } catch {
      // Polling is best effort. A visible manual action will surface errors.
    }
  }

  private isCurrentChat(requestId: number, spaceId: string, roomId: string): boolean {
    return requestId === this.#chatRequestId &&
      this.snapshot.activeSpaceId === spaceId && this.snapshot.activeRoomId === roomId;
  }

  private schedulePolling(): void {
    this.stopPolling();
    if (!this.#entered) return;
    this.#pollTimer = setTimeout(async () => {
      this.#pollTimer = null;
      await this.refreshLatestMessages();
      if (this.#entered && this.snapshot.chatAtLatest) this.schedulePolling();
    }, CHAT_POLL_MILLISECONDS);
  }

  private stopPolling(): void {
    if (this.#pollTimer) clearTimeout(this.#pollTimer);
    this.#pollTimer = null;
  }

  async addNode(input: { nodeId?: string; storage: 'private' | 'public' }): Promise<boolean> {
    const detail = this.snapshot.detail;
    if (!detail || this.snapshot.operation) return false;
    return this.run('add-node', async (isCurrent) => {
      const { node } = await this.#gateway.addNode(detail.id, input);
      if (!isCurrent()) return;
      this.publish({
        ...this.snapshot,
        detail: this.snapshot.detail
          ? { ...this.snapshot.detail, nodes: [...this.snapshot.detail.nodes, node] }
          : null,
        publicOption: input.storage === 'public'
          ? { ...this.snapshot.publicOption, alreadyCreated: true, available: false }
          : this.snapshot.publicOption,
      });
    });
  }

  async moveNode(tierId: string, direction: -1 | 1): Promise<boolean> {
    const detail = this.snapshot.detail;
    if (!detail || this.snapshot.operation) return false;
    const index = detail.nodes.findIndex(({ id }) => id === tierId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= detail.nodes.length) return false;
    const tierIds = detail.nodes.map(({ id }) => id);
    [tierIds[index], tierIds[target]] = [tierIds[target]!, tierIds[index]!];
    return this.run('reorder-nodes', async (isCurrent) => {
      const { nodes } = await this.#gateway.reorderNodes(detail.id, tierIds);
      if (!isCurrent()) return;
      this.publish({
        ...this.snapshot,
        detail: this.snapshot.detail ? { ...this.snapshot.detail, nodes } : null,
      });
    });
  }

  async removeNode(tierId: string): Promise<boolean> {
    const detail = this.snapshot.detail;
    if (!detail || this.snapshot.operation) return false;
    const tier = detail.nodes.find(({ id }) => id === tierId);
    if (!tier) return false;
    const lifecycleId = this.#lifecycleId;
    const removed = await this.run('remove-node', async (isCurrent) => {
      await this.#gateway.removeNode(detail.id, tierId);
      if (!isCurrent()) return;
      await this.loadSpace(detail.id);
    });
    if (removed && lifecycleId === this.#lifecycleId && tier.kind === 'public') void this.refresh();
    return removed;
  }

  private async run(
    operation: RondoOperation,
    action: (isCurrent: () => boolean) => Promise<void>,
  ): Promise<boolean> {
    const lifecycleId = this.#lifecycleId;
    const isCurrent = () => lifecycleId === this.#lifecycleId;
    this.publish({ ...this.snapshot, error: null, operation });
    try {
      await action(isCurrent);
      if (!isCurrent()) return true;
      this.publish({ ...this.snapshot, error: null, operation: null });
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      this.publish({ ...this.snapshot, error: readableError(error), operation: null });
      return false;
    }
  }
}

function emptySnapshot(): RondoSnapshot {
  return {
    activeRoomId: null,
    activeSpaceId: null,
    chatAtLatest: true,
    chatCursor: null,
    chatError: null,
    chatHasMore: false,
    chatMessages: [],
    chatPhase: 'idle',
    chatSending: false,
    detail: null,
    detailPhase: 'idle',
    error: null,
    inviteCode: null,
    operation: null,
    phase: 'idle',
    privateNodes: [],
    publicOption: EMPTY_PUBLIC_OPTION,
    roomMode: 'text',
    settingsOpen: false,
    spaces: [],
    view: 'empty',
    voice: EMPTY_RONDO_VOICE,
  };
}

function deduplicateMessages(messages: RondoMessage[]): RondoMessage[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  return [...byId.values()].sort((left, right) =>
    left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

const CHAT_PAGE_SIZE = 40;
const MAX_CHAT_WINDOW = 200;
const CHAT_POLL_MILLISECONDS = 5_000;

function replaceSpace(spaces: RondoSpace[], space: RondoSpace): RondoSpace[] {
  return spaces.map((candidate) => candidate.id === space.id ? space : candidate);
}

function readableError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Rondo service is unavailable.';
}
