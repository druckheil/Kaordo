import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodoAccess } from '../domain/nodo';
import { runNodeQuickTest } from './NodeDiagnosticsGateway';

describe('runNodeQuickTest', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('runs immediately on the LAN node and returns measured disk fields', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      completedAt: 1_800_000_000,
      diskReadBps: 120_000_000,
      diskWriteBps: 80_000_000,
    }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runNodeQuickTest({
      candidates: [
        { address: '203.0.113.10', kind: 'public', port: 49_321 },
        { address: '192.168.1.44', kind: 'lan', port: 49_321 },
      ],
      expiresAt: 1_800_000_300,
      node: null as never,
      ticket: 'A'.repeat(43),
    } satisfies NodoAccess);

    expect(result.diskReadBps).toBe(120_000_000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://192.168.1.44:49321/v1/diagnostics/quick-test',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { authorization: `Bearer ${'A'.repeat(43)}` },
      method: 'POST',
    });
  });
});
