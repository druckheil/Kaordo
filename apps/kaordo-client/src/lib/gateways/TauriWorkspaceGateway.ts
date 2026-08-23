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

const CANVAS_MEDIA_CHUNK_BYTES = 4 * 1_048_576;

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

  async loadCanvasMedia(workspaceId: string, mediaId: string): Promise<Blob | null> {
    const size = await this.#invoke<number | null>('canvas_media_size', {
      mediaId,
      workspaceId,
    });
    if (!size || size < 0) return null;
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < size; offset += CANVAS_MEDIA_CHUNK_BYTES) {
      const bytes = await this.#invoke<number[] | Uint8Array>('canvas_read_media_chunk', {
        length: Math.min(CANVAS_MEDIA_CHUNK_BYTES, size - offset),
        mediaId,
        offset,
        workspaceId,
      });
      const chunk = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (!chunk.length) return null;
      chunks.push(chunk);
    }
    return new Blob(chunks.map((chunk) => new Uint8Array(chunk)));
  }

  async saveCanvasMedia(workspaceId: string, mediaId: string, blob: Blob): Promise<void> {
    const existing = await this.#invoke<number | null>('canvas_media_size', {
      mediaId,
      workspaceId,
    });
    if (existing === blob.size) return;
    for (let offset = 0; offset < blob.size; offset += CANVAS_MEDIA_CHUNK_BYTES) {
      const bytes = new Uint8Array(
        await blob.slice(offset, offset + CANVAS_MEDIA_CHUNK_BYTES).arrayBuffer(),
      );
      await tauriInvoke('canvas_write_media_chunk', bytes, {
        headers: {
          'x-kaordo-media-id': encodeHeader(mediaId),
          'x-kaordo-offset': String(offset),
          'x-kaordo-total': String(blob.size),
          'x-kaordo-workspace-id': encodeHeader(workspaceId),
        },
      });
    }
  }

  async deleteCanvasMedia(workspaceId: string, mediaId: string): Promise<void> {
    await this.#invoke('canvas_delete_media', { mediaId, workspaceId });
  }
}

function encodeHeader(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
