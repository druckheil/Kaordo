import { describe, expect, it } from 'vitest';
import type { CreatedRondoSpace, CreateRondoSpaceInput, RondoBootstrap, RondoSpace } from '../domain/rondo';
import type { RondoGateway } from '../gateways/RondoGateway';
import type { RondoChatGateway } from '../gateways/NodeRondoChatGateway';
import type { RondoVoiceGateway } from '../gateways/NodeRondoVoiceGateway';
import { RondoVoiceSession } from '../services/RondoVoiceSession';
import { RondoGState } from './RondoGState';

describe('RondoGState', () => {
  it('creates a public Space and consumes the single free Public option', async () => {
    const gateway = new MemoryRondoGateway();
    const state = new RondoGState(gateway, new MemoryChatGateway(), voiceSession());
    await state.refresh();

    expect(state.snapshot.publicOption.available).toBe(true);
    await expect(state.createSpace({
      description: 'A quiet place.',
      name: 'North Star',
      storage: 'public',
    })).resolves.toBe(true);

    expect(state.snapshot).toMatchObject({
      activeSpaceId: 'space-1',
      inviteCode: 'RND-ABCDE-23456',
      publicOption: { alreadyCreated: true, available: false },
      view: 'space',
    });
    expect(state.snapshot.spaces).toHaveLength(1);
  });

  it('joins a Space with an invite and selects it', async () => {
    const gateway = new MemoryRondoGateway();
    const state = new RondoGState(gateway, new MemoryChatGateway(), voiceSession());
    await state.refresh();
    state.openJoin();

    await expect(state.joinSpace('RND-ABCDE-23456')).resolves.toBe(true);
    expect(state.snapshot).toMatchObject({ activeSpaceId: 'joined-space', view: 'space' });
    expect(state.snapshot.spaces[0]).toMatchObject({ name: 'Joined circle', role: 'member' });
  });

  it('does not publish a completed operation after the account state is reset', async () => {
    const gateway = new DeferredUpdateGateway();
    const state = new RondoGState(gateway, new MemoryChatGateway(), voiceSession());
    await state.refresh();
    await state.createSpace({ description: '', name: 'Before', storage: 'private' });

    const updating = state.updateGeneral('After', 'Changed');
    state.reset();
    gateway.completeUpdate();

    await expect(updating).resolves.toBe(true);
    expect(state.snapshot).toMatchObject({ detail: null, operation: null, spaces: [], view: 'empty' });
  });

  it('finishes an operation after ordinary navigation so it is not stuck on return', async () => {
    const gateway = new DeferredUpdateGateway();
    const state = new RondoGState(gateway, new MemoryChatGateway(), voiceSession());
    await state.refresh();
    await state.createSpace({ description: '', name: 'Before', storage: 'private' });

    const updating = state.updateGeneral('After', 'Changed');
    state.exit();
    gateway.completeUpdate();

    await expect(updating).resolves.toBe(true);
    expect(state.snapshot.operation).toBeNull();
    expect(state.snapshot.detail?.name).toBe('After');
  });
});

class MemoryRondoGateway implements RondoGateway {
  addNode(): ReturnType<RondoGateway['addNode']> { throw new Error('Not used.'); }
  bootstrap(): Promise<RondoBootstrap> {
    return Promise.resolve({
      privateNodes: [],
      publicOption: { alreadyCreated: false, available: true, limitBytes: 1_073_741_824 },
      spaces: [],
    });
  }

  createSpace(input: CreateRondoSpaceInput): Promise<CreatedRondoSpace> {
    return Promise.resolve({
      inviteCode: 'RND-ABCDE-23456',
      space: space('space-1', input.name, 'owner'),
    });
  }

  createInvite(): ReturnType<RondoGateway['createInvite']> { throw new Error('Not used.'); }
  createRoom(): ReturnType<RondoGateway['createRoom']> { throw new Error('Not used.'); }
  deleteRoom(): Promise<void> { throw new Error('Not used.'); }

  joinSpace(): Promise<{ space: RondoSpace }> {
    return Promise.resolve({ space: space('joined-space', 'Joined circle', 'member') });
  }

  loadSpace(spaceId: string): ReturnType<RondoGateway['loadSpace']> {
    const basic = space(spaceId, spaceId === 'joined-space' ? 'Joined circle' : 'North Star', spaceId === 'joined-space' ? 'member' : 'owner');
    return Promise.resolve({ detail: {
      ...basic,
      invites: [],
      members: [{ id: 'owner', joinedAt: 1, online: true, role: 'owner', self: true, username: 'Owner' }],
      nodes: [{
        deviceName: 'Public Node', id: 'tier-1', kind: 'public', limitBytes: 1_073_741_824,
        nodeId: null, online: true, position: 0, usedBytes: 0,
      }],
      rooms: [{ createdAt: 1, id: 'room-1', name: 'general', position: 0 }],
    } });
  }
  messageRoute(): ReturnType<RondoGateway['messageRoute']> { throw new Error('Not used.'); }
  removeNode(): Promise<void> { throw new Error('Not used.'); }
  reorderNodes(): ReturnType<RondoGateway['reorderNodes']> { throw new Error('Not used.'); }
  revokeInvite(): Promise<void> { throw new Error('Not used.'); }
  updateSpace(
    _spaceId: string,
    _input: { description: string; name: string },
  ): ReturnType<RondoGateway['updateSpace']> { throw new Error('Not used.'); }
  voiceIce(): ReturnType<RondoGateway['voiceIce']> {
    return Promise.resolve({ expiresAt: 86_400, iceServers: [{ urls: ['stun:test'] }] });
  }
}

class DeferredUpdateGateway extends MemoryRondoGateway {
  private complete: ((value: { space: RondoSpace }) => void) | null = null;

  override updateSpace(
    _spaceId: string,
    _input: { description: string; name: string },
  ): Promise<{ space: RondoSpace }> {
    return new Promise((resolve) => { this.complete = resolve; });
  }

  completeUpdate(): void {
    if (!this.complete) throw new Error('Update was not started.');
    this.complete({ space: space('space-1', 'After', 'owner') });
  }
}

class MemoryChatGateway implements RondoChatGateway {
  createMessage(): ReturnType<RondoChatGateway['createMessage']> { throw new Error('Not used.'); }
  deleteMessage(): Promise<void> { throw new Error('Not used.'); }
  listMessages(): ReturnType<RondoChatGateway['listMessages']> {
    return Promise.resolve({ messages: [], nextCursor: null });
  }
  reset(): void {}
}

function voiceSession(): RondoVoiceSession {
  const empty = { cursor: 0, participants: [], signals: [] };
  const gateway: RondoVoiceGateway = {
    iceServers: async () => [{ urls: ['stun:test'] }],
    join: async () => empty,
    leave: async () => {},
    peek: async () => empty,
    signal: async () => {},
    sync: async () => empty,
  };
  return new RondoVoiceSession(gateway);
}

function space(id: string, name: string, role: RondoSpace['role']): RondoSpace {
  return {
    createdAt: 1,
    description: '',
    id,
    memberCount: 1,
    name,
    owner: { id: 'owner', username: 'Owner' },
    role,
    storage: {
      deviceName: 'Public Node',
      kind: 'public',
      limitBytes: 1_073_741_824,
      nodeId: null,
      online: true,
      usedBytes: 0,
    },
  };
}
