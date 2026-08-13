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
import type { RondoGateway } from './RondoGateway';
import { requestJson } from './WebApiClient';

export class WebRondoGateway implements RondoGateway {
  bootstrap(): Promise<RondoBootstrap> {
    return request('/api/rondo/bootstrap');
  }

  createSpace(input: CreateRondoSpaceInput): Promise<CreatedRondoSpace> {
    return request<CreatedRondoSpace>('/api/rondo/spaces', {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
  }

  joinSpace(inviteCode: string): Promise<{ space: RondoSpace }> {
    return request('/api/rondo/join', {
      body: JSON.stringify({ inviteCode }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
  }

  loadSpace(spaceId: string): Promise<{ detail: RondoSpaceDetail }> {
    return request(`/api/rondo/spaces/${encodeURIComponent(spaceId)}`);
  }

  messageRoute(spaceId: string, roomId: string): Promise<RondoMessageRoute> {
    return request(
      `/api/rondo/spaces/${encodeURIComponent(spaceId)}/rooms/${encodeURIComponent(roomId)}/route`,
    );
  }

  updateSpace(spaceId: string, input: { description: string; name: string }): Promise<{ space: RondoSpace }> {
    return request(`/api/rondo/spaces/${encodeURIComponent(spaceId)}`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    });
  }

  createInvite(spaceId: string, input: { expiresInDays: number; maxUses: number }): Promise<{ invite: RondoInvite }> {
    return request(`/api/rondo/spaces/${encodeURIComponent(spaceId)}/invites`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
  }

  async revokeInvite(spaceId: string, inviteId: string): Promise<void> {
    await request(`/api/rondo/spaces/${encodeURIComponent(spaceId)}/invites/${encodeURIComponent(inviteId)}`, {
      method: 'DELETE',
    });
  }

  createRoom(spaceId: string, name: string): Promise<{ room: RondoRoom }> {
    return request(`/api/rondo/spaces/${encodeURIComponent(spaceId)}/rooms`, {
      body: JSON.stringify({ name }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
  }

  async deleteRoom(spaceId: string, roomId: string): Promise<void> {
    await request(`/api/rondo/spaces/${encodeURIComponent(spaceId)}/rooms/${encodeURIComponent(roomId)}`, {
      method: 'DELETE',
    });
  }

  addNode(spaceId: string, input: { nodeId?: string; storage: 'private' | 'public' }): Promise<{ node: RondoNodeTier }> {
    return request(`/api/rondo/spaces/${encodeURIComponent(spaceId)}/nodes`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
  }

  reorderNodes(spaceId: string, tierIds: string[]): Promise<{ nodes: RondoNodeTier[] }> {
    return request(`/api/rondo/spaces/${encodeURIComponent(spaceId)}/nodes`, {
      body: JSON.stringify({ tierIds }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    });
  }

  async removeNode(spaceId: string, tierId: string): Promise<void> {
    await request(`/api/rondo/spaces/${encodeURIComponent(spaceId)}/nodes/${encodeURIComponent(tierId)}`, {
      method: 'DELETE',
    });
  }

  voiceIce(): Promise<RondoIceConfiguration> {
    return request('/api/rondo/voice/ice');
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return requestJson(path, init, 'Rondo service is unavailable.');
}
