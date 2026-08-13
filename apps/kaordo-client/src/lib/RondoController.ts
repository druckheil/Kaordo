import type { RondoGateway } from './gateways/RondoGateway';
import type { NodoGateway } from './gateways/NodoGateway';
import type { MediaPreferences } from './domain/mediaSettings';
import { NodeRondoChatGateway } from './gateways/NodeRondoChatGateway';
import { NodeRondoTransport } from './gateways/NodeRondoTransport';
import { NodeRondoVoiceGateway } from './gateways/NodeRondoVoiceGateway';
import { RondoVoiceSession } from './services/RondoVoiceSession';
import { Director, StateKey } from './state/Director';
import type { GStateManager } from './state/GStateManager';
import { RondoGState } from './states/RondoGState';

const RONDO_STATE = new StateKey<RondoGState>('rondo');

export class RondoController {
  readonly director = new Director();
  readonly manager: GStateManager<RondoGState>;
  readonly state: RondoGState;

  constructor(gateway: RondoGateway, nodes: NodoGateway, media: MediaPreferences) {
    this.manager = this.director.register(RONDO_STATE);
    const transport = new NodeRondoTransport(gateway, nodes);
    this.state = new RondoGState(
      gateway,
      new NodeRondoChatGateway(transport),
      new RondoVoiceSession(new NodeRondoVoiceGateway(transport), media),
    );
  }

  start(): void { this.manager.change(this.state); }
  stop(): void { this.manager.change(null); }
  shutdown(): void { this.director.shutdown(); }
}
