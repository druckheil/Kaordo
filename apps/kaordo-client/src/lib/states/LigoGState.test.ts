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
});

class MemoryLigoGateway implements LigoGateway {
  inboxCalls = 0;
  liveTicketCalls = 0;

  acknowledge(): Promise<void> { return Promise.resolve(); }
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
  history(
    _username: string,
    _owner: 'peer' | 'self',
    _cursor?: string | null,
    _limit?: number,
  ): Promise<LigoCloudPage> { return Promise.resolve({ messages: [], nextCursor: null }); }
  inbox(): Promise<LigoInbox> {
    this.inboxCalls += 1;
    return Promise.resolve({ deliveries: [], nextCursor: null });
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
  receive: async () => { throw new Error('Not used.'); },
  reconcile: async (_ownerId, _delivery, cached) => cached,
  reset: () => {},
  send: async () => { throw new Error('Not used.'); },
};
