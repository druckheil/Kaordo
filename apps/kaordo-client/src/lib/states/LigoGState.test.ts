import { describe, expect, it, vi } from 'vitest';
import type { LigoBootstrap, LigoDelivery, LigoInbox, LigoLiveTicket, LigoUser } from '../domain/ligo';
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
  history() { return Promise.resolve({ messages: [], nextCursor: null }); }
  inbox(): Promise<LigoInbox> {
    this.inboxCalls += 1;
    return Promise.resolve({ deliveries: [], nextCursor: null });
  }
  liveTicket(): Promise<LigoLiveTicket> {
    this.liveTicketCalls += 1;
    return Promise.resolve({ url: 'wss://example.test/api/ligo/live?ticket=test' });
  }
  searchUsers(): Promise<LigoUser[]> { return Promise.resolve([]); }
  updateStorage() { return Promise.resolve({
    evicted: [],
    storage: { selectedNodeId: 'public', stackLimitBytes: 104_857_600, stackUsedBytes: 0 },
  }); }
}

class TestWebSocket {
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  readyState = 0;

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
  reset: () => {},
  send: async () => { throw new Error('Not used.'); },
};
