import { isTauri } from '@tauri-apps/api/core';
import type { NodoGateway } from './NodoGateway';
import { TauriNodoGateway } from './TauriNodoGateway';
import { WebNodoGateway } from './WebNodoGateway';

export function createNodoGateway(native = isTauri()): NodoGateway {
  return native ? new TauriNodoGateway() : new WebNodoGateway();
}
