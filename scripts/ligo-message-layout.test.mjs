import assert from 'node:assert/strict';
import test from 'node:test';
import { startsSenderRun } from '../packages/chat-ui/src/message-grouping.ts';

const alice = { id: 'alice' };
const bob = { id: 'bob' };
const first = { sender: alice, createdAt: '2026-10-01T10:00:00.000Z' };

test('group chat shows sender identity only at the start of a consecutive run', () => {
  assert.equal(startsSenderRun(null, first), true);
  assert.equal(startsSenderRun(first, { sender: alice, createdAt: '2026-10-01T10:02:00.000Z' }), false);
  assert.equal(startsSenderRun(first, { sender: bob, createdAt: '2026-10-01T10:02:00.000Z' }), true);
});

test('a time gap alone does not repeat the sender identity', () => {
  assert.equal(startsSenderRun(first, { sender: alice, createdAt: '2026-10-02T10:00:00.000Z' }), false);
});
