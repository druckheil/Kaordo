import { describe, expect, it, vi } from 'vitest';
import { EditorController } from './EditorController';
import type { ObjectSummary, WorkspaceDetail } from './domain/workspace';
import type { WorkspaceGateway } from './gateways/WorkspaceGateway';

const workspace: WorkspaceDetail = {
  id: 'workspace-1',
  name: 'Research',
  objects: [],
  path: '/Research.vdw',
  warnings: [],
};

function gateway(
  overrides: Partial<WorkspaceGateway> = {},
): WorkspaceGateway {
  return {
    platform: 'desktop',
    createObject: vi.fn(),
    createWorkspace: vi.fn(),
    deleteObject: vi.fn(),
    deleteWorkspace: vi.fn(),
    listWorkspaces: vi.fn().mockResolvedValue({ files: [], warnings: [] }),
    loadCanvasDocument: vi.fn().mockResolvedValue({
      elements: [],
      placements: [],
      version: 1,
    }),
    openWorkspace: vi.fn(),
    saveCanvasDocument: vi.fn(),
    updateObjectDocument: vi.fn(),
    ...overrides,
  };
}

describe('EditorController lifecycle', () => {
  it('starts state work only when the controller starts', () => {
    const listWorkspaces = vi.fn().mockResolvedValue({ files: [], warnings: [] });
    const editor = new EditorController(gateway({ listWorkspaces }));

    expect(listWorkspaces).not.toHaveBeenCalled();
    editor.start();
    expect(listWorkspaces).toHaveBeenCalledOnce();

    editor.shutdown();
  });

  it('stops workspace state while locked and can start again', () => {
    const listWorkspaces = vi.fn().mockResolvedValue({ files: [], warnings: [] });
    const editor = new EditorController(gateway({ listWorkspaces }), {
      workspace,
    });

    editor.start();
    expect(editor.workspaceManager.current).toBe(editor.workspaceState);
    editor.stop();
    expect(editor.workspaceManager.current).toBeNull();
    expect(editor.workspaceState.snapshot.active).toBeNull();

    editor.start();
    expect(editor.workspaceManager.current).toBe(editor.workspaceState);
    expect(listWorkspaces).toHaveBeenCalledTimes(2);
    editor.shutdown();
  });

  it('ignores an object command completed after its workspace closes', async () => {
    let finishCreate!: (object: ObjectSummary) => void;
    const createObject = vi.fn(
      () =>
        new Promise<ObjectSummary>((resolve) => {
          finishCreate = resolve;
        }),
    );
    const editor = new EditorController(gateway({ createObject }), {
      autoloadWorkspaceLibrary: false,
      workspace,
    });
    editor.start();

    const creation = editor.workspaceState.createObject('Late object');
    expect(editor.workspaceState.snapshot.isCreatingObject).toBe(true);
    editor.closeWorkspace();
    finishCreate({
      document: { elements: [], version: 1 },
      id: 'object-1',
      title: 'Late object',
      type: 'Knowledge object',
    });

    await expect(creation).resolves.toBeNull();
    expect(editor.workspaceState.snapshot.active).toBeNull();
    expect(editor.workspaceState.snapshot.isCreatingObject).toBe(false);

    editor.shutdown();
  });
});
