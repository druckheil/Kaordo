import { isTauri } from '@tauri-apps/api/core';
import type { AuthGateway } from './AuthGateway';
import { TauriAuthGateway } from './TauriAuthGateway';
import { WebAuthGateway } from './WebAuthGateway';

export function createAuthGateway(native = isTauri()): AuthGateway {
  return native ? new TauriAuthGateway() : new WebAuthGateway();
}
