import { isTauri } from '@tauri-apps/api/core';
import type { AdminGateway } from './AdminGateway';
import { TauriAdminGateway } from './TauriAdminGateway';
import { WebAdminGateway } from './WebAdminGateway';

export function createAdminGateway(native = isTauri()): AdminGateway {
  return native ? new TauriAdminGateway() : new WebAdminGateway();
}
