import { describe, expect, it } from 'vitest';
import type { LigoMessage } from '../domain/ligo';
import { MemoryLigoLocalStore } from './LigoLocalStore';

describe('LigoLocalStore', () => {
  it('paginates newest-first without loading another conversation', async () => {
    const store = new MemoryLigoLocalStore();
    for (let index = 0; index < 5; index += 1) {
      await store.put('owner', message(`message-${index}`, 'friend', 1_000 + index));
    }
    await store.put('owner', message('other-message', 'other', 2_000));

    const first = await store.page('owner', 'friend', null, 3);
    const second = await store.page('owner', 'friend', first.nextCursor, 3);

    expect(first.messages.map(({ id }) => id)).toEqual(['message-4', 'message-3', 'message-2']);
    expect(second.messages.map(({ id }) => id)).toEqual(['message-1', 'message-0']);
    expect(second.nextCursor).toBeNull();
  });
});

function message(id: string, conversationId: string, createdAt: number): LigoMessage {
  return {
    attachments: [], body: id, conversationId, createdAt, id,
    recipientId: conversationId, senderId: 'owner', status: 'delivered',
  };
}
