import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodoAccess } from '../domain/nodo';
import { updateNode } from './NodeUpdateGateway';

describe('updateNode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the host acknowledgement without polling the update job', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({
      currentVersion: '0.2.1-3a',
      jobId: 'job-1',
      message: 'Update accepted.',
      status: 'started',
    }), {
      headers: { 'content-type': 'application/json' },
      status: 202,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const access: NodoAccess = {
      candidates: [{ address: '198.51.100.12', kind: 'public', port: 49_321 }],
      expiresAt: 1_900_000_000,
      node: {} as NodoAccess['node'],
      ticket: 'B'.repeat(43),
    };

    await expect(updateNode(access)).resolves.toMatchObject({ status: 'started' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://198.51.100.12:49321/v1/update');
  });
});
