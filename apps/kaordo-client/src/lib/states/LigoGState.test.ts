import { describe, expect, it, vi } from 'vitest';
import type {
  LigoBootstrap,
  LigoCloudPage,
  LigoDelivery,
  LigoInbox,
  LigoLiveTicket,
  LigoMessage,
  LigoUser,
} from '../domain/ligo';
import type { LigoGateway } from '../gateways/LigoGateway';
import type { LigoTransport } from '../gateways/NodeLigoTransport';
import { MemoryLigoLocalStore } from '../services/LigoLocalStore';
import { LigoGState } from './LigoGState';

describe('LigoGState live inbox', () => {
  it('synchronizes the open chat as soon as the server signals a delivery', async () => {
    const gateway = new MemoryLigoGateway();
    const socket = new TestWebSocket();
    const state = new LigoGState(
      gateway,
      EMPTY_TRANSPORT,
      new MemoryLigoLocalStore(),
      async () => [],
      async () => ({ limitBytes: 1_073_741_824, nodeCandidates: [], reservedBytes: 0, usedBytes: 0 }),
      () => socket,
    );

    state.configure('owner');
    state.enter();
    await vi.waitFor(() => expect(gateway.liveTicketCalls).toBe(1));
    socket.open();
    await vi.waitFor(() => expect(gateway.inboxCalls).toBeGreaterThan(0));
    gateway.inboxCalls = 0;

    socket.message(JSON.stringify({ messageId: crypto.randomUUID(), type: 'inbox' }));

    await vi.waitFor(() => expect(gateway.inboxCalls).toBe(1));
    state.exit();
    expect(socket.readyState).toBe(3);
  });

  it('updates a visible user immediately when live presence changes', async () => {
    const gateway = new MemoryLigoGateway();
    const socket = new TestWebSocket();
    const state = new LigoGState(
      gateway,
      EMPTY_TRANSPORT,
      new MemoryLigoLocalStore(),
      async () => [],
      async () => ({ limitBytes: 1_073_741_824, nodeCandidates: [], reservedBytes: 0, usedBytes: 0 }),
      () => socket,
    );
    const user: LigoUser = { id: 'friend', online: false, username: 'friend' };

    state.configure('owner');
    state.enter();
    await vi.waitFor(() => expect(gateway.liveTicketCalls).toBe(1));
    socket.open();
    await state.openConversation(user);

    socket.message(JSON.stringify({ online: true, type: 'presence', userId: user.id }));

    expect(state.snapshot.activeUser?.online).toBe(true);
    state.exit();
  });

  it('keeps the displayed local blob when background reconciliation finds no payload change', async () => {
    const gateway = new GatedHistoryGateway();
    const local = new MemoryLigoLocalStore();
    const user: LigoUser = { id: 'friend', online: true, username: 'friend' };
    const cached: LigoMessage = {
      attachments: [{ blob: new Blob(['file']), id: 'file', mimeType: 'text/plain', name: 'file.txt', size: 4 }],
      body: '',
      conversationId: user.id,
      createdAt: 1_000,
      id: 'message',
      recipientId: user.id,
      senderId: 'owner',
      status: 'queued',
    };
    await local.put('owner', cached);
    const state = new LigoGState(
      gateway,
      EMPTY_TRANSPORT,
      local,
      async () => [],
      async () => ({ limitBytes: 1_073_741_824, nodeCandidates: [], reservedBytes: 0, usedBytes: 0 }),
    );
    state.configure('owner');

    await state.openConversation(user);
    const displayedBlob = state.snapshot.messages[0]!.attachments[0]!.blob;
    await vi.waitFor(() => expect(gateway.pending.length).toBe(2));
    gateway.release({
      createdAt: cached.createdAt,
      id: cached.id,
      nodeId: 'node',
      recipient: { id: user.id, username: user.username },
      sender: { id: 'owner', online: true, username: 'owner' },
      sizeBytes: 4,
      status: 'queued',
      storage: 'private',
    });

    await vi.waitFor(() => expect(state.snapshot.loadingHistory).toBe(false));
    expect(state.snapshot.messages[0]!.attachments[0]!.blob).toBe(displayedBlob);
  });

  it('preloads the local page containing a remembered scroll anchor', async () => {
    const local = new MemoryLigoLocalStore();
    const user: LigoUser = { id: 'friend', online: true, username: 'friend' };
    for (let index = 1; index <= 50; index += 1) {
      await local.put('owner', {
        attachments: [],
        body: `Message ${index}`,
        conversationId: user.id,
        createdAt: index,
        id: `message-${index.toString().padStart(3, '0')}`,
        recipientId: user.id,
        senderId: 'owner',
        status: 'queued',
      });
    }
    const state = new LigoGState(
      new MemoryLigoGateway(),
      EMPTY_TRANSPORT,
      local,
      async () => [],
      async () => ({ limitBytes: 1_073_741_824, nodeCandidates: [], reservedBytes: 0, usedBytes: 0 }),
    );
    state.configure('owner');
    state.rememberScroll(user.id, {
      atBottom: false,
      messageId: 'message-005',
      offset: -12,
      scrollTop: 640,
    });

    await state.openConversation(user);

    expect(state.snapshot.messages.map(({ id }) => id)).toContain('message-005');
    expect(state.snapshot.messages).toHaveLength(50);
  });

  it('cancels the debounced search lifecycle after selecting a user', async () => {
    const state = new LigoGState(
      new MemoryLigoGateway(), EMPTY_TRANSPORT, new MemoryLigoLocalStore(), async () => [],
      async () => ({ limitBytes: 1_073_741_824, nodeCandidates: [], reservedBytes: 0, usedBytes: 0 }),
    );
    state.configure('owner');
    state.setSearch('friend');

    await state.openConversation({ id: 'friend', online: true, username: 'friend' });

    expect(state.snapshot.searchPhase).toBe('idle');
    expect(state.snapshot.searchQuery).toBe('');
  });

  it('applies a live deletion locally and acknowledges its durable outbox item', async () => {
    const gateway = new MemoryLigoGateway();
    const socket = new TestWebSocket();
    const local = new MemoryLigoLocalStore();
    const messageId = '123e4567-e89b-42d3-a456-426614174077';
    const friend = { id: 'friend', online: true, username: 'friend' };
    await local.put('owner', {
      attachments: [], body: 'Delete me', conversationId: friend.id, createdAt: 1_000, id: messageId,
      recipientId: 'owner', senderId: friend.id, status: 'delivered',
    });
    const state = new LigoGState(
      gateway, EMPTY_TRANSPORT, local, async () => [],
      async () => ({ limitBytes: 1_073_741_824, nodeCandidates: [], reservedBytes: 0, usedBytes: 0 }),
      () => socket,
    );
    state.configure('owner');
    state.enter();
    await vi.waitFor(() => expect(gateway.liveTicketCalls).toBe(1));
    socket.open();
    await state.openConversation(friend);

    socket.message(JSON.stringify({ deletions: [{ messageId, senderId: friend.id }], type: 'deletions' }));

    await vi.waitFor(() => expect(gateway.acknowledgedDeletions).toContain(messageId));
    expect(state.snapshot.messages).toEqual([]);
    expect(await local.get('owner', messageId)).toBeNull();
    state.exit();
  });

  it('clears an entire local chat when an offline conversation deletion arrives', async () => {
    const gateway = new MemoryLigoGateway();
    const socket = new TestWebSocket();
    const local = new MemoryLigoLocalStore();
    const friend = { id: 'friend', online: true, username: 'friend' };
    await local.put('owner', {
      attachments: [], body: 'First', conversationId: friend.id, createdAt: 1_000, id: 'first',
      recipientId: 'owner', senderId: friend.id, status: 'read',
    });
    await local.put('owner', {
      attachments: [], body: 'Second', conversationId: friend.id, createdAt: 2_000, id: 'second',
      recipientId: friend.id, senderId: 'owner', status: 'delivered',
    });
    const state = new LigoGState(
      gateway, EMPTY_TRANSPORT, local, async () => [],
      async () => ({ limitBytes: 1_073_741_824, nodeCandidates: [], reservedBytes: 0, usedBytes: 0 }),
      () => socket,
    );
    state.configure('owner');
    state.enter();
    await vi.waitFor(() => expect(gateway.liveTicketCalls).toBe(1));
    socket.open();
    await state.openConversation(friend);

    socket.message(JSON.stringify({
      deletions: [{ peerId: friend.id, peerUsername: friend.username }],
      type: 'conversation-deletions',
    }));

    await vi.waitFor(() => expect(gateway.acknowledgedConversationDeletions).toContain(friend.username));
    expect(state.snapshot.activeUser).toBeNull();
    expect(await local.page('owner', friend.id, null, 10)).toMatchObject({ messages: [] });
    state.exit();
  });

  it('publishes every message envelope before attachment hydration finishes', async () => {
    const friend = { id: 'friend', online: true, username: 'friend' };
    const deliveries = ['large-video', 'next-message'].map((id, index): LigoDelivery => ({
      createdAt: 1_000 + index,
      id,
      nodeId: 'node',
      recipient: { id: 'owner', username: 'owner' },
      sender: friend,
      sizeBytes: 100_000_000,
      status: 'queued',
      storage: 'private',
    }));
    const gateway = new DeliveryGateway(deliveries);
    const transport: LigoTransport = {
      complete: async () => {},
      discard: async () => {},
      hydrate: () => new Promise(() => {}),
      prepare: async (ownerId, delivery) => {
        const message: LigoMessage = {
          attachments: [{
            blob: new Blob([], { type: 'video/quicktime' }),
            id: `${delivery.id}-file`,
            mimeType: 'video/quicktime',
            name: `${delivery.id}.mov`,
            size: delivery.sizeBytes,
          }],
          body: delivery.id,
          conversationId: friend.id,
          createdAt: delivery.createdAt,
          id: delivery.id,
          recipientId: ownerId,
          senderId: friend.id,
          status: delivery.status,
        };
        return { message, pending: message, replacePayload: true };
      },
      reset: () => {},
      send: async () => { throw new Error('Not used.'); },
    };
    const state = new LigoGState(
      gateway, transport, new MemoryLigoLocalStore(), async () => [],
      async () => ({ limitBytes: 1_073_741_824, nodeCandidates: [], reservedBytes: 0, usedBytes: 0 }),
    );
    state.configure('owner');
    state.enter();

    await vi.waitFor(() => expect(state.snapshot.conversations).toHaveLength(1));
    await state.openConversation(friend);

    expect(state.snapshot.messages.map(({ id }) => id)).toEqual(['large-video', 'next-message']);
    state.exit();
  });
});

class MemoryLigoGateway implements LigoGateway {
  acknowledgedConversationDeletions: string[] = [];
  acknowledgedDeletions: string[] = [];
  inboxCalls = 0;
  liveTicketCalls = 0;

  acknowledge(): Promise<void> { return Promise.resolve(); }
  acknowledgeConversationDeletions(peerUsernames: readonly string[]): Promise<void> {
    this.acknowledgedConversationDeletions.push(...peerUsernames);
    return Promise.resolve();
  }
  acknowledgeDeletions(messageIds: readonly string[]): Promise<void> {
    this.acknowledgedDeletions.push(...messageIds);
    return Promise.resolve();
  }
  confirmCleanup(): Promise<void> { return Promise.resolve(); }
  bootstrap(): Promise<LigoBootstrap> {
    return Promise.resolve({
      conversations: [],
      nextCursor: null,
      storage: { selectedNodeId: 'public', stackLimitBytes: 104_857_600, stackUsedBytes: 0 },
    });
  }
  createDelivery() { return Promise.resolve({
    evicted: [],
    storage: { selectedNodeId: 'public', stackLimitBytes: 104_857_600, stackUsedBytes: 0 },
  }); }
  deleteConversation() { return Promise.resolve({
    evicted: [],
    storage: { selectedNodeId: 'public', stackLimitBytes: 104_857_600, stackUsedBytes: 0 },
  }); }
  deleteMessage() { return Promise.resolve({
    evicted: [],
    storage: { selectedNodeId: 'public', stackLimitBytes: 104_857_600, stackUsedBytes: 0 },
  }); }
  history(
    _username: string,
    _owner: 'peer' | 'self',
    _cursor?: string | null,
    _limit?: number,
  ): Promise<LigoCloudPage> { return Promise.resolve({ messages: [], nextCursor: null }); }
  inbox(): Promise<LigoInbox> {
    this.inboxCalls += 1;
    return Promise.resolve({ conversationDeletions: [], deletions: [], deliveries: [], nextCursor: null });
  }
  liveTicket(): Promise<LigoLiveTicket> {
    this.liveTicketCalls += 1;
    return Promise.resolve({ url: 'wss://example.test/api/ligo/live?ticket=test' });
  }
  markRead(): Promise<void> { return Promise.resolve(); }
  searchUsers(): Promise<LigoUser[]> { return Promise.resolve([]); }
  updateStorage() { return Promise.resolve({
    evicted: [],
    storage: { selectedNodeId: 'public', stackLimitBytes: 104_857_600, stackUsedBytes: 0 },
  }); }
}

class GatedHistoryGateway extends MemoryLigoGateway {
  pending: Array<{ owner: 'peer' | 'self'; resolve: (page: LigoCloudPage) => void }> = [];

  override history(
    _username: string,
    owner: 'peer' | 'self',
    _cursor?: string | null,
    _limit?: number,
  ): Promise<LigoCloudPage> {
    return new Promise((resolve) => this.pending.push({ owner, resolve }));
  }

  release(delivery: LigoDelivery): void {
    for (const pending of this.pending.splice(0)) {
      pending.resolve({ messages: pending.owner === 'self' ? [delivery] : [], nextCursor: null });
    }
  }
}

class DeliveryGateway extends MemoryLigoGateway {
  #delivered = false;

  constructor(private readonly deliveries: LigoDelivery[]) { super(); }

  override inbox(): Promise<LigoInbox> {
    this.inboxCalls += 1;
    if (this.#delivered) {
      return Promise.resolve({ conversationDeletions: [], deletions: [], deliveries: [], nextCursor: null });
    }
    this.#delivered = true;
    return Promise.resolve({ conversationDeletions: [], deletions: [], deliveries: this.deliveries, nextCursor: null });
  }
}

class TestWebSocket {
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  readyState = 0;

  send(_data: string): void {}

  close(code = 1000, reason = ''): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  message(data: string): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

const EMPTY_TRANSPORT: LigoTransport = {
  complete: async (_delivery: LigoDelivery) => {},
  discard: async () => {},
  hydrate: async () => { throw new Error('Not used.'); },
  prepare: async (_ownerId, _delivery, cached) => {
    if (!cached) throw new Error('Not used.');
    return { message: cached, pending: null, replacePayload: false };
  },
  reset: () => {},
  send: async () => { throw new Error('Not used.'); },
};
