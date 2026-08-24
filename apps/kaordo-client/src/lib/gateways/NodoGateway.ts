import type {
  NodoAccess,
  NodoNode,
  NodoNodeUsage,
  NodoPolicy,
  NodoQuickTest,
  NodoSpaces,
  NodoStorageClearResult,
  NodoStorageItem,
  NodoStorageSpace,
  NodoTelemetryProgress,
  NodoUpdateResult,
  PublicNodoReservation,
  PublicNodoStorage,
} from '../domain/nodo';

export type FluoBootstrap = {
  nodeIds: string[];
  nodes: NodoNode[];
  publicStorage: PublicNodoStorage;
};

export interface NodoGateway {
  /** Clears shared read promises when the authenticated session changes. */
  resetSession?(): void;
  deleteNode(nodeId: string): Promise<void>;
  renameNode(nodeId: string, name: string): Promise<string>;
  accessNode(nodeId: string, options?: { forceRefresh?: boolean }): Promise<NodoAccess>;
  clearStorage(nodeId: string): Promise<NodoStorageClearResult>;
  clearPrivateStorage(nodeId: string): Promise<NodoStorageClearResult>;
  listStorageItems(nodeId: string, space: NodoStorageSpace): Promise<NodoStorageItem[]>;
  deleteStorageItem(nodeId: string, space: NodoStorageSpace, kind: NodoStorageItem['kind'], storageKey: string): Promise<void>;
  refreshUsage(nodeId: string): Promise<NodoNodeUsage>;
  listNodes(): Promise<NodoNode[]>;
  listFeedNodeIds(): Promise<string[]>;
  fluoBootstrap?(): Promise<FluoBootstrap>;
  publicStorage(): Promise<PublicNodoStorage>;
  reservePublicStorage(nodeId: string, bytes: number): Promise<PublicNodoReservation>;
  renewPublicStorage(reservationId: string): Promise<PublicNodoReservation>;
  commitPublicStorage(reservationId: string, postId: string): Promise<void>;
  cancelPublicStorage(reservationId: string): Promise<void>;
  releasePublicPost(nodeId: string, postId: string): Promise<void>;
  requestQuickTest(nodeId: string, onUpdate?: NodoTelemetryProgress): Promise<NodoQuickTest>;
  updateNode(nodeId: string): Promise<NodoUpdateResult>;
  updatePolicy(nodeId: string, policy: Omit<NodoPolicy, 'ownerOnly'>): Promise<NodoPolicy>;
  updateSpaces(nodeId: string, spaces: { privateQuotaBytes: number; publicQuotaBytes: number }): Promise<NodoSpaces>;
}
