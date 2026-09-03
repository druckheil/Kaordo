import type { LigoGateway } from './gateways/LigoGateway';
import type { FluoBootstrap, NodoGateway } from './gateways/NodoGateway';
import { NodeLigoTransport } from './gateways/NodeLigoTransport';
import { createLigoFileArchive } from './services/LigoFileArchive';
import { createLigoLocalStore } from './services/LigoLocalStore';
import { Director, StateKey } from './state/Director';
import type { GStateManager } from './state/GStateManager';
import { LigoGState } from './states/LigoGState';

const LIGO_STATE = new StateKey<LigoGState>('ligo');

export class LigoController {
  readonly director = new Director();
  readonly manager: GStateManager<LigoGState>;
  readonly state: LigoGState;

  constructor(
    gateway: LigoGateway,
    nodes: NodoGateway,
    onStorageChanged?: (nodeId: string, space: 'private' | 'public') => void | Promise<void>,
    onSessionRevoked?: () => void,
  ) {
    this.manager = this.director.register(LIGO_STATE);
    // The Ligo bootstrap needs the same node and public-pool data as Fluo.
    // Reuse the combined endpoint when the gateway supports it; the shared
    // in-flight read means both projections still resolve from one Worker
    // request instead of independently calling /api/nodes and
    // /api/fluo/public-storage.
    let bootstrapInFlight: Promise<FluoBootstrap> | null = null;
    const loadBootstrap = nodes.fluoBootstrap
      ? (): Promise<FluoBootstrap> => {
        if (bootstrapInFlight) return bootstrapInFlight;
        const request = nodes.fluoBootstrap!.call(nodes);
        const shared = request.finally(() => {
          if (bootstrapInFlight === shared) bootstrapInFlight = null;
        });
        bootstrapInFlight = shared;
        return shared;
      }
      : null;
    this.state = new LigoGState(
      gateway,
      new NodeLigoTransport(gateway, nodes),
      createLigoLocalStore(),
      () => loadBootstrap ? loadBootstrap().then(({ nodes: ownedNodes }) => ownedNodes) : nodes.listNodes(),
      () => loadBootstrap ? loadBootstrap().then(({ publicStorage }) => publicStorage) : nodes.publicStorage(),
      undefined,
      createLigoFileArchive(),
      onStorageChanged ?? null,
      onSessionRevoked ?? null,
    );
  }
  start(): void { this.manager.change(this.state); }
  stop(): void { this.manager.change(null); }
  shutdown(): void { this.director.shutdown(); }
}
