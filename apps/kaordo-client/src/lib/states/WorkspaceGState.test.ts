import { describe, expect, it } from 'vitest';
import type { WorkspaceGateway } from '../gateways/WorkspaceGateway';
import { WorkspaceGState } from './WorkspaceGState';

describe('WorkspaceGState', () => {
  it('shares concurrent library reads during startup and retry', async () => {
    let calls = 0;
    let resolveLibrary!: () => void;
    const libraryReady = new Promise<void>((resolve) => { resolveLibrary = resolve; });
    const gateway = {
      listWorkspaces: async () => {
        calls += 1;
        await libraryReady;
        return { files: [], warnings: [] };
      },
    } as unknown as WorkspaceGateway;
    const state = new WorkspaceGState(gateway, { autoload: false });

    const first = state.loadLibrary();
    const second = state.loadLibrary();
    expect(second).toBe(first);
    expect(calls).toBe(1);

    resolveLibrary();
    await expect(first).resolves.toBe(true);
    expect(state.snapshot.libraryPhase).toBe('ready');
  });
});
