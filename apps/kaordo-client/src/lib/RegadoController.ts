import type { AdminGateway } from './gateways/AdminGateway';
import { Director, StateKey } from './state/Director';
import type { GStateManager } from './state/GStateManager';
import { RegadoGState } from './states/RegadoGState';

const REGADO_STATE = new StateKey<RegadoGState>('regado');

export class RegadoController {
  readonly director = new Director();
  readonly manager: GStateManager<RegadoGState>;
  readonly state: RegadoGState;

  constructor(gateway: AdminGateway) {
    this.manager = this.director.register(REGADO_STATE);
    this.state = new RegadoGState(gateway);
  }

  start(): void {
    this.manager.change(this.state);
  }

  stop(): void {
    this.manager.change(null);
  }

  shutdown(): void {
    this.director.shutdown();
  }
}
