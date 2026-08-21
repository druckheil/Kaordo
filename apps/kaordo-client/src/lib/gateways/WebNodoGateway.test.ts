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
});
