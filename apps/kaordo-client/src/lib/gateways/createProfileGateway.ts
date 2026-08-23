import { isTauri } from '@tauri-apps/api/core';
import type { NodoGateway } from './NodoGateway';
import { NodeProfileGateway } from './NodeProfileGateway';
import { TauriProfileApiGateway } from './TauriProfileApiGateway';
import { WebProfileApiGateway } from './WebProfileApiGateway';

export function createProfileGateway(nodes: NodoGateway, native = isTauri()): NodeProfileGateway {
  return new NodeProfileGateway(nodes, native ? new TauriProfileApiGateway() : new WebProfileApiGateway());
}
