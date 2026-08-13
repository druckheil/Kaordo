export type RondoStorageKind = 'private' | 'public';

export type RondoSpace = {
  createdAt: number;
  description: string;
  id: string;
  memberCount: number;
  name: string;
  owner: { id: string; username: string };
  role: 'member' | 'owner';
  storage: {
    deviceName: string | null;
    kind: RondoStorageKind;
    limitBytes: number;
    nodeId: string | null;
    online: boolean;
    usedBytes: number;
  };
};

export type RondoPrivateNode = {
  availableBytes: number;
  deviceName: string;
  nodeId: string;
  online: boolean;
  quotaBytes: number;
  usedBytes: number;
};

export type RondoBootstrap = {
  privateNodes: RondoPrivateNode[];
  publicOption: {
    alreadyCreated: boolean;
    available: boolean;
    limitBytes: number;
  };
  spaces: RondoSpace[];
};

export type CreateRondoSpaceInput = {
  description: string;
  name: string;
  nodeId?: string;
  storage: RondoStorageKind;
};

export type CreatedRondoSpace = {
  inviteCode: string;
  space: RondoSpace;
};

export type RondoRoom = {
  createdAt: number;
  id: string;
  name: string;
  position: number;
};

export type RondoMember = {
  id: string;
  joinedAt: number;
  online: boolean;
  role: 'member' | 'owner';
  self: boolean;
  username: string;
};

export type RondoInvite = {
  code: string | null;
  createdAt: number;
  expiresAt: number | null;
  id: string;
  maxUses: number;
  uses: number;
};

export type RondoNodeTier = {
  deviceName: string | null;
  id: string;
  kind: RondoStorageKind;
  limitBytes: number;
  nodeId: string | null;
  online: boolean;
  position: number;
  usedBytes: number;
};

export type RondoSpaceDetail = RondoSpace & {
  invites: RondoInvite[];
  members: RondoMember[];
  nodes: RondoNodeTier[];
  rooms: RondoRoom[];
};

export type RondoMessageRoute = {
  limitBytes: number;
  nodeId: string;
  storage: RondoStorageKind;
};

export type RondoIceConfiguration = {
  expiresAt: number;
  iceServers: Array<{
    credential?: string;
    urls: string[];
    username?: string;
  }>;
};

export type RondoMessage = {
  author: string;
  body: string;
  createdAt: number;
  id: string;
};

export type RondoMessagePage = {
  messages: RondoMessage[];
  nextCursor: string | null;
};
