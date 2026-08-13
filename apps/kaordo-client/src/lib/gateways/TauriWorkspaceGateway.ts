import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import {
  normalizeWorkspaceDetail,
  normalizeWorkspaceLibrary,
  normalizeObjectSummary,
  serializeObjectDocument,
  parseWorkspaceCanvasDocument,
  serializeWorkspaceCanvasDocument,
  type ObjectDocument,
  type ObjectSummary,
  type ObjectSummaryPayload,
  type WorkspaceDetail,
  type WorkspaceCanvasDocument,
  type WorkspaceDetailPayload,
  type WorkspaceLibrary,
  type WorkspaceLibraryPayload,
  type WorkspaceSummary,
} from '../domain/workspace';
import type { WorkspaceGateway } from './WorkspaceGateway';

export type TauriInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export class TauriWorkspaceGateway implements WorkspaceGateway {
  readonly platform = 'desktop' as const;
  readonly #invoke: TauriInvoke;

  constructor(invoke: TauriInvoke = tauriInvoke) {
    this.#invoke = invoke;
  }

  async listWorkspaces(): Promise<WorkspaceLibrary> {
    const library = await this.#invoke<WorkspaceLibraryPayload>('list_workspaces');
    return normalizeWorkspaceLibrary(library);
  }

  async createWorkspace(name: string): Promise<WorkspaceDetail> {
    const workspace = await this.#invoke<WorkspaceSummary>('create_workspace', { name });
    return normalizeWorkspaceDetail(workspace);
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.#invoke('delete_workspace', { workspaceId });
  }

  async openWorkspace(workspaceId: string): Promise<WorkspaceDetail> {
    const workspace = await this.#invoke<WorkspaceDetailPayload>('open_workspace', {
      workspaceId,
    });
    return normalizeWorkspaceDetail(workspace);
  }

  createObject(workspaceId: string, title: string): Promise<ObjectSummary> {
    return this.#invoke<ObjectSummaryPayload>('create_object', { workspaceId, title })
      .then(normalizeObjectSummary);
  }

  async deleteObject(workspaceId: string, objectId: string): Promise<void> {
    await this.#invoke('delete_object', { objectId, workspaceId });
  }

  async updateObjectDocument(
    workspaceId: string,
    objectId: string,
    document: ObjectDocument,
  ): Promise<ObjectSummary> {
    const object = await this.#invoke<ObjectSummaryPayload>('update_object_document', {
      documentJson: serializeObjectDocument(document),
      objectId,
      workspaceId,
    });
    return normalizeObjectSummary(object);
  }

  async loadCanvasDocument(workspaceId: string): Promise<WorkspaceCanvasDocument> {
    const serialized = await this.#invoke<string | null>('load_canvas_document', {
      workspaceId,
    });
    return parseWorkspaceCanvasDocument(serialized);
  }

  async saveCanvasDocument(
    workspaceId: string,
    document: WorkspaceCanvasDocument,
  ): Promise<void> {
    await this.#invoke('save_canvas_document', {
      documentJson: serializeWorkspaceCanvasDocument(document),
      workspaceId,
    });
  }
}
