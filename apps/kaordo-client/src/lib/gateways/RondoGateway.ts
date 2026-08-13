import type {
  CreatedRondoSpace,
  CreateRondoSpaceInput,
  RondoBootstrap,
  RondoInvite,
  RondoIceConfiguration,
  RondoNodeTier,
  RondoMessageRoute,
  RondoRoom,
  RondoSpace,
  RondoSpaceDetail,
} from '../domain/rondo';

export interface RondoGateway {
  bootstrap(): Promise<RondoBootstrap>;
  createSpace(input: CreateRondoSpaceInput): Promise<CreatedRondoSpace>;
  addNode(spaceId: string, input: { nodeId?: string; storage: 'private' | 'public' }): Promise<{ node: RondoNodeTier }>;
  createInvite(spaceId: string, input: { expiresInDays: number; maxUses: number }): Promise<{ invite: RondoInvite }>;
  createRoom(spaceId: string, name: string): Promise<{ room: RondoRoom }>;
  deleteRoom(spaceId: string, roomId: string): Promise<void>;
  joinSpace(inviteCode: string): Promise<{ space: RondoSpace }>;
  loadSpace(spaceId: string): Promise<{ detail: RondoSpaceDetail }>;
  messageRoute(spaceId: string, roomId: string): Promise<RondoMessageRoute>;
  removeNode(spaceId: string, tierId: string): Promise<void>;
  reorderNodes(spaceId: string, tierIds: string[]): Promise<{ nodes: RondoNodeTier[] }>;
  revokeInvite(spaceId: string, inviteId: string): Promise<void>;
  updateSpace(spaceId: string, input: { description: string; name: string }): Promise<{ space: RondoSpace }>;
  voiceIce(): Promise<RondoIceConfiguration>;
}
