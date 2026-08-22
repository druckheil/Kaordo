import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodoAccess, NodoTelemetryUpdate } from '../domain/nodo';
import { runNodeQuickTest } from './NodeDiagnosticsGateway';

describe('runNodeQuickTest', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('runs fresh diagnostic groups concurrently and publishes each completed group', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => diagnosticResponse(String(input)));
    vi.stubGlobal('fetch', fetchMock);
    const updates: NodoTelemetryUpdate[] = [];

    const result = await runNodeQuickTest(access([
      { address: '203.0.113.10', kind: 'public', port: 49_321 },
      { address: '192.168.1.44', kind: 'lan', port: 49_321 },
    ]), (update) => updates.push(update));

    expect(result).toMatchObject({
      batteryPercent: null,
      coordinatorLatencyMs: 18,
      diskReadBps: 120_000_000,
      memoryTotalBytes: 6_000_000_000,
      networkType: 'ethernet',
    });
    expect(updates.map(({ fields }) => fields)).toEqual(expect.arrayContaining([
      ['battery'],
      ['memory'],
      ['connection', 'download', 'upload'],
      ['latency'],
      ['read', 'write'],
    ]));
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url.includes('/v1/diagnostics/'))).toHaveLength(5);
    expect(urls.filter((url) => url.includes('/v1/diagnostics/')).every(
      (url) => url.startsWith('http://192.168.1.44:49321/'),
    )).toBe(true);
  });

  it('uses the public address when the host has no LAN route', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => diagnosticResponse(String(input)));
    vi.stubGlobal('fetch', fetchMock);

    await runNodeQuickTest(access([
      { address: '198.51.100.12', kind: 'public', port: 49_321 },
    ]));

    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).startsWith('http://198.51.100.12:49321/v1/diagnostics/disk'),
    )).toBe(true);
  });

  it('uses the HTTPS relay before an IPv6 public route in the Tauri WebView', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => diagnosticResponse(String(input)));
    vi.stubGlobal('fetch', fetchMock);

    await runNodeQuickTest(access([
      { address: '2001:db8::10', kind: 'public', port: 49_321 },
      { address: 'relay', kind: 'relay', origin: 'https://api.example.test/api/nodes/node/relay', port: 443 },
    ]));

    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).startsWith('https://api.example.test/api/nodes/node/relay/v1/diagnostics/disk'),
    )).toBe(true);
  });
});

function access(candidates: NodoAccess['candidates']): NodoAccess {
  return {
    candidates,
    expiresAt: 1_800_000_300,
    node: null as never,
    ticket: 'A'.repeat(43),
  };
}

function diagnosticResponse(url: string): Response {
  const completedAt = 1_800_000_000;
  const value = url.includes('/battery')
    ? { batteryPercent: null, charging: null, completedAt }
    : url.includes('/memory')
      ? { completedAt, memoryAvailableBytes: 2_000_000_000, memoryTotalBytes: 6_000_000_000, storageAvailableBytes: 40_000_000_000 }
      : url.includes('/network')
        ? { completedAt, networkDownBps: 1_000_000_000, networkMetered: null, networkType: 'ethernet', networkUpBps: 1_000_000_000 }
        : url.includes('/latency')
          ? { completedAt, coordinatorLatencyMs: 18 }
          : url.includes('/disk')
            ? { completedAt, diskReadBps: 120_000_000, diskWriteBps: 80_000_000 }
            : { status: 'online' };
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}
