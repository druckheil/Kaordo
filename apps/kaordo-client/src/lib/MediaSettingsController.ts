import type { MediaSettingsGateway } from './gateways/MediaSettingsGateway';
import { Director, StateKey } from './state/Director';
import type { GStateManager } from './state/GStateManager';
import { MediaSettingsGState } from './states/MediaSettingsGState';

const MEDIA_SETTINGS_STATE = new StateKey<MediaSettingsGState>('media-settings');

export class MediaSettingsController {
  readonly director = new Director();
  readonly manager: GStateManager<MediaSettingsGState>;
  readonly state: MediaSettingsGState;

  constructor(gateway: MediaSettingsGateway) {
    this.manager = this.director.register(MEDIA_SETTINGS_STATE);
    this.state = new MediaSettingsGState(gateway);
  }

  start(): void { this.manager.change(this.state); }
  shutdown(): void { this.director.shutdown(); }
}
