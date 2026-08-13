import { isTauri } from '@tauri-apps/api/core';
import type { RondoGateway } from './RondoGateway';
import { TauriRondoGateway } from './TauriRondoGateway';
import { WebRondoGateway } from './WebRondoGateway';

export function createRondoGateway(native = isTauri()): RondoGateway {
  return native ? new TauriRondoGateway() : new WebRondoGateway();
}
