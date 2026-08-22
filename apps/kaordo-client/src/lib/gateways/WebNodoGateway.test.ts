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
    const completed = {
      batteryPercent: null,
      charging: null,
      completedAt: 1_800_000_001,
      coordinatorLatencyMs: 18,
      diskReadBps: 40_000_000,
      diskWriteBps: 20_000_000,
      memoryAvailableBytes: 2_000_000_000,
      memoryTotalBytes: 6_000_000_000,
      networkDownBps: 1_000_000_000,
      networkMetered: null,
      networkType: 'ethernet',
      networkUpBps: 1_000_000_000,
      storageAvailableBytes: 40_000_000_000,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/access')) return new Response(JSON.stringify({
        candidates: [{ address: '198.51.100.12', kind: 'public', port: 49_321 }],
        expiresAt: 1_800_000_300,
        node: null,
        ticket: 'B'.repeat(43),
      }), { headers: { 'content-type': 'application/json' } });
      if (url === '/api/nodes/node-id/test') {
        return new Response(String(init?.body), { headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/v1/status')) return new Response(JSON.stringify({ status: 'online' }));
      const value = url.includes('/battery')
        ? { batteryPercent: null, charging: null, completedAt: completed.completedAt }
        : url.includes('/memory')
          ? { completedAt: completed.completedAt, memoryAvailableBytes: completed.memoryAvailableBytes, memoryTotalBytes: completed.memoryTotalBytes, storageAvailableBytes: completed.storageAvailableBytes }
          : url.includes('/network')
            ? { completedAt: completed.completedAt, networkDownBps: completed.networkDownBps, networkMetered: null, networkType: 'ethernet', networkUpBps: completed.networkUpBps }
            : url.includes('/latency')
              ? { completedAt: completed.completedAt, coordinatorLatencyMs: completed.coordinatorLatencyMs }
              : { completedAt: completed.completedAt, diskReadBps: completed.diskReadBps, diskWriteBps: completed.diskWriteBps };
      return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new WebNodoGateway().requestQuickTest('node-id');

    expect(result.diskReadBps).toBe(40_000_000);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/nodes/node-id/access');
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/v1/diagnostics/disk'))).toBe(true);
    const persisted = fetchMock.mock.calls.find(([input]) => input === '/api/nodes/node-id/test');
    expect(persisted?.[1]).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(String(persisted?.[1]?.body))).toEqual(completed);
  });
});
