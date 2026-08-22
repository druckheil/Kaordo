import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodoAccess } from '../domain/nodo';
import { clearNodeStorage, clearPrivateNodeStorage, readNodeUsage } from './NodeStorageGateway';

describe('clearNodeStorage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('deletes all content directly on the authenticated LAN host', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      deletedBytes: 153_800_000,
      deletedPosts: 2,
      deletedUploads: 3,
    }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await clearNodeStorage({
      candidates: [
        { address: '203.0.113.10', kind: 'public', port: 49_321 },
        { address: '192.168.1.44', kind: 'lan', port: 49_321 },
      ],
      expiresAt: Math.floor(Date.now() / 1_000) + 300,
      node: null as never,
      ticket: 'A'.repeat(43),
    } satisfies NodoAccess);

    expect(result.deletedBytes).toBe(153_800_000);
    expect(fetchMock).toHaveBeenCalledWith('http://192.168.1.44:49321/v1/storage', expect.objectContaining({
      headers: { authorization: `Bearer ${'A'.repeat(43)}` },
      method: 'DELETE',
    }));
  });

  it('targets only the private space when requested', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      deletedBytes: 42,
      deletedPosts: 1,
      deletedUploads: 0,
    }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await clearPrivateNodeStorage({
      candidates: [{ address: '192.168.1.44', kind: 'lan', port: 49_321 }],
      expiresAt: Math.floor(Date.now() / 1_000) + 300,
      node: null as never,
      ticket: 'B'.repeat(43),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.1.44:49321/v1/spaces/private/storage',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('falls back to the public host when no LAN route is available', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      usedBytes: 17,
      spaces: {
        private: { quotaBytes: 100, usedBytes: 12 },
        public: { quotaBytes: 100, usedBytes: 5 },
      },
    }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await readNodeUsage({
      candidates: [{ address: '198.51.100.12', kind: 'public', port: 49_321 }],
      expiresAt: Math.floor(Date.now() / 1_000) + 300,
      node: null as never,
      ticket: 'C'.repeat(43),
    });

    expect(result.usedBytes).toBe(17);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://198.51.100.12:49321/v1/status');
  });
});
