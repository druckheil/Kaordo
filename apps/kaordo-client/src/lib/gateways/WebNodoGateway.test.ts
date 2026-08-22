import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebNodoGateway } from './WebNodoGateway';

describe('WebNodoGateway', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shares concurrent public-storage reads without caching stale data', async () => {
    let resolveResponse!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => { resolveResponse = resolve; });
    const fetchMock = vi.fn(() => response);
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new WebNodoGateway();
    const first = gateway.publicStorage();
    const second = gateway.publicStorage();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveResponse(new Response(JSON.stringify({
      limitBytes: 1024,
      nodeCandidates: [],
      reservedBytes: 0,
      usedBytes: 0,
    }), { headers: { 'content-type': 'application/json' } }));

    const [firstValue, secondValue] = await Promise.all([first, second]);
    expect(firstValue).toEqual(secondValue);

    await gateway.publicStorage();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clears a failed shared read so a later attempt can recover', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Temporary failure' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        limitBytes: 1024,
        nodeCandidates: [],
        reservedBytes: 0,
        usedBytes: 0,
      }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new WebNodoGateway();
    await expect(gateway.publicStorage()).rejects.toThrow('Temporary failure');
    await expect(gateway.publicStorage()).resolves.toMatchObject({ limitBytes: 1024 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a browser-cached node list', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ nodes: [] }), {
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await new WebNodoGateway().listNodes();

    expect(fetchMock).toHaveBeenCalledWith('/api/nodes', expect.objectContaining({
      cache: 'no-store',
      credentials: 'include',
    }));
  });

  it('runs one direct quick test and immediately persists its completed result', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ address: '198.51.100.12', kind: 'public', port: 49_321 }],
        expiresAt: 1_800_000_300,
        node: null,
        ticket: 'B'.repeat(43),
      }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        completedAt: 1_800_000_001,
        diskReadBps: 40_000_000,
        diskWriteBps: 20_000_000,
      }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        completedAt: 1_800_000_001,
        diskReadBps: 40_000_000,
        diskWriteBps: 20_000_000,
      }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new WebNodoGateway().requestQuickTest('node-id');

    expect(result.diskReadBps).toBe(40_000_000);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/nodes/node-id/access');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'http://198.51.100.12:49321/v1/diagnostics/quick-test',
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/nodes/node-id/test');
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      completedAt: 1_800_000_001,
      diskReadBps: 40_000_000,
      diskWriteBps: 20_000_000,
    });
  });
});
