// Identifies when a chat message begins a new run from a different sender

import type { LigoMessage } from '@kaordo/contracts';

type MessageIdentity = Pick<LigoMessage, 'sender'>;

export function startsSenderRun(previous: MessageIdentity | null, current: MessageIdentity): boolean {
  return !previous || previous.sender.id !== current.sender.id;
}
