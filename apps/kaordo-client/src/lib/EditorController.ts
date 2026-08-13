import type {
  WorkspaceDetail,
  WorkspaceSummary,
} from './domain/workspace';
import type { WorkspaceGateway } from './gateways/WorkspaceGateway';
import type { FluoGateway } from './gateways/FluoGateway';
import type { NodoGateway } from './gateways/NodoGateway';
import type { NodoRegistry } from './services/NodoRegistry';
import { CanvasService } from './services/CanvasService';
import { Director, StateKey } from './state/Director';
import type { GStateManager } from './state/GStateManager';
import { CanvasGState } from './states/CanvasGState';
import { FluoGState } from './states/FluoGState';
import { WorkspaceGState } from './states/WorkspaceGState';

export const WORKSPACE_STATE = new StateKey<WorkspaceGState>('workspace');
export const CANVAS_STATE = new StateKey<CanvasGState>('canvas');
export const FLUO_STATE = new StateKey<FluoGState>('fluo');

export type EditorControllerOptions = {
  autoloadWorkspaceLibrary?: boolean;
  files?: WorkspaceSummary[];
  fluoGateway?: FluoGateway;
  nodoGateway?: NodoGateway;
  nodoRegistry?: NodoRegistry;
  workspace?: WorkspaceDetail | null;
};

/** Application composition root: wiring only, mirroring Prafonto's controller. */
export class EditorController {
  readonly canvas: CanvasService;
  readonly canvasManager: GStateManager<CanvasGState>;
  readonly canvasState: CanvasGState;
  readonly director = new Director();
  readonly fluoManager: GStateManager<FluoGState>;
  readonly fluoState: FluoGState;
  readonly workspaceManager: GStateManager<WorkspaceGState>;
  readonly workspaceState: WorkspaceGState;
  #started = false;

  constructor(gateway: WorkspaceGateway, options: EditorControllerOptions = {}) {
    this.workspaceManager = this.director.register(WORKSPACE_STATE);
    this.canvasManager = this.director.register(CANVAS_STATE);
    this.fluoManager = this.director.register(FLUO_STATE);
    this.workspaceState = new WorkspaceGState(gateway, {
      autoload: options.autoloadWorkspaceLibrary,
      files: options.files,
      workspace: options.workspace,
    });
    this.canvasState = new CanvasGState();
    this.fluoState = new FluoGState(
      options.fluoGateway ?? EMPTY_FLUO_GATEWAY,
      options.nodoGateway ?? EMPTY_NODO_GATEWAY,
      { registry: options.nodoRegistry },
    );
    this.canvas = new CanvasService(
      this.canvasState,
      () => this.workspaceState.snapshot.active,
      (workspaceId, objectId, document) =>
        this.workspaceState.updateObjectDocument(workspaceId, objectId, document),
      (workspaceId) => gateway.loadCanvasDocument(workspaceId),
      (workspaceId, document) =>
        gateway.saveCanvasDocument(workspaceId, document),
      (workspaceId, objectId) => this.deleteObject(workspaceId, objectId),
    );
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.workspaceManager.change(this.workspaceState);
    this.canvasManager.change(this.canvasState);
    const active = this.workspaceState.snapshot.active;
    if (active) this.canvas.enterWorkspace(active);
  }

  startFluo(): void {
    if (this.#started) this.fluoManager.change(this.fluoState);
  }

  stopFluo(): void {
    this.fluoManager.change(null);
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    this.canvas.leaveWorkspace(this.workspaceState.snapshot.active?.id);
    this.workspaceState.closeWorkspace();
    this.stopFluo();
    this.canvasManager.change(null);
    this.workspaceManager.change(null);
  }

  shutdown(): void {
    this.stop();
    this.director.shutdown();
  }

  async createWorkspace(name: string): Promise<WorkspaceDetail | null> {
    const currentId = this.workspaceState.snapshot.active?.id;
    if (currentId) this.canvas.leaveWorkspace(currentId);
    const workspace = await this.workspaceState.createWorkspace(name);
    if (workspace) this.canvas.enterWorkspace(workspace);
    return workspace;
  }

  async openWorkspace(file: WorkspaceSummary): Promise<WorkspaceDetail | null> {
    const currentId = this.workspaceState.snapshot.active?.id;
    if (currentId) this.canvas.leaveWorkspace(currentId);
    else this.canvas.clearInteractions();

    const workspace = await this.workspaceState.openWorkspace(file);
    if (workspace) this.canvas.enterWorkspace(workspace);
    return workspace;
  }

  async retryOpenWorkspace(): Promise<WorkspaceDetail | null> {
    const workspace = await this.workspaceState.retryOpenWorkspace();
    if (workspace) this.canvas.enterWorkspace(workspace);
    return workspace;
  }

  closeWorkspace(): void {
    this.canvas.leaveWorkspace(this.workspaceState.snapshot.active?.id);
    this.workspaceState.closeWorkspace();
  }

  async deleteWorkspace(workspaceId: string): Promise<boolean> {
    const wasActive = this.workspaceState.snapshot.active?.id === workspaceId;
    await this.canvas.settleWorkspaceWrites(workspaceId);
    const deleted = await this.workspaceState.deleteWorkspace(workspaceId);
    if (deleted) {
      if (wasActive) this.canvas.leaveWorkspace(workspaceId);
      this.canvas.forgetWorkspace(workspaceId);
    }
    return deleted;
  }

  async deleteObject(workspaceId: string, objectId: string): Promise<boolean> {
    const deleted = await this.workspaceState.deleteObject(workspaceId, objectId);
    if (!deleted) {
      this.canvasState.announce('Object could not be deleted.');
      return false;
    }
    try {
      await this.canvas.removeObjectReferences(workspaceId, objectId);
    } catch {
      this.canvasState.announce(
        'Object deleted. Its old canvas placement could not be cleaned up.',
      );
      return true;
    }
    this.canvasState.announce('Object deleted.');
    return true;
  }
}

const EMPTY_FLUO_GATEWAY: FluoGateway = {
  deletePost: async () => {},
  listFeedPage: async () => ({ cursor: null, hasMore: false, posts: [] }),
  loadMedia: async () => { throw new Error('Fluo media is unavailable.'); },
  publishPost: async () => { throw new Error('Fluo storage is unavailable.'); },
};

const EMPTY_NODO_GATEWAY: NodoGateway = {
  accessNode: async () => { throw new Error('Nodo access is unavailable.'); },
  cancelPublicStorage: async () => {},
  clearStorage: async () => { throw new Error('Nodo storage is unavailable.'); },
  clearPrivateStorage: async () => { throw new Error('Private Nodo storage is unavailable.'); },
  commitPublicStorage: async () => {},
  deleteNode: async () => {},
  listNodes: async () => [],
  listFeedNodeIds: async () => [],
  publicStorage: async () => ({
    limitBytes: 1_073_741_824,
    nodeCandidates: [],
    reservedBytes: 0,
    usedBytes: 0,
  }),
  releasePublicPost: async () => {},
  renewPublicStorage: async () => { throw new Error('Public Nodo storage is unavailable.'); },
  reservePublicStorage: async () => { throw new Error('Public Nodo storage is unavailable.'); },
  requestQuickTest: async () => ({ completedAt: 0, diskReadBps: 1, diskWriteBps: 1 }),
  updatePolicy: async (_nodeId, policy) => ({ ...policy, ownerOnly: true }),
  updateSpaces: async () => { throw new Error('Nodo allocation is unavailable.'); },
};
