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
  candidates: Array<{
    address: string;
    kind: 'lan' | 'public' | 'relay';
    origin?: string;
    port: number;
  }>;
  expiresAt: number;
  node: NodoNode;
  ticket: string;
};

export const NODO_TELEMETRY_FIELDS = [
  'battery',
  'memory',
  'connection',
  'latency',
  'download',
  'upload',
  'read',
  'write',
] as const;

export type NodoTelemetryField = typeof NODO_TELEMETRY_FIELDS[number];

export type NodoTelemetryMetrics = Pick<NodoNode['metrics'],
  | 'batteryPercent'
  | 'charging'
  | 'coordinatorLatencyMs'
  | 'diskReadBps'
  | 'diskWriteBps'
  | 'memoryAvailableBytes'
  | 'memoryTotalBytes'
  | 'networkDownBps'
  | 'networkMetered'
  | 'networkType'
  | 'networkUpBps'
  | 'storageAvailableBytes'
>;

export type NodoTelemetryUpdate = {
  error?: string;
  fields: readonly NodoTelemetryField[];
  metrics?: Partial<NodoTelemetryMetrics>;
};

export type NodoTelemetryProgress = (update: NodoTelemetryUpdate) => void;

export type NodoQuickTest = NodoTelemetryMetrics & {
  completedAt: number;
};

export type NodoUpdateResult = {
  currentVersion: string;
  jobId?: string;
  message?: string;
  status: 'failed' | 'installed' | 'started' | 'up-to-date';
  targetVersion?: string;
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
