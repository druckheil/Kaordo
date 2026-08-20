import type { NodoGateway } from './gateways/NodoGateway';
import { Director, StateKey } from './state/Director';
import type { GStateManager } from './state/GStateManager';
import { PublicStorageGState } from './states/PublicStorageGState';

const PUBLIC_STORAGE_STATE = new StateKey<PublicStorageGState>('public-storage');

export class PublicStorageController {
  readonly director = new Director();
  readonly manager: GStateManager<PublicStorageGState>;
  readonly state: PublicStorageGState;

  constructor(gateway: NodoGateway) {
    this.manager = this.director.register(PUBLIC_STORAGE_STATE);
    this.state = new PublicStorageGState(gateway);
  }

  start(): void {
    this.manager.change(this.state);
  }

  stop(): void {
    this.manager.change(null);
  }

  reset(): void {
    this.state.reset();
  }

  shutdown(): void {
    this.director.shutdown();
  }
}
