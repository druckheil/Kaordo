export type NodoPolicy = {
  allowDownloads: boolean;
  allowUploads: boolean;
  chargingOnly: boolean;
  ownerOnly: true;
  wifiOnly: boolean;
};

export type NodoSpaces = {
  private: { quotaBytes: number; usedBytes: number };
  public: { quotaBytes: number; usedBytes: number };
};

export type NodoNode = {
  createdAt: number;
  deviceName: string;
  diagnostics: {
    completedAt: number | null;
    requestedAt: number | null;
    running: boolean;
  };
  id: string;
  lastSeenAt: number;
  localAddresses: string[];
  metrics: {
    androidSdk: number | null;
    appVersion: string | null;
    batteryPercent: number | null;
    charging: boolean | null;
    coordinatorLatencyMs: number | null;
    diskReadBps: number | null;
    diskWriteBps: number | null;
    memoryAvailableBytes: number | null;
    memoryTotalBytes: number | null;
    networkMetered: boolean | null;
    networkDownBps: number | null;
    networkType: 'cellular' | 'ethernet' | 'offline' | 'other' | 'wifi' | null;
    networkUpBps: number | null;
    storageAvailableBytes: number | null;
  };
  observedAddress: string | null;
  online: boolean;
  policy: NodoPolicy;
  port: number;
  protocol: string;
  quotaBytes: number;
  spaces: NodoSpaces;
  usedBytes: number;
};

export type NodoAccess = {
  candidates: Array<{ address: string; kind: 'lan' | 'public'; port: number }>;
  expiresAt: number;
  node: NodoNode;
  ticket: string;
};

export type NodoQuickTest = {
  completedAt: number;
  diskReadBps: number;
  diskWriteBps: number;
};

export type NodoStorageClearResult = {
  deletedBytes: number;
  deletedPosts: number;
  deletedUploads: number;
};

export type NodoStorageSpace = 'private' | 'public';

export type NodoStorageItemKind = 'file' | 'fluo-post' | 'ligo-envelope' | 'rondo-message';

export type NodoStorageItem = {
  completed: boolean;
  createdAt: number;
  deletable: boolean;
  id: string;
  kind: NodoStorageItemKind;
  mimeType: string | null;
  name: string;
  nodeId: string;
  nodeName: string;
  owner: string;
  preview: string | null;
  sizeBytes: number;
  space: NodoStorageSpace;
  storageKey: string;
};

export type NodoNodeUsage = {
  spaces: NodoSpaces;
  usedBytes: number;
};

export type PublicNodoStorage = {
  limitBytes: number;
  nodeCandidates: Array<{
    availableBytes: number;
    deviceName: string;
    nodeId: string;
  }>;
  reservedBytes: number;
  usedBytes: number;
};

export type PublicNodoReservation = {
  expiresAt: number;
  reservationId: string;
};
