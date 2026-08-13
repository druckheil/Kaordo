import { isTauri } from '@tauri-apps/api/core';
import type { AppearanceGateway } from './AppearanceGateway';
import { TauriAppearanceGateway } from './TauriAppearanceGateway';
import { WebAppearanceGateway } from './WebAppearanceGateway';

export function createAppearanceGateway(native = isTauri()): AppearanceGateway {
  return native ? new TauriAppearanceGateway() : new WebAppearanceGateway();
}
