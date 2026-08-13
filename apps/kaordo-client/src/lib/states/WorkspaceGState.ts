import type {
  ObjectDocument,
  ObjectSummary,
  WorkspaceDetail,
  WorkspaceSummary,
} from '../domain/workspace';
import { workspaceSummary } from '../domain/workspace';
import type { WorkspaceGateway } from '../gateways/WorkspaceGateway';
import { GState } from '../state/GState';

export type LoadPhase = 'idle' | 'loading' | 'ready' | 'error';
export type OpenPhase = 'idle' | 'opening' | 'error';

export type WorkspaceSnapshot = {
  active: WorkspaceDetail | null;
  createObjectError: string | null;
  createWorkspaceError: string | null;
  files: WorkspaceSummary[];
  isCreatingObject: boolean;
  isCreatingWorkspace: boolean;
  libraryError: string | null;
  libraryPhase: LoadPhase;
  libraryWarnings: string[];
  openError: string | null;
  opening: WorkspaceSummary | null;
  openPhase: OpenPhase;
};

export type WorkspaceGStateOptions = {
  autoload?: boolean;
  files?: WorkspaceSummary[];
  workspace?: WorkspaceDetail | null;
};

/** Coordinates workspace lifecycle and delegates persistence to a platform gateway. */
export class WorkspaceGState extends GState<WorkspaceSnapshot> {
  readonly #autoload: boolean;
  readonly #gateway: WorkspaceGateway;
  #createWorkspaceAttempt = 0;
  #libraryAttempt = 0;
  #libraryMutation = 0;
  #objectAttempt = 0;
  #openAttempt = 0;

  constructor(gateway: WorkspaceGateway, options: WorkspaceGStateOptions = {}) {
    const active = options.workspace ? copyWorkspace(options.workspace) : null;
    super({
      active,
      createObjectError: null,
      createWorkspaceError: null,
      files: (options.files ?? []).map((file) => ({ ...file })),
      isCreatingObject: false,
      isCreatingWorkspace: false,
      libraryError: null,
      libraryPhase: 'idle',
      libraryWarnings: [],
      openError: null,
      opening: active ? workspaceSummary(active) : null,
      openPhase: 'idle',
    });
    this.#gateway = gateway;
    this.#autoload = options.autoload ?? true;
  }

  override enter(): void {
    if (this.#autoload) void this.loadLibrary();
  }

  override exit(): void {
    this.#libraryAttempt += 1;
    this.invalidateWorkspaceCommands();
    this.patch({
      isCreatingObject: false,
      isCreatingWorkspace: false,
      libraryPhase:
        this.snapshot.libraryPhase === 'loading'
          ? 'idle'
          : this.snapshot.libraryPhase,
      openPhase:
        this.snapshot.openPhase === 'opening'
          ? 'idle'
          : this.snapshot.openPhase,
    });
  }

  async loadLibrary(): Promise<boolean> {
    const attempt = ++this.#libraryAttempt;
    const mutation = this.#libraryMutation;
    this.patch({
      libraryError: null,
      libraryPhase: 'loading',
      libraryWarnings: [],
    });

    try {
      const library = await this.#gateway.listWorkspaces();
      if (attempt !== this.#libraryAttempt) return false;
      if (mutation !== this.#libraryMutation) return this.loadLibrary();
      this.patch({
        files: library.files,
        libraryPhase: 'ready',
        libraryWarnings: library.warnings,
      });
      return true;
    } catch (error) {
      if (attempt !== this.#libraryAttempt) return false;
      this.patch({
        libraryError: readableError(
          error,
          'The workspace library could not be loaded.',
        ),
        libraryPhase: 'error',
      });
      return false;
    }
  }

  async createWorkspace(name: string): Promise<WorkspaceDetail | null> {
    if (this.snapshot.isCreatingWorkspace) return null;
    this.invalidateWorkspaceCommands();
    const attempt = this.#createWorkspaceAttempt;
    this.patch({
      createWorkspaceError: null,
      isCreatingObject: false,
      isCreatingWorkspace: true,
    });

    try {
      const workspace = await this.#gateway.createWorkspace(name.trim());
      if (attempt !== this.#createWorkspaceAttempt) return null;
      this.#libraryMutation += 1;
      this.patch({
        active: workspace,
        files: upsertFile(this.snapshot.files, workspaceSummary(workspace)),
        libraryError: null,
        opening: workspaceSummary(workspace),
        openError: null,
        openPhase: 'idle',
      });
      return workspace;
    } catch (error) {
      if (attempt !== this.#createWorkspaceAttempt) return null;
      this.patch({ createWorkspaceError: readableError(error) });
      return null;
    } finally {
      if (attempt === this.#createWorkspaceAttempt) {
        this.patch({ isCreatingWorkspace: false });
      }
    }
  }

  async openWorkspace(file: WorkspaceSummary): Promise<WorkspaceDetail | null> {
    this.invalidateWorkspaceCommands();
    const attempt = this.#openAttempt;
    this.patch({
      active: null,
      createObjectError: null,
      createWorkspaceError: null,
      isCreatingObject: false,
      isCreatingWorkspace: false,
      opening: file,
      openError: null,
      openPhase: 'opening',
    });

    try {
      const workspace = await this.#gateway.openWorkspace(file.id);
      if (attempt !== this.#openAttempt) return null;
      this.patch({
        active: workspace,
        files: updateFile(this.snapshot.files, workspaceSummary(workspace)),
        opening: workspaceSummary(workspace),
        openPhase: 'idle',
      });
      return workspace;
    } catch (error) {
      if (attempt !== this.#openAttempt) return null;
      this.patch({
        openError: readableError(error, 'The workspace could not be opened.'),
        openPhase: 'error',
      });
      return null;
    }
  }

  retryOpenWorkspace(): Promise<WorkspaceDetail | null> {
    const file = this.snapshot.opening;
    return file ? this.openWorkspace(file) : Promise.resolve(null);
  }

  closeWorkspace(): void {
    this.invalidateWorkspaceCommands();
    this.patch({
      active: null,
      createObjectError: null,
      createWorkspaceError: null,
      isCreatingObject: false,
      isCreatingWorkspace: false,
      openError: null,
      opening: null,
      openPhase: 'idle',
    });
  }

  async createObject(title: string): Promise<ObjectSummary | null> {
    const workspace = this.snapshot.active;
    if (!workspace || this.snapshot.isCreatingObject) return null;

    const workspaceId = workspace.id;
    const attempt = ++this.#objectAttempt;
    this.patch({ createObjectError: null, isCreatingObject: true });
    try {
      const object = await this.#gateway.createObject(workspaceId, title.trim());
      if (
        attempt !== this.#objectAttempt ||
        this.snapshot.active?.id !== workspaceId
      ) {
        return null;
      }

      const active: WorkspaceDetail = {
        ...this.snapshot.active,
        objects: [object, ...this.snapshot.active.objects],
        warning: object.warning ?? this.snapshot.active.warning,
      };
      this.patch({ active, opening: workspaceSummary(active) });
      return object;
    } catch (error) {
      if (
        attempt === this.#objectAttempt &&
        this.snapshot.active?.id === workspaceId
      ) {
        this.patch({
          createObjectError: readableError(
            error,
            'The object could not be created.',
          ),
        });
      }
      return null;
    } finally {
      if (attempt === this.#objectAttempt) {
        this.patch({ isCreatingObject: false });
      }
    }
  }

  async deleteWorkspace(workspaceId: string): Promise<boolean> {
    try {
      await this.#gateway.deleteWorkspace(workspaceId);
      this.#libraryMutation += 1;
      if (this.snapshot.active?.id === workspaceId || this.snapshot.opening?.id === workspaceId) {
        this.#openAttempt += 1;
        this.#objectAttempt += 1;
      }
      const deletingActive = this.snapshot.active?.id === workspaceId;
      this.patch({
        active: deletingActive ? null : this.snapshot.active,
        files: this.snapshot.files.filter((file) => file.id !== workspaceId),
        libraryError: null,
        opening: this.snapshot.opening?.id === workspaceId
          ? null
          : this.snapshot.opening,
        openError: deletingActive ? null : this.snapshot.openError,
        openPhase: deletingActive ? 'idle' : this.snapshot.openPhase,
      });
      return true;
    } catch (error) {
      this.patch({
        libraryError: readableError(error, 'The workspace could not be deleted.'),
      });
      return false;
    }
  }

  async deleteObject(workspaceId: string, objectId: string): Promise<boolean> {
    if (this.snapshot.active?.id !== workspaceId) return false;
    try {
      await this.#gateway.deleteObject(workspaceId, objectId);
      if (this.snapshot.active?.id !== workspaceId) return true;
      const active: WorkspaceDetail = {
        ...this.snapshot.active,
        objects: this.snapshot.active.objects.filter(
          (object) => object.id !== objectId,
        ),
      };
      this.patch({ active, opening: workspaceSummary(active) });
      return true;
    } catch (error) {
      this.patch({
        createObjectError: readableError(error, 'The object could not be deleted.'),
      });
      return false;
    }
  }

  async updateObjectDocument(
    workspaceId: string,
    objectId: string,
    document: ObjectDocument,
  ): Promise<ObjectSummary> {
    if (this.snapshot.active?.id !== workspaceId) {
      throw new Error('The workspace is no longer open.');
    }
    const updated = await this.#gateway.updateObjectDocument(
      workspaceId,
      objectId,
      document,
    );
    if (this.snapshot.active?.id !== workspaceId) return updated;
    const active: WorkspaceDetail = {
      ...this.snapshot.active,
      objects: this.snapshot.active.objects.map((object) =>
        object.id === objectId ? updated : object,
      ),
    };
    this.patch({ active, opening: workspaceSummary(active) });
    return updated;
  }

  clearCreateWorkspaceError(): void {
    if (this.snapshot.createWorkspaceError) {
      this.patch({ createWorkspaceError: null });
    }
  }

  clearCreateObjectError(): void {
    if (this.snapshot.createObjectError) this.patch({ createObjectError: null });
  }

  private invalidateWorkspaceCommands(): void {
    this.#createWorkspaceAttempt += 1;
    this.#objectAttempt += 1;
    this.#openAttempt += 1;
  }

  private patch(patch: Partial<WorkspaceSnapshot>): void {
    this.publish({ ...this.snapshot, ...patch });
  }
}

function copyWorkspace(workspace: WorkspaceDetail): WorkspaceDetail {
  return {
    ...workspace,
    objects: [...workspace.objects],
    warnings: [...workspace.warnings],
  };
}

function upsertFile(
  currentFiles: WorkspaceSummary[],
  file: WorkspaceSummary,
): WorkspaceSummary[] {
  return [
    file,
    ...currentFiles.filter((candidate) => candidate.path !== file.path),
  ];
}

function updateFile(
  currentFiles: WorkspaceSummary[],
  updatedFile: WorkspaceSummary,
): WorkspaceSummary[] {
  return currentFiles.map((file) =>
    file.id === updatedFile.id ? updatedFile : file,
  );
}

function readableError(
  error: unknown,
  fallback = 'The workspace could not be created.',
): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
