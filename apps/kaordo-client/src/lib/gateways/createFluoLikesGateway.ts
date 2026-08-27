import { isTauri } from '@tauri-apps/api/core';
import type { FluoLikesGateway } from './FluoGateway';
import { TauriFluoLikesGateway } from './TauriFluoLikesGateway';
import { WebFluoLikesGateway } from './WebFluoLikesGateway';

export function createFluoLikesGateway(native = isTauri()): FluoLikesGateway {
  return native ? new TauriFluoLikesGateway() : new WebFluoLikesGateway();
}
