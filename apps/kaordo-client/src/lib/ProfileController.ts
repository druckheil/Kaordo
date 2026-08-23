import type { ProfileGateway } from './gateways/ProfileGateway';
import { Director, StateKey } from './state/Director';
import type { GStateManager } from './state/GStateManager';
import { ProfileGState } from './states/ProfileGState';

const PROFILE_STATE = new StateKey<ProfileGState>('profile');

export class ProfileController {
  readonly director = new Director();
  readonly manager: GStateManager<ProfileGState>;
  readonly state: ProfileGState;

  constructor(gateway: ProfileGateway) {
    this.manager = this.director.register(PROFILE_STATE);
    this.state = new ProfileGState(gateway);
  }

  start(): void { this.manager.change(this.state); }
  stop(): void { this.manager.change(null); }
  reset(): void { this.state.reset(); }
  shutdown(): void { this.director.shutdown(); }
}
