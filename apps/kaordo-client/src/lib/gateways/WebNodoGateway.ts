import type {
  NodoAccess,
  NodoNode,
  NodoNodeUsage,
  NodoPolicy,
  NodoQuickTest,
  NodoSpaces,
  NodoStorageClearResult,
  NodoStorageItem,
  NodoStorageItemKind,
  NodoStorageSpace,
  PublicNodoReservation,
  PublicNodoStorage,
} from '../domain/nodo';
import type { FluoBootstrap, NodoGateway } from './NodoGateway';
import { runNodeQuickTest } from './NodeDiagnosticsGateway';
import {
  clearNodeStorage,
  clearPrivateNodeStorage,
  deleteNodeStorageItem,
  listNodeStorageItems,
  readNodeUsage,
} from './NodeStorageGateway';
import { requestJson } from './WebApiClient';
import { InFlightRequests } from './InFlightRequests';

export class WebNodoGateway implements NodoGateway {
  /** Share concurrent reads without introducing stale time-based caching. */
  readonly #inFlight = new InFlightRequests();

  resetSession(): void {
    this.#inFlight.clear();
  }

  accessNode(nodeId: string): Promise<NodoAccess> {
    return requestJson<NodoAccess>(`/api/nodes/${encodeURIComponent(nodeId)}/access`, { method: 'POST' }, NODO_UNAVAILABLE);
  }

  async clearStorage(nodeId: string): Promise<NodoStorageClearResult> {
    return clearNodeStorage(await this.accessNode(nodeId));
  }

  async clearPrivateStorage(nodeId: string): Promise<NodoStorageClearResult> {
    return clearPrivateNodeStorage(await this.accessNode(nodeId));
  }

  async listStorageItems(nodeId: string, space: NodoStorageSpace): Promise<NodoStorageItem[]> {
    return listNodeStorageItems(await this.accessNode(nodeId), space);
  }

  async deleteStorageItem(nodeId: string, space: NodoStorageSpace, kind: NodoStorageItemKind, storageKey: string): Promise<void> {
    return deleteNodeStorageItem(await this.accessNode(nodeId), space, kind, storageKey);
  }

  async refreshUsage(nodeId: string): Promise<NodoNodeUsage> {
    return readNodeUsage(await this.accessNode(nodeId));
  }

  async listNodes(): Promise<NodoNode[]> {
    return this.shared('nodes', async () =>
      (await requestJson<{ nodes: NodoNode[] }>('/api/nodes', { cache: 'no-store' }, NODO_UNAVAILABLE)).nodes,
    );
  }

  async listFeedNodeIds(): Promise<string[]> {
    return this.shared('fluo-node-ids', async () =>
      (await requestJson<{ nodeIds: string[] }>('/api/fluo/nodes', { cache: 'no-store' }, NODO_UNAVAILABLE)).nodeIds,
    );
  }

  fluoBootstrap(): Promise<FluoBootstrap> {
    return this.shared('fluo-bootstrap', () =>
      requestJson<FluoBootstrap>('/api/fluo/bootstrap', { cache: 'no-store' }, NODO_UNAVAILABLE),
    );
  }

  publicStorage(): Promise<PublicNodoStorage> {
    return this.shared('public-storage', () =>
      requestJson<PublicNodoStorage>('/api/fluo/public-storage', { cache: 'no-store' }, NODO_UNAVAILABLE),
    );
  }

  reservePublicStorage(nodeId: string, bytes: number): Promise<PublicNodoReservation> {
    return requestJson('/api/fluo/public-storage/reservations', {
      body: JSON.stringify({ bytes, nodeId }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }, NODO_UNAVAILABLE);
  }

  renewPublicStorage(reservationId: string): Promise<PublicNodoReservation> {
    return requestJson(`/api/fluo/public-storage/reservations/${encodeURIComponent(reservationId)}`, {
      body: JSON.stringify({ renew: true }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }, NODO_UNAVAILABLE);
  }

  async commitPublicStorage(reservationId: string, postId: string): Promise<void> {
    await requestJson(`/api/fluo/public-storage/reservations/${encodeURIComponent(reservationId)}`, {
      body: JSON.stringify({ postId }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }, NODO_UNAVAILABLE);
  }

  async cancelPublicStorage(reservationId: string): Promise<void> {
    await requestJson(`/api/fluo/public-storage/reservations/${encodeURIComponent(reservationId)}`, {
      method: 'DELETE',
    }, NODO_UNAVAILABLE);
  }

  async releasePublicPost(nodeId: string, postId: string): Promise<void> {
    await requestJson(`/api/fluo/public-storage/posts/${encodeURIComponent(nodeId)}/${encodeURIComponent(postId)}`, {
      method: 'DELETE',
    }, NODO_UNAVAILABLE);
  }

  async deleteNode(nodeId: string): Promise<void> {
    await requestJson<{ ok: boolean }>(`/api/nodes/${encodeURIComponent(nodeId)}`, { method: 'DELETE' }, NODO_UNAVAILABLE);
  }

  async renameNode(nodeId: string, name: string): Promise<string> {
    return (await requestJson<{ deviceName: string }>(`/api/nodes/${encodeURIComponent(nodeId)}/name`, {
      body: JSON.stringify({ name }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }, NODO_UNAVAILABLE)).deviceName;
  }

  async requestQuickTest(nodeId: string): Promise<NodoQuickTest> {
    const result = await runNodeQuickTest(await this.accessNode(nodeId));
    return requestJson<NodoQuickTest>(
      `/api/nodes/${encodeURIComponent(nodeId)}/test`,
      {
        body: JSON.stringify(result),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      },
      NODO_UNAVAILABLE,
    );
  }

  async updatePolicy(
    nodeId: string,
    policy: Omit<NodoPolicy, 'ownerOnly'>,
  ): Promise<NodoPolicy> {
    return (await requestJson<{ policy: NodoPolicy }>(`/api/nodes/${encodeURIComponent(nodeId)}`, {
      body: JSON.stringify(policy),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }, NODO_UNAVAILABLE)).policy;
  }

  async updateSpaces(
    nodeId: string,
    spaces: { privateQuotaBytes: number; publicQuotaBytes: number },
  ): Promise<NodoSpaces> {
    return (await requestJson<{ spaces: NodoSpaces }>(`/api/nodes/${encodeURIComponent(nodeId)}/spaces`, {
      body: JSON.stringify(spaces),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }, NODO_UNAVAILABLE)).spaces;
  }

  private shared<T>(key: string, request: () => Promise<T>): Promise<T> {
    return this.#inFlight.get(key, request);
  }
}

const NODO_UNAVAILABLE = 'Nodo service is unavailable.';
