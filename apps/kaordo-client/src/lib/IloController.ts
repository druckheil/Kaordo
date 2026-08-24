import type { IloGateway } from './gateways/IloGateway';
import { Director, StateKey } from './state/Director';
import type { GStateManager } from './state/GStateManager';
import { IloGState } from './states/IloGState';

const ILO_STATE = new StateKey<IloGState>('ilo');

export class IloController {
  readonly director = new Director();
  readonly manager: GStateManager<IloGState>;
  readonly state: IloGState;

  constructor(gateway: IloGateway) {
    this.manager = this.director.register(ILO_STATE);
    this.state = new IloGState(gateway);
  }

  start(): void { this.manager.change(this.state); }
  stop(): void { this.manager.change(null); }
  shutdown(): void { this.director.shutdown(); }
}
