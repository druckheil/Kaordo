import { isTauri } from '@tauri-apps/api/core';
import type { IloGateway } from './IloGateway';
import { TauriIloGateway } from './TauriIloGateway';
import { WebIloGateway } from './WebIloGateway';

export function createIloGateway(native = isTauri()): IloGateway {
  return native ? new TauriIloGateway() : new WebIloGateway();
}
