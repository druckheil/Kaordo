import { isTauri } from '@tauri-apps/api/core';
import type { LigoGateway } from './LigoGateway';
import { TauriLigoGateway } from './TauriLigoGateway';
import { WebLigoGateway } from './WebLigoGateway';

export function createLigoGateway(native = isTauri()): LigoGateway {
  return native ? new TauriLigoGateway() : new WebLigoGateway();
}
