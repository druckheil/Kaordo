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

  it('materializes attached files as standalone blobs for future app sessions', async () => {
    const store = new MemoryLigoLocalStore();
    const original = new File(['persistent bytes'], 'note.txt', { type: 'text/plain' });
    await store.put('owner', {
      ...message('attachment-message', 'friend', 2_000),
      attachments: [{ blob: original, id: 'attachment', mimeType: original.type, name: original.name, size: original.size }],
    });

    const stored = await store.get('owner', 'attachment-message');

    expect(stored?.attachments[0]?.blob).toBeInstanceOf(Blob);
    expect(stored?.attachments[0]?.blob).not.toBeInstanceOf(File);
    expect(await stored?.attachments[0]?.blob.text()).toBe('persistent bytes');
  });

  it('returns and removes a deleted local message', async () => {
    const store = new MemoryLigoLocalStore();
    await store.put('owner', message('deleted-message', 'friend', 3_000));

    const deleted = await store.delete('owner', 'deleted-message');

    expect(deleted?.id).toBe('deleted-message');
    expect(await store.get('owner', 'deleted-message')).toBeNull();
  });

  it('deletes every message in one conversation without touching another', async () => {
    const store = new MemoryLigoLocalStore();
    await store.put('owner', message('first', 'friend', 1_000));
    await store.put('owner', message('second', 'friend', 2_000));
    await store.put('owner', message('other', 'someone-else', 3_000));

    const deleted = await store.deleteConversation('owner', 'friend');

    expect(deleted.map(({ id }) => id).sort()).toEqual(['first', 'second']);
    expect((await store.page('owner', 'friend', null, 10)).messages).toEqual([]);
    expect((await store.page('owner', 'someone-else', null, 10)).messages).toHaveLength(1);
  });
});

function message(id: string, conversationId: string, createdAt: number): LigoMessage {
  return {
    attachments: [], body: id, conversationId, createdAt, id,
    recipientId: conversationId, senderId: 'owner', status: 'delivered',
  };
}
