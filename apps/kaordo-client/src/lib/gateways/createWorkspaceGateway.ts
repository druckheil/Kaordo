import { isTauri } from '@tauri-apps/api/core';
import type { WorkspaceGateway } from './WorkspaceGateway';
import { TauriWorkspaceGateway } from './TauriWorkspaceGateway';
import { WebWorkspaceGateway } from './WebWorkspaceGateway';

/** Selects persistence once at the application boundary; UI/state stay platform-neutral. */
export function createWorkspaceGateway(native = isTauri()): WorkspaceGateway {
  return native
    ? new TauriWorkspaceGateway()
    : new WebWorkspaceGateway();
}
