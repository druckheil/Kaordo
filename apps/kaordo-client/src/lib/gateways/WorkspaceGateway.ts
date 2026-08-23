import type {
  ObjectDocument,
  ObjectSummary,
  WorkspaceCanvasDocument,
  WorkspaceDetail,
  WorkspaceLibrary,
} from '../domain/workspace';

export interface WorkspaceGateway {
  readonly platform: 'desktop' | 'web';
  createObject(workspaceId: string, title: string): Promise<ObjectSummary>;
  createWorkspace(name: string): Promise<WorkspaceDetail>;
  deleteObject(workspaceId: string, objectId: string): Promise<void>;
  deleteWorkspace(workspaceId: string): Promise<void>;
  listWorkspaces(): Promise<WorkspaceLibrary>;
  openWorkspace(workspaceId: string): Promise<WorkspaceDetail>;
  loadCanvasDocument(workspaceId: string): Promise<WorkspaceCanvasDocument>;
  loadCanvasMedia(workspaceId: string, mediaId: string): Promise<Blob | null>;
  saveCanvasDocument(
    workspaceId: string,
    document: WorkspaceCanvasDocument,
  ): Promise<void>;
  saveCanvasMedia(workspaceId: string, mediaId: string, blob: Blob): Promise<void>;
  deleteCanvasMedia(workspaceId: string, mediaId: string): Promise<void>;
  updateObjectDocument(
    workspaceId: string,
    objectId: string,
    document: ObjectDocument,
  ): Promise<ObjectSummary>;
}
