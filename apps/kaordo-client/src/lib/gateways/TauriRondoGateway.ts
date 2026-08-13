import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type {
  CreatedRondoSpace,
  CreateRondoSpaceInput,
  RondoBootstrap,
  RondoIceConfiguration,
  RondoInvite,
  RondoNodeTier,
  RondoMessageRoute,
  RondoRoom,
  RondoSpace,
  RondoSpaceDetail,
} from '../domain/rondo';
import type { TauriInvoke } from './TauriWorkspaceGateway';
import type { RondoGateway } from './RondoGateway';

export class TauriRondoGateway implements RondoGateway {
  constructor(private readonly invoke: TauriInvoke = tauriInvoke) {}

  bootstrap(): Promise<RondoBootstrap> {
    return this.invoke('rondo_bootstrap');
  }

  createSpace(input: CreateRondoSpaceInput): Promise<CreatedRondoSpace> {
    return this.invoke<CreatedRondoSpace>('rondo_create_space', { input });
  }

  joinSpace(inviteCode: string): Promise<{ space: RondoSpace }> {
    return this.invoke('rondo_join_space', { inviteCode });
  }

  loadSpace(spaceId: string): Promise<{ detail: RondoSpaceDetail }> {
    return this.invoke('rondo_space_detail', { spaceId });
  }

  messageRoute(spaceId: string, roomId: string): Promise<RondoMessageRoute> {
    return this.invoke('rondo_room_route', { roomId, spaceId });
  }

  updateSpace(spaceId: string, input: { description: string; name: string }): Promise<{ space: RondoSpace }> {
    return this.invoke('rondo_update_space', { input, spaceId });
  }

  createInvite(spaceId: string, input: { expiresInDays: number; maxUses: number }): Promise<{ invite: RondoInvite }> {
    return this.invoke('rondo_create_invite', { input, spaceId });
  }

  revokeInvite(spaceId: string, inviteId: string): Promise<void> {
    return this.invoke('rondo_revoke_invite', { inviteId, spaceId });
  }

  createRoom(spaceId: string, name: string): Promise<{ room: RondoRoom }> {
    return this.invoke('rondo_create_room', { name, spaceId });
  }

  deleteRoom(spaceId: string, roomId: string): Promise<void> {
    return this.invoke('rondo_delete_room', { roomId, spaceId });
  }

  addNode(spaceId: string, input: { nodeId?: string; storage: 'private' | 'public' }): Promise<{ node: RondoNodeTier }> {
    return this.invoke('rondo_add_node', { input, spaceId });
  }

  reorderNodes(spaceId: string, tierIds: string[]): Promise<{ nodes: RondoNodeTier[] }> {
    return this.invoke('rondo_reorder_nodes', { spaceId, tierIds });
  }

  removeNode(spaceId: string, tierId: string): Promise<void> {
    return this.invoke('rondo_remove_node', { spaceId, tierId });
  }

  voiceIce(): Promise<RondoIceConfiguration> {
    return this.invoke('rondo_voice_ice');
  }
}
