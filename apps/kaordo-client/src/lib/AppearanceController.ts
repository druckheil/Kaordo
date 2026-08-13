import type { AppearanceGateway } from './gateways/AppearanceGateway';
import { Director, StateKey } from './state/Director';
import type { GStateManager } from './state/GStateManager';
import { AppearanceGState } from './states/AppearanceGState';

const APPEARANCE_STATE = new StateKey<AppearanceGState>('appearance');

export class AppearanceController {
  readonly director = new Director();
  readonly manager: GStateManager<AppearanceGState>;
  readonly state: AppearanceGState;

  constructor(gateway: AppearanceGateway) {
    this.manager = this.director.register(APPEARANCE_STATE);
    this.state = new AppearanceGState(gateway);
  }

  start(): void { this.manager.change(this.state); }
  shutdown(): void { this.director.shutdown(); }
}
