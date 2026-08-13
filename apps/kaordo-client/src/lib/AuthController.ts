import type { AuthUser } from './domain/auth';
import type { AuthGateway } from './gateways/AuthGateway';
import { Director, StateKey } from './state/Director';
import type { GStateManager } from './state/GStateManager';
import { AuthGState } from './states/AuthGState';

const AUTH_STATE = new StateKey<AuthGState>('authentication');

export class AuthController {
  readonly director = new Director();
  readonly manager: GStateManager<AuthGState>;
  readonly state: AuthGState;

  constructor(gateway: AuthGateway, initialUser: AuthUser | null = null) {
    this.manager = this.director.register(AUTH_STATE);
    this.state = new AuthGState(gateway, initialUser);
  }

  start(): void {
    this.manager.change(this.state);
  }

  shutdown(): void {
    this.director.shutdown();
  }
}
