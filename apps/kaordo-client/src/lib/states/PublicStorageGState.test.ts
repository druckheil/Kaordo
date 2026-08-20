import { describe, expect, it } from 'vitest';
import type { PublicNodoStorage } from '../domain/nodo';
import type { NodoGateway } from '../gateways/NodoGateway';
import { PublicStorageGState } from './PublicStorageGState';

describe('PublicStorageGState', () => {
  it('loads the Public Nodo pool when its own state enters', async () => {
    let resolveStorage: (storage: PublicNodoStorage) => void = () => undefined;
    const storagePromise = new Promise<PublicNodoStorage>((resolve) => {
      resolveStorage = resolve;
    });
    const gateway = {
      publicStorage: () => storagePromise,
    } as NodoGateway;
    const state = new PublicStorageGState(gateway);

    state.enter();
    expect(state.snapshot).toMatchObject({ phase: 'loading', storage: null });

    const storage: PublicNodoStorage = {
      limitBytes: 1_073_741_824,
      nodeCandidates: [],
      reservedBytes: 0,
      usedBytes: 12,
    };
    resolveStorage(storage);
    await storagePromise;

    expect(state.snapshot).toEqual({ error: null, phase: 'ready', storage });
  });

  it('keeps a failed request visible instead of reporting unavailable as a blank field', async () => {
    const gateway = {
      publicStorage: () => Promise.reject('Public pool request failed.'),
    } as NodoGateway;
    const state = new PublicStorageGState(gateway);

    await state.refresh();

    expect(state.snapshot).toMatchObject({
      error: 'Public pool request failed.',
      phase: 'error',
    });
  });
});
