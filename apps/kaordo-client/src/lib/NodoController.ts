import type { NodoGateway } from './gateways/NodoGateway';
import { Director, StateKey } from './state/Director';
import type { GStateManager } from './state/GStateManager';
import { NodoGState } from './states/NodoGState';
import { NodoRegistry } from './services/NodoRegistry';

const NODO_STATE = new StateKey<NodoGState>('nodo');

export class NodoController {
  readonly director = new Director();
  readonly manager: GStateManager<NodoGState>;
  readonly state: NodoGState;

  constructor(gateway: NodoGateway, registry = new NodoRegistry()) {
    this.manager = this.director.register(NODO_STATE);
    this.state = new NodoGState(gateway, registry);
  }

  start(): void { this.manager.change(this.state); }
  stop(): void { this.manager.change(null); }
  shutdown(): void { this.director.shutdown(); }
}
