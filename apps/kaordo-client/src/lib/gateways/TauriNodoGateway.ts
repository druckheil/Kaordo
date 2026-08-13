import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type {
  NodoAccess,
  NodoNode,
  NodoPolicy,
  NodoQuickTest,
  NodoSpaces,
  NodoStorageClearResult,
  PublicNodoReservation,
  PublicNodoStorage,
} from '../domain/nodo';
import type { TauriInvoke } from './TauriWorkspaceGateway';
import type { FluoBootstrap, NodoGateway } from './NodoGateway';
import { runNodeQuickTest } from './NodeDiagnosticsGateway';
import { clearNodeStorage, clearPrivateNodeStorage } from './NodeStorageGateway';

export class TauriNodoGateway implements NodoGateway {
  constructor(private readonly invoke: TauriInvoke = tauriInvoke) {}

  listNodes(): Promise<NodoNode[]> {
    return this.invoke<NodoNode[]>('nodo_list');
  }

  listFeedNodeIds(): Promise<string[]> {
    return this.invoke<string[]>('fluo_node_ids');
  }

  fluoBootstrap(): Promise<FluoBootstrap> {
    return this.invoke('fluo_bootstrap');
  }

  publicStorage(): Promise<PublicNodoStorage> {
    return this.invoke('fluo_public_storage');
  }

  reservePublicStorage(nodeId: string, bytes: number): Promise<PublicNodoReservation> {
    return this.invoke('fluo_public_reserve', { bytes, nodeId });
  }

  renewPublicStorage(reservationId: string): Promise<PublicNodoReservation> {
    return this.invoke('fluo_public_renew', { reservationId });
  }

  commitPublicStorage(reservationId: string, postId: string): Promise<void> {
    return this.invoke('fluo_public_commit', { postId, reservationId });
  }

  cancelPublicStorage(reservationId: string): Promise<void> {
    return this.invoke('fluo_public_cancel', { reservationId });
  }

  releasePublicPost(nodeId: string, postId: string): Promise<void> {
    return this.invoke('fluo_public_release', { nodeId, postId });
  }

  accessNode(nodeId: string): Promise<NodoAccess> {
    return this.invoke<NodoAccess>('nodo_access', { nodeId });
  }

  async clearStorage(nodeId: string): Promise<NodoStorageClearResult> {
    return clearNodeStorage(await this.accessNode(nodeId));
  }

  async clearPrivateStorage(nodeId: string): Promise<NodoStorageClearResult> {
    return clearPrivateNodeStorage(await this.accessNode(nodeId));
  }

  deleteNode(nodeId: string): Promise<void> {
    return this.invoke('nodo_delete', { nodeId });
  }

  async requestQuickTest(nodeId: string): Promise<NodoQuickTest> {
    return runNodeQuickTest(await this.accessNode(nodeId));
  }

  updatePolicy(nodeId: string, policy: Omit<NodoPolicy, 'ownerOnly'>): Promise<NodoPolicy> {
    return this.invoke<NodoPolicy>('nodo_update_policy', { nodeId, policy });
  }

  updateSpaces(
    nodeId: string,
    spaces: { privateQuotaBytes: number; publicQuotaBytes: number },
  ): Promise<NodoSpaces> {
    return this.invoke<NodoSpaces>('nodo_update_spaces', { nodeId, spaces });
  }
}
