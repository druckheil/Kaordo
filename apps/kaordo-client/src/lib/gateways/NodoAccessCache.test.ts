import { describe, expect, it, vi } from 'vitest';
import type { NodoAccess } from '../domain/nodo';
import { NodoAccessCache } from './NodoAccessCache';

describe('NodoAccessCache', () => {
  it('shares concurrent access requests and reuses a short-lived ticket', async () => {
    const request = vi.fn(async () => access(1_800_000_300));
    const cache = new NodoAccessCache(15_000);

    const [first, second] = await Promise.all([
      cache.get('node', request),
      cache.get('node', request),
    ]);
    expect(first).toBe(second);
    expect(request).toHaveBeenCalledTimes(1);
    expect(await cache.get('node', request)).toBe(first);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not cache a ticket inside its expiry safety window', async () => {
    const request = vi.fn(async () => access(Math.floor(Date.now() / 1_000) + 10));
    const cache = new NodoAccessCache(15_000);

    await cache.get('node', request);
    await cache.get('node', request);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not let a forced request join a stale normal request', async () => {
    const releases: Array<(value: NodoAccess) => void> = [];
    const request = vi.fn(() => new Promise<NodoAccess>((resolve) => { releases.push(resolve); }));
    const cache = new NodoAccessCache(15_000);
    const normal = cache.get('node', request);
    const forced = cache.get('node', request, true);
    expect(request).toHaveBeenCalledTimes(2);
    releases.forEach((resolve) => resolve(access(1_800_000_300)));
    await Promise.all([normal, forced]);
  });
});

function access(expiresAt: number): NodoAccess {
  return {
    candidates: [],
    expiresAt,
    node: null as never,
    ticket: 'A'.repeat(43),
  };
}
