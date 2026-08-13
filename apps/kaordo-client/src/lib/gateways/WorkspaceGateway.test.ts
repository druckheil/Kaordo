import { describe, expect, it } from 'vitest';
import { createWorkspaceGateway } from './createWorkspaceGateway';
import { TauriWorkspaceGateway, type TauriInvoke } from './TauriWorkspaceGateway';
import { WebWorkspaceGateway } from './WebWorkspaceGateway';

describe('workspace gateways', () => {
  it('selects persistence at the composition boundary', () => {
    expect(createWorkspaceGateway(true)).toBeInstanceOf(TauriWorkspaceGateway);
    expect(createWorkspaceGateway(false)).toBeInstanceOf(WebWorkspaceGateway);
  });

  it('keeps Tauri command names and argument shapes behind the gateway', async () => {
    const calls: Array<{ args?: Record<string, unknown>; command: string }> = [];
    const invoke: TauriInvoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => {
      calls.push({ command, args });
      const responses: Record<string, unknown> = {
        create_object: { id: 'object-1', title: 'Note', type: 'Knowledge object' },
        create_workspace: { id: 'workspace-1', name: 'Research', path: '/Research.vdw' },
        list_workspaces: {},
        load_canvas_document: '{"elements":[],"version":1}',
        open_workspace: { id: 'workspace-1', name: 'Research', path: '/Research.vdw' },
        update_object_document: {
          documentJson: '{"elements":[],"version":1}',
          id: 'object-1',
          title: 'Note',
          type: 'Knowledge object',
        },
      };
      return responses[command] as T;
    };
    const gateway = new TauriWorkspaceGateway(invoke);

    expect(gateway.platform).toBe('desktop');
    expect(await gateway.listWorkspaces()).toEqual({ files: [], warnings: [] });
    expect(await gateway.createWorkspace('Research')).toMatchObject({
      objects: [],
      warnings: [],
    });
    expect(await gateway.openWorkspace('workspace-1')).toMatchObject({
      objects: [],
      warnings: [],
    });
    await gateway.createObject('workspace-1', 'Note');
    await gateway.deleteObject('workspace-1', 'object-2');
    await gateway.updateObjectDocument('workspace-1', 'object-1', {
      elements: [],
      version: 1,
    });
    await gateway.loadCanvasDocument('workspace-1');
    await gateway.saveCanvasDocument('workspace-1', {
      elements: [],
      placements: [],
      version: 1,
    });
    await gateway.deleteWorkspace('workspace-2');

    expect(calls).toEqual([
      { command: 'list_workspaces', args: undefined },
      { command: 'create_workspace', args: { name: 'Research' } },
      { command: 'open_workspace', args: { workspaceId: 'workspace-1' } },
      {
        command: 'create_object',
        args: { workspaceId: 'workspace-1', title: 'Note' },
      },
      {
        command: 'delete_object',
        args: { objectId: 'object-2', workspaceId: 'workspace-1' },
      },
      {
        command: 'update_object_document',
        args: {
          documentJson: '{"elements":[],"version":1}',
          objectId: 'object-1',
          workspaceId: 'workspace-1',
        },
      },
      {
        command: 'load_canvas_document',
        args: { workspaceId: 'workspace-1' },
      },
      {
        command: 'save_canvas_document',
        args: {
          documentJson: '{"elements":[],"placements":[],"version":1}',
          workspaceId: 'workspace-1',
        },
      },
      {
        command: 'delete_workspace',
        args: { workspaceId: 'workspace-2' },
      },
    ]);
  });

  it('persists browser workspaces and objects in the supplied local storage', async () => {
    const storageKey = 'kaordo.gateway.test';
    localStorage.removeItem(storageKey);
    const ids = ['workspace-1', 'object-1'];
    const firstGateway = new WebWorkspaceGateway({
      createId: () => ids.shift() ?? 'unexpected-id',
      now: () => 42,
      storage: localStorage,
      storageKey,
    });

    expect(firstGateway.platform).toBe('web');
    await expect(firstGateway.createWorkspace('Bad\u0085name')).rejects.toThrow(
      'Workspace names cannot contain path separators or reserved filename characters.',
    );
    const workspace = await firstGateway.createWorkspace('Research.vdw');
    await expect(
      firstGateway.createObject(workspace.id, 'Bad\u0085title'),
    ).rejects.toThrow('Object titles cannot contain control characters.');
    const object = await firstGateway.createObject(workspace.id, ' Note ');
    await firstGateway.updateObjectDocument(workspace.id, object.id, {
      elements: [
        {
          html: '<p><strong>Hello</strong></p>',
          id: 'text-object-1',
          type: 'rich-text',
        },
      ],
      version: 1,
    });
    await firstGateway.saveCanvasDocument(workspace.id, {
      elements: [
        {
          fill: '#dcece5',
          height: 90,
          id: 'canvas-rectangle-1',
          radius: 10,
          stroke: '#397565',
          strokeWidth: 2,
          type: 'rectangle',
          width: 140,
          x: 320,
          y: 240,
        },
      ],
      placements: [],
      version: 1,
    });

    const reloadedGateway = new WebWorkspaceGateway({ storage: localStorage, storageKey });
    expect(await reloadedGateway.listWorkspaces()).toEqual({
      files: [
        {
          id: 'workspace-1',
          name: 'Research',
          path: 'localstorage://Kaordo/workspace-1.vdw',
        },
      ],
      warnings: [],
    });
    expect(await reloadedGateway.openWorkspace(workspace.id)).toMatchObject({
      objects: [
        {
          document: {
            elements: [
              {
                html: '<p><strong>Hello</strong></p>',
                id: 'text-object-1',
                type: 'rich-text',
              },
            ],
            version: 1,
          },
          id: 'object-1',
          title: 'Note',
          type: 'Knowledge object',
        },
      ],
      warnings: [],
    });
    expect(await reloadedGateway.loadCanvasDocument(workspace.id)).toMatchObject({
      elements: [{ id: 'canvas-rectangle-1', x: 320, y: 240 }],
      version: 1,
    });
    await reloadedGateway.deleteObject(workspace.id, object.id);
    expect(await reloadedGateway.openWorkspace(workspace.id)).toMatchObject({
      objects: [],
    });
    await reloadedGateway.deleteWorkspace(workspace.id);
    expect(await reloadedGateway.listWorkspaces()).toEqual({
      files: [],
      warnings: [],
    });
    localStorage.removeItem(storageKey);
  });

  it('moves the pre-Kaordo browser library without losing workspaces', async () => {
    const legacyKey = ['veri', 'dimensio.workspace-library.v1'].join('');
    localStorage.setItem(legacyKey, JSON.stringify({
      version: 1,
      workspaces: [{
        canvasDocument: { elements: [], placements: [], version: 1 },
        createdAtUnixMs: 42,
        id: 'legacy-workspace',
        name: 'Legacy',
        objects: [],
        path: `localstorage://${['Veri', 'dimensio'].join('')}/legacy-workspace.vdw`,
        warnings: [],
      }],
    }));

    const gateway = new WebWorkspaceGateway({ storage: localStorage });
    expect(await gateway.listWorkspaces()).toMatchObject({
      files: [{ id: 'legacy-workspace', path: 'localstorage://Kaordo/legacy-workspace.vdw' }],
    });
    expect(localStorage.getItem('kaordo.workspace-library.v1')).not.toBeNull();
    expect(localStorage.getItem(legacyKey)).toBeNull();
    localStorage.removeItem('kaordo.workspace-library.v1');
  });
});
