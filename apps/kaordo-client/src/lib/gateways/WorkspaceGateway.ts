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
  saveCanvasDocument(
    workspaceId: string,
    document: WorkspaceCanvasDocument,
  ): Promise<void>;
  updateObjectDocument(
    workspaceId: string,
    objectId: string,
    document: ObjectDocument,
  ): Promise<ObjectSummary>;
}
