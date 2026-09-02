import { isTauri } from '@tauri-apps/api/core';
import type { NodoGateway } from './NodoGateway';
import { NodeProfileGateway } from './NodeProfileGateway';
import { TauriProfileApiGateway } from './TauriProfileApiGateway';
import { WebProfileApiGateway } from './WebProfileApiGateway';
import type { ProfileDirectoryGateway } from './ProfileGateway';

export function createProfileGateway(nodes: NodoGateway, native = isTauri()): NodeProfileGateway {
  return new NodeProfileGateway(nodes, native ? new TauriProfileApiGateway() : new WebProfileApiGateway());
}

/** Creates the read-only directory adapter used by Fluo author previews. */
export function createProfileDirectoryGateway(native = isTauri()): ProfileDirectoryGateway {
  return native ? new TauriProfileApiGateway() : new WebProfileApiGateway();
}
