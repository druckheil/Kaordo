import type { LigoGateway } from './gateways/LigoGateway';
import type { NodoGateway } from './gateways/NodoGateway';
import { NodeLigoTransport } from './gateways/NodeLigoTransport';
import { createLigoLocalStore } from './services/LigoLocalStore';
import { Director, StateKey } from './state/Director';
import type { GStateManager } from './state/GStateManager';
import { LigoGState } from './states/LigoGState';

const LIGO_STATE = new StateKey<LigoGState>('ligo');

export class LigoController {
  readonly director = new Director();
  readonly manager: GStateManager<LigoGState>;
  readonly state: LigoGState;

  constructor(gateway: LigoGateway, nodes: NodoGateway) {
    this.manager = this.director.register(LIGO_STATE);
    this.state = new LigoGState(
      gateway,
      new NodeLigoTransport(gateway, nodes),
      createLigoLocalStore(),
      () => nodes.listNodes(),
      () => nodes.publicStorage(),
    );
  }
  start(): void { this.manager.change(this.state); }
  stop(): void { this.manager.change(null); }
  shutdown(): void { this.director.shutdown(); }
}
